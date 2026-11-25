"""Historical regression tests on real recorded data (seven BIST companies, 23 Nov 2026).

``tests/fixtures/recorded_history.json`` is a frozen copy of API responses recorded from the
running platform (``scripts/freeze_recorded_fixture.py``): 501 daily TradingView bars per
company, the indicator values the API served for them, KAP/İş Yatırım income statements and
balance sheets (cumulative and single-quarter), the live-ratios card and the quote strip.

Three kinds of check:

* **our code re-run on the recorded inputs** reproduces the recorded outputs (indicators,
  single quarters) — a calculation change that moves a served number fails here;
* **an independent reference implementation** written in this file (plain Python, no
  pandas, textbook definitions) agrees with them — so the code is not only stable but right;
* **cross-payload invariants** of the recorded data itself (TTM = the four quarters, P/E =
  market cap ÷ TTM parent net income, balance sheet identity, 1-month window ⊂ 1-year
  window, one USD/TRY rate per date).
"""

from __future__ import annotations

import json
import math
import statistics
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any

import pandas as pd
import pytest

from src.adapters import technical
from src.adapters.financial_adapter import discrete_quarter_values
from src.adapters.price import ISTANBUL_TZ

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "recorded_history.json"
TICKERS = ("THYAO", "GARAN", "ASELS", "BIMAS", "KCHOL", "SISE", "EREGL")
#: holdings (KCHOL, SISE) report a financial-sector revenue line too; their revenue is the total
REVENUE_ROWS = ("Toplam Hasılat", "Hasılat")
PARENT_NI_ROW = "Dönem Kârının (Zararının) Dağılımı, Ana Ortaklık Payları"


@lru_cache(maxsize=1)
def _fixture() -> dict[str, Any]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _company(ticker: str) -> dict[str, Any]:
    return _fixture()["tickers"][ticker]


def _frame(rows: list[list[Any]]) -> pd.DataFrame:
    index = pd.DatetimeIndex([pd.Timestamp(r[0]) for r in rows]).tz_convert(ISTANBUL_TZ)
    return pd.DataFrame(
        {"Open": [r[1] for r in rows], "High": [r[2] for r in rows], "Low": [r[3] for r in rows],
         "Close": [r[4] for r in rows], "Volume": [r[5] for r in rows]},
        index=index,
    )


def _daily(ticker: str) -> pd.DataFrame:
    history = _company(ticker)["history_1y"]
    return _frame(history["warmup"] + history["data"])


def _period_shift(period: str, months: int) -> str:
    year, month = map(int, period.split("/"))
    total = year * 12 + (month - 1) + months
    return f"{total // 12}/{total % 12 + 1:02d}"


def _revenue_row(rows: dict[str, dict[str, Any]]) -> dict[str, Any]:
    return next(rows[name] for name in REVENUE_ROWS if name in rows)


# ---------------------------------------------------------------------------
# Independent reference implementations (textbook definitions, plain Python)
# ---------------------------------------------------------------------------

def ref_sma(values: list[float], n: int) -> float:
    return sum(values[-n:]) / n


def ref_ema(values: list[float], n: int) -> list[float]:
    alpha, out = 2 / (n + 1), [values[0]]
    for v in values[1:]:
        out.append(alpha * v + (1 - alpha) * out[-1])
    return out


def ref_rsi(values: list[float], n: int = 14) -> float:
    changes = [b - a for a, b in zip(values, values[1:])]
    gains, losses = [max(c, 0.0) for c in changes], [max(-c, 0.0) for c in changes]
    avg_gain, avg_loss = sum(gains[:n]) / n, sum(losses[:n]) / n
    for gain, loss in zip(gains[n:], losses[n:]):
        avg_gain, avg_loss = (avg_gain * (n - 1) + gain) / n, (avg_loss * (n - 1) + loss) / n
    return 100 - 100 / (1 + avg_gain / avg_loss)


