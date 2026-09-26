"""Teknik analiz adaptoru.

Sources:

* **Market store daily bars** (``market_service``; the market worker keeps the
  TradingView daily series current, core companies with 5 years of history) —
  when the stored series is fresh, daily indicators are computed from it with
  the Pine Script definitions: RSI, MACD, Bollinger, Stochastic, SMA/EMA,
  SuperTrend(10,3), classic pivots and golden/death crosses. On TradingView's own
  bars these reproduce the scanner's values to floating-point precision (measured
  2026-09-23 on 10 symbols: |Δ| ≤ 1e-11; EMA needs ~6 × period bars to converge,
  so EMA200 on a 2-year universe series falls back to TradingView's value).
* **TradingView scanner** — one request returns oscillator / moving-average
  inputs for all nine timeframes plus TradingView's official technical rating
  (``Recommend.All`` / ``Recommend.MA`` / ``Recommend.Other``). Used for the
  ratings, the intraday timeframes and whenever the store is not fresh.
* **Live daily bars** (``market_service.get_daily_bars`` falls back to one cached
  ~730-bar TradingView frame, written through to the store) when the scanner is
  unreachable or for periods TradingView does not publish (e.g. RSI(7), SMA(21)).

Every payload carries an additive ``meta`` block (source, served_from, delay).
"""

import asyncio
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import pandas as pd
import structlog

from src.adapters.price import is_session_final
from src.adapters.utils import (
    TTL_TECHNICAL,
    MarketDataError,
    SymbolNotFoundError,
    cached,
    error_payload,
    finite_float,
    tradingview_scan,
)
from src.core.meta import DataMeta
from src.services import market_service

logger = structlog.get_logger(__name__)

SOURCE_TRADINGVIEW = "TradingView"
SOURCE_LOCAL = "Günlük barlardan hesaplandı"

BUY, SELL, NEUTRAL = "BUY", "SELL", "NEUTRAL"

# Timeframe key -> TradingView column suffix (daily has none).
TA_INTERVALS: dict[str, str] = {
    "1m": "|1",
    "5m": "|5",
    "15m": "|15",
    "30m": "|30",
    "1h": "|60",
    "4h": "|240",
    "1d": "",
    "1W": "|1W",
    "1M": "|1M",
}

TV_MA_PERIODS = (5, 10, 20, 30, 50, 100, 200)   # SMA/EMA lengths TradingView publishes
RATED_MA_PERIODS = (10, 20, 30, 50, 100, 200)   # lengths inside TradingView's MA rating
DASHBOARD_MA_PERIODS = (10, 20, 50, 100, 200)   # /moving-averages table

_RATING_COLUMNS = ("Recommend.All", "Recommend.MA", "Recommend.Other")
_OSCILLATOR_COLUMNS = (
    "RSI", "RSI[1]", "Stoch.K", "Stoch.D", "Stoch.K[1]", "Stoch.D[1]", "CCI20", "CCI20[1]",
    "ADX", "ADX+DI", "ADX-DI", "ADX+DI[1]", "ADX-DI[1]", "AO", "AO[1]", "AO[2]", "Mom", "Mom[1]",
    "MACD.macd", "MACD.signal", "Rec.Stoch.RSI", "Stoch.RSI.K", "Rec.WR", "W.R",
    "Rec.BBPower", "BBPower", "Rec.UO", "UO",
)
_MA_COLUMNS = tuple(f"{kind}{p}" for p in TV_MA_PERIODS for kind in ("EMA", "SMA")) + (
    "Rec.Ichimoku", "Ichimoku.BLine", "Rec.VWMA", "VWMA", "Rec.HullMA9", "HullMA9",
    "close", "BB.upper", "BB.lower", "BB.basis", "ATR", "P.SAR", "VWAP", "relative_volume_10d_calc",
)
_TA_COLUMNS = _RATING_COLUMNS + _OSCILLATOR_COLUMNS + _MA_COLUMNS


def _round(value: Any, digits: int = 4) -> float | None:
    number = finite_float(value)
    return round(number, digits) if number is not None else None


# ---------------------------------------------------------------------------
# TradingView technical rating (mirrors TradingView's "Technical Ratings" rules)
# ---------------------------------------------------------------------------

def rating_label(score: float | None) -> str:
    """TradingView thresholds: <-0.5 strong sell, <-0.1 sell, ≤0.1 neutral, ≤0.5 buy, else strong buy."""
    if score is None:
        return NEUTRAL
    if score < -0.5:
        return "STRONG_SELL"
    if score < -0.1:
        return SELL
    if score <= 0.1:
        return NEUTRAL
    if score <= 0.5:
        return BUY
    return "STRONG_BUY"


