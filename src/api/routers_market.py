"""Piyasa verileri API endpoint'leri — tarama, endeks, arama ve snapshot."""

from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query

from src.adapters.index_adapter import get_index_data, get_index_info, get_ticker_history, list_indices
from src.adapters.price import MAX_CHART_WARMUP_BARS
from src.adapters.scanner_adapter import resolve_condition, scan_signals
from src.adapters.screener_adapter import get_screener_templates, normalize_filters, screen_stocks
from src.adapters.screener_universe import get_screener_universe
from src.adapters.search_adapter import list_companies, normalize_query, search_symbol
from src.adapters.stream_adapter import get_snapshot
from src.adapters.utils import MarketDataError, normalize_symbol, resolve_period, upstream_failure

market_router = APIRouter(prefix="/market", tags=["market"])

MAX_SNAPSHOT_SYMBOLS = 50


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


def _period(raw: str) -> str:
    try:
        resolve_period(raw)
    except MarketDataError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    return raw.strip().lower()


# --- Screener ---

@market_router.get("/screener")
async def screener():
    """Varsayilan filtrelerle hisse taramasi (fiyat, gunluk degisim, hacim, piyasa degeri, sektor)."""
    return _ok(await screen_stocks())


@market_router.post("/screener")
async def screener_with_filters(filters: dict[str, Any] = Body(...)):
    """Ozel filtrelerle hisse taramasi.

    Kabul edilen alanlar: template, sector, index, recommendation (AL/SAT/TUT),
    <kriter>_min/_max (market_cap milyon TL; pe, pb, dividend_yield,
    upside_potential, net_margin, roe) ve TradingView tarzi [min, max]
    araliklari (market_cap_basic TL, price_earnings_ttm, price_book_fq,
    dividend_yield_recent, return_on_equity).
    """
    try:
        normalize_filters(filters)
    except MarketDataError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    return _ok(await screen_stocks(filters=filters))


@market_router.get("/screener/templates")
async def screener_templates():
    """Hazir tarama sablonlari."""
    return _ok(await get_screener_templates())


@market_router.get("/screener/universe")
async def screener_universe():
    """Tarama evreni: tum BIST hisseleri icin fiyat, oran, teknik, analist ve endeks uyeligi.

    Dashboard'un /tarama sayfasi filtreleme/siralamayi bu tablo uzerinde tarayicida yapar.
    """
    return _ok(await get_screener_universe())


# --- Scanner ---

@market_router.get("/scanner")
async def scanner(condition: str | None = Query(default=None, max_length=40)):
    """XU100 teknik sinyal taramasi (rsi_oversold, rsi_overbought, golden_cross, death_cross)."""
    try:
        resolve_condition(condition)
    except MarketDataError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    normalized = condition.strip().lower() if condition and condition.strip() else None
    return _ok(await scan_signals(condition=normalized))


# --- Index ---

@market_router.get("/indices")
async def indices():
    """Tum BIST endekslerini listele (ana endeksler icin canli kotasyon)."""
    return _ok(await list_indices())


@market_router.get("/index/{symbol}")
async def index_data(
    symbol: str,
    period: str = Query(default="1ay", max_length=10),
    warmup: int = Query(default=0, ge=0, le=MAX_CHART_WARMUP_BARS),
):
    """Endeks fiyat verisi. period: 1g, 5g, 1ay, 3ay, 6ay, ytd, 1y, 2y, 5y, max.

    warmup: pencereden onceki en fazla N bar'i "warmup" alaninda ekler (gosterge
    hesaplari ve sola kaydirma icin); 0 (varsayilan) iken alan hic donmez.
    """
    normalized_symbol, normalized_period = _symbol(symbol), _period(period)
    if warmup:
        return _ok(await get_index_data(normalized_symbol, period=normalized_period, warmup=warmup))
    return _ok(await get_index_data(normalized_symbol, period=normalized_period))


@market_router.get("/index/{symbol}/info")
async def index_info(symbol: str):
    """Endeks bilgileri."""
    return _ok(await get_index_info(_symbol(symbol)))


# --- Search ---

@market_router.get("/search")
async def search(q: str = Query(min_length=1, max_length=100)):
    """BIST hisse ara (en az 2 karakter)."""
    try:
        query = normalize_query(q)
    except MarketDataError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    return _ok(await search_symbol(query))


@market_router.get("/companies/all")
async def all_companies():
    """Tum BIST sirketlerini listele."""
    return _ok(await list_companies())


# --- Ticker History (live) ---

@market_router.get("/ticker/{ticker}/history")
async def ticker_history(
    ticker: str,
    period: str = Query(default="1ay", max_length=10),
    warmup: int = Query(default=0, ge=0, le=MAX_CHART_WARMUP_BARS),
):
    """Hisse fiyat gecmisi (canli). period: 1g, 5g, 1ay, 3ay, 6ay, ytd, 1y, 2y, 5y, max.

    warmup: pencereden onceki en fazla N bar'i "warmup" alaninda ekler (gosterge
    hesaplari ve sola kaydirma icin); 0 (varsayilan) iken alan hic donmez.
    """
    normalized_ticker, normalized_period = _symbol(ticker), _period(period)
    if warmup:
        return _ok(await get_ticker_history(normalized_ticker, period=normalized_period, warmup=warmup))
    return _ok(await get_ticker_history(normalized_ticker, period=normalized_period))


# --- Snapshot ---

@market_router.get("/snapshot")
async def snapshot(
    symbols: str = Query(
        max_length=1000,
        description=f"Virgul ile ayrilmis semboller (en fazla {MAX_SNAPSHOT_SYMBOLS}), orn: THYAO,GARAN,SISE",
    ),
):
    """Birden fazla hisse icin anlik fiyat snapshot'i."""
    symbol_list = list(dict.fromkeys(_symbol(s) for s in symbols.split(",") if s.strip()))
    if not symbol_list:
        raise HTTPException(status_code=400, detail="En az bir sembol belirtin")
    if len(symbol_list) > MAX_SNAPSHOT_SYMBOLS:
        raise HTTPException(status_code=400, detail=f"En fazla {MAX_SNAPSHOT_SYMBOLS} sembol sorgulanabilir")
    return _ok(await get_snapshot(symbol_list))
