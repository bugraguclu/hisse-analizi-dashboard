"""Canli veri akisi adaptoru — TradingView WebSocket stream."""

import structlog

from src.adapters.utils import TTL_PRICE_SNAPSHOT, cached, df_to_records, run_sync, safe_serialize

logger = structlog.get_logger(__name__)


class LivePriceStream:
    """Canli fiyat stream yoneticisi.

    Kullanim:
        stream = LivePriceStream(["THYAO", "GARAN", "SISE"])
        stream.start(callback=my_handler)
        # ...
        stream.stop()
    """

    def __init__(self, symbols: list[str]):
        self.symbols = symbols
        self._stream = None

    def start(self, callback) -> None:
        """Stream'i baslat. callback(data) her fiyat guncellemesinde cagirilir."""
        try:
            from borsapy import TradingViewStream
            self._stream = TradingViewStream(
                symbols=self.symbols,
                on_data=callback,
            )
            self._stream.start()
            logger.info("stream_started", symbols=self.symbols)
        except Exception as e:
            logger.error("stream_start_error", error=str(e))
            raise

    def stop(self) -> None:
        """Stream'i durdur."""
        if self._stream is not None:
            try:
                self._stream.stop()
                logger.info("stream_stopped", symbols=self.symbols)
            except Exception as e:
                logger.error("stream_stop_error", error=str(e))
            finally:
                self._stream = None


def _snapshot_from_records(symbols: list[str], records: list[dict]) -> dict[str, dict]:
    """Map one TradingView Scanner response to the existing snapshot contract."""
    by_symbol = {str(row.get("symbol", "")).upper(): row for row in records}
    snapshot: dict[str, dict] = {}
    for symbol in symbols:
        row = by_symbol.get(symbol.upper())
        if row is None:
            snapshot[symbol] = {"error": "Sembol için güncel fiyat bulunamadı"}
            continue

        last_price = row.get("close")
        change_percent = row.get("change")
        previous_close = None
        if isinstance(last_price, (int, float)) and isinstance(change_percent, (int, float)):
            denominator = 1 + float(change_percent) / 100
            if denominator > 0:
                previous_close = float(last_price) / denominator

        snapshot[symbol] = safe_serialize({
            "currency": "TRY",
            "exchange": "BIST",
            "timezone": "Europe/Istanbul",
            "last_price": last_price,
            "open": row.get("open"),
            "day_high": row.get("high"),
            "day_low": row.get("low"),
            "previous_close": previous_close,
            "change_percent": change_percent,
            "volume": row.get("volume"),
            "market_cap": row.get("market_cap"),
        })
    return snapshot


@cached(TTL_PRICE_SNAPSHOT, "stream")
async def get_snapshot(symbols: list[str]) -> dict:
    """Birden fazla sembol için tek batch isteğinde fiyat snapshot'ı."""
    try:
        import borsapy as bp

        def scan_symbols():
            scanner = bp.TechnicalScanner().set_universe(symbols)
            scanner.add_condition("close > 0")
            for column in ("open", "high", "low", "volume"):
                scanner.add_column(column)
            return scanner.run(limit=len(symbols))

        result = await run_sync(scan_symbols)
        records = df_to_records(result) if hasattr(result, "iterrows") else []
        if not records:
            return {
                "symbols": symbols,
                "snapshot": {},
                "source": "TradingView Scanner API (borsapy)",
                "error": "Fiyat sağlayıcısı boş snapshot döndürdü",
            }
        return {
            "symbols": symbols,
            "snapshot": _snapshot_from_records(symbols, records),
            "source": "TradingView Scanner API (borsapy)",
        }
    except Exception as e:
        logger.error("snapshot_error", symbols=symbols, error=str(e))
        return {"symbols": symbols, "snapshot": {}, "error": str(e)}
