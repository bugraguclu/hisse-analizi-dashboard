"""Deterministic tests for the TradingView-based macro_markets adapter (no network)."""

from datetime import datetime

import httpx
import pandas as pd
import pytest

from src.adapters import macro_markets as mm
from src.adapters.utils import ISTANBUL_TZ

EPOCH = 1788134400  # 2026-08-31T00:00:00Z
EPOCH_ISTANBUL_ISO = "2026-08-31T03:00:00+03:00"


# ---------------------------------------------------------------------------
# _instrument_quote
# ---------------------------------------------------------------------------

def test_instrument_quote_computes_change_and_updated_at():
    quote = mm._instrument_quote(
        mm.INSTRUMENTS_BY_KEY["usdtry"], {"close": 41.5, "close[1]": 41.0, "update_time": EPOCH}
    )

    assert quote["last"] == 41.5
    assert quote["previous_close"] == 41.0
    assert quote["change"] == 0.5
    assert quote["change_percent"] == 1.2195  # 4 dp
    assert quote["updated_at"] == EPOCH_ISTANBUL_ISO


@pytest.mark.parametrize("row", [None, {}, {"close": None, "close[1]": 41.0}])
def test_instrument_quote_missing_close_is_none(row):
    assert mm._instrument_quote(mm.INSTRUMENTS_BY_KEY["usdtry"], row) is None


@pytest.mark.parametrize("close", [0, -5])
def test_instrument_quote_non_positive_price_is_none_for_priced_instruments(close):
    assert mm._instrument_quote(mm.INSTRUMENTS_BY_KEY["usdtry"], {"close": close, "close[1]": 41.0}) is None


def test_instrument_quote_yield_accepts_zero_and_negative_values():
    # tr10y is a "percent" unit (a yield) -> no positivity requirement, unlike a price.
    quote = mm._instrument_quote(
        mm.INSTRUMENTS_BY_KEY["tr10y"], {"close": -0.5, "close[1]": 0.0, "update_time": EPOCH}
    )

    assert quote["last"] == -0.5
    assert quote["previous_close"] == 0.0  # kept, not filtered like a non-positive price would be
    assert quote["change"] == -0.5
    assert quote["change_percent"] is None  # no positive base to divide by


def test_instrument_quote_sentinel_close_is_treated_as_missing():
    assert mm._instrument_quote(mm.INSTRUMENTS_BY_KEY["usdtry"], {"close": 1e100, "close[1]": 41.0}) is None


def test_instrument_quote_sentinel_previous_and_update_time_drop_individually():
    row = {"close": 41.5, "close[1]": 1e100, "update_time": 1e100}
    quote = mm._instrument_quote(mm.INSTRUMENTS_BY_KEY["usdtry"], row)

    assert quote["last"] == 41.5
    assert quote["previous_close"] is None
    assert quote["change"] is None and quote["change_percent"] is None
    assert quote["updated_at"] is None


# ---------------------------------------------------------------------------
# _snapshot_payload
# ---------------------------------------------------------------------------

# Ascending epochs so "the older of two inputs" is unambiguous below.
EPOCH_1, EPOCH_2, EPOCH_3 = 1758500000, 1758510000, 1758520000


def _snapshot_rows():
    return {
        "FX_IDC:USDTRY": {"close": 41.0, "close[1]": 40.5, "update_time": EPOCH_2},
        "FX_IDC:EURTRY": {"close": 45.0, "close[1]": 44.0, "update_time": EPOCH_3},
        "OANDA:XAUUSD": {"close": 2000.0, "close[1]": 1990.0, "update_time": EPOCH_1},
        "TVC:TR10Y": {"close": 41.2, "close[1]": 41.5, "update_time": EPOCH_2},
        "TVC:DXY": {"close": 101.234, "close[1]": 100.5, "update_time": EPOCH_2},
    }


def test_snapshot_payload_preserves_registry_order_including_derived():
    payload = mm._snapshot_payload(_snapshot_rows())

    assert [q["key"] for q in payload["instruments"]] == [
        "usdtry", "eurtry", "basket", "gram_gold", "xauusd", "tr10y", "dxy",
    ]
    assert payload["source"] == mm.SOURCE


