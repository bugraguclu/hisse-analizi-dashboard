"""Golden-value tests of our own calculations, each derived by hand in its docstring/comment.

Covers the November 2026 calculation audit: one P/E for every payload, ROE with a negative
opening equity, parent/total basis kept per pair, missing cash, IAS 29 TTM without a CPI
factor, unit rounding of small amounts, the 52-week range, weekly bars and their reference.
"""

from __future__ import annotations

import math
import uuid
from datetime import datetime

import pandas as pd
import pytest

from src.adapters import fundamentals_snapshot as fs
from src.adapters import index_adapter, price
from src.adapters.financial_adapter import cpi_quarter_factors, discrete_quarter_values, ttm_flows
from src.adapters.fundamentals_statements import _rescale, compute_live_ratios
from src.adapters.utils import ISTANBUL_TZ, adapter_cache
from src.services import market_service as ms
from src.services.analysis_service import compute_financial_ratios, derive_financial_amounts


@pytest.fixture(autouse=True)
def _clean_cache():
    adapter_cache.clear()
    yield
    adapter_cache.clear()


# ---------------------------------------------------------------------------
# One P/E: market cap ÷ stored TTM parent net income
# ---------------------------------------------------------------------------

# THYAO, 23 Nov 2026 (recorded): 321 TL × 1.38 bn shares; TTM parent net income 117,474 mn.
THYAO_CAP = 442_980_000_000
THYAO_TTM_PARENT = 117_474_000_000


def test_price_to_earnings_prefers_the_statements_over_providers():
    assert ms.price_to_earnings(THYAO_CAP, THYAO_TTM_PARENT, 3.94) == (3.77, ms.PE_SOURCE_STATEMENTS)
    # a loss has no P/E, even when the provider shows one
    assert ms.price_to_earnings(THYAO_CAP, -1e9, 3.94) == (None, ms.PE_SOURCE_STATEMENTS)
    assert ms.price_to_earnings(THYAO_CAP, 0, 3.94) == (None, ms.PE_SOURCE_STATEMENTS)
    # no stored earnings / no market cap → the provider figure; a negative provider P/E is dropped
    assert ms.price_to_earnings(THYAO_CAP, None, 3.94) == (3.94, ms.PE_SOURCE_PROVIDER)
    assert ms.price_to_earnings(None, THYAO_TTM_PARENT, 3.0) == (3.0, ms.PE_SOURCE_PROVIDER)
    assert ms.price_to_earnings(None, None, -2.5) == (None, None)
    assert ms.price_to_earnings(None, None, float("nan")) == (None, None)


THYAO_ROW = {
    "close": 321.0, "open": 330.5, "high": 333.5, "low": 318.25, "change": -2.4316, "change_abs": -8.0,
    "volume": 37264367, "Value.Traded": 1.2e10, "market_cap_basic": 4.43e11, "total_shares_outstanding": 1.38e9,
    "price_book_fq": 0.39, "price_earnings_ttm": 3.94, "description": "THY", "currency": "TRY",
    "update_time": 1795446600, "time": 1795413600,
}


def test_quote_strip_and_chart_header_show_the_ratios_card_pe():
    capital = ms.CompanyCapital(capital=1_380_000_000, equity=1_135_000_000_000)
    now = datetime(2026, 11, 23, 21, 0, tzinfo=ISTANBUL_TZ)
    snap = fs._snapshot_from_scan(THYAO_ROW, {"pe_ratio": 3.0}, capital=capital, ttm_earnings=THYAO_TTM_PARENT,
                                  now=now)
    assert snap["market_cap"] == THYAO_CAP
    assert snap["pe_ratio"] == 3.77 and snap["pe_source"] == ms.PE_SOURCE_STATEMENTS

    quote = {"last": 321.0, "prev_close": 329.0, "change": -8.0, "change_percent": -2.43}
    info = index_adapter._ticker_info(quote, {"pe_ratio": 3.0}, {}, capital=capital, ttm_earnings=THYAO_TTM_PARENT)
    assert info["pe_ratio"] == snap["pe_ratio"] == 3.77

    # without stored earnings each falls back to its provider (as before the fix)
    assert fs._snapshot_from_scan(THYAO_ROW, {}, capital=capital, now=now)["pe_ratio"] == 3.94
    assert index_adapter._ticker_info(quote, {"pe_ratio": 3.0}, {}, capital=capital)["pe_ratio"] == 3.0
    notes = ms.official_notes({"pe_source": ms.PE_SOURCE_STATEMENTS})
    assert notes == ["F/K: son 12 ay ana ortaklık net kârı (KAP tabloları)"]


