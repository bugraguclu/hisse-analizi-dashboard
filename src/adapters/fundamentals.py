"""Temel analiz adaptoru — sirket bilgileri, finansallar, temettular, ortaklik yapisi."""

import asyncio

import structlog

logger = structlog.get_logger(__name__)


def _df_to_records(df) -> list[dict]:
    """DataFrame'i JSON-serializable dict listesine cevir."""
    if df is None:
        return []
    if hasattr(df, "empty") and df.empty:
        return []
    try:
        result = df.reset_index()
        return result.to_dict(orient="records")
    except Exception:
        return []


def _safe_serialize(obj) -> dict:
    """Herhangi bir borsapy objesini dict'e cevir."""
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "to_dict"):
        return obj.to_dict()
    if hasattr(obj, "__dict__"):
        return {k: v for k, v in obj.__dict__.items() if not k.startswith("_")}
    return {"value": str(obj)}


async def get_company_info(ticker: str) -> dict:
    """Sirket detay bilgileri (sektor, piyasa degeri, vb.)."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        t = await loop.run_in_executor(None, lambda: bp.Ticker(ticker))
        info = await loop.run_in_executor(None, lambda: t.info)
        return {"ticker": ticker, "info": _safe_serialize(info)}
    except Exception as e:
        logger.error("fundamentals_info_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "info": {}, "error": str(e)}


async def get_fast_info(ticker: str) -> dict:
    """Hizli sirket bilgileri (fiyat, hacim, vb.)."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        t = await loop.run_in_executor(None, lambda: bp.Ticker(ticker))
        info = await loop.run_in_executor(None, lambda: t.fast_info)
        return {"ticker": ticker, "fast_info": _safe_serialize(info)}
    except Exception as e:
        logger.error("fundamentals_fast_info_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "fast_info": {}, "error": str(e)}


async def get_balance_sheet(ticker: str, quarterly: bool = False) -> dict:
    """Bilanco verileri."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        t = await loop.run_in_executor(None, lambda: bp.Ticker(ticker))
        if quarterly:
            df = await loop.run_in_executor(None, lambda: t.quarterly_balance_sheet)
        else:
            df = await loop.run_in_executor(None, lambda: t.balance_sheet)
        return {"ticker": ticker, "quarterly": quarterly, "data": _df_to_records(df)}
    except Exception as e:
        logger.error("fundamentals_balance_sheet_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "data": [], "error": str(e)}


async def get_income_statement(ticker: str, quarterly: bool = False) -> dict:
    """Gelir tablosu verileri."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        t = await loop.run_in_executor(None, lambda: bp.Ticker(ticker))
        if quarterly:
            df = await loop.run_in_executor(None, lambda: t.quarterly_income_stmt)
        else:
            df = await loop.run_in_executor(None, lambda: t.income_stmt)
        return {"ticker": ticker, "quarterly": quarterly, "data": _df_to_records(df)}
    except Exception as e:
        logger.error("fundamentals_income_stmt_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "data": [], "error": str(e)}


async def get_cashflow(ticker: str, quarterly: bool = False) -> dict:
    """Nakit akis tablosu verileri."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        t = await loop.run_in_executor(None, lambda: bp.Ticker(ticker))
        if quarterly:
            df = await loop.run_in_executor(None, lambda: t.quarterly_cashflow)
        else:
            df = await loop.run_in_executor(None, lambda: t.cashflow)
        return {"ticker": ticker, "quarterly": quarterly, "data": _df_to_records(df)}
    except Exception as e:
        logger.error("fundamentals_cashflow_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "data": [], "error": str(e)}


async def get_dividends(ticker: str) -> dict:
    """Temettu gecmisi."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        t = await loop.run_in_executor(None, lambda: bp.Ticker(ticker))
        result = await loop.run_in_executor(None, lambda: t.dividends)
        data = _df_to_records(result) if hasattr(result, "iterrows") else _safe_serialize(result)
        return {"ticker": ticker, "dividends": data}
    except Exception as e:
        logger.error("fundamentals_dividends_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "dividends": [], "error": str(e)}


async def get_major_holders(ticker: str) -> dict:
    """Buyuk ortaklar listesi."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        t = await loop.run_in_executor(None, lambda: bp.Ticker(ticker))
        result = await loop.run_in_executor(None, lambda: t.major_holders)
        data = _df_to_records(result) if hasattr(result, "iterrows") else _safe_serialize(result)
        return {"ticker": ticker, "holders": data}
    except Exception as e:
        logger.error("fundamentals_holders_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "holders": [], "error": str(e)}


async def get_recommendations(ticker: str) -> dict:
    """Analist tavsiyeleri."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        t = await loop.run_in_executor(None, lambda: bp.Ticker(ticker))
        result = await loop.run_in_executor(None, lambda: t.recommendations)
        data = _df_to_records(result) if hasattr(result, "iterrows") else _safe_serialize(result)
        return {"ticker": ticker, "recommendations": data}
    except Exception as e:
        logger.error("fundamentals_recommendations_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "recommendations": [], "error": str(e)}


async def get_analyst_price_targets(ticker: str) -> dict:
    """Analist hedef fiyatlari."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        t = await loop.run_in_executor(None, lambda: bp.Ticker(ticker))
        result = await loop.run_in_executor(None, lambda: t.analyst_price_targets)
        return {"ticker": ticker, "targets": _safe_serialize(result)}
    except Exception as e:
        logger.error("fundamentals_targets_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "targets": {}, "error": str(e)}


async def get_earnings_dates(ticker: str) -> dict:
    """Kazanc aciklama tarihleri."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        t = await loop.run_in_executor(None, lambda: bp.Ticker(ticker))
        result = await loop.run_in_executor(None, lambda: t.earnings_dates)
        data = _df_to_records(result) if hasattr(result, "iterrows") else _safe_serialize(result)
        return {"ticker": ticker, "earnings_dates": data}
    except Exception as e:
        logger.error("fundamentals_earnings_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "earnings_dates": [], "error": str(e)}
