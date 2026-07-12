"""Haber toplama worker'i (Faz 2).

Her NEWS_POLL_INTERVAL_SECONDS'ta (varsayilan 15 dk) aktif tum sirketler icin
Google News RSS'i tarar; yeni haberleri dedup ile kaydeder ve (aciksa) AI ile
siniflandirir. Es zamanlilik NEWS_FETCH_CONCURRENCY ile sinirlidir.
"""

from __future__ import annotations

import asyncio

import structlog
from sqlalchemy import select

from src.core.config import settings
from src.db.models import Company
from src.db.session import async_session_factory
from src.services import news_service

logger = structlog.get_logger(__name__)


async def _poll_once() -> None:
    async with async_session_factory() as session:
        companies = (
            (await session.execute(select(Company).where(Company.is_active.is_(True))))
            .scalars()
            .all()
        )

    sem = asyncio.Semaphore(settings.news_fetch_concurrency)
    total_new = 0

    async def _one(company: Company) -> None:
        nonlocal total_new
        async with sem:
            try:
                async with async_session_factory() as session:
                    # Company nesnesini bu session'a bagla
                    c = await session.get(Company, company.id)
                    if c is not None:
                        total_new += await news_service.ingest_for_company(session, c)
            except Exception as e:
                logger.warning("news_poll_company_error", ticker=company.ticker, error=str(e))

    await asyncio.gather(*(_one(c) for c in companies))
    logger.info("news_poll_cycle_done", companies=len(companies), new_items=total_new)


async def news_loop() -> None:
    """Surekli haber toplama dongusu."""
    if not settings.news_poll_enabled:
        logger.info("news_worker_disabled")
        return

    logger.info("news_worker_started", interval_s=settings.news_poll_interval_seconds)
    while True:
        try:
            await _poll_once()
        except Exception as e:
            logger.error("news_poll_cycle_error", error=str(e))
        await asyncio.sleep(settings.news_poll_interval_seconds)
