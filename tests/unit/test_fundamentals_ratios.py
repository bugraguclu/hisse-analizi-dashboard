"""Pure financial-statement math: labels, periods, YTD → quarter/TTM, ratios (no network)."""

from datetime import date

import pandas as pd
import pytest

from src.adapters import financial_adapter as fa


def test_period_helpers_parse_and_order_kap_and_isyatirim_labels():
    assert fa.parse_period("2026/06") == (2026, 6)
    assert fa.parse_period("2026Q2") == (2026, 6)
    assert fa.parse_period("2025") == (2025, 12)
    assert fa.parse_period("garbage") is None
    assert fa.sort_periods_desc(["2025/12", "2026/03", "2026/06", "2025/12"]) == ["2026/06", "2026/03", "2025/12"]
    assert fa.months_into_fiscal_year(6) == 6
    assert fa.months_into_fiscal_year(2, fiscal_year_end_month=5) == 9


def test_quarter_ends_skip_the_unfinished_current_quarter():
    assert fa.quarter_ends_before(date(2026, 9, 22), 3) == [(2026, 6), (2026, 3), (2025, 12)]
    assert fa.quarter_ends_before(date(2026, 9, 30), 2) == [(2026, 9), (2026, 6)]
    assert fa.fiscal_year_ends_before(date(2026, 9, 22), 2) == [(2025, 12), (2024, 12)]


def test_normalize_label_folds_turkish_case_diacritics_and_numbering():
    assert fa.normalize_label("Net Dönem Kârı (Zararı)") == "net donem kari (zarari)"
    assert fa.normalize_label("DÖNEM KARI (ZARARI)") == "donem kari (zarari)"
    assert fa.normalize_label("XXIII. NET DÖNEM KARI/ZARARI (XVII+XXII)") == "net donem kari/zarari"
    assert fa.normalize_label("  16.1 Ödenmiş Sermaye") == "odenmis sermaye"


def test_canonical_items_from_kap_holding_summary_uses_total_revenue():
    income = {
        "Hasılat": 1_180_496e6,
        "Finans Sektörü Faaliyetleri Hasılatı": 513_468e6,
        "Toplam Hasılat": 1_693_964e6,
        "Brüt Kâr (Zarar)": 306_610e6,
        "Net Dönem Kârı (Zararı)": 46_868e6,
        "Dönem Kârının (Zararının) Dağılımı, Ana Ortaklık Payları": 20_306e6,
    }
    balance = {"Varlıklar": 6_233_515e6, "Yükümlülükler": 4_941_517e6, "Toplam Özkaynaklar": 1_291_998e6}

    items = fa.canonical_financial_items(balance=balance, income=income)

    assert items["revenue"] == 1_693_964e6
    assert items["net_income_parent"] == 20_306e6
    assert items["total_assets"] == 6_233_515e6
    assert items["total_liabilities"] == 4_941_517e6


def test_canonical_items_from_isyatirim_labels_keep_short_and_long_debt_apart():
    table = {
        "periods": ["2026/06"],
        "items": [
            {"code": "1AA", "label": "Nakit ve Nakit Benzerleri", "statement": "balance", "values": {"2026/06": 80.0}},
            {"code": "1AB", "label": "Finansal Yatırımlar (Dönen Varlıklar)", "statement": "balance",
             "values": {"2026/06": 20.0}},
            {"code": "1BC", "label": "Finansal Yatırımlar (Duran Varlıklar)", "statement": "balance",
             "values": {"2026/06": 999.0}},
            {"code": "2AA", "label": "Finansal Borçlar (Kısa Vadeli Yükümlülükler)", "statement": "balance",
             "values": {"2026/06": 100.0}},
            {"code": "2BA", "label": "Finansal Borçlar (Uzun Vadeli Yükümlülükler)", "statement": "balance",
             "values": {"2026/06": 300.0}},
            {"code": "3C", "label": "Satış Gelirleri", "statement": "income", "values": {"2026/06": 1000.0}},
            {"code": "3CAC", "label": "Faiz, Ücret, Prim, Komisyon ve Diğer Gelirler", "statement": "income",
             "values": {"2026/06": 0.0}},
            {"code": "3DF", "label": "FAALİYET KARI (ZARARI)", "statement": "income", "values": {"2026/06": 50.0}},
            {"code": "3LB", "label": "Azınlık Payları", "statement": "income", "values": {"2026/06": -1.0}},
            {"code": "4CAB", "label": "Amortisman & İtfa Payları", "statement": "cashflow",
             "values": {"2026/06": 25.0}},
        ],
    }
    maps = fa.isyatirim_statement_maps(table)["2026/06"]

    items = fa.canonical_financial_items(balance=maps["balance"], income=maps["income"], cashflow=maps["cashflow"])

    assert items["financial_debt"] == 400.0
    assert items["cash"] == 80.0
    assert items["short_term_investments"] == 20.0
    assert items["revenue"] == 1000.0
    assert items["operating_profit"] == 50.0
    assert items["depreciation_amortization"] == 25.0
    assert items["minority_interest"] is None  # the income-statement "Azınlık Payları" is not equity