async def test_latest_ttm_earnings_reads_the_newest_ttm_row_per_company(pg_session):
    from src.db.models import Company, FinancialRatio
    from src.db.repositories.fundamentals import FundamentalsRepository

    def company(ticker):
        return Company(id=uuid.uuid4(), ticker=ticker, legal_name=ticker, display_name=ticker, tracking_tier="core")

    thy, kch, garan, empty = company("THYAO"), company("KCHOL"), company("GARAN"), company("EMPTY")
    pg_session.add_all([thy, kch, garan, empty])
    await pg_session.flush()

    def ratio(c, period, basis, flows):
        return FinancialRatio(id=uuid.uuid4(), company_id=c.id, period=period, basis=basis,
                              inputs_json={"flows": flows} if flows is not None else {})

    pg_session.add_all([
        ratio(thy, "2026/09", "ttm", {"net_income_parent": 117_474e6, "net_income": 117_394e6}),
        ratio(thy, "2026/06", "ttm", {"net_income_parent": 1.0}),
        ratio(thy, "2026/12", "annual", {"net_income_parent": 2.0}),  # annual rows never count
        ratio(kch, "2026/09", "ttm", {"net_income_parent": None, "net_income": 128_934e6}),  # parent unknown
        ratio(garan, "2026/09", "ttm", None),  # no flows (window incomplete) → older row
        ratio(garan, "2025/12", "ttm", {"net_income_parent": 99e9}),
        ratio(empty, "2026/09", "ttm", None),
    ])
    await pg_session.commit()

    repo = FundamentalsRepository(pg_session)
    assert await repo.latest_ttm_earnings() == {"THYAO": 117_474e6, "KCHOL": 128_934e6, "GARAN": 99e9}
    assert await repo.latest_ttm_earnings(["THYAO"]) == {"THYAO": 117_474e6}


# ---------------------------------------------------------------------------
# Ratio edge cases (analysis_service)
# ---------------------------------------------------------------------------

GOLDEN_CURRENT = {
    "revenue": 1000, "gross_profit": 400, "operating_profit": 200, "depreciation_amortization": 50,
    "net_income": 120, "net_income_parent": 100, "total_equity": 600, "parent_equity": 500, "total_assets": 2000,
    "total_liabilities": 1400, "current_assets": 800, "current_liabilities": 400, "financial_debt": 700,
    "cash": 100, "short_term_investments": 50, "minority_interest": 100,
}
GOLDEN_PREVIOUS = {"revenue": 800, "net_income_parent": 80, "net_income": 90, "parent_equity": 400,
                   "total_equity": 480, "total_assets": 1800}


def test_full_golden_ratio_set():
    r = compute_financial_ratios(GOLDEN_CURRENT, previous=GOLDEN_PREVIOUS, market_cap=1500, is_bank=False)
    assert (r["gross_margin"], r["operating_margin"], r["ebitda_margin"], r["net_margin"]) == (40, 20, 25, 12)
    assert r["roe"] == 22.22  # 100 / ((500 + 400) / 2)
    assert r["roa"] == 6.32  # 120 / ((2000 + 1800) / 2)
    assert r["current_ratio"] == 2.0 and r["debt_to_equity"] == 2.33  # 1400 / 600
    assert r["net_debt_ebitda"] == 2.2  # (700 − 100 − 50) / 250
    assert (r["pe_ratio"], r["pb_ratio"], r["ps_ratio"]) == (15, 3, 1.5)
    assert r["ev_ebitda"] == 8.6  # (1500 + 550 + 100) / 250
    assert r["revenue_growth_yoy"] == 25 and r["net_income_growth_yoy"] == 25


