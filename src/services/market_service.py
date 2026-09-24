"""Store-first market data — quotes, daily bars, chart windows (docs/data-platform.md §4.1).

Every read goes through the same three steps:

1. **store** — the persisted copy (``quotes`` / ``price_bars``, kept current by
   :mod:`src.workers.market_worker`) when it is fresh for the Istanbul session;
2. **live** — otherwise the existing live adapter (TradingView scanner/websocket,
   İş Yatırım as fallback); the result is written through to the store;
3. **stale** — when the provider fails, the stored copy flagged ``stale``.

The adapters keep their in-memory ``cached`` TTL layer in front (L1); this module
is the L2 below it. Store access is bounded by ``MARKET_STORE_TIMEOUT_SECONDS``
and a failing database disables the store for :data:`STORE_RETRY_SECONDS`, so a
database outage degrades to the pre-store live behaviour instead of breaking pages.

Freshness policy (weekdays, Europe/Istanbul):

* quotes — inside the session (``MARKET_SESSION_OPEN`` … ``SESSION_FINAL_TIME``)
  a stored quote is fresh for ``MARKET_QUOTE_MAX_AGE_SECONDS``; outside it a
  quote checked after the last session became final stays fresh until the next open.
* daily bars — the stored series is used when it reaches back to the requested
  start (or to the first bar the provider has) and its last bar is the quote's
  trading day. A missing/old running bar is rebuilt from the (stored) quote when
  the stored previous close proves the series is continuous; anything else is
  fetched live.

Per-symbol payloads (fast-info, company info, ticker history, small snapshots)
add İş Yatırım's official figures (:func:`get_official_quote`, OneEndeks, cached
for the quote TTL; the universe-wide paths stay TradingView):

* volume / TL turnover — OneEndeks ``quantity`` / ``volume`` of the same session
  (TradingView's same-day ``volume`` misses the trades at the closing price and its
  ``Value.Traded`` is close × lots, not turnover); TradingView is the fallback;
* share count — paid-in capital (1 TL nominal per lot): OneEndeks ``capital``, else
  ``companies.paid_in_capital`` (:func:`share_count`); market cap = last × capital;
* P/B — market cap / latest-quarter parent equity (OneEndeks ``equity``), else
  TradingView ``price_book_fq`` (:func:`price_to_book`); never ``price_book_ratio``
  (fiscal-year-end equity);
* quote times are capped at the session close and carry ``session_state``
  (:func:`src.adapters.price.with_session_view`).
"""

from __future__ import annotations

import asyncio
import time as _time
from collections.abc import Awaitable, Callable, Iterable, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, TypeVar

import pandas as pd
import structlog

from src.adapters import price
from src.adapters.utils import (
    ISTANBUL_TZ,
    TTL_DAILY_BARS,
    TTL_QUOTE,
    ChartPeriod,
    MarketDataError,
    adapter_cache,
    cached,
    finite_float,
)
from src.core.config import settings
from src.core.meta import DataMeta, ServedFrom
from src.db.repositories.market import (
    HistoryMarker,
    HistoryMarkerRepository,
    MarketBarRepository,
    QuoteRepository,
    company_ids,
    upsert_bars,
)
from src.db.session import async_session_factory

logger = structlog.get_logger(__name__)

T = TypeVar("T")

TV_SOURCE = "tradingview"
ISY_SOURCE = "isyatirim"
TV_DELAY_SECONDS = 900
SOURCE_URLS = {
    TV_SOURCE: "https://www.tradingview.com/symbols/BIST-{symbol}/",
    ISY_SOURCE: "https://www.isyatirim.com.tr/tr-tr/analiz/hisse/Sayfalar/sirket-karti.aspx?hisse={symbol}",
}
STALE_NOTE = "Sağlayıcıya ulaşılamadı; son kayıtlı veri"
STORE_RETRY_SECONDS = 30.0

# Stored daily history read for charts/indicators (the live frame is ~730 bars ≈ 2.9 years).
DAILY_WINDOW_DAYS = 3 * 366
# The stored series must reach this far back (1-year charts, 52-week stats, SMA200, 2y weekly).
DAILY_MIN_COVERAGE_DAYS = 2 * 365
# Weekends plus the longest Bayram closure between the requested and the first stored date.
COVERAGE_TOLERANCE_DAYS = 12
# Relative tolerance when comparing closes of the same session from two reads.
CLOSE_TOLERANCE = 0.0005


# ---------------------------------------------------------------------------
# Istanbul session calendar (weekdays; exchange holidays are detected from the data)
# ---------------------------------------------------------------------------

def parse_hhmm(value: str, default: time) -> time:
    try:
        hours, minutes = str(value).strip().split(":", 1)
        return time(int(hours), int(minutes))
    except (ValueError, TypeError):
        return default


def session_open_time() -> time:
    return parse_hhmm(settings.market_session_open, time(9, 55))


def session_close_time() -> time:
    return parse_hhmm(settings.market_session_close, time(18, 20))


def _istanbul(now: datetime | None) -> datetime:
    return (now or price.now_istanbul()).astimezone(ISTANBUL_TZ)


def is_weekday(day: date) -> bool:
    return day.weekday() < 5


def previous_weekday(day: date) -> date:
    day -= timedelta(days=1)
    while not is_weekday(day):
        day -= timedelta(days=1)
    return day


def in_quote_window(now: datetime | None = None) -> bool:
    """Inside the configured polling window (weekday, open … close)."""
    current = _istanbul(now)
    return is_weekday(current.date()) and session_open_time() <= current.time() <= session_close_time()


def in_session(now: datetime | None = None) -> bool:
    """Between the opening auction and the moment the day's bar becomes final."""
    current = _istanbul(now)
    return is_weekday(current.date()) and session_open_time() <= current.time() < price.SESSION_FINAL_TIME


def expected_session_date(now: datetime | None = None) -> date:
    """Trading day whose bar should be the latest one (holidays are not known here)."""
    current = _istanbul(now)
    if is_weekday(current.date()) and current.time() >= session_open_time():
        return current.date()
    return previous_weekday(current.date())


def last_final_moment(now: datetime | None = None) -> datetime:
    """Most recent weekday ``SESSION_FINAL_TIME`` at or before ``now``."""
    current = _istanbul(now)
    day = current.date()
    if not (is_weekday(day) and current.time() >= price.SESSION_FINAL_TIME):
        day = previous_weekday(day)
    return datetime.combine(day, price.SESSION_FINAL_TIME, tzinfo=ISTANBUL_TZ)


