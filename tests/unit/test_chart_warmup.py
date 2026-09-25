"""Optional `warmup` query parameter on the ticker/index chart-history endpoints."""

from datetime import datetime

import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.adapters import index_adapter, price
from src.adapters.price import MAX_CHART_WARMUP_BARS, clean_bars
from src.adapters.utils import ISTANBUL_TZ, adapter_cache
from src.api import routers_market

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


def _daily_frame(start, end):
    days = pd.bdate_range(start, end, tz=ISTANBUL_TZ) + pd.Timedelta(hours=9)
    return clean_bars(_bars(days, [float(i + 1) for i in range(len(days))]))


async def _no_quotes(symbols):
    return {}


async def _no_metrics(symbol):
    return {}


def _patch_daily_source(monkeypatch, frame):
    """Serve ``frame`` as the daily bars for both the chart window and the (unused) daily
    stats part, and stub out quote/company-card parts, so only warmup slicing is exercised.
    """
    async def fake_daily(symbol):
        return frame

    monkeypatch.setattr(price, "now_istanbul", lambda: NOW)
    monkeypatch.setattr(price, "get_daily_bars", fake_daily)
    monkeypatch.setattr(index_adapter, "get_daily_bars", fake_daily)
    monkeypatch.setattr(index_adapter, "get_quotes", _no_quotes)
    monkeypatch.setattr(index_adapter, "get_company_metrics", _no_metrics)


# --- adapter behaviour ----------------------------------------------------------

async def test_warmup_zero_omits_the_key_and_matches_the_no_warmup_response(monkeypatch):
    daily = _daily_frame("2025-06-02", "2026-09-22")
    _patch_daily_source(monkeypatch, daily)

    explicit = await index_adapter.get_ticker_history("THYAO", "3mo", warmup=0)
    default = await index_adapter.get_ticker_history("THYAO", "3mo")

    assert "warmup" not in explicit
    assert "warmup" not in default
    assert explicit == default
    before_3mo = daily[daily.index < pd.Timestamp("2026-06-22", tz=ISTANBUL_TZ)]
    assert explicit["reference_close"] == float(before_3mo["Close"].iloc[-1])
    assert explicit["data"][0]["Date"].startswith("2026-06-22")


async def test_warmup_returns_the_bars_immediately_before_the_window(monkeypatch):
    daily = _daily_frame("2025-06-02", "2026-09-22")
    _patch_daily_source(monkeypatch, daily)

    result = await index_adapter.get_ticker_history("THYAO", "3mo", warmup=5)

    warmup = result["warmup"]
    assert len(warmup) == 5
    dates = [bar["Date"] for bar in warmup]
    assert dates == sorted(dates)  # ascending
    first_data_date = result["data"][0]["Date"]
    assert all(d < first_data_date for d in dates)  # strictly before the window
    assert warmup[-1]["Close"] == result["reference_close"]


async def test_warmup_larger_than_available_history_returns_all_of_it(monkeypatch):
    daily = _daily_frame("2026-06-18", "2026-09-22")  # only 2 business days before the 3mo window
    _patch_daily_source(monkeypatch, daily)

    result = await index_adapter.get_ticker_history("THYAO", "3mo", warmup=MAX_CHART_WARMUP_BARS)

    assert len(result["warmup"]) == 2
    assert result["warmup"][-1]["Close"] == result["reference_close"]


async def test_warmup_is_empty_when_nothing_precedes_the_window(monkeypatch):
    daily = _daily_frame("2025-06-02", "2026-09-22")
    _patch_daily_source(monkeypatch, daily)

    async def fake_load(symbol, period, interval, start=None):
        return daily

    monkeypatch.setattr(price, "_load_bars", fake_load)

    result = await index_adapter.get_ticker_history("THYAO", "max", warmup=5)

    assert result["warmup"] == []
    assert result["reference_close"] is None
    assert result["reference_date"] is None


async def test_index_endpoint_supports_warmup_the_same_way(monkeypatch):
    daily = _daily_frame("2025-06-02", "2026-09-22")
    _patch_daily_source(monkeypatch, daily)

    baseline = await index_adapter.get_index_data("XU100", "3mo", warmup=0)
    warmed = await index_adapter.get_index_data("XU100", "3mo", warmup=5)

    assert "warmup" not in baseline
    assert len(warmed["warmup"]) == 5
    assert warmed["warmup"][-1]["Close"] == warmed["reference_close"]
    first_data_date = warmed["data"][0]["Date"]
    assert all(bar["Date"] < first_data_date for bar in warmed["warmup"])


async def test_warmup_zero_then_warmup_five_are_cached_separately(monkeypatch):
    daily = _daily_frame("2025-06-02", "2026-09-22")
    _patch_daily_source(monkeypatch, daily)

    first = await index_adapter.get_ticker_history("THYAO", "3mo", warmup=0)
    second = await index_adapter.get_ticker_history("THYAO", "3mo", warmup=5)

    assert "warmup" not in first
    assert len(second["warmup"]) == 5  # not served from the warmup=0 cache entry


# --- router validation ------------------------------------------------------------

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


@pytest.mark.parametrize("path", ["/market/ticker/THYAO/history", "/market/index/XU100"])
def test_warmup_out_of_range_is_422(client, recorded, path):
    assert client.get(f"{path}?warmup=301").status_code == 422
    assert client.get(f"{path}?warmup=-1").status_code == 422
    assert not recorded


def test_warmup_omitted_defaults_to_zero_without_the_key(client, recorded):
    # No "warmup" kwarg at all (not even warmup=0): the adapter call is byte-for-byte
    # what it was before this feature, so existing callers/tests stay unaffected.
    response = client.get("/market/ticker/THYAO/history")
    assert response.status_code == 200
    assert "warmup" not in response.json()
    assert recorded["history"] == (("THYAO",), {"period": "1ay"})

    response = client.get("/market/index/XU100")
    assert response.status_code == 200
    assert "warmup" not in response.json()
    assert recorded["index"] == (("XU100",), {"period": "1ay"})


def test_warmup_is_passed_through_to_the_adapter(client, recorded):
    assert client.get("/market/ticker/THYAO/history?warmup=5").status_code == 200
    assert recorded["history"] == (("THYAO",), {"period": "1ay", "warmup": 5})

    assert client.get(f"/market/index/XU100?warmup={MAX_CHART_WARMUP_BARS}").status_code == 200
    assert recorded["index"] == (("XU100",), {"period": "1ay", "warmup": MAX_CHART_WARMUP_BARS})
