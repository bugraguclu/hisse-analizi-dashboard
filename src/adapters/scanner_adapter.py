"""Teknik sinyal tarama adaptoru — borsapy TechnicalScanner.

TechnicalScanner API:
  - add_condition(condition) -> condition ekle
  - run() -> tarama calistir
  - results -> sonuclar
  - to_dataframe() -> DataFrame olarak sonuclar
"""

import asyncio

import structlog

logger = structlog.get_logger(__name__)


def _safe_records(data) -> list:
    """Herhangi bir veriyi list[dict]'e cevir."""
    if data is None:
        return []
    if isinstance(data, list):
        return data
    if hasattr(data, "to_dict"):
        try:
            return data.to_dict(orient="records") if hasattr(data, "iterrows") else [data.to_dict()]
        except Exception:
            return []
    return []


async def scan_signals(condition: str | None = None) -> dict:
    """Teknik sinyal taramasi.

    condition ornekleri: "rsi_below_30", "macd_cross_above_signal"
    """
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        scanner = await loop.run_in_executor(None, lambda: bp.TechnicalScanner())

        if condition:
            await loop.run_in_executor(None, lambda: scanner.add_condition(condition))

        await loop.run_in_executor(None, lambda: scanner.run())

        # Sonuclari al
        results = await loop.run_in_executor(None, lambda: scanner.results)
        df = await loop.run_in_executor(None, lambda: scanner.to_dataframe())

        data = _safe_records(df) if df is not None else _safe_records(results)
        return {"condition": condition, "results": data}
    except Exception as e:
        logger.error("scanner_error", condition=condition, error=str(e))
        return {"condition": condition, "results": [], "error": str(e)}
