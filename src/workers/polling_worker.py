"""Polling worker — fetches data from external sources for all active companies.

Concurrency / resilience model:
- Every source runs in its own loop, so a slow financials cycle never delays KAP.
- A source cycle holds a PostgreSQL session-level advisory lock on a dedicated
  connection: the same source is never polled twice at the same time, whether the
  second attempt comes from another worker replica or from the API's admin
  "run once" / backfill endpoints (which run in the API process).
- Companies are polled with bounded concurrency and are isolated from each other;
  no DB connection is held while waiting on the network.
- polling_state is updated once per cycle. When every company fails the source's
  consecutive_failures grows and the next cycle waits an exponential backoff with
  jitter (a failing source is retried later, never disabled for good).
- Shutdown is cooperative: the stop event is checked between companies and cycles.
"""

import asyncio
import random
import zlib
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Any

import structlog
from sqlalchemy import func, select

from src.adapters.base import RawEventData
from src.adapters.financial_adapter import FinancialAdapter
from src.adapters.kap import KAPAdapter
from src.adapters.price import PriceAdapter
from src.core.config import settings
from src.core.time import utcnow
from src.db.models import Company, PollingState, Source
from src.db.repository import CompanyRepository, PollingStateRepository, SourceRepository
from src.db.session import async_session_factory, engine
from src.services.event_service import EventService, FinancialService, PriceService

logger = structlog.get_logger(__name__)

POLL_SOURCES: tuple[str, ...] = ("kap", "price", "financials")
# KAP is polled per company (~100 requests per cycle); faster cycles get the client
# throttled by kap.org.tr ("Server disconnected" / read timeouts).
DEFAULT_INTERVALS: dict[str, int] = {"kap": 300, "price": 300, "financials": 3600}
MIN_INTERVAL_SECONDS = 10

# Advisory lock namespace ("HISS"); the key is a stable hash of the source code.
_ADVISORY_LOCK_NAMESPACE = 0x48495353
_INTER_COMPANY_DELAY_SECONDS = 0.5
# KAP disclosure indexes are global and monotonic. The cursor only advances to
# disclosures published before the cycle started (minus clock-skew margin): later ones
# may have been missed by companies polled early in the cycle.
_CURSOR_SAFETY_MARGIN = timedelta(minutes=5)


def source_lock_key(source_code: str) -> int:
    """Advisory lock key, stable across processes (``hash()`` is salted per process)."""
    return zlib.crc32(source_code.encode("utf-8")) & 0x7FFFFFFF


def _lock_id(source_code: str) -> int:
    """Backward-compatible alias."""
    return source_lock_key(source_code)


def backoff_window(consecutive_failures: int) -> float:
    """Upper bound of the backoff after ``consecutive_failures`` failed cycles."""
    if consecutive_failures <= 0:
        return 0.0
    exponent = min(consecutive_failures - 1, 20)
    return float(min(settings.backoff_base_seconds * settings.backoff_factor**exponent, settings.backoff_max_seconds))


def compute_backoff(consecutive_failures: int, rng: random.Random | None = None) -> float:
    """Exponential backoff with "equal jitter": uniform in [window/2, window]."""
    window = backoff_window(consecutive_failures)
    if window <= 0:
        return 0.0
    return window / 2 + (rng or random).uniform(0, window / 2)


def _compute_backoff(consecutive_failures: int) -> float:
    """Backward-compatible alias (jittered)."""
    return compute_backoff(consecutive_failures)


def in_backoff(state: PollingState | None, now: datetime) -> bool:
    """True while a failing source must not be polled yet (lower jitter bound)."""
    if state is None or state.consecutive_failures <= 0 or state.last_attempt_at is None:
        return False
    return now < state.last_attempt_at + timedelta(seconds=backoff_window(state.consecutive_failures) / 2)


def kap_cursor_candidate(events: Sequence[RawEventData], cycle_started_at: datetime) -> int | None:
    """Highest numeric disclosure index that is safe to use as the next cursor."""
    cutoff = cycle_started_at - _CURSOR_SAFETY_MARGIN
    indexes = [
        int(e.external_id)
        for e in events
        if e.external_id and e.external_id.isdigit() and e.published_at is not None and e.published_at < cutoff
    ]
    return max(indexes) if indexes else None


