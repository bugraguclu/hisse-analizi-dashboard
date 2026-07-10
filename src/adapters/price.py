import structlog

from src.adapters.base import BasePriceAdapter, PriceRecord
from src.adapters.utils import run_sync
from src.db.models import PollingState

logger = structlog.get_logger(__name__)


class PriceAdapter(BasePriceAdapter):
    """Fiyat verisi: borsapy birincil, yfinance yedek."""

    def __init__(self, ticker: str = "THYAO"):
        self.ticker = ticker

    def get_source_code(self) -> str:
        return "price"

    async def fetch_prices(
        self, polling_state: PollingState | None = None, days: int | None = None
    ) -> list[PriceRecord]:
        records = await self._fetch_via_borsapy(days=days)
        if not records:
            logger.warning("borsapy_price_empty_fallback_to_yfinance", ticker=self.ticker)
            records = await self._fetch_via_yfinance(days=days)
        return records

    @staticmethod
    def _period_for_days(days: int | None) -> str:
        """Map a backfill day count to the smallest covering borsapy period."""
        if days is None:
            return "1mo"
        for limit, period in [(5, "5d"), (30, "1mo"), (90, "3mo"), (180, "6mo"), (365, "1y"), (730, "2y"), (1825, "5y")]:
            if days <= limit:
                return period
        return "max"

    async def _fetch_via_borsapy(self, days: int | None = None) -> list[PriceRecord]:
        period = self._period_for_days(days)
        try:
            import borsapy as bp

            ticker = await run_sync(bp.Ticker, self.ticker)
            df = await run_sync(lambda: ticker.history(period=period))

            if df is None or df.empty:
                logger.info("borsapy_price_no_data", ticker=self.ticker)
                return []

            records: list[PriceRecord] = []
            for idx, row in df.iterrows():
                records.append(
                    PriceRecord(
                        ticker=self.ticker,
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

            logger.info("borsapy_price_fetched", ticker=self.ticker, count=len(records))
            return records

        except Exception as e:
            logger.error("borsapy_price_error", ticker=self.ticker, error=str(e))
            return []

    async def _fetch_via_yfinance(self, days: int | None = None) -> list[PriceRecord]:
        period = self._period_for_days(days)
        try:
            import yfinance as yf

            yf_ticker = f"{self.ticker}.IS"
            ticker = await run_sync(yf.Ticker, yf_ticker)
            df = await run_sync(lambda: ticker.history(period=period))

            if df is None or df.empty:
                logger.info("yfinance_price_no_data", ticker=self.ticker)
                return []

            records: list[PriceRecord] = []
            for idx, row in df.iterrows():
                records.append(
                    PriceRecord(
                        ticker=self.ticker,
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

            logger.info("yfinance_price_fetched", ticker=self.ticker, count=len(records))
            return records

        except Exception as e:
            logger.error("yfinance_price_error", ticker=self.ticker, error=str(e))
            return []
