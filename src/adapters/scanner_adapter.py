"""Teknik sinyal tarama adaptoru — borsapy TechnicalScanner."""

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


async def scan_signals(condition: str | None = None) -> dict:
    """Teknik sinyal taramasi.

    condition ornekleri: "rsi_oversold", "macd_crossover", "bollinger_breakout"
    """
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        scanner = await loop.run_in_executor(None, lambda: bp.TechnicalScanner())

        if condition:
            result = await loop.run_in_executor(None, lambda: scanner.scan(condition=condition))
        else:
            result = await loop.run_in_executor(None, lambda: scanner.scan())

        data = _df_to_records(result) if hasattr(result, "iterrows") else result
        return {"condition": condition, "results": data}
    except Exception as e:
        logger.error("scanner_error", condition=condition, error=str(e))
        return {"condition": condition, "results": [], "error": str(e)}
