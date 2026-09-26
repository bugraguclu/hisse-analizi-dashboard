"""IAS 29 re-expressed İş Yatırım columns → first-published basis (no network, no database).

Figures are BIMAS / KCHOL / THYAO's real ones (TL): İş Yatırım's 2025/06 income statement
is the comparative of the 2026/06 report (re-expressed), its balance sheet is not.
KAP's first-published 2025/06 BIMAS revenue is 309,834,891 thousand TL (disclosure 1478794).
"""

import pytest

from src.adapters import fundamentals_statements as fs
from src.adapters.financial_adapter import ttm_flows

# BIMAS 2025/06: balance-sheet period result (2OCF) and income-statement parent share (3Z).
BS_PROFIT_2506, PARENT_2506 = 5_560_873_000.0, 7_346_117_000.0
OWN_2506 = BS_PROFIT_2506 / PARENT_2506  # 0.756981
F25 = 0.849196  # İş Yatırım's 2025/12 column (re-expressed to 2026/06)
REFERENCE = {"2025/06": 0.756951, "2025/03": 0.764144, "2024/09": 0.750221, "2024/06": 0.740473}


def isy_period(revenue, parent, bs_profit, total_assets, *, net_income=None, d_and_a=None, cfo=None, fx=None):
    cashflow = {"Amortisman & İtfa Payları": d_and_a, "İşletme Faaliyetlerinden Kaynaklanan Net Nakit": cfo}
    if fx is not None:
        cashflow["Net Yabancı Para Pozisyonu"] = fx
    return {
        "balance": {"TOPLAM VARLIKLAR": total_assets, "Özkaynaklar": total_assets / 2,
                    "Ana Ortaklığa Ait Özkaynaklar": total_assets / 2, "Ödenmiş Sermaye": 600e6,
                    "Dönem Net Kar/Zararı": bs_profit},
        "income": {"Satış Gelirleri": revenue, "DÖNEM KARI (ZARARI)": net_income if net_income is not None else parent,
                   "Ana Ortaklık Payları": parent},
        "cashflow": cashflow,
    }


def kap_period(revenue, parent, total_assets):
    return {
        "balance": {"Toplam Varlıklar": total_assets, "Toplam Özkaynaklar": total_assets / 2,
                    "Ana Ortaklığa Ait Özkaynaklar": total_assets / 2, "Ödenmiş Sermaye": 600e6},
        "income": {"Hasılat": revenue, "Net Dönem Kârı (Zararı)": parent,
                   "Dönem Kârının (Zararının) Dağılımı, Ana Ortaklık Payları": parent},
    }


def bimas_sources():
    kap = {
        "2026/06": kap_period(449_695_000_000.0, 14_934_000_000.0, 428_574_000_000.0),
        "2025/12": kap_period(721_063_000_000.0, 18_632_000_000.0, 338_093_000_000.0),
    }
    isy = {
        "2026/06": isy_period(449_695_000_000.0, 14_934_000_000.0, 14_934_000_000.0, 428_574_000_000.0,
                              d_and_a=15_070e6, cfo=40e9),
        "2026/03": isy_period(212_862_000_000.0, 6_461_000_000.0, 6_461_000_000.0, 398_302_000_000.0,
                              d_and_a=7_288e6, cfo=18e9),
        "2025/12": isy_period(721_063e6 / F25, 18_632e6 / F25, 18_632e6 / F25, 338_093e6 / F25,
                              d_and_a=26_637e6 / F25, cfo=60e9 / F25),
        # re-expressed comparative: income statement and cash flow × 1/0.757, balance sheet as published
        "2025/06": isy_period(409_303_226_000.0, PARENT_2506, BS_PROFIT_2506, 295_464_071_000.0,
                              net_income=7_335_863_000.0, d_and_a=16_266_607_000.0, cfo=29_454_043_000.0,
                              fx=103_559_000.0),
    }
    return kap, isy


def test_reference_is_the_median_of_the_agreeing_companies():
    reference = fs.restatement_reference({
        "2025/06": [0.756950, 0.756951, 0.756981, 0.807553, 1.0, None, 0.75695],  # ALARK re-presented
        "2023/09": [0.605, 0.608, 0.609, 0.61, 0.783, 1.39],  # historical-cost first publication
        "2025/09": [1.0, 1.0, 0.9996],  # nobody re-expressed yet
        "2024/06": [0.7405, 0.12792],  # too few companies
    })

    assert reference == {"2025/06": pytest.approx(0.756951, abs=1e-6)}
    evidence = [("a", "2025/06", 5.56e9, 7.346e9), ("b", "2025/06", -3.25e9, -4.29e9), ("c", "2025/06", 1.0, 1.321),
                ("d", "2025/06", 0.0, 5.0)]
    assert fs.restatement_reference_from_evidence(evidence)["2025/06"] == pytest.approx(0.757, abs=2e-3)


