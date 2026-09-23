"""Chart periods, bar cleaning/trimming, symbol normalization and session rules."""

from datetime import date, datetime

import pandas as pd
import pytest

from src.adapters import index_adapter, isyatirim_prices, price
from src.adapters.price import (
    PriceAdapter,
    bars_to_records,
    clean_bars,
    daily_stats,
    get_chart_bars,
    is_session_final,
    last_sessions,
    period_reference,
    split_chart_window,
    window_start,
)
from src.core.config import settings
from src.adapters.utils import (
    ISTANBUL_TZ,
    InvalidInputError,
    adapter_cache,
    normalize_period,
    normalize_symbol,
    resolve_period,
)

NOW = datetime(2026, 9, 22, 14, 55, tzinfo=ISTANBUL_TZ)  # Tuesday, session in progress


@pytest.fixture(autouse=True)
def _clear_cache():
    adapter_cache.clear()
    yield
    adapter_cache.clear()


def _bars(index, closes, volume=1000.0):
    return pd.DataFrame(
        {"Open": closes, "High": [c + 1 for c in closes], "Low": [c - 1 for c in closes], "Close": closes,
         "Volume": [volume] * len(closes)},
        index=pd.DatetimeIndex(index),
    )


# --- periods ------------------------------------------------------------------

@pytest.mark.parametrize(
    ("ui_period", "turkish_period", "interval", "months", "sessions", "ytd"),
    [
        # Every period the dashboard sends (components/dashboard/chart-data.ts CHART_PERIODS and
        # components/stock/PriceChartCard.tsx: yfinance-style values) plus its old Turkish spelling.
        ("1d", "1g", "15m", None, 1, False),
        ("5d", "5g", "30m", None, 5, False),
        ("1mo", "1ay", "1d", 1, None, False),
        ("3mo", "3ay", "1d", 3, None, False),
        ("6mo", "6ay", "1d", 6, None, False),
        ("ytd", "ybk", "1d", None, None, True),
        ("1y", "1y", "1d", 12, None, False),
        ("5y", "5y", "1wk", 60, None, False),
        ("max", "maks", "1mo", None, None, False),
    ],
)
def test_every_frontend_period_maps_to_interval_and_window(ui_period, turkish_period, interval, months, sessions, ytd):
    spec = resolve_period(ui_period)
    assert (spec.interval, spec.months, spec.sessions, spec.ytd) == (interval, months, sessions, ytd)
    assert resolve_period(turkish_period) == spec


@pytest.mark.parametrize(("alias", "key"), [("1d", "1g"), ("1mo", "1ay"), ("3MO", "3ay"), (" YBK ", "ytd"),
                                            ("Maks.", "max"), ("2y", "2y")])
def test_period_aliases(alias, key):
    assert resolve_period(alias).key == key


@pytest.mark.parametrize("bad", ["", "10ay", "1w", "foo", "1g;drop"])
def test_unknown_period_is_rejected_with_turkish_message(bad):
    with pytest.raises(InvalidInputError) as exc_info:
        resolve_period(bad)
    assert exc_info.value.status_code == 400
    assert "Geçersiz periyot" in exc_info.value.message


def test_normalize_period_stays_backward_compatible():
    assert normalize_period("1ay") == ("1mo", "1d")
    assert normalize_period("1g") == ("1d", "15m")
    assert normalize_period("garbage") == ("1mo", "1d")


def test_window_start_uses_calendar_windows():
    assert window_start(resolve_period("1ay"), NOW) == pd.Timestamp("2026-08-22", tz=ISTANBUL_TZ)
    assert window_start(resolve_period("1y"), NOW) == pd.Timestamp("2025-09-22", tz=ISTANBUL_TZ)
    assert window_start(resolve_period("ytd"), NOW) == pd.Timestamp("2026-01-01", tz=ISTANBUL_TZ)
    assert window_start(resolve_period("max"), NOW) is None


# --- symbols ------------------------------------------------------------------

@pytest.mark.parametrize(("raw", "expected"), [("thyao", "THYAO"), (" THYAO.IS ", "THYAO"), ("garan.e", "GARAN"),
                                               ("XU100", "XU100")])
def test_symbol_normalization(raw, expected):
    assert normalize_symbol(raw) == expected


@pytest.mark.parametrize("raw", ["X", "TH YAO", "ŞEKER", "ABCDEFGHIJK", "THY-AO", "", "BIST:THYAO"])
def test_invalid_symbols_are_rejected(raw):
    with pytest.raises(InvalidInputError):
        normalize_symbol(raw)


# --- bars ---------------------------------------------------------------------

