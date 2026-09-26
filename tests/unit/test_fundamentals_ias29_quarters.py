"""IAS 29 single quarters and TTM: the companies' own three-month figures (no network, no database).

Inflation-adjusted reports are each in their own period-end purchasing power, so a plain
YTD difference moves the re-expression of the earlier quarters into the later one. Figures:
BIMAS (million TL, first published on KAP) and TÜİK monthly CPI changes as stored.
"""

import pytest

from src.adapters import fundamentals_statements as fs
from src.adapters.financial_adapter import cpi_quarter_factors, discrete_quarter_values, ttm_flows
from src.services.analysis_service import ratio_rows

CPI_MOM = {
    "2023-07": 9.49, "2023-08": 9.09, "2023-09": 4.75, "2023-10": 3.43, "2023-11": 3.28, "2023-12": 2.93,
    "2024-01": 6.70, "2024-02": 4.53, "2024-03": 3.16,
    "2025-04": 3.00, "2025-05": 1.53, "2025-06": 1.37, "2025-07": 2.06, "2025-08": 2.04, "2025-09": 3.23,
    "2025-10": 2.55, "2025-11": 0.87, "2025-12": 0.89, "2026-01": 4.84, "2026-02": 2.96, "2026-03": 1.94,
    "2026-04": 4.18, "2026-05": 1.71, "2026-06": 0.99,
}
FACTORS = cpi_quarter_factors(CPI_MOM)

# BIMAS cumulative revenue / parent net income, million TL.
BIMAS = {
    "2025/06": {"revenue": 309_834.9, "net_income_parent": 5_560.9},
    "2025/09": {"revenue": 512_767.1, "net_income_parent": 11_252.9},
    "2025/12": {"revenue": 721_062.5, "net_income_parent": 18_632.1},
    "2026/03": {"revenue": 212_862.3, "net_income_parent": 6_461.0},
    "2026/06": {"revenue": 449_695.2, "net_income_parent": 14_934.5},
}
KAP_Q2_2026_REVENUE = 221_902.6  # three-month column of BIMAS's 2026/06 KAP report
TRADINGVIEW_TTM_REVENUE = 822_991.8  # total_revenue_ttm, 2026-Q2
TRADINGVIEW_TTM_NET_INCOME = 27_135.2  # net_income_ttm, 2026-Q2


def test_cpi_factors_multiply_the_three_monthly_changes():
    assert FACTORS["2026/06"] == pytest.approx(1.0418 * 1.0171 * 1.0099)
    assert FACTORS["2026/06"] == pytest.approx(1.07014, abs=1e-4)  # implied by the KAP report
    assert FACTORS["2025/09"] == pytest.approx(1.07506, abs=1e-5)


def test_cpi_factors_start_with_the_first_ias29_quarter_and_need_all_three_months():
    assert "2024/03" in FACTORS  # follows 2023/12, the first IAS 29 period
    assert "2023/12" not in FACTORS  # follows 2023/09, published at historical cost
    assert "2024/06" not in FACTORS  # April/May 2024 missing
    assert cpi_quarter_factors({"2026-04": None, "2026-05": 1.0, "2026-06": 1.0, "bad": 2}) == {}


def test_single_quarters_of_an_ias29_reporter_are_its_three_month_figures():
    revenue = {period: values["revenue"] for period, values in BIMAS.items()}

    plain = discrete_quarter_values(revenue)
    adjusted = discrete_quarter_values(revenue, quarter_factors=FACTORS)

    assert plain["2026/06"] == pytest.approx(236_832.9)  # 6.7 % above the company's own figure
    assert adjusted["2026/06"] == pytest.approx(KAP_Q2_2026_REVENUE, rel=1e-4)
    assert adjusted["2026/03"] == plain["2026/03"] == 212_862.3  # Q1 is cumulative already
    assert adjusted["2025/12"] == plain["2025/12"] == pytest.approx(721_062.5 - 512_767.1)  # Q4 = FY − 9M
    assert adjusted["2025/09"] == pytest.approx(512_767.1 - 309_834.9 * FACTORS["2025/09"])


def test_quarters_before_ias29_and_missing_factors():
    values = {"2023/03": 10.0, "2023/06": 25.0, "2026/03": 100.0, "2026/06": 210.0}

    result = discrete_quarter_values(values, quarter_factors={})

    assert result["2023/06"] == 15.0  # 2023 interim reports were at historical cost
    assert result["2026/06"] is None  # re-expression due, factor unknown: never guessed
    assert discrete_quarter_values(values)["2026/06"] == 110.0


