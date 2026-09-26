"""Coklu sembol fiyat snapshot'i — piyasa deposu, gerekirse tek TradingView scanner istegi.

Kotasyonlar depo öncelikli okunur (``src.services.market_service.get_quotes``):
market worker dakikada bir tüm evreni tek istekle yazar; depoda taze olmayan
semboller için tek canlı istek atılır. Yanıt eklemeli ``meta`` bloğu taşır.

Küçük isteklerde (hisse sayfası: tek sembol; en çok
``market_service.OFFICIAL_OVERLAY_MAX_SYMBOLS``) hacim İş Yatırım OneEndeks'in resmî
lot adedidir (TradingView'un gün içi hacmi kapanış fiyatından işlemleri kaçırır) ve
piyasa değeri son fiyat × ödenmiş sermayedir; büyük listeler (izleme listesi)
TradingView değerleriyle kalır. ``updated_at`` seans kapanışıyla (18:10) sınırlıdır,
``session_state`` ``open``/``closed`` (eklemeli).

(Kullanilmayan TradingView websocket ``LivePriceStream`` sarmalayicisi
kaldirildi; canli akis yerine frontend snapshot'i periyodik yeniler.)
"""

import asyncio
from typing import Any

import structlog

from src.adapters.utils import TTL_PRICE_SNAPSHOT, cached, error_payload
from src.services import market_service

logger = structlog.get_logger(__name__)

SOURCE = "TradingView Scanner API (borsapy)"
MISSING_QUOTE_MESSAGE = "Sembol için güncel fiyat bulunamadı"


def _snapshot_entry(
    quote: dict[str, Any],
    official: dict[str, Any] | None = None,
    stored_capital: float | None = None,
) -> dict[str, Any]:
    figures = market_service.official_session_figures(official, quote.get("session_date"))
    capital = market_service.company_capital(str(quote.get("symbol") or ""), official)  # else earlier today's
    count = market_service.share_count(capital.capital if capital else None, stored_capital)
    market_cap = count.market_cap(quote.get("last"))
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
        "volume": figures[0] if figures is not None else quote.get("volume"),
        "market_cap": market_cap if market_cap is not None else quote.get("market_cap"),
        "updated_at": quote.get("updated_at"),
        # add-only
        "session_state": quote.get("session_state"),
        "volume_source": (
            market_service.VOLUME_SOURCE_ISYATIRIM if figures is not None
            else (market_service.VOLUME_SOURCE_TRADINGVIEW if quote.get("volume") is not None else None)
        ),
    }


def _snapshot_from_quotes(
    symbols: list[str],
    quotes: dict[str, dict[str, Any]],
    official: dict[str, dict[str, Any]] | None = None,
    stored_capitals: dict[str, float] | None = None,
) -> dict[str, dict]:
    """Per-symbol snapshot; symbols without a quote carry an ``error`` entry."""
    snapshot: dict[str, dict] = {}
    for symbol in symbols:
        quote = quotes.get(symbol)
        snapshot[symbol] = (
            _snapshot_entry(quote, (official or {}).get(symbol), (stored_capitals or {}).get(symbol))
            if quote
            else {"error": MISSING_QUOTE_MESSAGE}
        )
    return snapshot


async def _no_official() -> dict[str, dict[str, Any]]:
    return {}


@cached(TTL_PRICE_SNAPSHOT, "stream")
async def get_snapshot(symbols: list[str]) -> dict:
    """Birden fazla sembol için tek batch isteğinde fiyat snapshot'ı."""
    try:
        small = len(symbols) <= market_service.OFFICIAL_OVERLAY_MAX_SYMBOLS
        result, official, stored_capitals = await asyncio.gather(
            market_service.get_quotes(tuple(symbols)),
            market_service.get_official_quotes(symbols) if small else _no_official(),
            market_service.get_paid_in_capitals(),
        )
        snapshot = _snapshot_from_quotes(symbols, result.quotes, official, stored_capitals)
        used_official = any(entry.get("volume_source") == market_service.VOLUME_SOURCE_ISYATIRIM
                            for entry in snapshot.values())
        meta = market_service.with_official_provenance(
            result.meta, {"volume_source": market_service.VOLUME_SOURCE_ISYATIRIM} if used_official else {}
        )
        return {
            "symbols": symbols,
            "snapshot": snapshot,
            "source": SOURCE,
            **market_service.meta_dict(meta),
        }
    except Exception as e:
        logger.error("snapshot_error", symbols=symbols, error=str(e))
        return {"symbols": symbols, "snapshot": {}, **error_payload(e, "Fiyat snapshot'ı alınamadı")}
