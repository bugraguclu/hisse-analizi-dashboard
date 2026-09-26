"""EVDS3 (TCMB Elektronik Veri Dağıtım Sistemi) adapter — optional supplementary
macro series source, layered on top of ``borsapy``'s EVDS wrapper.

Enabled only when ``MACRO_EVDS_API_KEY`` is set (``settings.macro_evds_api_key``):
pulling observation *values* from the EVDS3 REST backend requires a (free) key,
even though catalogue browsing (categories/datagroups/series) is anonymous.
When no key is configured, :func:`evds_enabled` is ``False`` and the macro
store simply does not populate ``evds.*`` series — the mandatory ``tcmb.*`` /
``tuik.*`` series (from :mod:`src.adapters.tcmb_adapter`) are unaffected.

Series codes were located live via the anonymous catalogue on 2026-09-23
(no key needed for this lookup)::

    >>> import borsapy as bp
    >>> ev = bp.EVDS()
    >>> ev.datagroups(category_id=2005)   # "TÜKETİCİ FİYAT ENDEKSİ (TÜİK)"
    ...   bie_tukfiy2025  Tüketici Fiyat Endeksi (2025=100)
    >>> ev.series_in_group("bie_tukfiy2025")
    ...   TP.TUKFIY2025.GENEL   "Genel Endeks"
    >>> ev.datagroups(category_id=2006)   # "YURT İÇİ ÜRETİCİ FİYAT ENDEKSİ (TÜİK)"
    ...   bie_tufe1yi     Yurt İçi Üretici Fiyat Endeksi
    >>> ev.series_in_group("bie_tufe1yi")
    ...   TP.TUFE1YI.T1        "1.Yurt İçi Üretici Fiyat Endeksi"

TÜİK rebased the CPI to 2025=100 at some point before this branch's reference
date (the datagroup name says so); ``TP.TUKFIY2025.GENEL`` is the *current*
series. If TÜİK rebases again, a new ``bie_tukfiyYYYY`` datagroup will appear
and this mapping needs updating — re-run the lookup above to confirm before
trusting ``evds.cpi.*`` next to a much older ``tuik.cpi.*`` reading.

No TCMB policy-rate EVDS code is mapped here: the mandatory accuracy
cross-check (data-platform.md §2 / WS4 report item 5a) falls back to the
TCMB "Faiz Oranları" page HTML text when no EVDS key is configured, which is
exactly what :mod:`src.adapters.tcmb_adapter` already scrapes — so the
fallback path needs no EVDS code at all.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

import structlog

from src.adapters.utils import MarketDataError, run_sync
from src.core.config import settings

logger = structlog.get_logger(__name__)

# our series name -> EVDS dot-code (an index level; yoy/mom come from the
# ``formula`` argument on history(), not a separate series).
EVDS_INDEX_SERIES: dict[str, str] = {
    "cpi": "TP.TUKFIY2025.GENEL",
    "ppi": "TP.TUFE1YI.T1",
}


@dataclass(frozen=True)
class EvdsObservation:
    observation_date: date
    value: Decimal


def evds_enabled() -> bool:
    return bool(settings.macro_evds_api_key.strip())


async def fetch_evds_series(
    name: str, *, formula: str = "yoy_pct", start: str = "2005-01-01"
) -> list[EvdsObservation]:
    """History for one of :data:`EVDS_INDEX_SERIES`.

    ``formula``: ``"yoy_pct"`` (year-over-year %) or ``"pct_change"``
    (month-over-month % for a monthly series) — computed server-side by EVDS,
    matching the ready-made percentages TCMB's own CPI/PPI tables publish.
    Raises :class:`MarketDataError` (503) when no API key is configured.
    """
    if not evds_enabled():
        raise MarketDataError("EVDS API anahtarı tanımlı değil", status_code=503)
    code = EVDS_INDEX_SERIES.get(name)
    if code is None:
        raise ValueError(f"unknown EVDS series name: {name!r} (expected one of {list(EVDS_INDEX_SERIES)})")

    key = settings.macro_evds_api_key.strip()

    def _fetch() -> Any:
        import borsapy as bp

        bp.set_evds_key(key)
        series = bp.EVDS().series(code)
        return series.history(start=start, formula=formula)

    try:
        df = await run_sync(_fetch)
    except Exception as e:
        logger.warning("evds_fetch_failed", series=name, code=code, formula=formula, error=f"{type(e).__name__}: {e}")
        raise MarketDataError(f"EVDS serisi alınamadı: {code}", status_code=502) from e
    if df is None or not hasattr(df, "empty") or df.empty:
        raise MarketDataError(f"EVDS serisi boş: {code}", status_code=502)

    value_col = "Value" if "Value" in df.columns else df.columns[0]
    out: list[EvdsObservation] = []
    for ts, raw in df[value_col].items():
        try:
            value = Decimal(str(round(float(raw), 6)))
        except (TypeError, ValueError, InvalidOperation):
            continue
        out.append(EvdsObservation(observation_date=ts.date(), value=value))
    return out
