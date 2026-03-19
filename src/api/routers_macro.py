"""Makro ekonomik veri API endpoint'leri."""

from fastapi import APIRouter

from src.adapters.macro import (
    get_tcmb_rates,
    get_policy_rate,
    get_inflation,
    get_fx_rates,
    get_economic_calendar,
)

macro_router = APIRouter(prefix="/macro", tags=["macro"])


@macro_router.get("/tcmb")
async def tcmb_rates():
    return await get_tcmb_rates()


@macro_router.get("/policy-rate")
async def policy_rate():
    return await get_policy_rate()


@macro_router.get("/inflation")
async def inflation():
    return await get_inflation()


@macro_router.get("/fx/{currency}")
async def fx_rates(currency: str = "USD"):
    """Doviz kuru. currency: USD, EUR, GBP, JPY, CHF, vb."""
    return await get_fx_rates(currency.upper())


@macro_router.get("/calendar")
async def economic_calendar():
    return await get_economic_calendar()
