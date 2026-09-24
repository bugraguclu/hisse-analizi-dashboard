"""Finansal tablolar (KAP özeti + İş Yatırım) ve canlı oranlar — bkz. ``src.adapters.fundamentals``.

Kaynaklar:

- **KAP "Şirket Finansal Bilgileri" özeti** — resmi, ilk açıklandığı haliyle
  bilanço ve gelir tablosu (son 3 yıl sonu + en son ara dönem). Birincil kaynak.
- **İş Yatırım MaliTablo** — ara çeyrekler, nakit akışı, amortisman (FAVÖK),
  nakit ve finansal borç. IAS 29 uygulayan şirketlerde yıl sonu kolonlarını ve
  önceki yılın ara dönem kolonlarının gelir tablosu/nakit akışını (sonraki yılın
  karşılaştırmalı tutarları) güncel satın alma gücüne göre yeniden ifade eder;
  bunlar kolon başına katsayıyla ilk açıklanan değere çevrilir (bkz.
  :class:`ColumnRestatement`, ``restatement_factor``).

Bu modül fundamentals deposunun (``src.services.fundamentals_service``) saf
parçalarını da sağlar:

- :func:`kap_statement_rows` / :func:`isyatirim_statement_rows` — kaynak başına,
  dönem × tablo ``financial_statements`` satırları (sıralı kalemler, tam TL);
- :func:`kap_summary_from_rows` / :func:`isyatirim_table_from_rows` — depodaki
  satırlardan canlı adaptör çıktısının aynısını kurar (görünümler depodan ve
  canlıdan birebir aynı üretilir);
- :func:`build_canonical_facts` — KAP (ilk açıklanan) öncelikli kanonik kalemler
  (``financial_facts``): İş Yatırım yalnızca kapsamı ve tanımı KAP ile doğrulanan
  kalem/dönemleri, kolonun IAS 29 katsayısı geri alınarak tamamlar
  (:func:`classify_isyatirim_columns`, :func:`restatement_reference`);
- :func:`build_statement_view` / :func:`build_cashflow_view` /
  :func:`build_live_ratios_view` — API yanıtları.
"""

import asyncio
import hashlib
import json
import re
import statistics
from collections import Counter
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import structlog

from src.adapters.financial_adapter import (
    FLOW_KEYS,
    ISYATIRIM_COMPANY_CARD_URL,
    ISYATIRIM_GROUP_FINANCIAL,
    ISYATIRIM_GROUP_INDUSTRIAL,
    SECTION_BY_STATEMENT_TYPE,
    STATEMENT_TYPE_BY_SECTION,
    STOCK_KEYS,
    IsYatirimError,
    canonical_financial_items,
    discrete_quarter_values,
    fetch_isyatirim_financials,
    isyatirim_statement_maps,
    months_into_fiscal_year,
    normalize_label,
    parse_period,
    period_label,
    quarter_ends_before,
    restatement_factor,
    shift_months,
    sort_periods_desc,
    statement_template,
    to_number,
    ttm_components,
)
from src.adapters.utils import (
    MarketDataError,
    SymbolNotFoundError,
    cached,
    run_sync,
)
from src.services.analysis_service import (
    FINANCIAL_TEMPLATES,
    build_ratio_inputs,
    compute_financial_ratios,
    derive_financial_amounts,
    trailing_quarters,
)

from src.adapters.fundamentals_common import (  # noqa: F401
    ISTANBUL_TZ,
    TTL_SNAPSHOT,
    TTL_METRICS,
    TTL_STATEMENTS,
    TTL_REFERENCE,
    TTL_CALENDAR,
    TTL_DISCLOSURES,
    TTL_PROFILE,
    TTL_DIRECTORY,
    KAP_BASE_URL,
    KAP_BIST_COMPANIES_URL,
    _KAP_SUMMARY_PATH,
    _KAP_FINANCIAL_PATH,
    _TICKER_TOKEN_RE,
    _PERIOD_LABEL_RE,
    _SOURCE_KAP,
    _SOURCE_ISY,
    _QUARTERS_FETCHED,
    _MSG_STATEMENTS,
    _MSG_CASHFLOW,
    _MSG_RATIOS,
    _MSG_QUOTE,
    _MSG_REFERENCE,
    _today,
    _UNREACHABLE_ERRORS,
    _failure,
    _discard,
    _parse_kap_directory,
    get_kap_company_titles,
    _get_kap_directory,
    _kap_company,
    _require_listed,
    kap_get,
)
from src.adapters.fundamentals_snapshot import _get_market_snapshot

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# KAP financial summary
# ---------------------------------------------------------------------------

_KAP_UNIT_ROW = "sunum para birimi"
_KAP_NATURE_ROW = "finansal tablo niteligi"
_KAP_BALANCE_HEADER = "finansal durum tablosu"
_KAP_INCOME_HEADER = "kar veya zarar ve diger kapsamli gelir tablosu"
_ALLOWED_MULTIPLIERS = {1: 1.0, 1_000: 1_000.0, 1_000_000: 1_000_000.0, 1_000_000_000: 1_000_000_000.0}


def _kap_unit(text: str) -> tuple[float, str]:
    """``("1000000TL") -> (1e6, "TRY")``; unknown/empty → ``(1.0, "TRY")``."""
    compact = re.sub(r"[\s.]", "", str(text or "")).upper()
    folded = normalize_label(text).replace(" ", "")
    multiplier = 1.0
    digits = re.match(r"^(\d+)", compact)
    if digits:
        multiplier = _ALLOWED_MULTIPLIERS.get(int(digits.group(1)), 1.0)
    elif "milyar" in folded:
        multiplier = 1e9
    elif "milyon" in folded:
        multiplier = 1e6
    elif folded.startswith("bin"):
        multiplier = 1e3
    currency = "TRY"
    if "USD" in compact or "DOLAR" in compact or "$" in compact:
        currency = "USD"
    elif "EUR" in compact or "AVRO" in compact or "€" in compact:
        currency = "EUR"
    return multiplier, currency


def _kap_unit_multiplier(unit: str) -> float:
    return _kap_unit(unit)[0]


def _parse_kap_number(value: str, multiplier: float) -> float | None:
    """``"1.399.606"`` → ``1399606 × multiplier``; ``"-"``/empty → ``None``."""
    text = str(value or "").replace("\xa0", "").replace(" ", "").strip()
    if not text or text in {"-", "—", "–"}:
        return None
    negative = text.startswith("(") and text.endswith(")")
    if negative:
        text = text[1:-1]
    normalized = text.replace(".", "").replace(",", ".")
    try:
        number = float(normalized) * multiplier
    except ValueError:
        return None
    return -number if negative else number


def _parse_kap_section(
    rows: Sequence[Sequence[str]],
    inherited_units: Mapping[str, str | None] | None = None,
) -> dict[str, Any]:
    """One statement block: header row, unit/nature rows, then line items.

    ``inherited_units`` (period → unit text) applies when the block has no
    unit row of its own (the statements share the presentation unit).
    Blank header cells are empty columns (recently listed companies show
    placeholders for years before their listing) and are skipped.
    """
    header = rows[0]
    header_cells = [str(cell).strip() for cell in header[1:]]
    columns = [j + 1 for j, cell in enumerate(header_cells) if cell]  # cell index of every period column
    periods = [header[c].strip() for c in columns]
    if not periods or not all(_PERIOD_LABEL_RE.match(p) for p in periods):
        raise ValueError(f"KAP dönem başlıkları okunamadı: {header_cells}")
    width = len(header)
    count = len(periods)
    multipliers = [1.0] * count
    currencies = ["TRY"] * count
    units: list[str | None] = [None] * count
    natures: list[str | None] = [None] * count

    body = [list(r) for r in rows[1:] if r and any(str(c).strip() for c in r)]
    for cells in body:
        key = normalize_label(cells[0])
        if key == _KAP_UNIT_ROW:
            for j in range(count):
                text = cells[columns[j]].strip() if columns[j] < len(cells) else ""
                if text:
                    units[j] = text
                    multipliers[j], currencies[j] = _kap_unit(text)
            # A single unit cell applies to every column (older page layout).
            filled = [u for u in units if u]
            if len(filled) == 1:
                for j in range(count):
                    if units[j] is None:
                        units[j] = filled[0]
                        multipliers[j], currencies[j] = _kap_unit(filled[0])
        elif key == _KAP_NATURE_ROW:
            for j in range(count):
                text = cells[columns[j]].strip() if columns[j] < len(cells) else ""
                natures[j] = text or None

    for j in range(count):
        inherited = (inherited_units or {}).get(periods[j])
        if units[j] is None and inherited:
            units[j] = inherited
            multipliers[j], currencies[j] = _kap_unit(inherited)

    records: list[dict[str, Any]] = []
    order = sorted(range(count), key=lambda j: parse_period(periods[j]) or (0, 0), reverse=True)
    for cells in body:
        label = cells[0].strip()
        key = normalize_label(label)
        if not label or key in (_KAP_UNIT_ROW, _KAP_NATURE_ROW) or len(cells) != width:
            continue
        values = [_parse_kap_number(cells[columns[j]], multipliers[j]) for j in range(count)]
        if all(v is None for v in values):
            continue
        record: dict[str, Any] = {"Item": label}
        for j in order:
            record[periods[j]] = values[j]
        records.append(record)

    info = {
        periods[j]: {
            "presentation_unit": units[j],
            "multiplier": multipliers[j],
            "currency": currencies[j],
            "consolidation": natures[j],
        }
        for j in range(count)
    }
    return {"periods": [periods[j] for j in order], "records": records, "info": info}


def _fiscal_year_end_month(periods: Sequence[str]) -> int:
    months = [p[1] for p in (parse_period(x) for x in periods) if p]
    if not months:
        return 12
    counts = Counter(months).most_common()
    best = counts[0][1]
    candidates = [m for m, n in counts if n == best]
    return 12 if 12 in candidates else candidates[0]


