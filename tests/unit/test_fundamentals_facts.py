"""Canonical facts on the first-published (KAP) basis: KAP ↔ İş Yatırım merge, IAS 29 restatement,
scope/definition checks (no network, no database)."""

import pytest

from src.adapters import fundamentals_statements as fs
from src.adapters.financial_adapter import canonical_financial_items, normalize_label, statement_template

F = 0.85  # IAS 29: İş Yatırım re-expresses fiscal year-end columns → KAP = İşY × F


def kap_period(total_assets, equity, revenue, net_income, operating, capital=1_000.0, parent_equity=None):
    return {
        "balance": {
            "Toplam Varlıklar": total_assets,
            "Toplam Özkaynaklar": equity,
            "Ana Ortaklığa Ait Özkaynaklar": parent_equity if parent_equity is not None else equity,
            "Ödenmiş Sermaye": capital,
        },
        "income": {
            "Hasılat": revenue,
            "Esas Faaliyet Kârı (Zararı)": operating,
            "Net Dönem Kârı (Zararı)": net_income,
        },
    }


def isy_period(total_assets, equity, revenue, net_income, operating, d_and_a, cash, debt, capital=1_000.0):
    return {
        "balance": {
            "Nakit ve Nakit Benzerleri": cash,
            "TOPLAM VARLIKLAR": total_assets,
            "Finansal Borçlar (Kısa Vadeli Yükümlülükler)": debt,
            "Özkaynaklar": equity,
            "Ana Ortaklığa Ait Özkaynaklar": equity,
            "Ödenmiş Sermaye": capital,
        },
        "income": {
            "Satış Gelirleri": revenue,
            "FAALİYET KARI (ZARARI)": operating,
            "DÖNEM KARI (ZARARI)": net_income,
        },
        "cashflow": {"Amortisman & İtfa Payları": d_and_a},
    }


def industrial_sources():
    kap = {
        "2026/06": kap_period(2_360.0, 1_018.0, 585.0, 18.0, -5.0),
        "2025/12": kap_period(1_996.0, 911.0, 955.0, 118.0, 90.0),  # first published
    }
    isy = {
        "2026/06": isy_period(2_360.0, 1_018.0, 585.0, 18.0, -5.0, 58.0, 80.0, 900.0),
        "2026/03": isy_period(2_158.0, 966.0, 258.0, 9.8, -2.4, 28.0, 71.0, 800.0),
        "2025/12": isy_period(1_996.0 / F, 911.0 / F, 955.0 / F, 118.0 / F, 90.0 / F, 94.0 / F, 86.0 / F, 760.0 / F),
        "2025/06": isy_period(1_652.0, 752.0, 408.0, 24.9, 24.5, 42.9, 98.0, 580.0),
        "2024/12": isy_period(1_400.0 / 0.76, 680.0 / 0.76, 745.0 / 0.76, 113.0 / 0.76, 80.0 / 0.76, 72.0, 96.0, 490.0),
    }
    return kap, isy


def test_kap_first_facts_fill_missing_items_from_derestated_isyatirim():
    kap, isy = industrial_sources()

    facts = fs.build_canonical_facts(kap, isy, template="industrial", kap_units={"2026/06": 1.0, "2025/12": 1.0})

    assert facts.isyatirim_scope == "match"
    assert facts.factors["2025/12"]["balance"] == pytest.approx(F)
    assert facts.restated_periods == {"2025/12": pytest.approx(F)}
    fy = facts.items["2025/12"]
    assert fy["total_assets"] == 1_996.0  # KAP value, as first published
    assert fy["depreciation_amortization"] == pytest.approx(94.0)  # İşY × factor
    assert fy["cash"] == pytest.approx(86.0)
    assert facts.sources["2025/12"]["keys"]["total_assets"] == "kap"
    assert facts.sources["2025/12"]["keys"]["depreciation_amortization"].startswith("isyatirim*0.85")
    assert facts.sources["2025/12"]["cashflow"] == "isyatirim"
    assert facts.sources["2025/12"]["restatement_factor"]["balance"] == pytest.approx(F)


def test_interim_quarters_come_from_isyatirim_as_first_published():
    kap, isy = industrial_sources()

    facts = fs.build_canonical_facts(kap, isy, template="industrial")

    assert facts.items["2026/03"]["revenue"] == 258.0
    assert facts.items["2025/06"]["total_assets"] == 1_652.0
    assert facts.sources["2026/03"]["keys"]["revenue"] == "isyatirim"


def test_restated_year_end_without_kap_counterpart_is_skipped():
    kap, isy = industrial_sources()

    facts = fs.build_canonical_facts(kap, isy, template="industrial")

    # İşY's 2024/12 column is re-expressed and KAP's first-published 2024/12 is not stored.
    assert "2024/12" not in facts.items
    assert facts.skipped_periods["2024/12"] == "isyatirim_year_end_restated"


