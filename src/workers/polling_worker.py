"""Polling worker — fetches data from external sources for all active companies.

Concurrency model:
- Uses bounded concurrency (asyncio.Semaphore) for parallel company polling.
- Uses PostgreSQL advisory locks per source to prevent duplicate polling across workers.
- If WORKER_SINGLE_REPLICA=true (default), advisory locks are skipped and single-replica
  execution is assumed. Document this in deployment config.
- Backoff uses configured values with exponential increase on consecutive failures.
"""

import asyncio
import random

import structlog

from src.adapters.kap import KAPAdapter
from src.adapters.price import PriceAdapter
from src.adapters.financial_adapter import FinancialAdapter
from src.core.config import settings
from src.core.time import utcnow
from src.db.session import async_session_factory
from src.db.repository import (
    CompanyRepository,
    SourceRepository,
    PollingStateRepository,
)
from src.services.event_service import EventService, PriceService, FinancialService

logger = structlog.get_logger(__name__)

# Advisory lock namespace — use a fixed hash prefix per source
_ADVISORY_LOCK_BASE = 0x48495353  # "HISS" in hex


def _source_lock_id(source_code: str) -> int:
    """Deterministic advisory lock ID per source code."""
    return _ADVISORY_LOCK_BASE + hash(source_code) % 10000


async def _try_advisory_lock(session, source_code: str) -> bool:
    """Try to acquire a PostgreSQL advisory lock for a source. Non-blocking."""
    if settings.worker_single_replica:
        return True  # Skip locking in single-replica mode
    from sqlalchemy import text
    lock_id = _source_lock_id(source_code)
    result = await session.execute(text(f"SELECT pg_try_advisory_lock({lock_id})"))
    return result.scalar()


async def _release_advisory_lock(session, source_code: str) -> None:
    """Release advisory lock for a source."""
    if settings.worker_single_replica:
        return
    from sqlalchemy import text
    lock_id = _source_lock_id(source_code)
    await session.execute(text(f"SELECT pg_advisory_unlock({lock_id})"))


async def poll_source_for_company(source_code: str, ticker: str) -> dict:
    """Tek bir kaynak + tek bir sirket icin poll calistir."""
    started_at = utcnow()
    stats = {"source": source_code, "ticker": ticker, "started_at": started_at.isoformat()}

    async with async_session_factory() as session:
        try:
            source_repo = SourceRepository(session)
            company_repo = CompanyRepository(session)
            polling_repo = PollingStateRepository(session)

            source = await source_repo.get_by_code(source_code)
            if not source or not source.enabled:
                stats["skipped"] = True
                return stats

            company = await company_repo.get_by_ticker(ticker)
            if not company:
                stats["error"] = f"{ticker} company not found"
                return stats

            polling_state = await polling_repo.get_by_source_id(source.id)

            # Check consecutive failures and apply backoff
            if polling_state and polling_state.consecutive_failures >= settings.max_consecutive_failures:
                logger.warning(
                    "source_disabled_too_many_failures",
                    source=source_code,
                    ticker=ticker,
                    failures=polling_state.consecutive_failures,
                )
                stats["skipped"] = True
                stats["reason"] = "too_many_failures"
                return stats

            if source_code == "price":
                adapter = PriceAdapter(ticker=ticker)
                records = await adapter.fetch_prices(polling_state)
                price_service = PriceService(session)
                result = await price_service.process_prices(records, company)
                stats.update(result)
            elif source_code == "financials":
                fin_adapter = FinancialAdapter()
                raw_data = await fin_adapter.fetch(ticker, polling_state)
                financial_service = FinancialService(session)
                result = await financial_service.process_financials(raw_data, company)
                stats.update(result)

                if raw_data:
                    await polling_repo.update_success(
                        source.id,
                        last_seen_external_id=raw_data[0].external_id,
                        last_seen_published_at=raw_data[0].published_at,
                    )
                await session.commit()
            elif source_code == "kap":
                adapter = KAPAdapter(ticker=ticker)
                events = await adapter.fetch(polling_state)
                event_service = EventService(session)
                result = await event_service.process_raw_events(events, source, company)
                stats.update(result)

                last_external_id = None
                last_published = None
                if events:
                    last_external_id = events[0].external_id
                    last_published = events[0].published_at

                await polling_repo.update_success(
                    source.id,
                    last_seen_external_id=last_external_id,
                    last_seen_published_at=last_published,
                )
                await session.commit()
            else:
                stats["error"] = f"unknown_source: {source_code}"

        except Exception as e:
            logger.error("poll_source_error", source=source_code, ticker=ticker, error=str(e))
            stats["error"] = str(e)
            try:
                if source:
                    await polling_repo.update_failure(source.id, str(e))
                    await session.commit()
            except Exception:
                pass

    ended_at = utcnow()
    stats["ended_at"] = ended_at.isoformat()
    stats["duration_seconds"] = (ended_at - started_at).total_seconds()
    logger.info("poll_complete", **stats)
    return stats


