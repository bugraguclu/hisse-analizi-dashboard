"""Haber toplama servisi (Faz 2).

Akış:
1. Google News RSS'ten hisse bazlı, ilgililik süzgecinden geçmiş haberler çekilir (adapters/news.py)
2. URL (unique) + şirket bazında başlık tekrarına göre dedup ile ``news_items`` tablosuna yazılır
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Sequence
from datetime import datetime, timedelta, timezone
from typing import Any

import structlog
from sqlalchemy import desc, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.news import fetch_news, fold
from src.db.models import Company, NewsItem

logger = structlog.get_logger(__name__)

_TITLE_DEDUP_WINDOW = timedelta(days=35)


def title_key(title: str) -> str:
    """Normalized headline used to spot the same story under another URL."""
    return re.sub(r"[^a-z0-9]+", " ", fold(title or "")).strip()


async def _recent_title_keys(session: AsyncSession, company_id: Any) -> set[str]:
    since = datetime.now(timezone.utc) - _TITLE_DEDUP_WINDOW
    rows = await session.execute(
        select(NewsItem.title).where(NewsItem.company_id == company_id, NewsItem.published_at >= since)
    )
    return {title_key(str(title)) for (title,) in rows.all()}


async def ingest_for_company(
    session: AsyncSession,
    company: Company,
    exclude_names: Sequence[str] = (),
) -> int:
    """Bir şirketin haberlerini çeker ve dedup ile kaydeder.

    ``exclude_names``: adı bu şirketin adını içeren diğer şirketler (ör. AKSA için
    "Aksa Enerji") — onların haberleri bu şirkete yazılmaz.
    Dönen değer: yeni eklenen haber sayısı.
    """
    ticker = str(company.ticker)
    name = str(company.display_name or company.legal_name or ticker)
    items = await fetch_news(ticker, name, exclude_names=exclude_names)

    new_items: list[NewsItem] = []
    if items:
        seen_titles = await _recent_title_keys(session, company.id)
        for item in items:
            key = title_key(item["title"])
            if not key or key in seen_titles:
                continue
            seen_titles.add(key)
            stmt = (
                pg_insert(NewsItem)
                .values(
                    id=uuid.uuid4(),
                    company_id=company.id,
                    title=item["title"],
                    url=item["url"],
                    snippet=item["snippet"] or None,
                    source_name=item["source_name"] or None,
                    published_at=item["published_at"],
                )
                .on_conflict_do_nothing(index_elements=["url"])
                .returning(NewsItem)
            )
            inserted = (await session.execute(stmt)).scalar_one_or_none()
            if inserted is not None:
                new_items.append(inserted)
        await session.commit()

    logger.info("news_ingested", ticker=ticker, new=len(new_items), fetched=len(items))
    return len(new_items)


async def get_news(session: AsyncSession, company: Company, hours: int = 48) -> list[NewsItem]:
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    res = await session.execute(
        select(NewsItem)
        .where(NewsItem.company_id == company.id, NewsItem.published_at >= since)
        .order_by(desc(NewsItem.published_at))
        .limit(50)
    )
    return list(res.scalars().all())
