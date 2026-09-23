"""Deterministic KAP / market-data parsing tests for the fundamentals adapter (no network)."""

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from src.adapters import fundamentals as f
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

# Bank layout: the presentation unit differs per column (thousand TL for the
# older columns, million TL for the latest interim) and spacer rows exist.
BANK_SUMMARY_HTML = """
<html><body><table>
  <tr><th>FİNANSAL DURUM TABLOSU</th><th>2023/12</th><th>2024/12</th><th>2025/12</th><th>2026/06</th></tr>
  <tr><td></td><td></td><td></td><td></td><td></td></tr>
  <tr><td>Sunum Para Birimi</td><td>1000TL</td><td>1000TL</td><td>1000TL</td><td>1000000TL</td></tr>
  <tr><td>Finansal Tablo Niteliği</td><td>Konsolide</td><td>Konsolide</td><td>Konsolide</td><td>Konsolide</td></tr>
  <tr><td>Varlıklar Toplamı</td><td>1.904.769.488</td><td>2.653.105.361</td><td>3.558.949.685</td><td>4.012.479</td></tr>
  <tr><td>Mevduat</td><td>1.292.914.464</td><td>1.632.597.385</td><td>2.173.421.167</td><td>2.511.089</td></tr>
  <tr><td>Özkaynaklar</td><td>211.218.707</td><td>240.383.648</td><td>310.169.116</td><td>324.751</td></tr>
  <tr><td>Yükümlülükler Toplamı</td><td>1.904.769.488</td><td>2.653.105.361</td><td>3.558.949.685</td><td>4.012.479</td></tr>
  <tr><td>KAR VEYA ZARAR VE DİĞER KAPSAMLI GELİR TABLOSU</td><td>2023/12</td><td>2024/12</td><td>2025/12</td><td>2026/06</td></tr>
  <tr><td>Sunum Para Birimi</td><td>1000TL</td><td>1000TL</td><td>1000TL</td><td>1000000TL</td></tr>
  <tr><td></td><td></td><td></td></tr>
  <tr><td>Net Faiz Geliri veya Gideri</td><td>68.868.982</td><td>70.087.916</td><td>108.985.221</td><td>88.026</td></tr>
  <tr><td>Net Dönem Kârı (Zararı)</td><td>66.496.235</td><td>42.362.192</td><td>57.224.231</td><td>(34.333)</td></tr>
</table></body></html>
"""


def test_kap_parser_scales_million_try_and_orders_periods_newest_first():
    parsed = _parse_kap_financial_summary(KAP_SUMMARY_HTML)

    assert parsed["unit"] == "TRY"
    # Newest first (the UI and ``as_of`` read the first column); previously the
    # parser returned KAP's page order (oldest first).
    assert parsed["periods"] == ["2025/12", "2025/03", "2024/12"]
    assert parsed["fiscal_year_end_month"] == 12
    assert parsed["template"] == "industrial"
    assert parsed["balance_sheet"][0] == {
        "Item": "Toplam Varlıklar",
        "2025/12": 1_996_745_000_000.0,
        "2025/03": 1_520_000_000_000.0,
        "2024/12": 1_399_606_000_000.0,
    }
    assert list(parsed["balance_sheet"][0]) == ["Item", "2025/12", "2025/03", "2024/12"]
    assert parsed["income_statement"][0]["2025/12"] == 955_472_000_000.0


def test_kap_parser_applies_presentation_unit_per_column():
    parsed = _parse_kap_financial_summary(BANK_SUMMARY_HTML)
    assets = next(r for r in parsed["balance_sheet"] if r["Item"] == "Varlıklar Toplamı")

    # 3.558.949.685 thousand TL and 4.012.479 million TL — not 4.012.479 thousand.
    assert assets["2025/12"] == 3_558_949_685_000.0
    assert assets["2026/06"] == 4_012_479_000_000.0
    assert parsed["template"] == "bank"
    assert parsed["period_info"]["balance"]["2026/06"]["presentation_unit"] == "1000000TL"
    assert parsed["period_info"]["balance"]["2026/06"]["consolidation"] == "Konsolide"
    net_income = next(r for r in parsed["income_statement"] if r["Item"] == "Net Dönem Kârı (Zararı)")
    assert net_income["2026/06"] == -34_333_000_000.0  # parenthesised negative


