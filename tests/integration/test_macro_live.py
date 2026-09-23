"""Live smoke tests for src.adapters.tcmb_adapter against the real tcmb.gov.tr.

Network required; skipped with SKIP_NETWORK_TESTS=1 (see tests/integration/test_borsapy_live.py).
These do not touch the database — only confirm the scraper still matches the
real page structure (catches a TCMB markup change before the worker does).
"""

import os
from datetime import date, timedelta

import pytest

from src.adapters import tcmb_adapter as t

HAS_NETWORK = os.environ.get("SKIP_NETWORK_TESTS") != "1"
pytestmark = [pytest.mark.integration, pytest.mark.skipif(not HAS_NETWORK, reason="Network tests disabled")]


@pytest.fixture(autouse=True)
def _fresh_http_client(monkeypatch):
    # pytest-asyncio runs every test on a new event loop; the shared client is loop-bound
    # (see tests/integration/test_borsapy_live.py's identical fixture).
    from src.adapters import utils

    monkeypatch.setattr(utils, "_http_client", None)
    yield


async def test_fetch_rate_history_all_three_types_are_ascending_with_recent_data():
    for rate_type in ("policy", "overnight", "late_liquidity"):
        rows = await t.fetch_rate_history(rate_type)
        assert len(rows) > 10
        dates = [r.observation_date for r in rows]
        assert dates == sorted(dates)  # strictly ascending (oldest -> newest)
        assert rows[-1].lending is not None and rows[-1].lending > 0
        # TCMB has not gone more than ~a year without a rate decision in recent history.
        assert rows[-1].observation_date > date.today() - timedelta(days=400)


async def test_fetch_cpi_history_is_descending_with_recent_data():
    rows = await t.fetch_cpi_history()
    assert len(rows) > 100
    dates = [r.observation_date for r in rows]
    assert dates == sorted(dates, reverse=True)  # newest first
    assert rows[0].yoy is not None
    assert rows[0].observation_date > date.today() - timedelta(days=100)


async def test_fetch_ppi_history_coalesces_to_a_continuous_series():
    rows = await t.fetch_ppi_history()
    assert len(rows) > 100
    # The most recent ~10 years should all have a yoy value (post Yİ-ÜFE cut-over).
    recent = [r for r in rows if r.observation_date > date.today() - timedelta(days=3650)]
    assert all(r.yoy is not None for r in recent)


async def test_fetch_fx_bulletin_today_has_major_currencies():
    bulletin = await t.fetch_fx_bulletin(None)
    assert bulletin is not None
    assert bulletin.bulletin_date <= date.today()
    for code in ("USD", "EUR", "GBP"):
        assert code in bulletin.rates
        assert bulletin.rates[code]["forex_selling"] > 0


async def test_fetch_fx_bulletin_weekend_or_holiday_is_none_not_fabricated():
    # Walk back to the most recent Sunday — TCMB never publishes on a Sunday.
    day = date.today()
    while day.weekday() != 6:
        day -= timedelta(days=1)
    bulletin = await t.fetch_fx_bulletin(day)
    assert bulletin is None
