"""Deterministic tests for TCMB rate-change history, the MPC calendar, inflation and the FX
bulletin in the macro adapter (no network)."""

from datetime import datetime

import pandas as pd
import pytest

from src.adapters import macro
from src.adapters.macro import ISTANBUL_TZ


def _history(rows):
    """Ascending policy-rate history frame, shaped like ``_history`` in test_macro_data_quality.py."""
    history = pd.DataFrame(rows)
    history["date"] = pd.to_datetime(history["date"])
    return history.set_index("date").sort_index()


# ---------------------------------------------------------------------------
# _rate_changes
# ---------------------------------------------------------------------------

def test_rate_changes_ascending_with_previous_and_change_bp():
    history = _history(
        [
            {"date": "2026-01-23", "borrowing": None, "lending": 38.0},
            {"date": "2026-04-24", "borrowing": None, "lending": 37.0},
        ]
    )

    changes = macro._rate_changes(history)

    assert changes[0] == {"date": "2026-01-23", "rate": 38.0, "previous": None, "change_bp": None}
    assert changes[1] == {"date": "2026-04-24", "rate": 37.0, "previous": 38.0, "change_bp": -100}


def test_rate_changes_skips_zero_or_missing_lending_without_resetting_previous():
    history = _history(
        [
            {"date": "2026-01-23", "borrowing": None, "lending": 38.0},
            {"date": "2026-03-01", "borrowing": None, "lending": 0.0},  # not applicable -> skipped
            {"date": "2026-04-01", "borrowing": None, "lending": None},  # missing -> skipped
            {"date": "2026-04-24", "borrowing": None, "lending": 37.0},
        ]
    )

    changes = macro._rate_changes(history)

    assert [c["date"] for c in changes] == ["2026-01-23", "2026-04-24"]
    assert changes[-1]["previous"] == 38.0  # carried over the skipped rows, not reset
    assert changes[-1]["change_bp"] == -100


async def test_get_policy_rate_reports_changes_and_last_change(monkeypatch):
    history = _history(
        [
            {"date": "2026-01-23", "borrowing": None, "lending": 38.0},
            {"date": "2026-04-24", "borrowing": None, "lending": 37.0},
        ]
    )

    async def fake_history(rate_type):
        assert rate_type == "policy"
        return history

    monkeypatch.setattr(macro, "_tcmb_rate_history", fake_history)
    result = await macro.get_policy_rate.__wrapped__()

    assert result["changes"] == [
        {"date": "2026-01-23", "rate": 38.0, "previous": None, "change_bp": None},
        {"date": "2026-04-24", "rate": 37.0, "previous": 38.0, "change_bp": -100},
    ]
    assert result["last_change"] == {"date": "2026-04-24", "rate": 37.0, "previous": 38.0, "change_bp": -100}
    # Older fields are untouched by the add-only "changes"/"last_change" fields.
    assert result["policy_rate"] == {"value": 37.0, "date": "2026-04-24"}
    assert result["as_of"] == "2026-04-24"
    assert result["history"]


# ---------------------------------------------------------------------------
# _parse_tr_date
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("22 Ekim 2026", "2026-10-22"),
        ("10 Aralık 2026", "2026-12-10"),
        ("1 Şubat 2027", "2027-02-01"),
        ("22 EKİM 2026", "2026-10-22"),  # uppercase, Turkish dotted İ
        ("garbage", None),
        ("", None),
        ("31 Şubat 2026", None),  # no such day
    ],
)
def test_parse_tr_date(text, expected):
    assert macro._parse_tr_date(text) == expected


# ---------------------------------------------------------------------------
# _parse_tcmb_calendar
# ---------------------------------------------------------------------------

_CALENDAR_HTML = """<table><tr><td>Para Politikası Kurulu Toplantı Kararı</td><td style="width: 27.5%">Para Politikası Kurulu Toplantı Özeti</td><td>Enflasyon Raporu</td><td>Finansal İstikrar Raporu</td></tr>
<tr><td>22 Ocak 2026</td><td>29 Ocak 2026</td><td>12 Şubat 2026</td><td></td></tr>
<tr><td>22 Nisan 2026</td><td>30 Nisan 2026</td><td>14 Mayıs 2026</td><td>22 Mayıs 2026</td></tr>
<tr><td>10 Eylül 2026</td><td>17 Eylül 2026</td><td></td><td></td></tr>
<tr><td>22 Ekim 2026</td><td>30 Ekim 2026</td><td>12 Kasım 2026</td><td>27 Kasım 2026</td></tr></table>"""