def test_item_with_a_different_definition_is_never_taken_from_isyatirim():
    kap, isy = industrial_sources()
    # Holding-style "esas faaliyet kârı" (KAP) includes equity-method income; İşY's does not.
    kap["2026/06"]["income"]["Esas Faaliyet Kârı (Zararı)"] = 95.0
    kap["2025/12"]["income"]["Esas Faaliyet Kârı (Zararı)"] = 117.0

    facts = fs.build_canonical_facts(kap, isy, template="industrial")

    assert "operating_profit" in facts.rejected_keys
    assert facts.isyatirim_scope == "match"  # the rest still matches
    assert facts.items["2026/06"]["operating_profit"] == 95.0  # KAP period keeps KAP's figure
    assert facts.items["2026/03"]["operating_profit"] is None  # never mixed across definitions
    assert facts.items["2026/03"]["revenue"] == 258.0


def test_bank_scope_mismatch_uses_kap_only():
    kap = {
        "2026/06": {"balance": {"Varlıklar Toplamı": 5_216.0, "Özkaynaklar": 489.0, "Mevduat": 3_466.0},
                    "income": {"Net Faiz Geliri veya Gideri": 139.0, "Net Dönem Kârı (Zararı)": 64.4}},
        "2025/12": {"balance": {"Varlıklar Toplamı": 4_547.0, "Özkaynaklar": 446.0, "Mevduat": 3_150.0},
                    "income": {"Net Faiz Geliri veya Gideri": 204.0, "Net Dönem Kârı (Zararı)": 111.2}},
    }
    # Bank-only (solo) figures: assets differ ~18 %, net income ~1 %.
    solo = {
        "2026/06": {"balance": {"AKTİF TOPLAMI": 4_412.0, "XVI. ÖZKAYNAKLAR": 487.0, "I. MEVDUAT": 3_020.0},
                    "income": {"XXIII. NET DÖNEM KARI/ZARARI (XVII+XXII)": 63.7}},
        "2026/03": {"balance": {"AKTİF TOPLAMI": 4_100.0, "XVI. ÖZKAYNAKLAR": 470.0},
                    "income": {"XXIII. NET DÖNEM KARI/ZARARI (XVII+XXII)": 30.0}},
    }

    facts = fs.build_canonical_facts(kap, solo, template="bank")

    assert facts.isyatirim_scope == "mismatch"
    assert set(facts.items) == {"2026/06", "2025/12"}
    assert facts.skipped_periods == {"2026/03": "isyatirim_scope_mismatch"}
    assert facts.items["2026/06"]["total_assets"] == 5_216.0
    assert facts.items["2026/06"]["deposits"] == 3_466.0
    assert facts.items["2026/06"]["total_liabilities"] == pytest.approx(5_216.0 - 489.0)
    assert all(v == "kap" for v in facts.sources["2026/06"]["keys"].values())


def test_financial_template_without_overlap_is_not_trusted():
    kap = {"2026/06": {"balance": {"Varlıklar Toplamı": 10.0, "Özkaynaklar": 1.0}, "income": {}}}
    isy = {"2026/03": {"balance": {"AKTİF TOPLAMI": 9.0, "Özsermaye Toplamı": 1.0}, "income": {}}}

    facts = fs.build_canonical_facts(kap, isy, template="insurance")

    assert facts.isyatirim_scope == "mismatch"
    assert "2026/03" not in facts.items


def test_isyatirim_only_company_keeps_interims_but_not_unverifiable_year_ends():
    _, isy = industrial_sources()

    facts = fs.build_canonical_facts({}, isy, template="industrial")

    assert facts.isyatirim_scope == "unknown"
    assert "2026/03" in facts.items and "2025/06" in facts.items
    assert "2025/12" not in facts.items
    assert facts.skipped_periods["2025/12"] == "isyatirim_restatement_unknown"