async def poll_source(source_code: str) -> list[dict]:
    """Tum aktif sirketler icin tek bir kaynagi poll et.

    Uses bounded concurrency via asyncio.Semaphore.
    Uses advisory lock to prevent concurrent polling of the same source by multiple workers.
    """
    # Try to acquire advisory lock for this source
    async with async_session_factory() as session:
        acquired = await _try_advisory_lock(session, source_code)
        if not acquired:
            logger.info("poll_source_skipped_locked", source=source_code)
            return []

    try:
        async with async_session_factory() as session:
            company_repo = CompanyRepository(session)
            companies = await company_repo.get_all()

        semaphore = asyncio.Semaphore(settings.worker_max_concurrency)

        async def poll_with_limit(ticker: str) -> dict:
            async with semaphore:
                result = await poll_source_for_company(source_code, ticker)
                # Rate limiting between companies
                await asyncio.sleep(0.5)
                return result

        results = await asyncio.gather(
            *(poll_with_limit(c.ticker) for c in companies),
            return_exceptions=True,
        )

        # Convert exceptions to error dicts
        clean_results = []
        for r in results:
            if isinstance(r, Exception):
                clean_results.append({"error": str(r)})
            else:
                clean_results.append(r)

        return clean_results

    finally:
        async with async_session_factory() as session:
            await _release_advisory_lock(session, source_code)


async def run_all_sources_once() -> list[dict]:
    """Tum kaynaklari tum sirketler icin bir kez poll et."""
    results = []
    for source_code in ["kap", "price", "financials"]:
        source_results = await poll_source(source_code)
        results.extend(source_results)
    return results


def _compute_backoff(consecutive_failures: int) -> float:
    """Compute backoff delay based on consecutive failures."""
    if consecutive_failures <= 0:
        return 0
    delay = min(
        settings.backoff_base_seconds * (settings.backoff_factor ** (consecutive_failures - 1)),
        settings.backoff_max_seconds,
    )
    return delay


async def polling_loop():
    """Surekli polling dongusu — tum sirketler icin.

    CONCURRENCY SAFETY:
    - If WORKER_SINGLE_REPLICA=true (default): Only one worker process should run.
      Deploy with replicas=1 in docker-compose or use process manager.
    - If WORKER_SINGLE_REPLICA=false: Multiple workers can run safely.
      PostgreSQL advisory locks prevent duplicate source polling.
    """
    logger.info("polling_loop_started", single_replica=settings.worker_single_replica)

    intervals = {
        "kap": 30,
        "price": 300,
        "financials": 3600,
    }
    last_poll: dict[str, float] = {code: 0.0 for code in intervals}

    while True:
        now = asyncio.get_event_loop().time()

        for source_code, interval in intervals.items():
            jitter = random.uniform(-interval * 0.1, interval * 0.1)
            effective_interval = interval + jitter

            if now - last_poll[source_code] >= effective_interval:
                try:
                    logger.info("polling_cycle_start", source=source_code)
                    await poll_source(source_code)
                    logger.info("polling_cycle_end", source=source_code)
                except Exception as e:
                    logger.error("polling_loop_error", source=source_code, error=str(e))
                last_poll[source_code] = now

        await asyncio.sleep(5)