def ref_stochastic(high: list[float], low: list[float], close: list[float]) -> tuple[float, float]:
    raw = [
        100 * (close[i] - min(low[i - 13:i + 1])) / (max(high[i - 13:i + 1]) - min(low[i - 13:i + 1]))
        for i in range(13, len(close))
    ]
    k = [sum(raw[i - 2:i + 1]) / 3 for i in range(2, len(raw))]
    return k[-1], sum(k[-3:]) / 3


def ref_supertrend(high: list[float], low: list[float], close: list[float], period: int = 10, mult: float = 3.0):
    tr = [high[0] - low[0]] + [
        max(h - lo, abs(h - c_prev), abs(lo - c_prev)) for h, lo, c_prev in zip(high[1:], low[1:], close)
    ]
    atr = [math.nan] * len(tr)
    atr[period - 1] = sum(tr[:period]) / period
    for i in range(period, len(tr)):
        atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period
    up = dn = None
    trend_up = False
    for i in range(period - 1, len(close)):
        mid = (high[i] + low[i]) / 2
        b_up, b_dn = mid + mult * atr[i], mid - mult * atr[i]
        if up is None:
            up, dn = b_up, b_dn
            continue
        new_dn = b_dn if b_dn > dn or close[i - 1] < dn else dn
        new_up = b_up if b_up < up or close[i - 1] > up else up
        trend_up = close[i] > new_up if not trend_up else not close[i] < new_dn
        up, dn = new_up, new_dn
    return (dn if trend_up else up), (1 if trend_up else -1)


# ---------------------------------------------------------------------------
# Technical indicators: recorded output == our code on the recorded bars == reference
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module", autouse=True)
def _require_fixture():
    if not FIXTURE.exists():
        pytest.skip("recorded history fixture missing (scripts/freeze_recorded_fixture.py)")


def test_fixture_covers_the_recorded_session():
    assert _fixture()["_recorded_as_of"] == "2026-11-23"
    for ticker in TICKERS:
        daily = _daily(ticker)
        assert len(daily) == 501
        assert daily.index[-1].date() == date(2026, 11, 23)


@pytest.mark.parametrize("ticker", TICKERS)
def test_moving_averages_match_recorded_values_and_the_reference(ticker):
    close = _daily(ticker)["Close"]
    values = [float(x) for x in close]
    recorded = _company(ticker)["technical"]["moving-averages"]
    for n in (10, 20, 50, 100, 200):
        ours = technical.sma_last(close, n)
        assert ours == pytest.approx(ref_sma(values, n), rel=1e-12)
        assert ours == pytest.approx(recorded["sma"][f"sma_{n}"], abs=6e-5)  # served with 4 decimals
    for n in (10, 20, 50, 100, 200):
        assert technical.ema_last(close, n) == pytest.approx(ref_ema(values, n)[-1], rel=1e-12)
    for n in (10, 20, 50):
        assert technical.ema_last(close, n) == pytest.approx(recorded["ema"][f"ema_{n}"], abs=6e-5)
    # EMA is seeded with the first stored bar and the store reaches further back than the 501
    # recorded bars: only the seed's residual weight differs — (99/101)^500 ≈ 4e-5 for EMA 100,
    # (199/201)^500 ≈ 7e-3 for EMA 200.
    assert technical.ema_last(close, 100) == pytest.approx(recorded["ema"]["ema_100"], rel=2e-5)
    assert technical.ema_last(close, 200) == pytest.approx(recorded["ema"]["ema_200"], rel=2e-3)


