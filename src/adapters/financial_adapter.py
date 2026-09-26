"""Finansal tablo çekirdeği.

Bu modül üç şey sağlar:

1. İş Yatırım ``MaliTablo`` istemcisi: tek istekte 4 dönem için bilanço, gelir
   tablosu ve nakit akışı (kalem kodlarıyla birlikte). borsapy'nin
   ``get_financial_statements`` sarmalayıcısı her tablo için ayrı istek atıyor,
   bankalarda (``UFRS``) veri döndürmüyor ve aynı adlı kalemleri (ör. kısa ve
   uzun vadeli "Finansal Borçlar") birleştirirken kartezyen çoğaltma yapıyor;
   bu yüzden doğrudan istemci kullanılıyor.
2. Saf (I/O'suz) yardımcılar: kalem adlarını kanonik anahtarlara eşleme,
   dönem etiketleri, kümülatif (YTD) → çeyreklik / TTM dönüşümleri. Oran
   hesabının **tek** uygulaması :mod:`src.services.analysis_service`'tedir
   (hem ``/fundamentals/{t}/live-ratios`` hem de ``financial_ratios``).
3. :class:`FinancialAdapter`: eski polling kaynağı ``financials`` için yenileme
   işareti üretir; asıl iş ``src.services.fundamentals_service`` deposundadır.

Birim sözleşmesi: tüm tutarlar TL (tam birim); marj/getiri/büyüme oranları
yüzde (``14.85`` = %14,85); çarpanlar (F/K, PD/DD, FD/FAVÖK) düz oran.

Dönem etiketi: ``"YYYY/MM"`` (KAP biçimi, ör. ``"2026/06"``). Gelir tablosu ve
nakit akışı değerleri, KAP'ta olduğu gibi mali yıl başından itibaren
**kümülatiftir** (``2026/06`` = 6 aylık). Tek çeyrek değerleri
:func:`discrete_quarter_values`, son 12 ay değerleri :func:`ttm_flows` ile
türetilir.
"""

import asyncio
import calendar
import hashlib
import json
import math
import re
import unicodedata
from collections.abc import Iterable, Mapping, Sequence
from datetime import date
from typing import Any

import httpx
import structlog

from src.adapters.base import BaseTickerAdapter, RawEventData
from src.adapters.utils import get_http_client
from src.core.time import utcnow
from src.db.models import PollingState

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Periods
# ---------------------------------------------------------------------------

_PERIOD_RE = re.compile(r"^\s*(\d{4})\s*(?:[/\-.]\s*(\d{1,2})|Q([1-4]))?\s*$", re.IGNORECASE)


def period_label(year: int, month: int) -> str:
    """KAP-style period label, e.g. ``(2026, 6) -> "2026/06"``."""
    return f"{year:04d}/{month:02d}"


def parse_period(value: Any) -> tuple[int, int] | None:
    """Parse ``"2026/06"``, ``"2026-06"``, ``"2026Q2"`` or ``"2025"`` (→ year-end).

    Returns ``(year, month)`` or ``None`` for anything else.
    """
    match = _PERIOD_RE.match(str(value or ""))
    if not match:
        return None
    year = int(match.group(1))
    if match.group(2):
        month = int(match.group(2))
    elif match.group(3):
        month = int(match.group(3)) * 3
    else:
        month = 12
    if not 1 <= month <= 12:
        return None
    return year, month


def shift_months(year: int, month: int, delta: int) -> tuple[int, int]:
    """``(year, month)`` moved by ``delta`` months (negative = back in time)."""
    index = year * 12 + (month - 1) + delta
    return index // 12, index % 12 + 1


def months_into_fiscal_year(month: int, fiscal_year_end_month: int = 12) -> int:
    """How many months a cumulative figure ending in ``month`` covers (1..12)."""
    return (month - fiscal_year_end_month - 1) % 12 + 1


def sort_periods_desc(periods: Iterable[str]) -> list[str]:
    """Unique period labels, newest first (unparseable labels last, stable)."""
    unique = list(dict.fromkeys(periods))
    return sorted(unique, key=lambda p: parse_period(p) or (0, 0), reverse=True)


