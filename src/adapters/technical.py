"""Teknik analiz adaptoru — borsapy technical indicators.

Uses shared TTL cache (60s) and asyncio.to_thread for sync borsapy calls.
"""

import structlog

from src.adapters.utils import run_sync, cached, TTL_TECHNICAL

logger = structlog.get_logger(__name__)


async def _get_ticker(ticker: str):
    import borsapy as bp
    return await run_sync(bp.Ticker, ticker)


def _round_dict(d: dict) -> dict:
    if not isinstance(d, dict):
        return d
    return {k: round(float(v), 4) if isinstance(v, (int, float)) else v for k, v in d.items()}


@cached(TTL_TECHNICAL, "tech")
async def get_rsi(ticker: str, period: int = 14) -> dict:
    try:
        t = await _get_ticker(ticker)
        value = await run_sync(lambda: t.rsi(period=period))
        if value is None:
            return {"ticker": ticker, "indicator": "RSI", "period": period, "value": None}
        return {"ticker": ticker, "indicator": "RSI", "period": period, "value": round(float(value), 4)}
    except Exception as e:
        logger.error("technical_rsi_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "indicator": "RSI", "error": str(e)}


@cached(TTL_TECHNICAL, "tech")
async def get_macd(ticker: str) -> dict:
    try:
        t = await _get_ticker(ticker)
        result = await run_sync(t.macd)
        if result is None:
            return {"ticker": ticker, "indicator": "MACD", "data": {}}
        return {"ticker": ticker, "indicator": "MACD", "data": _round_dict(result)}
    except Exception as e:
        logger.error("technical_macd_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "indicator": "MACD", "error": str(e)}


@cached(TTL_TECHNICAL, "tech")
async def get_bollinger(ticker: str, period: int = 20) -> dict:
    try:
        t = await _get_ticker(ticker)
        result = await run_sync(lambda: t.bollinger_bands(period=period))
        if result is None:
            return {"ticker": ticker, "indicator": "BOLLINGER", "period": period, "data": {}}
        return {"ticker": ticker, "indicator": "BOLLINGER", "period": period, "data": _round_dict(result)}
    except Exception as e:
        logger.error("technical_bollinger_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "indicator": "BOLLINGER", "error": str(e)}


@cached(TTL_TECHNICAL, "tech")
async def get_sma(ticker: str, period: int = 20) -> dict:
    try:
        t = await _get_ticker(ticker)
        value = await run_sync(lambda: t.sma(period=period))
        if value is None:
            return {"ticker": ticker, "indicator": "SMA", "period": period, "value": None}
        return {"ticker": ticker, "indicator": "SMA", "period": period, "value": round(float(value), 4)}
    except Exception as e:
        logger.error("technical_sma_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "indicator": "SMA", "error": str(e)}


@cached(TTL_TECHNICAL, "tech")
async def get_ema(ticker: str, period: int = 20) -> dict:
    try:
        t = await _get_ticker(ticker)
        value = await run_sync(lambda: t.ema(period=period))
        if value is None:
            return {"ticker": ticker, "indicator": "EMA", "period": period, "value": None}
        return {"ticker": ticker, "indicator": "EMA", "period": period, "value": round(float(value), 4)}
    except Exception as e:
        logger.error("technical_ema_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "indicator": "EMA", "error": str(e)}


@cached(TTL_TECHNICAL, "tech")
async def get_supertrend(ticker: str) -> dict:
    try:
        t = await _get_ticker(ticker)
        result = await run_sync(t.supertrend)
        if result is None:
            return {"ticker": ticker, "indicator": "SUPERTREND", "data": {}}
        return {"ticker": ticker, "indicator": "SUPERTREND", "data": _round_dict(result)}
    except Exception as e:
        logger.error("technical_supertrend_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "indicator": "SUPERTREND", "error": str(e)}


@cached(TTL_TECHNICAL, "tech")
async def get_stochastic(ticker: str) -> dict:
    try:
        t = await _get_ticker(ticker)
        result = await run_sync(t.stochastic)
        if result is None:
            return {"ticker": ticker, "indicator": "STOCHASTIC", "data": {}}
        return {"ticker": ticker, "indicator": "STOCHASTIC", "data": _round_dict(result)}
    except Exception as e:
        logger.error("technical_stochastic_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "indicator": "STOCHASTIC", "error": str(e)}


@cached(TTL_TECHNICAL, "tech")
async def get_ta_signals(ticker: str) -> dict:
    try:
        t = await _get_ticker(ticker)
        result = await run_sync(t.ta_signals)
        if result is None:
            return {"ticker": ticker, "signals": {}}
        return {"ticker": ticker, "signals": result}
    except Exception as e:
        logger.error("technical_ta_signals_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "signals": {}, "error": str(e)}


@cached(TTL_TECHNICAL, "tech")
async def get_ta_signals_all_timeframes(ticker: str) -> dict:
    try:
        t = await _get_ticker(ticker)
        result = await run_sync(t.ta_signals_all_timeframes)
        if result is None:
            return {"ticker": ticker, "timeframes": {}}
        return {"ticker": ticker, "timeframes": result}
    except Exception as e:
        logger.error("technical_ta_all_tf_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "timeframes": {}, "error": str(e)}


@cached(TTL_TECHNICAL, "tech")
async def get_moving_averages(ticker: str) -> dict:
    """Fetch SMA/EMA 10, 20, 50, 100, 200 values and compute Golden Cross status."""
    try:
        t = await _get_ticker(ticker)

        periods = [10, 20, 50, 100, 200]
        sma_vals = {}
        ema_vals = {}

        for p in periods:
            try:
                val = await run_sync(lambda period=p: t.sma(period=period))
                sma_vals[f"sma_{p}"] = round(float(val), 4) if val is not None else None
            except Exception:
                sma_vals[f"sma_{p}"] = None

            try:
                val = await run_sync(lambda period=p: t.ema(period=period))
                ema_vals[f"ema_{p}"] = round(float(val), 4) if val is not None else None
            except Exception:
                ema_vals[f"ema_{p}"] = None

        sma50 = sma_vals.get("sma_50")
        sma200 = sma_vals.get("sma_200")
        golden_cross = (sma50 > sma200) if (sma50 is not None and sma200 is not None) else None

        return {
            "ticker": ticker,
            "sma": sma_vals,
            "ema": ema_vals,
            "golden_cross": golden_cross,
        }
    except Exception as e:
        logger.error("technical_moving_averages_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "sma": {}, "ema": {}, "golden_cross": None, "error": str(e)}


@cached(TTL_TECHNICAL, "tech")
async def get_pivot_points(ticker: str) -> dict:
    """Calculate Classic Pivot Points (P, R1-R3, S1-S3) from recent price data."""
    try:
        t = await _get_ticker(ticker)
        fast = await run_sync(lambda: t.fast_info)

        high = float(fast.get("day_high") or fast.get("year_high") or 0)
        low = float(fast.get("day_low") or fast.get("year_low") or 0)
        close = float(fast.get("last_price") or fast.get("previous_close") or 0)

        if high <= 0 or low <= 0 or close <= 0:
            return {"ticker": ticker, "pivots": None}

        pivot = round((high + low + close) / 3, 2)
        r1 = round((2 * pivot) - low, 2)
        s1 = round((2 * pivot) - high, 2)
        r2 = round(pivot + (high - low), 2)
        s2 = round(pivot - (high - low), 2)
        r3 = round(high + 2 * (pivot - low), 2)
        s3 = round(low - 2 * (high - pivot), 2)

        return {
            "ticker": ticker,
            "pivots": {
                "pivot": pivot,
                "r1": r1,
                "r2": r2,
                "r3": r3,
                "s1": s1,
                "s2": s2,
                "s3": s3,
            },
        }
    except Exception as e:
        logger.error("technical_pivot_points_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "pivots": None, "error": str(e)}