@pytest.mark.parametrize("ticker", TICKERS)
def test_rsi_macd_bollinger_match_recorded_values_and_the_reference(ticker):
    close = _daily(ticker)["Close"]
    values = [float(x) for x in close]
    recorded = _company(ticker)["technical"]

    rsi = technical.rsi_last(close, 14)
    assert rsi == pytest.approx(ref_rsi(values), abs=1e-9)
    assert rsi == pytest.approx(recorded["rsi"]["value"], abs=6e-5)

    macd = technical.macd_last(close)
    assert macd is not None
    macd_line = [a - b for a, b in zip(ref_ema(values, 12), ref_ema(values, 26))]
    signal = ref_ema(macd_line, 9)[-1]
    assert macd["macd"] == pytest.approx(macd_line[-1], abs=1e-9)
    assert macd["signal"] == pytest.approx(signal, abs=1e-9)
    for key in ("macd", "signal", "histogram"):
        assert macd[key] == pytest.approx(recorded["macd"]["data"][key], abs=2e-4)

    bands = technical.bollinger_last(close)
    assert bands is not None
    mid, sd = ref_sma(values, 20), statistics.pstdev(values[-20:])
    assert bands["middle"] == pytest.approx(mid, rel=1e-12)
    assert bands["upper"] == pytest.approx(mid + 2 * sd, rel=1e-12)
    for key in ("upper", "middle", "lower"):
        assert bands[key] == pytest.approx(recorded["bollinger"]["data"][key], abs=6e-5)


@pytest.mark.parametrize("ticker", TICKERS)
def test_stochastic_and_supertrend_match_recorded_values_and_the_reference(ticker):
    frame = _daily(ticker)
    high, low, close = (list(map(float, frame[c])) for c in ("High", "Low", "Close"))
    recorded = _company(ticker)["technical"]

    stoch = technical.stochastic_last(frame)
    assert stoch is not None
    k, d = ref_stochastic(high, low, close)
    assert stoch["k"] == pytest.approx(k, abs=1e-9) and stoch["d"] == pytest.approx(d, abs=1e-9)
    assert stoch["k"] == pytest.approx(recorded["stochastic"]["data"]["k"], abs=6e-5)
    assert stoch["d"] == pytest.approx(recorded["stochastic"]["data"]["d"], abs=6e-5)

    trend = technical.supertrend_last(frame)
    assert trend is not None
    line, direction = ref_supertrend(high, low, close)
    assert trend["value"] == pytest.approx(line, rel=1e-9) and trend["direction"] == direction
    # ATR's Wilder seed decays like (9/10)^n: after 490 bars it is far below a kuruş
    assert trend["value"] == pytest.approx(recorded["supertrend"]["data"]["value"], abs=6e-4)
    assert trend["direction"] == recorded["supertrend"]["data"]["direction"]


# ---------------------------------------------------------------------------
# Financial statements: single quarters, TTM, balance sheet identity
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("ticker", TICKERS)
def test_single_quarters_are_reproduced_from_the_cumulative_figures(ticker):
    """Q1 = YTD; Q4 = FY − 9M; Q2/Q3 = YTD − previous YTD (plain-difference reporters)."""
    income = _company(ticker)["income_quarterly"]
    fye = income["fiscal_year_end_month"] or 12
    plain = income["discrete_basis"] == "ytd_difference"
    checked = 0
    for item, cumulative in income["data"].items():
        discrete = income["discrete"].get(item) or {}
        # IAS 29 reporters' Q2/Q3 need the CPI factors (not in the fixture): {} leaves them None
        ours = discrete_quarter_values(cumulative, fye, None if plain else {})
        for period, served in discrete.items():
            if served is None or ours.get(period) is None:
                continue
            assert ours[period] == pytest.approx(served, rel=1e-9, abs=1.0), (ticker, item, period)
            checked += 1
    if ticker == "GARAN":
        assert checked == 0  # bank template: no industrial income rows in the fixture
        return
    assert checked >= 8, ticker