def quarter_ends_before(
    today: date,
    count: int,
    fiscal_year_end_month: int = 12,
) -> list[tuple[int, int]]:
    """The ``count`` most recent fiscal quarter-ends on or before ``today``, newest first."""
    quarter_months = {(fiscal_year_end_month - 1 - 3 * i) % 12 + 1 for i in range(4)}
    year, month = today.year, today.month
    if today.day < calendar.monthrange(year, month)[1]:
        # The current month's quarter-end (its last day) has not been reached yet.
        year, month = shift_months(year, month, -1)
    periods: list[tuple[int, int]] = []
    for _ in range(count * 3 + 3):
        if month in quarter_months:
            periods.append((year, month))
            if len(periods) == count:
                break
        year, month = shift_months(year, month, -1)
    return periods


def fiscal_year_ends_before(today: date, count: int, fiscal_year_end_month: int = 12) -> list[tuple[int, int]]:
    """The ``count`` most recent fiscal year-ends on or before ``today``, newest first."""
    year = today.year
    last_day = calendar.monthrange(year, fiscal_year_end_month)[1]
    if (today.month, today.day) < (fiscal_year_end_month, last_day):
        year -= 1
    return [(year - i, fiscal_year_end_month) for i in range(count)]


# ---------------------------------------------------------------------------
# Label normalisation & canonical items
# ---------------------------------------------------------------------------

_TR_FOLD = str.maketrans(
    {
        "ı": "i", "İ": "i", "I": "i", "ş": "s", "Ş": "s", "ğ": "g", "Ğ": "g",
        "ü": "u", "Ü": "u", "ö": "o", "Ö": "o", "ç": "c", "Ç": "c",
        "â": "a", "Â": "a", "î": "i", "Î": "i", "û": "u", "Û": "u",
    }
)
# "III. ", "III - ", "16.1 ", "2.2.1 ", "A- " style numbering used by the bank/insurance templates.
_NUMBERING_RE = re.compile(r"^(?:[ivxlc]+\s?[.\-)]|[a-z][.\-)]|\d+(?:\.\d+)*[.)]?)\s+")
# Trailing formula such as "(XVII+XXII)", "(I - II)", "(XV±XVI)".
_FORMULA_RE = re.compile(r"\s*\((?:[ivxlc]+\s*[-+±]\s*)+[ivxlc]+\)\s*$")


def normalize_label(label: Any) -> str:
    """Case/diacritic-insensitive key for a Turkish statement line label."""
    text = str(label or "").translate(_TR_FOLD).lower().strip()
    text = _NUMBERING_RE.sub("", text)
    text = _FORMULA_RE.sub("", text)
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", text).strip()


_BALANCE_ALIASES: dict[str, tuple[str, ...]] = {
    "total_assets": ("toplam varliklar", "varliklar", "varliklar toplami", "aktif toplami", "toplam aktifler"),
    # insurance template: "Cari Varlıklar" / İş Yatırım "I- Cari Varlıklar Toplamı"
    "current_assets": ("donen varliklar", "cari varliklar", "cari varliklar toplami"),
    "current_liabilities": ("kisa vadeli yukumlulukler", "kisa vadeli yukumlulukler toplami"),
    "non_current_liabilities": ("uzun vadeli yukumlulukler", "uzun vadeli yukumlulukler toplami"),
    # NB: the bank summary's "Yükümlülükler Toplamı" is liabilities + equity, so it is not an alias.
    "total_liabilities": ("toplam yukumlulukler", "yukumlulukler"),
    "total_equity": (
        "toplam ozkaynaklar", "ozkaynaklar", "ozsermaye", "toplam ozsermaye", "ozsermaye toplami", "ozkaynaklar toplami",
    ),
    "parent_equity": ("ana ortakliga ait ozkaynaklar",),
    "minority_interest": ("kontrol gucu olmayan paylar", "azinlik paylari"),
    "paid_in_capital": ("odenmis sermaye",),
    "cash": ("nakit ve nakit benzerleri",),
    "short_term_investments": ("finansal yatirimlar (donen varliklar)",),
    "short_term_financial_debt": ("finansal borclar (kisa vadeli yukumlulukler)", "kisa vadeli finansal borclar"),
    "long_term_financial_debt": ("finansal borclar (uzun vadeli yukumlulukler)", "uzun vadeli finansal borclar"),
    "_financial_debt_unqualified": ("finansal borclar",),
    "deposits": ("mevduat",),
}