def _simple(value: float | None) -> str:
    """TradingView pre-computed ``Rec.*`` columns are -1 / 0 / +1."""
    if value is None or value == 0:
        return NEUTRAL
    return BUY if value > 0 else SELL


def _oscillator_ratings(raw: dict[str, Any]) -> tuple[dict[str, str], dict[str, float | None]]:
    v = {key: finite_float(raw.get(key)) for key in _OSCILLATOR_COLUMNS}
    compute: dict[str, str] = {}
    values: dict[str, float | None] = {}

    rsi, rsi1 = v["RSI"], v["RSI[1]"]
    if rsi is not None:
        values["RSI"] = _round(rsi, 2)
        if rsi1 is not None:
            compute["RSI"] = BUY if rsi < 30 and rsi1 < rsi else SELL if rsi > 70 and rsi1 > rsi else NEUTRAL

    k, d, k1, d1 = v["Stoch.K"], v["Stoch.D"], v["Stoch.K[1]"], v["Stoch.D[1]"]
    if k is not None:
        values["Stoch.K"] = _round(k, 2)
        values["Stoch.D"] = _round(d, 2)
        if d is not None and k1 is not None and d1 is not None:
            if k < 20 and d < 20 and k > d and k1 < d1:
                compute["Stoch.K"] = BUY
            elif k > 80 and d > 80 and k < d and k1 > d1:
                compute["Stoch.K"] = SELL
            else:
                compute["Stoch.K"] = NEUTRAL

    cci, cci1 = v["CCI20"], v["CCI20[1]"]
    if cci is not None:
        values["CCI20"] = _round(cci, 2)
        if cci1 is not None:
            compute["CCI20"] = BUY if cci < -100 and cci > cci1 else SELL if cci > 100 and cci < cci1 else NEUTRAL

    adx, pdi, ndi, pdi1, ndi1 = v["ADX"], v["ADX+DI"], v["ADX-DI"], v["ADX+DI[1]"], v["ADX-DI[1]"]
    if adx is not None:
        values["ADX"] = _round(adx, 2)
        values["ADX+DI"] = _round(pdi, 2)
        values["ADX-DI"] = _round(ndi, 2)
        if pdi is not None and ndi is not None and pdi1 is not None and ndi1 is not None:
            if adx > 20 and pdi1 < ndi1 and pdi > ndi:
                compute["ADX"] = BUY
            elif adx > 20 and pdi1 > ndi1 and pdi < ndi:
                compute["ADX"] = SELL
            else:
                compute["ADX"] = NEUTRAL

    ao, ao1, ao2 = v["AO"], v["AO[1]"], v["AO[2]"]
    if ao is not None:
        values["AO"] = _round(ao)
        if ao1 is not None and ao2 is not None:
            if (ao > 0 and ao1 < 0) or (ao > 0 and ao1 > 0 and ao > ao1 and ao2 > ao1):
                compute["AO"] = BUY
            elif (ao < 0 and ao1 > 0) or (ao < 0 and ao1 < 0 and ao < ao1 and ao2 < ao1):
                compute["AO"] = SELL
            else:
                compute["AO"] = NEUTRAL

    mom, mom1 = v["Mom"], v["Mom[1]"]
    if mom is not None:
        values["Mom"] = _round(mom)
        if mom1 is not None:
            compute["Mom"] = BUY if mom > mom1 else SELL if mom < mom1 else NEUTRAL

    macd, signal = v["MACD.macd"], v["MACD.signal"]
    if macd is not None:
        values["MACD.macd"] = _round(macd)
        values["MACD.signal"] = _round(signal)
        if signal is not None:
            compute["MACD"] = BUY if macd > signal else SELL if macd < signal else NEUTRAL

    for rec_key, value_key, name in (
        ("Rec.Stoch.RSI", "Stoch.RSI.K", "Stoch.RSI"),
        ("Rec.WR", "W.R", "W.R"),
        ("Rec.BBPower", "BBPower", "BBPower"),
        ("Rec.UO", "UO", "UO"),
    ):
        if v[rec_key] is not None:
            values[value_key] = _round(v[value_key])
            compute[name] = _simple(v[rec_key])
    return compute, values