def test_interim_comparative_is_converted_with_its_own_profit_ratio():
    kap, isy = bimas_sources()

    facts = fs.build_canonical_facts(kap, isy, template="industrial", reference=REFERENCE)

    column = facts.columns["2025/06"]
    assert column.method == "own_ratio" and column.flow == pytest.approx(OWN_2506)
    assert column.balance == 1.0 and not column.represented
    row = facts.items["2025/06"]
    assert row["revenue"] == pytest.approx(309_834_891_000.0, rel=1e-6)  # KAP disclosure 1478794
    assert row["net_income_parent"] == pytest.approx(BS_PROFIT_2506, rel=1e-9)
    assert row["depreciation_amortization"] == pytest.approx(12_313_510_000.0, rel=1e-5)
    assert row["total_assets"] == 295_464_071_000.0  # balance sheet: as first published
    assert facts.sources["2025/06"]["keys"]["revenue"].startswith("isyatirim*0.756981")
    assert facts.sources["2025/06"]["isyatirim_column"]["method"] == "own_ratio"
    assert facts.restated_periods["2025/06"] == pytest.approx(OWN_2506)
    ttm = ttm_flows(facts.items, "2026/06")
    assert ttm is not None and ttm["revenue"] == pytest.approx(860.923e9, rel=1e-5)  # was 761.5 bn
    # current-year interims are not comparatives yet
    assert facts.columns["2026/03"].method == "not_restated"
    assert facts.items["2026/03"]["revenue"] == 212_862_000_000.0


def test_small_or_sign_changing_profit_falls_back_to_the_period_reference():
    kap, isy = bimas_sources()
    # KCHOL 2024/06-like: the comparative's net income was re-presented (2OCF / 3Z = 0.128).
    isy["2025/06"]["balance"]["Dönem Net Kar/Zararı"] = 0.12792 * PARENT_2506

    facts = fs.build_canonical_facts(kap, isy, template="industrial", reference=REFERENCE)

    column = facts.columns["2025/06"]
    assert column.method == "period_reference" and column.flow == REFERENCE["2025/06"]
    assert column.represented and column.parent_income == pytest.approx(0.12792 * PARENT_2506)
    row = facts.items["2025/06"]
    assert row["revenue"] == pytest.approx(409_303_226_000.0 * REFERENCE["2025/06"], abs=1.0)
    assert row["depreciation_amortization"] == pytest.approx(16_266_607_000.0 * REFERENCE["2025/06"], abs=1.0)
    assert row["net_income_parent"] == pytest.approx(0.12792 * PARENT_2506)  # first published (balance sheet)
    assert row["net_income"] is None and row["operating_cash_flow"] is None  # re-presented: unknown
    assert facts.sources["2025/06"]["keys"]["net_income_parent"] == "isyatirim:2OCF"
    assert facts.partial_periods["2025/06"] == "isyatirim_comparative_represented"

    isy["2025/06"]["balance"]["Dönem Net Kar/Zararı"] = -1_905e6  # sign change (KCHOL 2024/09)
    flipped = fs.build_canonical_facts(kap, isy, template="industrial", reference=REFERENCE)
    assert flipped.columns["2025/06"].represented and flipped.items["2025/06"]["net_income_parent"] == -1_905e6

    isy["2025/06"]["balance"]["Dönem Net Kar/Zararı"] = None  # no evidence at all → the reference
    missing = fs.build_canonical_facts(kap, isy, template="industrial", reference=REFERENCE)
    assert missing.columns["2025/06"].method == "period_reference" and not missing.columns["2025/06"].represented
    assert missing.items["2025/06"]["net_income_parent"] == pytest.approx(PARENT_2506 * REFERENCE["2025/06"], abs=1.0)


def test_without_a_reference_a_plausible_own_ratio_is_used_and_an_implausible_one_is_unknown():
    kap, isy = bimas_sources()

    facts = fs.build_canonical_facts(kap, isy, template="industrial")
    assert facts.columns["2025/06"].method == "own_ratio_unconfirmed"
    assert facts.items["2025/06"]["revenue"] == pytest.approx(309_834_891_000.0, rel=1e-6)

    isy["2025/06"]["balance"]["Dönem Net Kar/Zararı"] = 0.12792 * PARENT_2506
    isy["2024/06"] = isy_period(299_460_755_000.0, 11_783_000_000.0, 11_783_000_000.0 * 0.740473, 200e9)
    unknown = fs.build_canonical_facts(kap, isy, template="industrial")
    assert unknown.columns["2025/06"].method == "unknown" and unknown.columns["2025/06"].flow is None
    assert unknown.items["2025/06"]["revenue"] is None  # never the re-expressed figure
    assert unknown.items["2025/06"]["total_assets"] == 295_464_071_000.0
    assert unknown.partial_periods["2025/06"] == "isyatirim_flows_restated_factor_unknown"


