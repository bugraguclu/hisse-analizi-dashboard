"""financial_ratios rows from cumulative facts: TTM math, annual basis, valuation inputs,
shares selection and the audit trail (no network, no database)."""

from decimal import Decimal

import pytest

from src.services.analysis_service import (
    MarketInputs,
    choose_shares,
    compute_financial_ratios,
    ratio_rows,
    trailing_quarters,
)


def facts(**values):
    return values


# THYAO-like cumulative (year-to-date) facts, million TL.
FACTS = {
    "2026/06": facts(revenue=585.0, gross_profit=42.5, operating_profit=-5.0, depreciation_amortization=58.6,
                     net_income=18.7, net_income_parent=18.8, total_assets=2_360.0, total_equity=1_018.4,
                     parent_equity=1_018.5, current_assets=512.0, current_liabilities=566.0,
                     total_liabilities=1_341.6, financial_debt=914.0, cash=80.0, short_term_investments=213.0,
                     minority_interest=-0.1, paid_in_capital=1.38),
    "2026/03": facts(revenue=258.0, net_income=9.8, total_assets=2_158.0, total_equity=966.0,
                     total_liabilities=1_192.0, current_assets=485.0, current_liabilities=498.0),
    "2025/12": facts(revenue=955.4, gross_profit=155.5, operating_profit=90.1, depreciation_amortization=94.6,
                     net_income=118.1, net_income_parent=118.2, total_assets=1_996.7, total_equity=911.2,
                     parent_equity=911.2, paid_in_capital=1.38),
    "2025/06": facts(revenue=408.0, gross_profit=56.1, operating_profit=24.5, depreciation_amortization=42.9,
                     net_income=24.9, net_income_parent=25.0, total_assets=1_652.5, total_equity=752.1,
                     parent_equity=752.0, paid_in_capital=1.38),
    "2024/12": facts(revenue=745.4, net_income=113.3, net_income_parent=113.3, total_assets=1_399.6,
                     total_equity=680.0, parent_equity=679.8),
}
MARKET = MarketInputs(price=300.0, price_source="quotes", price_time="2026-09-22T15:00:00+00:00",
                      total_shares=1.38, implied_shares=1.38, provider_market_cap=414.0)


def by_key(rows):
    return {(r["period"], r["basis"]): r for r in rows}


def test_trailing_quarters_are_the_four_quarter_ends_oldest_first():
    assert trailing_quarters("2026/06") == ["2025/09", "2025/12", "2026/03", "2026/06"]
    assert trailing_quarters("garbage") == []


def test_ttm_row_sums_the_last_four_quarters_from_cumulative_facts():
    rows = by_key(ratio_rows(FACTS, template="industrial", market=MARKET))

    ttm = rows[("2026/06", "ttm")]
    flows = ttm["inputs_json"]["flows"]
    assert flows["revenue"] == pytest.approx(585.0 + 955.4 - 408.0)  # YTD + FY − prior YTD
    assert flows["net_income_parent"] == pytest.approx(18.8 + 118.2 - 25.0)
    assert ttm["ttm_quarters"] == ["2025/09", "2025/12", "2026/03", "2026/06"]
    assert ttm["inputs_json"]["flow_periods"] == {"latest": "2026/06", "fiscal_year": "2025/12", "prior_ytd": "2025/06"}
    # ROE = TTM parent income / average(parent equity now, a year ago)
    expected_roe = (18.8 + 118.2 - 25.0) / ((1_018.5 + 752.0) / 2) * 100
    assert float(ttm["roe"]) == pytest.approx(round(expected_roe, 2))
    assert ttm["raw_ratios_json"]["roe"] == pytest.approx(expected_roe)  # unrounded audit value
    assert isinstance(ttm["roe"], Decimal)


def test_valuation_only_on_the_latest_row_of_each_basis():
    rows = by_key(ratio_rows(FACTS, template="industrial", market=MARKET))

    latest_ttm, latest_annual = rows[("2026/06", "ttm")], rows[("2025/12", "annual")]
    assert latest_ttm["market_cap"] == Decimal("414.0")
    assert latest_ttm["price"] == Decimal("300.0")
    assert latest_ttm["shares_outstanding"] == Decimal(1)  # whole shares
    assert latest_ttm["shares_source"] == "paid_in_capital"
    assert latest_ttm["pe_ratio"] is not None and latest_ttm["pb_ratio"] is not None
    assert latest_annual["market_cap"] is not None
    assert float(latest_annual["pe_ratio"]) == pytest.approx(round(414.0 / 118.2, 2))
    older = rows[("2025/12", "ttm")]
    assert older["market_cap"] is None and older["pe_ratio"] is None and older["inputs_json"]["market"] is None


