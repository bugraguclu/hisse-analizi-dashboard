"""Deterministic data-quality tests for macro adapters (no network)."""

import pandas as pd

from src.adapters import macro


def _history(rows):
    history = pd.DataFrame(rows)
    history["date"] = pd.to_datetime(history["date"])
    return history.set_index("date")


def test_latest_rate_record_uses_latest_date_not_first_source_row():
    history = _history(
        [
            {"date": "2026-01-23", "borrowing": None, "lending": 37.0},
            {"date": "2010-05-20", "borrowing": None, "lending": 7.0},
            {"date": "2025-12-12", "borrowing": None, "lending": 38.0},
        ]
    )

    assert macro._latest_rate_record(history, "policy") == {
        "type": "policy",
        "date": "2026-01-23",
        "borrowing": None,
        "lending": 37.0,
    }


def test_zero_corridor_rate_means_not_applicable_not_zero_percent():
    history = _history([{"date": "2026-01-23", "borrowing": 0.0, "lending": 43.0}])

    record = macro._latest_rate_record(history, "late_liquidity")

    assert record["borrowing"] is None
    assert record["lending"] == 43.0


def test_tcmb_fx_parser_uses_bulletin_date_and_normalizes_unit():
    xml = """<?xml version="1.0" encoding="UTF-8"?>
    <Tarih_Date Tarih="04.08.2026">
      <Currency Kod="JPY" CurrencyCode="JPY">
        <Unit>100</Unit><CurrencyName>JAPANESE YEN</CurrencyName>
        <ForexBuying>31.0000</ForexBuying><ForexSelling>32.0000</ForexSelling>
        <BanknoteBuying>30.0000</BanknoteBuying><BanknoteSelling></BanknoteSelling>
      </Currency>
    </Tarih_Date>"""

    result = macro._parse_tcmb_fx_xml(xml)

    assert result["date"] == "2026-08-04"
    assert result["rates"]["JPY"]["quoted_unit"] == 100
    assert result["rates"]["JPY"]["forex_selling"] == 0.32
    assert result["rates"]["JPY"]["forex_buying"] == 0.31
    assert result["rates"]["JPY"]["banknote_selling"] is None  # empty → missing, not 0


def test_fx_payload_orders_history_and_reports_change_vs_previous_bulletin():
    bulletins = {
        "current": {"date": "2026-09-21", "rates": {"USD": {"currency": "USD", "forex_selling": 48.8}}},
        "history": [
            {"date": "2026-09-17", "rates": {"USD": {"forex_selling": 48.5}}},
            {"date": "2026-09-18", "rates": {"USD": {"forex_selling": 48.6}}},
            {"date": "2026-09-21", "rates": {"USD": {"forex_selling": 48.8}}},
        ],
    }

    payload = macro._fx_payload("USD", bulletins)

    assert [h["Date"] for h in payload["history"]] == ["2026-09-17", "2026-09-18", "2026-09-21"]
    assert payload["info"]["last"] == 48.8
    assert payload["info"]["previous_close"] == 48.6
    assert payload["info"]["change"] == 0.2


def test_fx_payload_unknown_currency_is_not_found():
    bulletins = {"current": {"date": "2026-09-21", "rates": {}}, "history": []}

    try:
        macro._fx_payload("XYZ", bulletins)
    except macro.MarketDataError as e:
        assert e.status_code == 404
        assert "XYZ" in e.message
    else:  # pragma: no cover
        raise AssertionError("expected MarketDataError")


async def test_fx_rejects_malformed_currency_codes_without_upstream_calls():
    result = await macro.get_fx_rates.__wrapped__("US1")

    assert result["error_status"] == 400
    assert result["history"] == []


def test_inflation_latest_is_chosen_by_date_with_annual_and_monthly_separate():
    records = [
        {"Date": "2026-07-01T00:00:00", "YearMonth": "07-2026", "YearlyInflation": 31.75, "MonthlyInflation": 1.78},
        {"Date": "2026-08-01T00:00:00", "YearMonth": "08-2026", "YearlyInflation": 31.51, "MonthlyInflation": 1.84},
        {"Date": "2026-06-01T00:00:00", "YearMonth": "06-2026", "YearlyInflation": 32.11, "MonthlyInflation": None},
    ]

    payload = macro._inflation_payload(records)

    assert payload["as_of"] == "2026-08-01"
    assert payload["latest"]["yearly_inflation"] == 31.51
    assert payload["latest"]["monthly_inflation"] == 1.84
    assert [r["YearMonth"] for r in payload["tufe_history"]] == ["08-2026", "07-2026", "06-2026"]


def test_calendar_records_combine_date_and_time_in_istanbul_and_sort():
    records = [
        {"Date": "2026-09-22T00:00:00", "Time": "15:15", "Country": "ABD", "Importance": "MID",
         "Event": "ADP (-)", "Actual": None, "Forecast": None, "Previous": "16,25"},
        {"Date": "2026-09-22T00:00:00", "Time": "10:00", "Country": "Türkiye", "Importance": "high",
         "Event": "Tüketici Güveni (-)", "Actual": "91,9", "Forecast": None, "Previous": "90,8"},
        {"Date": "2026-09-21T00:00:00", "Time": "", "Country": "ABD", "Importance": "low",
         "Event": "Tatil", "Actual": None, "Forecast": None, "Previous": None},
        {"Date": None, "Time": "10:00", "Event": "Tarihsiz"},
    ]

    rows = macro._calendar_records(records)

    assert [r["Event"] for r in rows] == ["Tatil", "Tüketici Güveni (-)", "ADP (-)"]
    assert rows[1]["datetime"] == "2026-09-22T10:00:00+03:00"
    assert rows[1]["actual_value"] == 91.9
    assert rows[2]["Importance"] == "mid"
    assert rows[0]["all_day"] is True and rows[0]["Time"] is None


def test_calendar_number_parsing():
    assert macro._calendar_number("-0,3%") == -0.3
    assert macro._calendar_number("250K") == 250_000
    assert macro._calendar_number("1.234,5") == 1234.5
    assert macro._calendar_number("-") is None
    # doviz.com writes percentages the Turkish way, sign before the percent sign.
    assert macro._calendar_number("%7,6") == 7.6
    assert macro._calendar_number("%0,055") == 0.055
    assert macro._calendar_number("-%0,3") == -0.3
    assert macro._calendar_number("%-0,3") == -0.3
    assert macro._calendar_number("%") is None


async def test_calendar_is_empty_and_unavailable_when_source_fails(monkeypatch):
    async def failing_source():
        raise RuntimeError("doviz.com down")

    monkeypatch.setattr(macro, "_fetch_calendar", failing_source)

    result = await macro.get_economic_calendar()

    assert result == {"calendar": [], "source": None, "available": False}
