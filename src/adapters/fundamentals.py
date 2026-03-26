"""Temel analiz adaptoru — sirket bilgileri, finansallar, temettular, ortaklik yapisi.

Uses shared TTL cache (300s) and asyncio.to_thread for sync borsapy calls.
"""

import structlog

from src.adapters.utils import run_sync, cached, df_to_records, safe_serialize, TTL_FUNDAMENTALS

logger = structlog.get_logger(__name__)


async def _get_ticker(ticker: str):
    import borsapy as bp
    return await run_sync(bp.Ticker, ticker)


@cached(TTL_FUNDAMENTALS, "fund")
async def get_company_info(ticker: str) -> dict:
    try:
        t = await _get_ticker(ticker)
        info = await run_sync(lambda: t.info)
        info_dict = safe_serialize(info) if info else {}

        # If info is empty or missing key fields, try fast_info as fallback
        if not info_dict or not isinstance(info_dict, dict) or len(info_dict) < 3:
            try:
                fast = await run_sync(lambda: t.fast_info)
                fast_dict = safe_serialize(fast) if fast else {}
                if isinstance(fast_dict, dict) and fast_dict:
                    merged = {**fast_dict, **info_dict} if isinstance(info_dict, dict) else fast_dict
                    return {"ticker": ticker, "info": merged}
            except Exception:
                pass

        return {"ticker": ticker, "info": info_dict if isinstance(info_dict, dict) else {}}
    except Exception as e:
        logger.error("fundamentals_info_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "info": {}, "error": str(e)}


@cached(TTL_FUNDAMENTALS, "fund")
async def get_fast_info(ticker: str) -> dict:
    try:
        t = await _get_ticker(ticker)
        info = await run_sync(lambda: t.fast_info)
        return {"ticker": ticker, "fast_info": safe_serialize(info)}
    except Exception as e:
        logger.error("fundamentals_fast_info_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "fast_info": {}, "error": str(e)}


@cached(TTL_FUNDAMENTALS, "fund")
async def get_balance_sheet(ticker: str, quarterly: bool = False) -> dict:
    try:
        t = await _get_ticker(ticker)
        if quarterly:
            df = await run_sync(lambda: t.quarterly_balance_sheet)
        else:
            df = await run_sync(lambda: t.balance_sheet)
        return {"ticker": ticker, "quarterly": quarterly, "data": df_to_records(df)}
    except Exception as e:
        logger.error("fundamentals_balance_sheet_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "data": [], "error": str(e)}


@cached(TTL_FUNDAMENTALS, "fund")
async def get_income_statement(ticker: str, quarterly: bool = False) -> dict:
    try:
        t = await _get_ticker(ticker)
        if quarterly:
            df = await run_sync(lambda: t.quarterly_income_stmt)
        else:
            df = await run_sync(lambda: t.income_stmt)
        return {"ticker": ticker, "quarterly": quarterly, "data": df_to_records(df)}
    except Exception as e:
        logger.error("fundamentals_income_stmt_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "data": [], "error": str(e)}


@cached(TTL_FUNDAMENTALS, "fund")
async def get_cashflow(ticker: str, quarterly: bool = False) -> dict:
    try:
        t = await _get_ticker(ticker)
        if quarterly:
            df = await run_sync(lambda: t.quarterly_cashflow)
        else:
            df = await run_sync(lambda: t.cashflow)
        return {"ticker": ticker, "quarterly": quarterly, "data": df_to_records(df)}
    except Exception as e:
        logger.error("fundamentals_cashflow_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "data": [], "error": str(e)}


@cached(TTL_FUNDAMENTALS, "fund")
async def get_dividends(ticker: str) -> dict:
    try:
        t = await _get_ticker(ticker)
        result = await run_sync(lambda: t.dividends)
        data = df_to_records(result) if hasattr(result, "iterrows") else safe_serialize(result)
        return {"ticker": ticker, "dividends": data}
    except Exception as e:
        logger.error("fundamentals_dividends_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "dividends": [], "error": str(e)}


@cached(TTL_FUNDAMENTALS, "fund")
async def get_major_holders(ticker: str) -> dict:
    try:
        t = await _get_ticker(ticker)
        result = await run_sync(lambda: t.major_holders)
        data = df_to_records(result) if hasattr(result, "iterrows") else safe_serialize(result)
        return {"ticker": ticker, "holders": data}
    except Exception as e:
        logger.error("fundamentals_holders_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "holders": [], "error": str(e)}


@cached(TTL_FUNDAMENTALS, "fund")
async def get_recommendations(ticker: str) -> dict:
    try:
        t = await _get_ticker(ticker)
        result = await run_sync(lambda: t.recommendations)
        data = df_to_records(result) if hasattr(result, "iterrows") else safe_serialize(result)
        return {"ticker": ticker, "recommendations": data}
    except Exception as e:
        logger.error("fundamentals_recommendations_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "recommendations": [], "error": str(e)}


@cached(TTL_FUNDAMENTALS, "fund")
async def get_analyst_price_targets(ticker: str) -> dict:
    try:
        t = await _get_ticker(ticker)
        result = await run_sync(lambda: t.analyst_price_targets)
        return {"ticker": ticker, "targets": safe_serialize(result)}
    except Exception as e:
        logger.error("fundamentals_targets_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "targets": {}, "error": str(e)}


@cached(TTL_FUNDAMENTALS, "fund")
async def get_earnings_dates(ticker: str) -> dict:
    try:
        t = await _get_ticker(ticker)
        result = await run_sync(lambda: t.earnings_dates)
        data = df_to_records(result) if hasattr(result, "iterrows") else safe_serialize(result)
        return {"ticker": ticker, "earnings_dates": data}
    except Exception as e:
        logger.error("fundamentals_earnings_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "earnings_dates": [], "error": str(e)}
