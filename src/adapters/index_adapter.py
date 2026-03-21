"""Endeks adaptoru — BIST endeks verileri."""

import structlog

from src.adapters.utils import cached, df_to_records, safe_serialize, run_sync, TTL_MARKET

logger = structlog.get_logger(__name__)


@cached(TTL_MARKET, "index")
async def get_index_data(symbol: str = "XU100", period: str = "1ay") -> dict:
    """Endeks fiyat verisi (XU100, XU030, vb.)."""
    try:
        import borsapy as bp
        idx = await run_sync(lambda: bp.Index(symbol))
        df = await run_sync(lambda: idx.history(period=period))
        return {"symbol": symbol, "period": period, "data": df_to_records(df)}
    except Exception as e:
        logger.error("index_data_error", symbol=symbol, error=str(e))
        return {"symbol": symbol, "period": period, "data": [], "error": str(e)}


@cached(TTL_MARKET, "index")
async def get_index_info(symbol: str = "XU100") -> dict:
    """Endeks bilgileri."""
    try:
        import borsapy as bp
        idx = await run_sync(lambda: bp.Index(symbol))
        info = await run_sync(lambda: idx.info if hasattr(idx, "info") else None)
        if info is None:
            return {"symbol": symbol, "info": {}}
        return {"symbol": symbol, "info": safe_serialize(info)}
    except Exception as e:
        logger.error("index_info_error", symbol=symbol, error=str(e))
        return {"symbol": symbol, "info": {}, "error": str(e)}


@cached(TTL_MARKET, "index")
async def list_indices() -> dict:
    """Tum BIST endekslerini listele."""
    try:
        import borsapy as bp
        result = await run_sync(bp.indices)
        data = df_to_records(result) if hasattr(result, "iterrows") else result
        return {"indices": data}
    except Exception as e:
        logger.error("indices_list_error", error=str(e))
        return {"indices": [], "error": str(e)}