def _parse_kap_financial_summary(html: str) -> dict[str, Any]:
    """Parse KAP's server-rendered financial summary; values scaled to actual TL.

    The presentation unit ("Sunum Para Birimi") is read **per column** — banks
    publish older columns in thousand TL and the latest interim in million TL.
    Periods and row keys are ordered newest first.
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    all_rows = [
        [cell.get_text(" ", strip=True) for cell in row.find_all(["th", "td"])]
        for table in soup.find_all("table")
        for row in table.find_all("tr")
    ]
    keys = [normalize_label(row[0]) if row else "" for row in all_rows]
    balance_start = next((i for i, k in enumerate(keys) if k == _KAP_BALANCE_HEADER), None)
    income_start = next((i for i, k in enumerate(keys) if k.startswith(_KAP_INCOME_HEADER)), None)
    if balance_start is None or income_start is None:
        raise ValueError("KAP finansal tablo başlıkları bulunamadı")

    if balance_start < income_start:
        balance_rows, income_rows = all_rows[balance_start:income_start], all_rows[income_start:]
    else:
        income_rows, balance_rows = all_rows[income_start:balance_start], all_rows[balance_start:]
    balance = _parse_kap_section(balance_rows)
    income = _parse_kap_section(
        income_rows, {p: info["presentation_unit"] for p, info in balance["info"].items()}
    )
    if not balance["records"] or not income["records"]:
        raise ValueError("KAP finansal özetinde veri bulunamadı")

    periods = sort_periods_desc([*balance["periods"], *income["periods"]])
    template = statement_template(r["Item"] for r in (*balance["records"], *income["records"]))
    currencies = {info["currency"] for info in balance["info"].values()}
    return {
        "periods": periods,
        "fiscal_year_end_month": _fiscal_year_end_month(periods),
        "template": template,
        "unit": currencies.pop() if len(currencies) == 1 else "MIXED",
        "balance_sheet": balance["records"],
        "income_statement": income["records"],
        "period_info": {"balance": balance["info"], "income": income["info"]},
    }


@cached(TTL_STATEMENTS, "kap_financials")
async def _get_kap_financial_summary(ticker: str) -> dict[str, Any]:
    entry = await _kap_company(ticker)
    if entry is None:
        raise MarketDataError("KAP şirket listesine şu anda ulaşılamıyor", status_code=503)
    response = await kap_get(entry["url"])
    response.raise_for_status()
    parsed = await run_sync(_parse_kap_financial_summary, response.text)
    return {**parsed, "source_url": entry["url"]}


def _filter_kap_periods(records: list[dict], quarterly: bool, fiscal_year_end_month: int = 12) -> list[dict]:
    """Annual view keeps fiscal year-end columns only; quarterly keeps everything."""
    if quarterly:
        return records
    return [
        {
            key: value
            for key, value in record.items()
            if key == "Item"
            or ((p := parse_period(key)) is not None and p[1] == fiscal_year_end_month and _PERIOD_LABEL_RE.match(key))
        }
        for record in records
    ]


# ---------------------------------------------------------------------------
# İş Yatırım statements (interim quarters, cash flow, D&A, debt)
# ---------------------------------------------------------------------------

_ISY_RETRY_AFTER = 60.0          # seconds to skip İş Yatırım after a failed fetch
_ISY_WAIT_STATEMENTS = 8.0       # statement views answer with KAP alone after this
_ISY_WAIT_RATIOS = 25.0          # TTM needs İş Yatırım's interim comparatives
_isy_failed_until: dict[str, float] = {}


@cached(TTL_STATEMENTS, "isy_quarterly")
async def _get_isyatirim_quarterly(ticker: str, fiscal_year_end_month: int = 12) -> dict[str, Any]:
    loop = asyncio.get_running_loop()
    if _isy_failed_until.get(ticker, 0.0) > loop.time():
        raise IsYatirimError(f"MaliTablo {ticker}: recent failure, retry later")
    periods = quarter_ends_before(_today(), _QUARTERS_FETCHED, fiscal_year_end_month)
    try:
        table = await fetch_isyatirim_financials(ticker, periods)
    except IsYatirimError:
        _isy_failed_until[ticker] = loop.time() + _ISY_RETRY_AFTER
        raise
    _isy_failed_until.pop(ticker, None)
    # An empty table is a valid (cacheable) answer: İş Yatırım has no data for the ticker.
    return table or {"group": None, "template": None, "periods": [], "items": []}


async def _load_statement_sources(
    ticker: str,
    isy_wait: float = _ISY_WAIT_STATEMENTS,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """``(kap_summary, isyatirim_table)``; at least one of them, else raises.

    KAP failures (other than "unknown ticker") fall back to İş Yatırım alone.
    İş Yatırım is optional for statement views: after ``isy_wait`` seconds the
    caller proceeds without it while the (shared, cached) fetch keeps running
    in the background for the next request.
    """
    await _require_listed(ticker)
    kap_task = asyncio.ensure_future(_get_kap_financial_summary(ticker))
    isy_task = asyncio.ensure_future(_get_isyatirim_quarterly(ticker, 12))
    kap: dict[str, Any] | None = None
    isy: dict[str, Any] | None = None
    kap_error: BaseException | None = None
    try:
        kap = await kap_task
    except SymbolNotFoundError:
        _discard(isy_task)
        raise
    except Exception as e:
        kap_error = e
        logger.warning("kap_financial_summary_failed", ticker=ticker, error=f"{type(e).__name__}: {e}")
    # Views that do not need İş Yatırım (annual KAP statements) only warm its cache.
    wait = isy_wait if kap is not None else max(isy_wait, _ISY_WAIT_STATEMENTS)
    try:
        if wait <= 0 and not isy_task.done():
            _discard(isy_task)
            return kap, None
        isy = await asyncio.wait_for(isy_task, timeout=max(wait, 0.001))
        fy_month = (kap or {}).get("fiscal_year_end_month", 12)
        if fy_month != 12:
            isy = await asyncio.wait_for(_get_isyatirim_quarterly(ticker, fy_month), timeout=max(wait, 0.001))
    except Exception as e:
        logger.warning("isyatirim_statements_unavailable", ticker=ticker, error=f"{type(e).__name__}: {e}")
        isy = None
    if isy is not None and not isy.get("periods"):
        isy = None
    if kap is None and isy is None:
        if isinstance(kap_error, MarketDataError):
            raise kap_error
        raise MarketDataError(_MSG_STATEMENTS, status_code=503)
    return kap, isy


def _kap_canonical_by_period(kap: Mapping[str, Any]) -> dict[str, dict[str, float | None]]:
    by_period: dict[str, dict[str, float | None]] = {}
    for period in kap.get("periods", []):
        balance = {r["Item"]: r.get(period) for r in kap.get("balance_sheet", [])}
        income = {r["Item"]: r.get(period) for r in kap.get("income_statement", [])}
        by_period[period] = canonical_financial_items(balance=balance, income=income)
    return by_period


def _isy_canonical_by_period(isy: Mapping[str, Any]) -> dict[str, dict[str, float | None]]:
    return {
        period: canonical_financial_items(
            balance=maps["balance"], income=maps["income"], cashflow=maps["cashflow"]
        )
        for period, maps in isyatirim_statement_maps(isy).items()
    }


def _restatement_factors(
    kap_items: Mapping[str, Mapping[str, float | None]],
    isy_items: Mapping[str, Mapping[str, float | None]],
    template: str | None,
) -> dict[str, dict[str, float | None]]:
    """Per overlapping period: KAP (as reported) ÷ İş Yatırım for balance and flows.

    Only meaningful for the industrial template: the bank data on İş Yatırım is
    bank-only (solo) while KAP shows consolidated figures, so the ratio there
    reflects scope, not restatement.
    """
    factors: dict[str, dict[str, float | None]] = {}
    if template != "industrial":
        return factors
    for period in set(kap_items) & set(isy_items):
        k, i = kap_items[period], isy_items[period]
        balance = restatement_factor(k.get("total_assets"), i.get("total_assets"))
        flow = restatement_factor(k.get("revenue"), i.get("revenue")) or restatement_factor(
            k.get("net_income"), i.get("net_income")
        )
        if balance is not None and flow is not None and abs(balance / flow - 1) > 0.01:
            # Inconsistent → different scope/definitions; do not rescale this period.
            balance = flow = None
        factors[period] = {"balance": balance or flow, "flow": flow or balance}
    return factors


def _rescale(value: float, factor: float, unit: float = 1.0) -> float:
    """``value × factor`` rounded to the reporting unit (removes float noise)."""
    step = unit if unit and unit > 0 else 1.0
    return round(value * factor / step) * step


def _period_unit(kap: Mapping[str, Any] | None, period: str, section: str = "balance") -> float:
    info = ((kap or {}).get("period_info", {}).get(section) or {}).get(period) or {}
    return float(info.get("multiplier") or 1.0)


def _scaled_items(
    items: Mapping[str, float | None],
    factor: Mapping[str, float | None] | None,
    unit: float = 1.0,
) -> dict[str, float | None]:
    if not factor:
        return dict(items)
    result: dict[str, float | None] = {}
    for key, value in items.items():
        f = factor.get("flow") if key in FLOW_KEYS else factor.get("balance")
        # Nominal share capital is never re-expressed by İş Yatırım.
        if value is None or f is None or key == "paid_in_capital":
            result[key] = value
        else:
            result[key] = _rescale(value, f, unit)
    return result


def combined_template(kap: Mapping[str, Any] | None, isy: Mapping[str, Any] | None) -> str:
    """Statement template of a company from both sources (İş Yatırım's financial layouts win)."""
    template = str((kap or {}).get("template") or (isy or {}).get("template") or "industrial")
    isy_template = (isy or {}).get("template")
    if isy_template in ("bank", "insurance"):
        template = str(isy_template)
    return template


def kap_statement_maps(kap: Mapping[str, Any] | None) -> dict[str, dict[str, dict[str, Any]]]:
    """``{period: {"balance": {label: value}, "income": {label: value}}}`` of a KAP summary."""
    result: dict[str, dict[str, dict[str, Any]]] = {}
    for period in (kap or {}).get("periods", []):
        result[period] = {
            "balance": {r["Item"]: r.get(period) for r in (kap or {}).get("balance_sheet", [])},
            "income": {r["Item"]: r.get(period) for r in (kap or {}).get("income_statement", [])},
        }
    return result


def kap_period_units(kap: Mapping[str, Any] | None) -> dict[str, float]:
    """Presentation-unit multiplier per KAP period (balance sheet), e.g. ``1e6``."""
    return {period: _period_unit(kap, period) for period in (kap or {}).get("periods", [])}


def _merged_canonical_by_period(
    kap: Mapping[str, Any] | None,
    isy: Mapping[str, Any] | None,
    reference: Mapping[str, float] | None = None,
) -> tuple[dict[str, dict[str, float | None]], str]:
    """Canonical items per period for ratio/TTM work, plus the statement template.

    KAP (first published) first; İş Yatırım completes items and periods only
    where its scope and definitions are verified against KAP (see
    :func:`build_canonical_facts`).
    """
    facts = facts_from_sources(kap, isy, reference=reference)
    return facts.items, facts.template


# ---------------------------------------------------------------------------
# IAS 29: which İş Yatırım columns are re-expressed, and by which factor
# ---------------------------------------------------------------------------
#
# İş Yatırım overwrites a period's column with the comparative figures of every later
# report that contains the period:
#
# * a fiscal year-end column is re-expressed as a whole (balance sheet, income statement,
#   cash flow) in the measuring unit of the report it was last compared in (the next
#   annual report; before that is out, the latest interim report);
# * an interim column P takes the income statement and cash flow of the report for
#   P + 12 months (its comparative period) once that report is published. Its balance
#   sheet is NOT re-expressed — that report compares with the previous fiscal year-end
#   balance sheet — so the column is mixed.
#
# IAS 29 re-expresses a comparative period with one general price index ratio
# (CPI(period) ÷ CPI(report)), the same for every line and every company. The balance
# sheet's "Dönem Net Kar/Zararı" (İş Yatırım 2OCF: the parent's result of the period) of an
# interim column therefore stays first published while the income statement's "Ana
# Ortaklık Payları" (3Z) is re-expressed: 2OCF ÷ 3Z is the column's de-restatement factor.
# Verified against the first-published KAP reports of 2025/06 (BIMAS, AEFES, FROTO, TUPRS,
# ASELS, KCHOL): revenue, gross/operating profit, net income, D&A and operating cash flow
# × 0.75695 (BIMAS 0.75698) equal KAP; the balance-sheet lines are equal as served.
#
# When a company's own ratio is unusable (small, zero or sign-changing results) the
# cross-company factor of the period is used (:func:`restatement_reference`). A comparative
# can also be *re-presented* beyond the index ratio: its own ratio then disagrees with the
# period's factor. Verified on KAP (ALARK 2025/06, KCHOL 2024/06, ARCLK 2024/09): revenue,
# gross profit and D&A still follow the index ratio, while operating profit (ARCLK: 1.46 bn
# first published vs 17.5 bn), net income and operating cash flow were re-presented. So the
# index ratio converts only those lines, the parent's result is the balance sheet's
# first-published 2OCF, and every other flow of the column is unknown.

_FACT_TOLERANCE = 0.005  # relative deviation accepted between KAP and de-restated İş Yatırım values
_FACTOR_CONSISTENCY = 0.01  # balance vs flow restatement factor of one period
_RESTATED_THRESHOLD = 0.002  # |factor − 1| above this = column re-expressed (IAS 29)
_OWN_RATIO_TOLERANCE = 0.005  # a column's own 2OCF ÷ 3Z vs the period's cross-company factor
_REFERENCE_AGREEMENT = 0.002  # companies whose ratios form a period's cross-company factor
_REFERENCE_MIN_COMPANIES = 3
# Twelve-month CPI ratios since IAS 29 was adopted stay above 0.55; ≤ 0.998 = re-expressed.
_PLAUSIBLE_OWN_RATIO = (0.3, 1 - _RESTATED_THRESHOLD)
#: First period reported under IAS 29 in Turkey (KGK: periods ending on/after 31 December 2023).
#: Interim reports before it were published at historical cost, so their re-expressed
#: comparatives cannot be converted back with an index ratio.
IAS29_FIRST_PERIOD: tuple[int, int] = (2023, 12)
_BALANCE_PERIOD_PROFIT_LABELS = frozenset({"donem net kar/zarari"})  # İş Yatırım 2OCF
#: Canonical flows a re-presented comparative still converts with the index ratio.
REPRESENTED_SAFE_FLOWS: frozenset[str] = frozenset(
    {"revenue", "gross_profit", "depreciation_amortization", "net_interest_income"}
)
#: İş Yatırım income-statement codes of those lines (sales, cost of sales, gross profits).
_REPRESENTED_SAFE_INCOME_CODES = frozenset({"3C", "3CA", "3CAA", "3CAB", "3CAC", "3CAD", "3CAE", "3CAF", "3CB", "3D"})
_REPRESENTED_SAFE_CASHFLOW_CODES = frozenset({"4B", "4CAB"})  # depreciation & amortisation
_PARENT_INCOME_CODE = "3Z"
_PAID_IN_CAPITAL_CODE = "2OA"
# Cash-flow memo lines that are foreign-currency positions at the period end: an interim
# column takes them from its own report (the next year's report compares with the year end).
_FX_POSITION_LINE_RE = re.compile(r"\bpozisyon|\bypp\b")
_SCOPE_ANCHORS = ("total_equity", "net_income")
CASH_FLOW_KEYS: frozenset[str] = frozenset(
    {"depreciation_amortization", "operating_cash_flow", "investing_cash_flow", "financing_cash_flow",
     "capex", "free_cash_flow"}
)


def fact_statement(key: str) -> str:
    """``balance`` / ``income`` / ``cashflow`` — the statement a canonical key comes from."""
    if key in CASH_FLOW_KEYS:
        return "cashflow"
    return "income" if key in FLOW_KEYS else "balance"


def _apply_factor(value: float, factor: float | None, unit: float = 1.0) -> float | None:
    if factor is None:
        return None
    return value if abs(factor - 1) <= 1e-9 else _rescale(value, factor, unit)


@dataclass(frozen=True)
class ColumnRestatement:
    """How one İş Yatırım column relates to the first-published figures (see the notes above).

    ``balance`` / ``flow`` multiply the column's balance-sheet / income-statement and
    cash-flow values back to the first-published basis: ``1.0`` = served as first
    published, ``None`` = re-expressed by an unknown factor. ``method``:
    ``not_restated`` · ``kap`` (fiscal year-end, KAP ÷ İş Yatırım) · ``own_ratio``
    (2OCF ÷ 3Z confirmed by the period's cross-company factor) · ``period_reference``
    (the cross-company factor; the own ratio is unusable or the comparative was
    re-presented) · ``own_ratio_unconfirmed`` (no cross-company factor for the period) ·
    ``unknown`` (re-expressed, factor unknown) · ``inconsistent`` (KAP and İş Yatırım
    differ in scope, not by a restatement).
    """

    period: str
    balance: float | None = 1.0
    flow: float | None = 1.0
    method: str = "not_restated"
    own_ratio: float | None = None
    reference: float | None = None
    represented: bool = False
    parent_income: float | None = None  # first-published parent share (2OCF) of a re-presented column

    @property
    def balance_restated(self) -> bool:
        return self.balance is None or abs(self.balance - 1) > _RESTATED_THRESHOLD

    @property
    def flows_restated(self) -> bool:
        return self.represented or self.flow is None or abs(self.flow - 1) > _RESTATED_THRESHOLD

    def stock_value(self, key: str, value: Any, unit: float = 1.0) -> float | None:
        number = to_number(value)
        if number is None or key == "paid_in_capital":  # nominal share capital is never re-expressed
            return number
        return _apply_factor(number, self.balance, unit)

    def flow_value(self, key: str, value: Any, unit: float = 1.0) -> float | None:
        if self.represented and key == "net_income_parent":
            return self.parent_income
        number = to_number(value)
        if number is None or (self.represented and key not in REPRESENTED_SAFE_FLOWS):
            return None
        return _apply_factor(number, self.flow, unit)

    def value(self, key: str, value: Any, unit: float = 1.0) -> float | None:
        """First-published value of canonical ``key`` (``None`` when it cannot be recovered)."""
        return self.flow_value(key, value, unit) if key in FLOW_KEYS else self.stock_value(key, value, unit)

    def source_tag(self, key: str) -> str:
        """``sources_json.keys`` entry of a value taken from this column."""
        if key in FLOW_KEYS and self.represented and key == "net_income_parent":
            return "isyatirim:2OCF"
        factor = self.flow if key in FLOW_KEYS else (1.0 if key == "paid_in_capital" else self.balance)
        return f"isyatirim*{factor:.6f}" if factor is not None and abs(factor - 1) > 1e-9 else "isyatirim"

    def line_value(self, statement: str, code: str, label_key: str, value: Any, unit: float = 1.0,
                   *, year_end: bool = False) -> float | None:
        """First-published value of an İş Yatırım statement line (views)."""
        number = to_number(value)
        if statement == "balance":
            if number is None or code == _PAID_IN_CAPITAL_CODE:
                return number
            return _apply_factor(number, self.balance, unit)
        if self.flow is None:
            return None  # the column cannot be converted: shown as a whole or not at all
        if statement == "cashflow" and not year_end and _FX_POSITION_LINE_RE.search(label_key):
            return number  # period-end position from the period's own report
        if self.represented:
            if statement == "income" and code == _PARENT_INCOME_CODE:
                return self.parent_income
            safe = _REPRESENTED_SAFE_INCOME_CODES if statement == "income" else _REPRESENTED_SAFE_CASHFLOW_CODES
            if code not in safe:
                return None
        if number is None:
            return None
        return _apply_factor(number, self.flow, unit)

    def as_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "balance": round(self.balance, 6) if self.balance is not None else None,
            "flow": round(self.flow, 6) if self.flow is not None else None,
            "method": self.method,
        }
        if self.own_ratio is not None:
            data["own_ratio"] = round(self.own_ratio, 6)
        if self.reference is not None:
            data["reference"] = round(self.reference, 6)
        if self.represented:
            data["represented"] = True
            data["parent_income"] = self.parent_income
        return data