def quote_is_fresh(fetched_at: datetime | None, now: datetime | None = None) -> bool:
    if fetched_at is None:
        return False
    current = _istanbul(now)
    if in_session(current):
        return (current - fetched_at).total_seconds() <= settings.market_quote_max_age_seconds
    return fetched_at >= last_final_moment(current)


def running_bar_is_fresh(fetched_at: datetime | None, now: datetime | None = None) -> bool:
    if fetched_at is None:
        return False
    current = _istanbul(now)
    if in_session(current):
        return (current - fetched_at).total_seconds() <= settings.market_bar_max_age_seconds
    return fetched_at >= last_final_moment(current)


# ---------------------------------------------------------------------------
# Store gateway: bounded, failure-isolated DB access
# ---------------------------------------------------------------------------

_store_down_until = 0.0


def store_available() -> bool:
    return settings.market_store_enabled and _time.monotonic() >= _store_down_until


def _mark_store_down(operation: str, error: BaseException) -> None:
    global _store_down_until
    _store_down_until = _time.monotonic() + STORE_RETRY_SECONDS
    logger.warning("market_store_unavailable", operation=operation, error=f"{type(error).__name__}: {error}"[:300])


async def _store(operation: str, call: Callable[[], Awaitable[T]], default: T) -> T:
    """Run a store call with the timeout/circuit breaker; ``default`` when the store is unusable."""
    if not store_available():
        return default
    try:
        return await asyncio.wait_for(call(), settings.market_store_timeout_seconds)
    except Exception as e:  # DB down, schema missing (unit tests on SQLite), timeout ...
        _mark_store_down(operation, e)
        return default


async def _read_quotes(symbols: Sequence[str]) -> dict[str, dict[str, Any]]:
    async def call() -> dict[str, dict[str, Any]]:
        async with async_session_factory() as session:
            rows = await QuoteRepository(session).get_many(list(symbols))
            return {symbol: quote_row_to_dict(row) for symbol, row in rows.items()}

    return await _store("read_quotes", call, {})


async def _write_quotes(quotes: Iterable[dict[str, Any]]) -> None:
    items = [q for q in quotes if q.get("last") is not None]
    if not items:
        return

    async def call() -> None:
        async with async_session_factory() as session:
            ids = await company_ids(session, [q["symbol"] for q in items])
            await QuoteRepository(session).upsert_many(quote_to_row(q, ids.get(q["symbol"])) for q in items)
            await session.commit()

    await _store("write_quotes", call, None)


@dataclass(frozen=True)
class StoredBar:
    bar_date: date
    open: float | None
    high: float | None
    low: float | None
    close: float | None
    volume: float | None
    turnover: float | None
    vwap: float | None
    source: str
    adjusted: bool
    is_final: bool
    fetched_at: datetime


async def _read_bars(symbol: str, since: date) -> tuple[list[StoredBar], HistoryMarker | None]:
    async def call() -> tuple[list[StoredBar], HistoryMarker | None]:
        async with async_session_factory() as session:
            rows = await MarketBarRepository(session).series(symbol, since=since)
            marker = (await HistoryMarkerRepository(session).get_many([symbol])).get(symbol)
            bars = [
                StoredBar(
                    bar_date=row.bar_date,
                    open=finite_float(row.open),
                    high=finite_float(row.high),
                    low=finite_float(row.low),
                    close=finite_float(row.close),
                    volume=finite_float(row.volume),
                    turnover=finite_float(row.turnover),
                    vwap=finite_float(row.vwap),
                    source=row.source,
                    adjusted=row.adjusted,
                    is_final=row.is_final,
                    fetched_at=row.fetched_at,
                )
                for row in rows
            ]
            return bars, marker

    return await _store("read_bars", call, ([], None))


async def _write_bars(symbol: str, rows: list[dict[str, Any]], marker: HistoryMarker | None = None) -> None:
    if not rows and marker is None:
        return

    async def call() -> None:
        async with async_session_factory() as session:
            company_id = (await company_ids(session, [symbol])).get(symbol)
            if rows:
                await upsert_bars(session, ({**row, "company_id": company_id} for row in rows))
            if marker is not None:
                await HistoryMarkerRepository(session).save_if_missing(marker)
            await session.commit()

    await _store("write_bars", call, None)


# ---------------------------------------------------------------------------
# Quote rows <-> canonical quote dicts (price.build_quote shape + store fields)
# ---------------------------------------------------------------------------

def _float(value: Any) -> float | None:
    return finite_float(value)


def quote_row_to_dict(row: Any) -> dict[str, Any]:
    """``quotes`` row → the canonical quote dict the adapters consume."""
    quote_time: datetime | None = row.quote_time
    return {
        "symbol": row.symbol,
        "name": row.name,
        "type": row.security_type,
        "currency": row.currency,
        "last": _float(row.last),
        "open": _float(row.open),
        "high": _float(row.high),
        "low": _float(row.low),
        "prev_close": _float(row.prev_close),
        "change": _float(row.change),
        "change_percent": _float(row.change_pct),
        "volume": _float(row.volume),
        "turnover": _float(row.turnover),
        "market_cap": _float(row.market_cap),
        "bid": _float(row.bid),
        "ask": _float(row.ask),
        "timestamp": int(quote_time.timestamp()) if quote_time else None,
        "updated_at": quote_time.astimezone(ISTANBUL_TZ).isoformat() if quote_time else None,
        "session_date": row.session_date,
        "delay_seconds": row.delay_seconds,
        "source": row.source,
        "fetched_at": row.fetched_at,
    }


def quote_to_row(quote: dict[str, Any], company_id: Any = None) -> dict[str, Any]:
    """Canonical quote dict → ``quotes`` row values."""
    timestamp = finite_float(quote.get("timestamp"))
    quote_time = datetime.fromtimestamp(timestamp, UTC) if timestamp else None
    session_date = quote.get("session_date")
    if session_date is None and quote_time is not None:
        session_date = quote_time.astimezone(ISTANBUL_TZ).date()
    security_type = quote.get("type") or "stock"
    return {
        "symbol": quote["symbol"],
        "company_id": company_id,
        "security_type": "index" if security_type == "index" else str(security_type)[:20],
        "name": (quote.get("name") or None) and str(quote["name"])[:300],
        "currency": (quote.get("currency") or None) and str(quote["currency"])[:5],
        "last": quote.get("last"),
        "open": quote.get("open"),
        "high": quote.get("high"),
        "low": quote.get("low"),
        "prev_close": quote.get("prev_close"),
        "change": quote.get("change"),
        "change_pct": quote.get("change_percent"),
        "volume": quote.get("volume"),
        "turnover": quote.get("turnover"),
        "market_cap": quote.get("market_cap"),
        "bid": quote.get("bid"),
        "ask": quote.get("ask"),
        "source": quote.get("source") or TV_SOURCE,
        "delay_seconds": quote.get("delay_seconds"),
        "quote_time": quote_time,
        "session_date": session_date,
    }