def test_ttm_of_an_ias29_reporter_matches_tradingview():
    plain = ttm_flows(BIMAS, "2026/06")
    adjusted = ttm_flows(BIMAS, "2026/06", quarter_factors=FACTORS)
    assert plain is not None and adjusted is not None

    assert plain["revenue"] == pytest.approx(860_922.8)  # +4.6 % vs TradingView
    assert adjusted["revenue"] == pytest.approx(TRADINGVIEW_TTM_REVENUE, rel=5e-4)
    assert adjusted["net_income_parent"] == pytest.approx(TRADINGVIEW_TTM_NET_INCOME, rel=5e-4)
    quarters = discrete_quarter_values(
        {period: values["revenue"] for period, values in BIMAS.items()}, quarter_factors=FACTORS
    )
    assert adjusted["revenue"] == pytest.approx(sum(quarters[p] for p in ("2025/09", "2025/12", "2026/03", "2026/06")))


def test_ttm_needs_the_cumulative_value_it_re_expresses():
    without_q1 = {period: values for period, values in BIMAS.items() if period != "2026/03"}

    result = ttm_flows(without_q1, "2026/06", quarter_factors=FACTORS)

    assert result is not None and result["revenue"] is None
    assert ttm_flows(without_q1, "2026/06")["revenue"] == pytest.approx(860_922.8)  # type: ignore[index]


def test_fiscal_year_end_ttm_is_the_annual_figure():
    assert ttm_flows(BIMAS, "2025/12", quarter_factors=FACTORS)["revenue"] == 721_062.5  # type: ignore[index]


def test_ias29_reporters_are_recognised_by_their_interim_comparatives():
    bimas = {
        "2025/06": {"isyatirim_column": {"flow": 0.756981, "method": "own_ratio"}},
        "2025/12": {"isyatirim_column": {"flow": 0.849196, "method": "kap"}},
    }
    thyao = {  # İş Yatırım re-expresses every company's fiscal year-ends
        "2025/06": {"income": "isyatirim"},
        "2025/12": {"isyatirim_column": {"flow": 0.849196, "method": "kap"}},
    }

    assert fs.applies_ias29_sources(bimas) is True
    assert fs.applies_ias29_sources(thyao) is False
    assert fs.applies_ias29({"2025/06": fs.ColumnRestatement("2025/06", flow=None, method="unknown")}) is True
    assert fs.applies_ias29({"2025/12": fs.ColumnRestatement("2025/12", flow=0.85, method="kap")}) is False
    assert fs.ias29_quarter_factors(True, FACTORS) is FACTORS
    assert fs.ias29_quarter_factors(False, FACTORS) is None
    assert fs.ias29_quarter_factors(True, {}) is None  # CPI unavailable: plain differences


def test_ratio_rows_record_the_factors_of_the_window():
    facts = {period: {**values, "total_assets": 1_000.0, "total_equity": 500.0} for period, values in BIMAS.items()}

    rows = {(r["period"], r["basis"]): r for r in ratio_rows(facts, template="industrial", quarter_factors=FACTORS)}

    latest = rows[("2026/06", "ttm")]["inputs_json"]
    assert latest["flows"]["revenue"] == pytest.approx(TRADINGVIEW_TTM_REVENUE, rel=5e-4)
    assert latest["ias29_quarter_factors"] == {
        "2025/09": round(FACTORS["2025/09"], 6), "2026/06": round(FACTORS["2026/06"], 6),
    }
    assert rows[("2025/12", "ttm")]["inputs_json"]["ias29_quarter_factors"] == {}
    plain = {(r["period"], r["basis"]): r for r in ratio_rows(facts, template="industrial")}
    assert plain[("2026/06", "ttm")]["inputs_json"]["ias29_quarter_factors"] is None


def test_statement_discrete_rows_carry_the_basis_and_note():
    records = [{"Item": "Hasılat", **{period: values["revenue"] for period, values in BIMAS.items()}}]
    payload: dict = {"notes": []}

    fs._add_discrete(payload, records, 12, FACTORS)

    assert payload["discrete_basis"] == "ias29_three_month"
    assert payload["discrete"][0]["2026/06"] == pytest.approx(KAP_Q2_2026_REVENUE, rel=1e-4)
    assert payload["notes"] == [fs._IAS29_QUARTER_NOTE]
    plain: dict = {"notes": []}
    fs._add_discrete(plain, records, 12, None, ["2026/06"])
    assert plain["discrete_basis"] == "ytd_difference" and plain["notes"] == []
    assert plain["discrete"] == [{"Item": "Hasılat", "2026/06": pytest.approx(236_832.9)}]
