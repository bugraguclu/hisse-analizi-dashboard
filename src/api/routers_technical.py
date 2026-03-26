"""Teknik analiz API endpoint'leri."""

from fastapi import APIRouter, Query

from src.adapters.technical import (
    get_rsi,
    get_macd,
    get_bollinger,
    get_sma,
    get_ema,
    get_supertrend,
    get_stochastic,
    get_ta_signals,
    get_ta_signals_all_timeframes,
)
from src.api.dependencies import validate_ticker

technical_router = APIRouter(prefix="/technical", tags=["technical"])


@technical_router.get("/{ticker}/rsi")
async def rsi(ticker: str, period: int = Query(default=14, ge=2, le=100)):
    return await get_rsi(validate_ticker(ticker), period=period)


@technical_router.get("/{ticker}/macd")
async def macd(ticker: str):
    return await get_macd(validate_ticker(ticker))


@technical_router.get("/{ticker}/bollinger")
async def bollinger(ticker: str, period: int = Query(default=20, ge=2, le=100)):
    return await get_bollinger(validate_ticker(ticker), period=period)


@technical_router.get("/{ticker}/sma")
async def sma(ticker: str, period: int = Query(default=20, ge=2, le=200)):
    return await get_sma(validate_ticker(ticker), period=period)


@technical_router.get("/{ticker}/ema")
async def ema(ticker: str, period: int = Query(default=20, ge=2, le=200)):
    return await get_ema(validate_ticker(ticker), period=period)


@technical_router.get("/{ticker}/supertrend")
async def supertrend(ticker: str):
    return await get_supertrend(validate_ticker(ticker))


@technical_router.get("/{ticker}/stochastic")
async def stochastic(ticker: str):
    return await get_stochastic(validate_ticker(ticker))


@technical_router.get("/{ticker}/signals")
async def signals(ticker: str):
    return await get_ta_signals(validate_ticker(ticker))


@technical_router.get("/{ticker}/signals/all-timeframes")
async def signals_all_timeframes(ticker: str):
    return await get_ta_signals_all_timeframes(validate_ticker(ticker))
