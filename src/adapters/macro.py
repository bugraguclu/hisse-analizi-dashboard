"""Makro ekonomik veri adaptoru — TCMB, enflasyon, doviz, ekonomik takvim.

Uses shared TTL cache (600s) and asyncio.to_thread for sync borsapy calls.
"""

import structlog

from src.adapters.utils import run_sync, cached, df_to_records, safe_serialize, TTL_MACRO

logger = structlog.get_logger(__name__)


@cached(TTL_MACRO, "macro")
async def get_tcmb_rates() -> dict:
    try:
        import borsapy as bp
        tcmb = await run_sync(bp.TCMB)
        rates = await run_sync(lambda: tcmb.interest_rates if hasattr(tcmb, "interest_rates") else None)
        if rates is None:
            return {"source": "TCMB", "data": {}}
        data = df_to_records(rates) if hasattr(rates, "iterrows") else safe_serialize(rates)
        return {"source": "TCMB", "data": data}
    except Exception as e:
        logger.error("macro_tcmb_error", error=str(e))
        return {"source": "TCMB", "data": {}, "error": str(e)}


@cached(TTL_MACRO, "macro")
async def get_policy_rate() -> dict:
    try:
        import borsapy as bp
        rate = await run_sync(bp.policy_rate)
        return {"source": "TCMB", "policy_rate": safe_serialize(rate)}
    except Exception as e:
        logger.error("macro_policy_rate_error", error=str(e))
        return {"source": "TCMB", "policy_rate": {}, "error": str(e)}


@cached(TTL_MACRO, "macro")
async def get_inflation() -> dict:
    try:
        import borsapy as bp
        inf = await run_sync(bp.Inflation)
        latest = await run_sync(inf.latest)
        tufe_df = await run_sync(inf.tufe)
        return {
            "source": "TCMB",
            "latest": latest if isinstance(latest, dict) else safe_serialize(latest),
            "tufe_history": df_to_records(tufe_df),
        }
    except Exception as e:
        logger.error("macro_inflation_error", error=str(e))
        return {"source": "TCMB", "latest": {}, "tufe_history": [], "error": str(e)}


@cached(TTL_MACRO, "macro")
async def get_fx_rates(currency: str = "USD") -> dict:
    try:
        import borsapy as bp
        fx = await run_sync(lambda: bp.FX(currency))
        info = await run_sync(lambda: fx.info if hasattr(fx, "info") else None)
        history = await run_sync(lambda: fx.history(period="1ay") if hasattr(fx, "history") else None)
        return {
            "currency": currency,
            "info": info if isinstance(info, dict) else safe_serialize(info) if info else {},
            "history": df_to_records(history) if history is not None else [],
        }
    except Exception as e:
        logger.error("macro_fx_error", currency=currency, error=str(e))
        return {"currency": currency, "info": {}, "history": [], "error": str(e)}


@cached(TTL_MACRO, "macro")
async def get_economic_calendar() -> dict:
    try:
        import borsapy as bp
        cal = await run_sync(bp.economic_calendar)
        data = df_to_records(cal) if hasattr(cal, "iterrows") else safe_serialize(cal)
        return {"calendar": data}
    except Exception as e:
        logger.error("macro_calendar_error", error=str(e))
        return {"calendar": [], "error": str(e)}