_INCOME_ALIASES: dict[str, tuple[str, ...]] = {
    "_total_revenue": ("toplam hasilat",),
    "_sales_revenue": ("hasilat", "satis gelirleri", "net satislar"),
    "_finance_sector_revenue": (
        "finans sektoru faaliyetleri hasilati",
        "faiz, ucret, prim, komisyon ve diger gelirler",
    ),
    "gross_profit": ("brut kar (zarar)", "brut kar"),
    "operating_profit": ("esas faaliyet kari (zarari)", "faaliyet kari (zarari)"),
    # NB: the insurance summary's "Dönem Kârı veya Zararı" is PRE-tax; only the "net" line maps.
    "net_income": (
        "net donem kari (zarari)", "donem kari (zarari)", "net donem kari/zarari", "donem net kari (zarari)",
        "donem net kari veya zarari", "net donem kari veya zarari",
    ),
    "net_income_parent": (
        "donem karinin (zararinin) dagilimi, ana ortaklik paylari",
        "ana ortaklik paylari",
        "donem karinin (zararinin) dagilimi, grubun kari (zarari)",
        "grubun kari/zarari",
    ),
    "net_interest_income": ("net faiz geliri veya gideri", "net faiz geliri/gideri"),
    # insurance: technical income of the non-life / life / pension sections (summed)
    "_insurance_revenue": ("hayat disi teknik gelir", "hayat teknik gelir", "emeklilik teknik gelir"),
}

#: Labels that identify a statement template (matched on ``normalize_label``).
BANK_TEMPLATE_MARKERS = frozenset({"mevduat", "net faiz geliri veya gideri", "net faiz geliri/gideri"})
INSURANCE_TEMPLATE_MARKERS = frozenset(
    {"hayat disi teknik gelir", "hayat teknik gelir", "emeklilik teknik gelir", "genel teknik bolum dengesi"}
)

_CASHFLOW_ALIASES: dict[str, tuple[str, ...]] = {
    "depreciation_amortization": (
        "amortisman & itfa paylari",
        "amortisman ve itfa gideri ile ilgili duzeltmeler",
        "amortisman giderleri",
    ),
    "operating_cash_flow": ("isletme faaliyetlerinden kaynaklanan net nakit",),
    "investing_cash_flow": ("yatirim faaliyetlerinden kaynaklanan nakit",),
    "financing_cash_flow": ("finansman faaliyetlerden kaynaklanan nakit",),
    "capex": ("sabit sermaye yatirimlari",),
    "free_cash_flow": ("serbest nakit akim",),
}

#: Canonical flow items (period sums; cumulative within a fiscal year in the raw data).
FLOW_KEYS: tuple[str, ...] = (
    "revenue",
    "gross_profit",
    "operating_profit",
    "net_income",
    "net_income_parent",
    "net_interest_income",
    "depreciation_amortization",
    "operating_cash_flow",
    "investing_cash_flow",
    "financing_cash_flow",
    "capex",
    "free_cash_flow",
)

#: Canonical stock items (balance-sheet values at the period end).
STOCK_KEYS: tuple[str, ...] = (
    "total_assets",
    "current_assets",
    "current_liabilities",
    "non_current_liabilities",
    "total_liabilities",
    "total_equity",
    "parent_equity",
    "minority_interest",
    "paid_in_capital",
    "cash",
    "short_term_investments",
    "financial_debt",
    "deposits",
)


def to_number(value: Any) -> float | None:
    """Finite float or ``None`` (NaN/Inf/bool/garbage/1e100 sentinels are missing)."""
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or abs(number) >= 1e90:
        return None
    return number


def _pick(normalized: Mapping[str, Any], aliases: Sequence[str]) -> float | None:
    for alias in aliases:
        value = to_number(normalized.get(alias))
        if value is not None:
            return value
    return None


def _normalized_map(values: Mapping[str, Any] | None) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for label, value in (values or {}).items():
        key = normalize_label(label)
        # First occurrence wins (statement order is top-down; totals come first).
        if key and key not in result:
            result[key] = value
    return result