def bar_from_quote(quote: dict[str, Any], now: datetime | None = None) -> dict[str, Any] | None:
    """The quote's daily OHLCV as a ``price_bars`` row (the provider's current daily bar)."""
    session_date = quote.get("session_date")
    last = quote.get("last")
    if not isinstance(session_date, date) or last is None:
        return None
    return {
        "symbol": quote["symbol"],
        "interval": "1d",
        "bar_date": session_date,
        "open": quote.get("open"),
        "high": quote.get("high"),
        "low": quote.get("low"),
        "close": last,
        "volume": quote.get("volume"),
        "source": quote.get("source") or TV_SOURCE,
        "adjusted": True,
        "is_final": price.is_session_final(session_date, now),
    }


# ---------------------------------------------------------------------------
# Meta helpers
# ---------------------------------------------------------------------------

def _source_url(source: str, symbol: str | None) -> str | None:
    template = SOURCE_URLS.get(source.split("+", 1)[0])
    return template.format(symbol=symbol) if template and symbol else None


def build_meta(
    *,
    source: str,
    fetched_at: datetime | None,
    served_from: ServedFrom,
    as_of: date | datetime | str | None = None,
    delay_seconds: int | None = TV_DELAY_SECONDS,
    symbol: str | None = None,
    notes: Sequence[str] = (),
) -> DataMeta:
    stale = served_from == "stale"
    all_notes = list(notes)
    if stale and STALE_NOTE not in all_notes:
        all_notes.insert(0, STALE_NOTE)
    if isinstance(as_of, datetime):
        as_of_label: str | None = as_of.astimezone(ISTANBUL_TZ).date().isoformat()
    elif isinstance(as_of, date):
        as_of_label = as_of.isoformat()
    else:
        as_of_label = as_of
    return DataMeta(
        source=source,
        fetched_at=fetched_at or datetime.now(UTC),
        source_url=_source_url(source, symbol),
        as_of=as_of_label,
        served_from=served_from,
        stale=stale,
        delay_seconds=delay_seconds,
        notes=all_notes,
    )


def combine_meta(metas: Sequence[DataMeta]) -> DataMeta | None:
    """One meta for a payload assembled from several reads (oldest data, worst freshness)."""
    if not metas:
        return None
    served: ServedFrom = "store"
    if any(m.served_from == "stale" for m in metas):
        served = "stale"
    elif any(m.served_from == "live" for m in metas):
        served = "live"
    sources = sorted({part for m in metas for part in m.source.split("+")})
    notes: list[str] = []
    for m in metas:
        notes.extend(n for n in m.notes if n not in notes)
    as_of_values = [m.as_of for m in metas if m.as_of]
    delays = [m.delay_seconds for m in metas if m.delay_seconds is not None]
    urls = [m.source_url for m in metas if m.source_url]
    return DataMeta(
        source="+".join(sources),
        fetched_at=min(m.fetched_at for m in metas),
        source_url=urls[0] if urls else None,
        as_of=max(as_of_values) if as_of_values else None,
        served_from=served,
        stale=served == "stale",
        delay_seconds=max(delays) if delays else None,
        notes=notes,
    )


# ---------------------------------------------------------------------------
# Quotes
# ---------------------------------------------------------------------------

@dataclass
class QuoteResult:
    quotes: dict[str, dict[str, Any]]
    meta: DataMeta | None
    served: dict[str, ServedFrom] = field(default_factory=dict)


def _quote_meta(quotes: dict[str, dict[str, Any]], served: dict[str, ServedFrom]) -> DataMeta | None:
    metas = []
    for symbol, quote in quotes.items():
        fetched_at = quote.get("fetched_at")
        metas.append(
            build_meta(
                source=str(quote.get("source") or TV_SOURCE),
                fetched_at=fetched_at if isinstance(fetched_at, datetime) else None,
                served_from=served.get(symbol, "live"),
                as_of=quote.get("session_date"),
                delay_seconds=quote.get("delay_seconds") if quote.get("delay_seconds") is not None else TV_DELAY_SECONDS,
                symbol=symbol,
            )
        )
    meta = combine_meta(metas)
    if meta is not None and len(quotes) != 1:
        meta = replace(meta, source_url=None)
    return meta


# İş Yatırım requests a single API read may add for symbols TradingView did not return.
READ_FALLBACK_MAX_SYMBOLS = 5


async def _live_quotes(symbols: tuple[str, ...]) -> dict[str, dict[str, Any]]:
    """TradingView scanner (+ websocket for indices), İş Yatırım for whatever is still missing."""
    quotes: dict[str, dict[str, Any]] = {}
    error: MarketDataError | None = None
    try:
        quotes = dict(await price.get_quotes(symbols))
    except MarketDataError as e:
        error = e
    missing = [s for s in symbols if s not in quotes][:READ_FALLBACK_MAX_SYMBOLS]
    if missing:
        from src.adapters.isyatirim_prices import fetch_isyatirim_quotes

        quotes.update(await fetch_isyatirim_quotes(missing))
    if not quotes and error is not None:
        raise error
    now = datetime.now(UTC)
    return {s: {**q, "fetched_at": now} for s, q in quotes.items()}


async def get_quotes(symbols: Sequence[str], *, now: datetime | None = None) -> QuoteResult:
    """Store-first quotes keyed by symbol (symbols nobody knows are absent)."""
    wanted = tuple(dict.fromkeys(symbols))
    stored = await _read_quotes(wanted) if wanted else {}
    fresh = {s: q for s, q in stored.items() if quote_is_fresh(q.get("fetched_at"), now)}
    served: dict[str, ServedFrom] = {s: "store" for s in fresh}
    quotes = dict(fresh)
    to_fetch = tuple(s for s in wanted if s not in fresh)
    if to_fetch:
        try:
            live = await _live_quotes(to_fetch)
        except MarketDataError:
            stale = {s: q for s, q in stored.items() if s in to_fetch}
            if not stale and not quotes:
                raise
            quotes.update(stale)
            served.update({s: "stale" for s in stale})
        else:
            quotes.update(live)
            served.update({s: "live" for s in live})
            await _write_quotes(live.values())
            # A symbol the provider no longer returns keeps its stored copy (flagged stale).
            for symbol in to_fetch:
                if symbol not in live and symbol in stored:
                    quotes[symbol] = stored[symbol]
                    served[symbol] = "stale"
    # Payload view: quote times capped at the session close + session_state (the store keeps provider times).
    ordered = {s: price.with_session_view(quotes[s], now) for s in wanted if s in quotes}
    return QuoteResult(quotes=ordered, meta=_quote_meta(ordered, served), served=served)


