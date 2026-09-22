"""Indicator math vs independent textbook implementations + TradingView rating rules."""

from datetime import datetime

import numpy as np
import pandas as pd
import pytest

from src.adapters.technical import (
    bollinger_last,
    build_signals,
    classic_pivots,
    ema_last,
    last_ma_cross,
    macd_last,
    pivot_source_bar,
    rating_label,
    rsi_last,
    sma_last,
    stochastic_last,
    supertrend_last,
)
from src.adapters.utils import ISTANBUL_TZ


def _random_walk(n=400, seed=7):
    rng = np.random.default_rng(seed)
    close = 100 + np.cumsum(rng.normal(0, 1.5, n))
    high = close + rng.uniform(0.1, 2.0, n)
    low = close - rng.uniform(0.1, 2.0, n)
    index = pd.bdate_range("2025-01-01", periods=n, tz=ISTANBUL_TZ)
    return pd.DataFrame({"Open": close, "High": high, "Low": low, "Close": close}, index=index)


def _wilder(series, n):
    out = pd.Series(np.nan, index=series.index)
    out.iloc[n - 1] = series.iloc[:n].mean()
    for i in range(n, len(series)):
        out.iloc[i] = (out.iloc[i - 1] * (n - 1) + series.iloc[i]) / n
    return out


def _reference_rsi(close, n):
    delta = close.diff().dropna()
    gain = _wilder(delta.clip(lower=0), n).iloc[-1]
    loss = _wilder(-delta.clip(upper=0), n).iloc[-1]
    return 100 - 100 / (1 + gain / loss)


def _reference_supertrend(df, period=10, mult=3.0):
    h, lo, c = df["High"], df["Low"], df["Close"]
    tr = pd.concat([h - lo, (h - c.shift()).abs(), (lo - c.shift()).abs()], axis=1).max(axis=1)
    atr = _wilder(tr, period)
    upper_basic, lower_basic = (h + lo) / 2 + mult * atr, (h + lo) / 2 - mult * atr
    upper, lower = upper_basic.copy(), lower_basic.copy()
    bullish = False
    for i in range(period, len(df)):
        if not (lower_basic.iloc[i] > lower.iloc[i - 1] or c.iloc[i - 1] < lower.iloc[i - 1]):
            lower.iloc[i] = lower.iloc[i - 1]
        if not (upper_basic.iloc[i] < upper.iloc[i - 1] or c.iloc[i - 1] > upper.iloc[i - 1]):
            upper.iloc[i] = upper.iloc[i - 1]
        bullish = c.iloc[i] >= lower.iloc[i] if bullish else c.iloc[i] > upper.iloc[i]
    return (lower.iloc[-1] if bullish else upper.iloc[-1]), (1 if bullish else -1)


# --- local indicator math --------------------------------------------------------------

@pytest.mark.parametrize("length", [7, 14, 21])
def test_rsi_matches_wilder_reference(length):
    df = _random_walk()
    assert rsi_last(df["Close"], length) == pytest.approx(_reference_rsi(df["Close"], length), rel=1e-12)


def test_rsi_edge_cases():
    rising = pd.Series(np.arange(1.0, 40.0))
    assert rsi_last(rising, 14) == 100.0
    assert rsi_last(pd.Series([5.0] * 30), 14) is None  # no movement: undefined, not 0 or 50
    assert rsi_last(pd.Series([1.0, 2.0, 3.0]), 14) is None  # not enough bars


def test_sma_ema_macd_match_pandas_reference():
    close = _random_walk()["Close"]
    assert sma_last(close, 50) == pytest.approx(close.tail(50).mean())
    assert ema_last(close, 20) == pytest.approx(close.ewm(span=20, adjust=False).mean().iloc[-1])
    macd = close.ewm(span=12, adjust=False).mean() - close.ewm(span=26, adjust=False).mean()
    signal = macd.ewm(span=9, adjust=False).mean()
    result = macd_last(close)
    assert result is not None
    assert result["macd"] == pytest.approx(macd.iloc[-1])
    assert result["signal"] == pytest.approx(signal.iloc[-1])
    assert result["histogram"] == pytest.approx(macd.iloc[-1] - signal.iloc[-1])
    assert sma_last(close.head(10), 50) is None


def test_bollinger_uses_population_standard_deviation():
    close = _random_walk()["Close"]
    window = close.tail(20)
    result = bollinger_last(close, 20)
    assert result is not None
    assert result["middle"] == pytest.approx(window.mean())
    assert result["upper"] == pytest.approx(window.mean() + 2 * window.std(ddof=0))
    assert result["lower"] == pytest.approx(window.mean() - 2 * window.std(ddof=0))


