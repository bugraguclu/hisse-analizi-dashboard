"""Integration: two years of recorded TradingView closes vs İş Yatırım's official daily series.

The frozen fixture (``tests/fixtures/recorded_history.json``) holds 501 split-adjusted daily
TradingView bars per company up to 23 Nov 2026. İş Yatırım's ``HG_KAPANIS`` is the close as
traded (unadjusted), so every recorded close must equal it × one capital-change factor, and that
factor may only change at a bonus issue — as measured on 24 Nov 2026: 3,507/3,507 bars, BIMAS
×0.5 before its May 2026 bonus issue, EREGL ×0.5 before late November 2024, all others ×1.

Network required; skipped with SKIP_NETWORK_TESTS=1.
"""

import json
import os
from datetime import date
from pathlib import Path

import pytest

HAS_NETWORK = os.environ.get("SKIP_NETWORK_TESTS") != "1"
pytestmark = [pytest.mark.integration, pytest.mark.skipif(not HAS_NETWORK, reason="Network tests disabled")]

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "recorded_history.json"
#: bonus issues inside the recorded window: recorded close ÷ official close before the issue
BONUS_ISSUES = {"BIMAS": 0.5, "EREGL": 0.5}


@pytest.fixture(autouse=True)
def _fresh_client(monkeypatch):
    from src.adapters import utils

    utils.adapter_cache.clear()
    monkeypatch.setattr(utils, "_http_client", None)  # loop-bound shared client
    yield
    utils.adapter_cache.clear()


async def test_recorded_closes_equal_the_official_closes_up_to_one_bonus_issue_factor():
    from src.adapters.isyatirim_prices import fetch_daily_history

    tickers = json.loads(FIXTURE.read_text(encoding="utf-8"))["tickers"]
    for ticker, company in tickers.items():
        bars = company["history_1y"]["warmup"] + company["history_1y"]["data"]
        first, last = date.fromisoformat(bars[0][0][:10]), date.fromisoformat(bars[-1][0][:10])
        official = {row.bar_date: row.close for row in await fetch_daily_history(ticker, first, last)}

        factors: list[float] = []
        for bar in bars:
            close = official.get(date.fromisoformat(bar[0][:10]))
            assert close, (ticker, bar[0])  # İş Yatırım has every session TradingView has
            ratio = bar[4] / close
            assert ratio in (pytest.approx(1.0, abs=1e-9), pytest.approx(BONUS_ISSUES.get(ticker, 1.0), abs=1e-9)), (
                ticker, bar[0], bar[4], close,
            )
            factors.append(round(ratio, 6))
        # the factor changes at most once, from the pre-issue factor to 1 (TradingView adjusts backwards)
        changes = [i for i in range(1, len(factors)) if factors[i] != factors[i - 1]]
        assert len(changes) <= 1, ticker
        assert factors[-1] == 1.0, ticker
        if ticker in BONUS_ISSUES:
            assert changes and factors[0] == BONUS_ISSUES[ticker], ticker