def test_kap_parser_rejects_pages_without_statement_headers():
    with pytest.raises(ValueError):
        _parse_kap_financial_summary("<html><table><tr><td>x</td></tr></table></html>")


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


def test_annual_filter_follows_non_calendar_fiscal_year():
    records = [{"Item": "Hasılat", "2026/02": 9.0, "2025/05": 12.0, "2024/05": 10.0}]

    assert _filter_kap_periods(records, quarterly=False, fiscal_year_end_month=5) == [
        {"Item": "Hasılat", "2025/05": 12.0, "2024/05": 10.0}
    ]


DIRECTORY_HTML = """
<table>
  <tr>
    <td><a href="/tr/sirket-bilgileri/ozet/2422-turkiye-garanti-bankasi-a-s"><div>GARAN</div><div> TGB</div></a></td>
    <td><a href="/tr/sirket-bilgileri/ozet/2422-turkiye-garanti-bankasi-a-s">TÜRKİYE GARANTİ BANKASI A.Ş.</a></td>
  </tr>
  <tr>
    <td><a href="/tr/sirket-bilgileri/ozet/6121-emlak-konut-damla-kent-gms"><div>DMLKT</div></a></td>
    <td><a href="/tr/sirket-bilgileri/ozet/6121-emlak-konut-damla-kent-gms">EMLAK KONUT DAMLA KENT GMS</a></td>
  </tr>
  <tr>
    <td><a href="/tr/sirket-bilgileri/ozet/1000-kent-gida"><div>KENT</div></a></td>
    <td><a href="/tr/sirket-bilgileri/ozet/1000-kent-gida">KENT GIDA MADDELERİ SANAYİİ VE TİCARET A.Ş.</a></td>
  </tr>
</table>
"""


def test_kap_directory_maps_every_ticker_of_a_multi_code_cell():
    directory = f._parse_kap_directory(DIRECTORY_HTML)

    garanti = "https://www.kap.org.tr/tr/sirket-finansal-bilgileri/2422-turkiye-garanti-bankasi-a-s"
    assert directory["GARAN"]["url"] == garanti
    assert directory["TGB"]["url"] == garanti
    assert directory["GARAN"]["title"] == "TÜRKİYE GARANTİ BANKASI A.Ş."


def test_kap_directory_ignores_company_name_cells():
    directory = f._parse_kap_directory(DIRECTORY_HTML)

    # "EMLAK KONUT DAMLA KENT GMS" is a name, not a ticker list: KENT must stay Kent Gıda.
    assert directory["KENT"]["url"].endswith("/1000-kent-gida")
    assert "EMLAK" not in directory and "GMS" not in directory
    assert directory["DMLKT"]["url"].endswith("/6121-emlak-konut-damla-kent-gms")


def test_snapshot_recovers_share_count_from_previous_close_market_cap():
    row = {
        "close": 302.0,
        "change_abs": 8.5,
        "change": 2.896,
        "open": 293.5,
        "high": 302.75,
        "low": 291.25,
        "market_cap_basic": 405_030_000_000,
        "total_shares_outstanding": 1_372_359_756,
        "price_52_week_high": 355.5,
        "price_52_week_low": 258.25,
        "price_earnings_ttm": 3.7030406,
        "description": "TÜRK HAVA YOLLARI A.O.",
    }

    snap = f._snapshot_from_scan(row, {"free_float": 49.7, "foreign_ratio": 22.9})

    assert snap["previous_close"] == 293.5
    assert snap["shares"] == 1_380_000_000  # 405.03 bn / 293.5 — the paid-in capital
    assert snap["market_cap"] == 302.0 * 1_380_000_000  # live price × shares
    assert snap["pe_ratio"] == 3.7
    assert snap["free_float"] == 49.7
    assert snap["amount"] is None  # missing stays missing, never 0


def test_dividend_dates_use_istanbul_calendar_day():
    istanbul_midnight = datetime(2025, 9, 2, tzinfo=ZoneInfo("Europe/Istanbul"))
    items = [
        {
            "SHT_KODU": "04",
            "SHHE_TARIH": istanbul_midnight.timestamp() * 1000,
            "SHHE_NAKIT_TM_ORAN": 344.2,
            "SHHE_NAKIT_TM_ORAN_NET": 292.57,
            "SHHE_NAKIT_TM_TUTAR": 4_750_000_000,
        },
        {"SHT_KODU": "01", "SHHE_TARIH": istanbul_midnight.timestamp() * 1000},  # capital increase
    ]

    records = f._dividend_records(items * 2)  # duplicates collapse

    assert records == [
        {
            "Date": "2025-09-02T00:00:00",
            "Amount": 3.442,
            "GrossRate": 344.2,
            "NetRate": 292.57,
            "TotalDividend": 4_750_000_000.0,
        }
    ]


