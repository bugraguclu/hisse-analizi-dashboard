"""Finansal tablolar (KAP özeti + İş Yatırım) ve canlı oranlar — bkz. ``src.adapters.fundamentals``.

Kaynaklar:

- **KAP "Şirket Finansal Bilgileri" özeti** — resmi, ilk açıklandığı haliyle
  bilanço ve gelir tablosu (son 3 yıl sonu + en son ara dönem). Birincil kaynak.
- **İş Yatırım MaliTablo** — ara çeyrekler, nakit akışı, amortisman (FAVÖK),
  nakit ve finansal borç. IAS 29 uygulayan şirketlerde yıl sonu kolonlarını
  güncel satın alma gücüne göre yeniden ifade eder; KAP ile örtüşen dönemlerde
  katsayıyla ilk açıklanan değere çevrilir (bkz. ``restatement_factor``).
"""

import asyncio
import re
from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any

import structlog

from src.adapters.financial_adapter import (
    FLOW_KEYS,
    ISYATIRIM_GROUP_INDUSTRIAL,
    STOCK_KEYS,
    IsYatirimError,
    build_ratio_inputs,
    canonical_financial_items,
    compute_financial_ratios,
    derive_financial_amounts,
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
    to_number,
    ttm_components,
)
from src.adapters.utils import (
    MarketDataError,
    SymbolNotFoundError,
    cached,
    get_http_client,
    run_sync,
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
    """
    header = rows[0]
    periods = [cell.strip() for cell in header[1:]]
    if not periods or not all(_PERIOD_LABEL_RE.match(p) for p in periods):
        raise ValueError(f"KAP dönem başlıkları okunamadı: {periods}")
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
                text = cells[j + 1].strip() if j + 1 < len(cells) else ""
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
                text = cells[j + 1].strip() if j + 1 < len(cells) else ""
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
        if not label or key in (_KAP_UNIT_ROW, _KAP_NATURE_ROW) or len(cells) != count + 1:
            continue
        values = [_parse_kap_number(cells[j + 1], multipliers[j]) for j in range(count)]
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
    labels = {normalize_label(r["Item"]) for r in balance["records"]} | {
        normalize_label(r["Item"]) for r in income["records"]
    }
    template = "bank" if ("mevduat" in labels or "net faiz geliri veya gideri" in labels) else "industrial"
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
    response = await get_http_client().get(entry["url"])
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


def _merged_canonical_by_period(
    kap: Mapping[str, Any] | None,
    isy: Mapping[str, Any] | None,
) -> tuple[dict[str, dict[str, float | None]], str]:
    """Canonical items per period for ratio/TTM work, plus the statement template.

    İş Yatırım supplies the consistent multi-period series (flows need the
    prior-year interim period that KAP's summary lacks); its IAS 29-restated
    year-end columns are converted back to reported values with the KAP factor.
    KAP fills periods/items İş Yatırım does not have.
    """
    kap_items = _kap_canonical_by_period(kap) if kap else {}
    isy_items = _isy_canonical_by_period(isy) if isy else {}
    template = (kap or {}).get("template") or (isy or {}).get("template") or "industrial"
    if isy and isy.get("template") == "bank":
        template = "bank"
    both_industrial = template == "industrial" and (isy or {}).get("group") == ISYATIRIM_GROUP_INDUSTRIAL
    factors = _restatement_factors(kap_items, isy_items, "industrial" if both_industrial else None)

    merged: dict[str, dict[str, float | None]] = {}
    for period in sort_periods_desc([*kap_items, *isy_items]):
        base = (
            _scaled_items(isy_items[period], factors.get(period), _period_unit(kap, period))
            if period in isy_items
            else {}
        )
        reported = kap_items.get(period, {})
        combined: dict[str, float | None] = {}
        for key in (*FLOW_KEYS, *STOCK_KEYS):
            value = base.get(key)
            if value is None:
                value = reported.get(key)
            elif key == "paid_in_capital" and reported.get(key) is not None:
                value = reported.get(key)
            combined[key] = value
        merged[period] = combined
    return merged, template


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


def _supplement_rows(
    records: Sequence[Mapping[str, Any]],
    kap: Mapping[str, Any],
    isy: Mapping[str, Any],
    factors: Mapping[str, Mapping[str, float | None]],
    section: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    """KAP rows extended with İş Yatırım interim periods KAP's summary omits.

    A row is extended only if its İş Yatırım mapping reproduces the KAP figure
    on every overlapping period (within rounding) — companies such as holdings
    define some subtotals differently, and mixing definitions across columns
    would be misleading. Returns ``(rows, added_periods)``.
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
            row[period] = _sum_codes(values_by_code, codes, period) if verified and codes else None
        ordered = {"Item": row["Item"]}
        for period in sort_periods_desc([k for k in row if k != "Item"]):
            ordered[period] = row[period]
        rows.append(ordered)
    return rows, extra


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
) -> list[dict[str, Any]]:
    bad_memo = _implausible_sales_memo_periods(isy) if statement == "cashflow" else set()
    rows = []
    for item in isy.get("items", []):
        if item.get("statement") != statement:
            continue
        values = item.get("values") or {}
        row: dict[str, Any] = {"Item": item["label"]}
        for period in periods:
            value = to_number(values.get(period))
            if item.get("code") in _SALES_MEMO_CODES and period in bad_memo:
                value = None
            factor = (factors.get(period) or {}).get(factor_kind)
            if value is not None and factor is not None:
                value = _rescale(value, factor, (units or {}).get(period, 1.0))
            row[period] = value
        if any(v not in (None, 0) for k, v in row.items() if k != "Item"):
            rows.append(row)
    return rows


async def _statement_view(ticker: str, quarterly: bool, section: str) -> dict[str, Any]:
    kap, isy = await _load_statement_sources(ticker, isy_wait=_ISY_WAIT_STATEMENTS if quarterly else 0.0)
    fy_month = int((kap or {}).get("fiscal_year_end_month") or 12)
    flows = section == "income"
    kap_key = "balance_sheet" if section == "balance" else "income_statement"
    notes: list[str] = []

    if kap is not None:
        records = _filter_kap_periods(kap[kap_key], quarterly, fy_month)
        sources = {p: _SOURCE_KAP for p in _periods_of(records)}
        factors: dict[str, dict[str, float | None]] = {}
        if quarterly and isy is not None and kap.get("template") == "industrial" and isy.get("group") == ISYATIRIM_GROUP_INDUSTRIAL:
            kap_items = _kap_canonical_by_period(kap)
            isy_items = _isy_canonical_by_period(isy)
            factors = _restatement_factors(kap_items, isy_items, "industrial")
            records, added = _supplement_rows(records, kap, isy, factors, section)
            sources.update({p: _SOURCE_ISY for p in added})
            if added:
                notes.append("KAP özetinde bulunmayan ara dönemler İş Yatırım'dan (ilk açıklanan değerler) eklendi.")
        source = _SOURCE_KAP if all(s == _SOURCE_KAP for s in sources.values()) else f"{_SOURCE_KAP} + {_SOURCE_ISY}"
        source_url = kap.get("source_url")
        unit = kap.get("unit", "TRY")
        kap_info = kap.get("period_info", {}).get(section)
    else:
        assert isy is not None
        periods = [p for p in isy["periods"] if quarterly or (parse_period(p) or (0, 0))[1] == fy_month]
        records = _isy_rows(isy, "balance" if section == "balance" else "income", periods, {}, "balance")
        sources = {p: _SOURCE_ISY for p in periods}
        source, source_url, unit, kap_info = _SOURCE_ISY, None, "TRY", None
        notes.append("KAP özeti alınamadı; İş Yatırım verisi gösteriliyor (yıl sonu kolonları enflasyona göre yeniden ifade edilmiş olabilir).")

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
        "period_info": _period_info(periods, fy_month, sources, kap_info, {}, "balance"),
        "value_basis": "cumulative_ytd" if flows else "point_in_time",
        "fiscal_year_end_month": fy_month,
        "notes": notes,
    }
    if flows and quarterly:
        payload["discrete"] = _discrete_rows(records, fy_month)
    return payload


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


