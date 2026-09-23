"""Makro ekonomik veri API endpoint'leri.

Hata sözleşmesi: geçersiz döviz kodu → 400, TCMB bülteninde olmayan kod → 404,
kaynağa ulaşılamıyor → 503, kaynak verisi kullanılamaz → 502 (kısa Türkçe
``detail``). Ekonomik takvim kaynağı boşsa hata değil ``available: false``.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.macro import get_economic_calendar
from src.adapters.utils import upstream_failure
from src.db.session import get_db
from src.services import macro_service

macro_router = APIRouter(prefix="/macro", tags=["macro"])
DB = Annotated[AsyncSession, Depends(get_db)]


def _respond(payload: Any) -> Any:
    failure = upstream_failure(payload)
    if failure is not None:
        status_code, detail = failure
        raise HTTPException(status_code=status_code, detail=detail)
    return payload


@macro_router.get("/tcmb")
async def tcmb_rates(db: DB):
    """Güncel politika faizi ve faiz koridoru (gecelik, geç likidite); depo öncelikli (+``meta``)."""
    return _respond(await macro_service.get_tcmb_store_first(db))


@macro_router.get("/policy-rate")
async def policy_rate(db: DB):
    """TCMB politika faizi (tarihe göre en son karar) + son 24 karar; depo öncelikli."""
    return _respond(await macro_service.get_policy_rate_store_first(db))


@macro_router.get("/inflation")
async def inflation(db: DB):
    """TÜFE: en son dönem (yıllık / aylık ayrı) + geçmiş; depo öncelikli."""
    return _respond(await macro_service.get_inflation_store_first(db))


@macro_router.get("/fx/{currency}")
async def fx_rates(db: DB, currency: str = "USD"):
    """TCMB döviz kuru (1 birim). currency: USD, EUR, GBP, JPY, CHF, vb.; depo öncelikli."""
    return _respond(await macro_service.get_fx_store_first(db, currency.strip().upper()))


@macro_router.get("/calendar")
async def economic_calendar():
    """Bu haftanın ekonomik takvimi (TR + ABD), zamana göre sıralı."""
    return _respond(await get_economic_calendar())
