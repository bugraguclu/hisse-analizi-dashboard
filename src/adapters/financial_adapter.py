import asyncio
import structlog
from datetime import datetime
from typing import Any

from src.adapters.base import BaseAdapter, RawEventData
from src.db.models import PollingState

logger = structlog.get_logger(__name__)

class FinancialAdapter(BaseAdapter):
    """Finansal tabloları (Bilanço, Gelir Tablosu, Nakit Akış) borsapy üzerinden çeker."""

    def get_source_code(self) -> str:
        return "financials"

    async def fetch(self, ticker: str, polling_state: PollingState | None = None) -> list[RawEventData]:
        """
        Finansal tabloları çeker ve RawEventData formatında (data_json içinde) döner.
        Not: Bu adapter 'event' bazlı değil, 'state' bazlı veri çeker.
        """
        try:
            import borsapy as bp
            loop = asyncio.get_event_loop()
            
            bp_ticker = await loop.run_in_executor(None, lambda: bp.Ticker(ticker))
            
            # Bilanço, Gelir Tablosu ve Nakit Akışı çek
            # Not: borsapy bu verileri pandas DataFrame olarak döner.
            # to_dict() ile JSON uyumlu hale getiriyoruz.
            
            results = []
            
            # 1. Bilanço (Balance Sheet)
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

            # 3. Nakit Akış (Cash Flow)
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
        # DataFrame'i JSON formatına dönüştür
        # Sütunlar genellikle dönemlerdir (2023/12 vb.)
        data_dict = df.to_dict()
        
        # En güncel dönemi bulmaya çalışalım (genellikle son sütun)
        # Şimdilik tüm veriyi ham olarak tutuyoruz.
        
        return RawEventData(
            external_id=f"{ticker}_{statement_type}_{datetime.now().strftime('%Y%m%d')}",
            source_event_type=f"FINANCIAL_{statement_type.upper()}",
            title=f"{ticker} {statement_type} updated",
            published_at=datetime.now(),
            raw_payload_json={
                "ticker": ticker,
                "statement_type": statement_type,
                "data": data_dict
            }
        )
