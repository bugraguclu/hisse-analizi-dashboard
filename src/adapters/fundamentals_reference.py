"""Referans verisi — temettü, analist önerileri, ortaklık yapısı, hedef fiyat, KAP takvimi ve bildirimleri — bkz. ``src.adapters.fundamentals``."""

import json
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

import structlog

from src.adapters.financial_adapter import (
    to_number,
)
from src.adapters.utils import (
    MarketDataError,
    cached,
    df_to_records,
    finite_float,
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
        day = datetime.fromtimestamp(stamp / 1000, tz=UTC).date()  # see _epoch_day
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


# ---------------------------------------------------------------------------
# Store-first building blocks (data platform, see src.services.reference_service)
# ---------------------------------------------------------------------------
# Normalised records are what the ``dividends`` / ``capital_increases`` /
# ``shareholders`` / ``analyst_targets`` / ``expected_disclosures`` tables hold.
# The legacy JSON of every endpoint is rebuilt from these records by the
# ``*_payload`` helpers, for live and stored data alike, so a response served from
# the store is identical to the one served live.

SOURCE_ISYATIRIM = "isyatirim"
SOURCE_HEDEFFIYAT = "hedeffiyat"
SOURCE_KAP = "kap"
ISYATIRIM_CARD_URL = "https://www.isyatirim.com.tr/tr-tr/analiz/hisse/Sayfalar/sirket-karti.aspx?hisse={ticker}"
HEDEFFIYAT_URL = "https://www.hedeffiyat.com.tr"

# Legacy ``source`` labels of the endpoints (kept verbatim for compatibility).
LABEL_ISYATIRIM = "İş Yatırım (borsapy)"
LABEL_TARGETS = "İş Yatırım analist konsensüsü (borsapy)"
LABEL_EARNINGS = "KAP beklenen bildirim takvimi (borsapy)"

# İş Yatırım "sermaye" record types → capital_increases.kind (04 = cash dividend,
# 79/90/99 are administrative records).
CAPITAL_INCREASE_KINDS = {"01": "rights", "02": "bonus", "03": "rights_bonus", "07": "private", "09": "bonus"}
_MIN_CORPORATE_ACTION_DATE = date(1980, 1, 1)


def to_decimal(value: Any, places: int) -> Decimal | None:
    """Finite ``value`` rounded (half away from zero, like PostgreSQL NUMERIC) to ``places``."""
    number = finite_float(value)
    if number is None:
        return None
    quantum = Decimal(1).scaleb(-places)
    return Decimal(repr(number)).quantize(quantum, rounding=ROUND_HALF_UP)


def _as_float(value: Decimal | float | None) -> float | None:
    return float(value) if value is not None else None


def _epoch_day(value: Any) -> date | None:
    """İş Yatırım epoch milliseconds → calendar day.

    Recent stamps are UTC midnight of the day; stamps before ~2007 sit at 23:00 UTC
    of the same day (BIMAS 2006-04-19, AKBNK 1997-03-27), so converting to Istanbul
    time pushed those one day forward. The UTC date is right for both kinds.
    """
    stamp = to_number(value)
    if not stamp:
        return None
    try:
        day = datetime.fromtimestamp(stamp / 1000, tz=UTC).date()
    except (OverflowError, OSError, ValueError):
        return None
    return day if day >= _MIN_CORPORATE_ACTION_DATE else None


@dataclass(frozen=True)
class DividendRecord:
    ex_date: date
    gross_rate_pct: Decimal          # % of the 1 TL nominal share (0 when the source has none)
    net_rate_pct: Decimal | None
    total_amount: Decimal | None

    @property
    def gross_per_share(self) -> Decimal:
        return (self.gross_rate_pct / 100).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)

    @property
    def net_per_share(self) -> Decimal | None:
        if self.net_rate_pct is None:
            return None
        return (self.net_rate_pct / 100).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class CapitalIncreaseRecord:
    event_date: date
    kind: str
    bonus_rate_pct: Decimal | None
    rights_rate_pct: Decimal | None
    rights_price: Decimal | None
    capital_before: Decimal | None
    capital_after: Decimal | None