def balance_sheet_period_profit(balance: Mapping[str, Any] | None) -> float | None:
    """İş Yatırım balance-sheet "Dönem Net Kar/Zararı" (2OCF) of one column."""
    for label, value in (balance or {}).items():
        if normalize_label(label) in _BALANCE_PERIOD_PROFIT_LABELS:
            return to_number(value)
    return None


def profit_ratio(balance_profit: Any, income_parent_profit: Any) -> float | None:
    """2OCF ÷ 3Z of one column (negative when the signs differ); ``None`` when either is missing or zero."""
    a, b = to_number(balance_profit), to_number(income_parent_profit)
    if a is None or b is None or a == 0 or b == 0:
        return None
    return a / b


def _before_ias29(period: str) -> bool:
    parsed = parse_period(period)
    return parsed is None or parsed < IAS29_FIRST_PERIOD


def restatement_reference(ratios_by_period: Mapping[str, Iterable[float | None]]) -> dict[str, float]:
    """Cross-company de-restatement factor per interim period (``{period: factor}``).

    ``ratios_by_period`` holds every company's 2OCF ÷ 3Z of the period. IAS 29
    re-expresses a comparative with the CPI ratio of its period, so the re-expressed
    companies agree to four decimals (2025/06: 17 of 18 at 0.7570; ALARK's re-presented
    comparative is the outlier). A factor is kept when at least three companies — and
    at least half of the re-expressed ones — agree within 0.2 %; it is their median.
    Periods before IAS 29 (historical-cost first publications) have no factor.
    """
    reference: dict[str, float] = {}
    for period, values in ratios_by_period.items():
        if _before_ias29(period):
            continue
        candidates = sorted(
            v for v in (to_number(x) for x in values)
            if v is not None and 0.2 <= v <= 5.0 and abs(v - 1) > _RESTATED_THRESHOLD
        )
        if len(candidates) < _REFERENCE_MIN_COMPANIES:
            continue
        middle = statistics.median(candidates)
        agreeing = [v for v in candidates if abs(v / middle - 1) <= _REFERENCE_AGREEMENT]
        if len(agreeing) >= _REFERENCE_MIN_COMPANIES and 2 * len(agreeing) >= len(candidates):
            reference[period] = statistics.median(agreeing)
    return reference


def restatement_reference_from_evidence(rows: Iterable[Sequence[Any]]) -> dict[str, float]:
    """:func:`restatement_reference` of stored ``(company, period, 2OCF, 3Z)`` rows (one per İş Yatırım column)."""
    by_period: dict[str, list[float | None]] = {}
    for _company, period, balance_profit, parent_profit in rows:
        by_period.setdefault(str(period), []).append(profit_ratio(balance_profit, parent_profit))
    return restatement_reference(by_period)


def _agrees(own: float | None, reference: float | None) -> bool:
    return own is not None and reference is not None and abs(own / reference - 1) <= _OWN_RATIO_TOLERANCE


def _plausible_own_ratio(period: str, own: float | None) -> bool:
    low, high = _PLAUSIBLE_OWN_RATIO
    return own is not None and low <= own <= high and not _before_ias29(period)


