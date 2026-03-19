"""Teknik analiz adaptoru — borsapy technical indicators."""

import asyncio

import structlog

logger = structlog.get_logger(__name__)


async def get_rsi(ticker: str, period: int = 14) -> dict:
    """RSI hesapla."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        t = await loop.run_in_executor(None, lambda: bp.Ticker(ticker))
        df = await loop.run_in_executor(None, lambda: t.rsi(period=period))
        if df is None or df.empty:
            return {"ticker": ticker, "indicator": "RSI", "data": []}
        records = [
            {"date": str(idx), **{col: round(float(row[col]), 4) for col in df.columns if row[col] is not None}}
            for idx, row in df.iterrows()
        ]
        return {"ticker": ticker, "indicator": "RSI", "period": period, "data": records}
    except Exception as e:
        logger.error("technical_rsi_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "indicator": "RSI", "error": str(e)}


async def get_macd(ticker: str) -> dict:
    """MACD hesapla."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        t = await loop.run_in_executor(None, lambda: bp.Ticker(ticker))
        df = await loop.run_in_executor(None, lambda: t.macd())
        if df is None or df.empty:
            return {"ticker": ticker, "indicator": "MACD", "data": []}
        records = [
            {"date": str(idx), **{col: round(float(row[col]), 4) for col in df.columns if row[col] is not None}}
            for idx, row in df.iterrows()
        ]
        return {"ticker": ticker, "indicator": "MACD", "data": records}
    except Exception as e:
        logger.error("technical_macd_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "indicator": "MACD", "error": str(e)}


async def get_bollinger(ticker: str, period: int = 20) -> dict:
    """Bollinger Bands hesapla."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        t = await loop.run_in_executor(None, lambda: bp.Ticker(ticker))
        df = await loop.run_in_executor(None, lambda: t.bollinger_bands(period=period))
        if df is None or df.empty:
            return {"ticker": ticker, "indicator": "BOLLINGER", "data": []}
        records = [
            {"date": str(idx), **{col: round(float(row[col]), 4) for col in df.columns if row[col] is not None}}
            for idx, row in df.iterrows()
        ]
        return {"ticker": ticker, "indicator": "BOLLINGER", "period": period, "data": records}
    except Exception as e:
        logger.error("technical_bollinger_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "indicator": "BOLLINGER", "error": str(e)}


async def get_sma(ticker: str, period: int = 20) -> dict:
    """SMA hesapla."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        t = await loop.run_in_executor(None, lambda: bp.Ticker(ticker))
        df = await loop.run_in_executor(None, lambda: t.sma(period=period))
        if df is None or df.empty:
            return {"ticker": ticker, "indicator": "SMA", "data": []}
        records = [
            {"date": str(idx), **{col: round(float(row[col]), 4) for col in df.columns if row[col] is not None}}
            for idx, row in df.iterrows()
        ]
        return {"ticker": ticker, "indicator": "SMA", "period": period, "data": records}
    except Exception as e:
        logger.error("technical_sma_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "indicator": "SMA", "error": str(e)}


async def get_ema(ticker: str, period: int = 20) -> dict:
    """EMA hesapla."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        t = await loop.run_in_executor(None, lambda: bp.Ticker(ticker))
        df = await loop.run_in_executor(None, lambda: t.ema(period=period))
        if df is None or df.empty:
            return {"ticker": ticker, "indicator": "EMA", "data": []}
        records = [
            {"date": str(idx), **{col: round(float(row[col]), 4) for col in df.columns if row[col] is not None}}
            for idx, row in df.iterrows()
        ]
        return {"ticker": ticker, "indicator": "EMA", "period": period, "data": records}
    except Exception as e:
        logger.error("technical_ema_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "indicator": "EMA", "error": str(e)}


async def get_supertrend(ticker: str) -> dict:
    """SuperTrend hesapla."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        t = await loop.run_in_executor(None, lambda: bp.Ticker(ticker))
        df = await loop.run_in_executor(None, lambda: t.supertrend())
        if df is None or df.empty:
            return {"ticker": ticker, "indicator": "SUPERTREND", "data": []}
        records = [
            {"date": str(idx), **{col: round(float(row[col]), 4) for col in df.columns if row[col] is not None}}
            for idx, row in df.iterrows()
        ]
        return {"ticker": ticker, "indicator": "SUPERTREND", "data": records}
    except Exception as e:
        logger.error("technical_supertrend_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "indicator": "SUPERTREND", "error": str(e)}


async def get_stochastic(ticker: str) -> dict:
    """Stochastic Oscillator hesapla."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        t = await loop.run_in_executor(None, lambda: bp.Ticker(ticker))
        df = await loop.run_in_executor(None, lambda: t.stochastic())
        if df is None or df.empty:
            return {"ticker": ticker, "indicator": "STOCHASTIC", "data": []}
        records = [
            {"date": str(idx), **{col: round(float(row[col]), 4) for col in df.columns if row[col] is not None}}
            for idx, row in df.iterrows()
        ]
        return {"ticker": ticker, "indicator": "STOCHASTIC", "data": records}
    except Exception as e:
        logger.error("technical_stochastic_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "indicator": "STOCHASTIC", "error": str(e)}


async def get_ta_signals(ticker: str) -> dict:
    """Tum teknik analiz sinyallerini getir (AL/SAT/NOTR)."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        t = await loop.run_in_executor(None, lambda: bp.Ticker(ticker))
        result = await loop.run_in_executor(None, lambda: t.ta_signals)
        if result is None:
            return {"ticker": ticker, "signals": {}}
        if hasattr(result, "to_dict"):
            return {"ticker": ticker, "signals": result.to_dict()}
        return {"ticker": ticker, "signals": result}
    except Exception as e:
        logger.error("technical_ta_signals_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "signals": {}, "error": str(e)}


async def get_ta_signals_all_timeframes(ticker: str) -> dict:
    """Tum zaman dilimlerinde teknik sinyalleri getir."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        t = await loop.run_in_executor(None, lambda: bp.Ticker(ticker))
        result = await loop.run_in_executor(None, lambda: t.ta_signals_all_timeframes)
        if result is None:
            return {"ticker": ticker, "timeframes": {}}
        if hasattr(result, "to_dict"):
            return {"ticker": ticker, "timeframes": result.to_dict()}
        return {"ticker": ticker, "timeframes": result}
    except Exception as e:
        logger.error("technical_ta_all_tf_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "timeframes": {}, "error": str(e)}
