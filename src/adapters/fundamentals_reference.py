"""Referans verisi — temettü, analist önerileri, ortaklık yapısı, hedef fiyat, KAP takvimi ve bildirimleri — bkz. ``src.adapters.fundamentals``."""

import json
from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from typing import Any

import structlog

from src.adapters.financial_adapter import (
    to_number,
)
from src.adapters.utils import (
    cached,
    df_to_records,
    run_sync,
    safe_serialize,
)
from src.parsers.helpers import parse_date

from src.adapters.fundamentals_common import (  # noqa: F401
    ISTANBUL_TZ,
    TTL_SNAPSHOT,
    TTL_METRICS,
    TTL_STATEMENTS,
    TTL_REFERENCE,
    TTL_CALENDAR,
    TTL_DISCLOSURES,
    TTL_PROFILE,
    TTL_DIRECTORY,
    KAP_BASE_URL,
    KAP_BIST_COMPANIES_URL,
    _KAP_SUMMARY_PATH,
    _KAP_FINANCIAL_PATH,
    _TICKER_TOKEN_RE,
    _PERIOD_LABEL_RE,
    _SOURCE_KAP,
    _SOURCE_ISY,
    _QUARTERS_FETCHED,
    _MSG_STATEMENTS,
    _MSG_CASHFLOW,
    _MSG_RATIOS,
    _MSG_QUOTE,
    _MSG_REFERENCE,
    _today,
    _UNREACHABLE_ERRORS,
    _failure,
    _discard,
    _parse_kap_directory,
    get_kap_company_titles,
    _get_kap_directory,
    _kap_company,
    _require_listed,
)
from src.adapters.fundamentals_snapshot import _get_market_snapshot

logger = structlog.get_logger(__name__)



# ---------------------------------------------------------------------------
# Reference data (dividends, capital increases, recommendations, holders, targets)
# ---------------------------------------------------------------------------

@cached(TTL_REFERENCE, "fund_sermaye")
async def _get_sermaye_items(ticker: str) -> list[dict[str, Any]]:
    """İş Yatırım "sermaye artırımları" records.

    One (slow, ~10 s server-side) call serves dividends, capital increases and
    the analyst recommendation; borsapy would issue it once per property.
    """
    from borsapy._providers.isyatirim import get_isyatirim_provider

    payload = await run_sync(get_isyatirim_provider()._fetch_sermaye_data, ticker)
    raw = payload.get("d", "[]") if isinstance(payload, dict) else None
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError as e:
            raise ValueError("Beklenmeyen sermaye verisi biçimi") from e
    if not isinstance(raw, list):
        raise ValueError("Beklenmeyen sermaye verisi biçimi")
    return [item for item in raw if isinstance(item, dict)]


