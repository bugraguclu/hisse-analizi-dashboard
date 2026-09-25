"""Temel analiz API endpoint'leri.

Hata sözleşmesi: geçersiz sembol → 400, bilinmeyen sembol → 404, veri
sağlayıcısına ulaşılamıyor → 503, sağlayıcı verisi kullanılamaz → 502; ``detail``
her zaman kısa bir Türkçe mesajdır. Boş kaynaklar (ör. bankalarda nakit akışı,
KAP takvimi boş) hata değildir: boş liste + ``available: false`` döner.
"""

from typing import Any

from fastapi import APIRouter, HTTPException

from src.adapters.fundamentals import (
    get_analyst_price_targets,
    get_balance_sheet,
    get_cashflow,
    get_company_info,
    get_dividends,
    get_earnings_dates,
    get_fast_info,
    get_income_statement,
    get_live_financial_ratios,
    get_live_news,
    get_major_holders,
    get_recommendations,
)
from src.adapters.utils import InvalidInputError, normalize_symbol, upstream_failure

fundamentals_router = APIRouter(prefix="/fundamentals", tags=["fundamentals"])


def _symbol(raw: str) -> str:
    """Normalize ``thyao`` / ``THYAO.IS`` → ``THYAO``; invalid input → 400."""
    try:
        return normalize_symbol(raw)
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=e.message) from e


def _respond(payload: Any) -> Any:
    """Map adapter error payloads to HTTP errors; pass successful payloads through."""
    failure = upstream_failure(payload)
    if failure is not None:
        status_code, detail = failure
        raise HTTPException(status_code=status_code, detail=detail)
    return payload


@fundamentals_router.get("/{ticker}/info")
async def company_info(ticker: str):
    """Şirket künyesi (KAP) + canlı fiyat özeti."""
    return _respond(await get_company_info(_symbol(ticker)))


@fundamentals_router.get("/{ticker}/fast-info")
async def fast_info(ticker: str):
    """Canlı fiyat, piyasa değeri (fiyat × pay adedi), F/K, PD/DD, 52 hafta aralığı."""
    return _respond(await get_fast_info(_symbol(ticker)))


@fundamentals_router.get("/{ticker}/balance-sheet")
async def balance_sheet(ticker: str, quarterly: bool = False):
    """Bilanço (TL). ``quarterly=true`` ara dönemleri de içerir; dönemler yeniden eskiye."""
    return _respond(await get_balance_sheet(_symbol(ticker), quarterly=quarterly))


@fundamentals_router.get("/{ticker}/income-statement")
async def income_statement(ticker: str, quarterly: bool = False):
    """Gelir tablosu (TL, mali yıl başından kümülatif; çeyreklikte ``discrete`` tek çeyrek değerleri)."""
    return _respond(await get_income_statement(_symbol(ticker), quarterly=quarterly))


@fundamentals_router.get("/{ticker}/cashflow")
async def cashflow(ticker: str, quarterly: bool = False):
    """Nakit akış tablosu (TL, kümülatif). Bankalarda ``available: false``."""
    return _respond(await get_cashflow(_symbol(ticker), quarterly=quarterly))


@fundamentals_router.get("/{ticker}/dividends")
async def dividends(ticker: str):
    return _respond(await get_dividends(_symbol(ticker)))


@fundamentals_router.get("/{ticker}/holders")
async def holders(ticker: str):
    return _respond(await get_major_holders(_symbol(ticker)))


@fundamentals_router.get("/{ticker}/recommendations")
async def recommendations(ticker: str):
    return _respond(await get_recommendations(_symbol(ticker)))


@fundamentals_router.get("/{ticker}/price-targets")
async def price_targets(ticker: str):
    return _respond(await get_analyst_price_targets(_symbol(ticker)))


@fundamentals_router.get("/{ticker}/earnings-dates")
async def earnings_dates(ticker: str):
    """KAP beklenen finansal rapor tarihleri (boşsa ``available: false``)."""
    return _respond(await get_earnings_dates(_symbol(ticker)))


@fundamentals_router.get("/{ticker}/live-ratios")
async def live_ratios(ticker: str):
    """Finansal oranlar: akım kalemleri TTM, stok kalemleri son bilanço, canlı piyasa değeri."""
    return _respond(await get_live_financial_ratios(_symbol(ticker)))


@fundamentals_router.get("/{ticker}/live-news")
async def live_news(ticker: str):
    """Son KAP bildirimleri (boşsa ``available: false``)."""
    return _respond(await get_live_news(_symbol(ticker)))