@asynccontextmanager
async def source_lock(source_code: str) -> AsyncIterator[bool]:
    """Non-blocking advisory lock held for the whole cycle on one dedicated connection.

    Yields False when another process holds it. The lock is released on the same
    connection (session-level locks belong to the connection); if that fails the
    connection is invalidated, which releases the lock server-side.
    """
    key = source_lock_key(source_code)
    async with engine.connect() as conn:
        acquired = bool(
            (await conn.execute(select(func.pg_try_advisory_lock(_ADVISORY_LOCK_NAMESPACE, key)))).scalar()
        )
        await conn.commit()  # do not sit "idle in transaction" for the whole cycle
        try:
            yield acquired
        finally:
            if acquired:
                try:
                    await conn.execute(select(func.pg_advisory_unlock(_ADVISORY_LOCK_NAMESPACE, key)))
                    await conn.commit()
                except Exception as e:
                    logger.warning("advisory_unlock_failed", source=source_code, error=str(e))
                    await conn.invalidate()


async def _poll_company(
    source: Source,
    company: Company,
    state: PollingState | None,
    days: int | None,
    cycle_started_at: datetime,
) -> dict[str, Any]:
    """Fetch + store one company for one source. Never raises (except cancellation)."""
    ticker = company.ticker
    stats: dict[str, Any] = {"source": source.code, "ticker": ticker}
    try:
        if source.code == "kap":
            events = await KAPAdapter(ticker=ticker).fetch(state)
            async with async_session_factory() as session:
                stats.update(await EventService(session).process_raw_events(events, source, company))
            stats["cursor"] = kap_cursor_candidate(events, cycle_started_at)
        elif source.code == "price":
            records = await PriceAdapter(ticker=ticker).fetch_prices(state, days=days)
            async with async_session_factory() as session:
                stats.update(await PriceService(session).process_prices(records, company))
        elif source.code == "financials":
            raw_data = await FinancialAdapter().fetch(ticker, state)
            async with async_session_factory() as session:
                stats.update(await FinancialService(session).process_financials(raw_data, company))
                await session.commit()
        else:
            raise ValueError(f"unknown source: {source.code}")
        stats["ok"] = True
    except Exception as e:
        logger.warning("poll_company_error", source=source.code, ticker=ticker, error=str(e))
        stats["ok"] = False
        stats["error"] = f"{type(e).__name__}: {e}"[:500]
    return stats


async def _load_cycle_context(
    source_code: str,
) -> tuple[Source | None, PollingState | None, list[Company]]:
    async with async_session_factory() as session:
        source = await SourceRepository(session).get_by_code(source_code)
        if source is None or not source.enabled:
            return source, None, []
        state = await PollingStateRepository(session).upsert(source.id)
        companies = list(await CompanyRepository(session).get_all())
        await session.commit()
        return source, state, companies


async def run_source_cycle(
    source_code: str,
    *,
    days: int | None = None,
    stop: asyncio.Event | None = None,
    respect_backoff: bool = True,
) -> dict[str, Any]:
    """Poll one source for every active company (one cycle)."""
    started_at = utcnow()
    summary: dict[str, Any] = {
        "source": source_code,
        "started_at": started_at.isoformat(),
        "companies": 0,
        "succeeded": 0,
        "failed": 0,
        "skipped": None,
        "interval_seconds": DEFAULT_INTERVALS.get(source_code, settings.default_poll_interval_seconds),
        "consecutive_failures": 0,
        "results": [],
    }

    source, state, companies = await _load_cycle_context(source_code)
    if source is None or not source.enabled or state is None:
        summary["skipped"] = "disabled" if source is not None else "unknown_source"
        return summary
    summary["interval_seconds"] = max(source.poll_interval_seconds or 0, MIN_INTERVAL_SECONDS)
    summary["consecutive_failures"] = state.consecutive_failures
    if state.consecutive_failures >= settings.max_consecutive_failures:
        logger.warning("source_degraded", source=source_code, failures=state.consecutive_failures, error=state.last_error)
    if respect_backoff and in_backoff(state, started_at):
        summary["skipped"] = "backoff"
        return summary

    async with source_lock(source_code) as acquired:
        if not acquired:
            logger.info("poll_source_skipped_locked", source=source_code)
            summary["skipped"] = "locked"
            return summary

        semaphore = asyncio.Semaphore(max(1, settings.worker_max_concurrency))

        async def poll_one(company: Company) -> dict[str, Any]:
            if stop is not None and stop.is_set():
                return {"ticker": company.ticker, "skipped": "shutdown"}
            async with semaphore:
                if stop is not None and stop.is_set():
                    return {"ticker": company.ticker, "skipped": "shutdown"}
                result = await _poll_company(source, company, state, days, started_at)
                await asyncio.sleep(_INTER_COMPANY_DELAY_SECONDS)  # be gentle with upstream
                return result

        results = await asyncio.gather(*(poll_one(c) for c in companies))
        attempted = [r for r in results if "ok" in r]
        failed = [r for r in attempted if not r["ok"]]
        summary.update(companies=len(attempted), succeeded=len(attempted) - len(failed), failed=len(failed))
        summary["results"] = results

        if attempted:
            note = f"{len(failed)}/{len(attempted)} şirket başarısız; ilk hata: {failed[0]['error']}" if failed else None
            async with async_session_factory() as session:
                repo = PollingStateRepository(session)
                if len(failed) == len(attempted):
                    await repo.update_failure(source.id, note or "all companies failed")
                    summary["consecutive_failures"] = state.consecutive_failures + 1
                else:
                    cursors = [r["cursor"] for r in attempted if r.get("cursor") is not None]
                    current = state.last_seen_external_id
                    new_cursor = max(cursors) if cursors else None
                    if new_cursor is not None and current and current.isdigit() and int(current) >= new_cursor:
                        new_cursor = None
                    await repo.update_success(
                        source.id,
                        last_seen_external_id=str(new_cursor) if new_cursor is not None else None,
                        warning=note,
                    )
                    summary["consecutive_failures"] = 0
                await session.commit()

    ended_at = utcnow()
    logger.info(
        "poll_cycle_complete",
        source=source_code,
        companies=summary["companies"],
        succeeded=summary["succeeded"],
        failed=summary["failed"],
        duration_seconds=round((ended_at - started_at).total_seconds(), 1),
    )
    return summary