async def get_cashflow(ticker: str, quarterly: bool = False) -> dict:
    """Nakit akış tablosu (İş Yatırım; TL, kümülatif; bankalar için mevcut değil)."""
    try:
        kap, isy = await _load_statement_sources(ticker, isy_wait=_ISY_WAIT_RATIOS)
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

        periods = [p for p in isy["periods"] if quarterly or (parse_period(p) or (0, 0))[1] == fy_month]
        if quarterly:
            periods = periods[:8]
        factors: dict[str, dict[str, float | None]] = {}
        if kap is not None and kap.get("template") == "industrial" and isy.get("group") == ISYATIRIM_GROUP_INDUSTRIAL:
            factors = _restatement_factors(
                _kap_canonical_by_period(kap), _isy_canonical_by_period(isy), "industrial"
            )
        units = {p: _period_unit(kap, p, "income") for p in isy["periods"]} if kap else {}
        rows = _isy_rows(isy, "cashflow", periods, factors, "flow", units)
        periods = _periods_of(rows)
        payload = {
            **base,
            "as_of": periods[0] if periods else None,
            "data": rows,
            "available": bool(rows),
            "periods": periods,
            "period_info": _period_info(periods, fy_month, {p: _SOURCE_ISY for p in periods}, None, factors, "flow"),
            "notes": (
                ["Yıl sonu kolonları KAP'ta ilk açıklanan tutarlara çevrildi (enflasyon düzeltmesi katsayısı)."]
                if any((factors.get(p) or {}).get("flow") not in (None, 1.0) for p in periods)
                else []
            ),
        }
        if quarterly:
            all_rows = _isy_rows(isy, "cashflow", isy["periods"], factors, "flow", units)
            discrete = _discrete_rows(all_rows, fy_month)
            payload["discrete"] = [{"Item": r["Item"], **{p: r.get(p) for p in periods}} for r in discrete]
        return payload
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

    shares, shares_source = _ratio_shares(current.get("paid_in_capital"), snapshot_shares)
    last = to_number(price)
    market_cap = last * shares if last is not None and last > 0 and shares is not None else None
    bank = template == "bank"
    ratios = compute_financial_ratios(current, previous=previous, market_cap=market_cap, is_bank=bank)
    amounts = derive_financial_amounts(current, market_cap, is_bank=bank)

    parsed = parse_period(period)
    ttm_quarters: list[str] = []
    if parsed is not None:
        ttm_quarters = [period_label(*shift_months(parsed[0], parsed[1], -3 * i)) for i in range(3, -1, -1)]
    return {
        "as_of": period,
        "basis": basis,
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


async def get_live_financial_ratios(ticker: str) -> dict:
    """Oranlar: akım kalemleri TTM (son 4 çeyrek), stok kalemleri son bilanço, piyasa değeri canlı fiyat × pay adedi."""
    try:
        kap, isy = await _load_statement_sources(ticker, isy_wait=_ISY_WAIT_RATIOS)
        items_by_period, template = _merged_canonical_by_period(kap, isy)
        fy_month = int((kap or {}).get("fiscal_year_end_month") or 12)
        snapshot: dict[str, Any] = {}
        try:
            snapshot = await _get_market_snapshot(ticker)
        except Exception as e:
            logger.warning("live_ratios_snapshot_failed", ticker=ticker, error=f"{type(e).__name__}: {e}")

        result = compute_live_ratios(
            items_by_period,
            fiscal_year_end_month=fy_month,
            template=template,
            price=snapshot.get("last_price"),
            snapshot_shares=snapshot.get("shares"),
        )
        if result is None or not any(v is not None for v in result["ratios"].values()):
            return {"ticker": ticker, "ratios": None, "available": False}
        sources = [s for s, present in ((_SOURCE_KAP, kap), (_SOURCE_ISY, isy)) if present]
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
            + (["Banka: brüt/FAVÖK marjı, cari oran ve borç çarpanları anlamlı değildir."] if template == "bank" else []),
        }
    except Exception as e:
        return _failure(e, _MSG_RATIOS, "live_ratios_error", ticker, ratios=None)


