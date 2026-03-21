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