def test_slow_stochastic_14_3_3():
    df = _random_walk()
    low14, high14 = df["Low"].rolling(14).min(), df["High"].rolling(14).max()
    k = (100 * (df["Close"] - low14) / (high14 - low14)).rolling(3).mean()
    result = stochastic_last(df)
    assert result is not None
    assert result["k"] == pytest.approx(k.iloc[-1])
    assert result["d"] == pytest.approx(k.rolling(3).mean().iloc[-1])


@pytest.mark.parametrize("seed", [1, 7, 42])
def test_supertrend_matches_reference_implementation(seed):
    df = _random_walk(seed=seed)
    result = supertrend_last(df)
    value, direction = _reference_supertrend(df)
    assert result is not None
    assert result["value"] == pytest.approx(value)
    assert result["direction"] == direction


def test_supertrend_direction_follows_trend():
    up = pd.DataFrame({"High": np.arange(101.0, 161.0), "Low": np.arange(99.0, 159.0), "Close": np.arange(100.0, 160.0)})
    down = up[::-1].reset_index(drop=True)
    assert supertrend_last(up)["direction"] == 1
    assert supertrend_last(up)["value"] < 160.0  # line below price in an uptrend
    assert supertrend_last(down)["direction"] == -1


def test_classic_pivots():
    pivots = classic_pivots(294.0, 282.5, 293.5)
    assert pivots == pytest.approx(
        {"pivot": 290.0, "r1": 297.5, "r2": 301.5, "r3": 309.0, "s1": 286.0, "s2": 278.5, "s3": 274.5}
    )


def test_pivots_use_previous_completed_session():
    index = pd.DatetimeIndex(["2026-09-18 09:00", "2026-09-21 09:00", "2026-09-22 09:00"], tz=ISTANBUL_TZ)
    frame = pd.DataFrame({"High": [1.0, 2.0, 3.0], "Low": [0.5, 1.5, 2.5], "Close": [0.8, 1.8, 2.8]}, index=index)

    during_session = pivot_source_bar(frame, datetime(2026, 9, 22, 14, 0, tzinfo=ISTANBUL_TZ))
    after_close = pivot_source_bar(frame, datetime(2026, 9, 22, 19, 0, tzinfo=ISTANBUL_TZ))
    weekend = pivot_source_bar(frame.iloc[:1], datetime(2026, 9, 20, 12, 0, tzinfo=ISTANBUL_TZ))

    assert during_session is not None and during_session[0].date().isoformat() == "2026-09-21"
    assert during_session[1]["High"] == 2.0
    assert after_close is not None and after_close[0].date().isoformat() == "2026-09-22"
    assert weekend is not None and weekend[0].date().isoformat() == "2026-09-18"  # Friday's session
    assert pivot_source_bar(frame.iloc[2:], datetime(2026, 9, 22, 14, 0, tzinfo=ISTANBUL_TZ)) is None


def test_last_golden_and_death_cross_events():
    index = pd.bdate_range("2024-01-01", periods=600, tz=ISTANBUL_TZ)
    down, up = np.linspace(200, 100, 300), np.linspace(100, 260, 300)
    cross = last_ma_cross(pd.Series(np.concatenate([down, up]), index=index))
    assert cross is not None and cross["type"] == "golden"
    assert 0 < cross["bars_ago"] < 300

    inverted = last_ma_cross(pd.Series(np.concatenate([up, down]), index=index))
    assert inverted is not None and inverted["type"] == "death"
    assert last_ma_cross(pd.Series(np.linspace(100, 200, 600), index=index)) is None


# --- TradingView rating ---------------------------------------------------------------

@pytest.mark.parametrize(
    ("score", "label"),
    [(-0.51, "STRONG_SELL"), (-0.5, "SELL"), (-0.11, "SELL"), (-0.1, "NEUTRAL"), (0.0, "NEUTRAL"), (0.1, "NEUTRAL"),
     (0.11, "BUY"), (0.5, "BUY"), (0.51, "STRONG_BUY"), (None, "NEUTRAL")],
)
def test_rating_thresholds_match_tradingview(score, label):
    assert rating_label(score) == label