def test_roe_uses_closing_equity_when_the_opening_equity_is_negative():
    # (500 + (−480)) / 2 = 10 would make a 100 profit a 1,000 % ROE
    ratios = compute_financial_ratios(
        {"net_income_parent": 100, "parent_equity": 500}, previous={"parent_equity": -480}, is_bank=False
    )
    assert ratios["roe"] == 20.0


def test_growth_and_roe_never_mix_parent_and_total_figures():
    # current year has only the total (120), previous both (parent 80, total 90): total vs total
    r = compute_financial_ratios({"net_income": 120}, previous={"net_income_parent": 80, "net_income": 90},
                                 is_bank=False)
    assert r["net_income_growth_yoy"] == 33.33  # not 50 (120 vs parent 80)
    # parent on one side only, total on the other only → no pair, no growth
    r = compute_financial_ratios({"net_income_parent": 120}, previous={"net_income": 90}, is_bank=False)
    assert r["net_income_growth_yoy"] is None and r["pe_ratio"] is None
    # equity: parent this year, total last year only → closing parent equity alone
    r = compute_financial_ratios({"net_income_parent": 60, "parent_equity": 300},
                                 previous={"total_equity": 900}, is_bank=False)
    assert r["roe"] == 20.0


def test_missing_cash_leaves_net_debt_and_ev_unknown():
    amounts = derive_financial_amounts({"financial_debt": 700, "operating_profit": 200,
                                        "depreciation_amortization": 50}, 1500, is_bank=False)
    assert amounts == {"ebitda": 250, "net_debt": None, "enterprise_value": None}
    # a missing short-term investments line means none: 700 − 100 = 600
    amounts = derive_financial_amounts({"financial_debt": 700, "cash": 100}, 1500, is_bank=False)
    assert amounts["net_debt"] == 600 and amounts["enterprise_value"] == 2100


# ---------------------------------------------------------------------------
# IAS 29 single quarters and TTM
# ---------------------------------------------------------------------------

def test_cpi_quarter_factor_is_the_product_of_the_three_monthly_changes():
    factors = cpi_quarter_factors({"2025-04": 3.0, "2025-05": 1.5, "2025-06": 1.4})
    assert factors["2025/06"] == pytest.approx(1.03 * 1.015 * 1.014, rel=1e-12)  # 1.0600863


def test_june_year_end_ias29_quarters_and_ttm():
    """Fiscal year July–June, every monthly CPI change 2 % (factor 1.02³ = 1.061208)."""
    f = 1.02**3
    ytd = {"2024/09": 100.0, "2024/12": 210.0, "2025/03": 330.0, "2025/06": 460.0,
           "2025/09": 120.0, "2025/12": 250.0, "2026/03": 390.0}
    factors = {p: f for p in ("2024/12", "2025/03", "2025/12", "2026/03")}
    quarters = discrete_quarter_values(ytd, 6, factors)
    assert quarters["2024/09"] == 100  # Q1 = YTD
    assert quarters["2024/12"] == pytest.approx(210 - 100 * f)  # 103.8792
    assert quarters["2025/03"] == pytest.approx(330 - 210 * f)  # 107.1463
    assert quarters["2025/06"] == 130  # Q4 = FY − 9M, no factor
    items = {p: {"revenue": v} for p, v in ytd.items()}
    ttm = ttm_flows(items, "2026/03", 6, factors)
    assert ttm is not None
    expected = (250 - 120 * f) + (390 - 250 * f) + 120 + 130  # 2026/03, 2025/12, 2025/09, 2025/06
    assert ttm["revenue"] == pytest.approx(expected) == pytest.approx(497.3530, abs=1e-4)


