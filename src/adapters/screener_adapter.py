"""Hisse tarama adaptoru — İş Yatırım screener + TradingView canli piyasa alanlari."""

import re
from typing import Any

import structlog

from src.adapters.utils import (
    TTL_MARKET,
    TTL_STATIC,
    InvalidInputError,
    cached,
    df_to_records,
    error_payload,
    finite_float,
    run_sync,
    tradingview_scan,
)

logger = structlog.get_logger(__name__)

SOURCE = "İş Yatırım + TradingView (borsapy)"

# Fallback copy of borsapy.Screener.TEMPLATES (the class attribute is read at runtime).
SCREENER_TEMPLATES: tuple[str, ...] = (
    "small_cap",
    "mid_cap",
    "large_cap",
    "high_dividend",
    "high_upside",
    "low_upside",
    "high_volume",
    "low_volume",
    "buy_recommendation",
    "sell_recommendation",
    "high_net_margin",
    "high_return",
    "low_pe",
    "high_roe",
    "high_foreign_ownership",
)
_RECOMMENDATIONS = {"AL", "SAT", "TUT"}
_TEXT_FILTERS = {"sector", "index"}
# borsapy resolves sector *names* through a list that currently comes back empty (every
# name filter ends in an upstream error); only İş Yatırım sector codes work.
_SECTOR_CODE_RE = re.compile(r"^\d{4}$")