def test_supplement_rows_only_extend_rows_that_match_kap():
    kap = {
        "periods": ["2026/06", "2025/12"],
        "period_info": {"income": {"2026/06": {"multiplier": 1e6}, "2025/12": {"multiplier": 1e6}}},
    }
    records = [
        {"Item": "Hasılat", "2026/06": 1_180_496e6, "2025/12": 1_838_618e6},
        # Holding reports equity-method income inside operating profit; İş Yatırım does not.
        {"Item": "Esas Faaliyet Kârı (Zararı)", "2026/06": 95_971e6, "2025/12": 117_608e6},
    ]
    isy = {
        "periods": ["2026/06", "2026/03", "2025/12"],
        "items": [
            {"code": "3C", "values": {"2026/06": 1_180_496e6, "2026/03": 494_094e6, "2025/12": 1_838_618e6}},
            {"code": "3DF", "values": {"2026/06": 88_957e6, "2026/03": 30_000e6, "2025/12": 110_000e6}},
        ],
    }
    factors = {"2026/06": {"balance": 1.0, "flow": 1.0}, "2025/12": {"balance": 1.0, "flow": 1.0}}

    rows, added = f._supplement_rows(records, kap, isy, factors, "income")

    assert added == ["2026/03"]
    assert rows[0]["2026/03"] == 494_094e6
    assert rows[1]["2026/03"] is None  # definitions differ → never mixed into one row
    assert list(rows[0]) == ["Item", "2026/06", "2026/03", "2025/12"]


def test_discrete_cash_flow_keeps_balances_and_chains_opening_cash():
    # THYAO-like İş Yatırım cash-flow rows (million TL, cumulative YTD for flows).
    records = [
        {"Item": "Amortisman & İtfa Payları", "2026/06": 58_665.0, "2026/03": 28_358.0, "2025/12": 94_682.0,
         "2025/09": 67_762.0},
        {"Item": "Net Yabancı Para Pozisyonu", "2026/06": -299_075.0, "2026/03": -258_931.0, "2025/12": -277_645.0,
         "2025/09": -219_830.0},
        {"Item": "Parasal net yabancı para varlık/(yükümlülük) pozisyonu", "2026/06": -392_004.0,
         "2026/03": -344_084.0, "2025/12": -357_381.0, "2025/09": -267_772.0},
        {"Item": "Net YPP (Hedge Dahil)", "2026/06": -268_708.0, "2026/03": -250_163.0, "2025/12": -276_081.0,
         "2025/09": -221_448.0},
        {"Item": "Nakit ve Benzerlerindeki Değişim", "2026/06": -5_065.0, "2026/03": -13_392.0, "2025/12": -6_981.0,
         "2025/09": 6_950.0},
        {"Item": "Dönem Başı Nakit Değerler", "2026/06": 83_183.0, "2026/03": 83_183.0, "2025/12": 90_164.0,
         "2025/09": 90_164.0},
        {"Item": "Dönem Sonu Nakit", "2026/06": 78_118.0, "2026/03": 69_791.0, "2025/12": 83_183.0,
         "2025/09": 97_114.0},
    ]

    rows = {r["Item"]: r for r in f._discrete_rows(records, 12)}

    # Flows are single-quarter differences of the cumulative values.
    assert rows["Amortisman & İtfa Payları"]["2026/06"] == 30_307.0
    assert rows["Nakit ve Benzerlerindeki Değişim"]["2026/06"] == 8_327.0
    # End-of-period balances are never differenced.
    assert rows["Dönem Sonu Nakit"]["2026/06"] == 78_118.0
    assert rows["Dönem Sonu Nakit"]["2025/12"] == 83_183.0
    assert rows["Net Yabancı Para Pozisyonu"]["2026/06"] == -299_075.0
    assert rows["Parasal net yabancı para varlık/(yükümlülük) pozisyonu"]["2025/12"] == -357_381.0
    assert rows["Net YPP (Hedge Dahil)"]["2026/06"] == -268_708.0
    # Opening cash of a quarter = closing cash of the previous quarter (Q1: fiscal-year opening).
    opening = rows["Dönem Başı Nakit Değerler"]
    assert opening["2026/06"] == 69_791.0
    assert opening["2026/03"] == 83_183.0
    assert opening["2025/12"] == 97_114.0
    assert opening["2025/09"] is None  # 2025/06 closing cash not in the table → unknown, not 0


