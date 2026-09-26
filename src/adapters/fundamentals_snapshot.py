"""Piyasa özeti (depo öncelikli TradingView kotasyonu + İş Yatırım şirket kartı) ve şirket künyesi — bkz. ``src.adapters.fundamentals``."""

import asyncio
from collections.abc import Mapping
from datetime import date, datetime
from typing import Any

import structlog

from src.adapters import price
from src.adapters.financial_adapter import (
    to_number,
)
from src.adapters.utils import (
    MarketDataError,
    SymbolNotFoundError,
    cached,
    run_sync,
    sanitize_data,
)
from src.core.meta import DataMeta
from src.services import market_service

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

logger = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# Live market snapshot (TradingView scanner + İş Yatırım OneEndeks + company card)
# ---------------------------------------------------------------------------
#
# Field sources (additive ``*_source`` fields and ``meta.notes`` say which one served):
# * volume / amount — İş Yatırım OneEndeks lots / TL turnover of the same session,
#   else TradingView ``volume`` / ``Value.Traded`` (close × lots);
# * shares / market_cap — paid-in capital (OneEndeks ``capital``, else
#   ``companies.paid_in_capital``) and last × capital, else the market-data estimate;
# * pb_ratio — market cap / latest-quarter parent equity, else TradingView
#   ``price_book_fq``; pe_ratio — TradingView ``price_earnings_ttm``;
# * updated_at — provider time capped at the session close, + ``session_state``.

_SNAPSHOT_COLUMNS = (
    "close",
    "open",
    "high",
    "low",
    "volume",
    "change",
    "change_abs",
    "Value.Traded",
    "description",
    "currency",
    "price_52_week_high",
    "price_52_week_low",
    "SMA50",
    "SMA200",
    "market_cap_basic",
    "total_shares_outstanding",
    "price_earnings_ttm",
    "price_book_fq",  # latest quarter — never price_book_ratio (fiscal-year-end equity)
)


def _round(value: Any, digits: int = 2) -> float | None:
    number = to_number(value)
    return round(number, digits) if number is not None else None


def _shares_outstanding(
    provider_market_cap: float | None,
    tradingview_market_cap: float | None,
    previous_close: float | None,
    last: float | None,
    reported_shares: float | None,
) -> float | None:
    """Market-data estimate of the share count — used only when the paid-in capital is unknown
    (see :func:`src.services.market_service.share_count`).

    İş Yatırım's company-card market cap uses the full paid-in capital, like
    Borsa İstanbul, but it is priced at the previous close during the session and
    at the day's close after its evening update — while TradingView's change
    (so ``previous_close``) and its own market cap still refer to the previous
    close until the next session. The İş Yatırım count is therefore taken at the
    price that reproduces TradingView's count; when neither price does (TradingView
    excludes treasury shares for some companies) the previous close is assumed.
    TradingView's share count is sometimes plainly wrong (KCHOL): last resort.
    """
    prev = previous_close if previous_close is not None and previous_close > 0 else None
    tv_shares = (
        tradingview_market_cap / prev
        if prev is not None and tradingview_market_cap is not None and tradingview_market_cap > 0
        else None
    )
    if prev is not None and provider_market_cap is not None and provider_market_cap > 0:
        candidates = [provider_market_cap / prev]
        if last is not None and last > 0 and last != prev:
            candidates.append(provider_market_cap / last)
        if tv_shares is not None:
            # İş Yatırım publishes the market cap in 0.1 mn TL steps.
            tolerance = max(1e-4, 1e5 / provider_market_cap)
            for shares in candidates:
                if abs(shares / tv_shares - 1) <= tolerance:
                    return float(round(shares))
        return float(round(candidates[0]))
    if tv_shares is not None:
        return float(round(tv_shares))
    if reported_shares is not None and reported_shares > 0:
        return float(round(reported_shares))
    return None


def _row_session_date(row: Mapping[str, Any]) -> date | None:
    stored = row.get("session_date")
    if isinstance(stored, date) and not isinstance(stored, datetime):
        return stored
    return price.session_date_from_epoch(row.get("time"))


