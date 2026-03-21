import hashlib
import json
from typing import Any

import structlog

from src.adapters.base import BaseAdapter, RawEventData
from src.adapters.utils import run_sync
from src.core.time import utcnow
from src.db.models import PollingState

logger = structlog.get_logger(__name__)


class FinancialAdapter(BaseAdapter):
    """Finansal tablolari (Bilanco, Gelir Tablosu, Nakit Akis) borsapy uzerinden ceker."""

    def get_source_code(self) -> str:
        return "financials"

    async def fetch(self, ticker: str, polling_state: PollingState | None = None) -> list[RawEventData]:
        try:
            import borsapy as bp

            bp_ticker = await run_sync(bp.Ticker, ticker)

            results = []

            for attr_name, statement_type in [
                ("balance_sheet", "balance_sheet"),
                ("income_stmt", "income_stmt"),
                ("cashflow", "cash_flow"),
            ]:
                try:
                    df = await run_sync(lambda a=attr_name: getattr(bp_ticker, a))
                    if df is not None and not df.empty:
                        results.append(self._create_raw_data(ticker, statement_type, df))
                except Exception as e:
                    logger.error(f"financial_adapter_{statement_type}_error", ticker=ticker, error=str(e))

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

        # Content-based hash: hash the actual data, not the date
        # This ensures same content produces same hash, and changed content produces different hash
        content_for_hash = json.dumps(data_dict, sort_keys=True, default=str)
        content_hash = hashlib.sha256(f"{ticker}_{statement_type}_{content_for_hash}".encode()).hexdigest()

        now = utcnow()
        return RawEventData(
            external_id=f"{ticker}_{statement_type}_{content_hash[:12]}",
            source_event_type=f"FINANCIAL_{statement_type.upper()}",
            title=f"{ticker} {statement_type} updated",
            published_at=now,
            content_hash=content_hash,
            raw_payload_json={
                "ticker": ticker,
                "statement_type": statement_type,
                "data": data_dict,
            },
        )