_EXPECTED_EVENTS = [
    {"type": "mpc_decision", "date": "2026-01-22", "time": "14:00"},
    {"type": "mpc_summary", "date": "2026-01-29"},
    {"type": "inflation_report", "date": "2026-02-12"},
    {"type": "mpc_decision", "date": "2026-04-22", "time": "14:00"},
    {"type": "mpc_summary", "date": "2026-04-30"},
    {"type": "inflation_report", "date": "2026-05-14"},
    {"type": "financial_stability_report", "date": "2026-05-22"},
    {"type": "mpc_decision", "date": "2026-09-10", "time": "14:00"},
    {"type": "mpc_summary", "date": "2026-09-17"},
    {"type": "mpc_decision", "date": "2026-10-22", "time": "14:00"},
    {"type": "mpc_summary", "date": "2026-10-30"},
    {"type": "inflation_report", "date": "2026-11-12"},
    {"type": "financial_stability_report", "date": "2026-11-27"},
]


@pytest.fixture
def calendar_events():
    return macro._parse_tcmb_calendar(_CALENDAR_HTML)


def test_parse_tcmb_calendar_maps_columns_sorts_and_skips_empty_cells(calendar_events):
    assert calendar_events == _EXPECTED_EVENTS


def test_parse_tcmb_calendar_unrelated_table_raises():
    html = "<table><tr><td>Foo</td><td>Bar</td></tr><tr><td>1</td><td>2</td></tr></table>"
    with pytest.raises(macro.MarketDataError) as exc_info:
        macro._parse_tcmb_calendar(html)
    assert exc_info.value.status_code == 502


def test_parse_tcmb_calendar_header_order_is_independent():
    html = (
        "<table><tr><td>Enflasyon Raporu</td><td>Para Politikası Kurulu Toplantı Kararı</td>"
        "<td>Para Politikası Kurulu Toplantı Özeti</td><td>Finansal İstikrar Raporu</td></tr>"
        "<tr><td>12 Şubat 2026</td><td>22 Ocak 2026</td><td>29 Ocak 2026</td><td></td></tr></table>"
    )

    events = macro._parse_tcmb_calendar(html)

    assert events == [
        {"type": "mpc_decision", "date": "2026-01-22", "time": "14:00"},
        {"type": "mpc_summary", "date": "2026-01-29"},
        {"type": "inflation_report", "date": "2026-02-12"},
    ]


# ---------------------------------------------------------------------------
# _calendar_status
# ---------------------------------------------------------------------------

def test_calendar_status_decision_flips_to_past_at_14_00(calendar_events):
    before = datetime(2026, 9, 10, 13, 59, tzinfo=ISTANBUL_TZ)
    upcoming, past = macro._calendar_status(calendar_events, before)
    assert upcoming["mpc_decision"]["date"] == "2026-09-10"
    assert past["mpc_decision"]["date"] == "2026-04-22"

    at_decision_time = datetime(2026, 9, 10, 14, 0, tzinfo=ISTANBUL_TZ)
    upcoming2, past2 = macro._calendar_status(calendar_events, at_decision_time)
    assert past2["mpc_decision"]["date"] == "2026-09-10"
    assert upcoming2["mpc_decision"]["date"] == "2026-10-22"


def test_calendar_status_non_decision_event_is_next_until_the_next_day():
    events = [{"type": "mpc_summary", "date": "2026-09-17"}]

    same_day_upcoming, same_day_past = macro._calendar_status(
        events, datetime(2026, 9, 17, 23, 0, tzinfo=ISTANBUL_TZ)
    )
    assert same_day_upcoming["mpc_summary"]["date"] == "2026-09-17"
    assert same_day_past == {}

    next_day_upcoming, next_day_past = macro._calendar_status(
        events, datetime(2026, 9, 18, 0, 1, tzinfo=ISTANBUL_TZ)
    )
    assert next_day_upcoming == {}
    assert next_day_past["mpc_summary"]["date"] == "2026-09-17"


# ---------------------------------------------------------------------------
# get_tcmb_calendar
# ---------------------------------------------------------------------------

async def test_get_tcmb_calendar_success(monkeypatch, calendar_events):
    async def fake_fetch():
        return calendar_events

    monkeypatch.setattr(macro, "_fetch_tcmb_calendar", fake_fetch)
    result = await macro.get_tcmb_calendar()

    assert result["source"] == "TCMB"
    assert result["events"] == calendar_events
    assert result["next"]["mpc_decision"]["date"] == "2026-10-22"
    assert result["last"]["mpc_decision"]["date"] == "2026-09-10"


async def test_get_tcmb_calendar_failure_payload(monkeypatch):
    async def fake_fetch():
        raise macro.MarketDataError("TCMB takvimi şu anda alınamıyor", status_code=502)

    monkeypatch.setattr(macro, "_fetch_tcmb_calendar", fake_fetch)
    result = await macro.get_tcmb_calendar()

    assert result["events"] == []
    assert result["error_status"] == 502
    assert "error" in result


# ---------------------------------------------------------------------------
# get_inflation
# ---------------------------------------------------------------------------