def test_restatement_factor_converts_ias29_columns_back_to_reported():
    kap_items = {"2025/12": {"total_assets": 1_996_745e6, "revenue": 955_472e6}}
    isy_items = {"2025/12": {"total_assets": 2_351_336_385_167.0, "revenue": 1_125_149_219_659.0}}

    factors = f._restatement_factors(kap_items, isy_items, "industrial")

    assert factors["2025/12"]["balance"] == pytest.approx(0.8491958, rel=1e-6)
    scaled = f._scaled_items(
        {"depreciation_amortization": 111_496_075_673.0, "paid_in_capital": 1_380_000_000.0},
        factors["2025/12"],
        unit=1e6,
    )
    assert scaled["depreciation_amortization"] == 94_682e6
    assert scaled["paid_in_capital"] == 1_380_000_000.0  # nominal capital is never restated
    # Bank data on İş Yatırım is solo vs consolidated on KAP: no rescaling.
    assert f._restatement_factors(kap_items, isy_items, "bank") == {}


def test_live_ratios_use_ttm_flows_latest_balance_and_live_market_cap():
    def period(**values):
        return values

    items_by_period = {
        "2026/06": period(revenue=585_069e6, gross_profit=42_587e6, operating_profit=-5_098e6,
                          depreciation_amortization=58_665e6, net_income=18_766e6, net_income_parent=18_864e6,
                          total_assets=2_360_037e6, total_equity=1_018_453e6, parent_equity=1_018_517e6,
                          current_assets=512_191e6, current_liabilities=566_751e6, total_liabilities=1_341_584e6,
                          financial_debt=914_234e6, cash=80_346e6, short_term_investments=213_510e6,
                          minority_interest=-64e6, paid_in_capital=1_380e6),
        "2025/12": period(revenue=955_472e6, gross_profit=155_560e6, operating_profit=90_129e6,
                          depreciation_amortization=94_682e6, net_income=118_117e6, net_income_parent=118_208e6,
                          total_assets=1_996_745e6, parent_equity=911_222e6, total_equity=911_256e6),
        "2025/06": period(revenue=408_036e6, gross_profit=56_146e6, operating_profit=24_529e6,
                          depreciation_amortization=42_953e6, net_income=24_935e6, net_income_parent=25_013e6,
                          total_assets=1_652_589e6, parent_equity=752_073e6, total_equity=752_120e6),
    }

    result = f.compute_live_ratios(items_by_period, price=300.5, snapshot_shares=1_380_000_000)

    assert result is not None
    assert result["as_of"] == "2026/06"
    assert result["basis"] == "ttm"
    assert result["ttm_quarters"] == ["2025/09", "2025/12", "2026/03", "2026/06"]
    assert result["ttm"]["revenue"] == pytest.approx(1_132_505e6)
    assert result["ttm"]["net_income_parent"] == pytest.approx(112_059e6)
    assert result["ttm"]["ebitda"] == pytest.approx(60_502e6 + 110_394e6)
    assert result["valuation"]["market_cap"] == pytest.approx(300.5 * 1_380e6)
    assert result["valuation"]["shares_source"] == "paid_in_capital"
    ratios = result["ratios"]
    assert ratios["pe_ratio"] == 3.7
    assert ratios["pb_ratio"] == 0.41
    assert ratios["roe"] == pytest.approx(12.66, abs=0.01)  # TTM NI / average parent equity
    assert ratios["ebitda_margin"] == pytest.approx(15.09, abs=0.01)


def test_snapshot_prefers_total_capital_market_cap_over_provider_share_count():
    # TradingView reports 1.856 bn KCHOL shares; İş Yatırım's market cap implies the
    # real paid-in capital (2.536 bn shares of 1 TL nominal).
    row = {"close": 221.0, "change_abs": -1.3, "market_cap_basic": 563_730_145_608,
           "total_shares_outstanding": 1_856_230_000}

    snap = f._snapshot_from_scan(row, {"market_cap": 563_730_100_000})

    assert snap["shares"] == pytest.approx(2_535_898_000, rel=1e-6)
    assert snap["market_cap"] == pytest.approx(221.0 * snap["shares"])


