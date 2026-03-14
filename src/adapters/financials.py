"""Şirket detay bilgileri, finansal tablolar, temettü, ortaklık yapısı adapter'ı."""
import asyncio
from datetime import datetime

import structlog

from src.adapters.base import BasePriceAdapter
from src.db.models import PollingState

logger = structlog.get_logger(__name__)


class CompanyInfoAdapter:
    """Ticker.info, Ticker.major_holders → şirket detay bilgileri."""

    def __init__(self, ticker: str):
        self.ticker = ticker

    async def fetch_info(self) -> dict | None:
        try:
            import borsapy as bp
            loop = asyncio.get_event_loop()
            t = await loop.run_in_executor(None, lambda: bp.Ticker(self.ticker))
            info = await loop.run_in_executor(None, lambda: t.info)
            if info:
                logger.info("company_info_fetched", ticker=self.ticker)
            return info or {}
        except Exception as e:
            logger.error("company_info_error", ticker=self.ticker, error=str(e))
            return None

    async def fetch_major_holders(self) -> list[dict]:
        try:
            import borsapy as bp
            loop = asyncio.get_event_loop()
            t = await loop.run_in_executor(None, lambda: bp.Ticker(self.ticker))
            holders = await loop.run_in_executor(None, lambda: t.major_holders)
            if holders is None or (hasattr(holders, 'empty') and holders.empty):
                return []
            # DataFrame → list[dict]
            result = holders.to_dict(orient="records") if hasattr(holders, "to_dict") else []
            logger.info("major_holders_fetched", ticker=self.ticker, count=len(result))
            return result
        except Exception as e:
            logger.error("major_holders_error", ticker=self.ticker, error=str(e))
            return []


class FinancialAdapter:
    """Ticker.balance_sheet, income_stmt, cashflow → finansal tablolar."""

    def __init__(self, ticker: str):
        self.ticker = ticker

    async def fetch_balance_sheet(self, quarterly: bool = True) -> dict | None:
        return await self._fetch_statement("balance_sheet", quarterly)

    async def fetch_income_statement(self, quarterly: bool = True) -> dict | None:
        return await self._fetch_statement("income_stmt", quarterly)

    async def fetch_cashflow(self, quarterly: bool = True) -> dict | None:
        return await self._fetch_statement("cashflow", quarterly)

    async def fetch_all(self, quarterly: bool = True) -> dict:
        """Tüm finansal tabloları tek seferde çek."""
        results = {}
        for stmt_type in ["balance_sheet", "income_stmt", "cashflow"]:
            data = await self._fetch_statement(stmt_type, quarterly)
            results[stmt_type] = data
        return results

    async def _fetch_statement(self, statement_type: str, quarterly: bool) -> dict | None:
        try:
            import borsapy as bp
            loop = asyncio.get_event_loop()
            t = await loop.run_in_executor(None, lambda: bp.Ticker(self.ticker))

            attr_map = {
                "balance_sheet": "quarterly_balance_sheet" if quarterly else "balance_sheet",
                "income_stmt": "quarterly_income_stmt" if quarterly else "income_stmt",
                "cashflow": "quarterly_cashflow" if quarterly else "cashflow",
            }
            attr_name = attr_map.get(statement_type, statement_type)
            df = await loop.run_in_executor(None, lambda: getattr(t, attr_name, None))

            if df is None or (hasattr(df, 'empty') and df.empty):
                logger.info("financial_no_data", ticker=self.ticker, type=statement_type)
                return None

            # DataFrame → dict (sütun = tarih, satır = kalem)
            data = {}
            if hasattr(df, 'to_dict'):
                data = df.to_dict()
            logger.info("financial_fetched", ticker=self.ticker, type=statement_type)
            return data
        except Exception as e:
            logger.error("financial_error", ticker=self.ticker, type=statement_type, error=str(e))
            return None


class DividendAdapter:
    """Ticker.dividends → temettü ödeme geçmişi."""

    def __init__(self, ticker: str):
        self.ticker = ticker

    async def fetch_dividends(self) -> list[dict]:
        try:
            import borsapy as bp
            loop = asyncio.get_event_loop()
            t = await loop.run_in_executor(None, lambda: bp.Ticker(self.ticker))
            dividends = await loop.run_in_executor(None, lambda: t.dividends)

            if dividends is None or (hasattr(dividends, 'empty') and dividends.empty):
                return []

            records = []
            if hasattr(dividends, 'iterrows'):
                for idx, row in dividends.iterrows():
                    records.append({
                        "ex_date": idx.date() if hasattr(idx, "date") else idx,
                        "amount": float(row) if not hasattr(row, 'get') else float(row.get("Dividends", 0)),
                    })
            logger.info("dividends_fetched", ticker=self.ticker, count=len(records))
            return records
        except Exception as e:
            logger.error("dividends_error", ticker=self.ticker, error=str(e))
            return []
