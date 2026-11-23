"""Sektör ortalamaları API'si — KAP sektörüne göre medyanlar, emsaller ve benzer şirketler.

Hata sözleşmesi diğer uçlarla aynı: geçersiz sembol → 400, depo okunamıyor → 503 (kısa Türkçe
``detail``). Sektörü bilinmeyen hisse hata değildir: ``available: false`` döner.
"""

from fastapi import APIRouter, HTTPException, Query

from src.adapters.utils import InvalidInputError, MarketDataError, normalize_symbol
from src.services import peer_service, sector_service

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


@sectors_router.get("/fundamentals/{ticker}/peers")
async def company_peers(
    ticker: str,
    limit: int = Query(peer_service.DEFAULT_LIMIT, ge=1, le=peer_service.MAX_LIMIT),
):
    """Hisseye en çok benzeyen şirketler: benzerlik puanı (0–100), gerekçeler ve yan yana değerler.

    Aday havuzu aynı KAP sektörü ve alt sektördür (TradingView ``industry``); alt sektörde en az
    ``min_peers`` şirket yoksa sektöre genişler (``scope``/``fallback``). Puan ağırlıkları
    ``weights`` alanındadır. ``reasons[]`` makineyle okunur (``same_industry``, ``same_sector``,
    ``similar_size``, ``close_metric``) ve iki şirketin de değerini taşır; eksik değer 0 sayılmaz
    (``unavailable``: hissenin değeri olmayan bileşenler, ``peers[].missing``: adayınki).
    """
    try:
        symbol = normalize_symbol(ticker)
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=e.message) from e
    try:
        return await peer_service.get_peers_view(symbol, limit)
    except MarketDataError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
