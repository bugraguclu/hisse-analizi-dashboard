"""Hisse bazli haber API endpoint'leri (Faz 2)."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.dependencies import validate_ticker
from src.db.models import Company
from src.db.session import get_db
from src.services import news_service

news_router = APIRouter(prefix="/news", tags=["news"])

DB = Annotated[AsyncSession, Depends(get_db)]


@news_router.get("/{ticker}")
async def get_ticker_news(
    ticker: str,
    db: DB,
    hours: int = Query(default=48, ge=1, le=720),
):
    """Son X saatteki haberler — AI duygu/etki etiketleriyle."""
    t = validate_ticker(ticker)
    company = (
        await db.execute(select(Company).where(Company.ticker == t))
    ).scalar_one_or_none()
    if company is None:
        raise HTTPException(status_code=404, detail=f"{t} veritabaninda bulunamadi")

    items = await news_service.get_news(db, company, hours=hours)
    return {
        "ticker": t,
        "hours": hours,
        "count": len(items),
        "news": [
            {
                "title": n.title,
                "url": n.url,
                "snippet": n.snippet,
                "source": n.source_name,
                "published_at": n.published_at.isoformat() if n.published_at else None,
                "sentiment": n.sentiment,
                "impact": n.impact,
                "rationale": n.rationale,
            }
            for n in items
        ],
    }
