"""Teknik sinyal tarama adaptoru — borsapy TechnicalScanner.

TechnicalScanner API:
  - add_condition(condition) -> condition ekle
  - run() -> tarama calistir
  - results -> sonuclar
  - to_dataframe() -> DataFrame olarak sonuclar
"""

import structlog

from src.adapters.utils import cached, df_to_records, run_sync, TTL_MARKET

logger = structlog.get_logger(__name__)

_CONDITION_ALIASES = {
    "rsi_oversold": ("rsi < 30", "RSI Aşırı Satım", "rsi"),
    "rsi_overbought": ("rsi > 70", "RSI Aşırı Alım", "rsi"),
    "golden_cross": ("sma_20 crosses_above sma_50", "Golden Cross", "sma_spread"),
}


def _format_scan_records(records: list[dict], signal: str, value_field: str) -> list[dict]:
    formatted: list[dict] = []
    for row in records:
        value = row.get(value_field)
        if value_field == "sma_spread":
            sma20 = row.get("sma20")
            sma50 = row.get("sma50")
            if isinstance(sma20, (int, float)) and isinstance(sma50, (int, float)):
                value = float(sma20) - float(sma50)
            else:
                value = None
        formatted.append({
            **row,
            "ticker": row.get("symbol") or row.get("ticker"),
            "signal": signal,
            "value": value,
        })
    return formatted


@cached(TTL_MARKET, "scanner")
async def scan_signals(condition: str | None = None) -> dict:
    """Teknik sinyal taramasi.

    condition ornekleri: "rsi_below_30", "macd_cross_above_signal"
    """
    try:
        import borsapy as bp
        expression, signal, value_field = _CONDITION_ALIASES.get(
            condition or "",
            (condition or "close > 0", "RSI", "rsi"),
        )
        scanner = await run_sync(lambda: bp.TechnicalScanner().set_universe("XU100"))
        await run_sync(lambda: scanner.add_condition(expression, name=signal))
        for column in ("rsi", "sma_20", "sma_50"):
            await run_sync(lambda current=column: scanner.add_column(current))

        # run() already returns the result DataFrame. Calling the deprecated
        # results/to_dataframe accessors either loses the data or runs twice.
        result = await run_sync(lambda: scanner.run(limit=100))
        records = df_to_records(result) if result is not None else []
        data = _format_scan_records(records, signal, value_field)
        return {
            "condition": condition,
            "expression": expression,
            "source": "TradingView Scanner API (borsapy)",
            "results": data,
        }
    except Exception as e:
        logger.error("scanner_error", condition=condition, error=str(e))
        return {"condition": condition, "results": [], "error": str(e)}