def test_pre_ias29_comparatives_cannot_be_converted():
    kap, isy = bimas_sources()
    # 2023/09 was first published at historical cost; İş Yatırım serves the IAS 29 comparative of 2024/09.
    isy["2024/09"] = isy_period(489.8e9, 18.467e9, 18.467e9 * 0.750221, 223.9e9)
    isy["2023/09"] = isy_period(330.891e9, 13.300e9, 13.300e9 * 0.6052, 99.4e9)

    facts = fs.build_canonical_facts(kap, isy, template="industrial", reference=REFERENCE)

    assert facts.columns["2023/09"].method == "unknown"
    assert facts.items["2023/09"]["revenue"] is None and facts.items["2023/09"]["total_assets"] == 99.4e9
    assert fs.restatement_reference({"2023/09": [0.6052, 0.6052, 0.6052]}) == {}


def test_company_without_ias29_interims_keeps_them_although_year_ends_are_reexpressed():
    # THYAO (USD functional currency): İş Yatırım re-expresses its year-end columns (KAP ÷ İşY = 0.849)
    # but its interim comparatives carry 2OCF = 3Z; a 2 % own-ratio outlier is not a restatement.
    kap, isy = bimas_sources()
    isy["2025/06"] = isy_period(408_036e6, 25_013e6, 25_013e6, 1_652_589e6)
    isy["2025/03"] = isy_period(221_815e6, -1_818e6, -1_818e6 * 1.019802, 1_600_000e6)
    isy["2024/09"] = isy_period(690e9, 80e9, 80e9 * 0.9996, 1_500_000e6)

    facts = fs.build_canonical_facts(kap, isy, template="industrial", reference=REFERENCE)

    assert facts.columns["2025/12"].method == "kap"
    for period in ("2025/06", "2025/03", "2024/09"):
        assert facts.columns[period].method == "not_restated", period
    assert facts.items["2025/06"]["revenue"] == 408_036e6
    assert facts.items["2025/03"]["revenue"] == 221_815e6


def test_statement_rows_flag_only_the_reexpressed_statements():
    kap, isy = bimas_sources()
    facts = fs.build_canonical_facts(kap, isy, template="industrial", reference=REFERENCE)
    table = {
        "group": "XI_29", "template": "industrial", "periods": ["2026/06", "2025/12", "2025/06"],
        "items": [
            {"code": "1BL", "label": "TOPLAM VARLIKLAR", "statement": "balance",
             "values": {"2026/06": 1.0, "2025/12": 2.0, "2025/06": 3.0}},
            {"code": "3C", "label": "Satış Gelirleri", "statement": "income",
             "values": {"2026/06": 1.0, "2025/12": 2.0, "2025/06": 3.0}},
            {"code": "4CAB", "label": "Amortisman & İtfa Payları", "statement": "cashflow",
             "values": {"2026/06": 1.0, "2025/12": 2.0, "2025/06": 3.0}},
        ],
    }

    rows = fs.isyatirim_statement_rows(table, ticker="BIMAS", restated=facts.statement_restatements())

    flags = {(r["period"], r["statement_type"]): (r["restated"], r["restatement_factor"]) for r in rows}
    assert flags[("2025/12", "balance_sheet")] == (True, F25)
    assert flags[("2025/12", "cash_flow")] == (True, F25)
    assert flags[("2025/06", "income_stmt")] == (True, round(OWN_2506, 6))
    assert flags[("2025/06", "cash_flow")] == (True, round(OWN_2506, 6))
    assert flags[("2025/06", "balance_sheet")] == (False, None)  # an interim balance sheet is never re-expressed
    assert flags[("2026/06", "income_stmt")] == (False, None)