def test_merged_canonical_by_period_is_kap_first_for_live_ratios():
    kap_summary = {
        "periods": ["2026/06", "2025/12"],
        "fiscal_year_end_month": 12,
        "template": "industrial",
        "balance_sheet": [{"Item": "Toplam Varlıklar", "2026/06": 2_360.0, "2025/12": 1_996.0},
                          {"Item": "Toplam Özkaynaklar", "2026/06": 1_018.0, "2025/12": 911.0}],
        "income_statement": [{"Item": "Hasılat", "2026/06": 585.0, "2025/12": 955.0},
                             {"Item": "Net Dönem Kârı (Zararı)", "2026/06": 18.0, "2025/12": 118.0}],
        "period_info": {"balance": {}, "income": {}},
    }
    isy_table = {
        "group": "XI_29",
        "template": "industrial",
        "periods": ["2026/06", "2025/12"],
        "items": [
            {"code": "1BL", "label": "TOPLAM VARLIKLAR", "statement": "balance",
             "values": {"2026/06": 2_360.0, "2025/12": 1_996.0 / F}},
            {"code": "2N", "label": "Özkaynaklar", "statement": "balance",
             "values": {"2026/06": 1_018.0, "2025/12": 911.0 / F}},
            {"code": "3C", "label": "Satış Gelirleri", "statement": "income",
             "values": {"2026/06": 585.0, "2025/12": 955.0 / F}},
            {"code": "3L", "label": "DÖNEM KARI (ZARARI)", "statement": "income",
             "values": {"2026/06": 18.0, "2025/12": 118.0 / F}},
            {"code": "4CAB", "label": "Amortisman & İtfa Payları", "statement": "cashflow",
             "values": {"2026/06": 58.0, "2025/12": 94.0 / F}},
        ],
    }

    items, template = fs._merged_canonical_by_period(kap_summary, isy_table)

    assert template == "industrial"
    assert items["2025/12"]["total_assets"] == 1_996.0  # not İşY's re-expressed 2,348
    assert items["2025/12"]["depreciation_amortization"] == pytest.approx(94.0)


def test_insurance_labels_map_to_canonical_items():
    balance = {"Cari Varlıklar": 139.5, "Toplam Varlıklar": 145.3, "Kısa Vadeli Yükümlülükler": 102.2,
               "Uzun Vadeli Yükümlülükler": 3.0, "Özkaynaklar": 40.0, "Ödenmiş Sermaye": 2.0,
               "Toplam Yükümlülükler ve Özsermaye": 145.3}
    income = {"Hayat Dışı Teknik Gelir": 54.9, "Hayat Teknik Gelir": 0.0, "Emeklilik Teknik Gelir": 0.0,
              "Dönem Kârı veya Zararı": 8.95,  # pre-tax — must not become net income
              "DÖNEM NET KÂRI VEYA ZARARI": 7.4,
              "Dönem Kârının (Zararının) Dağılımı, Ana Ortaklık Payları": 7.4}

    items = canonical_financial_items(balance=balance, income=income)

    assert items["net_income"] == 7.4
    assert items["revenue"] == pytest.approx(54.9)
    assert items["current_assets"] == 139.5
    assert items["total_liabilities"] == pytest.approx(105.2)
    assert statement_template([*balance, *income]) == "insurance"


def test_isyatirim_insurance_numbering_is_stripped():
    assert normalize_label("III - Kısa Vadeli Yükümlülükler Toplamı") == "kisa vadeli yukumlulukler toplami"
    assert normalize_label("N- Dönem Net Karı veya Zararı") == "donem net kari veya zarari"
    assert normalize_label("I- Cari Varlıklar Toplamı") == "cari varliklar toplami"
    items = canonical_financial_items(
        balance={"AKTİF TOPLAMI": 151.3, "I- Cari Varlıklar Toplamı": 139.5,
                 "III - Kısa Vadeli Yükümlülükler Toplamı": 102.2, "Özsermaye Toplamı": 46.1},
        income={"N- Dönem Net Karı veya Zararı": 7.37},
    )
    assert items["total_assets"] == 151.3
    assert items["current_liabilities"] == 102.2
    assert items["total_equity"] == 46.1
    assert items["net_income"] == 7.37


def test_template_detection():
    assert statement_template(["Mevduat", "Varlıklar Toplamı"]) == "bank"
    assert statement_template(["GENEL TEKNİK BÖLÜM DENGESİ"]) == "insurance"
    assert statement_template(["Dönen Varlıklar"]) == "industrial"
    assert fs.combined_template({"template": "industrial"}, {"template": "insurance"}) == "insurance"
    assert fs.combined_template(None, {"template": "financial"}) == "financial"


def test_placeholder_zero_statements_of_unreported_periods_are_missing():
    # İş Yatırım: pre-listing period with an income statement but an all-zero balance sheet.
    isy = {
        "2023/09": {
            "balance": {"TOPLAM VARLIKLAR": 0.0, "Özkaynaklar": 0.0, "Ödenmiş Sermaye": 0.0},
            "income": {"Satış Gelirleri": 964.0, "DÖNEM KARI (ZARARI)": -50.0},
            "cashflow": {"Amortisman & İtfa Payları": 0.0, "İşletme Faaliyetlerinden Kaynaklanan Net Nakit": 0.0},
        },
    }

    facts = fs.build_canonical_facts({}, isy, template="industrial")

    row = facts.items["2023/09"]
    assert row["revenue"] == 964.0 and row["net_income"] == -50.0
    assert row["total_equity"] is None and row["total_assets"] is None and row["paid_in_capital"] is None
    assert row["depreciation_amortization"] is None and row["operating_cash_flow"] is None
    assert "total_equity" not in facts.sources["2023/09"]["keys"]