@pytest.mark.parametrize("ticker", TICKERS)
def test_ttm_flows_are_the_sum_of_the_last_four_quarters(ticker):
    company = _company(ticker)
    live = company["live_ratios"]
    if live["basis"] != "ttm":
        pytest.skip(f"{ticker}: annual basis")
    quarters = live["ttm_quarters"]
    assert quarters == [_period_shift(live["as_of"], -9 + 3 * i) for i in range(4)]
    discrete = company["income_quarterly"]["discrete"]
    pairs = [("revenue", REVENUE_ROWS), ("net_income_parent", (PARENT_NI_ROW,))]
    checked = 0
    for key, rows in pairs:
        row = next((discrete[name] for name in rows if name in discrete), None)
        served = (live["ttm"] or {}).get(key)
        if row is None or served is None or any(row.get(q) is None for q in quarters):
            continue
        assert sum(row[q] for q in quarters) == pytest.approx(served, rel=1e-9), (ticker, key)
        checked += 1
    assert checked >= 1, ticker


@pytest.mark.parametrize("ticker", TICKERS)
def test_plain_ttm_is_ytd_plus_last_year_minus_prior_ytd(ticker):
    """TTM(P) = YTD(P) + FY(previous) − YTD(P − 12 months), on the KAP cumulative figures."""
    company = _company(ticker)
    live = company["live_ratios"]
    if live["ttm_method"] != "ytd_difference" or live["basis"] != "ttm":
        pytest.skip(f"{ticker}: {live['ttm_method']}")
    period = live["as_of"]
    year, _ = map(int, period.split("/"))
    cumulative = company["income_quarterly"]["data"]
    revenue = _revenue_row(cumulative)
    expected = revenue[period] + revenue[f"{year - 1}/12"] - revenue[_period_shift(period, -12)]
    assert live["ttm"]["revenue"] == pytest.approx(expected, rel=1e-12)


def test_thyao_ttm_golden_values():
    """Pinned by hand from KAP (THYAO 2026/09, million TL): 981,030 + 955,472 − 690,825."""
    live = _company("THYAO")["live_ratios"]
    assert live["ttm"]["revenue"] == 1_245_677_000_000
    assert live["ttm"]["ebitda"] == live["ttm"]["operating_profit"] + live["ttm"]["depreciation_amortization"]
    assert live["ratios"]["pe_ratio"] == 3.77  # 442,980 mn / 117,474 mn


@pytest.mark.parametrize("ticker", TICKERS)
def test_annual_income_equals_the_q4_cumulative_figure(ticker):
    company = _company(ticker)
    annual, quarterly = company["income_annual"], company["income_quarterly"]["data"]
    checked = 0
    for item, by_year in annual.items():
        for period, value in by_year.items():
            q_value = (quarterly.get(item) or {}).get(period)
            if value is None or q_value is None:
                continue
            assert q_value == pytest.approx(value, rel=1e-12), (ticker, item, period)
            checked += 1
    assert checked >= 3, ticker


@pytest.mark.parametrize("ticker", TICKERS)
def test_balance_sheet_balances(ticker):
    rows = _company(ticker)["balance_quarterly"]
    assets = next((rows[n] for n in ("Toplam Varlıklar", "Varlıklar Toplamı", "Varlıklar") if n in rows), None)
    sources = next((rows[n] for n in ("Toplam Kaynaklar", "Yükümlülükler Toplamı", "Kaynaklar") if n in rows), None)
    liabilities = next((rows[n] for n in ("Toplam Yükümlülükler", "Yükümlülükler") if n in rows), None)
    equity = next((rows[n] for n in ("Toplam Özkaynaklar", "Özkaynaklar") if n in rows), None)
    checked = 0
    for period, total in (assets or {}).items():
        if sources is not None and total is not None and sources.get(period) is not None:
            assert total == pytest.approx(sources[period], abs=1.0), (ticker, period)
            checked += 1
        if None not in (total, (liabilities or {}).get(period), (equity or {}).get(period)):
            assert total == pytest.approx(liabilities[period] + equity[period], abs=1e6), (ticker, period)
            checked += 1
    if ticker in ("KCHOL", "SISE") and checked == 0:
        pytest.skip(f"{ticker}: the fixture holds no total-assets row")  # holdings' KAP labels
    assert checked >= 1, ticker


