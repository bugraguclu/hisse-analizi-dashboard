"""Temel analiz adaptoru — sirket bilgileri, finansallar, temettular, ortaklik yapisi.

Uses shared TTL cache (300s) and asyncio.to_thread for sync borsapy calls.
"""

import math
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
        info_dict: dict = {}
        fast_dict: dict = {}

        # Try .info first
        try:
            info = await run_sync(lambda: t.info)
            raw = safe_serialize(info) if info else {}
            if isinstance(raw, dict):
                info_dict = raw
        except Exception as e:
            logger.warning("company_info_info_failed", ticker=ticker, error=str(e))

        # Always try fast_info as supplement/fallback
        try:
            fast = await run_sync(lambda: t.fast_info)
            raw = safe_serialize(fast) if fast else {}
            if isinstance(raw, dict):
                fast_dict = raw
        except Exception as e:
            logger.warning("company_info_fast_info_failed", ticker=ticker, error=str(e))

        # If both empty, try yfinance directly with .IS suffix
        if len(info_dict) < 3 and len(fast_dict) < 3:
            try:
                import yfinance as yf
                yf_ticker = yf.Ticker(f"{ticker}.IS")
                yf_info = await run_sync(lambda: yf_ticker.info)
                if isinstance(yf_info, dict) and len(yf_info) > 3:
                    info_dict = yf_info
            except Exception as e:
                logger.warning("company_info_yfinance_fallback_failed", ticker=ticker, error=str(e))

        # Merge: fast_info as base, info_dict takes precedence
        merged = {**fast_dict, **info_dict} if fast_dict or info_dict else {}

        return {"ticker": ticker, "info": merged}
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


def _safe_float(val) -> float | None:
    """Convert a value to float, returning None for NaN/Inf/None."""
    if val is None:
        return None
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return None
        return round(f, 4)
    except (TypeError, ValueError):
        return None


@cached(TTL_FUNDAMENTALS, "fund")
async def get_live_financial_ratios(ticker: str) -> dict:
    """Compute financial ratios live from borsapy/yfinance info dict."""
    try:
        t = await _get_ticker(ticker)
        info = await run_sync(lambda: t.info)
        info_dict = safe_serialize(info) if info else {}

        if not isinstance(info_dict, dict) or len(info_dict) < 3:
            try:
                fast = await run_sync(lambda: t.fast_info)
                fast_dict = safe_serialize(fast) if fast else {}
                if isinstance(fast_dict, dict) and fast_dict:
                    info_dict = {**fast_dict, **(info_dict if isinstance(info_dict, dict) else {})}
            except Exception:
                pass

        if not info_dict:
            return {"ticker": ticker, "ratios": None}

        ratios = {
            "gross_margin": _safe_float(info_dict.get("grossMargins") or info_dict.get("gross_margins")),
            "ebitda_margin": _safe_float(info_dict.get("ebitdaMargins") or info_dict.get("ebitda_margins")),
            "net_margin": _safe_float(info_dict.get("profitMargins") or info_dict.get("profit_margins")),
            "roe": _safe_float(info_dict.get("returnOnEquity") or info_dict.get("return_on_equity")),
            "roa": _safe_float(info_dict.get("returnOnAssets") or info_dict.get("return_on_assets")),
            "current_ratio": _safe_float(info_dict.get("currentRatio") or info_dict.get("current_ratio")),
            "net_debt_ebitda": None,
            "debt_to_equity": _safe_float(info_dict.get("debtToEquity") or info_dict.get("debt_to_equity")),
            "pe_ratio": _safe_float(info_dict.get("trailingPE") or info_dict.get("trailing_pe") or info_dict.get("forwardPE")),
        }

        # Convert margins from decimal (0.25) to percentage (25.0) if they look like decimals
        for key in ["gross_margin", "ebitda_margin", "net_margin", "roe", "roa"]:
            val = ratios.get(key)
            if val is not None and -1.0 < val < 1.0:
                ratios[key] = round(val * 100, 2)

        # debt_to_equity from yfinance is often already in percentage form (e.g., 150 for 150%)
        # Normalize to ratio (1.5x)
        dte = ratios.get("debt_to_equity")
        if dte is not None and abs(dte) > 10:
            ratios["debt_to_equity"] = round(dte / 100, 2)

        # Check if at least one ratio has data
        has_data = any(v is not None for v in ratios.values())
        if not has_data:
            return {"ticker": ticker, "ratios": None}

        return {"ticker": ticker, "ratios": ratios}
    except Exception as e:
        logger.error("live_ratios_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "ratios": None, "error": str(e)}


@cached(TTL_FUNDAMENTALS, "fund")
async def get_live_news(ticker: str, limit: int = 10) -> dict:
    """Fetch news/KAP disclosures for a ticker via borsapy."""
    try:
        t = await _get_ticker(ticker)
        news_df = await run_sync(lambda: t.news)
        records = df_to_records(news_df) if hasattr(news_df, "iterrows") else []
        return {"ticker": ticker, "news": records[:limit]}
    except Exception as e:
        logger.error("live_news_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "news": [], "error": str(e)}