def classify_isyatirim_columns(
    periods: Iterable[str],
    *,
    evidence: Mapping[str, tuple[float | None, float | None]],
    year_end_factors: Mapping[str, Mapping[str, float | None]] | None = None,
    fiscal_year_end_month: int = 12,
    reference: Mapping[str, float] | None = None,
) -> dict[str, ColumnRestatement]:
    """:class:`ColumnRestatement` of every İş Yatırım period of one company.

    ``evidence``: ``{period: (2OCF, 3Z)}``; ``year_end_factors``: KAP ÷ İş Yatırım of the
    fiscal year-ends both sources cover (``{"balance", "flow"}``, ``None`` = inconsistent);
    ``reference``: :func:`restatement_reference`.

    Fiscal year-ends follow the KAP factor; without one they are unknown when any
    KAP-measured year-end was re-expressed (İş Yatırım re-expresses year-end columns even
    for companies that do not apply IAS 29 in their interim comparatives, e.g. THYAO).
    Interim comparatives are re-expressed only for companies whose interim evidence says
    so: among the columns whose next-year report is already in the table (and that were
    published under IAS 29), more own ratios confirmed by the reference (or, without one,
    plausible) than ratios of 1. An interim column P of such a company is expected to be
    re-expressed once the report for P + 12 months is in the table.
    """
    fy = int(fiscal_year_end_month or 12)
    ordered = sort_periods_desc(p for p in periods if parse_period(p) is not None)
    if not ordered:
        return {}
    latest = parse_period(ordered[0])
    assert latest is not None
    ref = dict(reference or {})
    ratios = {p: profit_ratio(*evidence.get(p, (None, None))) for p in ordered}
    year_ends = dict(year_end_factors or {})
    measured = [float(b) for f in year_ends.values() if (b := f.get("balance")) is not None]
    year_end_restating = any(abs(f - 1) > _RESTATED_THRESHOLD for f in measured)

    def compared_next_year(period: str) -> bool:
        parsed = parse_period(period)
        return parsed is not None and shift_months(parsed[0], parsed[1], 12) <= latest

    eligible = [p for p in ordered if not _is_year_end(p, fy) and compared_next_year(p) and not _before_ias29(p)]
    restated_votes = sum(
        1 for p in eligible
        if (_agrees(ratios[p], ref.get(p)) if p in ref else _plausible_own_ratio(p, ratios[p]))
        and abs((ratios[p] or 1.0) - 1) > _RESTATED_THRESHOLD
    )
    plain_votes = sum(1 for p in eligible if (r := ratios[p]) is not None and abs(r - 1) <= _RESTATED_THRESHOLD)
    restating = restated_votes > plain_votes if (restated_votes or plain_votes) else year_end_restating

    result: dict[str, ColumnRestatement] = {}
    for period in ordered:
        own, ref_factor = ratios[period], ref.get(period)
        if _is_year_end(period, fy):
            factors = year_ends.get(period)
            if factors is not None and factors.get("balance") is not None:
                balance = float(factors["balance"])  # type: ignore[arg-type]
                flow = float(factors.get("flow") or balance)
                restated = abs(balance - 1) > _RESTATED_THRESHOLD
                result[period] = ColumnRestatement(
                    period, balance=balance, flow=flow, method="kap" if restated else "not_restated", own_ratio=own
                )
            elif factors is not None:
                result[period] = ColumnRestatement(period, balance=None, flow=None, method="inconsistent", own_ratio=own)
            elif year_end_restating or restating:
                result[period] = ColumnRestatement(period, balance=None, flow=None, method="unknown", own_ratio=own)
            else:
                result[period] = ColumnRestatement(period, own_ratio=own)
            continue
        expected = restating and compared_next_year(period)
        if own is not None and abs(own - 1) <= _RESTATED_THRESHOLD:
            column = ColumnRestatement(period, own_ratio=own, reference=ref_factor)
        elif _agrees(own, ref_factor):
            column = ColumnRestatement(period, flow=own, method="own_ratio", own_ratio=own, reference=ref_factor)
        elif not expected:
            column = ColumnRestatement(period, own_ratio=own, reference=ref_factor)
        elif ref_factor is not None:
            represented = own is not None  # net income moved beyond the index ratio
            column = ColumnRestatement(
                period, flow=ref_factor, method="period_reference", own_ratio=own, reference=ref_factor,
                represented=represented, parent_income=evidence[period][0] if represented else None,
            )
        elif _plausible_own_ratio(period, own):
            column = ColumnRestatement(period, flow=own, method="own_ratio_unconfirmed", own_ratio=own)
        else:
            column = ColumnRestatement(period, flow=None, method="unknown", own_ratio=own)
        result[period] = column
    return result


@dataclass
class CanonicalFacts:
    """Result of :func:`build_canonical_facts` (plain data; ``columns`` via :meth:`ColumnRestatement.as_dict`)."""

    template: str
    fiscal_year_end_month: int = 12
    items: dict[str, dict[str, float | None]] = field(default_factory=dict)
    sources: dict[str, dict[str, Any]] = field(default_factory=dict)
    factors: dict[str, dict[str, float | None]] = field(default_factory=dict)
    isyatirim_scope: str = "absent"  # match | mismatch | unknown | absent
    key_checks: dict[str, dict[str, int]] = field(default_factory=dict)
    rejected_keys: list[str] = field(default_factory=list)
    skipped_periods: dict[str, str] = field(default_factory=dict)
    #: period → factor of its re-expressed statements (year-end: all; interim: income + cash flow)
    restated_periods: dict[str, float] = field(default_factory=dict)
    columns: dict[str, ColumnRestatement] = field(default_factory=dict)
    #: period → why some of its İş Yatırım flows could not be converted (kept as missing)
    partial_periods: dict[str, str] = field(default_factory=dict)

    def statement_restatements(self) -> dict[str, dict[str, tuple[bool, float | None]]]:
        """``{period: {statement_type: (restated, restatement_factor)}}`` for the İş Yatırım rows.

        Only statements that are re-expressed are listed; the factor is ``None`` when unknown.
        """
        if self.isyatirim_scope == "mismatch":
            return {}
        result: dict[str, dict[str, tuple[bool, float | None]]] = {}
        for period, column in self.columns.items():
            if column.method in ("not_restated", "inconsistent"):
                continue
            flows = (True, column.flow)
            if _is_year_end(period, self.fiscal_year_end_month):
                if column.method == "kap" and self.isyatirim_scope != "match":
                    continue
                result[period] = {"balance_sheet": (True, column.balance), "income_stmt": flows, "cash_flow": flows}
            else:
                result[period] = {"income_stmt": flows, "cash_flow": flows}
        return result

    def column_summary(self) -> dict[str, dict[str, Any]]:
        """Re-expressed (or unknown) İş Yatırım columns, newest first — manifests and audit trails."""
        return {p: self.columns[p].as_dict() for p in sort_periods_desc(self.columns)
                if self.columns[p].method != "not_restated"}


def _is_year_end(period: str, fiscal_year_end_month: int) -> bool:
    parsed = parse_period(period)
    return parsed is not None and months_into_fiscal_year(parsed[1], fiscal_year_end_month) == 12


def _factor_for(key: str, factors: Mapping[str, float | None]) -> float:
    if key == "paid_in_capital":  # nominal capital is never re-expressed
        return 1.0
    value = factors.get("flow") if key in FLOW_KEYS else factors.get("balance")
    return float(value) if value is not None else 1.0


_STATEMENT_GROUPS: tuple[tuple[str, ...], ...] = (
    tuple(STOCK_KEYS),
    tuple(k for k in FLOW_KEYS if k not in CASH_FLOW_KEYS),
    tuple(k for k in FLOW_KEYS if k in CASH_FLOW_KEYS),
)


def _without_placeholder_zeros(items: dict[str, float | None]) -> dict[str, float | None]:
    """İş Yatırım fills periods a company did not report (before its listing) with zeros.

    A statement whose every canonical item is 0 / missing — or a balance sheet
    without total assets — was not reported: its items become ``None`` (missing
    data is never ``0``).
    """
    for group in _STATEMENT_GROUPS:
        values = [items.get(k) for k in group]
        empty = all(not v for v in values)
        if group is _STATEMENT_GROUPS[0] and not items.get("total_assets"):
            empty = True
        if empty:
            for key in group:
                items[key] = None
    return items


def _canonical_maps(statements: Mapping[str, Mapping[str, Mapping[str, Any]]]) -> dict[str, dict[str, float | None]]:
    return {
        period: _without_placeholder_zeros(
            canonical_financial_items(balance=maps.get("balance"), income=maps.get("income"), cashflow=maps.get("cashflow"))
        )
        for period, maps in statements.items()
        if parse_period(period) is not None
    }


def build_canonical_facts(
    kap_statements: Mapping[str, Mapping[str, Mapping[str, Any]]],
    isy_statements: Mapping[str, Mapping[str, Mapping[str, Any]]],
    *,
    template: str = "industrial",
    fiscal_year_end_month: int = 12,
    kap_units: Mapping[str, float] | None = None,
    reference: Mapping[str, float] | None = None,
) -> CanonicalFacts:
    """Canonical items per period on the first-published (KAP) basis.

    ``*_statements`` are ``{period: {"balance"|"income"|"cashflow": {label: value}}}``
    (KAP: every stored summary period; İş Yatırım: its values as served, IAS 29 columns
    re-expressed — see :class:`ColumnRestatement`). ``reference`` is the cross-company
    de-restatement factor per interim period (:func:`restatement_reference`).

    1. For every period both sources cover, KAP ÷ İş Yatırım is measured on total assets
       (balance) and revenue / net income (flows). Year-end factors that disagree by more
       than 1 % mean a different scope (banks and insurers: İş Yatırım serves solo
       figures) → no factor; so does an interim balance factor away from 1 (an interim
       balance sheet is never re-expressed).
    2. Every İş Yatırım column is classified (:func:`classify_isyatirim_columns`):
       year-ends by the KAP factor, interims by 2OCF ÷ 3Z and the cross-company factor.
    3. Every canonical key is compared on the two most recent periods with a factor; a
       key whose İş Yatırım definition differs (holding "esas faaliyet kârı" with
       equity-method income) is never taken from İş Yatırım. Total equity and net income
       decide whether the scope matches at all.
    4. KAP periods keep KAP values; missing keys (cash flow, D&A, cash, debt) come from
       İş Yatırım converted to the first-published basis. Periods only İş Yatırım has
       (interim quarters) are converted the same way when the scope matches (or is
       unknown): flows of a column re-expressed by an unknown factor stay missing
       (``partial_periods``) and re-expressed fiscal year-ends without a KAP counterpart
       are skipped (first-published value unknown).
    """
    fy = int(fiscal_year_end_month or 12)
    kap_items = _canonical_maps(kap_statements)
    isy_items = _canonical_maps(isy_statements)
    units = kap_units or {}
    result = CanonicalFacts(template=template, fiscal_year_end_month=fy)

    overlap = sort_periods_desc(set(kap_items) & set(isy_items))
    measured: dict[str, dict[str, float | None]] = {}
    for period in overlap:
        k, i = kap_items[period], isy_items[period]
        measured[period] = {
            "balance": restatement_factor(k.get("total_assets"), i.get("total_assets")),
            "flow": restatement_factor(k.get("revenue"), i.get("revenue"))
            or restatement_factor(k.get("net_income"), i.get("net_income")),
        }
    year_end_factors: dict[str, dict[str, float | None]] = {}
    for period in overlap:
        if not _is_year_end(period, fy):
            continue
        balance, flow = measured[period]["balance"], measured[period]["flow"]
        if balance is not None and flow is not None and abs(balance / flow - 1) > _FACTOR_CONSISTENCY:
            balance = flow = None  # inconsistent → different scope/definitions; do not rescale
        year_end_factors[period] = {"balance": balance or flow, "flow": flow or balance}

    evidence = {
        period: (
            balance_sheet_period_profit((isy_statements.get(period) or {}).get("balance")),
            to_number(items.get("net_income_parent")),
        )
        for period, items in isy_items.items()
    }
    columns = classify_isyatirim_columns(
        isy_items, evidence=evidence, year_end_factors=year_end_factors, fiscal_year_end_month=fy, reference=reference
    )
    result.columns = columns

    for period in overlap:
        if _is_year_end(period, fy):
            result.factors[period] = year_end_factors[period]
            continue
        balance = measured[period]["balance"]
        if balance is not None and abs(balance - 1) > _FACTOR_CONSISTENCY:
            balance = None  # an interim balance sheet is never re-expressed → different scope
        result.factors[period] = {"balance": balance, "flow": columns[period].flow if balance is not None else None}

    checked = [p for p in overlap if result.factors[p]["balance"] is not None][:2]
    for key in (*FLOW_KEYS, *STOCK_KEYS):
        compared = mismatched = 0
        for period in checked:
            kap_value = to_number(kap_items[period].get(key))
            expected = columns[period].value(key, isy_items[period].get(key))
            if kap_value is None or expected is None:
                continue
            compared += 1
            unit = float(units.get(period) or 1.0)
            if abs(kap_value - expected) > max(abs(kap_value) * _FACT_TOLERANCE, 1.5 * unit):
                mismatched += 1
        result.key_checks[key] = {"compared": compared, "mismatched": mismatched}

    if not isy_items:
        scope = "absent"
    elif not overlap:
        scope = "unknown"
    elif not checked:
        scope = "mismatch"
    else:
        anchors = [result.key_checks[k] for k in _SCOPE_ANCHORS if result.key_checks[k]["compared"]]
        scope = "match" if anchors and all(a["mismatched"] == 0 for a in anchors) else "mismatch"
    if scope == "unknown" and template in FINANCIAL_TEMPLATES:
        scope = "mismatch"  # İş Yatırım's financial-sector tables are solo; KAP is consolidated
    result.isyatirim_scope = scope

    rejected = {k for k, check in result.key_checks.items() if check["mismatched"]}
    if scope == "mismatch":
        rejected = {*FLOW_KEYS, *STOCK_KEYS}
    result.rejected_keys = sorted(rejected)
    if scope != "mismatch":
        for period, column in columns.items():
            if _is_year_end(period, fy):
                if scope == "match" and column.method == "kap" and column.balance is not None:
                    result.restated_periods[period] = column.balance
            elif column.flows_restated and column.flow is not None:
                result.restated_periods[period] = column.flow

    for period in sort_periods_desc([*kap_items, *isy_items]):
        period_column = columns.get(period)
        row: dict[str, float | None]
        keys: dict[str, str]
        if period in kap_items:
            row = dict(kap_items[period])
            keys = {k: "kap" for k, v in row.items() if v is not None}
            period_factor = result.factors.get(period)
            if scope == "match" and period_column is not None and period_factor and period_factor["balance"] is not None:
                unit = float(units.get(period) or 1.0)
                for key in (*FLOW_KEYS, *STOCK_KEYS):
                    isy_value = to_number(isy_items[period].get(key))
                    if row.get(key) is not None or key in rejected or isy_value is None:
                        continue
                    value = period_column.value(key, isy_value, unit)
                    if value is not None:
                        row[key] = value
                        keys[key] = period_column.source_tag(key)
        elif scope == "mismatch":
            result.skipped_periods[period] = "isyatirim_scope_mismatch"
            continue
        elif period_column is None or (_is_year_end(period, fy) and (period_column.method != "not_restated" or scope != "match")):
            result.skipped_periods[period] = (
                "isyatirim_year_end_restated"
                if period_column is not None and period_column.method == "unknown"
                else "isyatirim_restatement_unknown"
            )
            continue
        else:
            row, keys = {}, {}
            for key, raw in isy_items[period].items():
                value = None if key in rejected else period_column.value(key, raw)
                row[key] = value
                if value is not None:
                    keys[key] = period_column.source_tag(key)
            if period_column.flow is None:
                result.partial_periods[period] = "isyatirim_flows_restated_factor_unknown"
            elif period_column.represented:
                result.partial_periods[period] = "isyatirim_comparative_represented"
        if not any(v is not None for v in row.values()):
            continue
        result.items[period] = row
        result.sources[period] = _fact_sources(keys, result.factors.get(period), scope, period_column)
    return result


