"""Makro ekonomik veri API endpoint'leri.

Hata sözleşmesi: geçersiz döviz kodu → 400, TCMB bülteninde olmayan kod → 404,
kaynağa ulaşılamıyor → 503, kaynak verisi kullanılamaz → 502 (kısa Türkçe
``detail``). Ekonomik takvim kaynağı boşsa hata değil ``available: false``.
"""

from typing import Any

from fastapi import APIRouter, HTTPException

from src.adapters.macro import (
    get_economic_calendar,
    get_fx_rates,
    get_inflation,
    get_policy_rate,
    get_tcmb_rates,
)
from src.adapters.utils import upstream_failure

macro_router = APIRouter(prefix="/macro", tags=["macro"])


def _respond(payload: Any) -> Any:
    failure = upstream_failure(payload)
    if failure is not None:
        status_code, detail = failure
        raise HTTPException(status_code=status_code, detail=detail)
    return payload


@macro_router.get("/tcmb")
async def tcmb_rates():
    """Güncel politika faizi ve faiz koridoru (gecelik, geç likidite)."""
    return _respond(await get_tcmb_rates())


@macro_router.get("/policy-rate")
async def policy_rate():
    """TCMB politika faizi (tarihe göre en son karar) + son 24 karar."""
    return _respond(await get_policy_rate())


@macro_router.get("/inflation")
async def inflation():
    """TÜFE: en son dönem (yıllık / aylık ayrı) + geçmiş."""
    return _respond(await get_inflation())


@macro_router.get("/fx/{currency}")
async def fx_rates(currency: str = "USD"):
    """TCMB döviz kuru (1 birim). currency: USD, EUR, GBP, JPY, CHF, vb."""
    return _respond(await get_fx_rates(currency.strip().upper()))


@macro_router.get("/calendar")
async def economic_calendar():
    """Bu haftanın ekonomik takvimi (TR + ABD), zamana göre sıralı."""
    return _respond(await get_economic_calendar())
