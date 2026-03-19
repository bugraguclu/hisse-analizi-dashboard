"""Hisse tarama adaptoru — borsapy Screener."""

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


async def screen_stocks(filters: dict | None = None) -> dict:
    """Hisse tarama — filtrelerle BIST hisselerini tara.

    Ornek filtreler:
        {"market_cap_basic": [1_000_000_000, None]}  -> piyasa degeri > 1 milyar
        {"price_earnings_ttm": [None, 10]}           -> F/K < 10
        {"return_on_equity": [15, None]}              -> ROE > %15
    """
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()

        if filters:
            result = await loop.run_in_executor(None, lambda: bp.screen_stocks(filters=filters))
        else:
            result = await loop.run_in_executor(None, bp.screen_stocks)

        data = _df_to_records(result) if hasattr(result, "iterrows") else result
        return {"filters": filters or {}, "results": data}
    except Exception as e:
        logger.error("screener_error", filters=filters, error=str(e))
        return {"filters": filters or {}, "results": [], "error": str(e)}


async def get_screener_templates() -> dict:
    """Hazir tarama sablonlari listesi."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        screener = await loop.run_in_executor(None, lambda: bp.Screener())
        templates = await loop.run_in_executor(
            None, lambda: screener.templates if hasattr(screener, "templates") else []
        )
        return {"templates": templates if isinstance(templates, list) else []}
    except Exception as e:
        logger.error("screener_templates_error", error=str(e))
        return {"templates": [], "error": str(e)}
