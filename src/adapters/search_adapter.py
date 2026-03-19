"""Sembol arama adaptoru — hisse ve VIOP kontrat arama."""

import asyncio

import structlog

logger = structlog.get_logger(__name__)


async def search_symbol(query: str) -> dict:
    """Hisse veya VIOP kontrati ara."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, lambda: bp.search(query))
        if result is None:
            return {"query": query, "results": []}
        if hasattr(result, "to_dict"):
            data = result.to_dict(orient="records") if hasattr(result, "iterrows") else result.to_dict()
        elif isinstance(result, list):
            data = result
        else:
            data = [{"value": str(result)}]
        return {"query": query, "results": data}
    except Exception as e:
        logger.error("search_error", query=query, error=str(e))
        return {"query": query, "results": [], "error": str(e)}


async def list_companies() -> dict:
    """Tum BIST sirketlerini listele."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, bp.companies)
        if hasattr(result, "to_dict"):
            data = result.to_dict(orient="records") if hasattr(result, "iterrows") else result.to_dict()
        elif isinstance(result, list):
            data = result
        else:
            data = []
        return {"count": len(data), "companies": data}
    except Exception as e:
        logger.error("companies_list_error", error=str(e))
        return {"count": 0, "companies": [], "error": str(e)}