def test_snapshot_payload_basket_is_average_of_usdtry_and_eurtry():
    quotes = {q["key"]: q for q in mm._snapshot_payload(_snapshot_rows())["instruments"]}
    basket = quotes["basket"]

    assert basket["last"] == 43.0  # (41.0 + 45.0) / 2
    assert basket["previous_close"] == 42.25  # (40.5 + 44.0) / 2
    assert basket["change"] == 0.75
    assert basket["change_percent"] == round(0.75 / 42.25 * 100, 4)
    assert basket["updated_at"] == mm._epoch_iso(EPOCH_2)  # older of usdtry (EPOCH_2) / eurtry (EPOCH_3)


def test_snapshot_payload_gram_gold_is_ounce_times_usdtry_over_troy_ounce():
    quotes = {q["key"]: q for q in mm._snapshot_payload(_snapshot_rows())["instruments"]}
    gram_gold = quotes["gram_gold"]

    assert gram_gold["last"] == round(2000.0 * 41.0 / mm.TROY_OUNCE_GRAMS, 6)
    assert gram_gold["previous_close"] == round(1990.0 * 40.5 / mm.TROY_OUNCE_GRAMS, 6)
    assert gram_gold["change"] == round(gram_gold["last"] - gram_gold["previous_close"], 6)
    assert gram_gold["updated_at"] == mm._epoch_iso(EPOCH_1)  # older of xauusd (EPOCH_1) / usdtry (EPOCH_2)


def test_snapshot_payload_as_of_is_the_newest_instrument_timestamp():
    payload = mm._snapshot_payload(_snapshot_rows())

    assert payload["as_of"] == mm._epoch_iso(EPOCH_3)  # eurtry is the freshest input overall


def test_snapshot_payload_omits_derived_series_when_an_input_is_missing():
    rows = {"FX_IDC:USDTRY": {"close": 41.0, "close[1]": 40.5, "update_time": EPOCH_2}}

    payload = mm._snapshot_payload(rows)

    assert [q["key"] for q in payload["instruments"]] == ["usdtry"]  # no eurtry -> no basket; no xauusd -> no gram_gold


def test_snapshot_payload_no_instruments_raises_502():
    with pytest.raises(mm.MarketDataError) as exc_info:
        mm._snapshot_payload({})
    assert exc_info.value.status_code == 502


# ---------------------------------------------------------------------------
# get_market_snapshot
# ---------------------------------------------------------------------------

async def test_get_market_snapshot_success(monkeypatch):
    async def fake_rows():
        return {"FX_IDC:USDTRY": {"close": 41.0, "close[1]": 40.5, "update_time": EPOCH_2}}

    monkeypatch.setattr(mm, "_market_rows", fake_rows)
    result = await mm.get_market_snapshot()

    assert result["source"] == mm.SOURCE
    assert [q["key"] for q in result["instruments"]] == ["usdtry"]


async def test_get_market_snapshot_failure_propagates_status(monkeypatch):
    async def fake_rows():
        raise mm.MarketDataError("kapalı", status_code=503)

    monkeypatch.setattr(mm, "_market_rows", fake_rows)
    result = await mm.get_market_snapshot()

    assert result["error_status"] == 503
    assert result["instruments"] == []
    assert "error" in result


# ---------------------------------------------------------------------------
# _global_scan
# ---------------------------------------------------------------------------

class _FakeClient:
    def __init__(self, response=None, exc=None):
        self.response = response
        self.exc = exc
        self.calls = 0

    async def post(self, url, json=None, headers=None, timeout=None):
        self.calls += 1
        if self.exc:
            raise self.exc
        return self.response


def _scan_response(status, body):
    return httpx.Response(status, json=body, request=httpx.Request("POST", "https://x"))


async def test_global_scan_keys_rows_by_uppercased_full_ticker(monkeypatch):
    client = _FakeClient(response=_scan_response(200, {"data": [{"s": "tvc:tr10y", "d": [41.2, 41.0]}]}))
    monkeypatch.setattr(mm, "get_http_client", lambda: client)

    rows = await mm._global_scan(["TVC:TR10Y"], ("close", "close[1]"))

    assert rows == {"TVC:TR10Y": {"close": 41.2, "close[1]": 41.0}}
    assert client.calls == 1