def _fact_sources(
    keys: Mapping[str, str],
    factor: Mapping[str, float | None] | None,
    scope: str,
    column: ColumnRestatement | None = None,
) -> dict[str, Any]:
    """``sources_json``: statement-level summary + the source of every key."""
    by_statement: dict[str, set[str]] = {}
    for key, source in keys.items():
        by_statement.setdefault(fact_statement(key), set()).add(source.split("*", 1)[0].split(":", 1)[0])
    summary: dict[str, Any] = {statement: "+".join(sorted(s)) for statement, s in sorted(by_statement.items())}
    summary["keys"] = dict(sorted(keys.items()))
    if factor and factor.get("balance") is not None:
        summary["restatement_factor"] = {k: round(v, 6) for k, v in factor.items() if v is not None}
    if column is not None and column.method != "not_restated" and any(s.startswith("isyatirim") for s in keys.values()):
        summary["isyatirim_column"] = column.as_dict()
    summary["isyatirim_scope"] = scope
    return summary


def facts_from_sources(
    kap: Mapping[str, Any] | None,
    isy: Mapping[str, Any] | None,
    *,
    reference: Mapping[str, float] | None = None,
) -> CanonicalFacts:
    """:func:`build_canonical_facts` for freshly fetched (or reconstructed) adapter payloads."""
    return build_canonical_facts(
        kap_statement_maps(kap),
        isyatirim_statement_maps(isy) if isy else {},
        template=combined_template(kap, isy),
        fiscal_year_end_month=int((kap or {}).get("fiscal_year_end_month") or 12),
        kap_units=kap_period_units(kap),
        reference=reference,
    )


# ---------------------------------------------------------------------------
# financial_statements rows (store) ⇄ adapter payloads
# ---------------------------------------------------------------------------

SOURCE_KAP = "kap"
SOURCE_ISYATIRIM = "isyatirim"
_HASHED_FIELDS = (
    "source", "period", "statement_type", "fiscal_year_end_month", "template", "consolidation",
    "presentation_unit", "currency", "restated", "restatement_factor", "items_json", "source_url", "published_at",
)


def statement_content_hash(row: Mapping[str, Any]) -> str:
    """Stable SHA-256 of a statement row's content (skips unchanged rows on upsert)."""
    payload = {key: row.get(key) for key in _HASHED_FIELDS}
    text = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _finish_row(row: dict[str, Any]) -> dict[str, Any]:
    row["content_hash"] = statement_content_hash(row)
    return row


def _period_fields(period: str, fiscal_year_end_month: int) -> dict[str, Any] | None:
    parsed = parse_period(period)
    if parsed is None:
        return None
    months = months_into_fiscal_year(parsed[1], fiscal_year_end_month)
    return {
        "period": period_label(*parsed),
        "fiscal_year_end_month": fiscal_year_end_month,
        "months": months,
        "period_type": "annual" if months == 12 else "interim",
    }


def kap_statement_rows(kap: Mapping[str, Any]) -> list[dict[str, Any]]:
    """``financial_statements`` rows (``source="kap"``) of a parsed KAP summary.

    One row per period × {balance_sheet, income_stmt}; ``items_json`` keeps the
    page's line order (values in full TL, ``None`` for "-"). The presentation
    unit and consolidation are per column, as KAP shows them.
    """
    fy = int(kap.get("fiscal_year_end_month") or 12)
    template = str(kap.get("template") or "industrial")
    rows: list[dict[str, Any]] = []
    for section, records_key in (("balance", "balance_sheet"), ("income", "income_statement")):
        info_by_period = (kap.get("period_info") or {}).get(section) or {}
        records = kap.get(records_key) or []
        for period in kap.get("periods") or []:
            fields = _period_fields(period, fy)
            if fields is None:
                continue
            items = [
                {"code": None, "label": str(r["Item"]), "key": normalize_label(r["Item"]), "value": to_number(r.get(period))}
                for r in records
            ]
            if not any(item["value"] is not None for item in items):
                continue
            info = info_by_period.get(period) or {}
            rows.append(
                _finish_row(
                    {
                        "source": SOURCE_KAP,
                        "statement_type": STATEMENT_TYPE_BY_SECTION[section],
                        **fields,
                        "template": template,
                        "consolidation": info.get("consolidation"),
                        "presentation_unit": info.get("presentation_unit"),
                        "currency": info.get("currency") or "TRY",
                        "restated": False,
                        "restatement_factor": None,
                        "items_json": items,
                        "source_url": kap.get("source_url"),
                        "published_at": None,
                    }
                )
            )
    return rows


def _row_restatement(spec: Any, statement_type: str) -> tuple[bool, float | None]:
    if isinstance(spec, Mapping):
        flag, factor = spec.get(statement_type) or (False, None)
        return bool(flag), (float(factor) if factor is not None else None)
    if spec is not None:
        return True, float(spec)
    return False, None


def isyatirim_statement_rows(
    isy: Mapping[str, Any],
    *,
    ticker: str,
    fiscal_year_end_month: int = 12,
    restated: Mapping[str, Any] | None = None,
    consolidation: str | None = None,
) -> list[dict[str, Any]]:
    """``financial_statements`` rows (``source="isyatirim"``) of a MaliTablo table.

    Values are stored as İş Yatırım serves them. ``restated`` marks the periods İş
    Yatırım re-expressed (IAS 29): a factor applies to every statement of the column
    (a fiscal year-end); ``{statement_type: (restated, factor)}``
    (:meth:`CanonicalFacts.statement_restatements`) lists the re-expressed statements
    only — an interim comparative re-expresses its income statement and cash flow, not
    its balance sheet. The factor (KAP basis ÷ İş Yatırım, ``None`` when unknown) is
    stored as ``restatement_factor``.
    """
    template = str(isy.get("template") or ("industrial" if isy.get("group") == ISYATIRIM_GROUP_INDUSTRIAL else "financial"))
    url = ISYATIRIM_COMPANY_CARD_URL.format(ticker=ticker.upper())
    by_section: dict[str, list[Mapping[str, Any]]] = {}
    for item in isy.get("items") or []:
        section = item.get("statement")
        if section in STATEMENT_TYPE_BY_SECTION and item.get("code"):
            by_section.setdefault(str(section), []).append(item)
    rows: list[dict[str, Any]] = []
    for period in isy.get("periods") or []:
        fields = _period_fields(period, fiscal_year_end_month)
        if fields is None:
            continue
        spec = (restated or {}).get(period)
        for section in ("balance", "income", "cashflow"):
            section_items = by_section.get(section)
            if not section_items:
                continue
            flag, factor = _row_restatement(spec, STATEMENT_TYPE_BY_SECTION[section])
            items = [
                {
                    "code": str(item["code"]),
                    "label": str(item.get("label") or ""),
                    "key": normalize_label(item.get("label")),
                    "value": to_number((item.get("values") or {}).get(period)),
                }
                for item in section_items
            ]
            rows.append(
                _finish_row(
                    {
                        "source": SOURCE_ISYATIRIM,
                        "statement_type": STATEMENT_TYPE_BY_SECTION[section],
                        **fields,
                        "template": template,
                        "consolidation": consolidation,
                        "presentation_unit": "TL",
                        "currency": "TRY",
                        "restated": flag,
                        "restatement_factor": round(factor, 6) if factor is not None else None,
                        "items_json": items,
                        "source_url": url,
                        "published_at": None,
                    }
                )
            )
    return rows


def _row_value(row: Any, name: str) -> Any:
    return row.get(name) if isinstance(row, Mapping) else getattr(row, name, None)


def _ordered_union(sequences: Iterable[Sequence[Any]]) -> list[Any]:
    """Merge item sequences keeping the first sequence's order; new items go after their predecessor."""
    merged: list[Any] = []
    seen: set[Any] = set()
    for sequence in sequences:
        previous: Any = None
        for item in sequence:
            if item not in seen:
                merged.insert(merged.index(previous) + 1 if previous is not None else 0, item)
                seen.add(item)
            previous = item
    return merged


def _labelled_items(items: Sequence[Mapping[str, Any]]) -> list[tuple[tuple[str, int], Any]]:
    """``((label, occurrence), value)`` — duplicate labels stay separate lines."""
    counts: dict[str, int] = {}
    result = []
    for item in items:
        label = str(item.get("label") or "")
        counts[label] = counts.get(label, 0) + 1
        result.append(((label, counts[label]), item.get("value")))
    return result