def test_clean_bars_drops_invalid_rows_and_localizes_to_istanbul():
    raw = pd.DataFrame(
        {"Open": [10.0, 11.0, float("nan"), 12.0], "High": [9.0, 11.5, 12.0, 12.5], "Low": [9.5, 10.5, 11.0, 11.5],
         "Close": [10.5, float("inf"), 11.5, 0.0], "Volume": [0.0, 0.0, 0.0, 0.0]},
        index=pd.DatetimeIndex(["2026-09-18 07:00", "2026-09-19 07:00", "2026-09-21 07:00", "2026-09-22 07:00"]),
    )
    frame = clean_bars(raw)

    assert list(frame["Close"]) == [10.5, 11.5]  # inf and non-positive closes dropped
    assert str(frame.index.tz) == "Europe/Istanbul"
    assert frame["High"].iloc[0] == 10.5  # High can never be below Open/Close
    assert frame["Volume"].isna().all()  # all-zero volume = the feed has no volume


def test_bars_to_records_emits_iso_timestamps_and_null_for_missing():
    frame = clean_bars(_bars(pd.date_range("2026-09-22 09:45", periods=2, freq="15min", tz=ISTANBUL_TZ),
                             [300.0, 301.0], volume=0.0))
    records = bars_to_records(frame)

    assert records[0]["Date"] == "2026-09-22T09:45:00+03:00"
    assert records[0]["Close"] == 300.0
    assert records[0]["Volume"] is None


def test_last_sessions_keeps_only_the_latest_trading_days():
    index = pd.DatetimeIndex(
        ["2026-09-18 17:45", "2026-09-21 17:45", "2026-09-21 18:00", "2026-09-22 09:45", "2026-09-22 10:00"],
        tz=ISTANBUL_TZ,
    )
    frame = clean_bars(_bars(index, [1.0, 2.0, 3.0, 4.0, 5.0]))

    assert list(last_sessions(frame, 1)["Close"]) == [4.0, 5.0]
    assert list(last_sessions(frame, 2)["Close"]) == [2.0, 3.0, 4.0, 5.0]


async def test_one_day_chart_does_not_mix_in_the_previous_session(monkeypatch):
    index = pd.DatetimeIndex(["2026-09-21 17:45", "2026-09-21 18:00", "2026-09-22 09:45", "2026-09-22 10:00"],
                             tz=ISTANBUL_TZ)

    async def fake_intraday(symbol, period, interval):
        assert (period, interval) == ("5d", "15m")
        return clean_bars(_bars(index, [1.0, 2.0, 3.0, 4.0]))

    monkeypatch.setattr(price, "_get_intraday_bars", fake_intraday)
    frame = await get_chart_bars("XU100", resolve_period("1g"))

    assert [ts.isoformat() for ts in frame.index] == ["2026-09-22T09:45:00+03:00", "2026-09-22T10:00:00+03:00"]


async def test_monthly_chart_is_trimmed_to_one_calendar_month(monkeypatch):
    days = pd.bdate_range("2026-06-01", "2026-09-22", tz=ISTANBUL_TZ) + pd.Timedelta(hours=9)

    async def fake_daily(symbol):
        return clean_bars(_bars(days, [float(i + 1) for i in range(len(days))]))

    monkeypatch.setattr(price, "get_daily_bars", fake_daily)
    monkeypatch.setattr(price, "now_istanbul", lambda: NOW)
    frame = await get_chart_bars("THYAO", resolve_period("1ay"))

    assert frame.index[0].date() == date(2026, 8, 24)  # first business day on/after 22 Aug
    assert frame.index[-1].date() == date(2026, 9, 22)


async def test_weekly_chart_fetches_enough_bars_to_fill_the_calendar_window(monkeypatch):
    # borsapy's "5y" weekly request is 260 bars counted back from the current week,
    # which starts ~2 weeks after NOW - 60 months; a longer fetch is trimmed instead.
    weeks = pd.date_range(end="2026-09-21", periods=521, freq="W-MON", tz=ISTANBUL_TZ) + pd.Timedelta(hours=9)
    requested: list[tuple] = []

    async def fake_load(symbol, period, interval, start=None):
        requested.append((period, interval))
        bars = {"5y": 260, "10y": 521}[period]
        return clean_bars(_bars(weeks[-bars:], [float(i + 1) for i in range(bars)]))

    monkeypatch.setattr(price, "_load_bars", fake_load)
    monkeypatch.setattr(price, "now_istanbul", lambda: NOW)
    frame = await get_chart_bars("THYAO", resolve_period("5y"))

    assert requested == [("10y", "1wk")]
    assert frame.index[0].date() == date(2021, 9, 27)  # first weekly bar on/after 22 Sep 2021


def test_period_reference_is_the_last_close_before_the_window():
    days = pd.bdate_range("2025-12-01", "2026-09-22", tz=ISTANBUL_TZ) + pd.Timedelta(hours=9)
    daily = clean_bars(_bars(days, [float(i + 1) for i in range(len(days))]))
    intraday = clean_bars(_bars(
        pd.DatetimeIndex(["2026-09-21 17:45", "2026-09-21 18:00", "2026-09-22 09:45", "2026-09-22 10:00"],
                         tz=ISTANBUL_TZ),
        [292.0, 293.5, 294.0, 295.0],
    ))

    window, before = split_chart_window(daily, resolve_period("ytd"), NOW)
    assert window.index[0].date() == date(2026, 1, 1)
    ytd = period_reference(before)
    assert ytd == {"reference_close": float(daily.loc[: "2025-12-31"]["Close"].iloc[-1]),
                   "reference_date": "2025-12-31"}  # the prior year's last close, not 2 January's

    window, before = split_chart_window(intraday, resolve_period("1d"), NOW)
    assert list(window["Close"]) == [294.0, 295.0]
    assert period_reference(before) == {"reference_close": 293.5, "reference_date": "2026-09-21"}  # previous close

    window, before = split_chart_window(daily, resolve_period("max"), NOW)
    assert len(window) == len(daily)
    assert period_reference(before) == {"reference_close": None, "reference_date": None}