def canonical_financial_items(
    *,
    balance: Mapping[str, Any] | None = None,
    income: Mapping[str, Any] | None = None,
    cashflow: Mapping[str, Any] | None = None,
) -> dict[str, float | None]:
    """Map ``{line label: value}`` statements of ONE period to canonical items.

    Works with KAP summary labels, İş Yatırım labels (including the
    disambiguated duplicates this module stores, e.g.
    ``"Finansal Borçlar (Kısa Vadeli Yükümlülükler)"``) and the bank template.
    The statements are kept separate because some labels (``"Azınlık
    Payları"``) exist in more than one table with different meanings.
    Returns every key of :data:`FLOW_KEYS` + :data:`STOCK_KEYS` (``None`` when
    the item is not present).
    """
    b = _normalized_map(balance)
    i = _normalized_map(income)
    c = _normalized_map(cashflow)
    items: dict[str, float | None] = {key: None for key in (*FLOW_KEYS, *STOCK_KEYS)}

    for key, aliases in _BALANCE_ALIASES.items():
        if not key.startswith("_"):
            items[key] = _pick(b, aliases)
    for key, aliases in _INCOME_ALIASES.items():
        if not key.startswith("_"):
            items[key] = _pick(i, aliases)
    for key, aliases in _CASHFLOW_ALIASES.items():
        items[key] = _pick(c, aliases)

    total_revenue = _pick(i, _INCOME_ALIASES["_total_revenue"])
    sales = _pick(i, _INCOME_ALIASES["_sales_revenue"])
    finance_revenue = _pick(i, _INCOME_ALIASES["_finance_sector_revenue"])
    technical = [to_number(i.get(alias)) for alias in _INCOME_ALIASES["_insurance_revenue"]]
    if total_revenue is not None:
        items["revenue"] = total_revenue
    elif sales is not None:
        items["revenue"] = sales + (finance_revenue or 0.0)
    elif any(v is not None for v in technical):
        items["revenue"] = sum(v for v in technical if v is not None)

    short_debt = items.pop("short_term_financial_debt", None)
    long_debt = items.pop("long_term_financial_debt", None)
    if short_debt is not None or long_debt is not None:
        items["financial_debt"] = (short_debt or 0.0) + (long_debt or 0.0)
    else:
        items["financial_debt"] = _pick(b, _BALANCE_ALIASES["_financial_debt_unqualified"])

    if items["total_liabilities"] is None:
        if items["current_liabilities"] is not None and items["non_current_liabilities"] is not None:
            items["total_liabilities"] = items["current_liabilities"] + items["non_current_liabilities"]
        elif items["total_assets"] is not None and items["total_equity"] is not None:
            items["total_liabilities"] = items["total_assets"] - items["total_equity"]

    if items["depreciation_amortization"] is not None:
        # Cash-flow add-back; some sources sign it as an expense.
        items["depreciation_amortization"] = abs(items["depreciation_amortization"])
    return items


def statement_template(labels: Iterable[Any], default: str = "industrial") -> str:
    """``bank`` / ``insurance`` / ``default`` from statement line labels."""
    keys = {normalize_label(label) for label in labels}
    if keys & INSURANCE_TEMPLATE_MARKERS:
        return "insurance"
    if keys & BANK_TEMPLATE_MARKERS:
        return "bank"
    return default


def is_bank_items(items: Mapping[str, Any]) -> bool:
    """Heuristic: bank templates carry deposits / net interest income."""
    return to_number(items.get("deposits")) is not None or to_number(items.get("net_interest_income")) is not None


# ---------------------------------------------------------------------------
# Cumulative (YTD) → discrete quarter / TTM
# ---------------------------------------------------------------------------

#: First period reported under inflation accounting (TMS/IAS 29) in Türkiye (KGK: periods
#: ending on or after 31 December 2023): the 2023 annual reports and every later report.
IAS29_FIRST_PERIOD: tuple[int, int] = (2023, 12)

#: Quarters (months into the fiscal year) whose own three-month figure re-expresses the
#: previous cumulative value. The fourth quarter has no three-month column in the annual
#: report and stays FY − 9M (TradingView/FactSet derive it the same way).
_REEXPRESSED_QUARTERS = (6, 9)


def cpi_quarter_factors(cpi_monthly_change: Mapping[str, float | None]) -> dict[str, float]:
    """``{quarter label: CPI(month end) ÷ CPI(three months earlier)}`` for IAS 29 periods.

    ``cpi_monthly_change`` maps ``"YYYY-MM"`` to TÜİK's monthly CPI change in percent
    (``tuik.cpi.mom``). A label is listed when its three months are known and the
    quarter it follows is an IAS 29 period (:data:`IAS29_FIRST_PERIOD`). Every month
    gets a label, so any fiscal year end works. The product of the rounded monthly
    changes reproduces the companies' own re-expression: BIMAS 2026/06 1.07010 vs
    1.07014 implied by its KAP report.
    """
    changes: dict[tuple[int, int], float] = {}
    for key, raw in cpi_monthly_change.items():
        change = to_number(raw)
        match = re.match(r"^(\d{4})-(\d{2})", str(key))
        if match and change is not None:
            changes[(int(match.group(1)), int(match.group(2)))] = change
    factors: dict[str, float] = {}
    for year, month in changes:
        if shift_months(year, month, -3) < IAS29_FIRST_PERIOD:
            continue
        months = [shift_months(year, month, -k) for k in range(3)]
        if all(m in changes for m in months):
            factors[period_label(year, month)] = math.prod(1 + changes[m] / 100 for m in months)
    return factors


