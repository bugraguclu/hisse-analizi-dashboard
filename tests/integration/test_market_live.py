"""Integration: market store sources (TradingView vs İş Yatırım) agree on real data.

Network required; skipped with SKIP_NETWORK_TESTS=1.
"""

import os
from datetime import date, timedelta

import pytest

HAS_NETWORK = os.environ.get("SKIP_NETWORK_TESTS") != "1"
pytestmark = [pytest.mark.integration, pytest.mark.skipif(not HAS_NETWORK, reason="Network tests disabled")]


@pytest.fixture(autouse=True)
def _fresh_client(monkeypatch):
    from src.adapters import utils

    utils.adapter_cache.clear()
    monkeypatch.setattr(utils, "_http_client", None)  # loop-bound shared client
    yield
    utils.adapter_cache.clear()


async def test_isyatirim_unadjusted_closes_match_tradingview_after_the_last_corporate_action():
    from src.adapters.isyatirim_prices import fetch_daily_history
    from src.adapters.price import _load_bars

    end = date.today()
    rows = await fetch_daily_history("GARAN", end - timedelta(days=20), end)
    assert rows, "İş Yatırım returned no sessions"
    frame = await _load_bars("GARAN", "1mo", "1d")
    tv = {ts.date(): close for ts, close in frame["Close"].items()}
    compared = [(r.close, tv[r.bar_date]) for r in rows if r.bar_date in tv]
    assert len(compared) >= 5
    for isy_close, tv_close in compared:
        assert isy_close == pytest.approx(tv_close, rel=1e-4)
    # Volumes: TradingView lots ≈ İş Yatırım TL turnover / VWAP.
    vols = {ts.date(): v for ts, v in frame["Volume"].items()}
    ratios = [vols[r.bar_date] / r.lots for r in rows if r.bar_date in vols and r.lots]
    assert sorted(ratios)[len(ratios) // 2] == pytest.approx(1.0, abs=0.01)


async def test_isyatirim_quote_covers_indices_missing_from_the_scanner():
    from src.adapters.isyatirim_prices import fetch_quote

    quote = await fetch_quote("XUSIN")
    assert quote["last"] > 0 and quote["prev_close"] > 0
    assert quote["quote_time"] is not None
