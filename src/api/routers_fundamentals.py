"""Temel analiz API endpoint'leri.

Hata sözleşmesi: geçersiz sembol → 400, bilinmeyen sembol → 404, veri
sağlayıcısına ulaşılamıyor → 503, sağlayıcı verisi kullanılamaz → 502; ``detail``
her zaman kısa bir Türkçe mesajdır. Boş kaynaklar (ör. bankalarda nakit akışı,
KAP takvimi boş) hata değildir: boş liste + ``available: false`` döner.
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.fundamentals import (
    get_company_info,
    get_fast_info,
    get_live_news,
)
from src.adapters.utils import InvalidInputError, MarketDataError, normalize_symbol, upstream_failure
from src.core.meta import with_meta
from src.db.session import get_db
from src.services import fundamentals_service, reference_service

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
    """Bilanço (TL). ``quarterly=true`` ara dönemleri de içerir; dönemler yeniden eskiye.

    Depo öncelikli (KAP ilk açıklanan + İş Yatırım ara dönemler); ``meta`` ile.
    """
    return _respond(await fundamentals_service.get_statement_view(_symbol(ticker), section="balance", quarterly=quarterly))


@fundamentals_router.get("/{ticker}/income-statement")
async def income_statement(ticker: str, quarterly: bool = False):
    """Gelir tablosu (TL, mali yıl başından kümülatif; çeyreklikte ``discrete`` tek çeyrek değerleri)."""
    return _respond(await fundamentals_service.get_statement_view(_symbol(ticker), section="income", quarterly=quarterly))


@fundamentals_router.get("/{ticker}/cashflow")
async def cashflow(ticker: str, quarterly: bool = False):
    """Nakit akış tablosu (TL, kümülatif). Bankalarda ``available: false``. Depo öncelikli."""
    return _respond(await fundamentals_service.get_cashflow_view(_symbol(ticker), quarterly=quarterly))


async def _reference(fetch: Any, ticker: str, db: AsyncSession) -> dict[str, Any]:
    """Store-first reference payload (+ ``meta``); provider failures keep the legacy error contract."""
    symbol = _symbol(ticker)
    try:
        payload, meta = await fetch(db, symbol)
    except MarketDataError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    return with_meta(payload, meta)


@fundamentals_router.get("/{ticker}/dividends")
async def dividends(ticker: str, db: AsyncSession = Depends(get_db)):
    """Nakit temettü geçmişi (İş Yatırım; depo öncelikli, ``meta`` ile)."""
    return await _reference(reference_service.get_dividends, ticker, db)


@fundamentals_router.get("/{ticker}/holders")
async def holders(ticker: str, db: AsyncSession = Depends(get_db)):
    """Ortaklık yapısı (İş Yatırım şirket kartı; depo öncelikli)."""
    return await _reference(reference_service.get_holders, ticker, db)


@fundamentals_router.get("/{ticker}/recommendations")
async def recommendations(ticker: str, db: AsyncSession = Depends(get_db)):
    """İş Yatırım önerisi ve hedef fiyatı (depo öncelikli)."""
    return await _reference(reference_service.get_recommendations, ticker, db)


@fundamentals_router.get("/{ticker}/price-targets")
async def price_targets(ticker: str, db: AsyncSession = Depends(get_db)):
    """Analist hedef fiyat konsensüsü (hedeffiyat.com.tr; depo öncelikli) + güncel fiyat."""
    return await _reference(reference_service.get_price_targets, ticker, db)


@fundamentals_router.get("/{ticker}/earnings-dates")
async def earnings_dates(ticker: str, db: AsyncSession = Depends(get_db)):
    """KAP beklenen finansal rapor tarihleri (boşsa ``available: false``; depo öncelikli)."""
    return await _reference(reference_service.get_earnings_dates, ticker, db)


@fundamentals_router.get("/{ticker}/live-ratios")
async def live_ratios(ticker: str):
    """Finansal oranlar: akım kalemleri TTM, stok kalemleri son bilanço, canlı piyasa değeri.

    Tablolar depodan (KAP ilk açıklanan bazında kanonik kalemler), fiyat canlı; ``meta`` ile.
    """
    return _respond(await fundamentals_service.get_live_ratios_view(_symbol(ticker)))


@fundamentals_router.get("/{ticker}/live-news")
async def live_news(ticker: str):
    """Son KAP bildirimleri (boşsa ``available: false``)."""
    return _respond(await get_live_news(_symbol(ticker)))