async def get_quote(symbol: str, *, now: datetime | None = None) -> tuple[dict[str, Any] | None, DataMeta | None]:
    result = await get_quotes((symbol,), now=now)
    return result.quotes.get(symbol), result.meta


# ---------------------------------------------------------------------------
# Quote extras (TradingView columns without a quotes column: 52 weeks, SMA, P/E ...)
# ---------------------------------------------------------------------------

EXTRAS_KEY = "market.quote_extras"
# P/B: ``price_book_fq`` (latest quarter), never ``price_book_ratio`` (fiscal-year-end equity).
EXTRA_COLUMNS: tuple[str, ...] = (
    "price_52_week_high",
    "price_52_week_low",
    "SMA50",
    "SMA200",
    "total_shares_outstanding",
    "price_earnings_ttm",
    "price_book_fq",
)


@dataclass(frozen=True)
class QuoteExtras:
    values: dict[str, dict[str, Any]]
    fetched_at: datetime
    columns: tuple[str, ...] = ()  # the columns the worker requested (older rows: unknown)

    def covers(self, columns: Iterable[str]) -> bool:
        """True when the stored row was written with every one of ``columns`` requested."""
        return set(columns) <= set(self.columns)


async def save_quote_extras(values: dict[str, dict[str, Any]]) -> None:
    """Persist the latest extras of the whole universe as one ``data_snapshots`` row (worker)."""
    from src.db.repositories.market import save_snapshot

    payload = {"symbols": values, "columns": list(EXTRA_COLUMNS)}

    async def call() -> None:
        async with async_session_factory() as session:
            await save_snapshot(session, EXTRAS_KEY, EXTRAS_KEY, payload, TV_SOURCE)
            await session.commit()

    await _store("save_quote_extras", call, None)


async def _read_quote_extras() -> QuoteExtras | None:
    from src.db.repositories.market import load_snapshot

    async def call() -> QuoteExtras | None:
        async with async_session_factory() as session:
            row = await load_snapshot(session, EXTRAS_KEY)
            if row is None or not isinstance(row.payload, dict):
                return None
            symbols = row.payload.get("symbols")
            columns = row.payload.get("columns")
            return QuoteExtras(
                dict(symbols) if isinstance(symbols, dict) else {},
                row.fetched_at,
                tuple(str(c) for c in columns) if isinstance(columns, list) else (),
            )

    return await _store("read_quote_extras", call, None)


@cached(60, "market_extras")
async def get_quote_extras() -> QuoteExtras | None:
    """The stored extras (one row for the whole universe, L1-cached for a minute)."""
    return await _read_quote_extras()


# ---------------------------------------------------------------------------
# Official per-symbol figures (İş Yatırım OneEndeks) and the rules that use them
# ---------------------------------------------------------------------------

# An optional İş Yatırım read may add at most this much latency to a per-symbol payload.
OFFICIAL_TIMEOUT_SECONDS = 3.0
# Multi-symbol snapshots (watchlists) only add the official figures up to this size.
OFFICIAL_OVERLAY_MAX_SYMBOLS = 3
# companies.paid_in_capital is read for the whole table at most this often (it changes with statements).
TTL_PAID_IN_CAPITAL = 3600
_CAPITAL_CACHE_PREFIX = "market_capital:"

SHARES_SOURCE_ISYATIRIM = "isyatirim_capital"  # OneEndeks ``capital``: current registered capital
SHARES_SOURCE_PAID_IN = "paid_in_capital"  # companies.paid_in_capital: last balance sheet (WS3)
SHARES_SOURCE_MARKET = "market_data"  # derived from İş Yatırım card / TradingView market caps
VOLUME_SOURCE_ISYATIRIM = ISY_SOURCE
VOLUME_SOURCE_TRADINGVIEW = TV_SOURCE
PB_SOURCE_EQUITY = "isyatirim_equity"  # market cap / latest-quarter parent equity
PB_SOURCE_TRADINGVIEW = "tradingview_fq"  # TradingView price_book_fq

NOTE_VOLUME_OFFICIAL = "Hacim ve işlem hacmi: İş Yatırım (resmî)"
NOTE_VOLUME_TRADINGVIEW = "Hacim: TradingView (kapanış fiyatından işlemler eksik olabilir)"
NOTE_SHARES = {
    SHARES_SOURCE_ISYATIRIM: "Pay adedi: ödenmiş sermaye (İş Yatırım)",
    SHARES_SOURCE_PAID_IN: "Pay adedi: ödenmiş sermaye (son bilanço)",
    SHARES_SOURCE_MARKET: "Pay adedi: piyasa değerinden türetildi",
}
NOTE_PB = {
    PB_SOURCE_EQUITY: "PD/DD: son çeyrek ana ortaklık özkaynakları",
    PB_SOURCE_TRADINGVIEW: "PD/DD: TradingView (son çeyrek)",
}


@dataclass(frozen=True)
class CompanyCapital:
    """Paid-in capital (TL = lots on BIST) and latest-quarter parent equity (TL) of one company."""

    capital: float | None
    equity: float | None


def _positive(value: Any) -> float | None:
    number = finite_float(value)
    return number if number is not None and number > 0 else None


def _seconds_until_midnight(now: datetime | None = None) -> float:
    current = _istanbul(now)
    midnight = datetime.combine(current.date() + timedelta(days=1), time(0, 0), tzinfo=ISTANBUL_TZ)
    return max(60.0, (midnight - current).total_seconds())


def remember_capital(symbol: str, quote: dict[str, Any] | None, now: datetime | None = None) -> None:
    """Keep an official quote's capital/equity for the rest of the Istanbul day (L1 cache)."""
    if not quote or (quote.get("capital") is None and quote.get("equity") is None):
        return
    value = CompanyCapital(_positive(quote.get("capital")), finite_float(quote.get("equity")))
    adapter_cache.set(f"{_CAPITAL_CACHE_PREFIX}{symbol}", value, _seconds_until_midnight(now))


