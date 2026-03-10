import asyncio
import random
from datetime import datetime

import structlog

from src.adapters.base import BaseAdapter, BasePriceAdapter
from src.adapters.kap import KAPAdapter
from src.adapters.anadoluefes_news import AnadoluEfesNewsAdapter
from src.adapters.anadoluefes_ir import AnadoluEfesIRAdapter
from src.adapters.price import PriceAdapter
from src.core.config import settings
from src.db.session import async_session_factory
from src.db.repository import (
    CompanyRepository,
    SourceRepository,
    PollingStateRepository,
)
from src.services.event_service import EventService, PriceService

logger = structlog.get_logger(__name__)

ADAPTERS: dict[str, BaseAdapter] = {
    "kap": KAPAdapter(),
    "anadoluefes_news": AnadoluEfesNewsAdapter(),
    "anadoluefes_ir": AnadoluEfesIRAdapter(),
}

PRICE_ADAPTER = PriceAdapter()


async def poll_source(source_code: str) -> dict:
    """Tek bir kaynak için poll çalıştır."""
    started_at = datetime.now()
    stats = {"source": source_code, "started_at": started_at.isoformat()}

    async with async_session_factory() as session:
        try:
            source_repo = SourceRepository(session)
            company_repo = CompanyRepository(session)
            polling_repo = PollingStateRepository(session)

            source = await source_repo.get_by_code(source_code)
            if not source or not source.enabled:
                stats["skipped"] = True
                return stats

            company = await company_repo.get_by_ticker("AEFES")
            if not company:
                stats["error"] = "AEFES company not found"
                return stats

            polling_state = await polling_repo.get_by_source_id(source.id)

            # Check consecutive failures
            if polling_state and polling_state.consecutive_failures >= settings.max_consecutive_failures:
                logger.warning(
                    "source_disabled_too_many_failures",
                    source=source_code,
                    failures=polling_state.consecutive_failures,
                )
                stats["skipped"] = True
                stats["reason"] = "too_many_failures"
                return stats

            if source_code == "price":
                # Price adapter
                records = await PRICE_ADAPTER.fetch_prices(polling_state)
                price_service = PriceService(session)
                result = await price_service.process_prices(records, company)
                stats.update(result)
            elif source_code in ADAPTERS:
                # Event adapters
                adapter = ADAPTERS[source_code]
                events = await adapter.fetch(polling_state)
                event_service = EventService(session)
                result = await event_service.process_raw_events(events, source, company)
                stats.update(result)

                # Update polling state
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
            logger.error("poll_source_error", source=source_code, error=str(e))
            stats["error"] = str(e)
            try:
                if source:
                    await polling_repo.update_failure(source.id, str(e))
                    await session.commit()
            except Exception:
                pass

    ended_at = datetime.now()
    stats["ended_at"] = ended_at.isoformat()
    stats["duration_seconds"] = (ended_at - started_at).total_seconds()
    logger.info("poll_complete", **stats)
    return stats


async def run_all_sources_once() -> list[dict]:
    """Tüm kaynakları bir kez poll et."""
    results = []
    for source_code in ["kap", "anadoluefes_news", "anadoluefes_ir", "price"]:
        result = await poll_source(source_code)
        results.append(result)
    return results


async def polling_loop():
    """Sürekli polling döngüsü."""
    logger.info("polling_loop_started")

    # Source intervals
    intervals = {
        "kap": 30,
        "anadoluefes_news": 60,
        "anadoluefes_ir": 300,
        "price": 300,
    }
    last_poll = {code: 0.0 for code in intervals}

    while True:
        now = asyncio.get_event_loop().time()

        for source_code, interval in intervals.items():
            jitter = random.uniform(-interval * 0.1, interval * 0.1)
            effective_interval = interval + jitter

            if now - last_poll[source_code] >= effective_interval:
                try:
                    await poll_source(source_code)
                except Exception as e:
                    logger.error("polling_loop_error", source=source_code, error=str(e))
                last_poll[source_code] = now

        await asyncio.sleep(5)  # Check every 5 seconds