def test_a_missing_cpi_factor_means_no_ttm_and_the_card_falls_back_to_the_fiscal_year():
    flows = {"revenue": None, "gross_profit": None, "operating_profit": None, "net_income": None}

    def period(revenue, income, assets=1000.0):
        return {**flows, "revenue": revenue, "net_income": income, "net_income_parent": income,
                "total_assets": assets, "total_equity": 500.0, "parent_equity": 500.0, "paid_in_capital": 100.0}

    items = {
        "2025/03": period(100, 10), "2025/06": period(210, 21), "2025/09": period(330, 33), "2025/12": period(450, 45),
        "2026/03": period(120, 12), "2026/06": period(250, 25),
    }
    complete = {"2025/06": 1.06, "2025/09": 1.07, "2026/06": 1.07}
    assert ttm_flows(items, "2026/06", 12, complete) is not None
    gap = {"2025/06": 1.06, "2026/06": 1.07}  # 2025/09 missing (a CPI gap)
    assert ttm_flows(items, "2026/06", 12, gap) is None

    card = compute_live_ratios(items, price=20.0, quarter_factors=gap)
    assert card is not None and card["basis"] == "annual" and card["as_of"] == "2025/12"
    assert card["ratios"]["net_margin"] == 10.0  # FY 45 / 450, not an all-empty TTM
    assert card["ratios"]["pe_ratio"] == round(20 * 100 / 45, 2)  # 2,000 / 45 = 44.44


def test_rescale_never_turns_a_small_amount_into_zero():
    assert _rescale(400_000, 0.85, 1e6) == 340_000  # half a unit would round to 0
    assert _rescale(2_600_000, 0.85, 1e6) == 2_000_000  # 2.21 mn → the KAP unit
    assert _rescale(0, 0.85, 1e6) == 0
    assert _rescale(-400_000, 0.85, 1e6) == -340_000


# ---------------------------------------------------------------------------
# Market: 52-week range, weekly bars and their reference close
# ---------------------------------------------------------------------------

def _bars(days, highs, closes, opens=None):
    index = pd.DatetimeIndex([pd.Timestamp(f"{d} 09:00") for d in days]).tz_localize(ISTANBUL_TZ)
    return pd.DataFrame({"Open": opens or closes, "High": highs, "Low": [min(h, c) for h, c in zip(highs, closes)],
                         "Close": closes, "Volume": [1.0] * len(days)}, index=index)


def test_52_week_range_does_not_depend_on_the_time_of_day():
    frame = _bars(["2025-11-24", "2025-11-25", "2026-11-24"], [500.0, 7.0, 6.0], [5.0, 5.0, 5.0])
    morning = price.daily_stats(frame, datetime(2026, 11, 24, 8, 0, tzinfo=ISTANBUL_TZ))
    afternoon = price.daily_stats(frame, datetime(2026, 11, 24, 14, 0, tzinfo=ISTANBUL_TZ))
    assert morning["year_high"] == afternoon["year_high"] == 7.0  # 24 Nov 2025 is a year ago, out


def test_weekly_open_is_the_first_sessions_open():
    frame = _bars(["2026-11-16", "2026-11-17", "2026-11-23"], [20.0, 21.0, 32.0], [19.0, 20.0, 31.0],
                  opens=[float("nan"), 19.0, 30.0])
    weekly = ms.weekly_from_daily(frame)
    assert math.isnan(weekly["Open"].iloc[0])  # not Tuesday's 19
    assert weekly["Open"].iloc[1] == 30.0
    assert list(weekly["Close"]) == [20.0, 31.0] and list(weekly["High"]) == [21.0, 32.0]


def test_weekly_reference_is_dated_with_the_session_of_its_close():
    days = list(pd.bdate_range("2024-11-01", "2024-12-13").strftime("%Y-%m-%d"))
    closes = [float(i + 1) for i in range(len(days))]
    daily = _bars(days, closes, closes)
    weekly = ms.weekly_from_daily(daily)
    start = pd.Timestamp("2024-11-26", tz=ISTANBUL_TZ)  # a Tuesday
    window, before = weekly[weekly.index >= start], weekly[weekly.index < start]
    reference = ms._daily_reference(daily, window, before)
    # window opens with the week of Mon 2 Dec; its base is Friday 29 Nov's close (same value as
    # the weekly bar before it), dated 29 Nov — not that bar's Monday stamp (25 Nov)
    assert reference["reference_close"] == before["Close"].iloc[-1] == closes[days.index("2024-11-29")]
    assert reference["reference_date"] == "2024-11-29"
    assert price.period_reference(before)["reference_date"] == "2024-11-25"