@dataclass(frozen=True)
class RecommendationRecord:
    recommendation: str | None
    target_price: Decimal | None
    upside_pct: Decimal | None
    as_of: date | None


@dataclass(frozen=True)
class HolderRecord:
    name: str
    share_pct: Decimal | None


@dataclass(frozen=True)
class PriceTargetRecord:
    low: Decimal | None
    high: Decimal | None
    mean: Decimal | None
    analysts: int | None

    @property
    def has_targets(self) -> bool:
        # hedeffiyat.com.tr kapsam dışı hisselerde "0,00 ₺ (%-100)" basar: sıfırlar hedef değildir.
        return any(v is not None and v != 0 for v in (self.low, self.high, self.mean))


@dataclass(frozen=True)
class SermayeBundle:
    dividends: list[DividendRecord]
    capital_increases: list[CapitalIncreaseRecord]
    recommendation: RecommendationRecord | None


def dividend_records(items: Sequence[Mapping[str, Any]]) -> list[DividendRecord]:
    """Cash dividends (type ``04``) keyed like the ``dividends`` table, newest first."""
    records: dict[tuple[date, Decimal], DividendRecord] = {}
    for item in items:
        if str(item.get("SHT_KODU", "")) != "04":
            continue
        day = _epoch_day(item.get("SHHE_TARIH"))
        if day is None:
            continue
        gross = to_decimal(to_number(item.get("SHHE_NAKIT_TM_ORAN")) or 0.0, 4) or Decimal("0.0000")
        records[(day, gross)] = DividendRecord(
            ex_date=day,
            gross_rate_pct=gross,
            net_rate_pct=to_decimal(item.get("SHHE_NAKIT_TM_ORAN_NET"), 4),
            total_amount=to_decimal(item.get("SHHE_NAKIT_TM_TUTAR"), 2),
        )
    return sort_dividends(records.values())


def sort_dividends(records: Iterable[DividendRecord]) -> list[DividendRecord]:
    return sorted(records, key=lambda r: (r.ex_date, r.gross_rate_pct), reverse=True)


def dividends_payload_rows(records: Iterable[DividendRecord]) -> list[dict[str, Any]]:
    """Legacy ``/dividends`` rows (``Date``/``Amount``/``GrossRate``/``NetRate``/``TotalDividend``)."""
    rows = []
    for r in sort_dividends(records):
        gross = float(r.gross_rate_pct)
        rows.append({
            "Date": f"{r.ex_date.isoformat()}T00:00:00",
            "Amount": round(gross / 100, 4),
            "GrossRate": round(gross, 2),
            "NetRate": round(float(r.net_rate_pct or 0), 2),
            "TotalDividend": _as_float(r.total_amount),
        })
    return rows


def capital_increase_records(items: Sequence[Mapping[str, Any]]) -> list[CapitalIncreaseRecord]:
    """Rights / bonus / private-placement records; same-day records of one kind are merged."""
    merged: dict[tuple[date, str], dict[str, Any]] = {}
    seen: set[tuple[Any, ...]] = set()
    for item in items:
        kind = CAPITAL_INCREASE_KINDS.get(str(item.get("SHT_KODU", "")))
        day = _epoch_day(item.get("SHHE_TARIH"))
        if kind is None or day is None:
            continue
        bonus = sum(to_number(item.get(k)) or 0.0 for k in ("SHHE_BDSZ_IK_ORAN", "SHHE_BDSZ_TM_ORAN", "SHHE_BDSZ_BU_ORAN"))
        rights = (to_number(item.get("SHHE_BDLI_ORAN")) or 0.0) + (to_number(item.get("SHHE_RHK_ORAN")) or 0.0)
        before = to_number(item.get("HSP_BOLUNME_ONCESI_SERMAYE"))
        after = to_number(item.get("HSP_BOLUNME_SONRASI_SERMAYE"))
        fingerprint = (day, kind, bonus, rights, before, after)
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        entry = merged.setdefault((day, kind), {"bonus": 0.0, "rights": 0.0, "before": [], "after": []})
        entry["bonus"] += bonus
        entry["rights"] += rights
        if before:
            entry["before"].append(before)
        if after:
            entry["after"].append(after)
    records = [
        CapitalIncreaseRecord(
            event_date=day,
            kind=kind,
            bonus_rate_pct=to_decimal(entry["bonus"], 4) if entry["bonus"] else None,
            rights_rate_pct=to_decimal(entry["rights"], 4) if entry["rights"] else None,
            rights_price=None,  # İş Yatırım publishes the nominal amount, not the subscription price
            capital_before=to_decimal(min(entry["before"]), 2) if entry["before"] else None,
            capital_after=to_decimal(max(entry["after"]), 2) if entry["after"] else None,
        )
        for (day, kind), entry in merged.items()
    ]
    return sorted(records, key=lambda r: (r.event_date, r.kind), reverse=True)


