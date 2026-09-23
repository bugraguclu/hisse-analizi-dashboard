"""DB ratios (/financials/ratios) from stored statements — THYAO FY2024/FY2025 figures.

The computation is the shared compute_financial_ratios(); these tests pin the DB
mapping: previous-year lookup, D&A-inclusive EBITDA, NUMERIC overflow guard, and
"missing is None, never 0".
"""

from decimal import Decimal

import pytest

from src.db.models import FinancialStatement
from src.services.analysis_service import DB_RATIO_COLUMNS, AnalysisService, compute_period_ratios

BS_2025 = {
    "Dönen Varlıklar": 480228499809.0,
    "  Nakit ve Nakit Benzerleri": 94673058901.0,
    "TOPLAM VARLIKLAR": 2197221560937.0,
    "Kısa Vadeli Yükümlülükler": 486461174949.0,
    "  Finansal Borçlar": 662240440386.0,
    "Uzun Vadeli Yükümlülükler": 708012748842.0,
    "Özkaynaklar": 1002747637146.0,
    "  Ana Ortaklığa Ait Özkaynaklar": 1002710223489.0,
    "  Diğer Özsermaye Kalemleri": 1234.0,  # must never be taken as total equity
    "TOPLAM KAYNAKLAR": 2197221560937.0,
}
BS_2024 = {"Özkaynaklar": 890083542807.0, "TOPLAM VARLIKLAR": 1831976887193.0}
IS_2025 = {
    "Satış Gelirleri": 1051402998015.0,
    "BRÜT KAR (ZARAR)": 171178485996.0,
    "Net Faaliyet Kar/Zararı": 69914021006.0,
    "FAALİYET KARI (ZARARI)": 99178103396.0,
    "DÖNEM KARI (ZARARI)": 129976145734.0,
    "Ana Ortaklık Payları": 130076282287.0,
}
CF_2025 = {"Amortisman Giderleri": 104188232264.0}


def _stmt(period: str, statement_type: str, data: dict) -> FinancialStatement:
    items = [{"code": None, "label": label, "key": label.strip().lower(), "value": value} for label, value in data.items()]
    return FinancialStatement(period=period, statement_type=statement_type, source="isyatirim", items_json=items)


STATEMENTS = [
    _stmt("2025", "balance_sheet", BS_2025),
    _stmt("2025", "income_stmt", IS_2025),
    _stmt("2025", "cash_flow", CF_2025),
    _stmt("2024", "balance_sheet", BS_2024),
]


def test_thyao_ratios_previously_null_are_now_computed():
    ratios = AnalysisService(session=None).ratios_from_statements(STATEMENTS, "2025")  # type: ignore[arg-type]
    for name in ("roe", "roa", "net_margin", "debt_to_equity", "gross_margin", "ebitda_margin", "current_ratio"):
        assert isinstance(ratios[name], Decimal), name
    avg_parent_equity = (1002710223489.0 + 890083542807.0) / 2  # previous year falls back to total equity
    assert float(ratios["roe"]) == pytest.approx(130076282287.0 / avg_parent_equity * 100, abs=0.01)
    assert float(ratios["roa"]) == pytest.approx(129976145734.0 / ((2197221560937.0 + 1831976887193.0) / 2) * 100, abs=0.01)
    assert float(ratios["net_margin"]) == pytest.approx(12.36, abs=0.01)
    assert float(ratios["gross_margin"]) == pytest.approx(16.28, abs=0.01)
    # EBITDA = operating profit + D&A from the cash-flow statement (was understated before)
    ebitda = 99178103396.0 + 104188232264.0
    assert float(ratios["ebitda_margin"]) == pytest.approx(ebitda / 1051402998015.0 * 100, abs=0.01)
    assert float(ratios["net_debt_ebitda"]) == pytest.approx((662240440386.0 - 94673058901.0) / ebitda, abs=0.01)
    assert float(ratios["debt_to_equity"]) == pytest.approx((486461174949.0 + 708012748842.0) / 1002747637146.0, abs=0.01)
    # valuation multiples need market data: stored as NULL, never 0
    assert ratios["pe_ratio"] is None and ratios["pb_ratio"] is None and ratios["ps_ratio"] is None
    assert ratios["raw_ratios_json"]["operating_margin"] == pytest.approx(9.43, abs=0.01)


def test_columns_match_the_model():
    assert set(DB_RATIO_COLUMNS) <= set(FinancialStatement.metadata.tables["financial_ratios"].columns.keys())


def test_missing_depreciation_gives_no_ebitda():
    ratios = compute_period_ratios({"balance_sheet": BS_2025, "income_stmt": IS_2025})
    assert ratios["ebitda_margin"] is None
    assert ratios["net_debt_ebitda"] is None
    assert ratios["roe"] is not None  # period-end equity when no previous year


def test_negative_equity_gives_no_roe_or_leverage():
    bs = {**BS_2025, "Özkaynaklar": -5.0, "  Ana Ortaklığa Ait Özkaynaklar": -5.0}
    ratios = compute_period_ratios({"balance_sheet": bs, "income_stmt": IS_2025})
    assert ratios["roe"] is None and ratios["debt_to_equity"] is None


def test_values_overflowing_numeric_12_4_are_not_stored():
    statements = [
        _stmt("2025", "balance_sheet", {"Dönen Varlıklar": 1e15, "Kısa Vadeli Yükümlülükler": 1.0, "Özkaynaklar": 10.0}),
        _stmt("2025", "income_stmt", {"Satış Gelirleri": 100.0, "BRÜT KAR (ZARAR)": 50.0}),
    ]
    ratios = AnalysisService(session=None).ratios_from_statements(statements, "2025")  # type: ignore[arg-type]
    assert ratios["current_ratio"] is None  # 1e15 would overflow the column
    assert float(ratios["gross_margin"]) == 50.0


def test_ratios_require_balance_sheet_and_income_statement():
    statements = [_stmt("2025", "balance_sheet", BS_2025)]
    assert AnalysisService(session=None).ratios_from_statements(statements, "2025") == {}  # type: ignore[arg-type]
