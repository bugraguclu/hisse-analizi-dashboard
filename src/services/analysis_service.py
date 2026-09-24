"""Financial ratio math — the ONE implementation (pure functions, no I/O).

Every ratio the application shows comes from :func:`compute_financial_ratios`:

* ``/fundamentals/{t}/live-ratios`` (``fundamentals_statements.compute_live_ratios``),
* the ``fundamentals.ratios`` job → ``financial_ratios`` rows (:func:`ratio_rows`,
  ``basis`` ``ttm`` | ``annual``) read by ``/financials/ratios``,
* the legacy statement-row path (:meth:`AnalysisService.ratios_from_statements`).

Inputs are canonical items (``FLOW_KEYS`` + ``STOCK_KEYS`` of
:mod:`src.adapters.financial_adapter`): flows for a twelve-month window (a fiscal
year or TTM) and the balance sheet at its end, plus the same one year earlier for
averages and growth. Units: margins/returns/growth in percent (``14.85``),
multiples as plain ratios; missing inputs, zero/negative denominators and
loss-making P/E give ``None`` — never ``0``.

TTM (trailing twelve months) from cumulative (year-to-date) facts:
``TTM(P) = YTD(P) + FY(previous fiscal year) − YTD(P − 12 months)``, i.e. the
sum of the four discrete quarters ending at ``P``.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.financial_adapter import (
    FLOW_KEYS,
    STOCK_KEYS,
    canonical_financial_items,
    is_bank_items,
    months_into_fiscal_year,
    parse_period,
    period_label,
    shift_months,
    sort_periods_desc,
    to_number,
    ttm_components,
    ttm_flows,
)
from src.db.models import Company, FinancialStatement
from src.db.repository import FinancialStatementRepository

logger = structlog.get_logger(__name__)

#: Ratio keys returned by :func:`compute_financial_ratios` (= the 15 ``financial_ratios`` ratio columns).
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

#: Ratios expressed in percent; the rest are plain multiples.
PERCENT_RATIO_KEYS: frozenset[str] = frozenset(
    {"gross_margin", "operating_margin", "ebitda_margin", "net_margin", "roe", "roa",
     "revenue_growth_yoy", "net_income_growth_yoy"}
)

#: Statement templates where margins, liquidity, leverage and EV multiples are not meaningful.
FINANCIAL_TEMPLATES: frozenset[str] = frozenset({"bank", "insurance", "financial"})

#: Valuation multiples (need a market capitalisation).
VALUATION_KEYS: frozenset[str] = frozenset({"pe_ratio", "pb_ratio", "ps_ratio", "ev_ebitda"})

# financial_ratios ratio columns are NUMERIC(14, 4); values this large are meaningless
# anyway (division by a near-zero EBITDA / equity) and are stored as NULL.
_MAX_ABS_RATIO = 1e8
_COLUMN_DIGITS = 2  # the API (and the stored columns) show two decimals

# Paid-in capital vs the market-cap-implied share count: a larger gap means the capital
# changed after the balance-sheet date (bonus / rights issue) — the market count wins.
SHARES_TOLERANCE = 0.15


# ---------------------------------------------------------------------------
# Primitive ratio helpers
# ---------------------------------------------------------------------------

def _rounded(value: float, digits: int | None) -> float:
    return round(value, digits) if digits is not None else value


def _pct(
    numerator: float | None,
    denominator: float | None,
    *,
    positive_denominator: bool = True,
    digits: int | None = 2,
) -> float | None:
    if numerator is None or denominator is None or denominator == 0:
        return None
    if positive_denominator and denominator < 0:
        return None
    return _rounded(numerator / denominator * 100, digits)


def _ratio(
    numerator: float | None,
    denominator: float | None,
    *,
    positive_denominator: bool = True,
    digits: int | None = 2,
) -> float | None:
    if numerator is None or denominator is None or denominator == 0:
        return None
    if positive_denominator and denominator < 0:
        return None
    return _rounded(numerator / denominator, digits)


def _growth(current: float | None, previous: float | None, *, digits: int | None = 2) -> float | None:
    """Year-over-year change in percent; ``None`` unless the base is positive.

    Growth from a loss (or zero) is not meaningful: −3.2 bn → 34.1 bn would read as
    +1,160 % (the KCHOL case), and a smaller loss would read as growth.
    """
    if current is None or previous is None or previous <= 0:
        return None
    return _rounded((current - previous) / previous * 100, digits)


def _average(current: float | None, previous: float | None) -> float | None:
    if current is None:
        return None
    if previous is None:
        return current
    return (current + previous) / 2


def _is_financial(items: Mapping[str, Any], template: str | None, is_bank: bool | None) -> bool:
    if is_bank is not None:
        return is_bank
    if template is not None:
        return template in FINANCIAL_TEMPLATES
    return is_bank_items(items)


# ---------------------------------------------------------------------------
# Ratios
# ---------------------------------------------------------------------------

def derive_financial_amounts(
    items: Mapping[str, Any],
    market_cap: float | None = None,
    *,
    is_bank: bool | None = None,
    template: str | None = None,
) -> dict[str, float | None]:
    """EBITDA, net debt and enterprise value derived from canonical items.

    EBITDA = operating profit (esas faaliyet kârı) + depreciation & amortisation
    (from the cash-flow statement). Net debt = financial debt − cash − short-term
    financial investments. EV = market cap + net debt + non-controlling
    interests. All ``None`` for banks/insurers, where these concepts do not apply.
    """
    if _is_financial(items, template, is_bank):
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
    template: str | None = None,
    digits: int | None = 2,
    valuation_stocks: Mapping[str, Any] | None = None,
) -> dict[str, float | None]:
    """Financial ratios from canonical items (see ``canonical_financial_items``).

    Args:
        current: flows for a twelve-month period (a fiscal year or TTM) plus the
            balance sheet at its end, keyed by ``FLOW_KEYS`` / ``STOCK_KEYS``.
        previous: the same for the period one year earlier — used for YoY growth
            and for average equity/assets. Optional.
        market_cap: price × shares outstanding in TL; valuation multiples are
            ``None`` without it.
        is_bank / template: bank, insurance and other financial templates skip
            margins, liquidity, leverage and EV multiples (not meaningful).
            Auto-detected from the items when neither is given.
        digits: rounding of every value (``None`` = unrounded, for audit trails).
        valuation_stocks: balance-sheet items for the valuation multiples (P/B, EV/EBITDA's
            enterprise value) when they differ from ``current``'s — the latest balance sheet
            for a fiscal-year row valued at today's price. Defaults to ``current``.

    Returns every key of :data:`RATIO_KEYS`.
    """
    prev = previous or {}
    financial = _is_financial(current, template, is_bank)

    def num(mapping: Mapping[str, Any], key: str) -> float | None:
        return to_number(mapping.get(key))

    revenue = None if financial else num(current, "revenue")
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

    amounts = derive_financial_amounts(current, market_cap, is_bank=financial)
    ebitda = amounts["ebitda"]
    cap = to_number(market_cap)
    if cap is not None and cap <= 0:
        cap = None

    prev_parent_income = num(prev, "net_income_parent")
    if prev_parent_income is None:
        prev_parent_income = num(prev, "net_income")

    avg_equity = _average(parent_equity, prev_parent_equity)
    avg_assets = _average(num(current, "total_assets"), num(prev, "total_assets"))

    valuation_amounts = amounts
    book_equity = parent_equity
    if valuation_stocks is not None:
        valued = {**current, **{key: valuation_stocks.get(key) for key in STOCK_KEYS}}
        valuation_amounts = derive_financial_amounts(valued, market_cap, is_bank=financial)
        book_equity = num(valued, "parent_equity")
        if book_equity is None:
            book_equity = num(valued, "total_equity")

    ratios: dict[str, float | None] = {key: None for key in RATIO_KEYS}
    ratios["roe"] = _pct(parent_income, avg_equity, digits=digits)
    ratios["roa"] = _pct(net_income, avg_assets, digits=digits)
    ratios["pe_ratio"] = _ratio(cap, parent_income, digits=digits)
    ratios["pb_ratio"] = _ratio(cap, book_equity, digits=digits)
    ratios["net_income_growth_yoy"] = _growth(parent_income, prev_parent_income, digits=digits)
    if not financial:
        ratios["gross_margin"] = _pct(num(current, "gross_profit"), revenue, digits=digits)
        ratios["operating_margin"] = _pct(num(current, "operating_profit"), revenue, digits=digits)
        ratios["ebitda_margin"] = _pct(ebitda, revenue, digits=digits)
        ratios["net_margin"] = _pct(net_income, revenue, digits=digits)
        ratios["current_ratio"] = _ratio(
            num(current, "current_assets"), num(current, "current_liabilities"), digits=digits
        )
        ratios["net_debt_ebitda"] = _ratio(amounts["net_debt"], ebitda, digits=digits)
        ratios["debt_to_equity"] = _ratio(num(current, "total_liabilities"), equity, digits=digits)
        ratios["ps_ratio"] = _ratio(cap, revenue, digits=digits)
        ratios["ev_ebitda"] = _ratio(valuation_amounts["enterprise_value"], ebitda, digits=digits)
        ratios["revenue_growth_yoy"] = _growth(revenue, num(prev, "revenue"), digits=digits)
    return ratios


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


def trailing_quarters(period: str) -> list[str]:
    """The four quarter-end labels a twelve-month window ending at ``period`` covers (oldest first)."""
    parsed = parse_period(period)
    if parsed is None:
        return []
    return [period_label(*shift_months(parsed[0], parsed[1], -3 * i)) for i in range(3, -1, -1)]


# ---------------------------------------------------------------------------
# Market inputs (price, shares)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class MarketInputs:
    """Price and share-count evidence for valuation multiples.

    ``implied_shares`` = the provider's market capitalisation ÷ the price it was
    computed at (TradingView ``market_cap_basic`` / previous close); it is the
    robust share count (TradingView's ``total_shares_outstanding`` is wrong for
    some companies, e.g. KCHOL 1.86 bn instead of 2.54 bn).
    """

    price: float | None = None
    price_source: str | None = None  # "quotes" | "tradingview" | "snapshot"
    price_time: str | None = None  # ISO timestamp / session date of the price
    total_shares: float | None = None  # TradingView total_shares_outstanding
    implied_shares: float | None = None
    provider_market_cap: float | None = None
    provider_pe: float | None = None  # TradingView price_earnings_ttm (cross-check only)
    provider_pb: float | None = None  # TradingView price_book_fq — latest quarter's equity (cross-check only)
    provider_revenue_ttm: float | None = None  # TradingView total_revenue_ttm (cross-check only)
    provider_net_income_ttm: float | None = None  # TradingView net_income_ttm (cross-check only)
    provider_period: str | None = None  # TradingView fiscal_period_current, e.g. "2026-Q2"

    def as_dict(self) -> dict[str, Any]:
        return {
            "price": self.price,
            "price_source": self.price_source,
            "price_time": self.price_time,
            "tradingview_total_shares": self.total_shares,
            "tradingview_implied_shares": self.implied_shares,
            "provider_market_cap": self.provider_market_cap,
        }


def _positive(value: Any) -> float | None:
    number = to_number(value)
    return number if number is not None and number > 0 else None


def choose_shares(
    paid_in_capital: float | None,
    market: MarketInputs | None,
) -> tuple[float | None, str | None, list[str]]:
    """``(shares, shares_source, notes)`` for the market capitalisation.

    BIST shares have a 1 TL nominal value, so the paid-in capital of the latest
    balance sheet *is* the share count (``paid_in_capital``). When the market's
    implied count differs by more than :data:`SHARES_TOLERANCE` the capital has
    changed since the balance-sheet date (bonus/rights issue) and the market
    count is used (``tradingview_mcap``). Without a paid-in capital the implied
    count, then TradingView's reported count (``tradingview``) are used.
    """
    capital = _positive(paid_in_capital)
    implied = _positive(market.implied_shares) if market else None
    reported = _positive(market.total_shares) if market else None
    notes: list[str] = []
    if capital is not None:
        if implied is not None and abs(capital / implied - 1) > SHARES_TOLERANCE:
            notes.append(
                f"Ödenmiş sermaye ({capital:,.0f}) piyasa değerinden türetilen pay adedinden "
                f"%{abs(capital / implied - 1) * 100:.1f} farklı; bilanço tarihinden sonra sermaye değişmiş olabilir."
            )
            return float(round(implied)), "tradingview_mcap", notes
        return capital, "paid_in_capital", notes
    if implied is not None:
        return float(round(implied)), "tradingview_mcap", notes
    if reported is not None:
        return float(round(reported)), "tradingview", notes
    return None, None, notes


# ---------------------------------------------------------------------------
# financial_ratios rows (ttm / annual) from canonical facts
# ---------------------------------------------------------------------------

_TTM_REPORTED_FLOWS = (
    "revenue", "gross_profit", "operating_profit", "depreciation_amortization", "net_income", "net_income_parent",
)


def _finite(value: Any) -> float | None:
    number = to_number(value)
    return number if number is not None and math.isfinite(number) else None


def _storable(value: float | None) -> float | None:
    if value is None or not math.isfinite(value) or abs(value) >= _MAX_ABS_RATIO:
        return None
    return value


def _decimal(value: float | None, digits: int) -> Decimal | None:
    if value is None or not math.isfinite(value):
        return None
    return Decimal(str(round(value, digits)))


def _window_flows(
    facts_by_period: Mapping[str, Mapping[str, Any]],
    period: str,
    fiscal_year_end_month: int,
) -> tuple[dict[str, float | None] | None, dict[str, str], list[str]]:
    """Twelve-month flows ending at ``period`` + the facts periods they come from + missing periods."""
    components = ttm_components(period, fiscal_year_end_month)
    if components is None:
        if period not in facts_by_period:
            return None, {}, [period]
        return ttm_flows(facts_by_period, period, fiscal_year_end_month), {"fiscal_year": period}, []
    latest, fiscal_year, prior = components
    missing = [p for p in (latest, fiscal_year, prior) if p not in facts_by_period]
    used = {"latest": latest, "fiscal_year": fiscal_year, "prior_ytd": prior}
    if missing:
        return None, used, missing
    return ttm_flows(facts_by_period, period, fiscal_year_end_month), used, []


def _has_balance_sheet(items: Mapping[str, Any]) -> bool:
    return _finite(items.get("total_assets")) is not None or _finite(items.get("total_equity")) is not None


def _period_inputs(
    facts_by_period: Mapping[str, Mapping[str, Any]],
    period: str,
    fiscal_year_end_month: int,
) -> dict[str, Any]:
    stocks = {k: _finite(facts_by_period[period].get(k)) for k in STOCK_KEYS}
    flows, flow_periods, missing = _window_flows(facts_by_period, period, fiscal_year_end_month)
    fiscal_year: dict[str, Any] | None = None
    components = ttm_components(period, fiscal_year_end_month)
    if components is not None and components[1] in facts_by_period:
        fiscal_year = {
            "period": components[1],
            "flows": ttm_flows(facts_by_period, components[1], fiscal_year_end_month),
        }
    parsed = parse_period(period)
    previous: dict[str, Any] | None = None
    if parsed is not None:
        prev_label = period_label(parsed[0] - 1, parsed[1])
        if prev_label in facts_by_period:
            prev_flows, prev_flow_periods, prev_missing = _window_flows(
                facts_by_period, prev_label, fiscal_year_end_month
            )
            previous = {
                "period": prev_label,
                "stocks": {k: _finite(facts_by_period[prev_label].get(k)) for k in STOCK_KEYS},
                "flows": prev_flows,
                "flow_periods": prev_flow_periods,
                "missing": prev_missing,
            }
    return {
        "stocks": stocks,
        "flows": flows,
        "flow_periods": flow_periods,
        "missing": missing,
        "previous": previous,
        "fiscal_year": fiscal_year,
    }


def ratio_rows(
    facts_by_period: Mapping[str, Mapping[str, Any]],
    *,
    fiscal_year_end_month: int = 12,
    template: str | None = None,
    market: MarketInputs | None = None,
    sources_by_period: Mapping[str, Mapping[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """``financial_ratios`` rows for every period of canonical, cumulative facts.

    * ``basis="ttm"`` for every period: flows = trailing twelve months ending at
      the period (``ttm_quarters`` lists the four quarters; empty when a needed
      cumulative period is missing — flow ratios are then ``None``), stocks =
      the period-end balance sheet.
    * ``basis="annual"`` for fiscal year-ends: flows = the fiscal year.

    Valuation (``market_cap``, ``price``, ``shares_*``, P/E, P/B, P/S, EV/EBITDA)
    is attached to the latest row of each basis only — a historical period
    priced at today's quote would be misleading — and always uses the latest
    balance sheet (book equity, net debt, paid-in capital → share count): the
    annual row is today's price against the last fiscal year's flows and today's
    book value (TradingView's ``price_book_fq`` convention). A TTM row whose
    EBITDA cannot be built (TTM operating profit or D&A missing — e.g. a holding's
    "esas faaliyet kârı" rejected for İş Yatırım) takes its EBITDA-based ratios
    from the last fiscal year, labelled in ``inputs_json.ratio_bases`` /
    ``ratios_basis_note``. ``inputs_json`` carries every input so each ratio can
    be recomputed; ``raw_ratios_json`` the unrounded values. Rows without a
    single computable ratio are omitted.
    """
    periods = [p for p in sort_periods_desc(facts_by_period) if parse_period(p) is not None]
    valuation_period = next((p for p in periods if _has_balance_sheet(facts_by_period[p])), None)
    valuation = (
        (valuation_period, {k: _finite(facts_by_period[valuation_period].get(k)) for k in STOCK_KEYS})
        if valuation_period is not None
        else None
    )
    rows: list[dict[str, Any]] = []
    valued: set[str] = set()
    for period in periods:
        parsed = parse_period(period)
        assert parsed is not None
        is_year_end = months_into_fiscal_year(parsed[1], fiscal_year_end_month) == 12
        inputs = _period_inputs(facts_by_period, period, fiscal_year_end_month)
        for basis in ("ttm", "annual"):
            if basis == "annual" and not is_year_end:
                continue
            row = _ratio_row(
                period,
                basis,
                inputs,
                template=template,
                fiscal_year_end_month=fiscal_year_end_month,
                market=market if basis not in valued else None,
                sources=(sources_by_period or {}).get(period),
                valuation=valuation,
            )
            if row is None:
                continue
            valued.add(basis)
            rows.append(row)
    return rows


_EBITDA_INPUT_LABELS = {"operating_profit": "esas faaliyet kârı", "depreciation_amortization": "amortisman"}
_EBITDA_RATIOS = ("ebitda_margin", "net_debt_ebitda", "ev_ebitda")


def _ratio_row(
    period: str,
    basis: str,
    inputs: Mapping[str, Any],
    *,
    template: str | None,
    fiscal_year_end_month: int,
    market: MarketInputs | None,
    sources: Mapping[str, Any] | None,
    valuation: tuple[str, Mapping[str, float | None]] | None = None,
) -> dict[str, Any] | None:
    stocks: dict[str, float | None] = inputs["stocks"]
    flows: dict[str, float | None] | None = inputs["flows"]
    previous_info: dict[str, Any] | None = inputs["previous"]
    current: dict[str, float | None] = {**stocks, **(flows or {k: None for k in FLOW_KEYS})}
    previous: dict[str, float | None] | None = None
    if previous_info is not None:
        previous = {**previous_info["stocks"], **(previous_info["flows"] or {k: None for k in FLOW_KEYS})}
    financial = template in FINANCIAL_TEMPLATES

    # Valuation uses the latest balance sheet (book equity, net debt, share capital).
    valuation_period, valuation_stocks = valuation if valuation is not None else (period, stocks)
    later_balance_sheet = market is not None and valuation_period != period

    notes: list[str] = []
    market_block: dict[str, Any] | None = None
    shares = shares_source = market_cap = price = None
    if market is not None:
        shares, shares_source, share_notes = choose_shares(valuation_stocks.get("paid_in_capital"), market)
        notes.extend(share_notes)
        price = _positive(market.price)
        if price is not None and shares is not None:
            market_cap = price * shares
        market_block = {
            **market.as_dict(),
            "paid_in_capital": valuation_stocks.get("paid_in_capital"),
            "shares": shares,
            "shares_source": shares_source,
            "market_cap": market_cap,
            "balance_sheet_period": valuation_period,
        }
        if later_balance_sheet:
            notes.append(
                f"Değerleme çarpanları (PD/DD, FD) en son bilançoya ({valuation_period}) göre; "
                f"akım kalemleri {period} dönemine ait."
            )

    raw = compute_financial_ratios(
        current, previous=previous, market_cap=market_cap, template=template, digits=None,
        valuation_stocks=valuation_stocks if later_balance_sheet else None,
    )
    amounts = derive_financial_amounts(current, market_cap, template=template)
    valuation_amounts = (
        derive_financial_amounts({**current, **valuation_stocks}, market_cap, template=template)
        if later_balance_sheet else amounts
    )

    # TTM EBITDA impossible (a TTM operating profit / D&A is missing) → the last fiscal year's.
    ratio_bases: dict[str, str] = {}
    basis_note: str | None = None
    fallback: dict[str, Any] | None = None
    fiscal_year = inputs.get("fiscal_year")
    if basis == "ttm" and flows is not None and not financial and amounts["ebitda"] is None and fiscal_year:
        fy_flows = fiscal_year.get("flows") or {}
        fy_ebitda = derive_financial_amounts({**stocks, **fy_flows}, None, template=template)["ebitda"]
        if fy_ebitda is not None:
            fy_revenue = _finite(fy_flows.get("revenue"))
            raw["ebitda_margin"] = _pct(fy_ebitda, fy_revenue, digits=None)
            raw["net_debt_ebitda"] = _ratio(amounts["net_debt"], fy_ebitda, digits=None)
            raw["ev_ebitda"] = _ratio(valuation_amounts["enterprise_value"], fy_ebitda, digits=None)
            fy_period = str(fiscal_year["period"])
            ratio_bases = {k: f"annual:{fy_period}" for k in _EBITDA_RATIOS if raw.get(k) is not None}
            missing_inputs = [k for k in ("operating_profit", "depreciation_amortization") if flows.get(k) is None]
            basis_note = (
                "Son 12 ay FAVÖK hesaplanamadı (eksik: "
                + ", ".join(_EBITDA_INPUT_LABELS[k] for k in missing_inputs)
                + f"); FAVÖK bazlı oranlar son mali yılın ({fy_period}) FAVÖK'üyle hesaplandı."
            )
            fallback = {"period": fy_period, "ebitda": fy_ebitda, "revenue": fy_revenue,
                        "missing_ttm_inputs": missing_inputs}
            notes.append(basis_note)

    raw = {k: _storable(v) for k, v in raw.items()}
    if all(v is None for v in raw.values()):
        return None
    columns = {k: _decimal(v, _COLUMN_DIGITS) for k, v in raw.items()}

    if flows is None:
        notes.append("Son 12 ay akım kalemleri hesaplanamadı (eksik dönem: " + ", ".join(inputs["missing"]) + ").")
    parent_equity = stocks.get("parent_equity") if stocks.get("parent_equity") is not None else stocks.get("total_equity")
    prev_parent_equity = None
    if previous is not None:
        prev_parent_equity = (
            previous.get("parent_equity") if previous.get("parent_equity") is not None else previous.get("total_equity")
        )
    inputs_json: dict[str, Any] = {
        "version": 2,
        "period": period,
        "basis": basis,
        "template": template,
        "fiscal_year_end_month": fiscal_year_end_month,
        "flows": None if flows is None else {k: flows.get(k) for k in FLOW_KEYS},
        "flow_periods": inputs["flow_periods"],
        "stocks": stocks,
        "previous": previous_info,
        "derived": {
            "ebitda": amounts["ebitda"],
            "net_debt": amounts["net_debt"],
            "enterprise_value": valuation_amounts["enterprise_value"],
            "valuation_net_debt": valuation_amounts["net_debt"],
            "ebitda_annual_fallback": fallback,
            "average_parent_equity": _average(parent_equity, prev_parent_equity),
            "average_total_assets": _average(
                stocks.get("total_assets"), previous.get("total_assets") if previous else None
            ),
        },
        "market": market_block,
        "valuation_scope": "latest_period" if market_block is not None else None,
        "valuation_stocks": dict(valuation_stocks) if later_balance_sheet else None,
        "ratio_bases": ratio_bases or None,
        "ratios_basis_note": basis_note,
        "financial_template": financial,
        "sources": dict(sources) if sources else None,
        "notes": notes,
    }
    return {
        "period": period,
        "basis": basis,
        **columns,
        "market_cap": _decimal(market_cap, 2),
        "price": _decimal(price, 4),
        "shares_outstanding": Decimal(int(round(shares))) if shares is not None else None,
        "shares_source": shares_source,
        "ttm_quarters": trailing_quarters(period) if flows is not None else [],
        "raw_ratios_json": raw,
        "inputs_json": inputs_json,
    }


# ---------------------------------------------------------------------------
# Legacy: ratios straight from stored statement rows ({label: value} views)
# ---------------------------------------------------------------------------

#: financial_ratios columns filled by :meth:`AnalysisService.ratios_from_statements`.
DB_RATIO_COLUMNS: tuple[str, ...] = (
    "roe",
    "roa",
    "net_margin",
    "gross_margin",
    "ebitda_margin",
    "pe_ratio",
    "pb_ratio",
    "ps_ratio",
    "debt_to_equity",
    "current_ratio",
    "net_debt_ebitda",
)

StatementsByType = Mapping[str, Mapping[str, Any]]


def _items(statements: StatementsByType) -> dict[str, float | None]:
    return canonical_financial_items(
        balance=statements.get("balance_sheet"),
        income=statements.get("income_stmt"),
        cashflow=statements.get("cash_flow"),
    )


def compute_period_ratios(
    current: StatementsByType, previous: StatementsByType | None = None
) -> dict[str, float | None]:
    """All ratios for one annual period from ``{statement_type: {label: value}}``.

    ``previous`` (the year before) enables average equity/assets and growth.
    """
    return compute_financial_ratios(_items(current), previous=_items(previous) if previous else None)


def _statements_by_period(statements: Iterable[FinancialStatement]) -> dict[str, dict[str, Mapping[str, Any]]]:
    grouped: dict[str, dict[str, Mapping[str, Any]]] = {}
    for stmt in statements:
        grouped.setdefault(stmt.period, {})[stmt.statement_type] = stmt.data_json or {}
    return grouped


def _previous_period(period: str, available: Iterable[str]) -> str | None:
    """The stored period exactly one year before ``period`` (same month)."""
    parsed = parse_period(period)
    if parsed is None:
        return None
    target = (parsed[0] - 1, parsed[1])
    return next((p for p in available if parse_period(p) == target), None)


class AnalysisService:
    """Legacy entry point: ratios from one source's stored statement rows."""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.fs_repo = FinancialStatementRepository(session)

    def ratios_from_statements(
        self, statements: Sequence[FinancialStatement], period: str, ticker: str | None = None
    ) -> dict[str, Any]:
        """``financial_ratios`` column values for ``period`` (Decimals, ``None`` when
        not computable) plus ``raw_ratios_json`` with every computed ratio. Empty when
        the period lacks a balance sheet or an income statement."""
        grouped = _statements_by_period(statements)
        current = grouped.get(period)
        if not current or "balance_sheet" not in current or "income_stmt" not in current:
            logger.info("ratio_inputs_missing", ticker=ticker, period=period)
            return {}
        previous_key = _previous_period(period, grouped)
        ratios = compute_period_ratios(current, grouped[previous_key] if previous_key else None)

        columns: dict[str, Any] = {}
        for name in DB_RATIO_COLUMNS:
            value = _storable(ratios.get(name))
            columns[name] = Decimal(str(value)) if value is not None else None
        if all(v is None for v in columns.values()):
            return {}
        columns["raw_ratios_json"] = {k: _storable(v) for k, v in ratios.items()}
        return columns

    async def calculate_ratios(self, company: Company, period: str) -> dict[str, Any]:
        """Load the company's statements and compute ratios for ``period``."""
        statements = await self.fs_repo.get_for_company(company.id)
        return self.ratios_from_statements(statements, period, ticker=company.ticker)


__all__ = [
    "DB_RATIO_COLUMNS",
    "FINANCIAL_TEMPLATES",
    "PERCENT_RATIO_KEYS",
    "RATIO_KEYS",
    "SHARES_TOLERANCE",
    "VALUATION_KEYS",
    "AnalysisService",
    "MarketInputs",
    "build_ratio_inputs",
    "choose_shares",
    "compute_financial_ratios",
    "compute_period_ratios",
    "derive_financial_amounts",
    "ratio_rows",
    "trailing_quarters",
]
