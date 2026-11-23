"""Web Push delivery loop (alert_deliveries outbox; see src/services/push_service.py)."""

import asyncio

import structlog

from src.core.config import settings
from src.db.session import async_session_factory
from src.services.push_service import PushService
from src.workers.polling_worker import sleep_or_stop

logger = structlog.get_logger(__name__)

IDLE_INTERVAL_SECONDS = 5.0
BACKLOG_INTERVAL_SECONDS = 0.5
DISABLED_RECHECK_SECONDS = 300.0
PURGE_INTERVAL_SECONDS = 3600.0


async def process_push_once() -> dict[str, int]:
    async with async_session_factory() as session:
        stats = await PushService(session).process_pending()
    if stats.get("claimed") or stats.get("dead_lettered"):
        logger.info("push_processing_complete", **stats)
    return stats


async def purge_push_once() -> int:
    async with async_session_factory() as session:
        return await PushService(session).purge_finished()


async def push_loop(stop: asyncio.Event | None = None) -> None:
    stop = stop or asyncio.Event()
    loop = asyncio.get_running_loop()
    last_purge = float("-inf")
    logger.info("push_loop_started", enabled=settings.push_enabled)
    while not stop.is_set():
        if not settings.push_enabled:
            # VAPID keys missing: alerts can be managed but nothing is sent.
            await sleep_or_stop(stop, DISABLED_RECHECK_SECONDS)
            continue
        delay = IDLE_INTERVAL_SECONDS
        try:
            stats = await process_push_once()
            if stats.get("claimed", 0) >= settings.push_batch_size:
                delay = BACKLOG_INTERVAL_SECONDS
        except Exception as e:
            logger.error("push_loop_error", error=f"{type(e).__name__}: {e}")
        if loop.time() - last_purge >= PURGE_INTERVAL_SECONDS:
            last_purge = loop.time()
            try:
                await purge_push_once()
            except Exception as e:
                logger.error("push_purge_error", error=str(e))
        await sleep_or_stop(stop, delay)
    logger.info("push_loop_stopped")