def kap_summary_from_rows(rows: Iterable[Any], periods: Collection[str] | None = None) -> dict[str, Any] | None:
    """Rebuild the :func:`_get_kap_financial_summary` payload from stored ``kap`` rows.

    ``periods`` limits the columns (the latest fetch's periods, so a store-served
    view equals the live one); ``None`` uses every stored period.
    """
    selected = [
        r for r in rows
        if _row_value(r, "source") == SOURCE_KAP and (periods is None or _row_value(r, "period") in periods)
    ]
    if not selected:
        return None
    newest = max(selected, key=lambda r: parse_period(_row_value(r, "period")) or (0, 0))
    sections: dict[str, dict[str, Any]] = {}
    for section, records_key in (("balance", "balance_sheet"), ("income", "income_statement")):
        section_rows = sorted(
            (r for r in selected if SECTION_BY_STATEMENT_TYPE.get(_row_value(r, "statement_type")) == section),
            key=lambda r: parse_period(_row_value(r, "period")) or (0, 0),
            reverse=True,
        )
        values: dict[str, dict[tuple[str, int], Any]] = {}
        orders: list[list[tuple[str, int]]] = []
        info: dict[str, dict[str, Any]] = {}
        for r in section_rows:
            pairs = _labelled_items(_row_value(r, "items_json") or [])
            period = str(_row_value(r, "period"))
            values[period] = dict(pairs)
            orders.append([identity for identity, _ in pairs])
            unit_text = _row_value(r, "presentation_unit")
            multiplier, currency = _kap_unit(unit_text) if unit_text else (1.0, "TRY")
            info[period] = {
                "presentation_unit": unit_text,
                "multiplier": multiplier,
                "currency": _row_value(r, "currency") or currency,
                "consolidation": _row_value(r, "consolidation"),
            }
        section_periods = [str(_row_value(r, "period")) for r in section_rows]
        records = []
        for identity in _ordered_union(orders):
            record: dict[str, Any] = {"Item": identity[0]}
            for period in section_periods:
                record[period] = values[period].get(identity)
            if any(record[p] is not None for p in section_periods):
                records.append(record)
        sections[section] = {
            "records_key": records_key,
            "records": records,
            "periods": section_periods,
            "info": {p: info[p] for p in reversed(section_periods)},  # KAP page order (oldest first)
        }
    all_periods = sort_periods_desc([p for s in sections.values() for p in s["periods"]])
    currencies = {i["currency"] for i in sections["balance"]["info"].values()} or {"TRY"}
    return {
        "periods": all_periods,
        "fiscal_year_end_month": int(_row_value(newest, "fiscal_year_end_month") or 12),
        "template": _row_value(newest, "template") or "industrial",
        "unit": currencies.pop() if len(currencies) == 1 else "MIXED",
        "balance_sheet": sections["balance"]["records"],
        "income_statement": sections["income"]["records"],
        "period_info": {"balance": sections["balance"]["info"], "income": sections["income"]["info"]},
        "source_url": _row_value(newest, "source_url"),
    }


def isyatirim_table_from_rows(rows: Iterable[Any], periods: Collection[str] | None = None) -> dict[str, Any] | None:
    """Rebuild the :func:`fetch_isyatirim_financials` payload from stored ``isyatirim`` rows."""
    selected = [
        r for r in rows
        if _row_value(r, "source") == SOURCE_ISYATIRIM and (periods is None or _row_value(r, "period") in periods)
    ]
    if not selected:
        return None
    selected.sort(key=lambda r: parse_period(_row_value(r, "period")) or (0, 0), reverse=True)
    period_list = sort_periods_desc(str(_row_value(r, "period")) for r in selected)
    items: dict[str, dict[str, Any]] = {}
    order: dict[str, list[list[str]]] = {"balance": [], "income": [], "cashflow": []}
    for r in selected:
        section = SECTION_BY_STATEMENT_TYPE.get(_row_value(r, "statement_type"))
        if section is None:
            continue
        period = str(_row_value(r, "period"))
        codes = []
        for entry in _row_value(r, "items_json") or []:
            code = str(entry.get("code") or "")
            if not code:
                continue
            codes.append(code)
            item = items.setdefault(code, {"code": code, "label": entry.get("label"), "statement": section, "values": {}})
            item["values"][period] = to_number(entry.get("value"))
        order[section].append(codes)
    ordered: list[dict[str, Any]] = []
    for section in ("balance", "income", "cashflow"):
        for code in _ordered_union(order[section]):
            item = items[code]
            item["values"] = {p: item["values"].get(p) for p in period_list}
            ordered.append(item)
    template = str(_row_value(selected[0], "template") or "industrial")
    return {
        "group": ISYATIRIM_GROUP_INDUSTRIAL if template == "industrial" else ISYATIRIM_GROUP_FINANCIAL,
        "template": template,
        "periods": period_list,
        "items": ordered,
    }


def statement_maps_from_rows(rows: Iterable[Any], source: str) -> dict[str, dict[str, dict[str, Any]]]:
    """``{period: {section: {label: value}}}`` of every stored row of ``source`` (facts input)."""
    result: dict[str, dict[str, dict[str, Any]]] = {}
    for r in rows:
        if _row_value(r, "source") != source:
            continue
        section = SECTION_BY_STATEMENT_TYPE.get(_row_value(r, "statement_type"))
        if section is None:
            continue
        values: dict[str, Any] = {}
        for entry in _row_value(r, "items_json") or []:
            label = str(entry.get("label") or "")
            if label and label not in values:
                values[label] = entry.get("value")
        result.setdefault(str(_row_value(r, "period")), {})[section] = values
    return result


# ---------------------------------------------------------------------------
# Statement views (balance sheet / income statement / cash flow)
# ---------------------------------------------------------------------------

# KAP summary line → İş Yatırım item code(s), used to extend the official
# summary with interim quarters KAP's page does not show (industrial template).
_KAP_ROW_CODES: dict[str, tuple[str, ...]] = {
    "donen varliklar": ("1A",),
    "duran varliklar": ("1AK",),
    "toplam varliklar": ("1BL",),
    "varliklar": ("1BL",),
    "kisa vadeli yukumlulukler": ("2A",),
    "uzun vadeli yukumlulukler": ("2B",),
    "toplam yukumlulukler": ("2A", "2B"),
    "yukumlulukler": ("2A", "2B"),
    "ana ortakliga ait ozkaynaklar": ("2O",),
    "odenmis sermaye": ("2OA",),
    "kontrol gucu olmayan paylar": ("2ODA",),
    "toplam ozkaynaklar": ("2N",),
    "toplam kaynaklar": ("2ODB",),
    "hasilat": ("3C",),
    "satislarin maliyeti": ("3CA",),
    "ticari faaliyetlerden brut kar (zarar)": ("3CAB",),
    "finans sektoru faaliyetleri hasilati": ("3CAC",),
    "finans sektoru faaliyetleri maliyeti": ("3CAD",),
    "finans sektoru faaliyetlerinden brut kar (zarar)": ("3CAF",),
    "toplam hasilat": ("3C", "3CAC"),
    "brut kar (zarar)": ("3D",),
    "esas faaliyet kari (zarari)": ("3DF",),
    "finansman geliri (gideri) oncesi faaliyet kari (zarari)": ("3HACA",),
    "surdurulen faaliyetler vergi oncesi kari (zarari)": ("3I",),
    "surdurulen faaliyetler donem kari (zarari)": ("3J",),
    "net donem kari (zarari)": ("3L",),
    "donem karinin (zararinin) dagilimi, kontrol gucu olmayan paylar": ("3LB",),
    "donem karinin (zararinin) dagilimi, ana ortaklik paylari": ("3Z",),
}


def _isy_values_by_code(isy: Mapping[str, Any]) -> dict[str, dict[str, float | None]]:
    return {str(item["code"]): dict(item.get("values") or {}) for item in isy.get("items", [])}


def _sum_codes(values_by_code: Mapping[str, Mapping[str, float | None]], codes: Sequence[str], period: str) -> float | None:
    total = 0.0
    for code in codes:
        value = to_number((values_by_code.get(code) or {}).get(period))
        if value is None:
            return None
        total += value
    return total


def _column_line(
    values_by_code: Mapping[str, Mapping[str, float | None]],
    codes: Sequence[str],
    period: str,
    column: ColumnRestatement | None,
    section: str,
) -> float | None:
    """A KAP summary line rebuilt from İş Yatırım codes, on the first-published basis."""
    if column is None:
        return _sum_codes(values_by_code, codes, period)
    statement = "balance" if section == "balance" else "income"
    if column.represented and statement == "income" and tuple(codes) == (_PARENT_INCOME_CODE,):
        return column.parent_income
    total = 0.0
    for code in codes:
        value = column.line_value(statement, code, "", (values_by_code.get(code) or {}).get(period))
        if value is None:
            return None
        total += value
    return total


