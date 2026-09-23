"""Technical adapter behaviour with mocked TradingView scanner / daily bars."""

from datetime import datetime

import numpy as np
import pandas as pd
import pytest

from src.adapters import price, technical
from src.adapters.utils import ISTANBUL_TZ, MarketDataError, adapter_cache
from src.services import market_service


@pytest.fixture(autouse=True)
def _clear_cache(monkeypatch):
    adapter_cache.clear()

    async def no_store(ticker):  # the market store is exercised in test_technical_store.py
        return None

    monkeypatch.setattr(technical, "load_stored_daily", no_store)
    yield
    adapter_cache.clear()


def _daily(frame, served_from="live"):
    meta = market_service.build_meta(source="tradingview", fetched_at=None, served_from=served_from, symbol="THYAO")
    return market_service.DailyBars(frame=frame, meta=meta)


def _daily_frame(n=300):
    rng = np.random.default_rng(3)
    close = 100 + np.cumsum(rng.normal(0, 1, n))
    index = pd.bdate_range(end="2026-09-22", periods=n, tz=ISTANBUL_TZ) + pd.Timedelta(hours=9)
    return pd.DataFrame(
        {"Open": close, "High": close + 1, "Low": close - 1, "Close": close, "Volume": 1e6}, index=index
    )


def _tv_row():
    row = {"RSI": 52.9, "RSI[1]": 47.0, "MACD.macd": -4.09, "MACD.signal": -4.70, "BB.upper": 313.9,
           "BB.lower": 279.3, "BB.basis": 296.6, "Stoch.K": 73.2, "Stoch.D": 62.4, "close": 302.25,
           "Recommend.All": 0.11, "Recommend.MA": 0.13, "Recommend.Other": 0.09}
    for i, period in enumerate(technical.TV_MA_PERIODS):
        row[f"SMA{period}"] = 290.0 + i
        row[f"EMA{period}"] = 280.0 + i
    return row


@pytest.fixture
def scanner(monkeypatch):
    calls: list[int] = []

    async def fake_scan(symbols, columns, **kwargs):
        calls.append(len(columns))
        symbols = list(symbols)
        if symbols != ["THYAO"]:
            return {}
        row = _tv_row()
        return {"THYAO": {col: row.get(col.split("|")[0]) for col in columns}}

    monkeypatch.setattr(technical, "tradingview_scan", fake_scan)
    return calls


@pytest.fixture
def bars(monkeypatch):
    frame = _daily_frame()

    async def fake_daily(symbol):
        if symbol != "THYAO":
            raise price.SymbolNotFoundError(symbol)
        return _daily(frame)

    monkeypatch.setattr(technical, "load_daily", fake_daily)
    monkeypatch.setattr(price, "now_istanbul", lambda: datetime(2026, 9, 22, 14, 0, tzinfo=ISTANBUL_TZ))
    return frame


async def test_pivots_use_previous_session_bar_instead_of_crashing_on_fast_info(bars):
    result = await technical.get_pivot_points("THYAO")

    previous = bars.iloc[-2]  # today's bar is still in progress at 14:00
    expected_pivot = (previous["High"] + previous["Low"] + previous["Close"]) / 3
    assert "error" not in result
    assert result["session_date"] == bars.index[-2].date().isoformat()
    assert result["pivots"]["pivot"] == pytest.approx(expected_pivot, abs=1e-4)
    assert set(result["pivots"]) == {"pivot", "r1", "r2", "r3", "s1", "s2", "s3"}


async def test_moving_averages_report_each_period_not_one_repeated_value(scanner, bars):
    result = await technical.get_moving_averages("THYAO")

    assert len(set(result["sma"].values())) == 5
    assert result["sma"]["sma_50"] == 294.0 and result["sma"]["sma_200"] == 296.0
    assert result["golden_cross"] is False  # SMA50 below SMA200
    assert result["source"] == "TradingView"
    assert "last_cross" in result


async def test_requested_periods_are_honoured(scanner, bars):
    rsi14 = await technical.get_rsi("THYAO", period=14)
    rsi7 = await technical.get_rsi("THYAO", period=7)
    sma21 = await technical.get_sma("THYAO", period=21)
    sma50 = await technical.get_sma("THYAO", period=50)

    assert rsi14["value"] == 52.9 and rsi14["source"] == "TradingView"
    assert rsi14["meta"]["served_from"] == "live" and rsi14["meta"]["delay_seconds"] == 900
    assert rsi7["period"] == 7 and rsi7["source"] != "TradingView"
    assert rsi7["value"] == pytest.approx(technical.rsi_last(bars["Close"], 7), abs=1e-4)
    assert sma21["value"] == pytest.approx(bars["Close"].tail(21).mean(), abs=1e-4)
    assert sma50["value"] == 294.0


async def test_indicators_fall_back_to_daily_bars_when_scanner_is_down(monkeypatch, bars):
    async def down(symbols, columns, **kwargs):
        raise MarketDataError("Piyasa verisi sağlayıcısına ulaşılamadı", status_code=503)

    monkeypatch.setattr(technical, "tradingview_scan", down)
    rsi = await technical.get_rsi("THYAO")
    macd = await technical.get_macd("THYAO")

    assert rsi["value"] == pytest.approx(technical.rsi_last(bars["Close"], 14), abs=1e-4)
    assert macd["data"]["macd"] == pytest.approx(technical.macd_last(bars["Close"])["macd"], abs=1e-4)
    signals = await technical.get_ta_signals("THYAO")
    assert signals["error_status"] == 503 and signals["signals"] == {}


async def test_all_timeframes_use_a_single_scanner_request(scanner):
    result = await technical.get_ta_signals_all_timeframes("THYAO")
    await technical.get_ta_signals("THYAO")
    await technical.get_macd("THYAO")

    assert list(result["timeframes"]) == list(technical.TA_INTERVALS)
    assert scanner == [len(technical._TA_COLUMNS) * len(technical.TA_INTERVALS)]


async def test_unknown_symbol_maps_to_404(scanner, bars):
    for payload in (
        await technical.get_ta_signals("ZZZZZ"),
        await technical.get_rsi("ZZZZZ"),
        await technical.get_supertrend("ZZZZZ"),
        await technical.get_pivot_points("ZZZZZ"),
    ):
        assert payload["error_status"] == 404
        assert payload["error"] == "Sembol bulunamadı: ZZZZZ"


async def test_unexpected_errors_do_not_leak_exception_text(monkeypatch):
    async def broken(symbol):
        raise RuntimeError("'FastInfo' has no attribute 'get'")

    monkeypatch.setattr(technical, "load_daily", broken)
    result = await technical.get_supertrend("THYAO")

    assert result["error_status"] == 502
    assert "FastInfo" not in result["error"]
    assert result["error"] == "SuperTrend hesaplanamadı"


async def test_supertrend_direction_is_an_integer(bars):
    result = await technical.get_supertrend("THYAO")
    assert result["data"]["direction"] in (1, -1)
    assert isinstance(result["data"]["direction"], int)
