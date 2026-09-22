"""Haber toplama worker'ı (Faz 2).

Her NEWS_POLL_INTERVAL_SECONDS'ta (varsayılan 15 dk, ±%10 jitter) aktif tüm
şirketler için Google News RSS'i tarar; yeni haberleri dedup ile kaydeder ve
(açıksa) AI ile sınıflandırır. Eş zamanlılık NEWS_FETCH_CONCURRENCY ile, tek
şirket süresi ``_COMPANY_TIMEOUT`` ile sınırlıdır. Tüm tur başarısız olursa
(ör. veritabanı erişilemez) 1 dakikadan başlayıp aralığa kadar büyüyen
geri çekilmeyle yeniden denenir. İptal (shutdown) temiz biçimde yayılır.
"""

from __future__ import annotations

import asyncio
import random
import re

import structlog
from sqlalchemy import select

from src.adapters.news import company_short_name, fold
from src.core.config import settings
from src.db.models import Company
from src.db.session import async_session_factory
from src.services import news_service

logger = structlog.get_logger(__name__)

_COMPANY_TIMEOUT = 120.0
_MIN_BACKOFF = 60.0
_JITTER = 0.1


def exclusion_names(companies: list[tuple[str, str]]) -> dict[str, list[str]]:
    """``{ticker: [longer names of OTHER companies that contain this company's name]}``.

    AKSA ("Aksa") → ["Aksa Enerji"], so Aksa Enerji headlines are not stored for AKSA.
    """
    folded = {ticker: fold(company_short_name(name)).strip() for ticker, name in companies}
    result: dict[str, list[str]] = {}
    for ticker, name in companies:
        own = folded[ticker]
        if not own:
            continue
        pattern = re.compile(rf"(?<![a-z0-9]){re.escape(own)}(?![a-z0-9])")
        result[ticker] = [
            other_name
            for other_ticker, other_name in companies
            if other_ticker != ticker and folded[other_ticker] != own and pattern.search(folded[other_ticker])
        ]
    return result


async def _poll_once() -> int:
    async with async_session_factory() as session:
        companies = list(
            (await session.execute(select(Company).where(Company.is_active.is_(True)))).scalars().all()
        )
    excluded = exclusion_names([(str(c.ticker), str(c.display_name or c.ticker)) for c in companies])

    sem = asyncio.Semaphore(max(1, settings.news_fetch_concurrency))
    counts: list[int] = []

    async def _one(company: Company) -> None:
        ticker = str(company.ticker)
        async with sem:
            try:
                async with async_session_factory() as session:
                    # Company nesnesini bu session'a bağla
                    attached = await session.get(Company, company.id)
                    if attached is not None:
                        added = await asyncio.wait_for(
                            news_service.ingest_for_company(session, attached, excluded.get(ticker, [])),
                            timeout=_COMPANY_TIMEOUT,
                        )
                        counts.append(added)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.warning("news_poll_company_error", ticker=ticker, error=f"{type(e).__name__}: {e}")

    await asyncio.gather(*(_one(c) for c in companies))
    total_new = sum(counts)
    logger.info("news_poll_cycle_done", companies=len(companies), new_items=total_new)
    return total_new


def _next_delay(interval: float, consecutive_failures: int) -> float:
    base = interval
    if consecutive_failures:
        base = min(interval, _MIN_BACKOFF * 2 ** (consecutive_failures - 1))
    return max(1.0, base * random.uniform(1 - _JITTER, 1 + _JITTER))


async def news_loop(stop_event: asyncio.Event | None = None) -> None:
    """Sürekli haber toplama döngüsü (``stop_event`` set edilince ya da iptalde durur)."""
    if not settings.news_poll_enabled:
        logger.info("news_worker_disabled")
        return

    interval = float(max(60, settings.news_poll_interval_seconds))
    logger.info("news_worker_started", interval_s=interval)
    failures = 0
    try:
        while stop_event is None or not stop_event.is_set():
            try:
                await _poll_once()
                failures = 0
            except asyncio.CancelledError:
                raise
            except Exception as e:
                failures += 1
                logger.error("news_poll_cycle_error", error=f"{type(e).__name__}: {e}", failures=failures)
            delay = _next_delay(interval, failures)
            if stop_event is None:
                await asyncio.sleep(delay)
            else:
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=delay)
                except asyncio.TimeoutError:
                    pass
    except asyncio.CancelledError:
        logger.info("news_worker_stopped")
        raise
    logger.info("news_worker_stopped")
