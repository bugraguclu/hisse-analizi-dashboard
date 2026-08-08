"""Deterministic KAP financial-statement parsing and unit tests."""

from src.adapters.fundamentals import _filter_kap_periods, _parse_kap_financial_summary


KAP_SUMMARY_HTML = """
<html><body>
  <table>
    <tr><th>FİNANSAL DURUM TABLOSU</th><th>2024/12</th><th>2025/03</th><th>2025/12</th></tr>
    <tr><td>Sunum Para Birimi</td><td>1000000 TL</td><td></td><td></td></tr>
    <tr><td>Toplam Varlıklar</td><td>1.399.606</td><td>1.520.000</td><td>1.996.745</td></tr>
  </table>
  <table>
    <tr><th>KAR VEYA ZARAR VE DİĞER KAPSAMLI GELİR TABLOSU</th><th>2024/12</th><th>2025/03</th><th>2025/12</th></tr>
    <tr><td>Hasılat</td><td>745.430</td><td>221.815</td><td>955.472</td></tr>
    <tr><td>Net Dönem Kârı (Zararı)</td><td>113.357</td><td>17.650</td><td>118.117</td></tr>
  </table>
</body></html>
"""


def test_kap_parser_scales_million_try_and_preserves_period_grain():
    parsed = _parse_kap_financial_summary(KAP_SUMMARY_HTML)

    assert parsed["unit"] == "TRY"
    assert parsed["periods"] == ["2024/12", "2025/03", "2025/12"]
    assert parsed["balance_sheet"][0] == {
        "Item": "Toplam Varlıklar",
        "2024/12": 1_399_606_000_000.0,
        "2025/03": 1_520_000_000_000.0,
        "2025/12": 1_996_745_000_000.0,
    }
    assert parsed["income_statement"][0]["2025/12"] == 955_472_000_000.0


def test_annual_statement_filter_excludes_interim_periods():
    records = [
        {
            "Item": "Toplam Varlıklar",
            "2024/12": 1.0,
            "2025/03": 2.0,
            "2025/12": 3.0,
        }
    ]

    assert _filter_kap_periods(records, quarterly=False) == [
        {"Item": "Toplam Varlıklar", "2024/12": 1.0, "2025/12": 3.0}
    ]
    assert _filter_kap_periods(records, quarterly=True) == records
