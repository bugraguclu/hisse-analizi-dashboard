"""Canli veri akisi adaptoru — TradingView WebSocket stream."""

import structlog

from src.adapters.utils import cached, safe_serialize, run_sync, TTL_PRICE_SNAPSHOT

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


@cached(TTL_PRICE_SNAPSHOT, "stream")
async def get_snapshot(symbols: list[str]) -> dict:
    """Birden fazla sembol icin anlik fiyat snapshot'i (stream kullanmadan)."""
    try:
        import borsapy as bp
        results = {}
        for symbol in symbols:
            try:
                t = await run_sync(lambda s=symbol: bp.Ticker(s))
                fi = await run_sync(lambda: t.fast_info)
                results[symbol] = safe_serialize(fi) if fi else {}
            except Exception as e:
                results[symbol] = {"error": str(e)}
        return {"symbols": symbols, "snapshot": results}
    except Exception as e:
        logger.error("snapshot_error", symbols=symbols, error=str(e))
        return {"symbols": symbols, "snapshot": {}, "error": str(e)}