# Numeric bounds passed straight to borsapy.screen_stocks. Units follow İş
# Yatırım: market_cap in *million TL*, ratios/yields/margins in percent.
_NUMERIC_FILTERS = {
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

# TradingView-style range filters ``[min, max]`` -> borsapy criteria prefix and
# the factor converting the TradingView unit to the İş Yatırım unit.
_RANGE_FILTER_ALIASES: dict[str, tuple[str, float]] = {
    "market_cap_basic": ("market_cap", 1e-6),  # TL -> million TL
    "price_earnings_ttm": ("pe", 1.0),
    "price_book_fq": ("pb", 1.0),
    "dividend_yield_recent": ("dividend_yield", 1.0),
    "return_on_equity": ("roe", 1.0),
}

# Live market columns merged into every screener row (one scanner request).
_MARKET_COLUMNS = ("close", "change", "change_abs", "volume", "Value.Traded", "market_cap_basic",
                   "sector.tr", "industry.tr")


# Criterion that selects every listed stock: a full market-cap range (million TL).
ALL_STOCKS_CRITERION: tuple[str, int, int] = ("market_cap", 0, 1_000_000_000)

# İş Bankası's privileged (A/B) and founder shares: TradingView reports the whole
# bank's market cap and C-share per-share figures against their 400,000–5,000,000 TL
# prices (P/E 1.5 million, P/B 227,000) and they barely trade. ISCTR stays listed.
EXCLUDED_SYMBOLS: frozenset[str] = frozenset({"ISATR", "ISBTR", "ISKUR"})

# Valuation multiples whose missing lower bound borsapy fills with a negative default
# (P/E -1,000): "P/E ≤ 10" would also return loss-makers, so a bare positive cap
# starts at 0. A cap at or below 0 asks for negative multiples and keeps the default.
_NON_NEGATIVE_BOUNDS = ("pe", "pb")


def screen_all_stocks_sync() -> Any:
    """Every listed BIST stock (İş Yatırım), from penny stocks to 1,000+ TL shares.

    Without any criterion borsapy adds "price > 1 TL", which silently drops
    listed penny stocks (GSRAY, TSPOR, IHLAS, ...). An explicit price range is
    no fix either: İş Yatırım's price criterion drops every stock priced at
    1,000 TL or more (DSTKF, BRYAT, CLEBI, DOCO, EGEEN, KONYA, ...). A full
    market-cap range keeps both ends of the list.
    """
    from borsapy.screener import Screener

    criterion, low, high = ALL_STOCKS_CRITERION
    return Screener().add_filter(criterion, min=low, max=high).run()


def screener_templates() -> tuple[str, ...]:
    """Template names borsapy supports (no network access needed)."""
    try:
        from borsapy.screener import Screener

        templates = tuple(str(name) for name in Screener.TEMPLATES)
    except Exception:
        return SCREENER_TEMPLATES
    return templates or SCREENER_TEMPLATES


def _number(key: str, value: Any) -> float:
    number = finite_float(value)
    if number is None:
        raise InvalidInputError(f"'{key}' filtresi sayısal olmalı")
    return number


def normalize_filters(filters: dict | None) -> dict:
    """Validate the dashboard filter contract and translate it to borsapy's API.

    Raises :class:`InvalidInputError` (HTTP 400) for unknown keys, unknown
    templates or non-numeric bounds instead of letting İş Yatırım silently
    ignore them.
    """
    if not filters:
        return {}
    if not isinstance(filters, dict):
        raise InvalidInputError("Tarama filtreleri bir JSON nesnesi olmalı")

    normalized: dict[str, Any] = {}
    for key, value in filters.items():
        if value is None:
            continue
        if key == "template":
            templates = screener_templates()
            if value not in templates:
                raise InvalidInputError(
                    f"Geçersiz tarama şablonu: '{value}'. Geçerli şablonlar: {', '.join(templates)}"
                )
            normalized[key] = value
        elif key == "recommendation":
            text = str(value).strip().upper()
            if text not in _RECOMMENDATIONS:
                raise InvalidInputError("'recommendation' AL, SAT veya TUT olmalı")
            normalized[key] = text
        elif key in _TEXT_FILTERS:
            if not isinstance(value, str) or not value.strip() or len(value) > 60:
                raise InvalidInputError(f"'{key}' filtresi 1-60 karakterlik metin olmalı")
            if key == "sector" and not _SECTOR_CODE_RE.fullmatch(value.strip()):
                raise InvalidInputError("'sector' filtresi İş Yatırım sektör kodu olmalı (ör. 0001)")
            normalized[key] = value.strip()
        elif key in _NUMERIC_FILTERS:
            normalized[key] = _number(key, value)
        elif key in _RANGE_FILTER_ALIASES:
            prefix, factor = _RANGE_FILTER_ALIASES[key]
            if not isinstance(value, (list, tuple)) or len(value) != 2:
                raise InvalidInputError(f"'{key}' filtresi [min, max] biçiminde olmalı")
            lower, upper = value
            if lower is not None:
                normalized[f"{prefix}_min"] = _number(key, lower) * factor
            if upper is not None:
                normalized[f"{prefix}_max"] = _number(key, upper) * factor
        else:
            raise InvalidInputError(f"Desteklenmeyen tarama filtresi: {key}")
    for prefix in _NON_NEGATIVE_BOUNDS:
        cap = normalized.get(f"{prefix}_max")
        if cap is not None and cap > 0 and f"{prefix}_min" not in normalized:
            normalized[f"{prefix}_min"] = 0
    return normalized


def _merge_live_market_fields(records: list[dict], market_by_symbol: dict[str, dict]) -> list[dict]:
    """Enrich İş Yatırım screener rows with one TradingView market snapshot.

    ``close`` / ``change_pct`` are the live TradingView values for today. When
    TradingView has no quote, ``criteria_7`` (İş Yatırım's last *closing*
    price, present only when the filter used the price criterion) is the
    fallback close.
    """
    enriched: list[dict] = []
    for record in records:
        symbol = str(record.get("symbol") or record.get("ticker") or "").upper()
        market = market_by_symbol.get(symbol, {})
        close = finite_float(market.get("close"))
        enriched.append({
            **record,
            "symbol": symbol,
            "close": close if close is not None else finite_float(record.get("criteria_7")),
            "change_pct": finite_float(market.get("change")),
            "change": finite_float(market.get("change_abs")),
            "volume": finite_float(market.get("volume")),
            "turnover": finite_float(market.get("Value.Traded")),
            "market_cap": finite_float(market.get("market_cap_basic")),
            "sector": market.get("sector.tr") or None,
            "industry": market.get("industry.tr") or None,
        })
    return enriched


@cached(TTL_MARKET, "screener")
async def screen_stocks(filters: dict | None = None) -> dict:
    """Hisse tarama — filtrelerle BIST hisselerini tara.

    Ornek filtreler:
        {"template": "low_pe"}
        {"market_cap_basic": [1_000_000_000, None]}  -> piyasa degeri > 1 milyar TL
        {"price_earnings_ttm": [None, 10]}           -> F/K < 10
        {"return_on_equity": [15, None]}             -> ROE > %15
    """
    try:
        normalized_filters = normalize_filters(filters)

        import borsapy as bp

        if normalized_filters:
            result = await run_sync(lambda: bp.screen_stocks(**normalized_filters))
        else:
            result = await run_sync(screen_all_stocks_sync)
        data = df_to_records(result) if hasattr(result, "iterrows") else result
        if not isinstance(data, list):
            data = []
        data = [row for row in data if str(row.get("symbol", "")).upper() not in EXCLUDED_SYMBOLS]

        # İş Yatırım only returns the last close; one exact-ticker TradingView
        # request adds today's change/volume/market cap/sector for every row.
        symbols = [str(row.get("symbol", "")).upper() for row in data if row.get("symbol")]
        market: dict[str, dict] = {}
        if symbols:
            try:
                market = await tradingview_scan(symbols, _MARKET_COLUMNS)
            except Exception as e:
                logger.warning("screener_market_enrichment_failed", error=str(e))
        return {
            "filters": filters or {},
            "source": SOURCE,
            "results": _merge_live_market_fields(data, market),
        }
    except Exception as e:
        logger.error("screener_error", filters=filters, error=str(e))
        return {"filters": filters or {}, "results": [], **error_payload(e, "Hisse taraması yapılamadı")}


@cached(TTL_STATIC, "screener")
async def get_screener_templates() -> dict:
    """Hazir tarama sablonlari listesi."""
    return {"templates": list(screener_templates())}
