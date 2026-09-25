import asyncio

import structlog

from src.core.config import settings
from src.db.session import async_session_factory
from src.services.notification_service import NotificationService
from src.workers.polling_worker import sleep_or_stop

logger = structlog.get_logger(__name__)

IDLE_INTERVAL_SECONDS = 10.0
BACKLOG_INTERVAL_SECONDS = 0.5  # a full batch was claimed: keep draining
PURGE_INTERVAL_SECONDS = 3600.0


async def process_notifications_once() -> dict[str, int]:
    """Bekleyen bildirimleri bir kez işle."""
    async with async_session_factory() as session:
        stats = await NotificationService(session).process_pending()
    if stats.get("claimed") or stats.get("dead_lettered"):
        logger.info("notification_processing_complete", **stats)
    return stats


async def purge_outbox_once() -> int:
    """Delete processed outbox rows older than OUTBOX_RETENTION_DAYS."""
    async with async_session_factory() as session:
        return await NotificationService(session).purge_processed()


async def notification_loop(stop: asyncio.Event | None = None) -> None:
    """Sürekli bildirim işleme döngüsü (stops cleanly when ``stop`` is set)."""
    stop = stop or asyncio.Event()
    loop = asyncio.get_running_loop()
    last_purge = float("-inf")
    logger.info("notification_loop_started")

    while not stop.is_set():
        delay = IDLE_INTERVAL_SECONDS
        try:
            stats = await process_notifications_once()
            if stats.get("claimed", 0) >= settings.outbox_batch_size:
                delay = BACKLOG_INTERVAL_SECONDS
        except Exception as e:
            logger.error("notification_loop_error", error=str(e))

        if loop.time() - last_purge >= PURGE_INTERVAL_SECONDS:
            last_purge = loop.time()
            try:
                await purge_outbox_once()
            except Exception as e:
                logger.error("outbox_purge_error", error=str(e))

        await sleep_or_stop(stop, delay)
    logger.info("notification_loop_stopped")