def _dividend_records(items: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Cash dividends (type ``04``), newest first.

    Dates are epoch milliseconds at Istanbul midnight; they are converted in
    Europe/Istanbul explicitly (borsapy uses the host time zone, which shifts
    the day by one on UTC servers).
    """
    records: dict[tuple[str, float, float], dict[str, Any]] = {}
    for item in items:
        if str(item.get("SHT_KODU", "")) != "04":
            continue
        stamp = to_number(item.get("SHHE_TARIH"))
        if not stamp:
            continue
        day = datetime.fromtimestamp(stamp / 1000, tz=ISTANBUL_TZ).date()
        gross_rate = to_number(item.get("SHHE_NAKIT_TM_ORAN")) or 0.0
        net_rate = to_number(item.get("SHHE_NAKIT_TM_ORAN_NET")) or 0.0
        total = to_number(item.get("SHHE_NAKIT_TM_TUTAR"))
        key = (day.isoformat(), gross_rate, total or 0.0)
        records[key] = {
            "Date": f"{day.isoformat()}T00:00:00",
            # Rates are % of the 1 TL nominal share → TL per share.
            "Amount": round(gross_rate / 100, 4),
            "GrossRate": round(gross_rate, 2),
            "NetRate": round(net_rate, 2),
            "TotalDividend": total,
        }
    return sorted(records.values(), key=lambda r: r["Date"], reverse=True)


@cached(TTL_REFERENCE, "fund")
async def get_dividends(ticker: str) -> dict:
    """Nakit temettü geçmişi (TL/pay). Hiç temettü yoksa boş liste + ``available: true``."""
    try:
        await _require_listed(ticker)
        items = await _get_sermaye_items(ticker)
        return {
            "ticker": ticker,
            "source": "İş Yatırım (borsapy)",
            "dividends": _dividend_records(items),
            "available": True,
        }
    except Exception as e:
        return _failure(e, _MSG_REFERENCE, "fundamentals_dividends_error", ticker, dividends=[])


@cached(TTL_REFERENCE, "fund")
async def get_recommendations(ticker: str) -> dict:
    try:
        await _require_listed(ticker)
        items = await _get_sermaye_items(ticker)
        result: dict[str, Any] = {"recommendation": None, "target_price": None, "upside_potential": None}
        for item in items:
            recommendation = item.get("ONERI")
            target = to_number(item.get("HEDEF_FIYAT"))
            upside = to_number(item.get("GETIRI_POT"))
            if recommendation:
                result["recommendation"] = str(recommendation)
            if target:
                result["target_price"] = round(target, 2)
            if upside is not None:
                result["upside_potential"] = round(upside * 100, 2)
            if recommendation or target:
                break
        available = any(v is not None for v in result.values())
        return {
            "ticker": ticker,
            "source": "İş Yatırım (borsapy)",
            "recommendations": result,
            "available": available,
        }
    except Exception as e:
        return _failure(e, _MSG_REFERENCE, "fundamentals_recommendations_error", ticker, recommendations={})


@cached(TTL_REFERENCE, "fund")
async def get_major_holders(ticker: str) -> dict:
    try:
        await _require_listed(ticker)
        from borsapy._providers.isyatirim import get_isyatirim_provider

        df = await run_sync(get_isyatirim_provider().get_major_holders, ticker)
        records = df_to_records(df)
        return {"ticker": ticker, "source": "İş Yatırım (borsapy)", "holders": records, "available": bool(records)}
    except Exception as e:
        return _failure(e, _MSG_REFERENCE, "fundamentals_holders_error", ticker, holders=[])


@cached(TTL_REFERENCE, "fund_targets_raw")
async def _get_price_targets_raw(ticker: str) -> dict[str, Any]:
    import borsapy as bp

    def _load() -> Any:
        return bp.Ticker(ticker).analyst_price_targets

    result = safe_serialize(await run_sync(_load))
    return dict(result) if isinstance(result, dict) else {}


@cached(TTL_SNAPSHOT, "fund")
async def get_analyst_price_targets(ticker: str) -> dict:
    try:
        await _require_listed(ticker)
        targets = dict(await _get_price_targets_raw(ticker))
        try:
            snapshot = await _get_market_snapshot(ticker)
            if to_number(snapshot.get("last_price")) is not None:
                targets["current"] = snapshot["last_price"]
        except Exception as e:
            logger.warning("price_target_current_price_failed", ticker=ticker, error=f"{type(e).__name__}: {e}")
        current = to_number(targets.get("current"))
        if current is None or current <= 0:
            targets["current"] = None
        analysts = to_number(targets.get("numberOfAnalysts"))
        available = any(to_number(targets.get(k)) is not None for k in ("low", "high", "mean", "median")) and (
            analysts is None or analysts > 0
        )
        return {
            "ticker": ticker,
            "source": "İş Yatırım analist konsensüsü (borsapy)",
            "targets": targets,
            "available": available,
        }
    except Exception as e:
        return _failure(e, _MSG_REFERENCE, "fundamentals_targets_error", ticker, targets={})


# ---------------------------------------------------------------------------
# Calendars & disclosures — upstreams that may legitimately be empty/dead
# ---------------------------------------------------------------------------

@cached(TTL_CALENDAR, "fund_earnings_raw")
async def _fetch_earnings_dates(ticker: str) -> list[dict[str, Any]]:
    """Raises on upstream failure, so only real answers (possibly empty) are cached."""
    import borsapy as bp

    def _load() -> Any:
        return bp.Ticker(ticker).earnings_dates

    result = await run_sync(_load)
    records = df_to_records(result) if hasattr(result, "iterrows") else safe_serialize(result)
    return records if isinstance(records, list) else []


async def get_earnings_dates(ticker: str) -> dict:
    """KAP beklenen finansal rapor tarihleri. Boş/erişilemez kaynak hata değil, ``available: false``."""
    base = {"ticker": ticker, "source": "KAP beklenen bildirim takvimi (borsapy)"}
    try:
        await _require_listed(ticker)
    except Exception as e:
        return _failure(e, _MSG_REFERENCE, "fundamentals_earnings_error", ticker, earnings_dates=[])
    try:
        data = await _fetch_earnings_dates(ticker)
    except Exception as e:
        logger.warning("fundamentals_earnings_unavailable", ticker=ticker, error=f"{type(e).__name__}: {e}")
        data = []
    return {**base, "earnings_dates": data, "available": bool(data)}


def _disclosure_published_at(value: Any) -> str | None:
    """KAP's ``GG.AA.YYYY SS:DD:ss`` (Istanbul local) → ISO-8601 in UTC."""
    parsed = parse_date(str(value)) if value else None
    return parsed.astimezone(timezone.utc).isoformat() if parsed else None


def _disclosure_records(records: Sequence[Mapping[str, Any]], limit: int) -> list[dict[str, Any]]:
    """De-duplicated (by URL) disclosures with an ISO-8601 UTC ``published_at``."""
    seen: set[str] = set()
    news: list[dict[str, Any]] = []
    for record in records:
        key = str(record.get("URL") or record.get("Title") or "")
        if not key or key in seen:
            continue
        seen.add(key)
        news.append({**record, "published_at": _disclosure_published_at(record.get("Date"))})
        if len(news) >= limit:
            break
    return news


@cached(TTL_DISCLOSURES, "fund_disclosures_raw")
async def _fetch_disclosures(ticker: str) -> list[dict[str, Any]]:
    """Raises on upstream failure, so only real answers (possibly empty) are cached."""
    import borsapy as bp

    def _load() -> Any:
        return bp.Ticker(ticker).news

    news_df = await run_sync(_load)
    return df_to_records(news_df) if hasattr(news_df, "iterrows") else []


async def get_live_news(ticker: str, limit: int = 10) -> dict:
    """Son KAP bildirimleri. Boş/erişilemez kaynak hata değil, ``available: false``."""
    base = {"ticker": ticker, "source": "KAP (borsapy)"}
    try:
        await _require_listed(ticker)
    except Exception as e:
        return _failure(e, _MSG_REFERENCE, "live_news_error", ticker, news=[])
    try:
        news = _disclosure_records(await _fetch_disclosures(ticker), limit)
    except Exception as e:
        logger.warning("live_news_unavailable", ticker=ticker, error=f"{type(e).__name__}: {e}")
        news = []
    return {**base, "news": news, "available": bool(news)}
