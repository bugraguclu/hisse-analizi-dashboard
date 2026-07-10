"""Endeks adaptoru — BIST endeks verileri."""

import asyncio

import structlog

from src.adapters.utils import (
    TTL_MARKET,
    cached,
    df_to_records,
    normalize_period,
    run_sync,
    safe_serialize,
)

logger = structlog.get_logger(__name__)

# Ana endeksler — list_indices bunlar icin canli kotasyon da dondurur.
MAIN_INDICES = [
    "XU100", "XU050", "XU030", "XBANK", "XUSIN", "XUTEK",
    "XHOLD", "XUMAL", "XGIDA", "XULAS", "XTRZM", "XKMYA",
]


@cached(TTL_MARKET, "index")
async def get_index_data(symbol: str = "XU100", period: str = "1ay") -> dict:
    """Endeks fiyat verisi (XU100, XU030, vb.).

    Yanita canli kotasyon bilgisi (info) da eklenir; boylece onceki kapanis
    ve gunluk degisim frontend'de dogru gosterilebilir.
    """
    bp_period, bp_interval = normalize_period(period)
    try:
        import borsapy as bp
        idx = await run_sync(lambda: bp.Index(symbol))
        df = await run_sync(lambda: idx.history(period=bp_period, interval=bp_interval))
        info = {}
        try:
            info = await run_sync(lambda: idx.info)
        except Exception as e:
            logger.warning("index_info_unavailable", symbol=symbol, error=str(e))
        return {
            "symbol": symbol,
            "period": period,
            "interval": bp_interval,
            "info": safe_serialize(info),
            "data": df_to_records(df),
        }
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


async def _fetch_index_quote(symbol: str, semaphore: asyncio.Semaphore) -> dict | None:
    """Tek endeks icin canli kotasyon (info) getir; bir kez tekrar dene."""
    import borsapy as bp
    async with semaphore:
        for attempt in (1, 2):
            try:
                idx = await run_sync(lambda: bp.Index(symbol))
                info = await run_sync(lambda: idx.info)
                data = safe_serialize(info)
                if isinstance(data, dict) and data.get("last") is not None:
                    return data
            except Exception as e:
                if attempt == 2:
                    logger.warning("index_quote_error", symbol=symbol, error=str(e))
            await asyncio.sleep(0.3)
    return None


@cached(TTL_MARKET, "index")
async def list_indices() -> dict:
    """Tum BIST endekslerini listele; ana endeksler icin canli kotasyon ekle."""
    try:
        import borsapy as bp
        result = await run_sync(bp.indices)
        data = df_to_records(result) if hasattr(result, "iterrows") else result

        # Sinirli eszamanlilik: TradingView tarafinda rate-limit kaynakli
        # bos kotasyonlari azaltir.
        semaphore = asyncio.Semaphore(4)
        quotes = await asyncio.gather(
            *(_fetch_index_quote(s, semaphore) for s in MAIN_INDICES)
        )
        return {
            "indices": data,
            "quotes": [q for q in quotes if q is not None],
        }
    except Exception as e:
        logger.error("indices_list_error", error=str(e))
        return {"indices": [], "quotes": [], "error": str(e)}


@cached(TTL_MARKET, "ticker_history")
async def get_ticker_history(ticker: str, period: str = "1ay") -> dict:
    """Hisse fiyat gecmisi (borsapy uzerinden canli)."""
    bp_period, bp_interval = normalize_period(period)
    try:
        import borsapy as bp
        t = await run_sync(lambda: bp.Ticker(ticker))
        df = await run_sync(lambda: t.history(period=bp_period, interval=bp_interval))
        fast_info = {}
        try:
            fast_info = safe_serialize(await run_sync(lambda: t.fast_info))
        except Exception as e:
            logger.warning("ticker_fast_info_unavailable", ticker=ticker, error=str(e))
        return {
            "ticker": ticker,
            "period": period,
            "interval": bp_interval,
            "info": fast_info,
            "data": df_to_records(df),
        }
    except Exception as e:
        logger.error("ticker_history_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "period": period, "data": [], "error": str(e)}