def remembered_capital(symbol: str) -> CompanyCapital | None:
    hit, value = adapter_cache.get(f"{_CAPITAL_CACHE_PREFIX}{symbol}")
    return value if hit and isinstance(value, CompanyCapital) else None


@cached(TTL_QUOTE, "market_official")
async def _official_quote(symbol: str) -> dict[str, Any]:
    from src.adapters.isyatirim_prices import fetch_quote

    quote = await fetch_quote(symbol)
    remember_capital(symbol, quote)
    return quote


async def get_official_quote(symbol: str, *, timeout: float = OFFICIAL_TIMEOUT_SECONDS) -> dict[str, Any] | None:
    """İş Yatırım OneEndeks quote (lots, TL turnover, capital, equity) or ``None`` — never raises.

    Cached for the quote TTL (single flight); a slow answer is abandoned after
    ``timeout`` while its fetch finishes in the background for the next request.
    """
    try:
        return await asyncio.wait_for(_official_quote(symbol), timeout)
    except Exception as e:  # timeout, İş Yatırım down/WAF, unknown symbol
        logger.info("official_quote_unavailable", symbol=symbol, error=f"{type(e).__name__}: {e}"[:200])
        return None


async def get_official_quotes(symbols: Sequence[str]) -> dict[str, dict[str, Any]]:
    wanted = list(dict.fromkeys(symbols))
    results = await asyncio.gather(*(get_official_quote(symbol) for symbol in wanted))
    return {symbol: quote for symbol, quote in zip(wanted, results) if quote is not None}


async def _read_paid_in_capitals() -> dict[str, float] | None:
    from src.db.repositories.market import paid_in_capitals

    async def call() -> dict[str, float]:
        async with async_session_factory() as session:
            return await paid_in_capitals(session)

    return await _store("read_paid_in_capitals", call, None)


@cached(TTL_PAID_IN_CAPITAL, "market_paid_in")
async def get_paid_in_capitals() -> dict[str, float] | None:
    """``companies.paid_in_capital`` by ticker (``None`` when the store is unavailable — not cached)."""
    return await _read_paid_in_capitals()


@dataclass(frozen=True)
class ShareCount:
    capital: float | None  # exact paid-in capital, TL (SASA: 52,501,931,146.27)
    source: str | None

    @property
    def shares(self) -> float | None:
        """Share (lot) count as a whole number."""
        return float(round(self.capital)) if self.capital is not None else None

    def market_cap(self, last: float | None) -> float | None:
        if self.capital is None or last is None or last <= 0:
            return None
        return round(last * self.capital, 2)


def share_count(official_capital: Any, stored_capital: Any) -> ShareCount:
    """Share count = paid-in capital (BIST shares have 1 TL nominal value per lot).

    İş Yatırım's OneEndeks ``capital`` comes first: it is the current registered
    capital to the kuruş, while ``companies.paid_in_capital`` is the last balance
    sheet's figure — rounded to the statement's presentation unit (KCHOL
    2,536,000,000 vs 2,535,898,050) and stale between a capital increase and the
    next statement (BIMAS 600 mn → 1.2 bn TL in 2026 Q2). TradingView's count
    excludes treasury shares (BIMAS 1,185,780,000 vs 1,200,000,000) and is never
    used here; callers fall back to their market-data estimate when both are missing.
    """
    official = _positive(official_capital)
    if official is not None:
        return ShareCount(official, SHARES_SOURCE_ISYATIRIM)
    stored = _positive(stored_capital)
    if stored is not None:
        return ShareCount(stored, SHARES_SOURCE_PAID_IN)
    return ShareCount(None, None)


def price_to_book(market_cap: Any, equity: Any, provider_pb_fq: Any) -> tuple[float | None, str | None]:
    """``(P/B rounded to 2 decimals, source)``.

    Market cap (last × paid-in capital) / latest-quarter parent equity (OneEndeks
    ``equity`` = the statements' ``parent_equity``) — the İş Yatırım / BIST
    convention and the same market cap the payload shows. Without them
    TradingView's ``price_book_fq`` (latest quarter; close / book value per share on
    a treasury-excluded share count, so ~1-10 % lower for companies holding their
    own shares). ``price_book_ratio`` (fiscal-year-end equity) is never used.
    """
    cap = _positive(market_cap)
    book = finite_float(equity)
    if cap is not None and book is not None and book != 0:
        return round(cap / book, 2), PB_SOURCE_EQUITY
    fallback = finite_float(provider_pb_fq)
    if fallback is not None:
        return round(fallback, 2), PB_SOURCE_TRADINGVIEW
    return None, None


def official_session_figures(official: dict[str, Any] | None, session_date: Any) -> tuple[float, float | None] | None:
    """``(lots, TL turnover)`` of an official quote when it describes ``session_date``, else ``None``.

    A quote without a session (the overnight reset, see
    :func:`src.adapters.isyatirim_prices.parse_quote`) or without traded lots never qualifies.
    """
    if not official or not isinstance(session_date, date) or official.get("session_date") != session_date:
        return None
    lots = finite_float(official.get("volume"))
    if lots is None or lots <= 0:
        return None
    turnover = finite_float(official.get("turnover"))
    return lots, turnover if turnover is not None and turnover >= 0 else None


def company_capital(symbol: str, official: dict[str, Any] | None) -> CompanyCapital | None:
    """Capital/equity from a fresh official quote, else from earlier today's (:func:`remembered_capital`)."""
    if official and (official.get("capital") is not None or official.get("equity") is not None):
        return CompanyCapital(_positive(official.get("capital")), finite_float(official.get("equity")))
    return remembered_capital(symbol)


def official_notes(sources: dict[str, str | None]) -> list[str]:
    """Human-readable provenance notes for ``volume_source`` / ``shares_source`` / ``pb_source``."""
    notes: list[str] = []
    volume = sources.get("volume_source")
    if volume == VOLUME_SOURCE_ISYATIRIM:
        notes.append(NOTE_VOLUME_OFFICIAL)
    elif volume == VOLUME_SOURCE_TRADINGVIEW:
        notes.append(NOTE_VOLUME_TRADINGVIEW)
    shares = sources.get("shares_source")
    if shares in NOTE_SHARES:
        notes.append(NOTE_SHARES[shares])
    pb = sources.get("pb_source")
    if pb in NOTE_PB:
        notes.append(NOTE_PB[pb])
    return notes