# ---------------------------------------------------------------------------
# Ratios and the quote strip
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("ticker", TICKERS)
def test_valuation_ratios_follow_from_the_served_inputs(ticker):
    live = _company(ticker)["live_ratios"]
    ratios, ttm, valuation = live["ratios"], live["ttm"] or {}, live["valuation"] or {}
    cap = valuation.get("market_cap")
    assert cap == pytest.approx(valuation["price"] * valuation["shares_outstanding"], rel=1e-12)
    if ttm.get("net_income_parent") and ttm["net_income_parent"] > 0:
        assert ratios["pe_ratio"] == round(cap / ttm["net_income_parent"], 2)
    if ttm.get("revenue"):
        assert ratios["ps_ratio"] == round(cap / ttm["revenue"], 2)
        for ratio, key in (("gross_margin", "gross_profit"), ("operating_margin", "operating_profit"),
                           ("ebitda_margin", "ebitda"), ("net_margin", "net_income")):
            if ttm.get(key) is not None:
                assert ratios[ratio] == round(ttm[key] / ttm["revenue"] * 100, 2), (ticker, ratio)
    if ttm.get("ebitda") and valuation.get("enterprise_value"):
        assert ratios["ev_ebitda"] == round(valuation["enterprise_value"] / ttm["ebitda"], 2)
        assert ratios["net_debt_ebitda"] == round(valuation["net_debt"] / ttm["ebitda"], 2)
        # EV − market cap − net debt = non-controlling interests: positive for the groups,
        # slightly negative for THYAO (−68 mn TL; its minority share of profit is negative too)
        minority = valuation["enterprise_value"] - cap - valuation["net_debt"]
        assert abs(minority) < valuation["enterprise_value"]


@pytest.mark.parametrize("ticker", TICKERS)
def test_stored_ttm_rows_cover_four_consecutive_quarters(ticker):
    """A TTM row lists the four quarters it sums — or none, and then no flow ratio at all
    (the oldest periods lack the prior-year comparatives; nothing is guessed)."""
    rows = [r for r in _company(ticker)["ratio_rows"] if r["basis"] == "ttm"]
    assert rows
    for row in rows:
        if not row["ttm_quarters"]:
            assert row["roe"] is None and row["net_margin"] is None and row["pe_ratio"] is None, row
            continue
        assert row["ttm_quarters"] == [_period_shift(row["period"], -9 + 3 * i) for i in range(4)], row


@pytest.mark.parametrize("ticker", TICKERS)
def test_quote_strip_change_and_market_cap(ticker):
    info = _company(ticker)["fast_info"]
    last, previous = info["last_price"], info["previous_close"]
    assert info["change"] == pytest.approx(last - previous, abs=1e-6)
    assert info["change_percent"] == round((last - previous) / previous * 100, 2)
    assert info["day_low"] <= last <= info["day_high"]
    if info.get("shares_source") == "isyatirim_capital":  # exact capital, shares shown rounded to a lot
        assert info["market_cap"] == pytest.approx(last * info["shares"], rel=1e-9)


# ---------------------------------------------------------------------------
# Price series: one series per symbol, windows and the USD view agree
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("ticker", TICKERS)
def test_daily_series_is_clean(ticker):
    daily = _daily(ticker)
    assert daily.index.is_monotonic_increasing and not daily.index.duplicated().any()
    assert all(ts.weekday() < 5 for ts in daily.index)
    assert (daily["Low"] <= daily[["Open", "Close"]].min(axis=1)).all()
    assert (daily["High"] >= daily[["Open", "Close"]].max(axis=1)).all()
    assert (daily["Close"] > 0).all() and (daily["Volume"] >= 0).all()


