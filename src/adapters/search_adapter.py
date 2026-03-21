"""Sembol arama adaptoru — hisse ve VIOP kontrat arama."""

import structlog

from src.adapters.utils import cached, df_to_records, safe_serialize, run_sync, TTL_MARKET

logger = structlog.get_logger(__name__)


@cached(TTL_MARKET, "search")
async def search_symbol(query: str) -> dict:
    """Hisse veya VIOP kontrati ara."""
    try:
        import borsapy as bp
        result = await run_sync(lambda: bp.search(query))
        if result is None:
            return {"query": query, "results": []}
        if hasattr(result, "iterrows"):
            data = df_to_records(result)
        elif isinstance(result, list):
            data = result
        else:
            data = safe_serialize(result)
            if isinstance(data, dict):
                data = [data]
        return {"query": query, "results": data}
    except Exception as e:
        logger.error("search_error", query=query, error=str(e))
        return {"query": query, "results": [], "error": str(e)}


@cached(TTL_MARKET, "search")
async def list_companies() -> dict:
    """Tum BIST sirketlerini listele."""
    try:
        import borsapy as bp
        result = await run_sync(bp.companies)
        if hasattr(result, "iterrows"):
            data = df_to_records(result)
        elif isinstance(result, list):
            data = result
        else:
            data = []
        return {"count": len(data), "companies": data}
    except Exception as e:
        logger.error("companies_list_error", error=str(e))
        return {"count": 0, "companies": [], "error": str(e)}