async def test_global_scan_skips_rows_with_wrong_column_count(monkeypatch):
    body = {"data": [{"s": "TVC:TR10Y", "d": [41.2]}, {"s": "FX_IDC:USDTRY", "d": [41.0, 40.5]}]}
    client = _FakeClient(response=_scan_response(200, body))
    monkeypatch.setattr(mm, "get_http_client", lambda: client)

    rows = await mm._global_scan(["TVC:TR10Y", "FX_IDC:USDTRY"], ("close", "close[1]"))

    assert list(rows) == ["FX_IDC:USDTRY"]


@pytest.mark.parametrize(("status", "expected"), [(429, 503), (500, 503), (400, 502)])
async def test_global_scan_http_error_status_mapping(monkeypatch, status, expected):
    client = _FakeClient(response=_scan_response(status, {}))
    monkeypatch.setattr(mm, "get_http_client", lambda: client)

    with pytest.raises(mm.MarketDataError) as exc_info:
        await mm._global_scan(["TVC:TR10Y"], ("close",))
    assert exc_info.value.status_code == expected


async def test_global_scan_connect_error_is_503(monkeypatch):
    client = _FakeClient(exc=httpx.ConnectError("boom"))
    monkeypatch.setattr(mm, "get_http_client", lambda: client)

    with pytest.raises(mm.MarketDataError) as exc_info:
        await mm._global_scan(["TVC:TR10Y"], ("close",))
    assert exc_info.value.status_code == 503


async def test_global_scan_empty_ticker_list_short_circuits(monkeypatch):
    client = _FakeClient()
    monkeypatch.setattr(mm, "get_http_client", lambda: client)

    rows = await mm._global_scan([], ("close",))

    assert rows == {}
    assert client.calls == 0  # an empty ticker list would otherwise scan the entire market


# ---------------------------------------------------------------------------
# _indicator_record / _indicators_payload
# ---------------------------------------------------------------------------

def test_indicator_record_value_previous_change_and_period():
    record = mm._indicator_record(mm.MACRO_INDICATORS[0], {"close": 5.5, "close[1]": 5.0, "time": EPOCH})

    assert record["value"] == 5.5
    assert record["previous"] == 5.0
    assert record["change"] == 0.5
    assert record["period"] == "2026-08-31"  # UTC date of the epoch


@pytest.mark.parametrize("row", [None, {}, {"close": None, "close[1]": 5.0}])
def test_indicator_record_missing_close_is_skipped(row):
    assert mm._indicator_record(mm.MACRO_INDICATORS[0], row) is None


def test_indicators_payload_keeps_registry_order_and_skips_missing():
    first, third = mm.MACRO_INDICATORS[0], mm.MACRO_INDICATORS[2]
    rows = {
        f"ECONOMICS:{third.symbol}": {"close": 1.0, "close[1]": 0.5, "time": EPOCH},
        f"ECONOMICS:{first.symbol}": {"close": 2.0, "close[1]": None, "time": EPOCH},
    }

    payload = mm._indicators_payload(rows)

    assert [i["key"] for i in payload["indicators"]] == [first.key, third.key]  # registry order, not insertion order
    assert payload["source"] == f"{mm.SOURCE} ekonomik veri"


def test_indicators_payload_all_missing_raises():
    with pytest.raises(mm.MarketDataError):
        mm._indicators_payload({})


async def test_get_macro_indicators_success(monkeypatch):
    ind = mm.MACRO_INDICATORS[0]
    fetched_at = "2026-09-22T23:00:00+03:00"

    async def fake_rows():
        rows = {f"ECONOMICS:{ind.symbol}": {"close": 3.0, "close[1]": 2.0, "time": EPOCH}}
        return {"rows": rows, "fetched_at": fetched_at}

    monkeypatch.setattr(mm, "_indicator_rows", fake_rows)
    result = await mm.get_macro_indicators()

    assert result["as_of"] == fetched_at
    assert [i["key"] for i in result["indicators"]] == [ind.key]


# ---------------------------------------------------------------------------
# _daily_closes / _combine_series
# ---------------------------------------------------------------------------

def _closes_frame(timestamps, values):
    return pd.DataFrame({"Close": values}, index=pd.DatetimeIndex(timestamps))


