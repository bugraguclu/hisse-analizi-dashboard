"""Chart bars in US dollars (`currency=USD` on the ticker/index chart-history endpoints)."""

from datetime import datetime

import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.adapters import chart_currency, index_adapter, isyatirim_prices, price
from src.adapters.price import clean_bars
from src.adapters.utils import ISTANBUL_TZ, adapter_cache, resolve_period
from src.api import routers_market
from src.core.config import settings
from src.services import market_service

NOW = datetime(2026, 9, 25, 14, 55, tzinfo=ISTANBUL_TZ)  # Friday, session in progress


@pytest.fixture(autouse=True)
def _clear_cache():
    adapter_cache.clear()
    yield
    adapter_cache.clear()


def _frame(stamps, closes, *, tz=ISTANBUL_TZ, volume=1000.0):
    """Bars with open/high/low around the close (high > open > close > low)."""
    index = pd.DatetimeIndex(pd.to_datetime(stamps)).tz_localize(tz)
    return clean_bars(
        pd.DataFrame(
            {
                "Open": [c + 1 for c in closes],
                "High": [c + 2 for c in closes],
                "Low": [c - 2 for c in closes],
                "Close": closes,
                "Volume": [volume] * len(closes),
            },
            index=index,
        )
    )


def _fx(stamps_utc, closes):
    """USD/TRY bars stamped the way TradingView stamps FX_IDC (UTC day roll)."""
    return _frame(stamps_utc, closes, tz="UTC", volume=0.0)


def _rates(stock: pd.DataFrame, usd: pd.DataFrame) -> list[float]:
    return [round(t / u, 9) for t, u in zip(stock.loc[usd.index, "Close"], usd["Close"])]


# --- alignment ----------------------------------------------------------------------

def test_daily_bars_use_the_same_istanbul_day_and_the_previous_rate_on_a_gap():
    stock = _frame(
        ["2026-09-18 09:00", "2026-09-21 09:00", "2026-09-22 09:00", "2026-09-23 09:00", "2026-09-24 09:00"],
        [100.0, 200.0, 210.0, 220.0, 230.0],
    )
    # FX days start at 22:00 UTC the evening before (01:00 in Istanbul); no bar for 09-23.
    fx = _fx(["2026-09-20 22:00", "2026-09-21 22:00", "2026-09-23 22:00"], [40.0, 41.0, 43.0])

    usd = chart_currency.to_usd(stock, fx, "1d")

    assert [d.date().isoformat() for d in usd.index] == ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"]
    assert _rates(stock, usd) == [40.0, 41.0, 41.0, 43.0]  # 09-18 predates the FX series; 09-23 keeps 09-22's rate


def test_every_price_of_a_bar_is_divided_by_the_same_rate_and_volume_stays():
    stock = _frame(["2026-09-21 09:00"], [200.0], volume=12345.0)
    fx = _fx(["2026-09-20 22:00"], [40.0])

    bar = chart_currency.to_usd(stock, fx, "1d").iloc[0]

    assert (bar["Open"], bar["High"], bar["Low"], bar["Close"]) == (201 / 40, 202 / 40, 198 / 40, 200 / 40)
    assert bar["Volume"] == 12345.0


def test_intraday_bars_match_their_slot_and_a_stale_tail_keeps_the_last_rate():
    stock = _frame(["2026-09-25 10:00", "2026-09-25 10:15", "2026-09-25 10:30"], [200.0, 201.0, 202.0])
    fx = _fx(["2026-09-25 07:00", "2026-09-25 07:15"], [40.0, 41.0])  # 10:00 and 10:15 in Istanbul

    usd = chart_currency.to_usd(stock, fx, "15m")

    assert _rates(stock, usd) == [40.0, 41.0, 41.0]


def test_weekly_bars_match_the_week_when_monday_is_a_holiday():
    stock = _frame(["2026-09-01 09:00", "2026-09-07 09:00"], [200.0, 210.0])  # Tuesday, Monday
    fx = _fx(["2026-08-30 22:00", "2026-09-06 22:00"], [40.0, 41.0])  # Sunday 22:00 UTC = Monday 01:00

    assert _rates(stock, chart_currency.to_usd(stock, fx, "1wk")) == [40.0, 41.0]