def _supplement_rows(
    records: Sequence[Mapping[str, Any]],
    kap: Mapping[str, Any],
    isy: Mapping[str, Any],
    factors: Mapping[str, Mapping[str, float | None]],
    section: str,
    columns: Mapping[str, ColumnRestatement] | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """KAP rows extended with İş Yatırım interim periods KAP's summary omits.

    A row is extended only if its İş Yatırım mapping reproduces the KAP figure
    on every overlapping period (within rounding) — companies such as holdings
    define some subtotals differently, and mixing definitions across columns
    would be misleading. ``columns`` (:func:`classify_isyatirim_columns`) converts
    re-expressed (IAS 29) columns to the first-published basis; a column whose
    lines cannot be converted is left out. Returns ``(rows, added_periods)``.
    """
    kap_periods = set(kap.get("periods", []))
    extra = [p for p in isy.get("periods", []) if p not in kap_periods]
    if not extra:
        return [dict(r) for r in records], []
    values_by_code = _isy_values_by_code(isy)
    info = kap.get("period_info", {}).get(section, {})
    factor_kind = "balance" if section == "balance" else "flow"

    # Older comparatives are sometimes reclassified, so the check uses the two
    # most recent periods both sources cover.
    overlap = sort_periods_desc(kap_periods & set(isy.get("periods", [])))[:2]

    rows: list[dict[str, Any]] = []
    for record in records:
        codes = _KAP_ROW_CODES.get(normalize_label(record.get("Item")))
        verified = False
        if codes:
            verified = True
            compared = 0
            for period in overlap:
                kap_value = to_number(record.get(period))
                isy_value = _sum_codes(values_by_code, codes, period)
                if kap_value is None or isy_value is None:
                    continue
                factor = (factors.get(period) or {}).get(factor_kind)
                if normalize_label(record.get("Item")) != "odenmis sermaye" and factor is not None:
                    isy_value *= factor
                unit = float((info.get(period) or {}).get("multiplier") or 1.0)
                if abs(kap_value - isy_value) > max(abs(kap_value) * 0.005, 1.5 * unit):
                    verified = False
                    break
                compared += 1
            verified = verified and compared > 0
        row: dict[str, Any] = dict(record)
        for period in extra:
            row[period] = (
                _column_line(values_by_code, codes, period, (columns or {}).get(period), section)
                if verified and codes else None
            )
        rows.append(row)
    added = [p for p in extra if any(row.get(p) is not None for row in rows)]
    ordered_rows = []
    for row in rows:
        ordered = {"Item": row["Item"]}
        for period in sort_periods_desc([k for k in row if k != "Item" and (k in added or k not in extra)]):
            ordered[period] = row[period]
        ordered_rows.append(ordered)
    return ordered_rows, added


def _period_info(
    periods: Sequence[str],
    fiscal_year_end_month: int,
    sources: Mapping[str, str],
    kap_info: Mapping[str, Mapping[str, Any]] | None = None,
    factors: Mapping[str, Mapping[str, float | None]] | None = None,
    factor_kind: str = "balance",
) -> list[dict[str, Any]]:
    result = []
    for period in periods:
        parsed = parse_period(period)
        months = months_into_fiscal_year(parsed[1], fiscal_year_end_month) if parsed else None
        meta = (kap_info or {}).get(period, {})
        factor = ((factors or {}).get(period) or {}).get(factor_kind) if sources.get(period) == _SOURCE_ISY else None
        result.append(
            {
                "period": period,
                "fiscal_year": (shift_months(parsed[0], parsed[1], 12 - months)[0] if parsed and months else None),
                "months": months,
                "period_type": "annual" if months == 12 else "interim",
                "source": sources.get(period),
                "consolidation": meta.get("consolidation"),
                "presentation_unit": meta.get("presentation_unit"),
                "restatement_factor": round(factor, 6) if factor is not None and abs(factor - 1) > 1e-6 else None,
            }
        )
    return result


# Cash-flow memo lines that are balances, not flows (matched on ``normalize_label``):
# end-of-period cash and the foreign-currency position lines ("Dönem Sonu Nakit",
# "Net Yabancı Para Pozisyonu", "Net YPP (Hedge Dahil)", ...) and the opening cash
# ("Dönem Başı Nakit Değerler"). Differencing them per quarter is meaningless.
_CLOSING_BALANCE_LINE_RE = re.compile(r"\bdonem sonu|\bpozisyon|\bypp\b")
_OPENING_BALANCE_LINE_RE = re.compile(r"\bdonem basi")
_CASH_LINE_RE = re.compile(r"\bnakit\b")


def _opening_balance_values(
    values: Mapping[str, Any],
    closing: Mapping[str, Any] | None,
    fiscal_year_end_month: int,
) -> dict[str, float | None]:
    """Quarter opening balance: the fiscal-year opening for Q1, else the previous quarter's closing."""
    result: dict[str, float | None] = {}
    for period, raw in values.items():
        parsed = parse_period(period)
        if parsed is None:
            result[period] = None
        elif months_into_fiscal_year(parsed[1], fiscal_year_end_month) == 3:
            result[period] = to_number(raw)
        else:
            previous = period_label(*shift_months(parsed[0], parsed[1], -3))
            result[period] = to_number((closing or {}).get(previous))
    return result


def _discrete_rows(records: Sequence[Mapping[str, Any]], fiscal_year_end_month: int) -> list[dict[str, Any]]:
    """Single-quarter values; balance lines keep their period-end value (see above)."""
    keys = [normalize_label(record.get("Item")) for record in records]
    closing_cash = next(
        (
            record
            for record, key in zip(records, keys)
            if _CLOSING_BALANCE_LINE_RE.search(key) and _CASH_LINE_RE.search(key)
        ),
        None,
    )
    rows = []
    for record, key in zip(records, keys):
        values = {k: v for k, v in record.items() if k != "Item"}
        if _OPENING_BALANCE_LINE_RE.search(key):
            discrete = _opening_balance_values(values, closing_cash, fiscal_year_end_month)
        elif _CLOSING_BALANCE_LINE_RE.search(key):
            discrete = {period: to_number(value) for period, value in values.items()}
        else:
            discrete = discrete_quarter_values(values, fiscal_year_end_month)
        rows.append({"Item": record["Item"], **discrete})
    return rows


def _periods_of(records: Sequence[Mapping[str, Any]]) -> list[str]:
    periods: list[str] = []
    for record in records:
        periods.extend(k for k in record if k != "Item")
    return sort_periods_desc(periods)


_SALES_MEMO_CODES = ("4BC", "4BD")  # "Yurtiçi Satışlar" / "Yurtdışı Satışlar" footnote lines
_REVENUE_CODE = "3C"


def _implausible_sales_memo_periods(isy: Mapping[str, Any]) -> set[str]:
    """Periods whose domestic + foreign sales footnote does not add up to revenue.

    İş Yatırım occasionally serves these memo lines in the wrong unit (e.g.
    thousand TL in one column); such columns are blanked instead of shown.
    """
    values = _isy_values_by_code(isy)
    bad: set[str] = set()
    for period in isy.get("periods", []):
        revenue = to_number((values.get(_REVENUE_CODE) or {}).get(period))
        parts = [to_number((values.get(code) or {}).get(period)) for code in _SALES_MEMO_CODES]
        if revenue is None or revenue <= 0 or any(p is None for p in parts):
            continue
        total = sum(p for p in parts if p is not None)
        if total and not 0.5 <= total / revenue <= 1.5:
            bad.add(period)
    return bad


def _isy_rows(
    isy: Mapping[str, Any],
    statement: str,
    periods: Sequence[str],
    factors: Mapping[str, Mapping[str, float | None]],
    factor_kind: str,
    units: Mapping[str, float] | None = None,
    columns: Mapping[str, ColumnRestatement] | None = None,
    fiscal_year_end_month: int = 12,
) -> list[dict[str, Any]]:
    """İş Yatırım lines of one statement for ``periods``.

    A period in ``columns`` is converted line by line to the first-published basis
    (:meth:`ColumnRestatement.line_value`); otherwise ``factors[period][factor_kind]``
    (when given) scales every line.
    """
    bad_memo = _implausible_sales_memo_periods(isy) if statement == "cashflow" else set()
    year_ends = {p for p in periods if _is_year_end(p, fiscal_year_end_month)}
    rows = []
    for item in isy.get("items", []):
        if item.get("statement") != statement:
            continue
        values = item.get("values") or {}
        code = str(item.get("code") or "")
        label_key = normalize_label(item.get("label"))
        row: dict[str, Any] = {"Item": item["label"]}
        for period in periods:
            value = to_number(values.get(period))
            if code in _SALES_MEMO_CODES and period in bad_memo:
                value = None
            unit = (units or {}).get(period, 1.0)
            column = (columns or {}).get(period)
            if column is not None:
                value = column.line_value(statement, code, label_key, value, unit, year_end=period in year_ends)
            else:
                factor = (factors.get(period) or {}).get(factor_kind)
                if value is not None and factor is not None:
                    value = _rescale(value, factor, unit)
            row[period] = value
        if any(v not in (None, 0) for k, v in row.items() if k != "Item"):
            rows.append(row)
    return rows


def _column_factors(columns: Mapping[str, ColumnRestatement]) -> dict[str, dict[str, float | None]]:
    """``period_info`` factors of converted İş Yatırım columns."""
    return {p: {"balance": c.balance, "flow": c.flow} for p, c in columns.items()}


_NOTE_INTERIM_RESTATED = (
    "İş Yatırım'ın enflasyon muhasebesiyle (TMS 29) yeniden ifade ettiği önceki yıl ara dönem "
    "kolonları ilk açıklanan tutarlara çevrildi (bilançodaki dönem kârı ÷ gelir tablosundaki ana ortaklık payı)."
)
_NOTE_UNKNOWN_RESTATED = (
    "İlk açıklanan tutarı bilinmeyen yeniden ifade edilmiş İş Yatırım dönemleri gösterilmiyor: {periods}."
)
_NOTE_REPRESENTED = (
    "{periods}: şirket karşılaştırmalı dönemin net kârını yeniden sunmuş; ana ortaklık payı ilk açıklanan "
    "bilançodan, diğer net kâr kalemleri boş."
)


def _conversion_notes(
    columns: Mapping[str, ColumnRestatement],
    shown: Collection[str],
    candidates: Collection[str],
    fiscal_year_end_month: int,
    *,
    flows: bool,
) -> list[str]:
    """Notes about converted / omitted re-expressed İş Yatırım columns of a view."""
    notes: list[str] = []
    interim = [p for p in shown if p in columns and not _is_year_end(p, fiscal_year_end_month)]
    if flows and any(columns[p].flows_restated for p in interim):
        notes.append(_NOTE_INTERIM_RESTATED)
    represented = sort_periods_desc(p for p in interim if columns[p].represented)
    if flows and represented:
        notes.append(_NOTE_REPRESENTED.format(periods=", ".join(represented)))
    omitted = sort_periods_desc(p for p in candidates if p not in shown and p in columns
                                and (columns[p].flow is None or columns[p].balance is None))
    if omitted:
        notes.append(_NOTE_UNKNOWN_RESTATED.format(periods=", ".join(omitted)))
    return notes


def build_statement_view(
    ticker: str,
    kap: Mapping[str, Any] | None,
    isy: Mapping[str, Any] | None,
    *,
    quarterly: bool,
    section: str,
    reference: Mapping[str, float] | None = None,
) -> dict[str, Any]:
    """Balance sheet (``section="balance"``) / income statement (``"income"``) payload.

    Pure: the same payload whether ``kap``/``isy`` were just fetched or rebuilt
    from the store (:func:`kap_summary_from_rows`, :func:`isyatirim_table_from_rows`).
    İş Yatırım interim columns are shown on the first-published basis (IAS 29
    re-expressed comparatives converted per column; ``reference`` =
    :func:`restatement_reference`).
    """
    if kap is None and isy is None:
        raise MarketDataError(_MSG_STATEMENTS, status_code=503)
    fy_month = int((kap or {}).get("fiscal_year_end_month") or 12)
    flows = section == "income"
    kap_key = "balance_sheet" if section == "balance" else "income_statement"
    notes: list[str] = []
    columns: dict[str, ColumnRestatement] = {}

    if kap is not None:
        records = _filter_kap_periods(kap[kap_key], quarterly, fy_month)
        sources = {p: _SOURCE_KAP for p in _periods_of(records)}
        if quarterly and isy is not None and kap.get("template") == "industrial" and isy.get("group") == ISYATIRIM_GROUP_INDUSTRIAL:
            facts = facts_from_sources(kap, isy, reference=reference)
            columns = facts.columns
            records, added = _supplement_rows(records, kap, isy, facts.factors, section, columns)
            sources.update({p: _SOURCE_ISY for p in added})
            if added:
                notes.append("KAP özetinde bulunmayan ara dönemler İş Yatırım'dan (ilk açıklanan değerler) eklendi.")
            candidates = [p for p in isy.get("periods", []) if p not in kap.get("periods", [])]
            notes.extend(_conversion_notes(columns, added, candidates, fy_month, flows=flows))
        source = _SOURCE_KAP if all(s == _SOURCE_KAP for s in sources.values()) else f"{_SOURCE_KAP} + {_SOURCE_ISY}"
        source_url = kap.get("source_url")
        unit = kap.get("unit", "TRY")
        kap_info = kap.get("period_info", {}).get(section)
    else:
        assert isy is not None
        periods = [p for p in isy["periods"] if quarterly or (parse_period(p) or (0, 0))[1] == fy_month]
        if isy.get("group") == ISYATIRIM_GROUP_INDUSTRIAL:
            # Interim comparatives are converted from İş Yatırım's own columns; fiscal
            # year-ends need KAP's factor and stay as served (see the note).
            columns = {p: c for p, c in facts_from_sources(None, isy, reference=reference).columns.items()
                       if not _is_year_end(p, fy_month)}
        statement = "balance" if section == "balance" else "income"
        records = _isy_rows(isy, statement, periods, {}, "balance", None, columns, fy_month)
        shown = [p for p in periods if any(r.get(p) is not None for r in records)]
        records = [{"Item": r["Item"], **{p: r.get(p) for p in shown}} for r in records]
        sources = {p: _SOURCE_ISY for p in shown}
        source, source_url, unit, kap_info = _SOURCE_ISY, None, "TRY", None
        notes.append("KAP özeti alınamadı; İş Yatırım verisi gösteriliyor (yıl sonu kolonları enflasyona göre yeniden ifade edilmiş olabilir).")
        notes.extend(_conversion_notes(columns, shown, periods, fy_month, flows=flows))

    periods = _periods_of(records)
    payload: dict[str, Any] = {
        "ticker": ticker,
        "quarterly": quarterly,
        "source": source,
        "source_url": source_url,
        "as_of": periods[0] if periods else None,
        "unit": unit,
        "data": records,
        # add-only metadata
        "available": bool(records),
        "periods": periods,
        "period_info": _period_info(
            periods, fy_month, sources, kap_info, _column_factors(columns), "flow" if flows else "balance"
        ),
        "value_basis": "cumulative_ytd" if flows else "point_in_time",
        "fiscal_year_end_month": fy_month,
        "notes": notes,
    }
    if flows and quarterly:
        payload["discrete"] = _discrete_rows(records, fy_month)
    return payload


async def _statement_view(ticker: str, quarterly: bool, section: str) -> dict[str, Any]:
    kap, isy = await _load_statement_sources(ticker, isy_wait=_ISY_WAIT_STATEMENTS if quarterly else 0.0)
    return build_statement_view(ticker, kap, isy, quarterly=quarterly, section=section)


async def get_balance_sheet(ticker: str, quarterly: bool = False) -> dict:
    """Bilanço (TL, dönem sonu değerleri). ``quarterly=True`` ara dönemleri de içerir."""
    try:
        return await _statement_view(ticker, quarterly, "balance")
    except Exception as e:
        return _failure(e, _MSG_STATEMENTS, "fundamentals_balance_sheet_error", ticker, data=[])


async def get_income_statement(ticker: str, quarterly: bool = False) -> dict:
    """Gelir tablosu (TL, mali yıl başından kümülatif; ``discrete`` tek çeyrek değerleri)."""
    try:
        return await _statement_view(ticker, quarterly, "income")
    except Exception as e:
        return _failure(e, _MSG_STATEMENTS, "fundamentals_income_stmt_error", ticker, data=[])


def build_cashflow_view(
    ticker: str,
    kap: Mapping[str, Any] | None,
    isy: Mapping[str, Any] | None,
    *,
    quarterly: bool,
    reference: Mapping[str, float] | None = None,
) -> dict[str, Any]:
    """Cash-flow payload: İş Yatırım rows on KAP's first-published basis.

    Re-expressed (IAS 29) columns are converted per column — fiscal year-ends with
    KAP's factor, earlier-year interim comparatives with 2OCF ÷ 3Z / the period's
    cross-company factor (``reference``); columns re-expressed by an unknown factor
    are left out. Without KAP only the interim columns can be converted.
    """
    fy_month = int((kap or {}).get("fiscal_year_end_month") or 12)
    base: dict[str, Any] = {
        "ticker": ticker,
        "quarterly": quarterly,
        "source": f"{_SOURCE_ISY} (borsapy)",
        "unit": "TRY",
        "value_basis": "cumulative_ytd",
        "fiscal_year_end_month": fy_month,
    }
    has_cashflow = isy is not None and any(i.get("statement") == "cashflow" for i in isy.get("items", []))
    if isy is None or not has_cashflow:
        return {**base, "as_of": None, "data": [], "available": False, "periods": [], "period_info": [],
                "notes": ["Bu şirket için nakit akış tablosu yayınlanmıyor (ör. bankalar)."]}

    candidates = [p for p in isy["periods"] if quarterly or (parse_period(p) or (0, 0))[1] == fy_month]
    columns: dict[str, ColumnRestatement] = {}
    if isy.get("group") == ISYATIRIM_GROUP_INDUSTRIAL and (kap is None or kap.get("template") == "industrial"):
        columns = facts_from_sources(kap, isy, reference=reference).columns
        if kap is None:  # fiscal year-ends need KAP's factor: shown as served (see the notes)
            columns = {p: c for p, c in columns.items() if not _is_year_end(p, fy_month)}
    units = {p: _period_unit(kap, p, "income") for p in isy["periods"]} if kap else {}
    all_rows = _isy_rows(isy, "cashflow", isy["periods"], {}, "flow", units, columns, fy_month)
    convertible = [p for p in candidates if any(r.get(p) is not None for r in all_rows)]
    periods = convertible[:8] if quarterly else convertible
    rows = [{"Item": r["Item"], **{p: r.get(p) for p in periods}} for r in all_rows
            if any(r.get(p) not in (None, 0) for p in periods)]
    periods = _periods_of(rows)
    notes: list[str] = []
    if any(_is_year_end(p, fy_month) and p in columns and columns[p].flows_restated for p in periods):
        notes.append("Yıl sonu kolonları KAP'ta ilk açıklanan tutarlara çevrildi (enflasyon düzeltmesi katsayısı).")
    notes.extend(_conversion_notes(columns, periods, candidates[:8] if quarterly else candidates, fy_month, flows=True))
    payload = {
        **base,
        "as_of": periods[0] if periods else None,
        "data": rows,
        "available": bool(rows),
        "periods": periods,
        "period_info": _period_info(
            periods, fy_month, {p: _SOURCE_ISY for p in periods}, None, _column_factors(columns), "flow"
        ),
        "notes": notes,
    }
    if quarterly:
        discrete = _discrete_rows(all_rows, fy_month)
        payload["discrete"] = [{"Item": r["Item"], **{p: r.get(p) for p in periods}} for r in discrete]
    return payload


async def get_cashflow(ticker: str, quarterly: bool = False) -> dict:
    """Nakit akış tablosu (İş Yatırım; TL, kümülatif; bankalar için mevcut değil)."""
    try:
        kap, isy = await _load_statement_sources(ticker, isy_wait=_ISY_WAIT_RATIOS)
        return build_cashflow_view(ticker, kap, isy, quarterly=quarterly)
    except Exception as e:
        return _failure(e, _MSG_CASHFLOW, "fundamentals_cashflow_error", ticker, data=[])



# ---------------------------------------------------------------------------
# Live ratios (TTM flows + latest balance sheet + live market cap)
# ---------------------------------------------------------------------------

def _latest_ratio_period(items_by_period: Mapping[str, Mapping[str, Any]]) -> str | None:
    for period in sort_periods_desc(items_by_period):
        items = items_by_period[period]
        if to_number(items.get("total_assets")) is not None and to_number(items.get("net_income")) is not None:
            return period
    return None


def _ratio_shares(paid_in_capital: float | None, snapshot_shares: float | None) -> tuple[float | None, str | None]:
    """Shares outstanding: paid-in capital (1 TL nominal) unless a later capital change is evident."""
    capital = to_number(paid_in_capital)
    snap = to_number(snapshot_shares)
    if capital is not None and capital > 0:
        if snap is not None and snap > 0 and abs(capital / snap - 1) > 0.15:
            return snap, "market_data"
        return capital, "paid_in_capital"
    if snap is not None and snap > 0:
        return snap, "market_data"
    return None, None


def compute_live_ratios(
    items_by_period: Mapping[str, Mapping[str, Any]],
    *,
    fiscal_year_end_month: int = 12,
    template: str = "industrial",
    price: float | None = None,
    snapshot_shares: float | None = None,
) -> dict[str, Any] | None:
    """Pure core of ``/live-ratios``: pick the latest period, build TTM inputs, compute ratios.

    Returns ``None`` when no period has both a balance sheet and a result.
    """
    latest = _latest_ratio_period(items_by_period)
    if latest is None:
        return None
    basis = "ttm"
    period = latest
    try:
        current, previous = build_ratio_inputs(items_by_period, latest, fiscal_year_end_month)
    except ValueError:
        # Interim period without the prior-year comparatives → latest fiscal year instead.
        fy_periods = [
            p for p in sort_periods_desc(items_by_period)
            if (parsed := parse_period(p)) and parsed[1] == fiscal_year_end_month
            and to_number(items_by_period[p].get("total_assets")) is not None
        ]
        if not fy_periods:
            return None
        period = fy_periods[0]
        current, previous = build_ratio_inputs(items_by_period, period, fiscal_year_end_month)
        basis = "annual"
    if ttm_components(period, fiscal_year_end_month) is None:
        basis = "annual"

    # Valuation always uses the latest balance sheet (equity, net debt, share capital),
    # also when the flows fall back to the last fiscal year.
    latest_stocks = {key: to_number(items_by_period[latest].get(key)) for key in STOCK_KEYS}
    shares, shares_source = _ratio_shares(latest_stocks.get("paid_in_capital"), snapshot_shares)
    last = to_number(price)
    market_cap = last * shares if last is not None and last > 0 and shares is not None else None
    financial = template in FINANCIAL_TEMPLATES
    ratios = compute_financial_ratios(
        current, previous=previous, market_cap=market_cap, is_bank=financial, valuation_stocks=latest_stocks
    )
    amounts = derive_financial_amounts({**current, **latest_stocks}, market_cap, is_bank=financial)
    ttm_quarters = trailing_quarters(period)
    return {
        "as_of": period,
        "basis": basis,
        "balance_sheet_as_of": latest,
        "ttm_quarters": ttm_quarters,
        "template": template,
        "ratios": ratios,
        "ttm": {
            key: current.get(key)
            for key in ("revenue", "gross_profit", "operating_profit", "depreciation_amortization",
                        "net_income", "net_income_parent")
        } | {"ebitda": amounts["ebitda"]},
        "valuation": {
            "price": last,
            "shares_outstanding": shares,
            "shares_source": shares_source,
            "market_cap": round(market_cap, 2) if market_cap is not None else None,
            "net_debt": amounts["net_debt"],
            "enterprise_value": amounts["enterprise_value"],
        },
    }


_TEMPLATE_NOTES = {
    "bank": "Banka: brüt/FAVÖK marjı, cari oran ve borç çarpanları anlamlı değildir.",
    "insurance": "Sigorta: brüt/FAVÖK marjı, cari oran ve borç çarpanları anlamlı değildir.",
    "financial": "Finansal kuruluş: brüt/FAVÖK marjı, cari oran ve borç çarpanları anlamlı değildir.",
}


def build_live_ratios_view(
    ticker: str,
    items_by_period: Mapping[str, Mapping[str, Any]],
    *,
    template: str,
    fiscal_year_end_month: int,
    snapshot: Mapping[str, Any],
    sources: Sequence[str],
) -> dict[str, Any]:
    """``/live-ratios`` payload from canonical facts + a market snapshot (``last_price``, ``shares``)."""
    result = compute_live_ratios(
        items_by_period,
        fiscal_year_end_month=fiscal_year_end_month,
        template=template,
        price=snapshot.get("last_price"),
        snapshot_shares=snapshot.get("shares"),
    )
    if result is None or not any(v is not None for v in result["ratios"].values()):
        return {"ticker": ticker, "ratios": None, "available": False}
    template_note = _TEMPLATE_NOTES.get(template)
    return {
        "ticker": ticker,
        "source": " + ".join(sources) + " finansal tabloları; TradingView fiyatı",
        **result,
        "available": True,
        "notes": [
            "Akım kalemleri son 12 ay (TTM = son ara dönem + önceki yıl − önceki yılın aynı ara dönemi); "
            "stok kalemleri son bilanço; büyüme bir önceki yılın aynı TTM dönemine göre.",
            "FAVÖK = esas faaliyet kârı + amortisman ve itfa payları (nakit akış tablosundan).",
        ]
        + ([template_note] if template_note else []),
    }


async def live_market_snapshot(ticker: str) -> dict[str, Any]:
    """Live price snapshot for ratios (``{}`` when unavailable — multiples are then ``None``)."""
    try:
        return await _get_market_snapshot(ticker)
    except Exception as e:
        logger.warning("live_ratios_snapshot_failed", ticker=ticker, error=f"{type(e).__name__}: {e}")
        return {}


async def get_live_financial_ratios(ticker: str) -> dict:
    """Oranlar: akım kalemleri TTM (son 4 çeyrek), stok kalemleri son bilanço, piyasa değeri canlı fiyat × pay adedi."""
    try:
        kap, isy = await _load_statement_sources(ticker, isy_wait=_ISY_WAIT_RATIOS)
        facts = facts_from_sources(kap, isy)
        snapshot = await live_market_snapshot(ticker)
        sources = [s for s, present in ((_SOURCE_KAP, kap), (_SOURCE_ISY, isy)) if present]
        return build_live_ratios_view(
            ticker,
            facts.items,
            template=facts.template,
            fiscal_year_end_month=facts.fiscal_year_end_month,
            snapshot=snapshot,
            sources=sources,
        )
    except Exception as e:
        return _failure(e, _MSG_RATIOS, "live_ratios_error", ticker, ratios=None)


