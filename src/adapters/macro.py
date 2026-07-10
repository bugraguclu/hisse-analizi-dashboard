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
        # borsapy TCMB exposes `.rates` (DataFrame: policy/overnight/late_liquidity),
        # not `.interest_rates`.
        rates = await run_sync(lambda: tcmb.rates)
        if rates is None:
            return {"source": "TCMB", "data": {}}
        data = df_to_records(rates) if hasattr(rates, "iterrows") else safe_serialize(rates)

        # borsapy's policy row carries the oldest (2010) rate due to a table
        # ordering bug — overwrite it with the latest value from history.
        try:
            history = await run_sync(tcmb.history)
            if history is not None and len(history) > 0:
                current = float(history.iloc[-1]["lending"])
                for row in data if isinstance(data, list) else []:
                    if row.get("type") == "policy":
                        row["lending"] = current
        except Exception as e:
            logger.warning("macro_tcmb_policy_patch_error", error=str(e))

        return {"source": "TCMB", "data": data}
    except Exception as e:
        logger.error("macro_tcmb_error", error=str(e))
        return {"source": "TCMB", "data": {}, "error": str(e)}


@cached(TTL_MACRO, "macro")
async def get_policy_rate() -> dict:
    try:
        import borsapy as bp
        # bp.policy_rate() reads the FIRST row of TCMB's rate table, but the
        # table is oldest-first, so it returns the 2010 rate (7.0%). The
        # history table's last row is the current policy rate.
        tcmb = await run_sync(bp.TCMB)
        history = await run_sync(tcmb.history)
        if history is not None and len(history) > 0:
            latest = history.iloc[-1]
            return {
                "source": "TCMB",
                "policy_rate": {
                    "value": float(latest["lending"]),
                    "date": str(history.index[-1].date()) if hasattr(history.index[-1], "date") else str(history.index[-1]),
                },
                "history": df_to_records(history.tail(24)),
            }
        return {"source": "TCMB", "policy_rate": {}}
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
        history = await run_sync(lambda: fx.history(period="1mo") if hasattr(fx, "history") else None)
        return {
            "currency": currency,
            "info": info if isinstance(info, dict) else safe_serialize(info) if info else {},
            "history": df_to_records(history) if history is not None else [],
        }
    except Exception as e:
        logger.error("macro_fx_error", currency=currency, error=str(e))
        return {"currency": currency, "info": {}, "history": [], "error": str(e)}


async def _fetch_calendar_from_borsapy() -> list:
    """Try borsapy economic_calendar first."""
    import borsapy as bp
    cal = await run_sync(bp.economic_calendar)
    data = df_to_records(cal) if hasattr(cal, "iterrows") else safe_serialize(cal)
    if isinstance(data, list) and len(data) > 0:
        return data
    return []


async def _fetch_calendar_from_investpy() -> list:
    """Fallback: try investpy economic calendar."""
    try:
        import investpy
        from datetime import datetime, timedelta
        today = datetime.now()
        from_date = today.strftime("%d/%m/%Y")
        to_date = (today + timedelta(days=30)).strftime("%d/%m/%Y")
        df = await run_sync(
            lambda: investpy.economic_calendar(
                countries=["turkey"],
                from_date=from_date,
                to_date=to_date,
            )
        )
        return df_to_records(df) if hasattr(df, "iterrows") else []
    except Exception as e:
        logger.warning("investpy_calendar_fallback_error", error=str(e))
        return []


async def _get_static_calendar() -> list:
    """Static fallback for known recurring Turkish economic events."""
    from datetime import datetime, timedelta
    today = datetime.now()
    events = []
    recurring = [
        {"event": "TCMB Politika Faizi Karari", "day_offset": 14, "forecast": None, "actual": None},
        {"event": "TUFE (Tuketici Fiyat Endeksi) - Aylik", "day_offset": 3, "forecast": None, "actual": None},
        {"event": "Sanayi Uretim Endeksi", "day_offset": 10, "forecast": None, "actual": None},
        {"event": "Issizlik Orani", "day_offset": 15, "forecast": None, "actual": None},
        {"event": "Dis Ticaret Dengesi", "day_offset": 28, "forecast": None, "actual": None},
        {"event": "Tuketici Guven Endeksi", "day_offset": 22, "forecast": None, "actual": None},
        {"event": "PMI Imalat Sanayi", "day_offset": 1, "forecast": None, "actual": None},
        {"event": "Cari Islemler Dengesi", "day_offset": 12, "forecast": None, "actual": None},
    ]
    for item in recurring:
        event_date = today + timedelta(days=item["day_offset"])
        events.append({
            "event": item["event"],
            "date": event_date.strftime("%Y-%m-%d"),
            "actual": item["actual"],
            "forecast": item["forecast"],
        })
    events.sort(key=lambda x: x["date"])
    return events


@cached(TTL_MACRO, "macro")
async def get_economic_calendar() -> dict:
    try:
        data = await _fetch_calendar_from_borsapy()
        if data:
            return {"calendar": data}
    except Exception as e:
        logger.warning("borsapy_calendar_error", error=str(e))

    try:
        data = await _fetch_calendar_from_investpy()
        if data:
            return {"calendar": data}
    except Exception as e:
        logger.warning("investpy_calendar_error", error=str(e))

    data = await _get_static_calendar()
    return {"calendar": data, "source": "static_fallback"}
