"""Fundamentals worker — statements → facts → ratios (data-infra WS3).

Jobs (``ingestion_runs.job``), Europe/Istanbul:

* ``fundamentals.statements`` — rolling per-company refresh of the KAP financial
  summary + İş Yatırım quarterly tables (``src.services.fundamentals_service``):
  ``tracking_tier=core`` companies at most every ``FUNDAMENTALS_REFRESH_CORE_HOURS``
  (3 days), the rest of the universe every ``FUNDAMENTALS_REFRESH_UNIVERSE_HOURS``
  (14 days), a failed attempt again after ``FUNDAMENTALS_RETRY_FAILED_HOURS``. Each
  iteration takes at most ``FUNDAMENTALS_BATCH_SIZE`` due companies (core first,
  oldest refresh first). KAP pages go through one process-wide gate (one at a time,
  ≥ ``FUNDAMENTALS_KAP_MIN_INTERVAL_SECONDS`` apart, cool-down after a WAF block);
  İş Yatırım runs ≤ ``FUNDAMENTALS_ISY_CONCURRENCY`` companies at once. Changed
  facts get their ratios recomputed right away. ``run_job`` also keeps the legacy
  ``polling_state`` row ``financials`` current.
* ``fundamentals.ratios`` — once a day after ``FUNDAMENTALS_RATIOS_HOUR`` (19:00,
  after the session's final quotes): every company with facts, valuation from the
  day's quotes (market store) or one TradingView scanner request.

Wire ``fundamentals_loop`` into the worker (``run_workers.DATA_PLATFORM_LOOPS``);
``run_fundamentals_once`` is the manual / admin entry point.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Sequence
from datetime import datetime, timedelta
from typing import Any

import structlog
from sqlalchemy import select

from src.adapters.fundamentals_common import ISTANBUL_TZ
from src.core.config import settings
from src.core.time import utcnow
from src.db.models import IngestionRun
from src.db.session import async_session_factory
from src.services import fundamentals_service as fsvc
from src.services.ingestion import run_job
from src.workers.polling_worker import sleep_or_stop, source_lock

logger = structlog.get_logger(__name__)

JOB_STATEMENTS = "fundamentals.statements"
JOB_RATIOS = "fundamentals.ratios"
ALL_JOBS: tuple[str, ...] = (JOB_STATEMENTS, JOB_RATIOS)


async def run_statements_job(
    tickers: Sequence[str] | None = None,
    *,
    force: bool = False,
    limit: int | None = None,
    stop: asyncio.Event | None = None,
    compute_ratios: bool = True,
) -> dict[str, Any]:
    """Refresh the due companies (or ``tickers``; ``force`` ignores the schedule)."""
    started = time.monotonic()
    companies = await fsvc.due_companies(tickers=tickers, force=force, limit=limit)
    if not companies:
        return {"job": JOB_STATEMENTS, "skipped": "nothing_due", "companies": 0}
    async with source_lock(JOB_STATEMENTS) as acquired:
        if not acquired:
            logger.info("fundamentals_statements_locked")
            return {"job": JOB_STATEMENTS, "skipped": "locked", "companies": len(companies)}
        kap_before = fsvc.kap_requests_made()
        scope = "tickers" if tickers else ("core" if all(c.tracking_tier == "core" for c in companies) else "universe")
        async with run_job(JOB_STATEMENTS, scope=scope) as run:
            run.items_total = len(companies)
            results = await fsvc.refresh_many(companies, force=force, compute_ratios=compute_ratios, stop=stop)
            run.items_ok = sum(1 for r in results if r.ok)
            run.items_failed = sum(1 for r in results if not r.ok)
            run.details = {
                "companies": {r.ticker: r.summary() for r in results},
                "kap_requests": fsvc.kap_requests_made() - kap_before,
                "statements_written": sum(r.statements.changed for r in results if r.statements),
                "facts_written": sum(r.facts for r in results),
                "ratios_written": sum(r.ratios for r in results),
                "seconds": round(time.monotonic() - started, 1),
            }
            failed = [r for r in results if not r.ok]
            if failed:
                run.details["first_error"] = f"{failed[0].ticker}: {failed[0].kap_error or failed[0].isy_error}"
        return {"job": JOB_STATEMENTS, "run_id": str(run.id), "status": run.status, **run.details,
                "items_ok": run.items_ok, "items_failed": run.items_failed}


async def run_ratios_job(tickers: Sequence[str] | None = None) -> dict[str, Any]:
    """Recompute ratios for every company with facts (or ``tickers``) with today's prices."""
    started = time.monotonic()
    async with source_lock(JOB_RATIOS) as acquired:
        if not acquired:
            logger.info("fundamentals_ratios_locked")
            return {"job": JOB_RATIOS, "skipped": "locked"}
        async with run_job(JOB_RATIOS, scope="tickers" if tickers else "all") as run:
            summary = await fsvc.recompute_ratios(tickers, write_checks=True)
            run.items_total = summary["companies"]
            run.items_failed = summary["failed"]
            run.items_ok = summary["companies"] - summary["failed"]
            run.details = {**summary, "seconds": round(time.monotonic() - started, 1)}
        return {"job": JOB_RATIOS, "run_id": str(run.id), "status": run.status, **run.details}