def test_annual_rows_exist_for_fiscal_year_ends_only():
    rows = by_key(ratio_rows(FACTS, template="industrial"))

    assert ("2025/12", "annual") in rows and ("2024/12", "annual") in rows
    assert ("2026/06", "annual") not in rows
    annual = rows[("2025/12", "annual")]
    assert float(annual["revenue_growth_yoy"]) == pytest.approx(round((955.4 - 745.4) / 745.4 * 100, 2))
    assert annual["ttm_quarters"] == ["2025/03", "2025/06", "2025/09", "2025/12"]


def test_missing_comparative_gives_no_flow_ratios_but_keeps_balance_sheet_ratios():
    rows = by_key(ratio_rows(FACTS, template="industrial", market=MARKET))

    q1 = rows[("2026/03", "ttm")]  # needs 2025/03, which is not stored
    assert q1["ttm_quarters"] == []
    assert q1["inputs_json"]["flows"] is None
    assert q1["roe"] is None and q1["net_margin"] is None
    assert float(q1["debt_to_equity"]) == pytest.approx(round(1_192.0 / 966.0, 2))
    assert float(q1["current_ratio"]) == pytest.approx(round(485.0 / 498.0, 2))
    assert "2025/03" in q1["inputs_json"]["notes"][0]


def test_inputs_json_reproduces_every_ratio():
    row = by_key(ratio_rows(FACTS, template="industrial", market=MARKET))[("2026/06", "ttm")]
    inputs = row["inputs_json"]
    current = {**inputs["stocks"], **inputs["flows"]}
    previous = {**inputs["previous"]["stocks"], **(inputs["previous"]["flows"] or {})}

    again = compute_financial_ratios(
        current, previous=previous, market_cap=inputs["market"]["market_cap"], template=inputs["template"], digits=None
    )

    assert again == pytest.approx(row["raw_ratios_json"])


def test_bank_template_skips_non_meaningful_ratios():
    bank = {"2025/12": facts(net_income=111.0, total_assets=4_547.0, total_equity=446.0, deposits=3_150.0,
                              paid_in_capital=4.2),
            "2024/12": facts(net_income=92.0, total_assets=3_002.0, total_equity=331.0, paid_in_capital=4.2)}

    rows = by_key(ratio_rows(bank, template="bank", market=MarketInputs(price=130.0, implied_shares=4.2)))

    row = rows[("2025/12", "annual")]
    assert row["roe"] is not None and row["pb_ratio"] is not None
    for column in ("gross_margin", "current_ratio", "debt_to_equity", "ev_ebitda", "net_debt_ebitda"):
        assert row[column] is None, column


def test_rows_without_any_computable_ratio_are_omitted():
    assert ratio_rows({"2025/12": facts(paid_in_capital=1.0)}) == []


def test_shares_prefer_paid_in_capital():
    assert choose_shares(2_536e6, MarketInputs(implied_shares=2_535_897_886.0, total_shares=1_856_230_000.0))[:2] == (
        2_536e6, "paid_in_capital"  # KCHOL: TradingView's reported count is wrong, capital is right
    )


def test_shares_follow_the_market_after_a_capital_change():
    shares, source, notes = choose_shares(1_000e6, MarketInputs(implied_shares=2_000e6))
    assert (shares, source) == (2_000e6, "tradingview_mcap")
    assert notes and "sermaye" in notes[0]


def test_shares_fall_back_to_tradingview():
    assert choose_shares(None, MarketInputs(implied_shares=5e6))[:2] == (5e6, "tradingview_mcap")
    assert choose_shares(None, MarketInputs(total_shares=7e6))[:2] == (7e6, "tradingview")
    assert choose_shares(None, None) == (None, None, [])


def test_growth_needs_a_positive_base():
    # KCHOL before the fix: previous TTM −3.2 bn, current 34.1 bn → "+1,159.72 %".
    ratios = compute_financial_ratios({"net_income_parent": 34.07, "revenue": 10.0},
                                      previous={"net_income_parent": -3.215, "revenue": 0.0})
    assert ratios["net_income_growth_yoy"] is None
    assert ratios["revenue_growth_yoy"] is None
    assert compute_financial_ratios({"net_income_parent": -1.0}, previous={"net_income_parent": 2.0})[
        "net_income_growth_yoy"] == -150.0
    assert compute_financial_ratios({"net_income_parent": 12.0}, previous={"net_income_parent": 10.0})[
        "net_income_growth_yoy"] == 20.0


