"""Finansal tablo çekirdeği.

Bu modül üç şey sağlar:

1. İş Yatırım ``MaliTablo`` istemcisi: tek istekte 4 dönem için bilanço, gelir
   tablosu ve nakit akışı (kalem kodlarıyla birlikte). borsapy'nin
   ``get_financial_statements`` sarmalayıcısı her tablo için ayrı istek atıyor,
   bankalarda (``UFRS``) veri döndürmüyor ve aynı adlı kalemleri (ör. kısa ve
   uzun vadeli "Finansal Borçlar") birleştirirken kartezyen çoğaltma yapıyor;
   bu yüzden doğrudan istemci kullanılıyor.
2. Saf (I/O'suz) yardımcılar: kalem adlarını kanonik anahtarlara eşleme,
   dönem etiketleri, kümülatif (YTD) → çeyreklik / TTM dönüşümleri ve **tek**
   oran hesabı :func:`compute_financial_ratios` (hem
   ``/fundamentals/{t}/live-ratios`` hem de DB tabanlı ``/financials/ratios``).
3. :class:`FinancialAdapter`: polling worker'ın yıllık tabloları DB'ye yazması
   için ``RawEventData`` üretir.

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
# "III. ", "16.1 ", "2.2.1 ", "A- " style numbering used by the bank/insurance templates.
_NUMBERING_RE = re.compile(r"^(?:(?:[ivxlc]+|[a-z])[.\-)]|\d+(?:\.\d+)*[.)]?)\s+")
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
    "current_assets": ("donen varliklar",),
    "current_liabilities": ("kisa vadeli yukumlulukler",),
    "non_current_liabilities": ("uzun vadeli yukumlulukler",),
    # NB: the bank summary's "Yükümlülükler Toplamı" is liabilities + equity, so it is not an alias.
    "total_liabilities": ("toplam yukumlulukler", "yukumlulukler"),
    "total_equity": ("toplam ozkaynaklar", "ozkaynaklar", "ozsermaye", "toplam ozsermaye"),
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
    "net_income": ("net donem kari (zarari)", "donem kari (zarari)", "net donem kari/zarari", "donem net kari (zarari)"),
    "net_income_parent": (
        "donem karinin (zararinin) dagilimi, ana ortaklik paylari",
        "ana ortaklik paylari",
        "donem karinin (zararinin) dagilimi, grubun kari (zarari)",
        "grubun kari/zarari",
    ),
    "net_interest_income": ("net faiz geliri veya gideri", "net faiz geliri/gideri"),
}

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
    if total_revenue is not None:
        items["revenue"] = total_revenue
    elif sales is not None:
        items["revenue"] = sales + (finance_revenue or 0.0)

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


def is_bank_items(items: Mapping[str, Any]) -> bool:
    """Heuristic: bank templates carry deposits / net interest income."""
    return to_number(items.get("deposits")) is not None or to_number(items.get("net_interest_income")) is not None


# ---------------------------------------------------------------------------
# Cumulative (YTD) → discrete quarter / TTM
# ---------------------------------------------------------------------------

def discrete_quarter_values(
    values_by_period: Mapping[str, float | None],
    fiscal_year_end_month: int = 12,
) -> dict[str, float | None]:
    """Single-quarter values from cumulative (year-to-date) values.

    Q1 = YTD(Q1); Qn = YTD(Qn) − YTD(Qn−1) of the same fiscal year. ``None``
    when the previous cumulative value is missing (never guessed).
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
        result[period] = value - prev if prev is not None else None
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
) -> dict[str, float | None] | None:
    """Trailing-twelve-month flow items ending at ``period``.

    TTM = YTD(period) + FY(previous) − YTD(same period previous year), i.e. the
    sum of the last four discrete quarters. Returns ``None`` when a required
    period is missing entirely; individual items are ``None`` when any of the
    three inputs lacks them.
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
    return result


def build_ratio_inputs(
    items_by_period: Mapping[str, Mapping[str, Any]],
    period: str,
    fiscal_year_end_month: int = 12,
) -> tuple[dict[str, float | None], dict[str, float | None] | None]:
    """``(current, previous)`` inputs for :func:`compute_financial_ratios`.

    ``current`` = TTM flows ending at ``period`` + balance sheet at ``period``;
    ``previous`` = the same one year earlier (for growth and averages), or
    ``None`` when unavailable. Raises ``ValueError`` if ``period`` has no TTM.
    """
    ttm = ttm_flows(items_by_period, period, fiscal_year_end_month)
    if ttm is None:
        raise ValueError(f"TTM hesaplanamadı: {period}")
    stocks = items_by_period[period]
    current = {**{k: to_number(stocks.get(k)) for k in STOCK_KEYS}, **ttm}

    parsed = parse_period(period)
    previous: dict[str, float | None] | None = None
    if parsed is not None:
        prev_label = period_label(parsed[0] - 1, parsed[1])
        prev_stocks = items_by_period.get(prev_label)
        if prev_stocks is not None:
            prev_ttm = ttm_flows(items_by_period, prev_label, fiscal_year_end_month)
            previous = {
                **{k: to_number(prev_stocks.get(k)) for k in STOCK_KEYS},
                **(prev_ttm or {k: None for k in FLOW_KEYS}),
            }
    return current, previous


# ---------------------------------------------------------------------------
# Ratios — the ONE implementation shared by live-ratios and /financials/ratios
# ---------------------------------------------------------------------------

#: Ratio keys returned by :func:`compute_financial_ratios` (all ``float | None``).
RATIO_KEYS: tuple[str, ...] = (
    "gross_margin",
    "operating_margin",
    "ebitda_margin",
    "net_margin",
    "roe",
    "roa",
    "current_ratio",
    "net_debt_ebitda",
    "debt_to_equity",
    "pe_ratio",
    "pb_ratio",
    "ps_ratio",
    "ev_ebitda",
    "revenue_growth_yoy",
    "net_income_growth_yoy",
)


def _pct(numerator: float | None, denominator: float | None, *, positive_denominator: bool = True) -> float | None:
    if numerator is None or denominator is None or denominator == 0:
        return None
    if positive_denominator and denominator < 0:
        return None
    return round(numerator / denominator * 100, 2)


def _ratio(numerator: float | None, denominator: float | None, *, positive_denominator: bool = True) -> float | None:
    if numerator is None or denominator is None or denominator == 0:
        return None
    if positive_denominator and denominator < 0:
        return None
    return round(numerator / denominator, 2)


def _growth(current: float | None, previous: float | None) -> float | None:
    if current is None or previous is None or previous == 0:
        return None
    return round((current - previous) / abs(previous) * 100, 2)


def _average(current: float | None, previous: float | None) -> float | None:
    if current is None:
        return None
    if previous is None:
        return current
    return (current + previous) / 2


def derive_financial_amounts(
    items: Mapping[str, Any],
    market_cap: float | None = None,
    *,
    is_bank: bool | None = None,
) -> dict[str, float | None]:
    """EBITDA, net debt and enterprise value derived from canonical items.

    EBITDA = operating profit (esas faaliyet kârı) + depreciation & amortisation
    (from the cash-flow statement). Net debt = financial debt − cash − short-term
    financial investments. EV = market cap + net debt + non-controlling
    interests. All ``None`` for banks, where these concepts do not apply.
    """
    bank = is_bank_items(items) if is_bank is None else is_bank
    if bank:
        return {"ebitda": None, "net_debt": None, "enterprise_value": None}
    operating = to_number(items.get("operating_profit"))
    d_and_a = to_number(items.get("depreciation_amortization"))
    ebitda = to_number(items.get("ebitda"))
    if ebitda is None and operating is not None and d_and_a is not None:
        ebitda = operating + d_and_a
    debt = to_number(items.get("financial_debt"))
    net_debt = None
    if debt is not None:
        net_debt = debt - (to_number(items.get("cash")) or 0.0) - (to_number(items.get("short_term_investments")) or 0.0)
    cap = to_number(market_cap)
    enterprise_value = None
    if cap is not None and cap > 0 and net_debt is not None:
        enterprise_value = cap + net_debt + (to_number(items.get("minority_interest")) or 0.0)
    return {"ebitda": ebitda, "net_debt": net_debt, "enterprise_value": enterprise_value}


def compute_financial_ratios(
    current: Mapping[str, Any],
    *,
    previous: Mapping[str, Any] | None = None,
    market_cap: float | None = None,
    is_bank: bool | None = None,
) -> dict[str, float | None]:
    """Financial ratios from canonical items (see :func:`canonical_financial_items`).

    Args:
        current: flows for a twelve-month period (a fiscal year or TTM) plus the
            balance sheet at its end, keyed by :data:`FLOW_KEYS` / :data:`STOCK_KEYS`.
        previous: the same for the period one year earlier — used for YoY growth
            and for average equity/assets. Optional.
        market_cap: price × shares outstanding in TL; valuation multiples are
            ``None`` without it.
        is_bank: bank template (margins, liquidity, leverage and EV multiples are
            not meaningful and return ``None``). Auto-detected when ``None``.

    Returns every key of :data:`RATIO_KEYS`. Margins, ROE/ROA and growth are
    percentages rounded to 2 decimals; multiples are plain ratios. Missing
    inputs, zero/negative denominators and loss-making P/E give ``None`` —
    never ``0``.
    """
    prev = previous or {}
    bank = is_bank_items(current) if is_bank is None else is_bank

    def num(mapping: Mapping[str, Any], key: str) -> float | None:
        return to_number(mapping.get(key))

    revenue = None if bank else num(current, "revenue")
    net_income = num(current, "net_income")
    parent_income = num(current, "net_income_parent")
    if parent_income is None:
        parent_income = net_income
    equity = num(current, "total_equity")
    parent_equity = num(current, "parent_equity")
    if parent_equity is None:
        parent_equity = equity
    prev_parent_equity = num(prev, "parent_equity")
    if prev_parent_equity is None:
        prev_parent_equity = num(prev, "total_equity")

    amounts = derive_financial_amounts(current, market_cap, is_bank=bank)
    ebitda = amounts["ebitda"]
    cap = to_number(market_cap)
    if cap is not None and cap <= 0:
        cap = None

    prev_parent_income = num(prev, "net_income_parent")
    if prev_parent_income is None:
        prev_parent_income = num(prev, "net_income")

    avg_equity = _average(parent_equity, prev_parent_equity)
    avg_assets = _average(num(current, "total_assets"), num(prev, "total_assets"))

    ratios: dict[str, float | None] = {key: None for key in RATIO_KEYS}
    ratios["roe"] = _pct(parent_income, avg_equity)
    ratios["roa"] = _pct(net_income, avg_assets)
    ratios["pe_ratio"] = _ratio(cap, parent_income)
    ratios["pb_ratio"] = _ratio(cap, parent_equity)
    ratios["net_income_growth_yoy"] = _growth(parent_income, prev_parent_income)
    if not bank:
        ratios["gross_margin"] = _pct(num(current, "gross_profit"), revenue)
        ratios["operating_margin"] = _pct(num(current, "operating_profit"), revenue)
        ratios["ebitda_margin"] = _pct(ebitda, revenue)
        ratios["net_margin"] = _pct(net_income, revenue)
        ratios["current_ratio"] = _ratio(num(current, "current_assets"), num(current, "current_liabilities"))
        ratios["net_debt_ebitda"] = _ratio(amounts["net_debt"], ebitda)
        ratios["debt_to_equity"] = _ratio(num(current, "total_liabilities"), equity)
        ratios["ps_ratio"] = _ratio(cap, revenue)
        ratios["ev_ebitda"] = _ratio(amounts["enterprise_value"], ebitda)
        ratios["revenue_growth_yoy"] = _growth(revenue, num(prev, "revenue"))
    return ratios


# ---------------------------------------------------------------------------
# İş Yatırım MaliTablo client
# ---------------------------------------------------------------------------

ISYATIRIM_MALITABLO_URL = (
    "https://www.isyatirim.com.tr/_Layouts/15/IsYatirim.Website/Common/Data.aspx/MaliTablo"
)
ISYATIRIM_GROUP_INDUSTRIAL = "XI_29"
ISYATIRIM_GROUP_FINANCIAL = "UFRS"
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
    if group == ISYATIRIM_GROUP_INDUSTRIAL:
        return "industrial"
    labels = {normalize_label(item.get("itemDescTr")) for item in items}
    if "mevduat" in labels or "aktif toplami" in labels:
        return "bank"
    return "financial"


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

_DB_STATEMENT_TYPES = (("balance_sheet", "balance"), ("income_stmt", "income"), ("cash_flow", "cashflow"))


class FinancialAdapter(BaseTickerAdapter):
    """Yıllık finansal tabloları (bilanço, gelir tablosu, nakit akışı) İş Yatırım'dan çeker."""

    annual_periods = 4

    def get_source_code(self) -> str:
        return "financials"

    async def fetch(self, ticker: str, polling_state: PollingState | None = None) -> list[RawEventData]:
        periods = fiscal_year_ends_before(utcnow().date(), self.annual_periods)
        try:
            table = await fetch_isyatirim_financials(ticker, periods)
        except IsYatirimError as e:
            logger.error("financial_adapter_error", ticker=ticker, error=str(e))
            return []
        if table is None:
            logger.info("financial_adapter_no_data", ticker=ticker)
            return []

        by_period = isyatirim_statement_maps(table)
        results: list[RawEventData] = []
        for statement_type, key in _DB_STATEMENT_TYPES:
            data: dict[str, dict[str, Any]] = {}
            for period, statements in by_period.items():
                values = statements[key]
                if any(v not in (None, 0) for v in values.values()):
                    parsed = parse_period(period)
                    # DB keeps the historical annual label format ("2025").
                    data[str(parsed[0]) if parsed else period] = values
            if data:
                results.append(self._create_raw_data(ticker, statement_type, data))
        logger.info("financial_adapter_fetched", ticker=ticker, count=len(results), group=table.get("group"))
        return results

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
