"""Hisse tarama adaptoru — borsapy Screener."""

import structlog

from src.adapters.utils import cached, df_to_records, run_sync, TTL_MARKET

logger = structlog.get_logger(__name__)


@cached(TTL_MARKET, "screener")
async def screen_stocks(filters: dict | None = None) -> dict:
    """Hisse tarama — filtrelerle BIST hisselerini tara.

    Ornek filtreler:
        {"market_cap_basic": [1_000_000_000, None]}  -> piyasa degeri > 1 milyar
        {"price_earnings_ttm": [None, 10]}           -> F/K < 10
        {"return_on_equity": [15, None]}              -> ROE > %15
    """
    try:
        import borsapy as bp

        if filters:
            result = await run_sync(lambda: bp.screen_stocks(filters=filters))
        else:
            result = await run_sync(bp.screen_stocks)

        data = df_to_records(result) if hasattr(result, "iterrows") else result
        return {"filters": filters or {}, "results": data}
    except Exception as e:
        logger.error("screener_error", filters=filters, error=str(e))
        return {"filters": filters or {}, "results": [], "error": str(e)}


@cached(TTL_MARKET, "screener")
async def get_screener_templates() -> dict:
    """Hazir tarama sablonlari listesi."""
    try:
        import borsapy as bp
        screener = await run_sync(lambda: bp.Screener())
        templates = await run_sync(
            lambda: screener.templates if hasattr(screener, "templates") else []
        )
        return {"templates": templates if isinstance(templates, list) else []}
    except Exception as e:
        logger.error("screener_templates_error", error=str(e))
        return {"templates": [], "error": str(e)}
