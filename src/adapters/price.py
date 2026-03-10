import asyncio
from datetime import datetime

import structlog

from src.adapters.base import BasePriceAdapter, PriceRecord
from src.core.config import settings
from src.db.models import PollingState
from src.parsers.helpers import make_aware

logger = structlog.get_logger(__name__)


class PriceAdapter(BasePriceAdapter):
    """Fiyat verisi: borsapy birincil, yfinance yedek."""

    def get_source_code(self) -> str:
        return "price"

    async def fetch_prices(self, polling_state: PollingState | None = None) -> list[PriceRecord]:
        records = await self._fetch_via_borsapy()
        if not records:
            logger.warning("borsapy_price_empty_fallback_to_yfinance")
            records = await self._fetch_via_yfinance()
        return records

    async def _fetch_via_borsapy(self) -> list[PriceRecord]:
        try:
            import borsapy as bp

            loop = asyncio.get_event_loop()
            ticker = await loop.run_in_executor(None, lambda: bp.Ticker("AEFES"))
            df = await loop.run_in_executor(None, lambda: ticker.history(period="1ay"))

            if df is None or df.empty:
                logger.info("borsapy_price_no_data")
                return []

            records: list[PriceRecord] = []
            for idx, row in df.iterrows():
                trading_date = idx
                if hasattr(trading_date, "date"):
                    trading_date = trading_date

                records.append(
                    PriceRecord(
                        ticker="AEFES",
                        source="borsapy",
                        open=float(row.get("Open", 0)) if row.get("Open") is not None else None,
                        high=float(row.get("High", 0)) if row.get("High") is not None else None,
                        low=float(row.get("Low", 0)) if row.get("Low") is not None else None,
                        close=float(row.get("Close", 0)) if row.get("Close") is not None else None,
                        volume=float(row.get("Volume", 0)) if row.get("Volume") is not None else None,
                        trading_date=idx.date() if hasattr(idx, "date") else idx,
                        interval="1d",
                    )
                )

            logger.info("borsapy_price_fetched", count=len(records))
            return records

        except Exception as e:
            logger.error("borsapy_price_error", error=str(e))
            return []

    async def _fetch_via_yfinance(self) -> list[PriceRecord]:
        try:
            import yfinance as yf

            loop = asyncio.get_event_loop()
            ticker = await loop.run_in_executor(None, lambda: yf.Ticker("AEFES.IS"))
            df = await loop.run_in_executor(None, lambda: ticker.history(period="1mo"))

            if df is None or df.empty:
                logger.info("yfinance_price_no_data")
                return []

            records: list[PriceRecord] = []
            for idx, row in df.iterrows():
                records.append(
                    PriceRecord(
                        ticker="AEFES",
                        source="yfinance",
                        open=float(row.get("Open", 0)) if row.get("Open") is not None else None,
                        high=float(row.get("High", 0)) if row.get("High") is not None else None,
                        low=float(row.get("Low", 0)) if row.get("Low") is not None else None,
                        close=float(row.get("Close", 0)) if row.get("Close") is not None else None,
                        volume=float(row.get("Volume", 0)) if row.get("Volume") is not None else None,
                        trading_date=idx.date() if hasattr(idx, "date") else idx,
                        interval="1d",
                    )
                )

            logger.info("yfinance_price_fetched", count=len(records))
            return records

        except Exception as e:
            logger.error("yfinance_price_error", error=str(e))
            return []