def _snapshot_from_scan(
    row: Mapping[str, Any],
    metrics: Mapping[str, Any],
    *,
    official: Mapping[str, Any] | None = None,
    capital: market_service.CompanyCapital | None = None,
    stored_capital: float | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """fast-info block from a scanner row (+ İş Yatırım card ``metrics``, OneEndeks ``official``
    quote, the company's ``capital``/equity and ``companies.paid_in_capital``)."""
    last = to_number(row.get("close"))
    change_abs = to_number(row.get("change_abs"))
    previous_close = round(last - change_abs, 4) if last is not None and change_abs is not None else None
    high, low = to_number(row.get("high")), to_number(row.get("low"))
    session_date = _row_session_date(row)

    count = market_service.share_count(capital.capital if capital else None, stored_capital)
    if count.capital is not None:
        shares: float | None = count.shares
        shares_source: str | None = count.source
        market_cap = count.market_cap(last)
    else:
        shares = _shares_outstanding(
            to_number(metrics.get("market_cap")),
            to_number(row.get("market_cap_basic")),
            previous_close,
            last,
            to_number(row.get("total_shares_outstanding")),
        )
        shares_source = market_service.SHARES_SOURCE_MARKET if shares is not None else None
        market_cap = last * shares if last is not None and shares is not None else to_number(row.get("market_cap_basic"))
    pb_ratio, pb_source = market_service.price_to_book(
        market_cap if count.capital is not None else None,
        capital.equity if capital else None,
        row.get("price_book_fq"),
    )

    figures = market_service.official_session_figures(dict(official) if official else None, session_date)
    volume: float | None
    amount: float | None
    volume_source: str | None
    if figures is not None:
        volume, amount = figures
        volume_source = market_service.VOLUME_SOURCE_ISYATIRIM
    else:
        volume, amount = to_number(row.get("volume")), to_number(row.get("Value.Traded"))
        volume_source = market_service.VOLUME_SOURCE_TRADINGVIEW if volume is not None else None

    quote_time = price.cap_to_session_close(row.get("update_time"), session_date)
    year_high = to_number(row.get("price_52_week_high"))
    year_low = to_number(row.get("price_52_week_low"))
    if year_high is not None and high is not None:
        year_high = max(year_high, high)
    if year_low is not None and low is not None:
        year_low = min(year_low, low)
    return {
        "currency": row.get("currency") or "TRY",
        "exchange": "BIST",
        "timezone": "Europe/Istanbul",
        "last_price": last,
        "open": to_number(row.get("open")),
        "day_high": high,
        "day_low": low,
        "previous_close": previous_close,
        "volume": volume,
        "amount": amount,
        "market_cap": round(market_cap, 2) if market_cap is not None else None,
        "shares": shares,
        "pe_ratio": _round(row.get("price_earnings_ttm")),
        "pb_ratio": pb_ratio,
        "year_high": year_high,
        "year_low": year_low,
        "fifty_day_average": _round(row.get("SMA50")),
        "two_hundred_day_average": _round(row.get("SMA200")),
        "free_float": to_number(metrics.get("free_float")),
        "foreign_ratio": to_number(metrics.get("foreign_ratio")),
        # add-only
        "name": row.get("description"),
        "change": change_abs,
        "change_percent": _round(row.get("change")),
        "updated_at": datetime.fromtimestamp(quote_time, ISTANBUL_TZ).isoformat() if quote_time else None,
        "session_state": price.session_state(session_date, now),
        "volume_source": volume_source,
        "shares_source": shares_source,
        "pb_source": pb_source,
    }


_SOURCE_FIELDS = ("volume_source", "shares_source", "pb_source")


@cached(TTL_METRICS, "fund_metrics")
async def _get_company_metrics(ticker: str) -> dict[str, Any]:
    from borsapy._providers.isyatirim import get_isyatirim_provider

    metrics = await run_sync(get_isyatirim_provider().get_company_metrics, ticker)
    return dict(sanitize_data(metrics)) if isinstance(metrics, dict) else {}


async def _company_metrics_or_empty(ticker: str) -> dict[str, Any]:
    try:
        return await _get_company_metrics(ticker)
    except Exception as e:
        logger.warning("company_metrics_failed", ticker=ticker, error=f"{type(e).__name__}: {e}")
        return {}


@cached(TTL_SNAPSHOT, "fund_snapshot")
async def _market_snapshot(ticker: str) -> tuple[dict[str, Any], DataMeta]:
    """Store-first scanner row (quote + extras; see ``market_service.get_snapshot_row``) + company card
    + İş Yatırım OneEndeks (official lots / TL turnover, paid-in capital, parent equity)."""
    (row, meta), metrics, official, stored_capitals = await asyncio.gather(
        market_service.get_snapshot_row(ticker, _SNAPSHOT_COLUMNS),
        _company_metrics_or_empty(ticker),
        market_service.get_official_quote(ticker),
        market_service.get_paid_in_capitals(),
    )
    if not row or to_number(row.get("close")) is None:
        raise SymbolNotFoundError(ticker)
    snapshot = _snapshot_from_scan(
        row,
        metrics,
        official=official,
        capital=market_service.company_capital(ticker, official),
        stored_capital=(stored_capitals or {}).get(ticker),
    )
    sources = {key: snapshot.get(key) for key in _SOURCE_FIELDS}
    return snapshot, market_service.with_official_provenance(meta, sources) or meta


async def _get_market_snapshot(ticker: str) -> dict[str, Any]:
    return (await _market_snapshot(ticker))[0]


@cached(TTL_SNAPSHOT, "fund")
async def get_fast_info(ticker: str) -> dict:
    """Fiyat özeti (depo öncelikli): son fiyat, piyasa değeri (fiyat × pay adedi), F/K, PD/DD, 52 hafta."""
    try:
        snapshot, meta = await _market_snapshot(ticker)
        return {
            "ticker": ticker,
            "source": "TradingView + İş Yatırım",
            "fast_info": snapshot,
            **market_service.meta_dict(meta),
        }
    except Exception as e:
        return _failure(e, _MSG_QUOTE, "fundamentals_fast_info_error", ticker, fast_info={})


@cached(TTL_PROFILE, "fund_profile")
async def _get_company_profile(ticker: str) -> dict[str, Any]:
    from borsapy._providers.kap import get_kap_provider

    details = await run_sync(get_kap_provider().get_company_details, ticker)
    return dict(sanitize_data(details)) if isinstance(details, dict) else {}


async def _profile_or_empty(ticker: str) -> dict[str, Any]:
    try:
        return await _get_company_profile(ticker)
    except Exception as e:
        logger.warning("company_profile_failed", ticker=ticker, error=f"{type(e).__name__}: {e}")
        return {}


_YF_INFO_FIELDS = {
    "longName": "longName",
    "shortName": "name",
    "sector": "sector",
    "industry": "industry",
    "website": "website",
    "currency": "currency",
    "currentPrice": "last_price",
    "marketCap": "market_cap",
    "sharesOutstanding": "shares",
    "fiftyTwoWeekHigh": "year_high",
    "fiftyTwoWeekLow": "year_low",
}


async def _yfinance_info(ticker: str) -> dict[str, Any]:
    """Last-resort profile from Yahoo (``.IS``) when the primary quote feed is down."""
    import yfinance as yf

    raw = await run_sync(lambda: yf.Ticker(f"{ticker}.IS").info)
    if not isinstance(raw, dict):
        return {}
    info = {target: raw.get(source) for source, target in _YF_INFO_FIELDS.items() if raw.get(source) is not None}
    return dict(sanitize_data(info)) if len(info) >= 3 else {}


@cached(TTL_SNAPSHOT, "fund")
async def get_company_info(ticker: str) -> dict:
    """Şirket künyesi (KAP) + canlı fiyat özeti."""
    try:
        entry = await _kap_company(ticker)
        snapshot_task = asyncio.ensure_future(_market_snapshot(ticker))
        profile: dict[str, Any] = await _profile_or_empty(ticker)
        source = "Borsa İstanbul/TradingView/İş Yatırım/KAP"
        snapshot: dict[str, Any] = {}
        meta: DataMeta | None = None
        try:
            market, meta = await snapshot_task
            snapshot = dict(market)
        except SymbolNotFoundError:
            raise
        except Exception as e:
            logger.warning("company_info_snapshot_failed", ticker=ticker, error=f"{type(e).__name__}: {e}")
            try:
                snapshot = await _yfinance_info(ticker)
                source = "Yahoo Finance (yedek) + KAP"
            except Exception as fallback_error:
                logger.warning(
                    "company_info_yfinance_fallback_failed", ticker=ticker, error=f"{type(fallback_error).__name__}"
                )
            if not snapshot and not profile:
                raise MarketDataError(_MSG_QUOTE, status_code=503) from e

        info: dict[str, Any] = dict(snapshot)
        title = (entry or {}).get("title")
        if title:
            info["longName"] = title
            if not info.get("name"):
                info["name"] = title
        sector = profile.get("sector")
        if sector:
            info["sector"] = sector
            info.setdefault("industry", sector)
        for source_key, target_key in (
            ("market", "market"),
            ("website", "website"),
            ("businessSummary", "longBusinessSummary"),
        ):
            value = profile.get(source_key)
            if value:
                info[target_key] = value
        return {"ticker": ticker, "source": source, "info": info, **market_service.meta_dict(meta)}
    except Exception as e:
        return _failure(e, _MSG_QUOTE, "fundamentals_info_error", ticker, info={})