def _adapter_payloads():
    """KAP summary + İş Yatırım table payloads (BIMAS-like) for the views."""
    kap = {
        "periods": ["2026/06", "2025/12"], "fiscal_year_end_month": 12, "template": "industrial", "unit": "TRY",
        "balance_sheet": [{"Item": "Toplam Varlıklar", "2026/06": 428_574e6, "2025/12": 338_093e6}],
        "income_statement": [
            {"Item": "Hasılat", "2026/06": 449_695e6, "2025/12": 721_063e6},
            {"Item": "Net Dönem Kârı (Zararı)", "2026/06": 15_095e6, "2025/12": 18_735e6},
        ],
        "period_info": {s: {p: {"multiplier": 1e6} for p in ("2026/06", "2025/12")} for s in ("balance", "income")},
    }
    values = {  # code → {period: value} as served
        "1BL": {"2026/06": 428_574e6, "2025/12": 338_093e6 / F25, "2025/06": 295_464e6, "2023/09": 99_428e6},
        "2OCF": {"2026/06": 14_934e6, "2025/12": 18_632e6 / F25, "2025/06": BS_PROFIT_2506, "2023/09": 8e9},
        "3C": {"2026/06": 449_695e6, "2025/12": 721_063e6 / F25, "2025/06": 409_303_226_000.0, "2023/09": 330_891e6},
        "3L": {"2026/06": 15_095e6, "2025/12": 18_735e6 / F25, "2025/06": 7_335_863_000.0, "2023/09": 13_291e6},
        "3Z": {"2026/06": 14_934e6, "2025/12": 18_632e6 / F25, "2025/06": PARENT_2506, "2023/09": 13_300e6},
        "4CAB": {"2026/06": 15_070e6, "2025/12": 26_637e6 / F25, "2025/06": 16_266_607_000.0, "2023/09": 11e9},
        "4BE": {"2026/06": 90e6, "2025/12": 80e6 / F25, "2025/06": 103_559_000.0, "2023/09": 50e6},
    }
    labels = {"1BL": ("TOPLAM VARLIKLAR", "balance"), "2OCF": ("Dönem Net Kar/Zararı", "balance"),
              "3C": ("Satış Gelirleri", "income"), "3L": ("DÖNEM KARI (ZARARI)", "income"),
              "3Z": ("Ana Ortaklık Payları", "income"), "4CAB": ("Amortisman & İtfa Payları", "cashflow"),
              "4BE": ("Net Yabancı Para Pozisyonu", "cashflow")}
    isy = {
        "group": "XI_29", "template": "industrial", "periods": ["2026/06", "2025/12", "2025/06", "2023/09"],
        "items": [{"code": c, "label": labels[c][0], "statement": labels[c][1], "values": v} for c, v in values.items()],
    }
    return kap, isy


def test_quarterly_income_view_shows_first_published_interim_comparatives():
    kap, isy = _adapter_payloads()

    view = fs.build_statement_view("BIMAS", kap, isy, quarterly=True, section="income", reference=REFERENCE)

    revenue = next(r for r in view["data"] if r["Item"] == "Hasılat")
    assert revenue["2025/06"] == pytest.approx(309_834_891_000.0, rel=1e-6)
    assert "2023/09" not in view["periods"]  # historical-cost first publication: unknown, left out
    info = {i["period"]: i for i in view["period_info"]}
    assert info["2025/06"]["source"] == "İş Yatırım"
    assert info["2025/06"]["restatement_factor"] == pytest.approx(round(OWN_2506, 6))
    assert any("TMS 29" in note for note in view["notes"])
    assert any("2023/09" in note for note in view["notes"])
    balance = fs.build_statement_view("BIMAS", kap, isy, quarterly=True, section="balance", reference=REFERENCE)
    assets = next(r for r in balance["data"] if r["Item"] == "Toplam Varlıklar")
    assert assets["2025/06"] == 295_464e6  # interim balance sheet: as first published
    assert assets["2023/09"] == 99_428e6


def test_cashflow_view_converts_interim_comparatives_but_not_their_fx_position():
    kap, isy = _adapter_payloads()

    view = fs.build_cashflow_view("BIMAS", kap, isy, quarterly=True, reference=REFERENCE)

    rows = {r["Item"]: r for r in view["data"]}
    assert rows["Amortisman & İtfa Payları"]["2025/06"] == pytest.approx(12_313_510_000.0, rel=1e-5)
    assert rows["Amortisman & İtfa Payları"]["2025/12"] == pytest.approx(26_637e6)  # KAP factor
    assert rows["Net Yabancı Para Pozisyonu"]["2025/06"] == 103_559_000.0  # from the period's own report
    assert rows["Net Yabancı Para Pozisyonu"]["2025/12"] == pytest.approx(80e6)
    assert "2023/09" not in view["periods"]
    no_kap = fs.build_cashflow_view("BIMAS", None, isy, quarterly=True, reference=REFERENCE)
    no_kap_rows = {r["Item"]: r for r in no_kap["data"]}
    assert no_kap_rows["Amortisman & İtfa Payları"]["2025/06"] == pytest.approx(12_313_510_000.0, rel=1e-5)
