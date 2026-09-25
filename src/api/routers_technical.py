"""Teknik analiz API endpoint'leri (gunluk zaman dilimi)."""

from fastapi import APIRouter, HTTPException, Query

from src.adapters.technical import (
    get_bollinger,
    get_ema,
    get_macd,
    get_moving_averages,
    get_pivot_points,
    get_rsi,
    get_sma,
    get_stochastic,
    get_supertrend,
    get_ta_signals,
    get_ta_signals_all_timeframes,
)
from src.adapters.utils import MarketDataError, normalize_symbol, upstream_failure

technical_router = APIRouter(prefix="/technical", tags=["technical"])


def _ok(payload: dict) -> dict:
    """Turn an adapter error payload into an HTTP error with a short Turkish detail."""
    failure = upstream_failure(payload)
    if failure is not None:
        raise HTTPException(status_code=failure[0], detail=failure[1])
    return payload


def _symbol(raw: str) -> str:
    try:
        return normalize_symbol(raw)
    except MarketDataError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e


@technical_router.get("/{ticker}/rsi")
async def rsi(ticker: str, period: int = Query(default=14, ge=2, le=100)):
    """Wilder RSI. 14 = TradingView degeri; diger periyotlar gunluk barlardan hesaplanir."""
    return _ok(await get_rsi(_symbol(ticker), period=period))


@technical_router.get("/{ticker}/macd")
async def macd(ticker: str):
    """MACD (12, 26, 9)."""
    return _ok(await get_macd(_symbol(ticker)))


@technical_router.get("/{ticker}/bollinger")
async def bollinger(ticker: str, period: int = Query(default=20, ge=2, le=100)):
    """Bollinger bantlari (periyot, 2σ)."""
    return _ok(await get_bollinger(_symbol(ticker), period=period))


@technical_router.get("/{ticker}/sma")
async def sma(ticker: str, period: int = Query(default=20, ge=2, le=200)):
    return _ok(await get_sma(_symbol(ticker), period=period))


@technical_router.get("/{ticker}/ema")
async def ema(ticker: str, period: int = Query(default=20, ge=2, le=200)):
    return _ok(await get_ema(_symbol(ticker), period=period))


@technical_router.get("/{ticker}/supertrend")
async def supertrend(ticker: str):
    """SuperTrend (ATR 10, carpan 3); direction 1 = yukselis, -1 = dusus."""
    return _ok(await get_supertrend(_symbol(ticker)))


@technical_router.get("/{ticker}/stochastic")
async def stochastic(ticker: str):
    """Stokastik (14, 3, 3)."""
    return _ok(await get_stochastic(_symbol(ticker)))


@technical_router.get("/{ticker}/signals")
async def signals(ticker: str):
    """Gunluk TradingView teknik derecelendirmesi."""
    return _ok(await get_ta_signals(_symbol(ticker)))


@technical_router.get("/{ticker}/signals/all-timeframes")
async def signals_all_timeframes(ticker: str):
    """1m, 5m, 15m, 30m, 1h, 4h, 1d, 1W, 1M derecelendirmeleri."""
    return _ok(await get_ta_signals_all_timeframes(_symbol(ticker)))


@technical_router.get("/{ticker}/moving-averages")
async def moving_averages(ticker: str):
    """SMA/EMA 10-200, SMA50/SMA200 rejimi ve son golden/death cross."""
    return _ok(await get_moving_averages(_symbol(ticker)))


@technical_router.get("/{ticker}/pivots")
async def pivots(ticker: str):
    """Klasik pivot noktalari (son tamamlanan seansin H/L/C degerlerinden)."""
    return _ok(await get_pivot_points(_symbol(ticker)))
