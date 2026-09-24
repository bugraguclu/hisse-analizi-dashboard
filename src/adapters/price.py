"""Fiyat verisi — canli grafik barlari, kotasyonlar ve DB'ye yazilan gunluk barlar.

This is the **live** layer (TradingView). Reads go store-first through
:mod:`src.services.market_service`, which falls back to these functions and
writes their results through to ``quotes`` / ``price_bars``; the market worker
(:mod:`src.workers.market_worker`) keeps the store current. Live primitives:

* :func:`get_daily_bars` — one cached ~3-year daily frame per symbol. Chart
  periods up to 1 year, technical indicators (SuperTrend, pivots, custom
  periods), 52-week stats and golden/death cross detection all reuse it.
* :func:`get_chart_bars` — bars for a UI chart period, trimmed to the real
  calendar window (borsapy's ``period`` is a bar count) or trading sessions.
* :func:`get_quotes` — live quotes for many symbols in one TradingView scanner
  request (websocket quote fallback for indices the scanner lacks, e.g. XUSIN).
"""

import asyncio
from datetime import date, datetime, time as dtime
from typing import Any

import pandas as pd
import structlog

from src.adapters.base import BasePriceAdapter, PriceRecord
from src.adapters.utils import (
    ISTANBUL_TZ,
    TTL_COMPANY_METRICS,
    TTL_DAILY_BARS,
    TTL_INTRADAY_BARS,
    TTL_LONG_BARS,
    TTL_QUOTE,
    ChartPeriod,
    MarketDataError,
    SymbolNotFoundError,
    cached,
    finite_float,
    run_sync,
    tradingview_scan,
)
from src.db.models import PollingState

logger = structlog.get_logger(__name__)

OHLCV_COLUMNS = ["Open", "High", "Low", "Close", "Volume"]

# BIST continuous trading ends 18:00; the closing auction and the trades at the
# closing price ("kapanış fiyatından işlemler") end at 18:10 — İş Yatırım's
# OneEndeks ``updateDate`` of a finished session is 18:09:5x. The free TradingView
# feed is 15 min delayed: a daily bar is final after ~18:30.
SESSION_CLOSE_TIME = dtime(18, 10)
SESSION_FINAL_TIME = dtime(18, 30)

NAN = float("nan")

# Daily frame shared by charts (<= 1 year) and indicators: 730 bars ≈ 3 years,
# enough for SMA200 plus a converged EMA200/Wilder RSI.
DAILY_HISTORY_PERIOD = "2y"
MAX_HISTORY_START = datetime(1985, 1, 1)

# borsapy turns a period into a bar count (5y of weekly bars = 260), which ends
# one or two bars short of the calendar window get_chart_bars trims to, so the
# weekly periods fetch the next longer period.
_LONG_FETCH_PERIOD = {"2y": "5y", "5y": "10y"}

# TradingView columns needed for a quote.
_QUOTE_COLUMNS = (
    "close",
    "open",
    "high",
    "low",
    "volume",
    "change",
    "change_abs",
    "close[1]",
    "market_cap_basic",
    "Value.Traded",
    "description",
    "type",
    "currency",
    "update_time",
    "update_mode",
    "time",
)

TRADINGVIEW_SOURCE = "tradingview"


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------

def now_istanbul() -> datetime:
    return datetime.now(ISTANBUL_TZ)


def is_session_final(bar_date: date, now: datetime | None = None) -> bool:
    """True when the daily bar of ``bar_date`` is a completed session."""
    current = (now or now_istanbul()).astimezone(ISTANBUL_TZ)
    if bar_date < current.date():
        return True
    return bar_date == current.date() and current.time() >= SESSION_FINAL_TIME


SESSION_OPEN = "open"
SESSION_CLOSED = "closed"


def session_state(session_date: date | None, now: datetime | None = None) -> str | None:
    """``"closed"`` once the session's daily bar is final (:func:`is_session_final`), else ``"open"``."""
    if not isinstance(session_date, date):
        return None
    return SESSION_CLOSED if is_session_final(session_date, now) else SESSION_OPEN


def session_close_epoch(session_date: date) -> int:
    return int(datetime.combine(session_date, SESSION_CLOSE_TIME, tzinfo=ISTANBUL_TZ).timestamp())