def with_official_provenance(meta: DataMeta | None, sources: dict[str, str | None]) -> DataMeta | None:
    """``meta`` + İş Yatırım as a source (when it supplied a field) + the provenance notes."""
    if meta is None:
        return None
    notes = list(meta.notes)
    notes.extend(n for n in official_notes(sources) if n not in notes)
    used = any(
        value in (VOLUME_SOURCE_ISYATIRIM, SHARES_SOURCE_ISYATIRIM, PB_SOURCE_EQUITY) for value in sources.values()
    )
    parts = meta.source.split("+")
    source = meta.source if not used or ISY_SOURCE in parts else f"{meta.source}+{ISY_SOURCE}"
    return replace(meta, source=source, notes=notes)


# ---------------------------------------------------------------------------
# Daily bars
# ---------------------------------------------------------------------------

@dataclass
class DailyBars:
    frame: pd.DataFrame
    meta: DataMeta
    first_available: date | None = None  # oldest bar the provider has (listing-limited history)


def bars_to_frame(bars: Sequence[StoredBar]) -> pd.DataFrame:
    """Stored bars → the frame shape of :func:`price.clean_bars` (index = session day 09:00 Istanbul)."""
    if not bars:
        return price.clean_bars(None)
    index = pd.DatetimeIndex(
        [pd.Timestamp(datetime.combine(bar.bar_date, time(9, 0))) for bar in bars]
    ).tz_localize(ISTANBUL_TZ)
    frame = pd.DataFrame(
        {
            "Open": [bar.open for bar in bars],
            "High": [bar.high for bar in bars],
            "Low": [bar.low for bar in bars],
            "Close": [bar.close for bar in bars],
            "Volume": [bar.volume for bar in bars],
        },
        index=index,
        dtype="float64",
    )
    return price.clean_bars(frame)


def frame_to_bar_rows(symbol: str, frame: pd.DataFrame, now: datetime | None = None) -> list[dict[str, Any]]:
    """Live TradingView frame → ``price_bars`` rows (split-adjusted; today's bar non-final)."""
    rows: list[dict[str, Any]] = []
    for timestamp, values in zip(frame.index, frame.itertuples(index=False, name=None)):
        record = dict(zip(frame.columns, values))
        close = finite_float(record.get("Close"))
        if close is None or close <= 0:
            continue
        bar_date = pd.Timestamp(timestamp).tz_convert(ISTANBUL_TZ).date()
        rows.append(
            {
                "symbol": symbol,
                "interval": "1d",
                "bar_date": bar_date,
                "open": finite_float(record.get("Open")),
                "high": finite_float(record.get("High")),
                "low": finite_float(record.get("Low")),
                "close": close,
                "volume": finite_float(record.get("Volume")),
                "source": TV_SOURCE,
                "adjusted": True,
                "is_final": price.is_session_final(bar_date, now),
            }
        )
    return rows


def closes_match(a: float | None, b: float | None, tolerance: float = CLOSE_TOLERANCE) -> bool:
    if a is None or b is None or a <= 0 or b <= 0:
        return False
    return abs(a / b - 1) <= tolerance


def history_covers(first_stored: date | None, start: date, marker: HistoryMarker | None) -> bool:
    """True when the stored series reaches ``start`` or everything the provider has."""
    if first_stored is None:
        return False
    if first_stored <= start + timedelta(days=COVERAGE_TOLERANCE_DAYS):
        return True
    if marker is not None and marker.first_available is not None and marker.requested_from is not None:
        return marker.requested_from <= start and first_stored <= marker.first_available + timedelta(days=5)
    return False


def _running_bar(quote: dict[str, Any]) -> StoredBar | None:
    row = bar_from_quote(quote)
    if row is None:
        return None
    fetched_at = quote.get("fetched_at")
    return StoredBar(
        bar_date=row["bar_date"],
        open=row["open"],
        high=row["high"],
        low=row["low"],
        close=row["close"],
        volume=row["volume"],
        turnover=None,
        vwap=None,
        source=row["source"],
        adjusted=True,
        is_final=row["is_final"],
        fetched_at=fetched_at if isinstance(fetched_at, datetime) else datetime.now(UTC),
    )


def _is_previous_close(bars: Sequence[StoredBar], quote: dict[str, Any]) -> bool:
    """The last stored final bar before the quote's session closes at the quote's previous close."""
    session_date = quote.get("session_date")
    previous = next((b for b in reversed(bars) if b.is_final and b.bar_date < session_date), None) if isinstance(session_date, date) else None
    if previous is None:
        return False
    reference = quote.get("prev_bar_close") or quote.get("prev_close")
    return closes_match(previous.close, finite_float(reference))


async def _live_daily(symbol: str, now: datetime | None) -> DailyBars:
    frame = await price.get_daily_bars(symbol)
    rows = frame_to_bar_rows(symbol, frame, now)
    marker = None
    if rows and len(frame) < 700:  # the live request asks for ~730 sessions (~1000 days): a younger listing
        marker = HistoryMarker(
            symbol=symbol,
            first_available=rows[0]["bar_date"],
            requested_from=_istanbul(now).date() - timedelta(days=1000),
            bars=len(rows),
            reason="live_read",
        )
    await _write_bars(symbol, rows, marker)
    as_of = rows[-1]["bar_date"] if rows else None
    meta = build_meta(source=TV_SOURCE, fetched_at=datetime.now(UTC), served_from="live", as_of=as_of, symbol=symbol)
    return DailyBars(frame=frame, meta=meta, first_available=rows[0]["bar_date"] if marker else None)


def _store_meta(symbol: str, bars: Sequence[StoredBar], served_from: ServedFrom, notes: Sequence[str] = ()) -> DataMeta:
    last = bars[-1]
    sources = sorted({bar.source for bar in bars[-30:]})
    return build_meta(
        source="+".join(sources) or TV_SOURCE,
        fetched_at=last.fetched_at,
        served_from=served_from,
        as_of=last.bar_date,
        symbol=symbol,
        notes=notes,
    )