def _moving_average_ratings(raw: dict[str, Any]) -> tuple[dict[str, str], dict[str, float | None]]:
    close = finite_float(raw.get("close"))
    compute: dict[str, str] = {}
    values: dict[str, float | None] = {}
    if close is not None:
        values["close"] = _round(close)
    for period in TV_MA_PERIODS:
        for kind in ("EMA", "SMA"):
            key = f"{kind}{period}"
            ma = finite_float(raw.get(key))
            if ma is None:
                continue
            values[key] = _round(ma)
            # EMA5/SMA5 are published but are not part of TradingView's rating.
            if period in RATED_MA_PERIODS and close is not None:
                compute[key] = BUY if ma < close else SELL if ma > close else NEUTRAL
    for rec_key, value_key, name in (
        ("Rec.Ichimoku", "Ichimoku.BLine", "Ichimoku"),
        ("Rec.VWMA", "VWMA", "VWMA"),
        ("Rec.HullMA9", "HullMA9", "HullMA9"),
    ):
        rec = finite_float(raw.get(rec_key))
        if rec is not None:
            values[value_key] = _round(raw.get(value_key))
            compute[name] = _simple(rec)
    upper, lower = finite_float(raw.get("BB.upper")), finite_float(raw.get("BB.lower"))
    if upper is not None:
        values["BB.upper"] = _round(upper)
    if lower is not None:
        values["BB.lower"] = _round(lower)
    basis = finite_float(raw.get("BB.basis"))
    if basis is None and upper is not None and lower is not None:
        basis = (upper + lower) / 2
    if basis is not None:
        values["BB.middle"] = _round(basis)
    for source_key, value_key in (("ATR", "ATR"), ("P.SAR", "P.SAR"), ("VWAP", "VWAP"),
                                  ("relative_volume_10d_calc", "relative_volume")):
        number = finite_float(raw.get(source_key))
        if number is not None:
            values[value_key] = _round(number)
    return compute, values


def _group(compute: dict[str, str], values: dict[str, float | None], tv_score: Any) -> dict[str, Any]:
    buy = sum(1 for signal in compute.values() if signal == BUY)
    sell = sum(1 for signal in compute.values() if signal == SELL)
    neutral = sum(1 for signal in compute.values() if signal == NEUTRAL)
    score = finite_float(tv_score)
    if score is None and compute:
        score = (buy - sell) / len(compute)  # TradingView's group rating: mean of +1/0/-1
    return {
        "recommendation": rating_label(score),
        "buy": buy,
        "sell": sell,
        "neutral": neutral,
        "score": _round(score),
        "compute": compute,
        "values": values,
    }


def build_signals(symbol: str, interval: str, raw: dict[str, Any]) -> dict[str, Any]:
    """TradingView-style signal block for one timeframe.

    Recommendations use TradingView's own rating (the overall rating is the
    average of the MA and oscillator group ratings, so the 17 MA-side
    indicators do not outvote the 11 oscillators); individual signals follow
    TradingView's documented rules. Without rating columns the same scores
    are derived from the counts.
    """
    osc_compute, osc_values = _oscillator_ratings(raw)
    ma_compute, ma_values = _moving_average_ratings(raw)
    if not osc_compute and not ma_compute:
        return {
            "symbol": symbol,
            "exchange": "BIST",
            "interval": interval,
            "error": "Bu zaman dilimi için teknik veri yok",
        }
    oscillators = _group(osc_compute, osc_values, raw.get("Recommend.Other"))
    moving_averages = _group(ma_compute, ma_values, raw.get("Recommend.MA"))
    score = finite_float(raw.get("Recommend.All"))
    if score is None:
        group_scores = [g["score"] for g in (oscillators, moving_averages) if g["compute"] and g["score"] is not None]
        score = sum(group_scores) / len(group_scores) if group_scores else None
    return {
        "summary": {
            "recommendation": rating_label(score),
            "buy": oscillators["buy"] + moving_averages["buy"],
            "sell": oscillators["sell"] + moving_averages["sell"],
            "neutral": oscillators["neutral"] + moving_averages["neutral"],
            "score": _round(score),
        },
        "oscillators": oscillators,
        "moving_averages": moving_averages,
        "symbol": symbol,
        "exchange": "BIST",
        "interval": interval,
    }


@cached(TTL_TECHNICAL, "tech")
async def _get_ta_bundle_at(ticker: str) -> tuple[dict[str, dict[str, Any]], datetime]:
    """Raw TradingView technical columns for every timeframe (one HTTP request) + fetch time."""
    columns = [f"{column}{suffix}" for suffix in TA_INTERVALS.values() for column in _TA_COLUMNS]
    row = (await tradingview_scan([ticker], columns)).get(ticker)
    if row is None:
        raise SymbolNotFoundError(ticker)
    bundle = {
        interval: {column: row.get(f"{column}{suffix}") for column in _TA_COLUMNS}
        for interval, suffix in TA_INTERVALS.items()
    }
    return bundle, datetime.now(UTC)


