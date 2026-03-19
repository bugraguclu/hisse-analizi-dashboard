"""Temel analiz API endpoint'leri."""

from fastapi import APIRouter

from src.adapters.fundamentals import (
    get_company_info,
    get_fast_info,
    get_balance_sheet,
    get_income_statement,
    get_cashflow,
    get_dividends,
    get_major_holders,
    get_recommendations,
    get_analyst_price_targets,
    get_earnings_dates,
)

fundamentals_router = APIRouter(prefix="/fundamentals", tags=["fundamentals"])


@fundamentals_router.get("/{ticker}/info")
async def company_info(ticker: str):
    return await get_company_info(ticker.upper())


@fundamentals_router.get("/{ticker}/fast-info")
async def fast_info(ticker: str):
    return await get_fast_info(ticker.upper())


@fundamentals_router.get("/{ticker}/balance-sheet")
async def balance_sheet(ticker: str, quarterly: bool = False):
    return await get_balance_sheet(ticker.upper(), quarterly=quarterly)


@fundamentals_router.get("/{ticker}/income-statement")
async def income_statement(ticker: str, quarterly: bool = False):
    return await get_income_statement(ticker.upper(), quarterly=quarterly)


@fundamentals_router.get("/{ticker}/cashflow")
async def cashflow(ticker: str, quarterly: bool = False):
    return await get_cashflow(ticker.upper(), quarterly=quarterly)


@fundamentals_router.get("/{ticker}/dividends")
async def dividends(ticker: str):
    return await get_dividends(ticker.upper())


@fundamentals_router.get("/{ticker}/holders")
async def holders(ticker: str):
    return await get_major_holders(ticker.upper())


@fundamentals_router.get("/{ticker}/recommendations")
async def recommendations(ticker: str):
    return await get_recommendations(ticker.upper())


@fundamentals_router.get("/{ticker}/price-targets")
async def price_targets(ticker: str):
    return await get_analyst_price_targets(ticker.upper())


@fundamentals_router.get("/{ticker}/earnings-dates")
async def earnings_dates(ticker: str):
    return await get_earnings_dates(ticker.upper())