async def _store_daily(
    symbol: str, start: date, now: datetime | None
) -> tuple[DailyBars | None, list[StoredBar]]:
    """``(fresh stored frame or None, the stored bars)`` — see the module docstring."""
    current = _istanbul(now)
    read_from = min(start, current.date() - timedelta(days=DAILY_WINDOW_DAYS))
    bars, marker = await _read_bars(symbol, read_from)
    if not bars or not history_covers(bars[0].bar_date, start, marker):
        return None, bars
    first_available = marker.first_available if marker else None
    last = bars[-1]

    try:
        quote_result: QuoteResult | None = await get_quotes((symbol,), now=now)
    except MarketDataError:
        quote_result = None
    quote = quote_result.quotes.get(symbol) if quote_result else None
    session_date = quote.get("session_date") if quote else None

    if quote is None or not isinstance(session_date, date):
        # No quote to validate against: trust a series that ends on the expected session.
        if last.bar_date >= expected_session_date(current) and (
            last.is_final or running_bar_is_fresh(last.fetched_at, current)
        ):
            return DailyBars(bars_to_frame(bars), _store_meta(symbol, bars, "store"), first_available), bars
        return None, bars

    if last.bar_date > session_date or (
        last.bar_date == session_date and (last.is_final or running_bar_is_fresh(last.fetched_at, current))
    ):
        return DailyBars(bars_to_frame(bars), _store_meta(symbol, bars, "store"), first_available), bars

    # The session's bar is missing or older than the quote: rebuild it from the quote
    # when the stored series is continuous up to the previous session.
    running = _running_bar(quote)
    if running is None or not _is_previous_close(bars, quote):
        return None, bars
    quote_served = quote_result.served.get(symbol, "live") if quote_result else "stale"
    merged = [bar for bar in bars if bar.bar_date < session_date] + [running]
    row = bar_from_quote(quote, now)
    if row is not None and quote_served != "stale":
        await _write_bars(symbol, [row])
    return DailyBars(bars_to_frame(merged), _store_meta(symbol, merged, quote_served), first_available), bars


def _default_start(now: datetime | None) -> date:
    return _istanbul(now).date() - timedelta(days=DAILY_MIN_COVERAGE_DAYS)


async def daily_bars(symbol: str, *, min_start: date | None = None, now: datetime | None = None) -> DailyBars:
    """Store-first daily frame of ``symbol`` (same shape as :func:`price.get_daily_bars`).

    ``min_start``: the stored series must reach back to this day (default: two
    years) — otherwise the frame is fetched live and written through.
    """
    result, bars = await _store_daily(symbol, min_start or _default_start(now), now)
    if result is not None:
        return result
    return await _live_or_stale(symbol, bars, now)


async def stored_daily_bars(symbol: str, *, min_start: date, now: datetime | None = None) -> DailyBars | None:
    """Store only: the fresh stored frame, else whatever is stored (flagged stale), else ``None``."""
    result, bars = await _store_daily(symbol, min_start, now)
    if result is not None:
        return result
    return DailyBars(bars_to_frame(bars), _store_meta(symbol, bars, "stale")) if bars else None


# A stored close this far from the provider's close for the same session means the
# provider re-adjusted its history (split / bonus issue): the whole stored series is refreshed.
REBASE_TOLERANCE = 0.005


def rebased_sessions(stored: Sequence[StoredBar], frame: pd.DataFrame) -> list[date]:
    """Final stored sessions whose close disagrees with the live (re-adjusted) frame."""
    live = {pd.Timestamp(ts).tz_convert(ISTANBUL_TZ).date(): finite_float(close) for ts, close in frame["Close"].items()}
    return [
        bar.bar_date
        for bar in stored
        if bar.is_final and bar.bar_date in live and not closes_match(bar.close, live[bar.bar_date], REBASE_TOLERANCE)
    ]


async def _request_refresh(symbol: str, reason: str) -> None:
    async def call() -> None:
        async with async_session_factory() as session:
            await HistoryMarkerRepository(session).request_refresh(symbol, reason)
            await session.commit()

    await _store("request_refresh", call, None)


async def _live_or_stale(symbol: str, bars: Sequence[StoredBar], now: datetime | None) -> DailyBars:
    try:
        result = await _live_daily(symbol, now)
    except MarketDataError:
        if not bars:
            raise
        logger.warning("market_daily_bars_stale", symbol=symbol, last=bars[-1].bar_date.isoformat())
        return DailyBars(bars_to_frame(bars), _store_meta(symbol, bars, "stale"))
    rebased = rebased_sessions(bars, result.frame)
    if rebased:
        # The write-through fixed the overlapping sessions; older ones need the backfill.
        logger.info("market_history_rebased", symbol=symbol, sessions=len(rebased), first=rebased[0].isoformat())
        await _request_refresh(symbol, f"live_read: {len(rebased)} stored closes differ (split/adjustment)")
    return result


@cached(TTL_DAILY_BARS, "market_daily")
async def get_daily_bars(symbol: str) -> DailyBars:
    """L1-cached :func:`daily_bars` (read-only frame — copy before mutating)."""
    return await daily_bars(symbol)


@cached(TTL_QUOTE, "market_quotes")
async def get_cached_quotes(symbols: tuple[str, ...]) -> QuoteResult:
    """L1-cached :func:`get_quotes` for adapters that poll the same symbol sets."""
    return await get_quotes(symbols)


@cached(TTL_DAILY_BARS, "market_stored_daily")
async def get_stored_daily_bars(symbol: str) -> DailyBars | None:
    """L1-cached store-only daily frame: ``None`` unless the stored series is fresh and covers two years.

    For callers that have a cheaper live alternative than a full history download
    (technical values: one TradingView scanner request).
    """
    result, _bars = await _store_daily(symbol, _default_start(None), None)
    return result


# ---------------------------------------------------------------------------
# Snapshot rows (quote + extras in the TradingView scanner row shape) for fast-info
# ---------------------------------------------------------------------------

SNAPSHOT_QUOTE_COLUMNS: tuple[str, ...] = ("change", "update_time", "update_mode", "time", "close[1]", "type")


def scan_row_from_store(quote: dict[str, Any], extras: dict[str, Any] | None) -> dict[str, Any]:
    """Stored quote (+ extras) → the TradingView scanner row the snapshot builder consumes.

    ``session_date`` is not a scanner column: live rows carry ``time`` (the daily bar's open) instead.
    """
    return {
        "close": quote.get("last"),
        "open": quote.get("open"),
        "high": quote.get("high"),
        "low": quote.get("low"),
        "volume": quote.get("volume"),
        "change": quote.get("change_percent"),
        "change_abs": quote.get("change"),
        "Value.Traded": quote.get("turnover"),
        "description": quote.get("name"),
        "currency": quote.get("currency"),
        "market_cap_basic": quote.get("market_cap"),
        "update_time": quote.get("timestamp"),
        "session_date": quote.get("session_date"),
        **(extras or {}),
    }


