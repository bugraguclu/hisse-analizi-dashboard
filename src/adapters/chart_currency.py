"""Chart bars in US dollars: BIST prices divided by USD/TRY, bar by bar.

Every bar's open, high, low and close are divided by one rate, the close of the
matching FX_IDC:USDTRY bar (the /makro page's source): the same 15/30-minute
slot, the same Istanbul day, week or month, or the latest earlier bar when that
one is missing (holidays, a feed gap). One rate per bar keeps each candle's
shape, like TradingView's own price-scale currency conversion; volume stays in
lots. Bars older than the fetched USD/TRY history are dropped.

TradingView's conversion itself (``currency-id`` in the symbol request) is not
used: its USD/TRY runs about 2 % above FX_IDC, so a price would not match
"price ÷ USD/TRY" elsewhere on the site. Spread symbols (THYAO/USDTRY) need a
paid plan on intraday bars.
"""

import asyncio
import math
from datetime import datetime, timedelta
from typing import Any, Literal

import pandas as pd
import structlog

from src.adapters import price, tradingview_chart
from src.adapters.utils import (
    ISTANBUL_TZ,
    TTL_DAILY_BARS,
    TTL_INTRADAY_BARS,
    TTL_LONG_BARS,
    ChartPeriod,
    MarketDataError,
    cached,
    finite_float,
    run_sync,
)
from src.services import market_service

logger = structlog.get_logger(__name__)

Currency = Literal["TRY", "USD"]

FX_SYMBOL = "USDTRY"
FX_EXCHANGE = "FX_IDC"
FX_SOURCE = "TradingView FX_IDC:USDTRY"

# Calendar days of USD/TRY needed by the intraday charts: 1g shows 15-minute bars
# fetched 5 days deep, 5g 30-minute bars fetched a month deep (plus their warmup).
_INTRADAY_DAYS = {"15m": 21, "30m": 45}
# borsapy sizes an intraday request by BIST session minutes (510 a day), but
# USD/TRY trades around the clock: a start this many times further back buys
# the calendar days above.
_FX_DAY_FACTOR = 1440 / 510
_CALENDAR_INTERVALS = frozenset({"1d", "1wk", "1mo"})
# FX days roll late in the evening (22:00 UTC, 23:00 local in older years):
# shifting by a few hours puts every bar on the day it trades for.
_DAY_SHIFT = pd.Timedelta(hours=4)


def _fx_history_sync(interval: str) -> Any:
    if interval in _INTRADAY_DAYS:
        start = datetime.now() - timedelta(days=math.ceil(_INTRADAY_DAYS[interval] * _FX_DAY_FACTOR))
        return tradingview_chart.get_history(FX_SYMBOL, interval=interval, start=start, exchange=FX_EXCHANGE)
    if interval == "1d":
        # ≈ 7 years of weekdays: the stored daily frame (≈ 3 years) with its warmup.
        return tradingview_chart.get_history(FX_SYMBOL, period="5y", interval="1d", exchange=FX_EXCHANGE)
    return tradingview_chart.get_history(FX_SYMBOL, interval=interval, start=price.MAX_HISTORY_START, exchange=FX_EXCHANGE)


async def _load_fx(interval: str) -> pd.DataFrame:
    try:
        raw = await run_sync(_fx_history_sync, interval)
    except Exception as e:
        logger.warning("fx_history_upstream_error", interval=interval, error=str(e))
        raise MarketDataError("USD/TRY kuru alınamadı", status_code=503) from e
    frame = price.clean_bars(raw)
    if frame.empty:
        raise MarketDataError("USD/TRY kuru alınamadı", status_code=503)
    return frame


@cached(TTL_INTRADAY_BARS, "fx_bars")
async def _intraday_fx(interval: str) -> pd.DataFrame:
    return await _load_fx(interval)


@cached(TTL_DAILY_BARS, "fx_bars")
async def _daily_fx() -> pd.DataFrame:
    return await _load_fx("1d")


@cached(TTL_LONG_BARS, "fx_bars")
async def _long_fx(interval: str) -> pd.DataFrame:
    return await _load_fx(interval)


async def usdtry_bars(interval: str) -> pd.DataFrame:
    """USD/TRY bars at a chart interval (shared cached frame — copy before mutating)."""
    if interval in _INTRADAY_DAYS:
        return await _intraday_fx(interval)
    if interval == "1d":
        return await _daily_fx()
    return await _long_fx(interval)


def _buckets(index: pd.Index, interval: str) -> pd.DatetimeIndex:
    """Naive Istanbul wall time two bars share when they cover the same slot, day, week or month."""
    local = pd.DatetimeIndex(index).tz_convert(ISTANBUL_TZ)
    if interval not in _CALENDAR_INTERVALS:
        return local.tz_localize(None)
    days = (local + _DAY_SHIFT).tz_localize(None).normalize()
    if interval == "1wk":
        return days - pd.to_timedelta(days.weekday, unit="D")
    if interval == "1mo":
        return days - pd.to_timedelta(days.day - 1, unit="D")
    return days


def to_usd(frame: pd.DataFrame, fx: pd.DataFrame, interval: str) -> pd.DataFrame:
    """``frame`` with each bar's prices divided by its USD/TRY close; bars older than ``fx`` are dropped."""
    if frame.empty:
        return frame.copy()
    closes = fx["Close"].dropna()
    rates = (
        pd.DataFrame({"bucket": _buckets(closes.index, interval), "rate": closes.to_numpy(dtype=float)})
        .sort_values("bucket", kind="stable")
        .drop_duplicates("bucket", keep="last")
    )
    keys = pd.DataFrame({"bucket": _buckets(frame.index, interval)})
    rate = pd.merge_asof(keys, rates, on="bucket", direction="backward")["rate"].to_numpy()
    usd = frame.copy()
    for column in ("Open", "High", "Low", "Close"):
        usd[column] = frame[column].to_numpy(dtype=float) / rate
    return usd[~pd.isna(rate)]


def fx_info(fx: pd.DataFrame) -> dict[str, Any]:
    """The response's ``fx`` block: the newest USD/TRY close (what the latest bar is divided by) and its bar's start."""
    closes = fx["Close"].dropna()
    return {
        "pair": "USD/TRY",
        "source": FX_SOURCE,
        "rate": finite_float(closes.iloc[-1]),
        "bar_time": pd.Timestamp(closes.index[-1]).isoformat(),
    }


async def usd_chart_window(
    symbol: str, spec: ChartPeriod, *, warmup: int = 0
) -> tuple[market_service.ChartWindow, dict[str, Any]]:
    """:func:`market_service.get_chart_window` in US dollars, with the ``fx`` block."""
    chart, fx = await asyncio.gather(
        market_service.get_chart_window(symbol, spec, warmup=warmup), usdtry_bars(spec.interval)
    )
    before = to_usd(chart.before, fx, spec.interval)
    window = market_service.ChartWindow(to_usd(chart.bars, fx, spec.interval), price.period_reference(before), chart.meta, before)
    return window, fx_info(fx)