async def test_history_payloads_carry_the_period_reference(monkeypatch):
    days = pd.bdate_range("2025-06-02", "2026-09-22", tz=ISTANBUL_TZ) + pd.Timedelta(hours=9)
    daily = clean_bars(_bars(days, [float(i + 1) for i in range(len(days))]))

    async def fake_daily(symbol):
        return daily

    async def no_quotes(symbols):
        return {}

    async def no_metrics(symbol):
        return {}

    async def no_isyatirim(symbols):
        return {}

    # Store unavailable (unit tests run without the market store): the live path is used.
    monkeypatch.setattr(settings, "market_store_enabled", False)
    monkeypatch.setattr(price, "get_daily_bars", fake_daily)
    monkeypatch.setattr(price, "get_quotes", no_quotes)
    monkeypatch.setattr(isyatirim_prices, "fetch_isyatirim_quotes", no_isyatirim)
    monkeypatch.setattr(index_adapter, "get_company_metrics", no_metrics)
    monkeypatch.setattr(price, "now_istanbul", lambda: NOW)

    stock = await index_adapter.get_ticker_history("THYAO", "3mo")
    index = await index_adapter.get_index_data("XU100", "ytd")

    assert stock["meta"]["served_from"] == "live" and stock["meta"]["delay_seconds"] == 900
    assert stock["meta"]["as_of"] == "2026-09-22"

    before_3mo = daily[daily.index < pd.Timestamp("2026-06-22", tz=ISTANBUL_TZ)]
    assert stock["reference_close"] == float(before_3mo["Close"].iloc[-1])
    assert stock["reference_date"] == "2026-06-19"  # Friday before the 22 June window start
    assert stock["data"][0]["Date"].startswith("2026-06-22")
    assert index["reference_date"] == "2025-12-31"
    assert index["reference_close"] == float(daily.loc[: "2025-12-31"]["Close"].iloc[-1])


def test_daily_stats_use_a_true_52_week_window():
    days = pd.bdate_range("2024-09-02", "2026-09-22", tz=ISTANBUL_TZ)
    closes = [100.0] * len(days)
    closes[5] = 500.0  # spike older than 52 weeks must not become the 52-week high
    frame = clean_bars(_bars(days, closes))
    stats = daily_stats(frame, NOW)

    assert stats["year_high"] == 101.0
    assert stats["year_low"] == 99.0
    assert stats["fifty_day_average"] == 100.0
    assert stats["two_hundred_day_average"] == 100.0


# --- session completeness / DB ingest -----------------------------------------------

def test_session_final_only_after_close_plus_feed_delay():
    assert is_session_final(date(2026, 9, 21), NOW)
    assert not is_session_final(date(2026, 9, 22), NOW)
    assert is_session_final(date(2026, 9, 22), datetime(2026, 9, 22, 18, 45, tzinfo=ISTANBUL_TZ))


def test_price_adapter_never_stores_the_in_progress_bar():
    index = pd.DatetimeIndex(["2026-09-21 09:00", "2026-09-22 09:00"], tz=ISTANBUL_TZ)
    df = _bars(index, [293.5, 300.25])
    df.loc[index[0], "Volume"] = float("nan")
    records = PriceAdapter("THYAO")._records_from_frame(df, "borsapy", now=NOW)

    assert [r.trading_date for r in records] == [date(2026, 9, 21)]
    assert records[0].close == 293.5
    assert records[0].volume is None  # NaN must not be written as a number


def test_price_adapter_stores_todays_bar_after_the_close_and_fridays_bar_on_the_weekend():
    index = pd.DatetimeIndex(["2026-09-18 09:00", "2026-09-21 09:00", "2026-09-22 09:00"], tz=ISTANBUL_TZ)
    df = _bars(index, [285.5, 293.5, 298.0])
    adapter = PriceAdapter("THYAO")

    after_close = adapter._records_from_frame(df, "borsapy", now=datetime(2026, 9, 22, 18, 31, tzinfo=ISTANBUL_TZ))
    saturday = adapter._records_from_frame(df.iloc[:1], "borsapy", now=datetime(2026, 9, 19, 11, 0, tzinfo=ISTANBUL_TZ))

    assert [r.trading_date for r in after_close] == [date(2026, 9, 18), date(2026, 9, 21), date(2026, 9, 22)]
    assert after_close[-1].close == 298.0
    assert [r.trading_date for r in saturday] == [date(2026, 9, 18)]