def cap_to_session_close(timestamp: Any, session_date: date | None) -> int | None:
    """Provider time capped at the session's close (18:10 Istanbul).

    TradingView's ``update_time`` keeps advancing after the close (post-close
    refreshes at ~19:20) although the data is the 18:10 state; the payloads show
    the close instead.
    """
    epoch = finite_float(timestamp)
    if epoch is None or epoch <= 0:
        return None
    seconds = int(epoch)
    day = session_date if isinstance(session_date, date) else datetime.fromtimestamp(seconds, ISTANBUL_TZ).date()
    return min(seconds, session_close_epoch(day))


def with_session_view(quote: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    """Copy of a canonical quote for API payloads: ``timestamp``/``updated_at`` capped at the
    session close (:func:`cap_to_session_close`) and the additive ``session_state``
    (``"open"`` | ``"closed"``, ``None`` when the session day is unknown)."""
    view = dict(quote)
    session_date = quote.get("session_date")
    day = session_date if isinstance(session_date, date) else None
    timestamp = cap_to_session_close(quote.get("timestamp"), day)
    if timestamp is not None:
        view["timestamp"] = timestamp
        view["updated_at"] = _epoch_to_iso(timestamp)
    if day is None and timestamp is not None:
        day = datetime.fromtimestamp(timestamp, ISTANBUL_TZ).date()
    view["session_state"] = session_state(day, now)
    return view


# ---------------------------------------------------------------------------
# Bars
# ---------------------------------------------------------------------------

def clean_bars(df: Any) -> pd.DataFrame:
    """Normalize a borsapy OHLCV frame: numeric, finite, tz-aware Istanbul index.

    Drops rows without a positive close, keeps High/Low consistent with
    Open/Close and turns an all-zero Volume column (candles that arrive
    without a volume field, e.g. some indices) into missing values.
    """
    if df is None or getattr(df, "empty", True):
        return pd.DataFrame(columns=OHLCV_COLUMNS, index=pd.DatetimeIndex([], tz=ISTANBUL_TZ, name="Date"))
    frame = pd.DataFrame(index=df.index)
    for column in OHLCV_COLUMNS:
        frame[column] = pd.to_numeric(df[column], errors="coerce") if column in df.columns else NAN
    frame = frame.replace([float("inf"), float("-inf")], NAN)
    frame = frame[frame["Close"] > 0]
    for column in ("Open", "High", "Low"):
        frame.loc[frame[column] <= 0, column] = NAN

    index = pd.DatetimeIndex(frame.index)
    index = index.tz_localize(ISTANBUL_TZ) if index.tz is None else index.tz_convert(ISTANBUL_TZ)
    frame.index = index.rename("Date")
    frame = frame[~frame.index.duplicated(keep="last")].sort_index()

    price_cols = frame[["Open", "High", "Low", "Close"]]
    frame["High"] = price_cols.max(axis=1, skipna=True)
    frame["Low"] = price_cols.min(axis=1, skipna=True)
    if frame["Volume"].fillna(0).eq(0).all():
        frame["Volume"] = NAN
    frame.loc[frame["Volume"] < 0, "Volume"] = NAN
    return frame


def bars_to_records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    """Chart rows ``{Date: ISO-8601 (+03:00), Open, High, Low, Close, Volume}``; NaN → None."""
    records: list[dict[str, Any]] = []
    for timestamp, row in zip(frame.index, frame.itertuples(index=False, name=None)):
        record: dict[str, Any] = {"Date": pd.Timestamp(timestamp).isoformat()}
        for column, value in zip(frame.columns, row):
            record[column] = finite_float(value)
        records.append(record)
    return records


def _history_sync(symbol: str, period: str | None, interval: str, start: datetime | None) -> Any:
    import borsapy as bp

    # TradingView serves stocks and indices (XU100) through the same endpoint.
    ticker = bp.Ticker(symbol)
    if start is not None:
        return ticker.history(interval=interval, start=start)
    return ticker.history(period=period or "1mo", interval=interval)


def _history_error(symbol: str, exc: Exception) -> MarketDataError:
    text = str(exc).lower()
    if "invalid symbol" in text or "symbol_error" in text or "not found" in text:
        return SymbolNotFoundError(symbol)
    logger.warning("price_history_upstream_error", symbol=symbol, error=str(exc))
    return MarketDataError("Fiyat geçmişi sağlayıcıdan alınamadı", status_code=503)


async def _load_bars(symbol: str, period: str | None, interval: str, start: datetime | None = None) -> pd.DataFrame:
    try:
        raw = await run_sync(_history_sync, symbol, period, interval, start)
    except Exception as e:
        raise _history_error(symbol, e) from e
    return clean_bars(raw)


@cached(TTL_DAILY_BARS, "bars")
async def get_daily_bars(symbol: str) -> pd.DataFrame:
    """Shared ~730-bar daily frame (read-only — copy before mutating)."""
    return await _load_bars(symbol, DAILY_HISTORY_PERIOD, "1d")


@cached(TTL_INTRADAY_BARS, "bars")
async def _get_intraday_bars(symbol: str, period: str, interval: str) -> pd.DataFrame:
    return await _load_bars(symbol, period, interval)


@cached(TTL_LONG_BARS, "bars")
async def _get_long_bars(symbol: str, period: str, interval: str) -> pd.DataFrame:
    if period == "max":
        return await _load_bars(symbol, None, interval, start=MAX_HISTORY_START)
    return await _load_bars(symbol, _LONG_FETCH_PERIOD.get(period, period), interval)


def last_sessions(frame: pd.DataFrame, sessions: int) -> pd.DataFrame:
    """Keep the bars of the ``sessions`` most recent trading days."""
    if frame.empty:
        return frame
    days = pd.DatetimeIndex(frame.index).normalize()
    first_kept = days.unique()[-sessions:][0]
    return frame[days >= first_kept]


def window_start(spec: ChartPeriod, now: datetime | None = None) -> pd.Timestamp | None:
    """First timestamp kept for a calendar-window period (None = keep all)."""
    current = pd.Timestamp(now or now_istanbul()).tz_convert(ISTANBUL_TZ)
    if spec.ytd:
        return pd.Timestamp(year=current.year, month=1, day=1, tz=ISTANBUL_TZ)
    if spec.months:
        return (current - pd.DateOffset(months=spec.months)).normalize()
    return None


# Frontend indicator warmup (SMA/RSI/MACD need bars before the visible window
# to be correct at its left edge) and a little room to pan left. Validated by
# the router via FastAPI's Query(..., le=MAX_CHART_WARMUP_BARS).
MAX_CHART_WARMUP_BARS = 300


def split_chart_window(
    frame: pd.DataFrame, spec: ChartPeriod, now: datetime | None = None
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """``(bars inside the period's window, bars before the window)``."""
    if spec.sessions is not None:
        window = last_sessions(frame, spec.sessions)
        if window.empty:
            return window, frame.iloc[:0]
        return window, frame[frame.index < window.index[0]]
    start = window_start(spec, now)
    if start is None:
        return frame, frame.iloc[:0]
    return frame[frame.index >= start], frame[frame.index < start]


def period_reference(before: pd.DataFrame) -> dict[str, Any]:
    """Base of the period change: the last close strictly before the window.

    ``reference_date`` is that bar's Istanbul date (for 1g/5g the previous
    session, so ``reference_close`` is the previous close); both are ``None``
    when the fetched history does not reach before the window (``max``, new listings).
    """
    closes = before["Close"].dropna() if "Close" in before else pd.Series(dtype=float)
    close = finite_float(closes.iloc[-1]) if not closes.empty else None
    if close is None:
        return {"reference_close": None, "reference_date": None}
    return {"reference_close": close, "reference_date": pd.Timestamp(closes.index[-1]).date().isoformat()}


async def _chart_source_bars(symbol: str, spec: ChartPeriod) -> pd.DataFrame:
    if spec.sessions is not None:
        # borsapy requests "period" worth of bars counted back from the last
        # bar: 5d@15m ≈ 5 sessions, 1mo@30m ≈ 29 sessions — always enough
        # history (plus the previous session) even across multi-day holidays.
        fetch_period = "5d" if spec.sessions == 1 else "1mo"
        return await _get_intraday_bars(symbol, fetch_period, spec.interval)
    if spec.interval == "1d":
        return await get_daily_bars(symbol)
    return await _get_long_bars(symbol, spec.yf_period, spec.interval)


async def get_chart_window_parts(symbol: str, spec: ChartPeriod) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    """``(window, before, period_reference(before))`` — ``before`` is exposed for warmup bars."""
    window, before = split_chart_window(await _chart_source_bars(symbol, spec), spec)
    return window, before, period_reference(before)


async def get_chart_window(symbol: str, spec: ChartPeriod) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Bars trimmed to the period's real window plus :func:`period_reference` fields."""
    window, _before, reference = await get_chart_window_parts(symbol, spec)
    return window, reference


async def get_chart_bars(symbol: str, spec: ChartPeriod) -> pd.DataFrame:
    """Bars for a chart period, trimmed to the period's real window."""
    return (await get_chart_window(symbol, spec))[0]


def daily_stats(frame: pd.DataFrame, now: datetime | None = None) -> dict[str, float | None]:
    """52-week range and 50/200-day averages from the shared daily frame."""
    stats: dict[str, float | None] = {
        "year_high": None,
        "year_low": None,
        "fifty_day_average": None,
        "two_hundred_day_average": None,
    }
    if frame.empty:
        return stats
    current = pd.Timestamp(now or now_istanbul()).tz_convert(ISTANBUL_TZ)
    last_year = frame[frame.index >= current - pd.DateOffset(years=1)]
    if not last_year.empty:
        stats["year_high"] = finite_float(last_year["High"].max())
        stats["year_low"] = finite_float(last_year["Low"].min())
    closes = frame["Close"].dropna()
    if len(closes) >= 50:
        stats["fifty_day_average"] = round(float(closes.tail(50).mean()), 4)
    if len(closes) >= 200:
        stats["two_hundred_day_average"] = round(float(closes.tail(200).mean()), 4)
    return stats


# ---------------------------------------------------------------------------
# Quotes
# ---------------------------------------------------------------------------

def _positive(value: Any) -> float | None:
    number = finite_float(value)
    return number if number is not None and number > 0 else None


def _non_negative(value: Any) -> float | None:
    number = finite_float(value)
    return number if number is not None and number >= 0 else None


def _epoch_to_iso(value: Any) -> str | None:
    seconds = finite_float(value)
    if seconds is None or seconds <= 0:
        return None
    return datetime.fromtimestamp(seconds, ISTANBUL_TZ).isoformat()


def build_quote(
    symbol: str,
    *,
    last: Any,
    prev_close: Any,
    open_: Any = None,
    high: Any = None,
    low: Any = None,
    volume: Any = None,
    turnover: Any = None,
    market_cap: Any = None,
    name: Any = None,
    type_: Any = None,
    currency: Any = None,
    timestamp: Any = None,
) -> dict[str, Any] | None:
    """Canonical quote dict; change/change_percent are always derived from last vs prev_close."""
    last_price = _positive(last)
    if last_price is None:
        return None
    previous = _positive(prev_close)
    change = round(last_price - previous, 6) if previous is not None else None
    change_percent = round((last_price - previous) / previous * 100, 6) if previous is not None else None
    epoch = finite_float(timestamp)
    return {
        "symbol": symbol,
        "name": name if isinstance(name, str) and name else None,
        "type": type_ if isinstance(type_, str) and type_ else None,
        "currency": currency if isinstance(currency, str) and currency else None,
        "last": last_price,
        "open": _positive(open_),
        "high": _positive(high),
        "low": _positive(low),
        "prev_close": round(previous, 6) if previous is not None else None,
        "change": change,
        "change_percent": change_percent,
        "volume": _non_negative(volume),
        "turnover": _non_negative(turnover),
        "market_cap": _positive(market_cap),
        "timestamp": int(epoch) if epoch is not None and epoch > 0 else None,
        "updated_at": _epoch_to_iso(epoch),
    }


def delay_from_update_mode(value: Any) -> int | None:
    """``"delayed_streaming_900"`` → 900, ``"streaming"`` → 0 (seconds of provider delay)."""
    if not isinstance(value, str) or not value:
        return None
    tail = value.rsplit("_", 1)[-1]
    if tail.isdigit():
        return int(tail)
    return 0 if value in ("streaming", "realtime") else None


def session_date_from_epoch(value: Any) -> date | None:
    """Istanbul trading day of a TradingView bar time (``time`` = the daily bar's open)."""
    seconds = finite_float(value)
    if seconds is None or seconds <= 0:
        return None
    return datetime.fromtimestamp(seconds, ISTANBUL_TZ).date()


def quote_from_scan(symbol: str, row: dict[str, Any]) -> dict[str, Any] | None:
    """Quote from a TradingView scanner row (``change_abs`` is today's move vs previous close).

    Store fields (additive): ``session_date`` (Istanbul day of the daily bar the
    quote belongs to), ``delay_seconds`` (feed delay), ``prev_bar_close`` (close
    of the previous daily bar, ``close[1]``) and ``source``.
    """
    last = _positive(row.get("close"))
    prev_bar_close = _positive(row.get("close[1]"))
    prev_close = prev_bar_close
    change_abs = finite_float(row.get("change_abs"))
    if last is not None and change_abs is not None and last - change_abs > 0:
        prev_close = last - change_abs
    quote = build_quote(
        symbol,
        last=last,
        prev_close=prev_close,
        open_=row.get("open"),
        high=row.get("high"),
        low=row.get("low"),
        volume=row.get("volume"),
        turnover=row.get("Value.Traded"),
        market_cap=row.get("market_cap_basic"),
        name=row.get("description"),
        type_=row.get("type"),
        currency=row.get("currency"),
        timestamp=row.get("update_time"),
    )
    if quote is None:
        return None
    session_date = session_date_from_epoch(row.get("time"))
    if session_date is None and quote["timestamp"] is not None:
        session_date = session_date_from_epoch(quote["timestamp"])
    quote.update(
        session_date=session_date,
        delay_seconds=delay_from_update_mode(row.get("update_mode")),
        prev_bar_close=prev_bar_close,
        source=TRADINGVIEW_SOURCE,
    )
    return quote


def _known_index(symbol: str) -> bool:
    try:
        from borsapy.index import INDICES
    except ImportError:  # pragma: no cover - borsapy is a hard dependency
        return False
    return symbol in INDICES


def _websocket_quote_sync(symbol: str) -> dict[str, Any]:
    import borsapy as bp

    return dict(bp.Index(symbol).info)


async def _websocket_index_quote(symbol: str, semaphore: asyncio.Semaphore) -> dict[str, Any] | None:
    """TradingView websocket quote for an index (one retry — concurrent sessions get rate limited)."""
    async with semaphore:
        for attempt in (1, 2):
            try:
                info = await run_sync(_websocket_quote_sync, symbol)
                quote = build_quote(
                    symbol,
                    last=info.get("last"),
                    prev_close=info.get("prev_close"),
                    open_=info.get("open"),
                    high=info.get("high"),
                    low=info.get("low"),
                    volume=info.get("volume"),
                    name=info.get("description"),
                    type_=info.get("type"),
                    currency=info.get("currency"),
                    timestamp=info.get("timestamp"),
                )
                if quote is not None:
                    quote.update(
                        session_date=session_date_from_epoch(quote["timestamp"]),
                        delay_seconds=None,
                        prev_bar_close=None,
                        source=TRADINGVIEW_SOURCE,
                    )
                    return quote
            except Exception as e:
                if attempt == 2:
                    logger.warning("index_quote_websocket_error", symbol=symbol, error=str(e))
            if attempt == 1:
                await asyncio.sleep(1.0)
    return None


@cached(TTL_QUOTE, "quotes")
async def get_quotes(symbols: tuple[str, ...]) -> dict[str, dict[str, Any]]:
    """Live quotes keyed by symbol; symbols without a quote are absent."""
    quotes: dict[str, dict[str, Any]] = {}
    scan_error: MarketDataError | None = None
    try:
        rows = await tradingview_scan(symbols, _QUOTE_COLUMNS)
    except MarketDataError as e:
        rows, scan_error = {}, e
    for symbol in symbols:
        row = rows.get(symbol)
        quote = quote_from_scan(symbol, row) if row else None
        if quote is not None:
            quotes[symbol] = quote

    missing = [symbol for symbol in symbols if symbol not in quotes and _known_index(symbol)]
    if missing:
        semaphore = asyncio.Semaphore(4)
        fallback = await asyncio.gather(*(_websocket_index_quote(s, semaphore) for s in missing))
        quotes.update({s: q for s, q in zip(missing, fallback) if q is not None})
    if not quotes and scan_error is not None:
        raise scan_error
    return quotes


# ---------------------------------------------------------------------------
# Company card metrics (İş Yatırım) — market cap, F/K, PD/DD, free float
# ---------------------------------------------------------------------------

def _company_metrics_sync(symbol: str) -> dict[str, Any]:
    # borsapy has no public accessor for the metrics alone: Ticker.fast_info
    # also downloads a year of bars and a quote we already have.
    from borsapy._providers.isyatirim import get_isyatirim_provider

    return dict(get_isyatirim_provider().get_company_metrics(symbol))


@cached(TTL_COMPANY_METRICS, "company_metrics")
async def get_company_metrics(symbol: str) -> dict[str, Any]:
    try:
        metrics = await run_sync(_company_metrics_sync, symbol)
    except Exception as e:
        logger.warning("company_metrics_unavailable", symbol=symbol, error=str(e))
        raise MarketDataError("Şirket kartı verisi alınamadı", status_code=503) from e
    return {key: finite_float(metrics.get(key)) for key in (
        "market_cap", "pe_ratio", "pb_ratio", "ev_ebitda", "free_float", "foreign_ratio", "net_debt",
    )}


# ---------------------------------------------------------------------------
# DB ingest adapter (polling worker)
# ---------------------------------------------------------------------------

def _opt_float(value: Any) -> float | None:
    return finite_float(value)


class PriceAdapter(BasePriceAdapter):
    """Legacy per-company price poll (``polling_worker`` source ``price``): borsapy birincil, yfinance yedek.

    Superseded by ``market.bars.daily`` (one scanner request for the whole universe);
    kept until the ``price`` source leaves ``POLL_SOURCES``. Writes go through the
    market store's precedence rules (``PriceService``), so these rows never override
    a canonical TradingView bar.

    Only completed sessions are emitted, so a stored ``close`` is always a real
    session close. The price repository upserts changed values, so later
    corrections to a stored bar (e.g. closing-price trades that arrive after
    SESSION_FINAL_TIME) still land.
    """

    def __init__(self, ticker: str = "THYAO"):
        self.ticker = ticker

    def get_source_code(self) -> str:
        return "price"

    async def fetch_prices(
        self, polling_state: PollingState | None = None, days: int | None = None
    ) -> list[PriceRecord]:
        records = await self._fetch_via_borsapy(days=days)
        if not records:
            logger.warning("borsapy_price_empty_fallback_to_yfinance", ticker=self.ticker)
            records = await self._fetch_via_yfinance(days=days)
        return records

    @staticmethod
    def _period_for_days(days: int | None) -> str:
        """Map a backfill day count to the smallest covering borsapy period."""
        if days is None:
            return "1mo"
        for limit, period in [(5, "5d"), (30, "1mo"), (90, "3mo"), (180, "6mo"), (365, "1y"), (730, "2y"), (1825, "5y")]:
            if days <= limit:
                return period
        return "max"

    def _records_from_frame(self, df: Any, source: str, now: datetime | None = None) -> list[PriceRecord]:
        records: list[PriceRecord] = []
        for idx, row in df.iterrows():
            timestamp = pd.Timestamp(idx)
            if timestamp.tzinfo is not None:
                timestamp = timestamp.tz_convert(ISTANBUL_TZ)
            trading_date = timestamp.date()
            if not is_session_final(trading_date, now):
                continue
            close = _opt_float(row.get("Close"))
            if close is None or close <= 0:
                continue
            records.append(
                PriceRecord(
                    ticker=self.ticker,
                    source=source,
                    open=_opt_float(row.get("Open")),
                    high=_opt_float(row.get("High")),
                    low=_opt_float(row.get("Low")),
                    close=close,
                    volume=_opt_float(row.get("Volume")),
                    trading_date=trading_date,  # type: ignore[arg-type]  # DB column is a DATE
                    interval="1d",
                )
            )
        return records

    async def _fetch_via_borsapy(self, days: int | None = None) -> list[PriceRecord]:
        period = self._period_for_days(days)
        try:
            import borsapy as bp

            ticker = await run_sync(bp.Ticker, self.ticker)
            df = await run_sync(lambda: ticker.history(period=period, interval="1d"))

            if df is None or df.empty:
                logger.info("borsapy_price_no_data", ticker=self.ticker)
                return []

            records = self._records_from_frame(df, "borsapy")
            logger.info("borsapy_price_fetched", ticker=self.ticker, count=len(records))
            return records

        except Exception as e:
            logger.error("borsapy_price_error", ticker=self.ticker, error=str(e))
            return []

    async def _fetch_via_yfinance(self, days: int | None = None) -> list[PriceRecord]:
        period = self._period_for_days(days)
        try:
            import yfinance as yf

            yf_ticker = f"{self.ticker}.IS"
            ticker = await run_sync(yf.Ticker, yf_ticker)
            df = await run_sync(lambda: ticker.history(period=period))

            if df is None or df.empty:
                logger.info("yfinance_price_no_data", ticker=self.ticker)
                return []

            records = self._records_from_frame(df, "yfinance")
            logger.info("yfinance_price_fetched", ticker=self.ticker, count=len(records))
            return records

        except Exception as e:
            logger.error("yfinance_price_error", ticker=self.ticker, error=str(e))
            return []
