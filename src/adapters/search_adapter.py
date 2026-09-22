"""Sembol arama adaptoru — BIST hisse arama ve sirket evreni."""

from typing import Any

import structlog

from src.adapters.screener_adapter import screen_all_stocks_sync
from src.adapters.utils import (
    TTL_COMPANY_LIST,
    InvalidInputError,
    cached,
    df_to_records,
    error_payload,
    run_sync,
    safe_serialize,
)

logger = structlog.get_logger(__name__)

SEARCH_MIN_LENGTH = 2
SEARCH_MAX_LENGTH = 50
TTL_SEARCH = 3600  # symbol metadata; new listings show up within the hour


def normalize_query(query: str) -> str:
    """Trim/collapse whitespace and enforce the length limits."""
    text = " ".join((query or "").split())
    if len(text) < SEARCH_MIN_LENGTH:
        raise InvalidInputError(f"Arama sorgusu en az {SEARCH_MIN_LENGTH} karakter olmalı")
    if len(text) > SEARCH_MAX_LENGTH:
        raise InvalidInputError(f"Arama sorgusu en fazla {SEARCH_MAX_LENGTH} karakter olabilir")
    return text


def _rows(result: Any) -> list[Any]:
    if result is None:
        return []
    if hasattr(result, "iterrows"):
        return df_to_records(result)
    if isinstance(result, list):
        return result
    data = safe_serialize(result)
    return [data] if isinstance(data, dict) else list(data)


@cached(TTL_SEARCH, "search")
async def search_symbol(query: str) -> dict:
    """Search only tradable BIST stocks used by the stock-analysis pages."""
    try:
        normalized = normalize_query(query)
        import borsapy as bp

        result = await run_sync(
            lambda: bp.search(
                normalized,
                type="stock",
                exchange="BIST",
                limit=20,
                full_info=True,
            )
        )
        data = [
            {
                **row,
                "ticker": row.get("symbol"),
                "name": row.get("description") or row.get("name") or "",
            }
            if isinstance(row, dict) else row
            for row in _rows(result)
        ]
        return {"query": query, "source": "TradingView BIST symbol search (borsapy)", "results": data}
    except Exception as e:
        logger.error("search_error", query=query, error=str(e))
        return {"query": query, "results": [], **error_payload(e, "Sembol araması yapılamadı")}


@cached(TTL_COMPANY_LIST, "search")
async def list_companies() -> dict:
    """List the BIST equity universe, excluding non-traded KAP members."""
    try:
        data = _rows(await run_sync(screen_all_stocks_sync))
        return {
            "count": len(data),
            "source": "İş Yatırım BIST pay taraması (borsapy)",
            "companies": data,
        }
    except Exception as e:
        logger.error("companies_list_error", error=str(e))
        return {"count": 0, "companies": [], **error_payload(e, "Şirket listesi alınamadı")}