def reexpression_factor(
    period: str, quarter_factors: Mapping[str, float] | None, fiscal_year_end_month: int
) -> float | None:
    """Factor for the previous cumulative value when de-cumulating ``period``.

    ``1.0`` = subtract as is (no factors, first/fourth quarter, pre-IAS 29 period);
    ``None`` = a re-expression is due but its CPI factor is unknown.
    """
    parsed = parse_period(period)
    if quarter_factors is None or parsed is None:
        return 1.0
    year, month = parsed
    if months_into_fiscal_year(month, fiscal_year_end_month) not in _REEXPRESSED_QUARTERS:
        return 1.0
    if shift_months(year, month, -3) < IAS29_FIRST_PERIOD:
        return 1.0
    return quarter_factors.get(period)


def discrete_quarter_values(
    values_by_period: Mapping[str, float | None],
    fiscal_year_end_month: int = 12,
    quarter_factors: Mapping[str, float] | None = None,
) -> dict[str, float | None]:
    """Single-quarter values from cumulative (year-to-date) values.

    Q1 = YTD(Q1); Qn = YTD(Qn) − YTD(Qn−1) of the same fiscal year. ``None``
    when the previous cumulative value is missing (never guessed).

    ``quarter_factors`` (:func:`cpi_quarter_factors`, IAS 29 reporters only): each
    report is in its own period-end purchasing power, so the second and third
    quarters first re-express the previous cumulative value,
    Qn = YTD(Qn) − YTD(Qn−1) × CPI(Qn) ÷ CPI(Qn−1). That is the three-month
    column of the company's own report: BIMAS 2026/Q2 revenue 221.9 bn on KAP,
    236.8 bn by plain subtraction. The fourth quarter stays FY − 9M. ``None`` when
    the factor is missing.
    """
    result: dict[str, float | None] = {}
    for period, raw in values_by_period.items():
        parsed = parse_period(period)
        value = to_number(raw)
        if parsed is None or value is None:
            result[period] = None
            continue
        year, month = parsed
        if months_into_fiscal_year(month, fiscal_year_end_month) == 3:
            result[period] = value
            continue
        prev = to_number(values_by_period.get(period_label(*shift_months(year, month, -3))))
        factor = reexpression_factor(period, quarter_factors, fiscal_year_end_month)
        result[period] = value - prev * factor if prev is not None and factor is not None else None
    return result


def ttm_components(period: str, fiscal_year_end_month: int = 12) -> tuple[str, str, str] | None:
    """``(latest YTD, previous fiscal year-end, same YTD one year earlier)`` labels.

    ``None`` when ``period`` is itself a fiscal year-end (the annual figure is
    already twelve months).
    """
    parsed = parse_period(period)
    if parsed is None:
        return None
    year, month = parsed
    months = months_into_fiscal_year(month, fiscal_year_end_month)
    if months == 12:
        return None
    fiscal_year_end = shift_months(year, month, -months)
    return period, period_label(*fiscal_year_end), period_label(year - 1, month)


def ttm_flows(
    items_by_period: Mapping[str, Mapping[str, Any]],
    period: str,
    fiscal_year_end_month: int = 12,
    quarter_factors: Mapping[str, float] | None = None,
) -> dict[str, float | None] | None:
    """Trailing-twelve-month flow items ending at ``period``.

    TTM = YTD(period) + FY(previous) − YTD(same period previous year), i.e. the
    sum of the last four discrete quarters. Returns ``None`` when a required
    period is missing entirely; individual items are ``None`` when any of the
    three inputs lacks them.

    With ``quarter_factors`` (IAS 29 reporters) the four quarters are the companies'
    own figures (:func:`discrete_quarter_values`): every second or third quarter ``q``
    of the window also subtracts YTD(q − 3) × (factor(q) − 1). An item is ``None`` when
    that cumulative value or the factor is missing. At a fiscal year end the annual
    figure stays the TTM.
    """
    parsed = parse_period(period)
    if parsed is None or period not in items_by_period:
        return None
    components = ttm_components(period, fiscal_year_end_month)
    latest = items_by_period[period]
    if components is None:
        return {key: to_number(latest.get(key)) for key in FLOW_KEYS}
    _, fy_label, prev_label = components
    fy = items_by_period.get(fy_label)
    prev = items_by_period.get(prev_label)
    if fy is None or prev is None:
        return None
    result: dict[str, float | None] = {}
    for key in FLOW_KEYS:
        a, b, c = to_number(latest.get(key)), to_number(fy.get(key)), to_number(prev.get(key))
        result[key] = a + b - c if a is not None and b is not None and c is not None else None
    if quarter_factors is None:
        return result
    year, month = parsed
    for q_year, q_month in (shift_months(year, month, -3 * i) for i in range(4)):
        factor = reexpression_factor(period_label(q_year, q_month), quarter_factors, fiscal_year_end_month)
        if factor == 1.0:
            continue
        base_items = items_by_period.get(period_label(*shift_months(q_year, q_month, -3)))
        for key in FLOW_KEYS:
            value = result[key]
            base = to_number(base_items.get(key)) if base_items is not None else None
            result[key] = (
                value - base * (factor - 1)
                if value is not None and base is not None and factor is not None
                else None
            )
    return result


