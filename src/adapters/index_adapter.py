"""Endeks adaptoru — BIST endeks verileri."""

import asyncio

import structlog

logger = structlog.get_logger(__name__)


def _df_to_records(df) -> list[dict]:
    if df is None:
        return []
    if hasattr(df, "empty") and df.empty:
        return []
    try:
        result = df.reset_index()
        return result.to_dict(orient="records")
    except Exception:
        return []


async def get_index_data(symbol: str = "XU100", period: str = "1ay") -> dict:
    """Endeks fiyat verisi (XU100, XU030, vb.)."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        idx = await loop.run_in_executor(None, lambda: bp.Index(symbol))
        df = await loop.run_in_executor(None, lambda: idx.history(period=period))
        return {"symbol": symbol, "period": period, "data": _df_to_records(df)}
    except Exception as e:
        logger.error("index_data_error", symbol=symbol, error=str(e))
        return {"symbol": symbol, "period": period, "data": [], "error": str(e)}


async def get_index_info(symbol: str = "XU100") -> dict:
    """Endeks bilgileri."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        idx = await loop.run_in_executor(None, lambda: bp.Index(symbol))
        info = await loop.run_in_executor(None, lambda: idx.info if hasattr(idx, "info") else None)
        if info is None:
            return {"symbol": symbol, "info": {}}
        if hasattr(info, "to_dict"):
            return {"symbol": symbol, "info": info.to_dict()}
        if isinstance(info, dict):
            return {"symbol": symbol, "info": info}
        return {"symbol": symbol, "info": {"value": str(info)}}
    except Exception as e:
        logger.error("index_info_error", symbol=symbol, error=str(e))
        return {"symbol": symbol, "info": {}, "error": str(e)}


async def list_indices() -> dict:
    """Tum BIST endekslerini listele."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, bp.indices)
        data = _df_to_records(result) if hasattr(result, "iterrows") else result
        return {"indices": data}
    except Exception as e:
        logger.error("indices_list_error", error=str(e))
        return {"indices": [], "error": str(e)}
