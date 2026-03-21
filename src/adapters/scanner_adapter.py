"""Teknik sinyal tarama adaptoru — borsapy TechnicalScanner.

TechnicalScanner API:
  - add_condition(condition) -> condition ekle
  - run() -> tarama calistir
  - results -> sonuclar
  - to_dataframe() -> DataFrame olarak sonuclar
"""

import structlog

from src.adapters.utils import cached, df_to_records, safe_serialize, run_sync, TTL_MARKET

logger = structlog.get_logger(__name__)


@cached(TTL_MARKET, "scanner")
async def scan_signals(condition: str | None = None) -> dict:
    """Teknik sinyal taramasi.

    condition ornekleri: "rsi_below_30", "macd_cross_above_signal"
    """
    try:
        import borsapy as bp
        scanner = await run_sync(lambda: bp.TechnicalScanner())

        if condition:
            await run_sync(lambda: scanner.add_condition(condition))

        await run_sync(lambda: scanner.run())

        # Sonuclari al
        results = await run_sync(lambda: scanner.results)
        df = await run_sync(lambda: scanner.to_dataframe())

        if df is not None:
            data = df_to_records(df)
        elif results is not None:
            data = safe_serialize(results) if not isinstance(results, list) else results
        else:
            data = []
        return {"condition": condition, "results": data}
    except Exception as e:
        logger.error("scanner_error", condition=condition, error=str(e))
        return {"condition": condition, "results": [], "error": str(e)}