# ---------------------------------------------------------------------------
# İş Yatırım MaliTablo client
# ---------------------------------------------------------------------------

ISYATIRIM_MALITABLO_URL = (
    "https://www.isyatirim.com.tr/_Layouts/15/IsYatirim.Website/Common/Data.aspx/MaliTablo"
)
ISYATIRIM_GROUP_INDUSTRIAL = "XI_29"
ISYATIRIM_GROUP_FINANCIAL = "UFRS"
#: Human-facing İş Yatırım page with the same statements (``source_url`` of stored rows).
ISYATIRIM_COMPANY_CARD_URL = "https://www.isyatirim.com.tr/tr-tr/analiz/hisse/Sayfalar/sirket-karti.aspx?hisse={ticker}"
_ISYATIRIM_PERIODS_PER_CALL = 4
_ISYATIRIM_TIMEOUT = httpx.Timeout(12.0, connect=6.0)
# İş Yatırım's WAF stalls requests from non-browser user agents (the shared
# client's "HisseAnalizi/…" UA times out), so this client presents itself like
# borsapy does.
_ISYATIRIM_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
}

_STATEMENT_BY_CODE_PREFIX = {"1": "balance", "2": "balance", "3": "income", "4": "cashflow"}


class IsYatirimError(RuntimeError):
    """İş Yatırım MaliTablo request failed (transport / HTTP / payload)."""


async def _fetch_malitablo_batch(
    ticker: str,
    group: str,
    periods: Sequence[tuple[int, int]],
    attempts: int = 2,
) -> list[dict[str, Any]]:
    """One MaliTablo call (≤4 periods). Timeouts / 5xx / 429 are retried once."""
    params: dict[str, Any] = {"companyCode": ticker, "exchange": "TRY", "financialGroup": group}
    for index, (year, month) in enumerate(periods, 1):
        params[f"year{index}"] = year
        params[f"period{index}"] = month

    for attempt in range(1, attempts + 1):
        try:
            response = await get_http_client().get(
                ISYATIRIM_MALITABLO_URL,
                params=params,
                headers=_ISYATIRIM_HEADERS,
                timeout=_ISYATIRIM_TIMEOUT,
            )
        except httpx.TransportError as e:  # includes timeouts
            if attempt < attempts:
                await asyncio.sleep(0.5 * attempt)
                continue
            raise IsYatirimError(f"MaliTablo {ticker}/{group}: {type(e).__name__}") from e
        if (response.status_code >= 500 or response.status_code == 429) and attempt < attempts:
            await asyncio.sleep(0.5 * attempt)
            continue
        if response.status_code >= 400:
            raise IsYatirimError(f"MaliTablo {ticker}/{group}: HTTP {response.status_code}")
        try:
            payload = response.json()
        except ValueError as e:
            raise IsYatirimError(f"MaliTablo {ticker}/{group}: invalid JSON") from e
        items = payload.get("value") if isinstance(payload, dict) else None
        return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []
    raise IsYatirimError(f"MaliTablo {ticker}/{group}: no attempts")  # pragma: no cover


def _template_for(group: str, items: Sequence[Mapping[str, Any]]) -> str:
    """``industrial`` (XI_29) or, for the UFRS group, ``insurance`` / ``bank`` / ``financial``.

    UFRS is İş Yatırım's financial-sector layout: banks, insurers, leasing and
    factoring companies (bank-only / solo figures).
    """
    if group == ISYATIRIM_GROUP_INDUSTRIAL:
        return "industrial"
    return statement_template((item.get("itemDescTr") for item in items), default="financial")