@pytest.mark.parametrize("ticker", TICKERS)
def test_one_month_window_is_the_tail_of_the_one_year_series(ticker):
    company = _company(ticker)
    year = {r[0]: r for r in company["history_1y"]["warmup"] + company["history_1y"]["data"]}
    month = company["history_1mo"]["data"]
    assert month and all(year.get(r[0]) == r for r in month)
    # the period-change base is the last close strictly before the window
    first = company["history_1y"]["data"][0][0]
    before = max(d for d in year if d < first)
    assert company["history_1y"]["reference_close"] == year[before][4]
    assert company["history_1y"]["reference_date"] == before[:10]


def test_usd_view_divides_every_ticker_by_the_same_rate_per_date():
    implied: dict[str, set[float]] = {}
    for ticker in TICKERS:
        company = _company(ticker)
        closes = {r[0]: r[4] for r in company["history_1y"]["data"]}
        usd = company["history_usd_3mo"]
        for day, usd_close in usd["data"]:
            if day in closes:
                implied.setdefault(day, set()).add(round(closes[day] / usd_close, 6))
        last_day, last_usd = usd["data"][-1]
        assert closes[last_day] / last_usd == pytest.approx(usd["fx"]["rate"], rel=1e-9)
    # EREGL was recorded minutes later (a newer FX tick for the last bar only)
    spread = [max(v) / min(v) - 1 for day, v in sorted(implied.items())[:-1]]
    assert max(spread) < 1e-6
    assert all(40 < min(v) < 60 for v in implied.values())  # USD/TRY in late 2026


#: TÜİK official monthly CPI changes (%), the three months of each re-expressed quarter.
TUIK_CPI_MOM = {
    "2024/06": (3.18, 3.37, 1.64),
    "2024/09": (3.23, 2.47, 2.97),
    "2025/06": (3.00, 1.53, 1.37),
    "2025/09": (2.06, 2.04, 3.23),
}


def test_ias29_single_quarters_use_one_cpi_factor_per_quarter_matching_tuik():
    """IAS 29 reporters: Q2/Q3 = YTD − previous YTD × CPI(q end) / CPI(previous q end).

    Backing the factor out of every served single quarter (all items, all four IAS 29
    reporters) must give *one* number per quarter — CPI is common to every company — and
    that number is the product of TÜİK's three monthly changes (2024/06: 1.0318 × 1.0337 ×
    1.0164 = 1.08406).
    """
    implied: dict[str, list[float]] = {}
    for ticker in TICKERS:
        income = _company(ticker)["income_quarterly"]
        if income["discrete_basis"] != "ias29_three_month":
            continue
        for item, cumulative in income["data"].items():
            for period, single in (income["discrete"].get(item) or {}).items():
                if single is None or period.endswith(("/03", "/12")):
                    continue
                previous, ytd = cumulative.get(_period_shift(period, -3)), cumulative.get(period)
                if previous is None or ytd is None or abs(previous) < 1e9:  # tiny bases: rounding noise
                    continue
                implied.setdefault(period, []).append((ytd - single) / previous)
    assert {"2024/06", "2024/09", "2025/06", "2025/09", "2026/06", "2026/09"} <= set(implied)
    for period, factors in implied.items():
        assert len(factors) >= 15, period
        assert max(factors) - min(factors) < 1e-6, period
        assert 1.0 < factors[0] < 1.2, period
    for period, changes in TUIK_CPI_MOM.items():
        expected = math.prod(1 + c / 100 for c in changes)
        assert implied[period][0] == pytest.approx(expected, abs=5e-5), period  # TÜİK rounds to 0.01 pt


def test_ias29_cpi_factor_is_reproduced_by_our_quarter_factor_code():
    from src.adapters.financial_adapter import cpi_quarter_factors

    monthly = {f"{p[:4]}-{int(p[5:]) - 2 + i:02d}-01": c for p, cs in TUIK_CPI_MOM.items() for i, c in enumerate(cs)}
    factors = cpi_quarter_factors(monthly)
    for period, changes in TUIK_CPI_MOM.items():
        assert factors[period] == pytest.approx(math.prod(1 + c / 100 for c in changes), rel=1e-12)
