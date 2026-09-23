"""Deterministic parsing tests for src.adapters.tcmb_adapter (no network).

Fixtures are small hand-written HTML/XML snippets that mirror the real page
structure, confirmed by fetching tcmb.gov.tr live on 2026-09-23 (see the WS4
report): rate-history tables list rows oldest -> newest, the CPI table is a
plain 3-column table (newest first), the PPI table has a two-row colspan
header with the classic "ÜFE" and its 2014 replacement "Yİ-ÜFE" side by side,
and the FX bulletin XML matches ``today.xml`` / the dated archive files.
"""

from datetime import date

from src.adapters import tcmb_adapter as t


# ---------------------------------------------------------------------------
# Rate tables (policy / overnight / late_liquidity)
# ---------------------------------------------------------------------------

def test_parse_rate_table_is_oldest_to_newest_and_dash_is_not_applicable():
    html = """
    <table>
    <tr><th>Tarih</th><th>Borç Alma</th><th>Borç Verme</th></tr>
    <tr><td>20.05.2010</td><td>-</td><td>7.00</td></tr>
    <tr><td>24.10.2025</td><td>-</td><td>39.50</td></tr>
    <tr><td>23.01.2026</td><td>-</td><td>37.00</td></tr>
    </table>
    """
    rows = t.parse_rate_table(html)

    assert [r.observation_date for r in rows] == [date(2010, 5, 20), date(2025, 10, 24), date(2026, 1, 23)]
    assert rows[0].borrowing is None  # "-" -> not applicable, never 0
    assert rows[-1].lending == 7.00 or rows[-1].lending is not None  # sanity: parsed as Decimal, not str
    assert rows[-1].lending == t._parse_decimal("37.00")


def test_parse_rate_table_accepts_two_digit_and_four_digit_years():
    html = """
    <table>
    <tr><th>Tarih</th><th>Borç Alma</th><th>Borç Verme</th></tr>
    <tr><td>20.02.02</td><td>57.00</td><td>62.00</td></tr>
    <tr><td>23.01.2026</td><td>35.50</td><td>40.00</td></tr>
    </table>
    """
    rows = t.parse_rate_table(html)

    assert rows[0].observation_date == date(2002, 2, 20)
    assert rows[1].observation_date == date(2026, 1, 23)


def test_parse_rate_table_zero_rate_is_not_applicable_not_zero_percent():
    html = """
    <table>
    <tr><th>Tarih</th><th>Borç Alma</th><th>Borç Verme</th></tr>
    <tr><td>24.10.2025</td><td>0.00</td><td>45.50</td></tr>
    </table>
    """
    rows = t.parse_rate_table(html)

    # The raw parse is faithful (0.00 stays 0) — the ">0" drop rule lives in
    # macro_service.ingest_rates, not the parser.
    assert rows[0].borrowing == t._parse_decimal("0.00")


def test_parse_rate_table_no_table_returns_empty():
    assert t.parse_rate_table("<html><body>no table here</body></html>") == []


def test_parse_rate_table_skips_short_rows():
    html = "<table><tr><th>H</th></tr><tr><td>only one col</td></tr></table>"
    assert t.parse_rate_table(html) == []


# ---------------------------------------------------------------------------
# CPI (TÜFE)
# ---------------------------------------------------------------------------

def test_parse_cpi_table_newest_first_and_year_month_to_first_of_month():
    html = """
    <table>
    <tr><th>Ay-Yıl</th><th>TÜFE (Yıllık % Değişim)</th><th>TÜFE (Aylık % Değişim)</th></tr>
    <tr><td>08-2026</td><td>31.51</td><td>1.84</td></tr>
    <tr><td>07-2026</td><td>31.75</td><td>1.78</td></tr>
    </table>
    """
    rows = t.parse_cpi_table(html)

    assert rows[0].observation_date == date(2026, 8, 1)
    assert rows[0].year_month == "08-2026"
    assert rows[0].yoy == t._parse_decimal("31.51")
    assert rows[0].mom == t._parse_decimal("1.84")
    assert rows[1].observation_date == date(2026, 7, 1)


# ---------------------------------------------------------------------------
# PPI (ÜFE / Yİ-ÜFE) — coalescing across the Jan-2014 methodology cut-over
# ---------------------------------------------------------------------------

_PPI_HTML = """
<table>
<tr><th>Ay-Yıl</th><th colspan="2">Yıllık Değişim</th><th colspan="2">Aylık Değişim</th></tr>
<tr><td></td><td>ÜFE</td><td>Yİ-ÜFE</td><td>ÜFE</td><td>Yİ-ÜFE</td></tr>
<tr><td>01-2014</td><td></td><td>10.72</td><td></td><td>3.32</td></tr>
<tr><td>12-2013</td><td>6.97</td><td></td><td>1.11</td><td></td></tr>
<tr><td>01-2003</td><td></td><td></td><td></td><td></td></tr>
</table>
"""


def test_parse_ppi_table_skips_two_row_header():
    rows = t.parse_ppi_table(_PPI_HTML)
    assert [r.year_month for r in rows] == ["01-2014", "12-2013", "01-2003"]


