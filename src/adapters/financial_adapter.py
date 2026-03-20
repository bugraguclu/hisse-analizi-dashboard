import asyncio
import hashlib
import structlog
from datetime import datetime
from typing import Any

from src.adapters.base import BaseAdapter, RawEventData
from src.db.models import PollingState

logger = structlog.get_logger(__name__)


class FinancialAdapter(BaseAdapter):
    """Finansal tablolari (Bilanco, Gelir Tablosu, Nakit Akis) borsapy uzerinden ceker."""

    def get_source_code(self) -> str:
        return "financials"

    async def fetch(self, ticker: str, polling_state: PollingState | None = None) -> list[RawEventData]:
        """
        Finansal tablolari ceker ve RawEventData formatinda doner.
        borsapy sync kutuphane oldugu icin run_in_executor kullanilir.
        """
        try:
            import borsapy as bp
            loop = asyncio.get_event_loop()

            bp_ticker = await loop.run_in_executor(None, lambda: bp.Ticker(ticker))

            results = []

            # 1. Bilanco (Balance Sheet)
            try:
                bs_df = await loop.run_in_executor(None, lambda: bp_ticker.balance_sheet)
                if bs_df is not None and not bs_df.empty:
                    results.append(self._create_raw_data(ticker, "balance_sheet", bs_df))
            except Exception as e:
                logger.error("financial_adapter_bs_error", ticker=ticker, error=str(e))

            # 2. Gelir Tablosu (Income Statement)
            try:
                is_df = await loop.run_in_executor(None, lambda: bp_ticker.income_stmt)
                if is_df is not None and not is_df.empty:
                    results.append(self._create_raw_data(ticker, "income_stmt", is_df))
            except Exception as e:
                logger.error("financial_adapter_is_error", ticker=ticker, error=str(e))

            # 3. Nakit Akis (Cash Flow)
            try:
                cf_df = await loop.run_in_executor(None, lambda: bp_ticker.cashflow)
                if cf_df is not None and not cf_df.empty:
                    results.append(self._create_raw_data(ticker, "cash_flow", cf_df))
            except Exception as e:
                logger.error("financial_adapter_cf_error", ticker=ticker, error=str(e))

            logger.info("financial_adapter_fetched", ticker=ticker, count=len(results))
            return results

        except Exception as e:
            logger.error("financial_adapter_error", ticker=ticker, error=str(e))
            return []

    def _create_raw_data(self, ticker: str, statement_type: str, df: Any) -> RawEventData:
        """DataFrame'i RawEventData formatina donustur."""
        data_dict = {}
        for col in df.columns:
            col_key = str(col)
            col_data = {}
            for idx, val in df[col].items():
                clean_val = val
                if isinstance(val, float) and (val != val or val == float("inf") or val == float("-inf")):
                    clean_val = None
                col_data[str(idx)] = clean_val
            data_dict[col_key] = col_data

        # content_hash for deduplication
        date_str = datetime.now().strftime("%Y%m%d")
        content = f"{ticker}_{statement_type}_{date_str}"
        content_hash = hashlib.sha256(content.encode()).hexdigest()

        return RawEventData(
            external_id=f"{ticker}_{statement_type}_{date_str}",
            source_event_type=f"FINANCIAL_{statement_type.upper()}",
            title=f"{ticker} {statement_type} updated",
            published_at=datetime.now(),
            content_hash=content_hash,
            raw_payload_json={
                "ticker": ticker,
                "statement_type": statement_type,
                "data": data_dict,
            },
        )
