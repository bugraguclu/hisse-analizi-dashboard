"""Macro store service — ingestion (worker-facing) + store-first reads (API-facing).

Two layers:

- **Ingestion** (:func:`ingest_rates`, :func:`ingest_inflation`, :func:`ingest_fx`,
  :func:`ingest_evds`): full-history scrapes via :mod:`src.adapters.tcmb_adapter` /
  :mod:`src.adapters.evds_adapter`, upserted into ``macro_series`` / ``fx_bulletins``
  through :mod:`src.db.repositories.macro`. Driven by :mod:`src.workers.macro_worker`.
- **Store-first reads** (:func:`get_tcmb_store_first`, :func:`get_policy_rate_store_first`,
  :func:`get_inflation_store_first`, :func:`get_fx_store_first`): read-through per
  ``docs/data-platform.md`` §4.1 — serve the store when fresh, otherwise call the
  existing live adapter (:mod:`src.adapters.macro`, owned by another session, used
  here read-only) and write its result through to the store, falling back to a
  ``stale``-flagged store copy when the provider fails. Payload shapes are
  byte-compatible with the current ``src.adapters.macro`` functions plus an
  additive ``meta`` block (:mod:`src.core.meta`).

:func:`run_accuracy_checks` implements WS4 report item 5 (cross-source checks),
writing :class:`~src.db.models.DataQualityCheck` rows.
"""

from __future__ import annotations

import math
import re
from collections.abc import Awaitable, Sequence
from datetime import date, datetime, time as dtime, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters import evds_adapter, macro as macro_adapter, tcmb_adapter
from src.adapters.utils import InvalidInputError, df_to_records, error_payload, run_sync, upstream_failure
from src.core.config import settings
from src.core.meta import DataMeta, with_meta
from src.core.time import utcnow
from src.db.models import DataQualityCheck, FxBulletin, MacroObservation
from src.db.repositories.macro import FxBulletinRow, MacroRepository, ObservationRow

logger = structlog.get_logger(__name__)

ISTANBUL_TZ = ZoneInfo("Europe/Istanbul")

RATE_TYPES: tuple[str, ...] = ("policy", "overnight", "late_liquidity")
RATE_SERIES: dict[str, tuple[str, ...]] = {
    "policy": ("tcmb.policy_rate",),
    "overnight": ("tcmb.overnight.borrowing", "tcmb.overnight.lending"),
    "late_liquidity": ("tcmb.late_liquidity.borrowing", "tcmb.late_liquidity.lending"),
}
TCMB_FX_PAGE_URL = "https://www.tcmb.gov.tr/kurlar/kurlar_tr.html"
_FX_HISTORY_DAYS = 31
_FX_PEAK_START = dtime(15, 0)
_FX_PEAK_END = dtime(16, 30)
_CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
_MSG_TCMB = "TCMB faiz verisi şu anda alınamıyor"
_MSG_INFLATION = "Enflasyon verisi şu anda alınamıyor"
_MSG_FX = "Döviz kuru şu anda alınamıyor"
_STALE_NOTE = "Sağlayıcıya ulaşılamadı; son kayıtlı veri gösteriliyor."

# FxBulletin has no display-name column (model frozen — see WS4 report İSTEK).
# Names as published in TCMB's today.xml on 2026-09-23 (all 22 currencies then listed).
_CURRENCY_NAMES: dict[str, str] = {
    "AED": "UNITED ARAB EMIRATES DIRHAM",
    "AUD": "AUSTRALIAN DOLLAR",
    "AZN": "AZERBAIJANI NEW MANAT",
    "CAD": "CANADIAN DOLLAR",
    "CHF": "SWISS FRANK",
    "CNY": "CHINESE RENMINBI",
    "DKK": "DANISH KRONE",
    "EUR": "EURO",
    "GBP": "POUND STERLING",
    "JPY": "JAPENESE YEN",
    "KRW": "SOUTH KOREAN WON",
    "KWD": "KUWAITI DINAR",
    "KZT": "KAZAKHSTAN TENGE",
    "NOK": "NORWEGIAN KRONE",
    "PKR": "PAKISTANI RUPEE",
    "QAR": "QATARI RIAL",
    "RON": "NEW LEU",
    "RUB": "RUSSIAN ROUBLE",
    "SAR": "SAUDI RIYAL",
    "SEK": "SWEDISH KRONA",
    "USD": "US DOLLAR",
    "XDR": "SPECIAL DRAWING RIGHT (SDR)",
}


def _decimal(value: float | Decimal) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(round(float(value), 6)))