async def _get_ta_bundle(ticker: str) -> dict[str, dict[str, Any]]:
    return (await _get_ta_bundle_at(ticker))[0]


def _tv_meta(ticker: str, fetched_at: datetime | None = None) -> DataMeta:
    """TradingView scanner values: always live (15 minute delayed feed)."""
    return market_service.build_meta(
        source=market_service.TV_SOURCE, fetched_at=fetched_at, served_from="live", symbol=ticker
    )


async def load_daily(ticker: str) -> market_service.DailyBars:
    """Store-first daily frame + meta (live TradingView frame when the store misses)."""
    return await market_service.get_daily_bars(ticker)


async def load_stored_daily(ticker: str) -> market_service.DailyBars | None:
    """The stored daily frame when it is fresh (no network), else ``None``."""
    return await market_service.get_stored_daily_bars(ticker)


async def get_daily_bars(ticker: str) -> pd.DataFrame:
    """Store-first daily frame (backwards-compatible accessor)."""
    return (await load_daily(ticker)).frame


# ---------------------------------------------------------------------------
# Local indicator math (Pine Script definitions)
# ---------------------------------------------------------------------------

NAN = float("nan")


def _rma(values: list[float], length: int) -> list[float]:
    """Wilder's moving average (Pine ``ta.rma``): SMA seed, then alpha = 1/length."""
    out = [NAN] * len(values)
    if length <= 0 or len(values) < length:
        return out
    out[length - 1] = sum(values[:length]) / length
    alpha = 1.0 / length
    for i in range(length, len(values)):
        out[i] = alpha * values[i] + (1 - alpha) * out[i - 1]
    return out


def sma_last(close: pd.Series, length: int) -> float | None:
    close = close.dropna()
    if len(close) < length:
        return None
    return float(close.iloc[-length:].mean())


def ema_last(close: pd.Series, length: int) -> float | None:
    """Pine ``ta.ema`` (seeded with the first value, alpha = 2/(length+1))."""
    close = close.dropna()
    if len(close) < length:
        return None
    return float(close.ewm(span=length, adjust=False).mean().iloc[-1])


def rsi_last(close: pd.Series, length: int = 14) -> float | None:
    """Wilder RSI (Pine ``ta.rsi``)."""
    changes = close.dropna().diff().iloc[1:]
    if len(changes) < length:
        return None
    avg_gain = _rma([float(x) for x in changes.clip(lower=0)], length)[-1]
    avg_loss = _rma([float(x) for x in (-changes).clip(lower=0)], length)[-1]
    if avg_loss == 0:
        return 100.0 if avg_gain > 0 else None
    return float(100 - 100 / (1 + avg_gain / avg_loss))