async def poll_source_for_company(source_code: str, ticker: str, days: int | None = None) -> dict[str, Any]:
    """Poll one source for a single company (manual runs / debugging).

    Does not take the source lock and does not touch polling_state.
    """
    started_at = utcnow()
    async with async_session_factory() as session:
        source = await SourceRepository(session).get_by_code(source_code)
        company = await CompanyRepository(session).get_by_ticker(ticker.strip().upper())
        state = await PollingStateRepository(session).get_by_source_id(source.id) if source else None
    if source is None or not source.enabled:
        return {"source": source_code, "ticker": ticker, "skipped": True}
    if company is None:
        return {"source": source_code, "ticker": ticker, "ok": False, "error": f"{ticker} company not found"}
    return await _poll_company(source, company, state, days, started_at)


async def poll_source(source_code: str, days: int | None = None) -> dict[str, Any]:
    """Run one cycle of a source now (admin trigger; ignores backoff, honours the lock)."""
    return await run_source_cycle(source_code, days=days, respect_backoff=False)


async def run_all_sources_once() -> list[dict[str, Any]]:
    """Tum kaynaklari tum sirketler icin bir kez poll et."""
    return [await poll_source(code) for code in POLL_SOURCES]


async def run_backfill(days: int | None = None, source_code: str | None = None) -> list[dict[str, Any]]:
    """Backfill: istenen kaynak(lar)i istenen gun araligiyla poll et.

    days yalnizca price kaynaginda gecmis aralik olarak kullanilir;
    kap/financials kaynaklari artimli calisir.
    """
    sources = [source_code] if source_code else list(POLL_SOURCES)
    return [await poll_source(code, days=days) for code in sources]


async def sleep_or_stop(stop: asyncio.Event, seconds: float) -> None:
    """Sleep that ends early when ``stop`` is set."""
    try:
        await asyncio.wait_for(stop.wait(), timeout=max(0.0, seconds))
    except TimeoutError:
        pass


async def _source_loop(source_code: str, stop: asyncio.Event) -> None:
    loop = asyncio.get_running_loop()
    while not stop.is_set():
        cycle_started = loop.time()
        interval: float = DEFAULT_INTERVALS.get(source_code, settings.default_poll_interval_seconds)
        failures = 0
        try:
            summary = await run_source_cycle(source_code, stop=stop)
            interval = summary["interval_seconds"]
            failures = summary["consecutive_failures"]
        except Exception as e:  # DB unreachable etc. — keep the loop alive
            logger.error("polling_cycle_error", source=source_code, error=str(e))
            failures = 1
        delay = interval * random.uniform(0.9, 1.1) - (loop.time() - cycle_started)
        if failures:
            delay = max(delay, compute_backoff(failures))
        await sleep_or_stop(stop, max(delay, 1.0))


async def polling_loop(stop: asyncio.Event | None = None) -> None:
    """Run every source in its own loop until ``stop`` is set."""
    stop = stop or asyncio.Event()
    logger.info("polling_loop_started", sources=list(POLL_SOURCES))
    tasks = [asyncio.create_task(_source_loop(code, stop), name=f"poll:{code}") for code in POLL_SOURCES]
    try:
        await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        logger.info("polling_loop_stopped")