def test_disambiguated_labels_qualify_duplicates_by_section():
    items = [
        {"itemCode": "2A", "itemDescTr": "Kısa Vadeli Yükümlülükler"},
        {"itemCode": "2AA", "itemDescTr": "  Finansal Borçlar"},
        {"itemCode": "2B", "itemDescTr": "Uzun Vadeli Yükümlülükler"},
        {"itemCode": "2BA", "itemDescTr": "  Finansal Borçlar"},
        {"itemCode": "2N", "itemDescTr": "Özkaynaklar"},
    ]

    assert fa._disambiguated_labels(items) == [
        "Kısa Vadeli Yükümlülükler",
        "Finansal Borçlar (Kısa Vadeli Yükümlülükler)",
        "Uzun Vadeli Yükümlülükler",
        "Finansal Borçlar (Uzun Vadeli Yükümlülükler)",
        "Özkaynaklar",
    ]


def test_merge_batches_joins_by_item_code_and_drops_empty_future_columns():
    first = [
        {"itemCode": "1BL", "itemDescTr": "TOPLAM VARLIKLAR", "value1": 30, "value2": None},
        {"itemCode": "3C", "itemDescTr": "Satış Gelirleri", "value1": 5, "value2": None},
    ]
    second = [
        {"itemCode": "1BL", "itemDescTr": "TOPLAM VARLIKLAR", "value1": 20},
        {"itemCode": "3C", "itemDescTr": "Satış Gelirleri", "value1": 4},
    ]

    merged, periods = fa._merge_batches([([(2026, 6), (2026, 9)], first), ([(2026, 3)], second)])

    assert periods == ["2026/06", "2026/03"]  # 2026/09 is not published yet → dropped
    assert merged[0]["values"] == {"2026/06": 30.0, "2026/03": 20.0}
    assert merged[1]["statement"] == "income"


def test_discrete_quarters_are_differences_of_cumulative_values():
    ytd = {"2026/06": 585.0, "2026/03": 258.0, "2025/12": 955.0, "2025/09": 691.0, "2025/06": 408.0}

    assert fa.discrete_quarter_values(ytd) == {
        "2026/06": 327.0,
        "2026/03": 258.0,
        "2025/12": 264.0,
        "2025/09": 283.0,
        "2025/06": None,  # 2025/03 missing → unknown, not guessed
    }


def test_ttm_is_latest_ytd_plus_previous_year_minus_prior_ytd():
    items = {
        "2026/06": {"revenue": 585.0, "net_income": 18.0},
        "2025/12": {"revenue": 955.0, "net_income": 118.0},
        "2025/06": {"revenue": 408.0, "net_income": None},
    }

    ttm = fa.ttm_flows(items, "2026/06")

    assert ttm is not None
    assert ttm["revenue"] == 1132.0
    assert ttm["net_income"] is None
    assert fa.ttm_flows(items, "2025/12")["revenue"] == 955.0  # a fiscal year is already 12 months
    assert fa.ttm_flows({"2026/06": {"revenue": 1.0}}, "2026/06") is None


def test_ratios_use_ebitda_from_operating_profit_plus_d_and_a():
    current = {
        "revenue": 1000.0, "gross_profit": 200.0, "operating_profit": 100.0, "depreciation_amortization": 50.0,
        "net_income": 80.0, "net_income_parent": 75.0, "total_assets": 2000.0, "total_equity": 800.0,
        "parent_equity": 750.0, "current_assets": 600.0, "current_liabilities": 400.0, "total_liabilities": 1200.0,
        "financial_debt": 500.0, "cash": 100.0, "short_term_investments": 50.0, "minority_interest": 50.0,
    }
    previous = {"revenue": 800.0, "net_income_parent": 60.0, "parent_equity": 650.0, "total_assets": 1800.0}

    ratios = fa.compute_financial_ratios(current, previous=previous, market_cap=1500.0)

    assert set(ratios) == set(fa.RATIO_KEYS)
    assert ratios["ebitda_margin"] == 15.0
    assert ratios["operating_margin"] == 10.0
    assert ratios["gross_margin"] == 20.0
    assert ratios["net_margin"] == 8.0
    assert ratios["roe"] == 10.71  # 75 / avg(750, 650)
    assert ratios["roa"] == 4.21  # 80 / avg(2000, 1800)
    assert ratios["current_ratio"] == 1.5
    assert ratios["net_debt_ebitda"] == 2.33  # (500 − 100 − 50) / 150
    assert ratios["debt_to_equity"] == 1.5
    assert ratios["pe_ratio"] == 20.0
    assert ratios["pb_ratio"] == 2.0
    assert ratios["ps_ratio"] == 1.5
    assert ratios["ev_ebitda"] == 12.67  # (1500 + 350 + 50) / 150
    assert ratios["revenue_growth_yoy"] == 25.0
    assert ratios["net_income_growth_yoy"] == 25.0