def test_daily_closes_and_combine_series_join_per_day_and_drop_partial_days():
    # Stamped at different hours of the same Istanbul calendar days.
    frame_a = _closes_frame(
        ["2026-09-01T00:00:00+03:00", "2026-09-02T00:00:00+03:00", "2026-09-03T00:00:00+03:00"],
        [10.0, 11.0, 12.0],
    )
    frame_b = _closes_frame(["2026-09-01T01:00:00+03:00", "2026-09-02T01:00:00+03:00"], [2.0, 3.0])

    combined = mm._combine_series("basket", mm._daily_closes(frame_a), mm._daily_closes(frame_b))

    # Sep 3 exists only in frame_a and is dropped by the inner join.
    assert [ts.date().isoformat() for ts in combined.index] == ["2026-09-01", "2026-09-02"]
    assert list(combined["Close"]) == [6.0, 7.0]


# ---------------------------------------------------------------------------
# _history_payload
# ---------------------------------------------------------------------------

def _daily_frame(start, end, hour=9):
    index = pd.date_range(start=start, end=end, freq="D", tz=ISTANBUL_TZ) + pd.Timedelta(hours=hour)
    return pd.DataFrame({"Close": [float(i) for i in range(len(index))]}, index=index.rename("Date"))


HISTORY_NOW = datetime(2026, 9, 22, 18, 0, tzinfo=ISTANBUL_TZ)
# ~15.7 months of daily closes, each equal to its day offset from 2025-06-01 (so
# window/high/low/reference are all trivially verifiable: the series is increasing).
HISTORY_FRAME = _daily_frame("2025-06-01", "2026-09-22")


@pytest.mark.parametrize(
    ("period", "first_date", "first_close", "reference_close", "reference_date", "change"),
    [
        ("1y", "2025-09-22", 113.0, 112.0, "2025-09-21", 366.0),
        ("3ay", "2026-06-22", 386.0, 385.0, "2026-06-21", 93.0),
        ("ytd", "2026-01-01", 214.0, 213.0, "2025-12-31", 265.0),
    ],
)
def test_history_payload_trims_to_the_real_calendar_window(
    period, first_date, first_close, reference_close, reference_date, change
):
    spec = mm.resolve_history_period(period)

    payload = mm._history_payload(mm.INSTRUMENTS_BY_KEY["usdtry"], spec, HISTORY_FRAME, HISTORY_NOW)

    assert payload["points"][0] == {"date": first_date, "close": first_close}
    assert payload["points"][-1] == {"date": "2026-09-22", "close": 478.0}
    assert payload["reference_close"] == reference_close
    assert payload["reference_date"] == reference_date
    assert payload["change"] == change
    assert payload["change_percent"] == round(change / reference_close * 100, 4)
    assert payload["high"] == 478.0  # last close in the window (the series increases monotonically)
    assert payload["low"] == first_close  # first close in the window


# ---------------------------------------------------------------------------
# resolve_history_period
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("period", ["1g", "max"])
def test_resolve_history_period_rejects_intraday_and_max(period):
    with pytest.raises(mm.InvalidInputError) as exc_info:
        mm.resolve_history_period(period)
    assert exc_info.value.status_code == 400


def test_resolve_history_period_accepts_1y():
    assert mm.resolve_history_period("1y").key == "1y"


# ---------------------------------------------------------------------------
# get_market_history
# ---------------------------------------------------------------------------

async def test_get_market_history_unknown_key_is_404():
    result = await mm.get_market_history("does-not-exist", "1y")

    assert result["error_status"] == 404
    assert result["points"] == []


async def test_get_market_history_invalid_period_is_400():
    result = await mm.get_market_history("usdtry", "1g")

    assert result["error_status"] == 400
    assert result["points"] == []


async def test_get_market_history_success(monkeypatch):
    async def fake_frame(inst, spec):
        return HISTORY_FRAME

    monkeypatch.setattr(mm, "_instrument_frame", fake_frame)
    monkeypatch.setattr(mm, "now_istanbul", lambda: HISTORY_NOW)

    result = await mm.get_market_history("usdtry", "3ay")

    assert "error" not in result
    assert result["key"] == "usdtry"
    assert result["points"][0] == {"date": "2026-06-22", "close": 386.0}