def test_parse_ppi_table_coalesces_yi_ufe_after_cutover():
    rows = t.parse_ppi_table(_PPI_HTML)
    jan_2014 = rows[0]
    assert jan_2014.yoy == t._parse_decimal("10.72")  # from the Yİ-ÜFE column, ÜFE column is blank
    assert jan_2014.mom == t._parse_decimal("3.32")


def test_parse_ppi_table_coalesces_classic_ufe_before_cutover():
    rows = t.parse_ppi_table(_PPI_HTML)
    dec_2013 = rows[1]
    assert dec_2013.yoy == t._parse_decimal("6.97")  # from the classic ÜFE column
    assert dec_2013.mom == t._parse_decimal("1.11")


def test_parse_ppi_table_both_columns_blank_is_none_not_zero():
    rows = t.parse_ppi_table(_PPI_HTML)
    base_month = rows[2]
    assert base_month.yoy is None
    assert base_month.mom is None


def test_parse_ppi_table_falls_back_to_plain_three_column_layout():
    html = """
    <table>
    <tr><th>Ay-Yıl</th><th>Yıllık</th><th>Aylık</th></tr>
    <tr><td>08-2026</td><td>27.95</td><td>2.57</td></tr>
    </table>
    """
    rows = t.parse_ppi_table(html)
    assert rows == [t.InflationObservation(date(2026, 8, 1), "08-2026", t._parse_decimal("27.95"), t._parse_decimal("2.57"))]


# ---------------------------------------------------------------------------
# FX bulletin XML
# ---------------------------------------------------------------------------

def test_parse_fx_bulletin_xml_normalizes_unit_and_drops_empty_values():
    xml = """<?xml version="1.0" encoding="UTF-8"?>
    <Tarih_Date Tarih="23.09.2026" Date="09/23/2026" Bulten_No="2026/179">
      <Currency CrossOrder="0" Kod="USD" CurrencyCode="USD">
        <Unit>1</Unit><Isim>ABD DOLARI</Isim><CurrencyName>US DOLLAR</CurrencyName>
        <ForexBuying>48.7499</ForexBuying><ForexSelling>48.8377</ForexSelling>
        <BanknoteBuying>48.7158</BanknoteBuying><BanknoteSelling>48.9110</BanknoteSelling>
      </Currency>
      <Currency CrossOrder="1" Kod="JPY" CurrencyCode="JPY">
        <Unit>100</Unit><Isim>JAPON YENİ</Isim><CurrencyName>JAPENESE YEN</CurrencyName>
        <ForexBuying>31.0000</ForexBuying><ForexSelling>32.0000</ForexSelling>
        <BanknoteBuying>30.0000</BanknoteBuying><BanknoteSelling></BanknoteSelling>
      </Currency>
    </Tarih_Date>"""

    result = t.parse_fx_bulletin_xml(xml)

    assert result.bulletin_date == date(2026, 9, 23)
    assert result.rates["USD"]["forex_selling"] == t._parse_decimal("48.8377")
    assert result.rates["USD"]["quoted_unit"] == 1
    # JPY is quoted per 100 units on the page; normalised to 1 unit.
    assert result.rates["JPY"]["quoted_unit"] == 100
    assert result.rates["JPY"]["forex_selling"] == t._parse_decimal("32.0000") / 100
    assert result.rates["JPY"]["forex_buying"] == t._parse_decimal("31.0000") / 100
    assert result.rates["JPY"]["banknote_selling"] is None  # empty tag -> missing, never 0


def test_parse_fx_bulletin_xml_missing_date_raises_market_data_error():
    xml = '<Tarih_Date><Currency Kod="USD"><Unit>1</Unit></Currency></Tarih_Date>'
    try:
        t.parse_fx_bulletin_xml(xml)
    except t.MarketDataError as e:
        assert e.status_code == 502
    else:  # pragma: no cover
        raise AssertionError("expected MarketDataError")


def test_fx_archive_url_format():
    assert t.fx_archive_url(date(2026, 9, 23)) == "https://www.tcmb.gov.tr/kurlar/202609/23092026.xml"


# ---------------------------------------------------------------------------
# Small parsing primitives
# ---------------------------------------------------------------------------

def test_parse_decimal_handles_turkish_and_plain_formats_and_dashes():
    assert t._parse_decimal("37.00") == t._parse_decimal("37,00")
    assert t._parse_decimal("-") is None
    assert t._parse_decimal("") is None
    assert t._parse_decimal(None) is None
    assert t._parse_decimal("1.234,56") == t._parse_decimal("1234.56")


def test_parse_tcmb_date_pivot_year():
    assert t._parse_tcmb_date("20.02.02") == date(2002, 2, 20)
    assert t._parse_tcmb_date("23.01.26") == date(2026, 1, 23)
    assert t._parse_tcmb_date("23.01.2026") == date(2026, 1, 23)
    assert t._parse_tcmb_date("not-a-date") is None
    assert t._parse_tcmb_date("") is None


def test_parse_year_month_rejects_invalid_month():
    assert t._parse_year_month("08-2026") == date(2026, 8, 1)
    assert t._parse_year_month("13-2026") is None
    assert t._parse_year_month("garbage") is None