def test_ratios_for_banks_leave_non_meaningful_metrics_null():
    current = {
        "net_interest_income": 100.0, "deposits": 2500.0, "net_income": 34.0, "net_income_parent": 34.0,
        "total_assets": 4000.0, "total_equity": 320.0, "operating_profit": 46.0, "depreciation_amortization": 5.0,
    }

    ratios = fa.compute_financial_ratios(current, market_cap=340.0)

    assert ratios["pe_ratio"] == 10.0
    assert ratios["pb_ratio"] == 1.06
    assert ratios["roe"] == 10.62
    for key in ("gross_margin", "ebitda_margin", "net_margin", "current_ratio", "net_debt_ebitda",
                "debt_to_equity", "ps_ratio", "ev_ebitda", "revenue_growth_yoy"):
        assert ratios[key] is None, key
    assert fa.derive_financial_amounts(current)["ebitda"] is None


def test_growth_from_a_loss_or_zero_base_is_not_reported():
    current = {"revenue": 100.0, "net_income": 34_070.0, "net_income_parent": 34_070.0}

    assert fa.compute_financial_ratios(current, previous={"net_income_parent": -3_215.0})["net_income_growth_yoy"] is None
    assert fa.compute_financial_ratios(current, previous={"net_income_parent": 0.0})["net_income_growth_yoy"] is None
    assert fa.compute_financial_ratios(current, previous={"net_income_parent": 30_000.0})["net_income_growth_yoy"] == 13.57


def test_ratios_never_turn_missing_or_loss_into_zero():
    ratios = fa.compute_financial_ratios({"net_income": -10.0, "net_income_parent": -10.0, "total_equity": -5.0},
                                         market_cap=100.0)

    assert ratios["pe_ratio"] is None  # loss-making → P/E not meaningful
    assert ratios["pb_ratio"] is None  # negative equity
    assert ratios["roe"] is None
    assert all(v is None or v != 0 for v in ratios.values())


def test_build_ratio_inputs_pairs_ttm_with_year_ago_balance():
    items = {
        "2026/06": {"revenue": 6.0, "total_assets": 100.0},
        "2025/12": {"revenue": 10.0, "total_assets": 90.0},
        "2025/06": {"revenue": 4.0, "total_assets": 80.0},
    }

    current, previous = fa.build_ratio_inputs(items, "2026/06")

    assert current["revenue"] == 12.0
    assert current["total_assets"] == 100.0
    assert previous is not None and previous["total_assets"] == 80.0
    assert previous["revenue"] is None  # 2024 comparatives unavailable → no growth, not 0
    with pytest.raises(ValueError):
        fa.build_ratio_inputs(items, "2025/06")


def test_restatement_factor_rejects_implausible_ratios():
    assert fa.restatement_factor(1_996_745.0, 2_351_336.385167) == pytest.approx(0.84919, rel=1e-4)
    assert fa.restatement_factor(1.0, -1.0) is None
    assert fa.restatement_factor(1.0, 100.0) is None
    assert fa.restatement_factor(None, 5.0) is None


def test_create_raw_data_accepts_period_mappings():
    adapter = fa.FinancialAdapter()
    raw = adapter._create_raw_data("THYAO", "balance_sheet", {"2025": {"TOPLAM VARLIKLAR": 1.0, "Bad": float("nan")}})

    assert raw.raw_payload_json["data"] == {"2025": {"TOPLAM VARLIKLAR": 1.0, "Bad": None}}
    same = adapter._create_raw_data("THYAO", "balance_sheet", pd.DataFrame({"2025": [1.0, None]},
                                                                           index=["TOPLAM VARLIKLAR", "Bad"]))
    assert same.content_hash == raw.content_hash
