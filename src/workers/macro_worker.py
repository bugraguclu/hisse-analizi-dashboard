"""Macro worker — TCMB rates/corridor, TÜFE/ÜFE, FX bulletins → the macro store.

Schedules (Europe/Istanbul, per ``docs/data-platform.md`` and the WS4 task brief):

- **rates** (``macro.rates``): daily at 10:00 and 14:30. The MPC meets ~8x/year
  and announces at ~14:00 on decision days; the 14:30 run catches a same-day
  decision, the 10:00 run catches any overnight publish-lag. Off days this is a
  cheap no-op (the scraped "latest row" is unchanged).
- **inflation** (``macro.inflation``): TÜİK's CPI release normally lands on one
  specific day in the 3rd-5th of the month, at a time not published in advance.
  During that window we poll hourly (xx:05, 10:00-18:00) to catch it promptly;
  on every other day we check once, at 10:05, in case of a late/rescheduled
  release.
- **fx** (``macro.fx``): daily at 15:35 (TCMB's indicative bulletin publishes
  ~15:30). If today's bulletin is not yet in the store, retried hourly until it
  appears or 23:00 Istanbul (then we give up for the day — a still-missing
  bulletin at that point is a holiday, not a delay).

``run_macro_once`` is the manual/admin entry point (also used for the "run it
for real" verification run): each job takes ``polling_worker.source_lock`` so a
manual trigger and the scheduled loop never race. Accepts extra job keys beyond
the default 3: ``"macro.evds"`` (only does anything when
``MACRO_EVDS_API_KEY`` is set) and ``"macro.quality"`` (the accuracy
cross-checks, WS4 report item 5).
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Sequence
from datetime import date, datetime
from datetime import time as dtime
from datetime import timedelta
from typing import Any
from zoneinfo import ZoneInfo

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.repositories.macro import MacroRepository
from src.db.session import async_session_factory
from src.services import macro_service
from src.services.ingestion import run_job
from src.workers.polling_worker import sleep_or_stop, source_lock

logger = structlog.get_logger(__name__)

ISTANBUL_TZ = ZoneInfo("Europe/Istanbul")

_RATES_TIMES: tuple[dtime, ...] = (dtime(10, 0), dtime(14, 30))
_INFLATION_TIME = dtime(10, 5)
_INFLATION_WINDOW_TIMES: tuple[dtime, ...] = tuple(dtime(h, 5) for h in range(10, 19))  # hourly, release window
_FX_TIME = dtime(15, 35)
_FX_RETRY_EVERY_SECONDS = 3600.0
_FX_GIVE_UP_AT = dtime(23, 0)

_INGEST_FUNCS: dict[str, Callable[[AsyncSession], Awaitable[dict[str, Any]]]] = {
    "macro.rates": macro_service.ingest_rates,
    "macro.inflation": macro_service.ingest_inflation,
    "macro.fx": macro_service.ingest_fx,
    "macro.evds": macro_service.ingest_evds,
}


# ---------------------------------------------------------------------------
# Pure schedule helpers (no network/sleep — unit-tested directly)
# ---------------------------------------------------------------------------

def next_run_time(now: datetime, times: Sequence[dtime]) -> datetime:
    """Next Istanbul-local ``datetime`` matching one of ``times``, strictly after ``now``.

    ``now`` may be naive (assumed Istanbul-local) or tz-aware (any zone).
    """
    moment = now.astimezone(ISTANBUL_TZ) if now.tzinfo is not None else now.replace(tzinfo=ISTANBUL_TZ)
    candidates = [moment.replace(hour=t.hour, minute=t.minute, second=0, microsecond=0) for t in times]
    later_today = [c for c in candidates if c > moment]
    if later_today:
        return min(later_today)
    tomorrow = moment.date() + timedelta(days=1)
    return datetime.combine(tomorrow, min(times), tzinfo=ISTANBUL_TZ)


def is_inflation_release_window(day: date) -> bool:
    """TÜİK's CPI print normally lands on one (unannounced) day in this window."""
    return 3 <= day.day <= 5


