"""Hisse tarama adaptoru — borsapy Screener."""

import structlog

from src.adapters.utils import cached, df_to_records, run_sync, TTL_MARKET

logger = structlog.get_logger(__name__)

_DIRECT_FILTERS = {
    "template",
    "sector",
    "index",
    "recommendation",
    "market_cap_min",
    "market_cap_max",
    "pe_min",
    "pe_max",
    "pb_min",
    "pb_max",
    "dividend_yield_min",
    "dividend_yield_max",
    "upside_potential_min",
    "upside_potential_max",
    "net_margin_min",
    "net_margin_max",
    "roe_min",
    "roe_max",
}

_RANGE_FILTER_ALIASES = {
    "market_cap_basic": "market_cap",
    "price_earnings_ttm": "pe",
    "price_book_fq": "pb",
    "dividend_yield_recent": "dividend_yield",
    "return_on_equity": "roe",
}


def _normalize_filters(filters: dict | None) -> dict:
    """Translate the dashboard filter contract to borsapy's public API."""
    if not filters:
        return {}

    normalized: dict = {}
    for key, value in filters.items():
        if key in _DIRECT_FILTERS:
            normalized[key] = value
            continue

        alias = _RANGE_FILTER_ALIASES.get(key)
        if alias and isinstance(value, (list, tuple)) and len(value) == 2:
            lower, upper = value
            if lower is not None:
                normalized[f"{alias}_min"] = lower
            if upper is not None:
                normalized[f"{alias}_max"] = upper
            continue

        raise ValueError(f"Desteklenmeyen tarama filtresi: {key}")

    return normalized


def _merge_live_market_fields(records: list[dict], market_records: list[dict]) -> list[dict]:
    """Enrich İş Yatırım screener rows with one TradingView market snapshot."""
    market_by_symbol = {
        str(row.get("symbol", "")).upper(): row
        for row in market_records
        if row.get("symbol")
    }
    enriched: list[dict] = []
    for record in records:
        symbol = str(record.get("symbol") or record.get("ticker") or "").upper()
        market = market_by_symbol.get(symbol, {})
        enriched.append({
            **record,
            "symbol": symbol,
            "close": market.get("close", record.get("criteria_7")),
            "change_pct": market.get("change"),
            "volume": market.get("volume"),
            "market_cap": market.get("market_cap"),
        })
    return enriched


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

        normalized_filters = _normalize_filters(filters)
        result = await run_sync(lambda: bp.screen_stocks(**normalized_filters))

        data = df_to_records(result) if hasattr(result, "iterrows") else result
        if not isinstance(data, list):
            data = []

        # The İş Yatırım screener's default response contains only the last
        # price. One batch TradingView scan supplies current change/volume and
        # avoids rendering those market fields as permanently empty.
        symbols = [str(row.get("symbol", "")).upper() for row in data if row.get("symbol")]
        if symbols:
            scanner = await run_sync(lambda: bp.TechnicalScanner().set_universe(symbols))
            await run_sync(lambda: scanner.add_condition("close > 0"))
            await run_sync(lambda: scanner.add_column("volume"))
            await run_sync(lambda: scanner.add_column("market_cap"))
            market_df = await run_sync(lambda: scanner.run(limit=len(symbols)))
            data = _merge_live_market_fields(data, df_to_records(market_df))

        return {
            "filters": filters or {},
            "source": "İş Yatırım + TradingView (borsapy)",
            "results": data,
        }
    except Exception as e:
        logger.error("screener_error", filters=filters, error=str(e))
        return {"filters": filters or {}, "results": [], "error": str(e)}


@cached(TTL_MARKET, "screener")
async def get_screener_templates() -> dict:
    """Hazir tarama sablonlari listesi."""
    try:
        import borsapy as bp
        templates = await run_sync(lambda: list(bp.Screener.TEMPLATES))
        return {"templates": templates if isinstance(templates, list) else []}
    except Exception as e:
        logger.error("screener_templates_error", error=str(e))
        return {"templates": [], "error": str(e)}
