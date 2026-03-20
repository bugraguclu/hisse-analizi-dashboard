"""Piyasa verileri API endpoint'leri — tarama, endeks, arama, twitter, snapshot."""

from fastapi import APIRouter, Query

from src.adapters.screener_adapter import screen_stocks, get_screener_templates
from src.adapters.scanner_adapter import scan_signals
from src.adapters.index_adapter import get_index_data, get_index_info, list_indices
from src.adapters.search_adapter import search_symbol, list_companies
from src.adapters.twitter_adapter import get_tweets
from src.adapters.stream_adapter import get_snapshot

market_router = APIRouter(prefix="/market", tags=["market"])


# --- Screener ---

@market_router.get("/screener")
async def screener():
    """Varsayilan filtrelerle hisse taramasi."""
    return await screen_stocks()


@market_router.post("/screener")
async def screener_with_filters(filters: dict):
    """Ozel filtrelerle hisse taramasi."""
    return await screen_stocks(filters=filters)


@market_router.get("/screener/templates")
async def screener_templates():
    """Hazir tarama sablonlari."""
    return await get_screener_templates()


# --- Scanner ---

@market_router.get("/scanner")
async def scanner(condition: str | None = None):
    """Teknik sinyal taramasi."""
    return await scan_signals(condition=condition)


# --- Index ---

@market_router.get("/indices")
async def indices():
    """Tum BIST endekslerini listele."""
    return await list_indices()


@market_router.get("/index/{symbol}")
async def index_data(symbol: str = "XU100", period: str = Query(default="1ay")):
    """Endeks fiyat verisi."""
    return await get_index_data(symbol.upper(), period=period)


@market_router.get("/index/{symbol}/info")
async def index_info(symbol: str = "XU100"):
    """Endeks bilgileri."""
    return await get_index_info(symbol.upper())


# --- Search ---

@market_router.get("/search")
async def search(q: str = Query(min_length=1)):
    """Hisse veya VIOP kontrati ara."""
    return await search_symbol(q)


@market_router.get("/companies/all")
async def all_companies():
    """Tum BIST sirketlerini listele."""
    return await list_companies()


# --- Twitter ---

@market_router.get("/tweets/{ticker}")
async def tweets(ticker: str, limit: int = Query(default=20, le=100)):
    """Hisse ile ilgili tweet'leri getir."""
    return await get_tweets(ticker.upper(), limit=limit)


# --- Snapshot ---

@market_router.get("/snapshot")
async def snapshot(symbols: str = Query(description="Virgul ile ayrilmis semboller, orn: THYAO,GARAN,SISE")):
    """Birden fazla hisse icin anlik fiyat snapshot'i."""
    symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    return await get_snapshot(symbol_list)
