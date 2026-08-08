"""Makro ekonomik veri API endpoint'leri."""

from fastapi import APIRouter

from src.adapters.macro import (
    get_tcmb_rates,
    get_policy_rate,
    get_inflation,
    get_fx_rates,
    get_economic_calendar,
)
from src.api.dependencies import ensure_upstream_success

macro_router = APIRouter(prefix="/macro", tags=["macro"])


@macro_router.get("/tcmb")
async def tcmb_rates():
    return ensure_upstream_success(await get_tcmb_rates())


@macro_router.get("/policy-rate")
async def policy_rate():
    return ensure_upstream_success(await get_policy_rate())


@macro_router.get("/inflation")
async def inflation():
    return ensure_upstream_success(await get_inflation())


@macro_router.get("/fx/{currency}")
async def fx_rates(currency: str = "USD"):
    """Doviz kuru. currency: USD, EUR, GBP, JPY, CHF, vb."""
    return ensure_upstream_success(await get_fx_rates(currency.upper()))


@macro_router.get("/calendar")
async def economic_calendar():
    return ensure_upstream_success(await get_economic_calendar())
