import asyncio

import structlog

from src.db.session import async_session_factory
from src.services.notification_service import NotificationService

logger = structlog.get_logger(__name__)


async def process_notifications_once() -> dict:
    """Bekleyen bildirimleri bir kez işle."""
    async with async_session_factory() as session:
        service = NotificationService(session)
        stats = await service.process_pending()
        logger.info("notification_processing_complete", **stats)
        return stats


async def notification_loop():
    """Sürekli bildirim işleme döngüsü."""
    logger.info("notification_loop_started")

    while True:
        try:
            await process_notifications_once()
        except Exception as e:
            logger.error("notification_loop_error", error=str(e))

        await asyncio.sleep(10)  # Check every 10 seconds
