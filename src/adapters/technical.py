"""Teknik analiz adapter'ı: RSI, MACD, Bollinger, SMA, EMA."""
import asyncio
from datetime import datetime

import structlog

logger = structlog.get_logger(__name__)


class TechnicalAdapter:
    """technical.py → RSI, MACD, Bollinger Bands, SMA, EMA göstergeleri."""

    def __init__(self, ticker: str):
        self.ticker = ticker

    async def fetch_rsi(self, period: int = 14) -> list[dict]:
        return await self._fetch_indicator("rsi", period=period)

    async def fetch_macd(self) -> list[dict]:
        return await self._fetch_indicator("macd")

    async def fetch_bollinger(self, period: int = 20) -> list[dict]:
        return await self._fetch_indicator("bbands", period=period)

    async def fetch_sma(self, period: int = 50) -> list[dict]:
        return await self._fetch_indicator("sma", period=period)

    async def fetch_ema(self, period: int = 20) -> list[dict]:
        return await self._fetch_indicator("ema", period=period)

    async def fetch_all_indicators(self) -> dict[str, list[dict]]:
        """Tüm temel göstergeleri tek seferde çek."""
        results = {}
        indicators = [
            ("RSI_14", "rsi", {"period": 14}),
            ("MACD", "macd", {}),
            ("BBANDS_20", "bbands", {"period": 20}),
            ("SMA_50", "sma", {"period": 50}),
            ("SMA_200", "sma", {"period": 200}),
            ("EMA_20", "ema", {"period": 20}),
        ]
        for name, indicator, kwargs in indicators:
            data = await self._fetch_indicator(indicator, **kwargs)
            results[name] = data
        return results

    async def _fetch_indicator(self, indicator: str, **kwargs) -> list[dict]:
        try:
            import borsapy as bp
            loop = asyncio.get_event_loop()
            t = await loop.run_in_executor(None, lambda: bp.Ticker(self.ticker))
            tech = await loop.run_in_executor(None, lambda: t.technical)

            if tech is None:
                logger.info("technical_not_available", ticker=self.ticker)
                return []

            # Her gösterge için ilgili metodu çağır
            df = None
            if indicator == "rsi":
                df = await loop.run_in_executor(None, lambda: tech.rsi(**kwargs))
            elif indicator == "macd":
                df = await loop.run_in_executor(None, lambda: tech.macd())
            elif indicator == "bbands":
                df = await loop.run_in_executor(None, lambda: tech.bbands(**kwargs))
            elif indicator == "sma":
                period = kwargs.get("period", 50)
                df = await loop.run_in_executor(None, lambda: tech.sma(period=period))
            elif indicator == "ema":
                period = kwargs.get("period", 20)
                df = await loop.run_in_executor(None, lambda: tech.ema(period=period))

            if df is None or (hasattr(df, 'empty') and df.empty):
                return []

            records = []
            if hasattr(df, 'iterrows'):
                for date_idx, row in df.iterrows():
                    record = {
                        "ticker": self.ticker,
                        "indicator_name": indicator.upper(),
                        "trading_date": date_idx.date() if hasattr(date_idx, "date") else date_idx,
                        "value": float(row.iloc[0]) if len(row) > 0 else None,
                    }
                    # MACD → signal + histogram
                    if indicator == "macd" and len(row) >= 3:
                        record["signal"] = float(row.iloc[1])
                        record["histogram"] = float(row.iloc[2])
                    # Bollinger → upper + lower
                    if indicator == "bbands" and len(row) >= 3:
                        record["upper_band"] = float(row.iloc[1])
                        record["lower_band"] = float(row.iloc[2])
                    records.append(record)
            elif hasattr(df, 'items'):
                # Series
                for date_idx, val in df.items():
                    records.append({
                        "ticker": self.ticker,
                        "indicator_name": indicator.upper(),
                        "trading_date": date_idx.date() if hasattr(date_idx, "date") else date_idx,
                        "value": float(val) if val is not None else None,
                    })

            logger.info("technical_fetched", ticker=self.ticker, indicator=indicator, count=len(records))
            return records

        except Exception as e:
            logger.error("technical_error", ticker=self.ticker, indicator=indicator, error=str(e))
            return []


class ScreenerAdapter:
    """screener.py → hisse tarama."""

    async def screen(self, filters: dict | None = None) -> list[dict]:
        try:
            import borsapy as bp
            loop = asyncio.get_event_loop()
            screener = await loop.run_in_executor(None, lambda: bp.Screener())

            if filters:
                for key, value in filters.items():
                    if hasattr(screener, key):
                        screener = await loop.run_in_executor(None, lambda: getattr(screener, key)(value))

            results = await loop.run_in_executor(None, lambda: screener.scan())
            if results is None or (hasattr(results, 'empty') and results.empty):
                return []

            records = results.to_dict(orient="records") if hasattr(results, "to_dict") else []
            logger.info("screener_completed", count=len(records), filters=filters)
            return records

        except Exception as e:
            logger.error("screener_error", error=str(e), filters=filters)
            return []
