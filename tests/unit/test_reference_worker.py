"""reference_worker scheduling helpers (no DB/network: collaborators are monkeypatched)."""

import asyncio
from datetime import datetime, time
from zoneinfo import ZoneInfo

from src.workers import reference_worker as rw

IST = ZoneInfo("Europe/Istanbul")


def test_next_daily_run():
    at = time(7, 30)
    assert rw.next_daily_run(datetime(2026, 9, 23, 6, 0, tzinfo=IST), at) == datetime(2026, 9, 23, 7, 30, tzinfo=IST)
    assert rw.next_daily_run(datetime(2026, 9, 23, 7, 30, tzinfo=IST), at) == datetime(2026, 9, 24, 7, 30, tzinfo=IST)
    assert rw.next_daily_run(datetime(2026, 9, 23, 22, 0, tzinfo=IST), at) == datetime(2026, 9, 24, 7, 30, tzinfo=IST)


def test_parse_hhmm():
    assert rw.parse_hhmm("07:30") == time(7, 30)
    assert rw.parse_hhmm("7:05") == time(7, 5)
    assert rw.parse_hhmm("sabah") == time(7, 30)


async def test_refresh_tick_batches_and_backs_off_failed_companies(monkeypatch):
    refreshed: list[str] = []

    async def due(limit):
        return ["AAA", "BBB", "CCC"]

    async def refresh(ticker):
        refreshed.append(ticker)
        return {"ticker": ticker, "complete": ticker != "AAA"}

    monkeypatch.setattr(rw, "due_core_tickers", due)
    monkeypatch.setattr(rw, "refresh_company", refresh)
    monkeypatch.setattr(rw.settings, "reference_batch_size", 2)
    monkeypatch.setattr(rw.settings, "reference_company_delay_seconds", 0.0)
    retry_after: dict[str, float] = {}
    stop = asyncio.Event()

    await rw.refresh_tick(stop, retry_after)
    assert sorted(refreshed) == ["AAA", "BBB"] and set(retry_after) == {"AAA"}

    refreshed.clear()
    await rw.refresh_tick(stop, retry_after)  # AAA waits REFERENCE_RETRY_FAILED_HOURS
    assert sorted(refreshed) == ["BBB", "CCC"]


async def test_refresh_many_respects_concurrency_and_survives_failures(monkeypatch):
    running = 0
    peak = 0

    async def refresh(ticker):
        nonlocal running, peak
        running += 1
        peak = max(peak, running)
        await asyncio.sleep(0.01)
        running -= 1
        if ticker == "BAD":
            raise RuntimeError("boom")
        return {"ticker": ticker, "complete": True}

    monkeypatch.setattr(rw, "refresh_company", refresh)
    results = await rw.refresh_many(["A", "B", "BAD", "C"], concurrency=2, delay_seconds=0)

    assert peak == 2
    assert [r["ticker"] for r in results] == ["A", "B", "BAD", "C"]
    assert results[2]["complete"] is False and "boom" in results[2]["error"]


async def test_refresh_many_skips_after_stop(monkeypatch):
    async def refresh(ticker):
        raise AssertionError("must not run after stop")

    monkeypatch.setattr(rw, "refresh_company", refresh)
    stop = asyncio.Event()
    stop.set()

    results = await rw.refresh_many(["A"], stop=stop, delay_seconds=0)

    assert results == [{"ticker": "A", "skipped": "shutdown"}]


async def test_reference_loop_runs_startup_sync_and_stops(monkeypatch):
    events: list[str] = []
    stop = asyncio.Event()

    async def due(stale_after):
        return True

    async def sync():
        events.append("sync")
        return {}

    async def tick(stop_event, retry_after):
        events.append("tick")
        stop_event.set()
        return []

    monkeypatch.setattr(rw, "universe_sync_due", due)
    monkeypatch.setattr(rw, "run_universe_sync", sync)
    monkeypatch.setattr(rw, "refresh_tick", tick)
    monkeypatch.setattr(rw.settings, "reference_worker_enabled", True)

    await asyncio.wait_for(rw.reference_loop(stop), timeout=5)

    assert events == ["sync", "tick"]