def _raw(**overrides):
    raw = {
        "Recommend.All": 0.0212, "Recommend.MA": 0.1333, "Recommend.Other": -0.0909,
        "RSI": 51.0, "RSI[1]": 49.0, "Stoch.K": 71.0, "Stoch.D": 61.0, "Stoch.K[1]": 65.0, "Stoch.D[1]": 50.0,
        "CCI20": 6.0, "CCI20[1]": -60.0, "ADX": 23.0, "ADX+DI": 18.0, "ADX-DI": 32.0, "ADX+DI[1]": 14.0,
        "ADX-DI[1]": 34.0, "AO": -14.5, "AO[1]": -16.1, "AO[2]": -15.0, "Mom": -5.75, "Mom[1]": -3.0,
        "MACD.macd": -4.33, "MACD.signal": -4.75, "Rec.Stoch.RSI": 0, "Stoch.RSI.K": 81.0, "Rec.WR": 0, "W.R": -15.0,
        "Rec.BBPower": 0, "BBPower": 5.1, "Rec.UO": 0, "UO": 54.7, "close": 299.25,
        "Rec.Ichimoku": 0, "Ichimoku.BLine": 285.4, "Rec.VWMA": 1, "VWMA": 295.7, "Rec.HullMA9": 1, "HullMA9": 291.0,
        "BB.upper": 313.6, "BB.lower": 279.3, "BB.basis": 296.5,
    }
    for period, (ema, sma) in {5: (292.5, 288.1), 10: (292.6, 292.2), 20: (295.6, 296.5), 30: (298.6, 298.7),
                               50: (302.9, 305.7), 100: (306.2, 309.6), 200: (305.3, 303.8)}.items():
        raw[f"EMA{period}"], raw[f"SMA{period}"] = ema, sma
    raw.update(overrides)
    return raw


def test_overall_rating_is_tradingviews_not_the_pooled_vote_count():
    signals = build_signals("THYAO", "1d", _raw())

    # 17-vs-11 pooled counting (borsapy) would say BUY; TradingView averages the two groups: 0.021 -> NEUTRAL.
    assert signals["summary"]["recommendation"] == "NEUTRAL"
    assert signals["summary"]["score"] == pytest.approx(0.0212)
    assert signals["moving_averages"]["recommendation"] == "BUY"
    assert signals["oscillators"]["recommendation"] == "NEUTRAL"
    assert signals["interval"] == "1d" and signals["symbol"] == "THYAO"


def test_moving_average_votes_follow_tradingview_rules():
    ma = build_signals("THYAO", "1d", _raw())["moving_averages"]

    assert "EMA5" not in ma["compute"] and "SMA5" not in ma["compute"]  # published, but not rated
    assert ma["values"]["EMA5"] == 292.5
    assert len(ma["compute"]) == 15
    # TradingView's MA rating == (buy - sell) / n
    assert (ma["buy"] - ma["sell"]) / len(ma["compute"]) == pytest.approx(0.1333, abs=1e-4)
    assert ma["values"]["BB.middle"] == 296.5


def test_ratings_fall_back_to_group_means_without_tradingview_scores():
    raw = _raw(**{"Recommend.All": None, "Recommend.MA": None, "Recommend.Other": None})
    signals = build_signals("THYAO", "1d", raw)
    ma, osc = signals["moving_averages"], signals["oscillators"]

    assert ma["score"] == pytest.approx((ma["buy"] - ma["sell"]) / 15, abs=1e-4)
    assert signals["summary"]["score"] == pytest.approx((ma["score"] + osc["score"]) / 2, abs=1e-4)


@pytest.mark.parametrize(
    ("overrides", "indicator", "expected"),
    [
        ({"RSI": 28.0, "RSI[1]": 25.0}, "RSI", "BUY"),
        ({"RSI": 28.0, "RSI[1]": 31.0}, "RSI", "NEUTRAL"),
        ({"RSI": 75.0, "RSI[1]": 78.0}, "RSI", "SELL"),
        ({"MACD.macd": 1.0, "MACD.signal": 0.5}, "MACD", "BUY"),
        ({"Mom": 2.0, "Mom[1]": 3.0}, "Mom", "SELL"),
        ({"ADX": 25.0, "ADX+DI": 30.0, "ADX-DI": 20.0, "ADX+DI[1]": 19.0, "ADX-DI[1]": 21.0}, "ADX", "BUY"),
        ({"Rec.UO": -1}, "UO", "SELL"),
    ],
)
def test_oscillator_votes(overrides, indicator, expected):
    assert build_signals("THYAO", "1d", _raw(**overrides))["oscillators"]["compute"][indicator] == expected


def test_timeframe_without_data_is_reported_not_rated_neutral():
    empty = {key: None for key in _raw()}
    result = build_signals("NEWCO", "1M", empty)
    assert "error" in result and "summary" not in result