async def get_snapshot_row(symbol: str, columns: Sequence[str]) -> tuple[dict[str, Any], DataMeta]:
    """Store-first TradingView scanner row for ``symbol`` (quote columns + :data:`EXTRA_COLUMNS`).

    The store serves when both the quote and the worker's extras are fresh; otherwise
    one live scanner request (written through to ``quotes``); when that fails, the
    stored quote (and whatever extras exist) flagged stale. Raises when nothing is known.
    """
    stored = (await _read_quotes((symbol,))).get(symbol)
    extras = await get_quote_extras()
    extra_values = extras.values.get(symbol) if extras else None
    if (
        stored is not None
        and quote_is_fresh(stored.get("fetched_at"))
        and extras is not None
        and extra_values is not None
        and quote_is_fresh(extras.fetched_at)
        and extras.covers(EXTRA_COLUMNS)  # a row from an older worker lacks e.g. price_book_fq
    ):
        return scan_row_from_store(stored, extra_values), _quote_meta({symbol: stored}, {symbol: "store"}) or build_meta(
            source=TV_SOURCE, fetched_at=None, served_from="store", symbol=symbol
        )
    from src.adapters.utils import tradingview_scan

    try:
        rows = await tradingview_scan([symbol], tuple(dict.fromkeys((*columns, *SNAPSHOT_QUOTE_COLUMNS))))
    except MarketDataError:
        if stored is None:
            raise
        meta = _quote_meta({symbol: stored}, {symbol: "stale"})
        return scan_row_from_store(stored, extra_values), meta or build_meta(
            source=TV_SOURCE, fetched_at=None, served_from="stale", symbol=symbol
        )
    row = rows.get(symbol)
    if row is None:
        return {}, build_meta(source=TV_SOURCE, fetched_at=None, served_from="live", symbol=symbol)
    quote = price.quote_from_scan(symbol, row)
    if quote is not None:
        await _write_quotes([quote])
    meta = build_meta(
        source=TV_SOURCE,
        fetched_at=datetime.now(UTC),
        served_from="live",
        as_of=quote.get("session_date") if quote else None,
        delay_seconds=(quote or {}).get("delay_seconds") or TV_DELAY_SECONDS,
        symbol=symbol,
    )
    return row, meta


# ---------------------------------------------------------------------------
# Chart windows (daily → store; weekly derived from stored daily; intraday/monthly live)
# ---------------------------------------------------------------------------

def weekly_from_daily(frame: pd.DataFrame) -> pd.DataFrame:
    """Weekly OHLCV bars from daily bars, stamped like TradingView's.

    A week runs Monday … Sunday; its bar carries the first session's date at 09:00
    Istanbul (a week starting with a holiday — Bayram, the February 2023 closure — is
    stamped with its first trading day, as on TradingView).
    """
    if frame.empty:
        return frame
    local = pd.DatetimeIndex(frame.index).tz_convert(ISTANBUL_TZ)
    weeks = [ts.date() - timedelta(days=ts.weekday()) for ts in local]
    grouped = frame.groupby(weeks, sort=True)
    first_session = pd.Series([ts.date() for ts in local], index=frame.index).groupby(weeks, sort=True).min()
    weekly = pd.DataFrame(
        {
            "Open": grouped["Open"].first(),
            "High": grouped["High"].max(),
            "Low": grouped["Low"].min(),
            "Close": grouped["Close"].last(),
            "Volume": grouped["Volume"].sum(min_count=1),
        }
    )
    weekly.index = pd.DatetimeIndex(
        [pd.Timestamp(datetime.combine(first_session[week], time(9, 0))) for week in weekly.index]
    ).tz_localize(ISTANBUL_TZ).rename("Date")
    return weekly


@dataclass
class ChartWindow:
    bars: pd.DataFrame
    reference: dict[str, Any]
    meta: DataMeta
    # Bars immediately before the window (indicator warmup; same frame shape as ``bars``).
    before: pd.DataFrame = field(default_factory=lambda: price.clean_bars(None))


async def get_chart_window(
    symbol: str, spec: ChartPeriod, *, now: datetime | None = None, warmup: int = 0
) -> ChartWindow:
    """Store-first :func:`price.get_chart_window_parts`.

    Daily periods (1ay … 1y) use the stored daily series (≈3 years: ``before`` holds
    ≥ 1 year of bars); weekly periods (2y, 5y) are derived from it when the store
    reaches back far enough — with ``warmup`` weeks more before the window when warmup
    bars are wanted — otherwise TradingView's weekly bars are fetched (5y / 10y of
    history). Intraday (1g/5g) and monthly (max) bars are not stored and always come live.
    """
    current = _istanbul(now)
    if spec.interval == "1d":
        daily = await get_daily_bars(symbol)
        window, before = price.split_chart_window(daily.frame, spec, current)
        return ChartWindow(window, price.period_reference(before), daily.meta, before)
    stored: DailyBars | None = None
    if spec.interval == "1wk":
        start_ts = price.window_start(spec, current)
        if start_ts is not None:
            # One week before the window supplies the reference close (+ the warmup weeks).
            margin = timedelta(days=10 + 7 * max(0, warmup))
            stored = await stored_daily_bars(symbol, min_start=start_ts.date() - margin, now=now)
        if stored is not None and stored.meta.served_from != "stale":
            window, before = price.split_chart_window(weekly_from_daily(stored.frame), spec, current)
            return ChartWindow(window, price.period_reference(before), stored.meta, before)
    try:
        window, before, reference = await price.get_chart_window_parts(symbol, spec)
    except MarketDataError:
        if stored is None or stored.frame.empty:
            raise
        window, before = price.split_chart_window(weekly_from_daily(stored.frame), spec, current)
        return ChartWindow(window, price.period_reference(before), stored.meta, before)
    last = pd.Timestamp(window.index[-1]).date() if not window.empty else None
    meta = build_meta(source=TV_SOURCE, fetched_at=datetime.now(UTC), served_from="live", as_of=last, symbol=symbol)
    return ChartWindow(window, reference, meta, before)


async def get_chart_window_parts(
    symbol: str, spec: ChartPeriod, *, now: datetime | None = None, warmup: int = 0
) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    """``(window, before, reference)`` of :func:`get_chart_window` (master's adapter API)."""
    chart = await get_chart_window(symbol, spec, now=now, warmup=warmup)
    return chart.bars, chart.before, chart.reference


def meta_dict(meta: DataMeta | None) -> dict[str, Any]:
    """``{"meta": ...}`` fragment for payloads (empty when no meta is known)."""
    return {"meta": meta.to_dict()} if meta is not None else {}