def recommendation_record(items: Sequence[Mapping[str, Any]]) -> RecommendationRecord | None:
    """İş Yatırım's own research call (repeated on every "sermaye" record).

    Unlike the legacy payload builder, a missing target never yields a fabricated
    ``0.0`` upside: İş Yatırım sends ``GETIRI_POT = 0`` for uncovered companies.
    """
    for item in items:
        recommendation = item.get("ONERI")
        target = to_number(item.get("HEDEF_FIYAT"))
        if not recommendation and not target:
            continue
        upside = to_number(item.get("GETIRI_POT")) if target else None
        return RecommendationRecord(
            recommendation=str(recommendation)[:30] if recommendation else None,
            target_price=to_decimal(target, 4) if target else None,
            upside_pct=to_decimal(upside * 100, 4) if upside is not None else None,
            as_of=_epoch_day(item.get("TARIH")),
        )
    return None


def recommendations_payload(record: RecommendationRecord | None) -> dict[str, Any]:
    """Legacy ``/recommendations`` body (without ``ticker``)."""
    result: dict[str, Any] = {"recommendation": None, "target_price": None, "upside_potential": None}
    if record is not None:
        result["recommendation"] = record.recommendation
        if record.target_price is not None:
            result["target_price"] = round(float(record.target_price), 2)
        if record.upside_pct is not None:
            result["upside_potential"] = round(float(record.upside_pct), 2)
    available = any(v is not None for v in result.values())
    result["date"] = record.as_of.isoformat() if record is not None and record.as_of else None
    return {"source": LABEL_ISYATIRIM, "source_code": SOURCE_ISYATIRIM, "recommendations": result, "available": available}


def holders_payload_rows(records: Iterable[HolderRecord]) -> list[dict[str, Any]]:
    """Legacy ``/holders`` rows in the provider's order."""
    return [
        {"Holder": r.name, "Percentage": round(float(r.share_pct), 2) if r.share_pct is not None else None}
        for r in records
    ]


def targets_payload(record: PriceTargetRecord | None, current: float | None) -> dict[str, Any]:
    """Legacy ``/price-targets`` body; ``median`` is borsapy's low/high midpoint (hedeffiyat has none)."""
    low = _as_float(record.low) if record is not None else None
    high = _as_float(record.high) if record is not None else None
    targets: dict[str, Any] = {
        "current": current if current is not None and current > 0 else None,
        "low": low,
        "high": high,
        "mean": _as_float(record.mean) if record is not None else None,
        "median": round((low + high) / 2, 2) if low is not None and high is not None else None,
        "numberOfAnalysts": record.analysts if record is not None else None,
    }
    analysts = record.analysts if record is not None else None
    available = record is not None and record.has_targets and (analysts is None or analysts > 0)
    return {"source": LABEL_TARGETS, "targets": targets, "available": available}


