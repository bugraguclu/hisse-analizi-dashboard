"""Endeks adaptoru — BIST endeks verileri ve canli hisse fiyat gecmisi."""

import asyncio
from collections.abc import Awaitable
from typing import Any, TypeVar

import pandas as pd
import structlog

from src.adapters.price import (
    bars_to_records,
    daily_stats,
    get_chart_window_parts,
    get_company_metrics,
    get_daily_bars,
    get_quotes,
)
from src.adapters.utils import (
    TTL_QUOTE,
    SymbolNotFoundError,
    cached,
    error_payload,
    resolve_period,
)

logger = structlog.get_logger(__name__)

SOURCE = "Borsa Istanbul via TradingView (borsapy)"

# UI'da gösterilen endeksler — tüm liste meta veri olarak ayrıca döner.
MAIN_INDICES = [
    "XU100", "XU030", "XBANK", "XUSIN",
]

# Index quotes move slowly relative to the 15-minute-delayed feed; the list is
# polled by several widgets, so keep it a little longer than stock quotes.
TTL_INDEX_QUOTE = 60

# Secondary parts of a chart response (quote, company card, 52-week stats) may
# not hold the chart hostage: once the bars are in they get OPTIONAL_PART_GRACE
# more seconds (OPTIONAL_PART_TIMEOUT in all), then they are left out (their
# cached fetch keeps running in the background and serves the next request).
OPTIONAL_PART_TIMEOUT = 6.0
OPTIONAL_PART_GRACE = 1.0

T = TypeVar("T")


async def _optional(awaitable: Awaitable[T], part: str, symbol: str) -> T | None:
    try:
        return await asyncio.wait_for(awaitable, OPTIONAL_PART_TIMEOUT)
    except Exception as e:  # includes TimeoutError
        logger.warning("chart_part_unavailable", symbol=symbol, part=part, error=str(e) or type(e).__name__)
        return None


async def _with_optional_parts(primary: Awaitable[T], optional: dict[str, Awaitable[Any]], symbol: str) -> tuple[T, dict[str, Any]]:
    """Await ``primary`` and the optional parts concurrently.

    A part still running ``OPTIONAL_PART_GRACE`` seconds after the primary is
    left out (``None``); a failing primary cancels the rest.
    """
    parts = {name: asyncio.ensure_future(_optional(aw, name, symbol)) for name, aw in optional.items()}
    try:
        result = await primary
    except BaseException:
        for task in parts.values():
            task.cancel()
        raise
    waiting = [task for task in parts.values() if not task.done()]
    if waiting:
        await asyncio.wait(waiting, timeout=OPTIONAL_PART_GRACE)
    values: dict[str, Any] = {}
    for name, task in parts.items():
        if task.done():
            values[name] = task.result()
        else:
            task.cancel()
            logger.info("chart_part_skipped", symbol=symbol, part=name, grace=OPTIONAL_PART_GRACE)
            values[name] = None
    return result, values


def _index_names() -> dict[str, str]:
    try:
        from borsapy.index import INDICES
    except ImportError:  # pragma: no cover - borsapy is a hard dependency
        return {}
    return dict(INDICES)


def _index_quote_payload(quote: dict[str, Any]) -> dict[str, Any]:
    """Index quote in the historical ``Index.info`` shape (bid/ask are not published for indices)."""
    symbol = quote["symbol"]
    return {
        "symbol": symbol,
        "exchange": "BIST",
        "last": quote["last"],
        "change": quote["change"],
        "change_percent": quote["change_percent"],
        "open": quote["open"],
        "high": quote["high"],
        "low": quote["low"],
        "prev_close": quote["prev_close"],
        "volume": quote["volume"],
        "bid": None,
        "ask": None,
        "bid_size": None,
        "ask_size": None,
        "timestamp": quote["timestamp"],
        "updated_at": quote["updated_at"],
        "description": quote["name"],
        "currency": quote["currency"],
        "name": _index_names().get(symbol, quote["name"] or symbol),
        "type": "index",
    }


async def _index_quote(symbol: str) -> dict[str, Any] | None:
    quote = (await get_quotes((symbol,))).get(symbol)
    return _index_quote_payload(quote) if quote else None


@cached(TTL_QUOTE, "index")
async def get_index_data(symbol: str = "XU100", period: str = "1ay", warmup: int = 0) -> dict:
    """Endeks fiyat verisi (XU100, XU030, vb.) + canli kotasyon.

    ``info`` onceki kapanis ve gunluk degisimi tasir; grafik barlari
    periyodun gercek takvim/seans penceresine kirpilir. ``reference_close`` /
    ``reference_date``: pencereden onceki son kapanis (periyot degisiminin bazi).
    ``warmup`` > 0: yanita, pencereden hemen once gelen en fazla ``warmup``
    bar'i tasiyan bir ``"warmup"`` listesi eklenir (gostergelerin pencerenin
    sol ucunda da dogru hesaplanmasi icin); ``warmup=0`` iken anahtar hic yok.
    """
    try:
        spec = resolve_period(period)
        (bars, before, reference), parts = await _with_optional_parts(
            get_chart_window_parts(symbol, spec), {"quote": _index_quote(symbol)}, symbol
        )
        result = {
            "symbol": symbol,
            "period": period,
            "interval": spec.interval,
            "source": SOURCE,
            "info": parts["quote"] or {},
            **reference,
            "data": bars_to_records(bars),
        }
        if warmup > 0:
            result["warmup"] = bars_to_records(before.tail(warmup))
        return result
    except Exception as e:
        logger.error("index_data_error", symbol=symbol, period=period, error=str(e))
        return {"symbol": symbol, "period": period, "data": [], **error_payload(e, "Endeks verisi alınamadı")}