def test_annual_row_is_valued_with_the_latest_balance_sheet():
    # GARAN-like bank: no TTM (KAP shows year-ends + the latest interim only). The annual row
    # must use today's book value (TradingView price_book_fq 1.15), not the fiscal year's (1.26).
    bank = {
        "2026/06": facts(net_income=64.4e9, net_income_parent=64.4e9, total_assets=5_216e9, total_equity=489.4e9,
                         deposits=3_466e9, paid_in_capital=4.2e9),
        "2025/12": facts(net_income=109.8e9, net_income_parent=109.8e9, total_assets=4_547e9, total_equity=446.6e9,
                         deposits=3_150e9, paid_in_capital=4.2e9),
        "2024/12": facts(net_income=91.2e9, net_income_parent=91.2e9, total_assets=3_300e9, total_equity=331e9,
                         paid_in_capital=4.2e9),
    }
    market = MarketInputs(price=133.8, implied_shares=4.2e9, total_shares=4.2e9)

    rows = by_key(ratio_rows(bank, template="bank", market=market))

    annual = rows[("2025/12", "annual")]
    assert float(annual["pb_ratio"]) == pytest.approx(round(133.8 * 4.2e9 / 489.4e9, 2))  # 1.15
    assert float(annual["pe_ratio"]) == pytest.approx(round(133.8 * 4.2e9 / 109.8e9, 2))  # fiscal-year earnings
    assert float(annual["roe"]) == pytest.approx(round(109.8 / ((446.6 + 331) / 2) * 100, 2))  # FY balance sheets
    assert annual["inputs_json"]["market"]["balance_sheet_period"] == "2026/06"
    assert annual["inputs_json"]["valuation_stocks"]["total_equity"] == 489.4e9
    assert rows[("2024/12", "annual")]["pb_ratio"] is None  # historical rows are never valued


def test_annual_row_takes_the_current_share_count():
    # ALARK: 435 mn shares at 2025/12, 417 mn after the 2026 capital reduction.
    items = {
        "2026/06": facts(revenue=5.58e9, net_income_parent=4.36e9, total_assets=167.5e9, total_equity=97.8e9,
                         parent_equity=91.5e9, paid_in_capital=417e6),
        "2025/12": facts(revenue=8.67e9, net_income_parent=-1.22e9, total_assets=125.6e9, total_equity=80.4e9,
                         parent_equity=74.4e9, paid_in_capital=435e6),
    }
    market = MarketInputs(price=109.2, implied_shares=408e6, total_shares=409.5e6)

    rows = by_key(ratio_rows(items, template="industrial", market=market))

    annual = rows[("2025/12", "annual")]
    assert annual["shares_outstanding"] == Decimal(417_000_000) and annual["shares_source"] == "paid_in_capital"
    assert annual["market_cap"] == Decimal(str(round(109.2 * 417e6, 2)))
    assert float(annual["pb_ratio"]) == pytest.approx(round(109.2 * 417e6 / 91.5e9, 2))


def test_ttm_ebitda_ratios_fall_back_to_the_fiscal_year_with_a_label():
    # KCHOL: İş Yatırım's operating profit is rejected (holding definition), so the prior-year
    # interim has none and the TTM EBITDA cannot be built.
    items = {
        "2026/06": facts(revenue=1_694e9, operating_profit=96e9, depreciation_amortization=41.5e9,
                         net_income_parent=20.3e9, total_assets=6_233e9, total_equity=1_292e9, parent_equity=793e9,
                         financial_debt=900e9, cash=300e9, paid_in_capital=2.536e9),
        "2025/12": facts(revenue=2_757e9, operating_profit=117.6e9, depreciation_amortization=74.4e9,
                         net_income_parent=22.0e9, total_assets=5_318e9, total_equity=1_092e9, parent_equity=677e9,
                         paid_in_capital=2.536e9),
        "2025/06": facts(revenue=1_177e9, operating_profit=None, depreciation_amortization=32.8e9,
                         net_income_parent=6.2e9, total_assets=4_660e9, total_equity=950e9, parent_equity=595e9,
                         paid_in_capital=2.536e9),
    }
    market = MarketInputs(price=221.1, implied_shares=2.536e9)

    row = by_key(ratio_rows(items, template="industrial", market=market))[("2026/06", "ttm")]

    fy_ebitda = 117.6e9 + 74.4e9
    assert float(row["ebitda_margin"]) == pytest.approx(round(fy_ebitda / 2_757e9 * 100, 2))
    assert float(row["net_debt_ebitda"]) == pytest.approx(round((900e9 - 300e9) / fy_ebitda, 2))
    enterprise_value = 221.1 * 2.536e9 + 600e9 + (1_292e9 - 793e9) * 0  # no minority item given
    assert float(row["ev_ebitda"]) == pytest.approx(round(enterprise_value / fy_ebitda, 2))
    inputs = row["inputs_json"]
    assert inputs["ratio_bases"] == {k: "annual:2025/12" for k in ("ebitda_margin", "net_debt_ebitda", "ev_ebitda")}
    assert "esas faaliyet kârı" in inputs["ratios_basis_note"] and "2025/12" in inputs["ratios_basis_note"]
    assert inputs["derived"]["ebitda_annual_fallback"]["ebitda"] == pytest.approx(fy_ebitda)
    assert inputs["derived"]["ebitda"] is None  # the TTM EBITDA itself stays unknown
    assert row["pe_ratio"] is not None  # TTM flows otherwise available