def test_monthly_bars_match_their_month_across_the_old_winter_offset():
    # Winter 2003: Istanbul was UTC+2, so an FX month starting at 21:00 UTC on the last day
    # of the previous month is stamped 23:00 local there — it still belongs to the new month.
    stock = _frame(["2003-01-02 09:00", "2003-02-03 09:00", "2003-03-03 09:00"], [1.0, 2.0, 3.0])
    fx = _fx(["2002-12-31 21:00", "2003-01-31 21:00", "2003-02-28 21:00"], [1.6, 1.4, 1.5])

    assert _rates(stock, chart_currency.to_usd(stock, fx, "1mo")) == [1.6, 1.4, 1.5]


def test_empty_frames_stay_empty():
    empty = clean_bars(None)
    assert chart_currency.to_usd(empty, _fx(["2026-09-20 22:00"], [40.0]), "1d").empty


def test_fx_info_names_the_newest_rate():
    info = chart_currency.fx_info(_fx(["2026-09-23 22:00", "2026-09-24 22:00"], [48.88, 48.93]))

    assert info == {
        "pair": "USD/TRY",
        "source": "TradingView FX_IDC:USDTRY",
        "rate": 48.93,
        "bar_time": "2026-09-25T01:00:00+03:00",  # Istanbul time, like the bars' dates
    }


async def test_usd_window_recomputes_the_reference_close_in_dollars(monkeypatch):
    before = _frame(["2026-09-21 09:00", "2026-09-22 09:00"], [200.0, 210.0])
    window = _frame(["2026-09-23 09:00", "2026-09-24 09:00"], [220.0, 230.0])
    fx = _fx(["2026-09-20 22:00", "2026-09-21 22:00", "2026-09-22 22:00", "2026-09-23 22:00"], [40.0, 42.0, 44.0, 46.0])

    async def fake_window(symbol, spec, *, now=None, warmup=0):
        return market_service.ChartWindow(window, price.period_reference(before), None, before)

    async def fake_fx(interval):
        assert interval == "1d"
        return fx

    monkeypatch.setattr(market_service, "get_chart_window", fake_window)
    monkeypatch.setattr(chart_currency, "usdtry_bars", fake_fx)

    chart, info = await chart_currency.usd_chart_window("THYAO", resolve_period("1ay"), warmup=5)

    assert chart.reference == {"reference_close": 210 / 42, "reference_date": "2026-09-22"}
    assert list(chart.bars["Close"]) == [220 / 44, 230 / 46]
    assert list(chart.before["Close"]) == [200 / 40, 210 / 42]
    assert info["rate"] == 46.0


# --- adapter payloads -------------------------------------------------------------------

def _patch_sources(monkeypatch, daily, fx):
    async def fake_daily(symbol):
        return daily

    async def fake_fx(interval):
        return fx

    async def nothing(*args, **kwargs):
        return {}

    async def no_official(symbol):
        raise isyatirim_prices.MarketDataError("İş Yatırım verisine ulaşılamadı", status_code=503)

    monkeypatch.setattr(settings, "market_store_enabled", False)
    monkeypatch.setattr(price, "now_istanbul", lambda: NOW)
    monkeypatch.setattr(price, "get_daily_bars", fake_daily)
    monkeypatch.setattr(price, "get_quotes", nothing)
    monkeypatch.setattr(isyatirim_prices, "fetch_isyatirim_quotes", nothing)
    monkeypatch.setattr(isyatirim_prices, "fetch_quote", no_official)
    monkeypatch.setattr(index_adapter, "get_company_metrics", nothing)
    monkeypatch.setattr(chart_currency, "usdtry_bars", fake_fx)