def _disambiguated_labels(items: Sequence[Mapping[str, Any]]) -> list[str]:
    """Stripped labels, with duplicates qualified by their section header.

    İş Yatırım repeats child labels under different sections (short- and
    long-term "Finansal Borçlar", current and non-current "Finansal
    Yatırımlar", ...). Unqualified they overwrite each other in dicts.
    """
    stripped = [" ".join(str(item.get("itemDescTr") or item.get("itemDescEng") or "").split()) for item in items]
    sections: list[str] = []
    current_section = ""
    for item, label in zip(items, stripped):
        raw = str(item.get("itemDescTr") or "")
        if raw and not raw[0].isspace():
            current_section = label
        sections.append(current_section)

    counts: dict[tuple[str, str], int] = {}
    for item, label in zip(items, stripped):
        statement = _STATEMENT_BY_CODE_PREFIX.get(str(item.get("itemCode", ""))[:1], "")
        counts[(statement, label)] = counts.get((statement, label), 0) + 1

    result: list[str] = []
    seen: set[tuple[str, str]] = set()
    for item, label, section in zip(items, stripped, sections):
        statement = _STATEMENT_BY_CODE_PREFIX.get(str(item.get("itemCode", ""))[:1], "")
        final = label
        if counts[(statement, label)] > 1 and section and section != label:
            final = f"{label} ({section})"
        if (statement, final) in seen:
            final = f"{label} [{item.get('itemCode')}]"
        seen.add((statement, final))
        result.append(final)
    return result


