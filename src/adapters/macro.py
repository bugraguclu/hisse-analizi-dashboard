"""Makro veri adapter'ı: TCMB, enflasyon, politika faizi, döviz, endeks, takvim."""
import asyncio
from datetime import datetime

import structlog

logger = structlog.get_logger(__name__)


class MacroAdapter:
    """bp.tcmb, bp.inflation, bp.policy_rate → makroekonomik veriler."""

    async def fetch_tcmb_rates(self) -> dict | None:
        try:
            import borsapy as bp
            loop = asyncio.get_event_loop()
            data = await loop.run_in_executor(None, lambda: bp.tcmb())
            if data is None:
                return None
            result = data.to_dict() if hasattr(data, "to_dict") else data
            logger.info("tcmb_rates_fetched")
            return result
        except Exception as e:
            logger.error("tcmb_rates_error", error=str(e))
            return None

    async def fetch_inflation(self) -> dict | None:
        try:
            import borsapy as bp
            loop = asyncio.get_event_loop()
            data = await loop.run_in_executor(None, lambda: bp.inflation())
            if data is None:
                return None
            result = data.to_dict() if hasattr(data, "to_dict") else data
            logger.info("inflation_fetched")
            return result
        except Exception as e:
            logger.error("inflation_error", error=str(e))
            return None

    async def fetch_policy_rate(self) -> dict | None:
        try:
            import borsapy as bp
            loop = asyncio.get_event_loop()
            data = await loop.run_in_executor(None, lambda: bp.policy_rate())
            if data is None:
                return None
            result = data.to_dict() if hasattr(data, "to_dict") else data
            logger.info("policy_rate_fetched")
            return result
        except Exception as e:
            logger.error("policy_rate_error", error=str(e))
            return None


class ForexAdapter:
    """bp.fx → USD/TRY, EUR/TRY vb. döviz kurları."""

    async def fetch_rates(self) -> list[dict]:
        try:
            import borsapy as bp
            loop = asyncio.get_event_loop()
            data = await loop.run_in_executor(None, lambda: bp.fx())
            if data is None or (hasattr(data, 'empty') and data.empty):
                return []
            records = data.to_dict(orient="records") if hasattr(data, "to_dict") else []
            logger.info("forex_rates_fetched", count=len(records))
            return records
        except Exception as e:
            logger.error("forex_rates_error", error=str(e))
            return []


class IndexAdapter:
    """bp.Index → BIST endeksleri (XU100, XU030, XBANK vb.)."""

    async def fetch_index(self, index_code: str = "XU100", period: str = "1ay") -> list[dict]:
        try:
            import borsapy as bp
            loop = asyncio.get_event_loop()
            idx = await loop.run_in_executor(None, lambda: bp.Index(index_code))
            df = await loop.run_in_executor(None, lambda: idx.history(period=period))
            if df is None or df.empty:
                return []
            records = []
            for date_idx, row in df.iterrows():
                records.append({
                    "index_code": index_code,
                    "trading_date": date_idx.date() if hasattr(date_idx, "date") else date_idx,
                    "open": float(row.get("Open", 0)) if row.get("Open") is not None else None,
                    "high": float(row.get("High", 0)) if row.get("High") is not None else None,
                    "low": float(row.get("Low", 0)) if row.get("Low") is not None else None,
                    "close": float(row.get("Close", 0)) if row.get("Close") is not None else None,
                    "volume": float(row.get("Volume", 0)) if row.get("Volume") is not None else None,
                })
            logger.info("index_fetched", index=index_code, count=len(records))
            return records
        except Exception as e:
            logger.error("index_error", index=index_code, error=str(e))
            return []

    async def fetch_all_indices(self) -> dict[str, list[dict]]:
        """Ana endeksleri tek seferde çek."""
        results = {}
        for code in ["XU100", "XU030", "XBANK", "XUSIN", "XHOLD"]:
            data = await self.fetch_index(code)
            results[code] = data
            await asyncio.sleep(0.5)  # Rate limiting
        return results


class CalendarAdapter:
    """bp.economic_calendar → ekonomik takvim."""

    async def fetch_calendar(self) -> list[dict]:
        try:
            import borsapy as bp
            loop = asyncio.get_event_loop()
            data = await loop.run_in_executor(None, lambda: bp.economic_calendar())
            if data is None or (hasattr(data, 'empty') and data.empty):
                return []
            records = data.to_dict(orient="records") if hasattr(data, "to_dict") else []
            logger.info("calendar_fetched", count=len(records))
            return records
        except Exception as e:
            logger.error("calendar_error", error=str(e))
            return []
