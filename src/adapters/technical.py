"""Teknik analiz adaptoru — borsapy technical indicators.

borsapy donus tipleri:
  - rsi(), sma(), ema() -> float (anlik deger)
  - macd() -> dict (macd, signal, histogram)
  - bollinger_bands() -> dict (upper, middle, lower)
  - supertrend() -> dict (value, direction, upper, lower)
  - stochastic() -> dict (k, d)
  - ta_signals() -> dict (summary, oscillators, moving_averages)
  - ta_signals_all_timeframes() -> dict (1m, 5m, 15m, ... keyleri)
"""

import asyncio

import structlog

logger = structlog.get_logger(__name__)


async def _get_ticker(ticker: str):
    import borsapy as bp
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: bp.Ticker(ticker))


async def get_rsi(ticker: str, period: int = 14) -> dict:
    """RSI hesapla. float doner."""
    try:
        t = await _get_ticker(ticker)
        loop = asyncio.get_event_loop()
        value = await loop.run_in_executor(None, lambda: t.rsi(period=period))
        if value is None:
            return {"ticker": ticker, "indicator": "RSI", "period": period, "value": None}
        return {"ticker": ticker, "indicator": "RSI", "period": period, "value": round(float(value), 4)}
    except Exception as e:
        logger.error("technical_rsi_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "indicator": "RSI", "error": str(e)}


async def get_macd(ticker: str) -> dict:
    """MACD hesapla. dict doner: {macd, signal, histogram}."""
    try:
        t = await _get_ticker(ticker)
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, lambda: t.macd())
        if result is None:
            return {"ticker": ticker, "indicator": "MACD", "data": {}}
        data = {k: round(float(v), 4) for k, v in result.items()} if isinstance(result, dict) else result
        return {"ticker": ticker, "indicator": "MACD", "data": data}
    except Exception as e:
        logger.error("technical_macd_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "indicator": "MACD", "error": str(e)}


async def get_bollinger(ticker: str, period: int = 20) -> dict:
    """Bollinger Bands hesapla. dict doner: {upper, middle, lower}."""
    try:
        t = await _get_ticker(ticker)
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, lambda: t.bollinger_bands(period=period))
        if result is None:
            return {"ticker": ticker, "indicator": "BOLLINGER", "period": period, "data": {}}
        data = {k: round(float(v), 4) for k, v in result.items()} if isinstance(result, dict) else result
        return {"ticker": ticker, "indicator": "BOLLINGER", "period": period, "data": data}
    except Exception as e:
        logger.error("technical_bollinger_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "indicator": "BOLLINGER", "error": str(e)}


async def get_sma(ticker: str, period: int = 20) -> dict:
    """SMA hesapla. float doner."""
    try:
        t = await _get_ticker(ticker)
        loop = asyncio.get_event_loop()
        value = await loop.run_in_executor(None, lambda: t.sma(period=period))
        if value is None:
            return {"ticker": ticker, "indicator": "SMA", "period": period, "value": None}
        return {"ticker": ticker, "indicator": "SMA", "period": period, "value": round(float(value), 4)}
    except Exception as e:
        logger.error("technical_sma_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "indicator": "SMA", "error": str(e)}


async def get_ema(ticker: str, period: int = 20) -> dict:
    """EMA hesapla. float doner."""
    try:
        t = await _get_ticker(ticker)
        loop = asyncio.get_event_loop()
        value = await loop.run_in_executor(None, lambda: t.ema(period=period))
        if value is None:
            return {"ticker": ticker, "indicator": "EMA", "period": period, "value": None}
        return {"ticker": ticker, "indicator": "EMA", "period": period, "value": round(float(value), 4)}
    except Exception as e:
        logger.error("technical_ema_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "indicator": "EMA", "error": str(e)}


async def get_supertrend(ticker: str) -> dict:
    """SuperTrend hesapla. dict doner: {value, direction, upper, lower}."""
    try:
        t = await _get_ticker(ticker)
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, lambda: t.supertrend())
        if result is None:
            return {"ticker": ticker, "indicator": "SUPERTREND", "data": {}}
        data = {}
        if isinstance(result, dict):
            for k, v in result.items():
                data[k] = round(float(v), 4) if isinstance(v, (int, float)) else v
        return {"ticker": ticker, "indicator": "SUPERTREND", "data": data}
    except Exception as e:
        logger.error("technical_supertrend_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "indicator": "SUPERTREND", "error": str(e)}


async def get_stochastic(ticker: str) -> dict:
    """Stochastic Oscillator hesapla. dict doner: {k, d}."""
    try:
        t = await _get_ticker(ticker)
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, lambda: t.stochastic())
        if result is None:
            return {"ticker": ticker, "indicator": "STOCHASTIC", "data": {}}
        data = {k: round(float(v), 4) for k, v in result.items()} if isinstance(result, dict) else result
        return {"ticker": ticker, "indicator": "STOCHASTIC", "data": data}
    except Exception as e:
        logger.error("technical_stochastic_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "indicator": "STOCHASTIC", "error": str(e)}


async def get_ta_signals(ticker: str) -> dict:
    """Tum teknik analiz sinyallerini getir (AL/SAT/NOTR). ta_signals() method."""
    try:
        t = await _get_ticker(ticker)
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, lambda: t.ta_signals())
        if result is None:
            return {"ticker": ticker, "signals": {}}
        return {"ticker": ticker, "signals": result}
    except Exception as e:
        logger.error("technical_ta_signals_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "signals": {}, "error": str(e)}


async def get_ta_signals_all_timeframes(ticker: str) -> dict:
    """Tum zaman dilimlerinde teknik sinyalleri getir. ta_signals_all_timeframes() method."""
    try:
        t = await _get_ticker(ticker)
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, lambda: t.ta_signals_all_timeframes())
        if result is None:
            return {"ticker": ticker, "timeframes": {}}
        return {"ticker": ticker, "timeframes": result}
    except Exception as e:
        logger.error("technical_ta_all_tf_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "timeframes": {}, "error": str(e)}