def _merge_batches(
    batches: Sequence[tuple[Sequence[tuple[int, int]], Sequence[Mapping[str, Any]]]],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Merge MaliTablo batches by item code; keep columns that carry data."""
    order: list[str] = []
    rows: dict[str, dict[str, Any]] = {}
    periods_with_data: set[str] = set()
    for periods, items in batches:
        labels = _disambiguated_labels(items)
        for item, label in zip(items, labels):
            code = str(item.get("itemCode") or "").strip()
            if not code:
                continue
            row = rows.get(code)
            if row is None:
                row = {
                    "code": code,
                    "label": label,
                    "statement": _STATEMENT_BY_CODE_PREFIX.get(code[:1], "other"),
                    "values": {},
                }
                rows[code] = row
                order.append(code)
            for index, (year, month) in enumerate(periods[:_ISYATIRIM_PERIODS_PER_CALL], 1):
                value = to_number(item.get(f"value{index}"))
                label_key = period_label(year, month)
                row["values"][label_key] = value
                if value is not None and value != 0:
                    periods_with_data.add(label_key)
    ordered_periods = sort_periods_desc(periods_with_data)
    merged = []
    for code in order:
        row = rows[code]
        row["values"] = {p: row["values"].get(p) for p in ordered_periods}
        merged.append(row)
    return merged, ordered_periods


async def fetch_isyatirim_financials(
    ticker: str,
    periods: Sequence[tuple[int, int]],
    group: str | None = None,
) -> dict[str, Any] | None:
    """All three statements for ``periods`` from İş Yatırım (one call per 4 periods).

    ``group`` defaults to auto-detection (industrial ``XI_29`` first, then
    ``UFRS`` for banks / insurers). Returns ``None`` when İş Yatırım has no data
    for the ticker; raises :class:`IsYatirimError` on transport failures.

    Result (JSON-serialisable)::

        {"group": "XI_29", "template": "industrial"|"bank"|"financial",
         "periods": ["2026/06", ...],            # newest first, only periods with data
         "items": [{"code", "label", "statement", "values": {period: float|None}}, ...]}

    Values are as İş Yatırım serves them: TL, cumulative YTD for flows, and —
    for IAS 29 (inflation accounting) reporters — fiscal year-end columns
    restated to the latest measuring unit. :func:`restatement_factor` measures
    that against KAP.
    """
    ticker = ticker.upper()
    wanted = list(dict.fromkeys(periods))
    if not wanted:
        return None
    batches = [
        wanted[i:i + _ISYATIRIM_PERIODS_PER_CALL] for i in range(0, len(wanted), _ISYATIRIM_PERIODS_PER_CALL)
    ]
    groups = [group] if group else [ISYATIRIM_GROUP_INDUSTRIAL, ISYATIRIM_GROUP_FINANCIAL]
    for candidate in groups:
        first = await _fetch_malitablo_batch(ticker, candidate, batches[0])
        if not first:
            continue
        rest = await asyncio.gather(*(_fetch_malitablo_batch(ticker, candidate, b) for b in batches[1:]))
        merged, available = _merge_batches([(batches[0], first), *zip(batches[1:], rest)])
        if not available:
            continue
        return {
            "group": candidate,
            "template": _template_for(candidate, first),
            "periods": available,
            "items": merged,
        }
    return None


def isyatirim_statement_maps(
    table: Mapping[str, Any],
) -> dict[str, dict[str, dict[str, float | None]]]:
    """``{period: {"balance"|"income"|"cashflow": {label: value}}}`` from a fetched table."""
    result: dict[str, dict[str, dict[str, float | None]]] = {
        period: {"balance": {}, "income": {}, "cashflow": {}} for period in table.get("periods", [])
    }
    for item in table.get("items", []):
        statement = item.get("statement")
        if statement not in ("balance", "income", "cashflow"):
            continue
        for period, value in (item.get("values") or {}).items():
            if period in result:
                result[period][statement][item["label"]] = to_number(value)
    return result


def restatement_factor(reported: float | None, restated: float | None) -> float | None:
    """``reported / restated`` when both are usable and the ratio is plausible.

    İş Yatırım re-expresses IAS 29 reporters' fiscal year-end columns in the
    latest measuring unit (every line × the same index ratio). Multiplying its
    values by this factor gives back the figures as originally reported on KAP.
    """
    a, b = to_number(reported), to_number(restated)
    if a is None or b is None or a == 0 or b == 0 or (a > 0) != (b > 0):
        return None
    factor = a / b
    return factor if 0.2 <= factor <= 5.0 else None


# ---------------------------------------------------------------------------
# Polling adapter (annual statements → DB)
# ---------------------------------------------------------------------------

#: ``financial_statements.statement_type`` per statement section (API values kept from v1).
STATEMENT_TYPE_BY_SECTION: dict[str, str] = {"balance": "balance_sheet", "income": "income_stmt", "cashflow": "cash_flow"}
SECTION_BY_STATEMENT_TYPE: dict[str, str] = {v: k for k, v in STATEMENT_TYPE_BY_SECTION.items()}


#: ``source_event_type`` of the refresh marker returned by :meth:`FinancialAdapter.fetch`.
FUNDAMENTALS_REFRESH_EVENT = "FUNDAMENTALS_REFRESH"


class FinancialAdapter(BaseTickerAdapter):
    """Legacy polling source ``financials`` (until it is removed from ``POLL_SOURCES``).

    The statements are fetched and stored by the fundamentals store
    (``src.services.fundamentals_service``: KAP summary + İş Yatırım quarterly
    tables, first-published facts, ratios). This adapter therefore does no
    network I/O: it returns one refresh marker per company, and
    ``FinancialService.process_financials`` runs the (freshness-gated) store
    refresh for it — the same code path as the fundamentals worker.
    """

    annual_periods = 4

    def get_source_code(self) -> str:
        return "financials"

    async def fetch(self, ticker: str, polling_state: PollingState | None = None) -> list[RawEventData]:
        ticker = ticker.strip().upper()
        return [
            RawEventData(
                external_id=f"{ticker}_fundamentals_refresh",
                source_event_type=FUNDAMENTALS_REFRESH_EVENT,
                title=f"{ticker} fundamentals refresh",
                published_at=utcnow(),
                raw_payload_json={"ticker": ticker, "refresh": True},
            )
        ]

    def _create_raw_data(self, ticker: str, statement_type: str, df: Any) -> RawEventData:
        """Build a ``RawEventData`` from ``{period: {item: value}}`` (or a period-column DataFrame)."""
        data_dict: dict[str, dict[str, Any]] = {}
        if hasattr(df, "columns") and hasattr(df, "items"):
            for col in df.columns:
                data_dict[str(col)] = {str(idx): to_number(val) for idx, val in df[col].items()}
        else:
            for period, values in dict(df).items():
                data_dict[str(period)] = {str(k): to_number(v) for k, v in dict(values).items()}

        # Content-based hash: same content → same hash, changed content → new hash.
        content_for_hash = json.dumps(data_dict, sort_keys=True, default=str)
        content_hash = hashlib.sha256(f"{ticker}_{statement_type}_{content_for_hash}".encode()).hexdigest()

        return RawEventData(
            external_id=f"{ticker}_{statement_type}_{content_hash[:12]}",
            source_event_type=f"FINANCIAL_{statement_type.upper()}",
            title=f"{ticker} {statement_type} updated",
            published_at=utcnow(),
            content_hash=content_hash,
            raw_payload_json={
                "ticker": ticker,
                "statement_type": statement_type,
                "data": data_dict,
            },
        )