def _tufe_df():
    return pd.DataFrame(
        {"YearMonth": ["07-2026", "08-2026"], "YearlyInflation": [31.75, 31.51], "MonthlyInflation": [1.78, 1.84]},
        index=pd.DatetimeIndex(["2026-07-01", "2026-08-01"], name="Date"),
    )


def _ufe_df():
    return pd.DataFrame(
        {"YearMonth": ["08-2026"], "YearlyInflation": [25.0], "MonthlyInflation": [1.1]},
        index=pd.DatetimeIndex(["2026-08-01"], name="Date"),
    )


async def test_get_inflation_returns_tufe_and_ufe(monkeypatch):
    class FakeInflation:
        def tufe(self):
            return _tufe_df()

        def ufe(self):
            return _ufe_df()

    monkeypatch.setattr("borsapy.Inflation", FakeInflation)
    result = await macro.get_inflation.__wrapped__()

    assert result["latest"]["type"] == "TUFE" and result["latest"]["yearly_inflation"] == 31.51
    assert [r["YearMonth"] for r in result["tufe_history"]] == ["08-2026", "07-2026"]
    assert result["ufe_latest"]["type"] == "UFE" and result["ufe_latest"]["yearly_inflation"] == 25.0
    assert [r["YearMonth"] for r in result["ufe_history"]] == ["08-2026"]


async def test_get_inflation_survives_ufe_failure(monkeypatch):
    class FakeInflation:
        def tufe(self):
            return _tufe_df()

        def ufe(self):
            raise RuntimeError("ÜFE kaynağı çöktü")

    monkeypatch.setattr("borsapy.Inflation", FakeInflation)
    result = await macro.get_inflation.__wrapped__()

    assert result["latest"]["yearly_inflation"] == 31.51  # TÜFE unaffected by the ÜFE failure
    assert result["ufe_latest"] is None
    assert result["ufe_history"] == []


# ---------------------------------------------------------------------------
# _bulletin_payload / get_fx_bulletin
# ---------------------------------------------------------------------------

def test_bulletin_payload_orders_by_priority_then_alphabetically_and_computes_change():
    current = {
        "date": "2026-09-21",
        "rates": {
            "SEK": {"currency": "SEK", "forex_selling": 4.0},
            "USD": {"currency": "USD", "forex_selling": 41.5},
            "NOK": {"currency": "NOK", "forex_selling": 3.9},
            "EUR": {"currency": "EUR", "forex_selling": 48.6},
        },
    }
    previous = {"date": "2026-09-18", "rates": {"USD": {"currency": "USD", "forex_selling": 41.0}}}

    payload = macro._bulletin_payload(current, previous)

    # USD/EUR are in the priority list; NOK/SEK are not, so they fall back to A-Z.
    assert [r["currency"] for r in payload["rates"]] == ["USD", "EUR", "NOK", "SEK"]
    by_code = {r["currency"]: r for r in payload["rates"]}
    assert by_code["USD"]["change_percent"] == round((41.5 - 41.0) / 41.0 * 100, 4)
    assert by_code["EUR"]["previous_selling"] is None and by_code["EUR"]["change_percent"] is None
    assert payload["previous_date"] == "2026-09-18"


def test_bulletin_payload_without_a_previous_bulletin():
    current = {"date": "2026-09-21", "rates": {"USD": {"currency": "USD", "forex_selling": 41.5}}}

    payload = macro._bulletin_payload(current, None)

    assert payload["previous_date"] is None
    assert payload["rates"][0]["previous_selling"] is None
    assert payload["rates"][0]["change_percent"] is None


def test_bulletin_payload_empty_rates_raises():
    with pytest.raises(macro.MarketDataError):
        macro._bulletin_payload({"date": "2026-09-21", "rates": {}}, None)


async def test_get_fx_bulletin_skips_empty_days_to_find_the_previous_bulletin(monkeypatch):
    current = {"date": "2026-09-21", "rates": {"USD": {"currency": "USD", "forex_selling": 41.5}}}
    previous_real = {"date": "2026-09-18", "rates": {"USD": {"currency": "USD", "forex_selling": 41.0}}}
    checked_days = []

    async def fake_today():
        return current

    async def fake_archive(day):
        checked_days.append(day)
        if day == "2026-09-18":
            return previous_real
        return {"date": day, "rates": {}, "missing": True}  # Sat 09-20 / Sun 09-19 have no bulletin

    monkeypatch.setattr(macro, "_get_tcmb_fx_today", fake_today)
    monkeypatch.setattr(macro, "_get_tcmb_fx_archive", fake_archive)

    result = await macro.get_fx_bulletin()

    assert checked_days == ["2026-09-20", "2026-09-19", "2026-09-18"]  # walks back, stops at the first real bulletin
    assert result["previous_date"] == "2026-09-18"
    assert result["date"] == "2026-09-21"
