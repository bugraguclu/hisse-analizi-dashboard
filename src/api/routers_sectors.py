"""Sektör ortalamaları API'si — KAP sektörüne göre medyanlar ve emsaller.

Hata sözleşmesi diğer uçlarla aynı: geçersiz sembol → 400, depo okunamıyor → 503 (kısa Türkçe
``detail``). Sektörü bilinmeyen hisse hata değildir: ``available: false`` döner.
"""

from fastapi import APIRouter, HTTPException

from src.adapters.utils import InvalidInputError, MarketDataError, normalize_symbol
from src.services import sector_service

sectors_router = APIRouter(tags=["sectors"])


@sectors_router.get("/sectors")
async def sectors():
    """KAP sektörleri: şirket sayısı, toplam piyasa değeri, göstergelerin medyanı ve çeyrekleri."""
    try:
        return await sector_service.get_sectors_view()
    except MarketDataError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e


@sectors_router.get("/fundamentals/{ticker}/sector")
async def company_sector(ticker: str):
    """Hissenin KAP sektörü, sektör medyanları, hissenin sektördeki yeri ve sektördeki şirketler.

    Piyasa çarpanları ve getiriler tarama evreninden (TradingView), finansal oranlar
    ``financial_ratios`` deposundan; ``metrics.<gösterge>`` = ``value`` (hisse), ``median``,
    ``p25``/``p75``, ``count`` (sayılan şirket), ``reported`` (değeri olan şirket),
    ``below``/``above`` (değeri daha düşük/yüksek diğer şirket sayısı).
    """
    try:
        symbol = normalize_symbol(ticker)
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=e.message) from e
    try:
        return await sector_service.get_company_sector_view(symbol)
    except MarketDataError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
