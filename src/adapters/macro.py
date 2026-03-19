"""Makro ekonomik veri adaptoru — TCMB, enflasyon, doviz, ekonomik takvim."""

import asyncio

import structlog

logger = structlog.get_logger(__name__)


def _df_to_records(df) -> list[dict]:
    if df is None:
        return []
    if hasattr(df, "empty") and df.empty:
        return []
    try:
        result = df.reset_index()
        return result.to_dict(orient="records")
    except Exception:
        return []


def _safe_serialize(obj) -> dict | list:
    if obj is None:
        return {}
    if isinstance(obj, (dict, list)):
        return obj
    if hasattr(obj, "to_dict"):
        return obj.to_dict()
    return {"value": str(obj)}


async def get_tcmb_rates() -> dict:
    """TCMB faiz oranlari."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        tcmb = await loop.run_in_executor(None, lambda: bp.TCMB())
        rates = await loop.run_in_executor(None, lambda: tcmb.interest_rates if hasattr(tcmb, "interest_rates") else None)
        if rates is None:
            return {"source": "TCMB", "data": {}}
        data = _df_to_records(rates) if hasattr(rates, "iterrows") else _safe_serialize(rates)
        return {"source": "TCMB", "data": data}
    except Exception as e:
        logger.error("macro_tcmb_error", error=str(e))
        return {"source": "TCMB", "data": {}, "error": str(e)}


async def get_policy_rate() -> dict:
    """TCMB politika faiz orani."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        rate = await loop.run_in_executor(None, bp.policy_rate)
        return {"source": "TCMB", "policy_rate": _safe_serialize(rate)}
    except Exception as e:
        logger.error("macro_policy_rate_error", error=str(e))
        return {"source": "TCMB", "policy_rate": {}, "error": str(e)}


async def get_inflation() -> dict:
    """Enflasyon verileri."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        data = await loop.run_in_executor(None, bp.inflation)
        result = _df_to_records(data) if hasattr(data, "iterrows") else _safe_serialize(data)
        return {"source": "TCMB", "inflation": result}
    except Exception as e:
        logger.error("macro_inflation_error", error=str(e))
        return {"source": "TCMB", "inflation": [], "error": str(e)}


async def get_fx_rates(symbol: str = "USDTRY") -> dict:
    """Doviz kuru verileri."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        fx = await loop.run_in_executor(None, lambda: bp.FX(symbol))
        info = await loop.run_in_executor(None, lambda: fx.info if hasattr(fx, "info") else None)
        history = await loop.run_in_executor(None, lambda: fx.history(period="1ay") if hasattr(fx, "history") else None)
        return {
            "symbol": symbol,
            "info": _safe_serialize(info) if info else {},
            "history": _df_to_records(history) if history is not None else [],
        }
    except Exception as e:
        logger.error("macro_fx_error", symbol=symbol, error=str(e))
        return {"symbol": symbol, "info": {}, "history": [], "error": str(e)}


async def get_economic_calendar() -> dict:
    """Ekonomik takvim etkinlikleri."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        cal = await loop.run_in_executor(None, bp.economic_calendar)
        data = _df_to_records(cal) if hasattr(cal, "iterrows") else _safe_serialize(cal)
        return {"calendar": data}
    except Exception as e:
        logger.error("macro_calendar_error", error=str(e))
        return {"calendar": [], "error": str(e)}