async def run_fundamentals_once(
    tickers: list[str] | None = None,
    *,
    jobs: Sequence[str] = ALL_JOBS,
    force: bool | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    """Run the fundamentals jobs once (manual / admin trigger).

    ``tickers`` are refreshed unconditionally (``force`` defaults to true for them);
    ``tickers=None`` refreshes the companies that are due (at most ``limit``) — on an
    empty store that is the whole universe, one KAP page each (≥3 s apart).
    """
    unknown = [job for job in jobs if job not in ALL_JOBS]
    if unknown:
        raise ValueError(f"unknown jobs: {unknown}")
    if force is None:
        force = tickers is not None
    summary: dict[str, Any] = {}
    if JOB_STATEMENTS in jobs:
        # The ratio job below recomputes everything once; skip per-company ratios then.
        summary[JOB_STATEMENTS] = await run_statements_job(
            tickers, force=force, limit=limit, compute_ratios=JOB_RATIOS not in jobs
        )
    if JOB_RATIOS in jobs:
        summary[JOB_RATIOS] = await run_ratios_job(tickers)
    return summary


async def _ratios_done_today(now: datetime) -> bool:
    """A successful ratio run already started after today's ratio hour (Istanbul)."""
    local = now.astimezone(ISTANBUL_TZ)
    threshold = local.replace(hour=settings.fundamentals_ratios_hour, minute=0, second=0, microsecond=0)
    async with async_session_factory() as session:
        row = (
            await session.execute(
                select(IngestionRun.id)
                .where(
                    IngestionRun.job == JOB_RATIOS,
                    IngestionRun.status.in_(("ok", "partial")),
                    IngestionRun.started_at >= threshold,
                )
                .limit(1)
            )
        ).first()
    return row is not None


def ratios_window_open(now: datetime) -> bool:
    return now.astimezone(ISTANBUL_TZ).hour >= settings.fundamentals_ratios_hour


async def fundamentals_loop(stop: asyncio.Event) -> None:
    """Rolling statement refresh + the daily ratio job until ``stop`` is set."""
    logger.info(
        "fundamentals_loop_started",
        enabled=settings.fundamentals_worker_enabled,
        batch_size=settings.fundamentals_batch_size,
        interval_seconds=settings.fundamentals_loop_interval_seconds,
    )
    while not stop.is_set():
        if settings.fundamentals_worker_enabled:
            try:
                result = await run_statements_job(limit=max(1, settings.fundamentals_batch_size), stop=stop)
                if result.get("companies"):
                    logger.info("fundamentals_statements_iteration", **{
                        k: v for k, v in result.items() if k in ("status", "items_ok", "items_failed", "kap_requests")
                    })
            except Exception as e:  # DB/provider trouble: keep the loop alive
                logger.error("fundamentals_statements_iteration_failed", error=f"{type(e).__name__}: {e}")
            if stop.is_set():
                break
            try:
                now = utcnow()
                if ratios_window_open(now) and not await _ratios_done_today(now):
                    await run_ratios_job()
            except Exception as e:
                logger.error("fundamentals_ratios_iteration_failed", error=f"{type(e).__name__}: {e}")
        await sleep_or_stop(stop, max(10.0, float(settings.fundamentals_loop_interval_seconds)))
    logger.info("fundamentals_loop_stopped")


def next_ratio_run(now: datetime) -> datetime:
    """When the daily ratio job becomes due next (informational)."""
    local = now.astimezone(ISTANBUL_TZ)
    at = local.replace(hour=settings.fundamentals_ratios_hour, minute=0, second=0, microsecond=0)
    return at if local < at else at + timedelta(days=1)


__all__ = [
    "ALL_JOBS",
    "JOB_RATIOS",
    "JOB_STATEMENTS",
    "fundamentals_loop",
    "next_ratio_run",
    "ratios_window_open",
    "run_fundamentals_once",
    "run_ratios_job",
    "run_statements_job",
]