def _decimal_or_none(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        if isinstance(value, float) and not math.isfinite(value):
            return None
    except TypeError:
        return None
    return _decimal(value)


def _parse_iso_date(text: Any) -> date | None:
    """Accepts ``"YYYY-MM-DD"`` or ``"YYYY-MM-DDT00:00:00"``."""
    if not text:
        return None
    try:
        return date.fromisoformat(str(text)[:10])
    except ValueError:
        return None


async def _call_live(coro: Awaitable[dict[str, Any]], default_message: str) -> dict[str, Any]:
    """Await a ``src.adapters.macro`` live call, converting an unexpected raise into
    the same ``{"error": ..., "error_status": ...}`` shape it would otherwise return
    (the documented contract is "never raises"; this is defence in depth per the
    read-through pseudocode in docs/data-platform.md §4.1)."""
    try:
        return await coro
    except Exception as e:
        logger.warning("macro_live_fetch_raised", error=f"{type(e).__name__}: {e}")
        return error_payload(e, default_message)


def _fx_max_age(now: datetime | None = None) -> timedelta:
    moment = (now or utcnow()).astimezone(ISTANBUL_TZ)
    if _FX_PEAK_START <= moment.time() <= _FX_PEAK_END:
        return timedelta(hours=settings.macro_max_age_fx_peak_hours)
    return timedelta(hours=settings.macro_max_age_fx_offpeak_hours)


# ---------------------------------------------------------------------------
# Ingestion (worker-facing) — full history via tcmb_adapter / evds_adapter
# ---------------------------------------------------------------------------

async def ingest_rates(session: AsyncSession) -> dict[str, Any]:
    """``macro.rates`` job: policy / overnight / late_liquidity, full history."""
    counts: dict[str, int] = {}
    errors: dict[str, str] = {}
    rows: list[ObservationRow] = []
    for rate_type, codes in RATE_SERIES.items():
        try:
            history = await tcmb_adapter.fetch_rate_history(rate_type)
        except Exception as e:
            errors[rate_type] = f"{type(e).__name__}: {e}"
            logger.warning("macro_ingest_rates_failed", rate_type=rate_type, error=errors[rate_type])
            continue
        if len(codes) == 1:
            (lending_code,) = codes
            new_rows = [
                ObservationRow(lending_code, o.observation_date, o.lending, "tcmb")
                for o in history
                if o.lending is not None and o.lending > 0
            ]
            rows.extend(new_rows)
            counts[lending_code] = len(new_rows)
        else:
            borrowing_code, lending_code = codes
            b_rows = [
                ObservationRow(borrowing_code, o.observation_date, o.borrowing, "tcmb")
                for o in history
                if o.borrowing is not None and o.borrowing > 0
            ]
            l_rows = [
                ObservationRow(lending_code, o.observation_date, o.lending, "tcmb")
                for o in history
                if o.lending is not None and o.lending > 0
            ]
            rows.extend(b_rows)
            rows.extend(l_rows)
            counts[borrowing_code] = len(b_rows)
            counts[lending_code] = len(l_rows)
    repo = MacroRepository(session)
    written = await repo.upsert_observations(rows)
    await session.commit()
    return {"series": counts, "rows_upserted": written, "errors": errors}


async def ingest_inflation(session: AsyncSession) -> dict[str, Any]:
    """``macro.inflation`` job: TÜFE (CPI) + ÜFE (PPI), full history."""
    counts: dict[str, int] = {}
    errors: dict[str, str] = {}
    rows: list[ObservationRow] = []
    try:
        cpi = await tcmb_adapter.fetch_cpi_history()
        yoy = [ObservationRow("tuik.cpi.yoy", o.observation_date, o.yoy, "tuik") for o in cpi if o.yoy is not None]
        mom = [ObservationRow("tuik.cpi.mom", o.observation_date, o.mom, "tuik") for o in cpi if o.mom is not None]
        rows.extend(yoy)
        rows.extend(mom)
        counts["tuik.cpi.yoy"] = len(yoy)
        counts["tuik.cpi.mom"] = len(mom)
    except Exception as e:
        errors["cpi"] = f"{type(e).__name__}: {e}"
        logger.warning("macro_ingest_cpi_failed", error=errors["cpi"])
    try:
        ppi = await tcmb_adapter.fetch_ppi_history()
        yoy = [ObservationRow("tuik.ppi.yoy", o.observation_date, o.yoy, "tuik") for o in ppi if o.yoy is not None]
        mom = [ObservationRow("tuik.ppi.mom", o.observation_date, o.mom, "tuik") for o in ppi if o.mom is not None]
        rows.extend(yoy)
        rows.extend(mom)
        counts["tuik.ppi.yoy"] = len(yoy)
        counts["tuik.ppi.mom"] = len(mom)
    except Exception as e:
        errors["ppi"] = f"{type(e).__name__}: {e}"
        logger.warning("macro_ingest_ppi_failed", error=errors["ppi"])
    repo = MacroRepository(session)
    written = await repo.upsert_observations(rows)
    await session.commit()
    return {"series": counts, "rows_upserted": written, "errors": errors}


async def ingest_fx(session: AsyncSession, *, backfill_days: int | None = None) -> dict[str, Any]:
    """``macro.fx`` job: TCMB daily bulletin, all currencies in the XML."""
    days = backfill_days if backfill_days is not None else settings.macro_fx_backfill_days
    try:
        bulletins = await tcmb_adapter.fetch_fx_backfill(days, concurrency=settings.macro_fx_archive_concurrency)
    except Exception as e:
        error = f"{type(e).__name__}: {e}"
        logger.warning("macro_ingest_fx_failed", error=error)
        return {"currencies": {}, "rows_upserted": 0, "bulletin_days": 0, "errors": {"fx": error}}

    rows: list[FxBulletinRow] = []
    currency_counts: dict[str, int] = {}
    for bulletin in bulletins:
        for code, info in bulletin.rates.items():
            if info.get("forex_selling") is None and info.get("forex_buying") is None:
                continue
            rows.append(
                FxBulletinRow(
                    bulletin_date=bulletin.bulletin_date,
                    currency=code,
                    quoted_unit=int(info.get("quoted_unit") or 1),
                    forex_buying=info.get("forex_buying"),
                    forex_selling=info.get("forex_selling"),
                    banknote_buying=info.get("banknote_buying"),
                    banknote_selling=info.get("banknote_selling"),
                    source="tcmb",
                )
            )
            currency_counts[code] = currency_counts.get(code, 0) + 1
    repo = MacroRepository(session)
    written = await repo.upsert_fx_bulletins(rows)
    await session.commit()
    return {"currencies": currency_counts, "rows_upserted": written, "bulletin_days": len(bulletins), "errors": {}}


async def ingest_evds(session: AsyncSession) -> dict[str, Any]:
    """Optional ``evds.*`` series (only when ``MACRO_EVDS_API_KEY`` is set)."""
    if not evds_adapter.evds_enabled():
        return {"enabled": False, "series": {}, "rows_upserted": 0, "errors": {}}
    counts: dict[str, int] = {}
    errors: dict[str, str] = {}
    rows: list[ObservationRow] = []
    for name in evds_adapter.EVDS_INDEX_SERIES:
        for formula, suffix in (("yoy_pct", "yoy"), ("pct_change", "mom")):
            series_code = f"evds.{name}.{suffix}"
            try:
                observations = await evds_adapter.fetch_evds_series(name, formula=formula)
            except Exception as e:
                errors[series_code] = f"{type(e).__name__}: {e}"
                logger.warning("macro_ingest_evds_failed", series=series_code, error=errors[series_code])
                continue
            new_rows = [ObservationRow(series_code, o.observation_date, o.value, "evds") for o in observations]
            rows.extend(new_rows)
            counts[series_code] = len(new_rows)
    repo = MacroRepository(session)
    written = await repo.upsert_observations(rows)
    await session.commit()
    return {"enabled": True, "series": counts, "rows_upserted": written, "errors": errors}


# ---------------------------------------------------------------------------
# Store-first reads (API-facing) — §4.1 read-through
# ---------------------------------------------------------------------------

async def _store_tcmb_rates(session: AsyncSession) -> tuple[dict[str, Any] | None, datetime | None]:
    """``get_tcmb_rates()``-shaped payload from the store; ``(None, None)`` when any
    rate_type has no usable row yet (forces a live call)."""
    repo = MacroRepository(session)
    data: list[dict[str, Any]] = []
    fetched_ats: list[datetime] = []
    for rate_type in RATE_TYPES:
        codes = RATE_SERIES[rate_type]
        if len(codes) == 1:
            row = await repo.latest(codes[0])
            if row is None:
                return None, None
            data.append(
                {"type": rate_type, "date": row.observation_date.isoformat(), "borrowing": None, "lending": float(row.value)}
            )
            fetched_ats.append(row.fetched_at)
        else:
            borrowing_code, lending_code = codes
            lending_row = await repo.latest(lending_code)
            if lending_row is None:
                return None, None
            day = lending_row.observation_date
            borrowing_row = await repo.at(borrowing_code, day)
            data.append(
                {
                    "type": rate_type,
                    "date": day.isoformat(),
                    "borrowing": float(borrowing_row.value) if borrowing_row is not None else None,
                    "lending": float(lending_row.value),
                }
            )
            fetched_ats.append(lending_row.fetched_at)
            if borrowing_row is not None:
                fetched_ats.append(borrowing_row.fetched_at)
    if not data:
        return None, None
    dates = [d["date"] for d in data if d.get("date")]
    payload = {
        "source": "TCMB",
        "source_url": tcmb_adapter.RATE_PAGE_URLS["policy"],
        "as_of": max(dates) if dates else None,
        "data": data,
    }
    return payload, (min(fetched_ats) if fetched_ats else None)


async def _write_through_tcmb_rates(session: AsyncSession, payload: dict[str, Any]) -> None:
    rows: list[ObservationRow] = []
    for entry in payload.get("data") or []:
        day = _parse_iso_date(entry.get("date"))
        codes = RATE_SERIES.get(entry.get("type"))
        if day is None or not codes:
            continue
        if len(codes) == 1:
            value = entry.get("lending")
            if value is not None:
                rows.append(ObservationRow(codes[0], day, _decimal(value), "tcmb"))
        else:
            borrowing_code, lending_code = codes
            if entry.get("borrowing") is not None:
                rows.append(ObservationRow(borrowing_code, day, _decimal(entry["borrowing"]), "tcmb"))
            if entry.get("lending") is not None:
                rows.append(ObservationRow(lending_code, day, _decimal(entry["lending"]), "tcmb"))
    if rows:
        await MacroRepository(session).upsert_observations(rows)
        await session.commit()


async def get_tcmb_store_first(session: AsyncSession) -> dict[str, Any]:
    """Store-first replacement for ``src.adapters.macro.get_tcmb_rates()``."""
    now = utcnow()
    store_payload, oldest_fetched_at = await _store_tcmb_rates(session)
    max_age = timedelta(hours=settings.macro_max_age_rates_hours)
    if store_payload is not None and oldest_fetched_at is not None and (now - oldest_fetched_at) <= max_age:
        return with_meta(
            store_payload,
            DataMeta(
                source="tcmb",
                source_url=store_payload["source_url"],
                as_of=store_payload["as_of"],
                fetched_at=oldest_fetched_at,
                served_from="store",
            ),
        )
    live = await _call_live(macro_adapter.get_tcmb_rates(), _MSG_TCMB)
    if upstream_failure(live) is None:
        await _write_through_tcmb_rates(session, live)
        return with_meta(
            live,
            DataMeta(source="tcmb", source_url=live.get("source_url"), as_of=live.get("as_of"), fetched_at=now, served_from="live"),
        )
    if store_payload is not None and oldest_fetched_at is not None:
        return with_meta(
            store_payload,
            DataMeta(
                source="tcmb",
                source_url=store_payload["source_url"],
                as_of=store_payload["as_of"],
                fetched_at=oldest_fetched_at,
                served_from="stale",
                stale=True,
                notes=[_STALE_NOTE],
            ),
        )
    return live  # store empty and live failed: existing error contract, unchanged


def _policy_rate_changes(rows: Sequence[MacroObservation]) -> list[dict[str, Any]]:
    """Every stored policy-rate change (ascending) with the move in basis points — the
    live payload's ``changes`` (the TCMB table only lists the days the rate changed)."""
    changes: list[dict[str, Any]] = []
    previous: float | None = None
    for r in rows:
        rate = float(r.value)
        changes.append(
            {
                "date": r.observation_date.isoformat(),
                "rate": rate,
                "previous": previous,
                "change_bp": round((rate - previous) * 100) if previous is not None else None,
            }
        )
        previous = rate
    return changes


def _policy_rate_payload_from_rows(rows: Sequence[MacroObservation]) -> dict[str, Any]:
    """``rows``: the full stored series, ascending; ``history`` keeps the last 24 like the live payload."""
    latest = rows[-1]
    history = [
        {"date": f"{r.observation_date.isoformat()}T00:00:00", "borrowing": None, "lending": float(r.value)}
        for r in rows[-24:]
    ]
    changes = _policy_rate_changes(rows)
    return {
        "source": "TCMB",
        "source_url": tcmb_adapter.RATE_PAGE_URLS["policy"],
        "as_of": latest.observation_date.isoformat(),
        "policy_rate": {"value": float(latest.value), "date": latest.observation_date.isoformat()},
        "history": history,
        "changes": changes,
        "last_change": changes[-1] if changes else None,
    }


async def _write_through_policy_rate(session: AsyncSession, payload: dict[str, Any]) -> None:
    rows: list[ObservationRow] = []
    for entry in payload.get("history") or []:
        day = _parse_iso_date(entry.get("date"))
        value = entry.get("lending")
        if day is not None and value is not None:
            rows.append(ObservationRow("tcmb.policy_rate", day, _decimal(value), "tcmb"))
    # ``changes`` carries every change day (``history`` only the last 24): keeps the stored
    # series complete, so a store-served ``changes`` matches the live one.
    for entry in payload.get("changes") or []:
        day = _parse_iso_date(entry.get("date"))
        value = entry.get("rate")
        if day is not None and value is not None:
            rows.append(ObservationRow("tcmb.policy_rate", day, _decimal(value), "tcmb"))
    current = payload.get("policy_rate") or {}
    day = _parse_iso_date(current.get("date"))
    value = current.get("value")
    if day is not None and value is not None:
        rows.append(ObservationRow("tcmb.policy_rate", day, _decimal(value), "tcmb"))
    if rows:
        await MacroRepository(session).upsert_observations(rows)
        await session.commit()


async def get_policy_rate_store_first(session: AsyncSession) -> dict[str, Any]:
    """Store-first replacement for ``src.adapters.macro.get_policy_rate()``."""
    now = utcnow()
    rows = await MacroRepository(session).history("tcmb.policy_rate", ascending=True)
    max_age = timedelta(hours=settings.macro_max_age_rates_hours)
    if rows and (now - rows[-1].fetched_at) <= max_age:
        payload = _policy_rate_payload_from_rows(rows)
        return with_meta(
            payload,
            DataMeta(
                source="tcmb", source_url=payload["source_url"], as_of=payload["as_of"], fetched_at=rows[-1].fetched_at, served_from="store"
            ),
        )
    live = await _call_live(macro_adapter.get_policy_rate(), _MSG_TCMB)
    if upstream_failure(live) is None:
        await _write_through_policy_rate(session, live)
        return with_meta(
            live,
            DataMeta(source="tcmb", source_url=live.get("source_url"), as_of=live.get("as_of"), fetched_at=now, served_from="live"),
        )
    if rows:
        payload = _policy_rate_payload_from_rows(rows)
        return with_meta(
            payload,
            DataMeta(
                source="tcmb",
                source_url=payload["source_url"],
                as_of=payload["as_of"],
                fetched_at=rows[-1].fetched_at,
                served_from="stale",
                stale=True,
                notes=[_STALE_NOTE],
            ),
        )
    return live


async def _store_inflation_history(
    session: AsyncSession, series: str = "tuik.cpi"
) -> tuple[list[dict[str, Any]], datetime | None]:
    """Newest-first history of ``tuik.cpi`` (TÜFE) or ``tuik.ppi`` (ÜFE) in the live row shape."""
    repo = MacroRepository(session)
    yoy_rows = await repo.history(f"{series}.yoy", ascending=False)
    if not yoy_rows:
        return [], None
    mom_rows = await repo.history(f"{series}.mom", ascending=False)
    mom_by_date = {r.observation_date: r for r in mom_rows}
    history: list[dict[str, Any]] = []
    fetched_ats: list[datetime] = []
    for r in yoy_rows:
        mom_row = mom_by_date.get(r.observation_date)
        history.append(
            {
                "Date": f"{r.observation_date.isoformat()}T00:00:00",
                "YearMonth": f"{r.observation_date.month:02d}-{r.observation_date.year}",
                "YearlyInflation": float(r.value),
                "MonthlyInflation": float(mom_row.value) if mom_row is not None else None,
            }
        )
        fetched_ats.append(r.fetched_at)
        if mom_row is not None:
            fetched_ats.append(mom_row.fetched_at)
    return history, (min(fetched_ats) if fetched_ats else None)


def _latest_inflation(top: dict[str, Any], kind: str) -> dict[str, Any]:
    return {
        "date": top["Date"][:10],
        "year_month": top["YearMonth"],
        "yearly_inflation": top["YearlyInflation"],
        "monthly_inflation": top["MonthlyInflation"],
        "type": kind,
    }


def _inflation_payload_from_history(history: list[dict[str, Any]], ufe_history: list[dict[str, Any]]) -> dict[str, Any]:
    latest = _latest_inflation(history[0], "TUFE")
    return {
        "source": "TÜİK (TCMB veri tablosu)",
        "source_url": tcmb_adapter.CPI_PAGE_URL,
        "as_of": latest["date"],
        "latest": latest,
        "tufe_history": history,
        # ÜFE in the live payload's shape; an empty ÜFE store must not hide TÜFE
        "ufe_latest": _latest_inflation(ufe_history[0], "UFE") if ufe_history else None,
        "ufe_history": ufe_history,
    }


async def _write_through_inflation(session: AsyncSession, payload: dict[str, Any]) -> None:
    rows: list[ObservationRow] = []
    for series, key in (("tuik.cpi", "tufe_history"), ("tuik.ppi", "ufe_history")):
        for entry in payload.get(key) or []:
            day = _parse_iso_date(entry.get("Date"))
            if day is None:
                continue
            if entry.get("YearlyInflation") is not None:
                rows.append(ObservationRow(f"{series}.yoy", day, _decimal(entry["YearlyInflation"]), "tuik"))
            if entry.get("MonthlyInflation") is not None:
                rows.append(ObservationRow(f"{series}.mom", day, _decimal(entry["MonthlyInflation"]), "tuik"))
    if rows:
        await MacroRepository(session).upsert_observations(rows)
        await session.commit()


async def get_inflation_store_first(session: AsyncSession) -> dict[str, Any]:
    """Store-first replacement for ``src.adapters.macro.get_inflation()``: TÜFE plus ÜFE
    (``ufe_latest``/``ufe_history``, both ingested by :func:`ingest_inflation`); freshness
    follows the TÜFE series."""
    now = utcnow()
    history, oldest_fetched_at = await _store_inflation_history(session)
    ufe_history, _ = await _store_inflation_history(session, "tuik.ppi") if history else ([], None)
    max_age = timedelta(hours=settings.macro_max_age_inflation_hours)
    if history and oldest_fetched_at is not None and (now - oldest_fetched_at) <= max_age:
        payload = _inflation_payload_from_history(history, ufe_history)
        return with_meta(
            payload,
            DataMeta(
                source="tuik", source_url=payload["source_url"], as_of=payload["as_of"], fetched_at=oldest_fetched_at, served_from="store"
            ),
        )
    live = await _call_live(macro_adapter.get_inflation(), _MSG_INFLATION)
    if upstream_failure(live) is None:
        await _write_through_inflation(session, live)
        return with_meta(
            live,
            DataMeta(source="tuik", source_url=live.get("source_url"), as_of=live.get("as_of"), fetched_at=now, served_from="live"),
        )
    if history:
        payload = _inflation_payload_from_history(history, ufe_history)
        return with_meta(
            payload,
            DataMeta(
                source="tuik",
                source_url=payload["source_url"],
                as_of=payload["as_of"],
                fetched_at=oldest_fetched_at or now,
                served_from="stale",
                stale=True,
                notes=[_STALE_NOTE],
            ),
        )
    return live


async def _fx_payload_from_store(repo: MacroRepository, code: str, latest_row: FxBulletin) -> dict[str, Any]:
    since = latest_row.bulletin_date - timedelta(days=_FX_HISTORY_DAYS)
    rows = await repo.fx_history(code, since=since, ascending=True)
    closes: list[tuple[str, float]] = [
        (r.bulletin_date.isoformat(), float(r.forex_selling)) for r in rows if r.forex_selling is not None
    ]
    history: list[dict[str, Any]] = [{"Date": d, "Close": c} for d, c in closes]
    last = float(latest_row.forex_selling) if latest_row.forex_selling is not None else None
    previous = closes[-2][1] if len(closes) >= 2 else None
    change = round(last - previous, 6) if (last is not None and previous is not None) else None
    info = {
        "currency": code,
        "unit": 1,
        "quoted_unit": latest_row.quoted_unit,
        "name": _CURRENCY_NAMES.get(code, code),
        "forex_buying": float(latest_row.forex_buying) if latest_row.forex_buying is not None else None,
        "forex_selling": last,
        "banknote_buying": float(latest_row.banknote_buying) if latest_row.banknote_buying is not None else None,
        "banknote_selling": float(latest_row.banknote_selling) if latest_row.banknote_selling is not None else None,
        "last": last,
        "close": last,
        "update_time": latest_row.bulletin_date.isoformat(),
        "previous_close": previous,
        "change": change,
        "change_percent": round(change / previous * 100, 4) if (change is not None and previous) else None,
    }
    return {
        "currency": code,
        "source": "TCMB",
        "source_url": TCMB_FX_PAGE_URL,
        "rate_type": "forex_selling",
        "as_of": latest_row.bulletin_date.isoformat(),
        "info": info,
        "history": history,
    }


async def _write_through_fx(session: AsyncSession, payload: dict[str, Any]) -> None:
    info = payload.get("info") or {}
    day = _parse_iso_date(payload.get("as_of") or info.get("update_time"))
    code = payload.get("currency")
    if day is None or not code:
        return
    row = FxBulletinRow(
        bulletin_date=day,
        currency=code,
        quoted_unit=int(info.get("quoted_unit") or 1),
        forex_buying=_decimal_or_none(info.get("forex_buying")),
        forex_selling=_decimal_or_none(info.get("forex_selling")),
        banknote_buying=_decimal_or_none(info.get("banknote_buying")),
        banknote_selling=_decimal_or_none(info.get("banknote_selling")),
        source="tcmb",
    )
    await MacroRepository(session).upsert_fx_bulletins([row])
    await session.commit()


async def get_fx_store_first(session: AsyncSession, currency: str = "USD") -> dict[str, Any]:
    """Store-first replacement for ``src.adapters.macro.get_fx_rates()``.

    When TCMB is unreachable, ``get_fx_rates()`` itself already falls back to a
    TradingView market rate (no ``rate_type``/``source=="TCMB"`` in the payload);
    that shape is passed through as ``served_from="live"`` but is never written
    into ``fx_bulletins`` (it is not an official bulletin fixing).
    """
    code = (currency or "").strip().upper()
    if not _CURRENCY_RE.fullmatch(code):
        exc = InvalidInputError("Geçersiz döviz kodu. 3 harfli ISO kodu kullanın (örn. USD, EUR).")
        return {"currency": code, "info": {}, "history": [], **error_payload(exc, _MSG_FX)}
    if code == "TRY":
        exc = InvalidInputError("TRY için kur sorgulanamaz; başka bir döviz kodu kullanın.")
        return {"currency": code, "info": {}, "history": [], **error_payload(exc, _MSG_FX)}

    now = utcnow()
    repo = MacroRepository(session)
    latest_row = await repo.latest_fx(code)
    if latest_row is not None and (now - latest_row.fetched_at) <= _fx_max_age(now):
        payload = await _fx_payload_from_store(repo, code, latest_row)
        return with_meta(
            payload,
            DataMeta(source="tcmb", source_url=TCMB_FX_PAGE_URL, as_of=payload["as_of"], fetched_at=latest_row.fetched_at, served_from="store"),
        )

    live = await _call_live(macro_adapter.get_fx_rates(code), _MSG_FX)
    if upstream_failure(live) is None:
        is_official = live.get("rate_type") == "forex_selling" and live.get("source") == "TCMB"
        notes = []
        if is_official:
            await _write_through_fx(session, live)
            meta_source, meta_url = "tcmb", live.get("source_url")
        else:
            meta_source, meta_url = str(live.get("source") or "tradingview"), None
            notes = [str(live.get("warning"))] if live.get("warning") else []
        as_of = live.get("as_of") or (live.get("info") or {}).get("update_time")
        return with_meta(
            live, DataMeta(source=meta_source, source_url=meta_url, as_of=as_of, fetched_at=now, served_from="live", notes=notes)
        )

    if latest_row is not None:
        payload = await _fx_payload_from_store(repo, code, latest_row)
        return with_meta(
            payload,
            DataMeta(
                source="tcmb",
                source_url=TCMB_FX_PAGE_URL,
                as_of=payload["as_of"],
                fetched_at=latest_row.fetched_at,
                served_from="stale",
                stale=True,
                notes=[_STALE_NOTE],
            ),
        )
    return live


# ---------------------------------------------------------------------------
# Accuracy checks (WS4 report item 5) — writes data_quality_checks
# ---------------------------------------------------------------------------

def _as_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(f):
        return None
    return Decimal(str(round(f, 6)))


async def _check_rate_vs_borsapy(session: AsyncSession, rate_type: str, check_name: str) -> dict[str, Any]:
    try:
        ours = await tcmb_adapter.fetch_rate_history(rate_type)
        import borsapy as bp

        tcmb = await run_sync(bp.TCMB)
        their_df = await run_sync(tcmb.history, rate_type)
    except Exception as e:
        details: dict[str, Any] = {"error": f"{type(e).__name__}: {e}"}
        session.add(DataQualityCheck(check_name=check_name, subject=rate_type, status="fail", details_json=details))
        return {"check_name": check_name, "status": "fail", **details}

    ours_by_date = {o.observation_date: o for o in ours}
    their_by_date: dict[date, Any] = {}
    for ts, row in their_df.iterrows():
        d = ts.date() if hasattr(ts, "date") else ts
        their_by_date[d] = row
    common = sorted(set(ours_by_date) & set(their_by_date))

    max_dev = Decimal("0")
    mismatches = 0
    compared = 0
    for d in common:
        ours_row = ours_by_date[d]
        their_row = their_by_date[d]
        for leg, our_val in (("borrowing", ours_row.borrowing), ("lending", ours_row.lending)):
            their_val = _as_decimal(their_row.get(leg) if hasattr(their_row, "get") else None)
            compared += 1
            if our_val is None and their_val is None:
                continue
            if our_val is None or their_val is None:
                mismatches += 1
                continue
            dev = abs(our_val - their_val)
            max_dev = max(max_dev, dev)
            if dev > Decimal("0.01"):
                mismatches += 1

    status = "pass" if mismatches == 0 else ("warn" if mismatches <= 2 else "fail")
    details = {
        "dates_compared": len(common),
        "values_compared": compared,
        "mismatches": mismatches,
        "max_deviation_pp": str(max_dev),
        "our_row_count": len(ours),
        "borsapy_row_count": int(len(their_df)),
    }
    session.add(DataQualityCheck(check_name=check_name, subject=rate_type, status=status, deviation=max_dev, details_json=details))
    return {"check_name": check_name, "status": status, **details}


async def _check_cpi_vs_borsapy(session: AsyncSession) -> dict[str, Any]:
    check_name = "macro.cpi_tcmb_vs_borsapy"
    try:
        ours = await tcmb_adapter.fetch_cpi_history()
        import borsapy as bp

        inflation = await run_sync(bp.Inflation)
        their_df = await run_sync(inflation.tufe)
    except Exception as e:
        details: dict[str, Any] = {"error": f"{type(e).__name__}: {e}"}
        session.add(DataQualityCheck(check_name=check_name, subject="tuik.cpi", status="fail", details_json=details))
        return {"check_name": check_name, "status": "fail", **details}

    their_by_ym = {r.get("YearMonth"): r for r in df_to_records(their_df)}
    ours_recent = ours[:12]  # newest-first already
    max_dev = Decimal("0")
    mismatches = 0
    compared = 0
    for o in ours_recent:
        their_row = their_by_ym.get(o.year_month)
        if their_row is None:
            mismatches += 1
            continue
        for field, our_val in (("YearlyInflation", o.yoy), ("MonthlyInflation", o.mom)):
            their_val = _as_decimal(their_row.get(field))
            compared += 1
            if our_val is None and their_val is None:
                continue
            if our_val is None or their_val is None:
                mismatches += 1
                continue
            dev = abs(our_val - their_val)
            max_dev = max(max_dev, dev)
            if dev > Decimal("0.01"):
                mismatches += 1

    status = "pass" if mismatches == 0 else ("warn" if mismatches <= 2 else "fail")
    details = {"months_compared": len(ours_recent), "values_compared": compared, "mismatches": mismatches, "max_deviation_pp": str(max_dev)}
    session.add(DataQualityCheck(check_name=check_name, subject="tuik.cpi", status=status, deviation=max_dev, details_json=details))
    return {"check_name": check_name, "status": status, **details}


async def _check_usdtry_vs_tradingview(session: AsyncSession) -> dict[str, Any]:
    check_name = "macro.usdtry_bulletin_vs_tv"
    try:
        bulletins = await tcmb_adapter.fetch_fx_backfill(30, concurrency=settings.macro_fx_archive_concurrency)
        import borsapy as bp

        fx = await run_sync(lambda: bp.FX("USD"))
        tv_history = await run_sync(lambda: fx.history(period="1mo"))
    except Exception as e:
        details: dict[str, Any] = {"error": f"{type(e).__name__}: {e}"}
        session.add(DataQualityCheck(check_name=check_name, subject="USDTRY", status="fail", details_json=details))
        return {"check_name": check_name, "status": "fail", **details}

    tv_by_date: dict[str, float] = {}
    for r in df_to_records(tv_history):
        day = str(r.get("Date") or r.get("date") or r.get("index") or "")[:10]
        close = r.get("Close") if r.get("Close") is not None else r.get("close")
        if day and close is not None:
            tv_by_date[day] = float(close)

    spreads: list[float] = []
    for bulletin in bulletins[-20:]:
        usd = bulletin.rates.get("USD")
        if not usd or usd.get("forex_selling") is None:
            continue
        tv_close = tv_by_date.get(bulletin.bulletin_date.isoformat())
        if tv_close is None:
            continue
        spreads.append(float(usd["forex_selling"]) - tv_close)

    if not spreads:
        details = {"days_compared": 0, "note": "TradingView ile ortak tarih bulunamadı"}
        session.add(DataQualityCheck(check_name=check_name, subject="USDTRY", status="warn", details_json=details))
        return {"check_name": check_name, "status": "warn", **details}

    avg_spread = sum(spreads) / len(spreads)
    max_abs = max(abs(s) for s in spreads)
    status = "pass" if max_abs < 1.0 else "warn"
    details = {
        "days_compared": len(spreads),
        "avg_spread_try": round(avg_spread, 4),
        "max_abs_spread_try": round(max_abs, 4),
        "note": "TCMB ~15:30 sabit kuru ile TradingView günlük kapanışı arasında fark beklenir.",
    }
    session.add(
        DataQualityCheck(
            check_name=check_name, subject="USDTRY", status=status, deviation=Decimal(str(round(max_abs, 6))), details_json=details
        )
    )
    return {"check_name": check_name, "status": status, **details}


async def run_accuracy_checks(session: AsyncSession) -> list[dict[str, Any]]:
    """WS4 report item 5: (a) rate+corridor vs borsapy, (b) CPI vs borsapy, (c) USD/TRY
    bulletin vs TradingView. Writes one ``data_quality_checks`` row per comparison."""
    results = [
        await _check_rate_vs_borsapy(session, "policy", "macro.policy_rate_tcmb_vs_borsapy"),
        await _check_rate_vs_borsapy(session, "overnight", "macro.overnight_tcmb_vs_borsapy"),
        await _check_rate_vs_borsapy(session, "late_liquidity", "macro.late_liquidity_tcmb_vs_borsapy"),
        await _check_cpi_vs_borsapy(session),
        await _check_usdtry_vs_tradingview(session),
    ]
    await session.commit()
    return results