def earnings_payload_rows(records: Iterable[Any], today: date) -> list[dict[str, Any]]:
    """Legacy ``/earnings-dates`` rows: financial-report window ends, oldest first.

    ``records`` are :class:`src.adapters.bist_reference.ExpectedDisclosureRecord`
    (or rows with the same attributes); only windows still open on ``today`` and
    starting within the 180-day query horizon are included, as KAP answers live.
    """
    from src.adapters.bist_reference import EXPECTED_WINDOW_DAYS

    horizon = today + timedelta(days=EXPECTED_WINDOW_DAYS)
    ends = sorted(
        r.end_date
        for r in records
        if r.end_date is not None
        and "finansal rapor" in str(r.subject).casefold()
        and r.end_date >= today
        and (r.start_date is None or r.start_date <= horizon)
    )
    return [
        {"Earnings Date": f"{end.isoformat()}T00:00:00", "EPS Estimate": None, "Reported EPS": None, "Surprise(%)": None}
        for end in ends
    ]


async def fetch_sermaye(ticker: str) -> SermayeBundle:
    """Dividends, capital increases and İş Yatırım's recommendation from one "sermaye" call."""
    try:
        items = await _get_sermaye_items(ticker)
    except MarketDataError:
        raise
    except _UNREACHABLE_ERRORS as e:
        raise MarketDataError(_MSG_REFERENCE, status_code=503) from e
    except Exception as e:  # borsapy APIError wraps timeouts; unusable payloads are ValueError
        status = 503 if "timed out" in str(e).lower() or "connect" in str(e).lower() else 502
        raise MarketDataError(_MSG_REFERENCE, status_code=status) from e
    return SermayeBundle(
        dividends=dividend_records(items),
        capital_increases=capital_increase_records(items),
        recommendation=recommendation_record(items),
    )


def _holder_records_sync(ticker: str) -> list[HolderRecord]:
    from borsapy._providers.isyatirim import get_isyatirim_provider

    frame = get_isyatirim_provider().get_major_holders(ticker)
    records: list[HolderRecord] = []
    seen: set[str] = set()
    for row in df_to_records(frame):
        name = str(row.get("Holder") or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        records.append(HolderRecord(name=name[:300], share_pct=to_decimal(row.get("Percentage"), 4)))
    return records


async def fetch_holders(ticker: str) -> list[HolderRecord]:
    """İş Yatırım ownership structure (the legacy ``/holders`` source), provider order."""
    try:
        records: list[HolderRecord] = await run_sync(_holder_records_sync, ticker)
    except Exception as e:
        status = 503 if isinstance(e, _UNREACHABLE_ERRORS) or "timed out" in str(e).lower() else 502
        raise MarketDataError(_MSG_REFERENCE, status_code=status) from e
    return records


async def fetch_price_targets(ticker: str) -> PriceTargetRecord | None:
    """hedeffiyat.com.tr consensus (via borsapy). ``None`` when the page yields nothing.

    borsapy swallows transport errors and returns all-``None`` fields, so "no
    coverage" and "unreachable" look alike: callers must not overwrite a stored
    consensus with a ``None`` result.
    """
    try:
        raw = await _get_price_targets_raw(ticker)
    except Exception as e:
        raise MarketDataError(_MSG_REFERENCE, status_code=503) from e
    analysts = to_number(raw.get("numberOfAnalysts"))
    record = PriceTargetRecord(
        low=to_decimal(raw.get("low"), 4),
        high=to_decimal(raw.get("high"), 4),
        mean=to_decimal(raw.get("mean"), 4),
        analysts=int(analysts) if analysts is not None else None,
    )
    return record if record.has_targets or record.analysts else None


@cached(TTL_SNAPSHOT, "ref_current_price")
async def current_price(ticker: str) -> float:
    """Latest (15 min delayed) TradingView price — the ``current`` of ``/price-targets``."""
    from src.adapters.utils import tradingview_scan

    rows = await tradingview_scan([ticker], ("close",))
    price = to_number((rows.get(ticker) or {}).get("close"))
    if price is None or price <= 0:
        raise MarketDataError(_MSG_QUOTE, status_code=502)
    return price
