"""Teknik sinyal tarama adaptoru — borsapy TechnicalScanner (TradingView Scanner API).

Only the named conditions below are accepted: borsapy silently returns an
empty result for expressions it cannot parse, which the UI would show as
"no matches" instead of an error.
"""

from typing import NamedTuple

import structlog

from src.adapters.utils import (
    TTL_MARKET,
    InvalidInputError,
    MarketDataError,
    cached,
    df_to_records,
    error_payload,
    finite_float,
    run_sync,
    tradingview_scan,
)

logger = structlog.get_logger(__name__)

SOURCE = "TradingView Scanner API (borsapy)"
SCAN_UNIVERSE = "XU100"


class ScanCondition(NamedTuple):
    expression: str      # borsapy TechnicalScanner condition
    signal: str          # label shown in the UI (Turkish)
    value_field: str     # row field reported as "value"


SCAN_CONDITIONS: dict[str, ScanCondition] = {
    "rsi_oversold": ScanCondition("rsi < 30", "RSI Aşırı Satım", "rsi"),
    "rsi_overbought": ScanCondition("rsi > 70", "RSI Aşırı Alım", "rsi"),
    # Standard definition: the 50-day SMA crosses the 200-day SMA on the latest daily bar.
    "golden_cross": ScanCondition("sma_50 crosses_above sma_200", "Golden Cross", "sma_spread"),
    "death_cross": ScanCondition("sma_50 crosses_below sma_200", "Death Cross", "sma_spread"),
}
DEFAULT_CONDITION = ScanCondition("close > 0", "RSI", "rsi")
_EXTRA_COLUMNS = ("rsi", "sma_20", "sma_50", "sma_200")


def resolve_condition(condition: str | None) -> ScanCondition:
    key = (condition or "").strip().lower()
    if not key:
        return DEFAULT_CONDITION
    spec = SCAN_CONDITIONS.get(key)
    if spec is None:
        raise InvalidInputError(
            f"Geçersiz tarama koşulu: '{condition}'. Geçerli değerler: {', '.join(SCAN_CONDITIONS)}"
        )
    return spec


def _format_scan_records(records: list[dict], signal: str, value_field: str, signal_key: str | None = None) -> list[dict]:
    formatted: list[dict] = []
    for row in records:
        value = row.get(value_field)
        if value_field == "sma_spread":
            sma50 = finite_float(row.get("sma50"))
            sma200 = finite_float(row.get("sma200"))
            value = sma50 - sma200 if sma50 is not None and sma200 is not None else None
        formatted.append({
            **row,
            "ticker": row.get("symbol") or row.get("ticker"),
            "signal": signal,
            "signal_key": signal_key,
            "value": finite_float(value),
            "change_pct": finite_float(row.get("change")),
        })
    return formatted


def _run_scan(expression: str, signal: str) -> object:
    import borsapy as bp

    scanner = bp.TechnicalScanner().set_universe(SCAN_UNIVERSE)
    if not scanner.symbols or scanner.symbols == [SCAN_UNIVERSE]:
        # borsapy falls back to no symbols (or the index code itself) when the
        # component list cannot be downloaded; that is an outage, not "no matches".
        raise MarketDataError("Endeks bileşen listesi alınamadı", status_code=503)
    scanner.add_condition(expression, name=signal)
    for column in _EXTRA_COLUMNS:
        scanner.add_column(column)
    # run() already returns the result DataFrame. The deprecated
    # results/to_dataframe accessors either lose the data or run twice.
    return scanner.run(limit=100)


@cached(TTL_MARKET, "scanner")
async def scan_signals(condition: str | None = None) -> dict:
    """XU100 hisselerinde teknik sinyal taramasi.

    condition: None (tum XU100, RSI ile), "rsi_oversold", "rsi_overbought",
    "golden_cross" (SMA50, SMA200'u yukari keser), "death_cross".
    """
    try:
        spec = resolve_condition(condition)
        result = await run_sync(_run_scan, spec.expression, spec.signal)
        records = df_to_records(result) if result is not None else []
        if not records:
            # borsapy reports a failed scanner request only as a warning plus an
            # empty frame. Probe the same endpoint so an outage becomes a 503
            # (and is not cached) instead of an empty "no matches" list.
            await tradingview_scan([SCAN_UNIVERSE], ["close"])
        signal_key = (condition or "").strip().lower() or None
        return {
            "condition": condition,
            "expression": spec.expression,
            "source": SOURCE,
            "results": _format_scan_records(records, spec.signal, spec.value_field, signal_key),
        }
    except Exception as e:
        logger.error("scanner_error", condition=condition, error=str(e))
        return {"condition": condition, "results": [], **error_payload(e, "Teknik tarama yapılamadı")}