@cached(TTL_INDEX_QUOTE, "index")
async def get_index_info(symbol: str = "XU100") -> dict:
    """Endeks bilgileri (canli kotasyon)."""
    try:
        info = await _index_quote(symbol)
        if info is None:
            raise SymbolNotFoundError(symbol)
        return {"symbol": symbol, "source": SOURCE, "info": info}
    except Exception as e:
        logger.error("index_info_error", symbol=symbol, error=str(e))
        return {"symbol": symbol, "info": {}, **error_payload(e, "Endeks kotasyonu alınamadı")}


@cached(TTL_INDEX_QUOTE, "index")
async def list_indices() -> dict:
    """Tum BIST endekslerini listele; ana endeksler icin canli kotasyon ekle.

    Kotasyonlar tek TradingView scanner isteginden gelir (tarayicida olmayan
    XUSIN icin websocket yedegi) — endeks basina ayri baglanti acilmaz.
    """
    try:
        quotes = await get_quotes(tuple(MAIN_INDICES))
        return {
            "source": SOURCE,
            "indices": list(_index_names()),
            "quotes": [_index_quote_payload(quotes[s]) for s in MAIN_INDICES if s in quotes],
        }
    except Exception as e:
        logger.error("indices_list_error", error=str(e))
        return {"indices": [], "quotes": [], **error_payload(e, "Endeks listesi alınamadı")}


def _ticker_info(
    quote: dict[str, Any] | None,
    metrics: dict[str, Any] | None,
    stats: dict[str, float | None],
) -> dict[str, Any]:
    """Live key stats in the historical ``Ticker.fast_info`` shape (+ change fields)."""
    quote = quote or {}
    metrics = metrics or {}
    last_price = quote.get("last")
    market_cap = metrics.get("market_cap") or quote.get("market_cap")
    shares = int(market_cap / last_price) if market_cap and last_price else None
    return {
        "currency": quote.get("currency") or "TRY",
        "exchange": "BIST",
        "timezone": "Europe/Istanbul",
        "last_price": last_price,
        "open": quote.get("open"),
        "day_high": quote.get("high"),
        "day_low": quote.get("low"),
        "previous_close": quote.get("prev_close"),
        "change": quote.get("change"),
        "change_percent": quote.get("change_percent"),
        "volume": quote.get("volume"),
        "amount": quote.get("turnover"),
        "market_cap": market_cap,
        "shares": shares,
        "pe_ratio": metrics.get("pe_ratio"),
        "pb_ratio": metrics.get("pb_ratio"),
        "year_high": stats.get("year_high"),
        "year_low": stats.get("year_low"),
        "fifty_day_average": stats.get("fifty_day_average"),
        "two_hundred_day_average": stats.get("two_hundred_day_average"),
        "free_float": metrics.get("free_float"),
        "foreign_ratio": metrics.get("foreign_ratio"),
        "updated_at": quote.get("updated_at"),
    }


@cached(TTL_QUOTE, "ticker_history")
async def get_ticker_history(ticker: str, period: str = "1ay", warmup: int = 0) -> dict:
    """Hisse fiyat gecmisi + canli temel istatistikler (borsapy/TradingView).

    Grafik barlari, kotasyon, sirket karti ve gunluk bar istatistikleri
    paralel cekilir; gunluk periyotlar (1ay–1y) teknik gostergelerle ayni
    onbellekli gunluk seriyi paylasir. ``reference_close`` / ``reference_date``:
    pencereden onceki son kapanis (periyot degisiminin bazi; 1g'de onceki kapanis).
    ``warmup`` > 0: yanita, pencereden hemen once gelen en fazla ``warmup``
    bar'i tasiyan bir ``"warmup"`` listesi eklenir (gostergelerin pencerenin
    sol ucunda da dogru hesaplanmasi icin); ``warmup=0`` iken anahtar hic yok.
    """
    try:
        spec = resolve_period(period)
        (bars, before, reference), parts = await _with_optional_parts(
            get_chart_window_parts(ticker, spec),
            {
                "quote": get_quotes((ticker,)),
                "company_metrics": get_company_metrics(ticker),
                "daily_bars": get_daily_bars(ticker),
            },
            ticker,
        )
        quotes, daily = parts["quote"] or {}, parts["daily_bars"]
        stats = daily_stats(daily if isinstance(daily, pd.DataFrame) else pd.DataFrame())
        result = {
            "ticker": ticker,
            "source": SOURCE,
            "period": period,
            "interval": spec.interval,
            "info": _ticker_info(quotes.get(ticker), parts["company_metrics"], stats),
            **reference,
            "data": bars_to_records(bars),
        }
        if warmup > 0:
            result["warmup"] = bars_to_records(before.tail(warmup))
        return result
    except Exception as e:
        logger.error("ticker_history_error", ticker=ticker, period=period, error=str(e))
        return {"ticker": ticker, "period": period, "data": [], **error_payload(e, "Fiyat geçmişi alınamadı")}
