"""Canli veri akisi adaptoru — TradingView WebSocket stream."""

import asyncio

import structlog

logger = structlog.get_logger(__name__)


class LivePriceStream:
    """Canli fiyat stream yoneticisi.

    Kullanim:
        stream = LivePriceStream(["AEFES", "THYAO", "GARAN"])
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


async def get_snapshot(symbols: list[str]) -> dict:
    """Birden fazla sembol icin anlik fiyat snapshot'i (stream kullanmadan)."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        results = {}
        for symbol in symbols:
            try:
                t = await loop.run_in_executor(None, lambda s=symbol: bp.Ticker(s))
                fi = await loop.run_in_executor(None, lambda: t.fast_info)
                if fi and hasattr(fi, "to_dict"):
                    results[symbol] = fi.to_dict()
                elif isinstance(fi, dict):
                    results[symbol] = fi
                else:
                    results[symbol] = {"value": str(fi)} if fi else {}
            except Exception as e:
                results[symbol] = {"error": str(e)}
        return {"symbols": symbols, "snapshot": results}
    except Exception as e:
        logger.error("snapshot_error", symbols=symbols, error=str(e))
        return {"symbols": symbols, "snapshot": {}, "error": str(e)}