@pytest.mark.parametrize(
    ("close", "change_abs", "isy_market_cap", "tv_market_cap", "expected_shares"),
    [
        # Evening / weekend: İş Yatırım already priced at the day's close, TradingView's
        # change (and market cap) still refer to the previous close.
        (298.0, 4.5, 411_240_000_000, 405_030_000_000, 1_380_000_000),
        (397.0, -17.75, 764_937_900_000, 799_138_497_620, 1_926_795_718),
        # Session: both priced at the previous close.
        (298.0, 4.5, 405_030_000_000, 405_030_000_000, 1_380_000_000),
    ],
)
def test_snapshot_share_count_does_not_drift_with_the_market_cap_price_basis(
    close, change_abs, isy_market_cap, tv_market_cap, expected_shares
):
    row = {"close": close, "change_abs": change_abs, "market_cap_basic": tv_market_cap}

    snap = f._snapshot_from_scan(row, {"market_cap": isy_market_cap})

    assert snap["shares"] == pytest.approx(expected_shares, rel=2e-7)
    assert snap["market_cap"] == pytest.approx(close * expected_shares, rel=2e-7)


def test_ratio_shares_use_paid_in_capital_unless_capital_changed():
    assert f._ratio_shares(2_536e6, 2_535_897_886.0) == (2_536e6, "paid_in_capital")
    # A bonus issue after the balance-sheet date shows up as a large gap.
    assert f._ratio_shares(1_000e6, 2_000e6) == (2_000e6, "market_data")
    assert f._ratio_shares(None, None) == (None, None)


# Recently listed company (BALSU, 2026-09): placeholder columns without a period
# label for the years before the listing — skipped, not a parse error.
NEW_LISTING_SUMMARY_HTML = """
<html><body><table>
  <tr><th>FİNANSAL DURUM TABLOSU</th><th></th><th></th><th>2024/12</th><th>2025/12</th></tr>
  <tr><td></td><td></td><td></td><td></td><td></td></tr>
  <tr><td>Sunum Para Birimi</td><td></td><td></td><td>TL</td><td>TL</td></tr>
  <tr><td>Finansal Tablo Niteliği</td><td></td><td></td><td>Konsolide</td><td>Konsolide</td></tr>
  <tr><td>Toplam Varlıklar</td><td></td><td></td><td>14.480.595.127</td><td>31.085.747.735</td></tr>
  <tr><td>Toplam Özkaynaklar</td><td></td><td></td><td>4.272.000.000</td><td>6.019.000.000</td></tr>
  <tr><td>KAR VEYA ZARAR VE DİĞER KAPSAMLI GELİR TABLOSU</td><td></td><td></td><td>2024/12</td><td>2025/12</td></tr>
  <tr><td>Sunum Para Birimi</td><td></td><td></td><td>TL</td><td>TL</td></tr>
  <tr><td></td><td></td><td></td><td></td></tr>
  <tr><td>Hasılat</td><td></td><td></td><td>17.393.000.000</td><td>22.616.000.000</td></tr>
  <tr><td>Net Dönem Kârı (Zararı)</td><td></td><td></td><td>475.000.000</td><td>254.000.000</td></tr>
</table></body></html>
"""


def test_kap_parser_skips_blank_period_columns_of_new_listings():
    parsed = _parse_kap_financial_summary(NEW_LISTING_SUMMARY_HTML)

    assert parsed["periods"] == ["2025/12", "2024/12"]
    assets = parsed["balance_sheet"][0]
    assert assets == {"Item": "Toplam Varlıklar", "2025/12": 31_085_747_735.0, "2024/12": 14_480_595_127.0}
    assert parsed["period_info"]["balance"]["2025/12"] == {
        "presentation_unit": "TL", "multiplier": 1.0, "currency": "TRY", "consolidation": "Konsolide"
    }
    assert parsed["income_statement"][1]["2025/12"] == 254_000_000.0


def test_kap_parser_still_rejects_non_period_headers():
    html = NEW_LISTING_SUMMARY_HTML.replace("<th></th><th></th><th>2024/12</th>", "<th></th><th>x</th><th>2024/12</th>", 1)

    with pytest.raises(ValueError):
        _parse_kap_financial_summary(html)