def _job_counts(result: dict[str, Any]) -> tuple[int, int, int]:
    """(items_total, items_ok, items_failed) from an ``ingest_*`` result dict."""
    errors = result.get("errors") or {}
    series = result.get("series") or result.get("currencies") or {}
    total = len(series) + len(errors)
    return total, total - len(errors), len(errors)


# ---------------------------------------------------------------------------
# Job execution (locked + run_job-tracked) — shared by the loop and manual runs
# ---------------------------------------------------------------------------

async def _execute_job(job: str) -> dict[str, Any]:
    if job == "macro.quality":
        async with source_lock(job) as acquired:
            if not acquired:
                logger.info("macro_job_skipped_locked", job=job)
                return {"skipped": "locked"}
            async with run_job(job) as run:
                async with async_session_factory() as session:
                    results = await macro_service.run_accuracy_checks(session)
                run.items_total = len(results)
                run.items_failed = sum(1 for r in results if r.get("status") == "fail")
                run.items_ok = run.items_total - run.items_failed
                run.details = {"checks": results}
                return {"checks": results}

    ingest = _INGEST_FUNCS.get(job)
    if ingest is None:
        logger.warning("macro_unknown_job", job=job)
        return {"skipped": "unknown_job"}

    async with source_lock(job) as acquired:
        if not acquired:
            logger.info("macro_job_skipped_locked", job=job)
            return {"skipped": "locked"}
        async with run_job(job) as run:
            async with async_session_factory() as session:
                result = await ingest(session)
            run.items_total, run.items_ok, run.items_failed = _job_counts(result)
            run.details = result
            return result


async def run_macro_once(jobs: Sequence[str] = ("macro.rates", "macro.inflation", "macro.fx")) -> dict[str, Any]:
    """Run each of ``jobs`` once, right now (admin trigger / manual verification)."""
    summary: dict[str, Any] = {}
    for job in jobs:
        summary[job] = await _execute_job(job)
    return summary


# ---------------------------------------------------------------------------
# Scheduled loops
# ---------------------------------------------------------------------------

async def _rates_loop(stop: asyncio.Event) -> None:
    while not stop.is_set():
        now = datetime.now(ISTANBUL_TZ)
        target = next_run_time(now, _RATES_TIMES)
        await sleep_or_stop(stop, (target - now).total_seconds())
        if stop.is_set():
            break
        await _execute_job("macro.rates")


async def _inflation_loop(stop: asyncio.Event) -> None:
    while not stop.is_set():
        now = datetime.now(ISTANBUL_TZ)
        times = _INFLATION_WINDOW_TIMES if is_inflation_release_window(now.date()) else (_INFLATION_TIME,)
        target = next_run_time(now, times)
        await sleep_or_stop(stop, (target - now).total_seconds())
        if stop.is_set():
            break
        await _execute_job("macro.inflation")


async def _fx_loop(stop: asyncio.Event) -> None:
    while not stop.is_set():
        now = datetime.now(ISTANBUL_TZ)
        target = next_run_time(now, (_FX_TIME,))
        await sleep_or_stop(stop, (target - now).total_seconds())
        if stop.is_set():
            break
        await _execute_job("macro.fx")
        # Retry hourly until today's bulletin exists, or give up for the day (23:00).
        while not stop.is_set():
            now = datetime.now(ISTANBUL_TZ)
            if now.time() >= _FX_GIVE_UP_AT:
                break
            async with async_session_factory() as session:
                published = await MacroRepository(session).has_fx_bulletin(now.date())
            if published:
                break
            await sleep_or_stop(stop, _FX_RETRY_EVERY_SECONDS)
            if stop.is_set():
                break
            await _execute_job("macro.fx")


async def macro_loop(stop: asyncio.Event) -> None:
    """Run rates/inflation/fx on their own schedules until ``stop`` is set."""
    logger.info("macro_loop_started")
    tasks = [
        asyncio.create_task(_rates_loop(stop), name="macro:rates"),
        asyncio.create_task(_inflation_loop(stop), name="macro:inflation"),
        asyncio.create_task(_fx_loop(stop), name="macro:fx"),
    ]
    try:
        await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        logger.info("macro_loop_stopped")
