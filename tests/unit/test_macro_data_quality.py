"""Deterministic data-quality tests for macro adapters."""

import pandas as pd

from src.adapters import macro


def test_latest_rate_record_uses_latest_date_not_first_source_row():
    history = pd.DataFrame(
        [
            {"date": "2026-01-23", "borrowing": None, "lending": 37.0},
            {"date": "2010-05-20", "borrowing": None, "lending": 7.0},
            {"date": "2025-12-12", "borrowing": None, "lending": 38.0},
        ]
    )
    history["date"] = pd.to_datetime(history["date"])
    history = history.set_index("date")

    assert macro._latest_rate_record(history, "policy") == {
        "type": "policy",
        "date": "2026-01-23",
        "borrowing": None,
        "lending": 37.0,
    }


def test_tcmb_fx_parser_uses_bulletin_date_and_normalizes_unit():
    xml = """<?xml version="1.0" encoding="UTF-8"?>
    <Tarih_Date Tarih="04.08.2026">
      <Currency Kod="JPY" CurrencyCode="JPY">
        <Unit>100</Unit><CurrencyName>JAPANESE YEN</CurrencyName>
        <ForexBuying>31.0000</ForexBuying><ForexSelling>32.0000</ForexSelling>
        <BanknoteBuying>30.0000</BanknoteBuying><BanknoteSelling>33.0000</BanknoteSelling>
      </Currency>
    </Tarih_Date>"""

    result = macro._parse_tcmb_fx_xml(xml)

    assert result["date"] == "2026-08-04"
    assert result["rates"]["JPY"]["quoted_unit"] == 100
    assert result["rates"]["JPY"]["forex_selling"] == 0.32


async def test_calendar_never_fabricates_dates_when_sources_are_empty(monkeypatch):
    async def empty_source():
        return []

    monkeypatch.setattr(macro, "_fetch_calendar_from_borsapy", empty_source)
    monkeypatch.setattr(macro, "_fetch_calendar_from_investpy", empty_source)

    result = await macro.get_economic_calendar.__wrapped__()

    assert result["calendar"] == []
    assert result["source"] is None
    assert "doğrulanmış veri" in result["error"]
