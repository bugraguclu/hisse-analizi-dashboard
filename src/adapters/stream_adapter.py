"""Coklu sembol fiyat snapshot'i — tek TradingView scanner istegi.

(Kullanilmayan TradingView websocket ``LivePriceStream`` sarmalayicisi
kaldirildi; canli akis yerine frontend snapshot'i periyodik yeniler.)
"""

from typing import Any

import structlog

from src.adapters.price import get_quotes
from src.adapters.utils import TTL_PRICE_SNAPSHOT, cached, error_payload

logger = structlog.get_logger(__name__)

SOURCE = "TradingView Scanner API (borsapy)"
MISSING_QUOTE_MESSAGE = "Sembol için güncel fiyat bulunamadı"


def _snapshot_entry(quote: dict[str, Any]) -> dict[str, Any]:
    return {
        "currency": quote.get("currency") or "TRY",
        "exchange": "BIST",
        "timezone": "Europe/Istanbul",
        "name": quote.get("name"),
        "last_price": quote.get("last"),
        "open": quote.get("open"),
        "day_high": quote.get("high"),
        "day_low": quote.get("low"),
        "previous_close": quote.get("prev_close"),
        "change": quote.get("change"),
        "change_percent": quote.get("change_percent"),
        "volume": quote.get("volume"),
        "market_cap": quote.get("market_cap"),
        "updated_at": quote.get("updated_at"),
    }


def _snapshot_from_quotes(symbols: list[str], quotes: dict[str, dict[str, Any]]) -> dict[str, dict]:
    """Per-symbol snapshot; symbols without a quote carry an ``error`` entry."""
    snapshot: dict[str, dict] = {}
    for symbol in symbols:
        quote = quotes.get(symbol)
        snapshot[symbol] = _snapshot_entry(quote) if quote else {"error": MISSING_QUOTE_MESSAGE}
    return snapshot


@cached(TTL_PRICE_SNAPSHOT, "stream")
async def get_snapshot(symbols: list[str]) -> dict:
    """Birden fazla sembol için tek batch isteğinde fiyat snapshot'ı."""
    try:
        quotes = await get_quotes(tuple(symbols))
        return {
            "symbols": symbols,
            "snapshot": _snapshot_from_quotes(symbols, quotes),
            "source": SOURCE,
        }
    except Exception as e:
        logger.error("snapshot_error", symbols=symbols, error=str(e))
        return {"symbols": symbols, "snapshot": {}, **error_payload(e, "Fiyat snapshot'ı alınamadı")}
