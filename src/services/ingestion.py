"""Ingestion job bookkeeping: ``ingestion_runs`` rows plus the legacy ``polling_state``.

Every worker loop cycle (and every admin-triggered run) is wrapped in
:func:`run_job`, so ``/data/status`` can show when each dataset last refreshed,
how many items succeeded and the last error — regardless of which worker module
produced it. Jobs that replace an old polling source (``price``,
``financials``) also update that source's ``polling_state`` row, which keeps the
dashboard's ingestion indicator working unchanged.

Usage::

    async with run_job("market.quotes", scope="universe") as run:
        ...
        run.items_total, run.items_ok, run.items_failed = 630, 628, 2
        run.details["symbols_missing"] = ["AVTUR", "ISYAT"]

Raising inside the block marks the run ``failed`` (the exception propagates);
``items_failed > 0`` with ``items_ok > 0`` marks it ``partial``.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import structlog
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.time import utcnow
from src.db.models import IngestionRun, Source
from src.db.repository import PollingStateRepository
from src.db.session import async_session_factory

logger = structlog.get_logger(__name__)

# Jobs that took over a legacy polling source keep its polling_state row current.
JOB_SOURCE_CODES: dict[str, str] = {
    "market.bars.daily": "price",
    "fundamentals.statements": "financials",
}


@dataclass
class JobRun:
    job: str
    scope: str | None
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    started_at: datetime = field(default_factory=utcnow)
    items_total: int = 0
    items_ok: int = 0
    items_failed: int = 0
    details: dict[str, Any] = field(default_factory=dict)
    error: str | None = None

    @property
    def status(self) -> str:
        if self.error:
            return "failed"
        if self.items_failed and self.items_ok:
            return "partial"
        if self.items_failed and not self.items_ok and self.items_total:
            return "failed"
        return "ok"


async def _write(run: JobRun, finished: bool) -> None:
    async with async_session_factory() as session:
        row = await session.get(IngestionRun, run.id)
        if row is None:
            row = IngestionRun(id=run.id, job=run.job, scope=run.scope, started_at=run.started_at)
            session.add(row)
        row.status = run.status if finished else "running"
        row.items_total = run.items_total
        row.items_ok = run.items_ok
        row.items_failed = run.items_failed
        row.error = run.error[:2000] if run.error else None
        row.details_json = run.details or None
        if finished:
            row.finished_at = utcnow()
            source_code = JOB_SOURCE_CODES.get(run.job)
            if source_code:
                await _update_polling_state(session, source_code, run)
        await session.commit()


async def _update_polling_state(session: AsyncSession, source_code: str, run: JobRun) -> None:
    source = (await session.execute(select(Source).where(Source.code == source_code))).scalar_one_or_none()
    if source is None:
        return
    repo = PollingStateRepository(session)
    await repo.upsert(source.id)
    if run.status == "failed":
        await repo.update_failure(source.id, run.error or f"{run.items_failed}/{run.items_total} items failed")
    else:
        note = f"{run.items_failed}/{run.items_total} öğe başarısız" if run.items_failed else None
        await repo.update_success(source.id, warning=note)


@asynccontextmanager
async def run_job(job: str, scope: str | None = None) -> AsyncIterator[JobRun]:
    """Record one ingestion run around the ``async with`` block (see module docstring)."""
    run = JobRun(job=job, scope=scope)
    try:
        await _write(run, finished=False)
    except Exception as e:  # bookkeeping must never break ingestion
        logger.warning("ingestion_run_start_not_recorded", job=job, error=str(e))
    try:
        yield run
    except BaseException as e:
        run.error = f"{type(e).__name__}: {e}"
        raise
    finally:
        try:
            await _write(run, finished=True)
        except Exception as e:
            logger.warning("ingestion_run_not_recorded", job=job, error=str(e))
        logger.info(
            "ingestion_run",
            job=job,
            scope=scope,
            status=run.status,
            items_total=run.items_total,
            items_ok=run.items_ok,
            items_failed=run.items_failed,
            duration_seconds=round((utcnow() - run.started_at).total_seconds(), 1),
        )


async def latest_runs(session: AsyncSession, jobs: Sequence[str] | None = None, per_job: int = 1) -> list[IngestionRun]:
    """Most recent run(s) of every job (or of ``jobs``), newest first."""
    q = select(IngestionRun).order_by(IngestionRun.job, desc(IngestionRun.started_at))
    if jobs:
        q = q.where(IngestionRun.job.in_(list(jobs)))
    rows = (await session.execute(q)).scalars().all()
    result: list[IngestionRun] = []
    seen: dict[str, int] = {}
    for row in rows:
        count = seen.get(row.job, 0)
        if count < per_job:
            result.append(row)
            seen[row.job] = count + 1
    return result
