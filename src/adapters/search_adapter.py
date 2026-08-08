"""Sembol arama adaptoru — hisse ve VIOP kontrat arama."""

import structlog

from src.adapters.utils import cached, df_to_records, safe_serialize, run_sync, TTL_MARKET

logger = structlog.get_logger(__name__)


@cached(TTL_MARKET, "search")
async def search_symbol(query: str) -> dict:
    """Search only tradable BIST stocks used by the stock-analysis pages."""
    try:
        import borsapy as bp
        result = await run_sync(
            lambda: bp.search(
                query,
                type="stock",
                exchange="BIST",
                limit=20,
                full_info=True,
            )
        )
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
        if isinstance(data, list):
            data = [
                {
                    **row,
                    "ticker": row.get("symbol"),
                    "name": row.get("description") or row.get("name") or "",
                }
                if isinstance(row, dict) else row
                for row in data
            ]
        return {"query": query, "source": "TradingView BIST symbol search (borsapy)", "results": data}
    except Exception as e:
        logger.error("search_error", query=query, error=str(e))
        return {"query": query, "results": [], "error": str(e)}


@cached(TTL_MARKET, "search")
async def list_companies() -> dict:
    """List the BIST equity universe, excluding non-traded KAP members."""
    try:
        import borsapy as bp
        result = await run_sync(bp.screen_stocks)
        if hasattr(result, "iterrows"):
            data = df_to_records(result)
        elif isinstance(result, list):
            data = result
        else:
            data = []
        return {
            "count": len(data),
            "source": "İş Yatırım BIST pay taraması (borsapy)",
            "companies": data,
        }
    except Exception as e:
        logger.error("companies_list_error", error=str(e))
        return {"count": 0, "companies": [], "error": str(e)}