def _daily_and_fx():
    days = pd.bdate_range("2026-05-01", "2026-09-25", tz=ISTANBUL_TZ) + pd.Timedelta(hours=9)
    daily = clean_bars(pd.DataFrame({"Open": 100.0, "High": 101.0, "Low": 99.0, "Close": 100.0, "Volume": 5.0}, index=days))
    fx_days = (days.normalize() + pd.Timedelta(hours=1)).tz_convert("UTC")  # 01:00 Istanbul = 22:00 UTC the evening before
    fx = clean_bars(pd.DataFrame({"Open": 40.0, "High": 40.0, "Low": 40.0, "Close": 40.0, "Volume": 0.0}, index=fx_days))
    return daily, fx


async def test_ticker_history_in_usd_divides_bars_warmup_and_reference(monkeypatch):
    daily, fx = _daily_and_fx()
    _patch_sources(monkeypatch, daily, fx)

    tl = await index_adapter.get_ticker_history("THYAO", "3mo", warmup=3)
    usd = await index_adapter.get_ticker_history("THYAO", "3mo", warmup=3, currency="USD")

    assert tl["currency"] == "TRY" and "fx" not in tl
    assert usd["currency"] == "USD"
    assert usd["fx"]["rate"] == 40.0
    assert [bar["Date"] for bar in usd["data"]] == [bar["Date"] for bar in tl["data"]]
    assert {bar["Close"] for bar in usd["data"] + usd["warmup"]} == {2.5}
    assert usd["data"][0]["Volume"] == tl["data"][0]["Volume"]
    assert usd["reference_close"] == 2.5 and usd["reference_date"] == tl["reference_date"]
    assert usd["info"] == tl["info"]  # the quote block stays in lira


async def test_index_data_in_usd(monkeypatch):
    daily, fx = _daily_and_fx()
    _patch_sources(monkeypatch, daily, fx)

    usd = await index_adapter.get_index_data("XU100", "1mo", currency="USD")

    assert usd["currency"] == "USD"
    assert {bar["Close"] for bar in usd["data"]} == {2.5}


async def test_usd_history_without_fx_is_an_error_payload(monkeypatch):
    daily, _fx_frame = _daily_and_fx()
    _patch_sources(monkeypatch, daily, _fx_frame)

    async def fx_down(interval):
        raise price.MarketDataError("USD/TRY kuru alınamadı", status_code=503)

    monkeypatch.setattr(chart_currency, "usdtry_bars", fx_down)

    result = await index_adapter.get_ticker_history("THYAO", "3mo", currency="USD")

    assert result["data"] == []
    assert "error" in result


# --- router ---------------------------------------------------------------------------

@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(routers_market.market_router)
    return TestClient(app)


@pytest.fixture
def recorded(monkeypatch):
    calls: dict[str, tuple] = {}

    def fake(name, payload):
        async def _fake(*args, **kwargs):
            calls[name] = (args, kwargs)
            return payload
        return _fake

    monkeypatch.setattr(routers_market, "get_ticker_history", fake("history", {"ticker": "THYAO", "data": []}))
    monkeypatch.setattr(routers_market, "get_index_data", fake("index", {"symbol": "XU100", "data": []}))
    return calls


def test_currency_usd_is_passed_through(client, recorded):
    assert client.get("/market/ticker/THYAO/history?period=3ay&warmup=5&currency=USD").status_code == 200
    assert recorded["history"] == (("THYAO",), {"period": "3ay", "warmup": 5, "currency": "USD"})

    assert client.get("/market/index/XU100?currency=USD").status_code == 200
    assert recorded["index"] == (("XU100",), {"period": "1ay", "currency": "USD"})


def test_currency_try_keeps_the_default_call(client, recorded):
    assert client.get("/market/ticker/THYAO/history?currency=TRY").status_code == 200
    assert recorded["history"] == (("THYAO",), {"period": "1ay"})


@pytest.mark.parametrize("path", ["/market/ticker/THYAO/history", "/market/index/XU100"])
@pytest.mark.parametrize("currency", ["EUR", "usd", ""])
def test_unknown_currency_is_422(client, recorded, path, currency):
    assert client.get(f"{path}?currency={currency}").status_code == 422
    assert not recorded
