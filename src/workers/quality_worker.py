"""Quality worker — daily cross-source/freshness checks + housekeeping.

Schedule (Europe/Istanbul): ``quality.daily`` runs once at
``settings.quality_daily_run_time`` (default 19:30 — after the market's daily bars
job (18:40; ``MARKET_DAILY_BARS_AFTER``), the fundamentals ratio job (from
``FUNDAMENTALS_RATIOS_HOUR``, default 19:00) and the FX bulletin (15:35;
``macro_worker._FX_TIME``) have all had a chance to land) and, on worker start,
immediately if the last successful ``quality.daily`` run is older than
``QUALITY_STALE_RUN_HOURS`` (default 24h) — covers a worker that was down across its
scheduled time.

``run_quality_once`` is the manual/admin entry point (also used for the "run it for
real" verification run): it takes ``polling_worker.source_lock`` so a manual trigger
and the scheduled loop never race, wraps the checks in ``run_job("quality.daily")``
and then runs housekeeping (best-effort, does not fail the run): purge expired
``data_snapshots``, old ``data_quality_checks`` (``QUALITY_RETENTION_DAYS``, default
90) and old ``ingestion_runs`` (``QUALITY_INGESTION_RETENTION_DAYS``, default 30).
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from datetime import time as dtime
from typing import Any, cast
from zoneinfo import ZoneInfo

import structlog
from sqlalchemy import CursorResult, delete

from src.core.config import settings
from src.core.time import utcnow
from src.db.models import IngestionRun
from src.db.repositories.platform import QualityCheckRepository, SnapshotRepository
from src.db.session import async_session_factory
from src.services import quality_service
from src.services.ingestion import latest_runs, run_job
from src.workers.polling_worker import sleep_or_stop, source_lock

logger = structlog.get_logger(__name__)

ISTANBUL_TZ = ZoneInfo("Europe/Istanbul")
JOB_NAME = "quality.daily"


def _parse_hhmm(value: str, default: dtime) -> dtime:
    try:
        hours, minutes = str(value).strip().split(":", 1)
        return dtime(int(hours), int(minutes))
    except (ValueError, TypeError):
        return default


def next_run_time(now: datetime, at: dtime) -> datetime:
    """Next Istanbul-local ``datetime`` at time-of-day ``at``, strictly after ``now``."""
    moment = now.astimezone(ISTANBUL_TZ) if now.tzinfo is not None else now.replace(tzinfo=ISTANBUL_TZ)
    candidate = moment.replace(hour=at.hour, minute=at.minute, second=0, microsecond=0)
    if candidate > moment:
        return candidate
    return candidate + timedelta(days=1)


async def _run_checks(names: list[str] | None) -> dict[str, Any]:
    async with async_session_factory() as session:
        results = await quality_service.run_quality_checks(session, names=names)
    summary = quality_service.summarize_results(results)
    return {"results": results, "summary": summary}


async def _purge_old_ingestion_runs(before: datetime) -> int:
    async with async_session_factory() as session:
        result = await session.execute(delete(IngestionRun).where(IngestionRun.started_at < before))
        await session.commit()
        return cast(CursorResult, result).rowcount or 0


async def _housekeeping() -> dict[str, Any]:
    now = utcnow()
    async with async_session_factory() as session:
        purged_snapshots = await SnapshotRepository(session).purge_expired(
            before=now - timedelta(days=settings.quality_snapshot_purge_grace_days)
        )
        purged_checks = await QualityCheckRepository(session).purge_older_than(
            before=now - timedelta(days=settings.quality_retention_days)
        )
        await session.commit()
    purged_runs = await _purge_old_ingestion_runs(now - timedelta(days=settings.quality_ingestion_retention_days))
    return {"snapshots": purged_snapshots, "quality_checks": purged_checks, "ingestion_runs": purged_runs}


async def run_quality_once(names: list[str] | None = None) -> dict[str, Any]:
    """Run the quality checks now, then best-effort housekeeping (manual/admin trigger)."""
    async with source_lock(JOB_NAME) as acquired:
        if not acquired:
            logger.info("quality_job_skipped_locked", job=JOB_NAME)
            return {"skipped": "locked"}
        async with run_job(JOB_NAME, scope="selected" if names else "all") as run:
            outcome = await _run_checks(names)
            summary = outcome["summary"]
            run.items_total = summary["total"]
            run.items_failed = summary["fail"]
            run.items_ok = summary["total"] - summary["fail"]
            run.details = {"summary": summary}
        try:
            outcome["housekeeping"] = await _housekeeping()
        except Exception as e:
            logger.warning("quality_housekeeping_failed", error=f"{type(e).__name__}: {e}")
            outcome["housekeeping"] = {"error": str(e)}
        return outcome


async def _last_successful_run_at() -> datetime | None:
    async with async_session_factory() as session:
        runs = await latest_runs(session, jobs=[JOB_NAME], per_job=5)
    for run in runs:
        if run.status in ("ok", "partial") and run.finished_at is not None:
            return run.finished_at
    return None


async def quality_loop(stop: asyncio.Event) -> None:
    """Run ``quality.daily`` on its schedule until ``stop`` is set (wired by
    ``run_workers.DATA_PLATFORM_LOOPS``)."""
    if not settings.quality_worker_enabled:
        logger.info("quality_worker_disabled")
        return
    logger.info("quality_loop_started", run_time=settings.quality_daily_run_time)
    run_at = _parse_hhmm(settings.quality_daily_run_time, dtime(19, 30))

    try:
        last_ok = await _last_successful_run_at()
        if last_ok is None or (utcnow() - last_ok) > timedelta(hours=settings.quality_stale_run_hours):
            await run_quality_once()
    except Exception as e:  # DB unreachable at start-up: try again at the scheduled time
        logger.error("quality_startup_check_failed", error=f"{type(e).__name__}: {e}")

    while not stop.is_set():
        now = datetime.now(ISTANBUL_TZ)
        target = next_run_time(now, run_at)
        await sleep_or_stop(stop, (target - now).total_seconds())
        if stop.is_set():
            break
        try:
            await run_quality_once()
        except Exception as e:  # keep the loop alive across a bad cycle
            logger.error("quality_cycle_error", error=f"{type(e).__name__}: {e}")
    logger.info("quality_loop_stopped")
