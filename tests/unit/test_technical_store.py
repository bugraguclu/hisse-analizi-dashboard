"""Technical indicators computed from stored daily bars (market store hit) vs TradingView fallback."""

from datetime import datetime

import numpy as np
import pandas as pd
import pytest

from src.adapters import price, technical
from src.adapters.utils import ISTANBUL_TZ, adapter_cache
from src.services import market_service


def _frame(n):
    rng = np.random.default_rng(11)
    close = 100 + np.cumsum(rng.normal(0, 1, n))
    index = pd.bdate_range(end="2026-09-22", periods=n, tz=ISTANBUL_TZ) + pd.Timedelta(hours=9)
    return pd.DataFrame({"Open": close, "High": close + 1, "Low": close - 1, "Close": close, "Volume": 1e6},
                        index=index)


def _stored(frame, served_from="store"):
    meta = market_service.build_meta(source="tradingview", fetched_at=None, served_from=served_from,
                                     as_of="2026-09-22", symbol="THYAO")
    return market_service.DailyBars(frame=frame, meta=meta)


@pytest.fixture
def scanner(monkeypatch):
    calls: list[int] = []

    async def fake_scan(symbols, columns, **kwargs):
        calls.append(len(columns))
        row = {"RSI": 11.0, "MACD.macd": 1.0, "MACD.signal": 0.5, "Stoch.K": 5.0, "Stoch.D": 6.0, "close": 100.0,
               "BB.upper": 1.0, "BB.lower": 0.5}
        for period in technical.TV_MA_PERIODS:
            row[f"SMA{period}"] = 1000.0 + period
            row[f"EMA{period}"] = 2000.0 + period
        return {"THYAO": {col: row.get(col.split("|")[0]) for col in columns}}

    monkeypatch.setattr(technical, "tradingview_scan", fake_scan)
    return calls


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    adapter_cache.clear()
    monkeypatch.setattr(price, "now_istanbul", lambda: datetime(2026, 9, 22, 14, 0, tzinfo=ISTANBUL_TZ))

    async def no_live(ticker):
        raise AssertionError("live bars must not be fetched on a store hit")

    monkeypatch.setattr(technical, "load_daily", no_live)
    yield
    adapter_cache.clear()


def _store(monkeypatch, frame):
    async def stored(ticker):
        return _stored(frame)

    monkeypatch.setattr(technical, "load_stored_daily", stored)


async def test_fresh_store_computes_indicators_locally_without_the_scanner(monkeypatch, scanner):
    frame = _frame(1300)
    _store(monkeypatch, frame)

    rsi = await technical.get_rsi("THYAO")
    macd = await technical.get_macd("THYAO")
    stoch = await technical.get_stochastic("THYAO")
    ema200 = await technical.get_ema("THYAO", period=200)

    assert rsi["value"] == pytest.approx(technical.rsi_last(frame["Close"], 14), abs=1e-4)
    assert rsi["source"] == technical.SOURCE_LOCAL
    assert rsi["meta"]["served_from"] == "store" and rsi["meta"]["as_of"] == "2026-09-22"
    assert macd["data"]["macd"] == pytest.approx(technical.macd_last(frame["Close"])["macd"], abs=1e-4)
    assert stoch["data"]["k"] == pytest.approx(technical.stochastic_last(frame)["k"], abs=1e-4)
    assert ema200["value"] == pytest.approx(technical.ema_last(frame["Close"], 200), abs=1e-4)
    assert scanner == []  # no TradingView request at all


async def test_short_store_history_uses_tradingview_for_slow_emas(monkeypatch, scanner):
    _store(monkeypatch, _frame(500))  # a 2-year universe series: EMA200 has not converged

    ema200 = await technical.get_ema("THYAO", period=200)
    ema20 = await technical.get_ema("THYAO", period=20)

    assert ema200["value"] == 2200.0 and ema200["source"] == technical.SOURCE_TRADINGVIEW
    assert ema200["meta"]["served_from"] == "live"
    assert ema20["source"] == technical.SOURCE_LOCAL and ema20["meta"]["served_from"] == "store"


async def test_moving_averages_mix_store_and_tradingview_only_where_needed(monkeypatch, scanner):
    frame = _frame(500)
    _store(monkeypatch, frame)
    result = await technical.get_moving_averages("THYAO")

    assert result["sma"]["sma_200"] == pytest.approx(frame["Close"].tail(200).mean(), abs=1e-4)
    assert result["ema"]["ema_50"] == pytest.approx(technical.ema_last(frame["Close"], 50), abs=1e-4)
    assert result["ema"]["ema_200"] == 2200.0  # TradingView's full-history value
    assert result["source"] == technical.SOURCE_TRADINGVIEW
    assert result["meta"]["served_from"] == "live"  # worst freshness of the parts
    assert len(scanner) == 1


async def test_supertrend_and_pivots_read_the_store_first(monkeypatch):
    frame = _frame(300)

    async def daily(ticker):
        return _stored(frame)

    monkeypatch.setattr(technical, "load_daily", daily)
    supertrend = await technical.get_supertrend("THYAO")
    pivots = await technical.get_pivot_points("THYAO")

    assert supertrend["meta"]["served_from"] == "store"
    assert pivots["session_date"] == frame.index[-2].date().isoformat()  # today's bar is still running
    assert pivots["meta"]["source"] == "tradingview"