def macd_last(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> dict[str, float] | None:
    close = close.dropna()
    if len(close) < slow + signal:
        return None
    macd_line = close.ewm(span=fast, adjust=False).mean() - close.ewm(span=slow, adjust=False).mean()
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    macd_value, signal_value = float(macd_line.iloc[-1]), float(signal_line.iloc[-1])
    return {"macd": macd_value, "signal": signal_value, "histogram": macd_value - signal_value}


def bollinger_last(close: pd.Series, length: int = 20, std_dev: float = 2.0) -> dict[str, float] | None:
    """Bollinger bands with the population standard deviation (Pine ``ta.stdev``)."""
    window = close.dropna().iloc[-length:]
    if len(window) < length:
        return None
    middle = float(window.mean())
    deviation = float(window.std(ddof=0))
    return {"upper": middle + std_dev * deviation, "middle": middle, "lower": middle - std_dev * deviation}


def stochastic_last(frame: pd.DataFrame, length: int = 14, smooth_k: int = 3, smooth_d: int = 3) -> dict[str, float] | None:
    """Slow stochastic: %K = SMA(raw %K, smooth_k), %D = SMA(%K, smooth_d)."""
    data = frame[["High", "Low", "Close"]].dropna()
    if len(data) < length + smooth_k + smooth_d - 2:
        return None
    lowest = data["Low"].rolling(length).min()
    highest = data["High"].rolling(length).max()
    raw_k = 100 * (data["Close"] - lowest) / (highest - lowest).replace(0, NAN)
    k = raw_k.rolling(smooth_k).mean()
    d = k.rolling(smooth_d).mean()
    k_value, d_value = finite_float(k.iloc[-1]), finite_float(d.iloc[-1])
    if k_value is None or d_value is None:
        return None
    return {"k": k_value, "d": d_value}


def supertrend_last(frame: pd.DataFrame, atr_period: int = 10, multiplier: float = 3.0) -> dict[str, Any] | None:
    """SuperTrend (Pine ``ta.supertrend``) on the last bar.

    ``direction`` is 1 when bullish (price above the line) and -1 when bearish
    (Pine itself uses the opposite sign); ``upper``/``lower`` are the final bands.
    """
    data = frame[["High", "Low", "Close"]].dropna()
    n = len(data)
    if n <= atr_period:
        return None
    high = [float(x) for x in data["High"]]
    low = [float(x) for x in data["Low"]]
    close = [float(x) for x in data["Close"]]
    true_range = [high[0] - low[0]] + [
        max(high[i] - low[i], abs(high[i] - close[i - 1]), abs(low[i] - close[i - 1])) for i in range(1, n)
    ]
    atr = _rma(true_range, atr_period)

    start = atr_period - 1
    upper = [NAN] * n
    lower = [NAN] * n
    line = [NAN] * n
    pine_direction = [0] * n  # Pine: -1 uptrend, +1 downtrend
    for i in range(start, n):
        hl2 = (high[i] + low[i]) / 2
        basic_upper, basic_lower = hl2 + multiplier * atr[i], hl2 - multiplier * atr[i]
        if i == start:
            upper[i], lower[i] = basic_upper, basic_lower
            pine_direction[i] = 1
        else:
            lower[i] = basic_lower if basic_lower > lower[i - 1] or close[i - 1] < lower[i - 1] else lower[i - 1]
            upper[i] = basic_upper if basic_upper < upper[i - 1] or close[i - 1] > upper[i - 1] else upper[i - 1]
            if line[i - 1] == upper[i - 1]:
                pine_direction[i] = -1 if close[i] > upper[i] else 1
            else:
                pine_direction[i] = 1 if close[i] < lower[i] else -1
        line[i] = lower[i] if pine_direction[i] == -1 else upper[i]
    return {
        "value": line[-1],
        "direction": 1 if pine_direction[-1] == -1 else -1,
        "upper": upper[-1],
        "lower": lower[-1],
    }


def classic_pivots(high: float, low: float, close: float) -> dict[str, float]:
    """Floor-trader (classic) pivot levels."""
    pivot = (high + low + close) / 3
    return {
        "pivot": pivot,
        "r1": 2 * pivot - low,
        "r2": pivot + (high - low),
        "r3": high + 2 * (pivot - low),
        "s1": 2 * pivot - high,
        "s2": pivot - (high - low),
        "s3": low - 2 * (high - pivot),
    }


def pivot_source_bar(frame: pd.DataFrame, now: datetime | None = None) -> tuple[pd.Timestamp, pd.Series] | None:
    """Most recent *completed* daily session (today's bar only after the close)."""
    data = frame.dropna(subset=["High", "Low", "Close"])
    if data.empty:
        return None
    last_timestamp = pd.Timestamp(data.index[-1])
    if is_session_final(last_timestamp.date(), now):
        return last_timestamp, data.iloc[-1]
    if len(data) < 2:
        return None
    return pd.Timestamp(data.index[-2]), data.iloc[-2]


def last_ma_cross(close: pd.Series, fast: int = 50, slow: int = 200) -> dict[str, Any] | None:
    """Most recent golden (fast SMA crosses above slow SMA) or death cross in the series."""
    close = close.dropna()
    spread = (close.rolling(fast).mean() - close.rolling(slow).mean()).dropna()
    side = (spread.gt(0).astype(float) - spread.lt(0).astype(float)).replace(0.0, NAN).ffill().dropna()
    if len(side) < 2:
        return None
    flipped = side.ne(side.shift()) & side.shift().notna()
    if not flipped.any():
        return None
    timestamp = pd.Timestamp(flipped[flipped].index[-1])
    return {
        "type": "golden" if side.loc[timestamp] > 0 else "death",
        "date": timestamp.date().isoformat(),
        "bars_ago": int(len(close.loc[timestamp:]) - 1),
    }


# ---------------------------------------------------------------------------
# Value resolution: TradingView first, daily bars when TV is unreachable
# ---------------------------------------------------------------------------

async def _tv_daily_values(ticker: str) -> dict[str, Any] | None:
    """TradingView daily columns; ``None`` when the scanner is unavailable (404 propagates)."""
    return (await _tv_daily_values_at(ticker))[0]


async def _tv_daily_values_at(ticker: str) -> tuple[dict[str, Any] | None, datetime | None]:
    try:
        bundle, fetched_at = await _get_ta_bundle_at(ticker)
        return bundle["1d"], fetched_at
    except SymbolNotFoundError:
        raise
    except MarketDataError as e:
        logger.warning("technical_scanner_unavailable_using_bars", ticker=ticker, error=e.message)
        return None, None


# Bars needed before a locally computed value equals TradingView's full-history value.
def ema_min_bars(period: int) -> int:
    return 6 * period


def rsi_min_bars(period: int) -> int:
    return 10 * period + 1


MACD_MIN_BARS = ema_min_bars(26) + 9
STOCH_MIN_BARS = 14 + 3 + 3


async def _resolve(
    ticker: str,
    from_tradingview: Callable[[dict[str, Any]], Any] | None,
    from_bars: Callable[[pd.DataFrame], Any],
    min_bars: int = 0,
) -> tuple[Any, str, DataMeta | None]:
    """Stored bars when fresh and long enough → TradingView scanner → live daily bars."""
    stored = await load_stored_daily(ticker)
    if stored is not None and len(stored.frame) >= min_bars:
        value = from_bars(stored.frame)
        if value is not None:
            return value, SOURCE_LOCAL, stored.meta
    if from_tradingview is not None:
        raw, fetched_at = await _tv_daily_values_at(ticker)
        if raw is not None:
            value = from_tradingview(raw)
            if value is not None:
                return value, SOURCE_TRADINGVIEW, _tv_meta(ticker, fetched_at)
    daily = await load_daily(ticker)
    return from_bars(daily.frame), SOURCE_LOCAL, daily.meta


def _tv_number(key: str) -> Callable[[dict[str, Any]], float | None]:
    return lambda raw: finite_float(raw.get(key))


def _round_values(values: dict[str, Any] | None) -> dict[str, Any]:
    return {key: _round(value) for key, value in (values or {}).items()}


# ---------------------------------------------------------------------------
# Public adapter API
# ---------------------------------------------------------------------------

def _meta(meta: DataMeta | None) -> dict[str, Any]:
    return market_service.meta_dict(meta)


@cached(TTL_TECHNICAL, "tech")
async def get_rsi(ticker: str, period: int = 14) -> dict:
    base = {"ticker": ticker, "indicator": "RSI", "period": period, "interval": "1d"}
    try:
        value, source, meta = await _resolve(
            ticker,
            _tv_number("RSI") if period == 14 else None,
            lambda bars: rsi_last(bars["Close"], period),
            rsi_min_bars(period),
        )
        return {**base, "value": _round(value), "source": source, **_meta(meta)}
    except Exception as e:
        logger.error("technical_rsi_error", ticker=ticker, error=str(e))
        return {**base, **error_payload(e, "RSI hesaplanamadı")}


def _tv_macd(raw: dict[str, Any]) -> dict[str, float] | None:
    macd, signal = finite_float(raw.get("MACD.macd")), finite_float(raw.get("MACD.signal"))
    if macd is None or signal is None:
        return None
    return {"macd": macd, "signal": signal, "histogram": macd - signal}


@cached(TTL_TECHNICAL, "tech")
async def get_macd(ticker: str) -> dict:
    base = {"ticker": ticker, "indicator": "MACD", "params": {"fast": 12, "slow": 26, "signal": 9}}
    try:
        values, source, meta = await _resolve(ticker, _tv_macd, lambda bars: macd_last(bars["Close"]), MACD_MIN_BARS)
        return {**base, "data": _round_values(values), "source": source, **_meta(meta)}
    except Exception as e:
        logger.error("technical_macd_error", ticker=ticker, error=str(e))
        return {**base, **error_payload(e, "MACD hesaplanamadı")}


def _tv_bollinger(raw: dict[str, Any]) -> dict[str, float] | None:
    upper, lower = finite_float(raw.get("BB.upper")), finite_float(raw.get("BB.lower"))
    if upper is None or lower is None:
        return None
    middle = finite_float(raw.get("BB.basis"))
    return {"upper": upper, "middle": middle if middle is not None else (upper + lower) / 2, "lower": lower}


@cached(TTL_TECHNICAL, "tech")
async def get_bollinger(ticker: str, period: int = 20) -> dict:
    base = {"ticker": ticker, "indicator": "BOLLINGER", "period": period, "std_dev": 2}
    try:
        values, source, meta = await _resolve(
            ticker,
            _tv_bollinger if period == 20 else None,
            lambda bars: bollinger_last(bars["Close"], period),
            period,
        )
        return {**base, "data": _round_values(values), "source": source, **_meta(meta)}
    except Exception as e:
        logger.error("technical_bollinger_error", ticker=ticker, error=str(e))
        return {**base, **error_payload(e, "Bollinger bantları hesaplanamadı")}


@cached(TTL_TECHNICAL, "tech")
async def get_sma(ticker: str, period: int = 20) -> dict:
    base = {"ticker": ticker, "indicator": "SMA", "period": period, "interval": "1d"}
    try:
        value, source, meta = await _resolve(
            ticker,
            _tv_number(f"SMA{period}") if period in TV_MA_PERIODS else None,
            lambda bars: sma_last(bars["Close"], period),
            period,
        )
        return {**base, "value": _round(value), "source": source, **_meta(meta)}
    except Exception as e:
        logger.error("technical_sma_error", ticker=ticker, error=str(e))
        return {**base, **error_payload(e, "SMA hesaplanamadı")}


@cached(TTL_TECHNICAL, "tech")
async def get_ema(ticker: str, period: int = 20) -> dict:
    base = {"ticker": ticker, "indicator": "EMA", "period": period, "interval": "1d"}
    try:
        value, source, meta = await _resolve(
            ticker,
            _tv_number(f"EMA{period}") if period in TV_MA_PERIODS else None,
            lambda bars: ema_last(bars["Close"], period),
            ema_min_bars(period),
        )
        return {**base, "value": _round(value), "source": source, **_meta(meta)}
    except Exception as e:
        logger.error("technical_ema_error", ticker=ticker, error=str(e))
        return {**base, **error_payload(e, "EMA hesaplanamadı")}


@cached(TTL_TECHNICAL, "tech")
async def get_supertrend(ticker: str) -> dict:
    base = {"ticker": ticker, "indicator": "SUPERTREND", "params": {"atr_period": 10, "multiplier": 3}}
    try:
        daily = await load_daily(ticker)
        result = supertrend_last(daily.frame)
        if result is None:
            return {**base, "data": {}, **_meta(daily.meta)}
        data = {**_round_values({k: result[k] for k in ("value", "upper", "lower")}), "direction": result["direction"]}
        return {**base, "data": data, "source": SOURCE_LOCAL, **_meta(daily.meta)}
    except Exception as e:
        logger.error("technical_supertrend_error", ticker=ticker, error=str(e))
        return {**base, **error_payload(e, "SuperTrend hesaplanamadı")}


def _tv_stochastic(raw: dict[str, Any]) -> dict[str, float] | None:
    k, d = finite_float(raw.get("Stoch.K")), finite_float(raw.get("Stoch.D"))
    return {"k": k, "d": d} if k is not None and d is not None else None


@cached(TTL_TECHNICAL, "tech")
async def get_stochastic(ticker: str) -> dict:
    base = {"ticker": ticker, "indicator": "STOCHASTIC", "params": {"k": 14, "smooth_k": 3, "d": 3}}
    try:
        values, source, meta = await _resolve(ticker, _tv_stochastic, stochastic_last, STOCH_MIN_BARS)
        return {**base, "data": _round_values(values), "source": source, **_meta(meta)}
    except Exception as e:
        logger.error("technical_stochastic_error", ticker=ticker, error=str(e))
        return {**base, **error_payload(e, "Stokastik hesaplanamadı")}


@cached(TTL_TECHNICAL, "tech")
async def get_ta_signals(ticker: str) -> dict:
    """Gunluk TradingView teknik derecelendirmesi (AL/SAT/NÖTR ozeti + gostergeler)."""
    try:
        bundle, fetched_at = await _get_ta_bundle_at(ticker)
        signals = build_signals(ticker, "1d", bundle["1d"])
        return {"ticker": ticker, "signals": {} if "error" in signals else signals, **_meta(_tv_meta(ticker, fetched_at))}
    except Exception as e:
        logger.error("technical_ta_signals_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "signals": {}, **error_payload(e, "Teknik sinyaller alınamadı")}


@cached(TTL_TECHNICAL, "tech")
async def get_ta_signals_all_timeframes(ticker: str) -> dict:
    """Dokuz zaman dilimi (1m … 1M) icin derecelendirme — tek TradingView istegi."""
    try:
        bundle, fetched_at = await _get_ta_bundle_at(ticker)
        return {
            "ticker": ticker,
            "timeframes": {interval: build_signals(ticker, interval, raw) for interval, raw in bundle.items()},
            **_meta(_tv_meta(ticker, fetched_at)),
        }
    except Exception as e:
        logger.error("technical_ta_all_tf_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "timeframes": {}, **error_payload(e, "Zaman dilimi sinyalleri alınamadı")}


@cached(TTL_TECHNICAL, "tech")
async def get_moving_averages(ticker: str) -> dict:
    """SMA/EMA 10, 20, 50, 100, 200 and the SMA50/SMA200 regime.

    ``golden_cross`` is the regime (True while SMA50 > SMA200, False while
    below); ``last_cross`` is the most recent actual crossover event. With a fresh
    store every average comes from the stored bars (an EMA only when the series
    is long enough to converge — otherwise TradingView's value is used).
    """
    try:
        stored = await load_stored_daily(ticker)
        raw: dict[str, Any] | None = None
        raw_at: datetime | None = None
        daily: market_service.DailyBars | None = stored
        if stored is None:
            tv_result, daily_result = await asyncio.gather(
                _tv_daily_values_at(ticker), load_daily(ticker), return_exceptions=True
            )
            if isinstance(tv_result, BaseException):
                raise tv_result
            raw, raw_at = tv_result
            if isinstance(daily_result, BaseException):
                logger.warning("moving_average_bars_unavailable", ticker=ticker, error=str(daily_result))
                if raw is None:
                    raise daily_result
                daily = None
            else:
                daily = daily_result
        bars = daily.frame if daily is not None else None
        closes = bars["Close"] if bars is not None else None

        def local(kind: str, period: int) -> float | None:
            if closes is None or stored is None:
                return None
            if kind == "SMA":
                return sma_last(closes, period)
            return ema_last(closes, period) if len(closes.dropna()) >= ema_min_bars(period) else None

        sma_vals: dict[str, float | None] = {}
        ema_vals: dict[str, float | None] = {}
        used_tv = False
        for period in DASHBOARD_MA_PERIODS:
            for kind, target in (("SMA", sma_vals), ("EMA", ema_vals)):
                value = local(kind, period)
                if value is None and raw is None and stored is not None and raw_at is None:
                    raw, raw_at = await _tv_daily_values_at(ticker)
                    raw_at = raw_at or datetime.now(UTC)  # asked once, even when unavailable
                if value is None and raw:
                    value = finite_float(raw.get(f"{kind}{period}"))
                    used_tv = used_tv or value is not None
                if value is None and closes is not None:
                    value = sma_last(closes, period) if kind == "SMA" else ema_last(closes, period)
                target[f"{kind.lower()}_{period}"] = _round(value)

        sma50, sma200 = sma_vals["sma_50"], sma_vals["sma_200"]
        metas = [m for m in (daily.meta if daily is not None else None, _tv_meta(ticker, raw_at) if used_tv else None) if m]
        return {
            "ticker": ticker,
            "sma": sma_vals,
            "ema": ema_vals,
            "golden_cross": (sma50 > sma200) if sma50 is not None and sma200 is not None else None,
            "last_cross": last_ma_cross(closes) if closes is not None else None,
            "source": SOURCE_TRADINGVIEW if used_tv else SOURCE_LOCAL,
            **_meta(market_service.combine_meta(metas)),
        }
    except Exception as e:
        logger.error("technical_moving_averages_error", ticker=ticker, error=str(e))
        return {
            "ticker": ticker,
            "sma": {},
            "ema": {},
            "golden_cross": None,
            **error_payload(e, "Hareketli ortalamalar alınamadı"),
        }


@cached(TTL_TECHNICAL, "tech")
async def get_pivot_points(ticker: str) -> dict:
    """Classic pivot points (P, R1-R3, S1-S3) from the previous completed session's H/L/C."""
    try:
        daily = await load_daily(ticker)
        source = pivot_source_bar(daily.frame)
        if source is None:
            return {"ticker": ticker, "pivots": None, **_meta(daily.meta)}
        timestamp, bar = source
        high, low, close = float(bar["High"]), float(bar["Low"]), float(bar["Close"])
        return {
            "ticker": ticker,
            "method": "classic",
            "session_date": timestamp.date().isoformat(),
            "session": {"high": _round(high), "low": _round(low), "close": _round(close)},
            "pivots": _round_values(classic_pivots(high, low, close)),
            **_meta(daily.meta),
        }
    except Exception as e:
        logger.error("technical_pivot_points_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "pivots": None, **error_payload(e, "Pivot noktaları hesaplanamadı")}
