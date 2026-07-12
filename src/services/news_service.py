"""Haber toplama ve AI duygu/etki siniflandirma servisi (Faz 2).

Akis:
1. Google News RSS'ten hisse bazli haberler cekilir (adapters/news.py)
2. URL uzerinden dedup ile news_items tablosuna yazilir (ON CONFLICT DO NOTHING)
3. YENI eklenen haberler tek LLM cagrisiyla siniflandirilir:
   duygu (pozitif/notr/negatif), piyasa etkisi (yuksek/orta/dusuk), kisa gerekce
4. Siniflandirma kapaliysa/anahtar yoksa haberler etiketsiz saklanir
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import desc, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.llm import LLMBudgetExceededError, get_llm_client
from src.adapters.news import fetch_news
from src.core.config import settings
from src.db.models import Company, NewsItem

logger = structlog.get_logger(__name__)

_VALID_SENTIMENT = {"pozitif", "notr", "negatif"}
_VALID_IMPACT = {"yuksek", "orta", "dusuk"}

_CLASSIFY_SYSTEM = """Sen Borsa Istanbul haber siniflandirma asistanisin. Sana bir sirkete ait \
haber basliklari verilecek. Her baslik icin sirket hissesi acisindan degerlendir:
- sentiment: "pozitif" | "notr" | "negatif"
- impact: "yuksek" | "orta" | "dusuk" (hisse fiyatini etkileme olasiligi)
- rationale: en fazla 200 karakter, Turkce, kisa gerekce

SADECE gecerli JSON dizisi dondur, baska hicbir sey yazma. Format:
[{"i": 0, "sentiment": "...", "impact": "...", "rationale": "..."}, ...]
Emin olamadigin basliklara "notr" + "dusuk" ver. Yatirim tavsiyesi verme."""


def _extract_json(text: str) -> list[dict]:
    """LLM ciktisindan JSON dizisini ayiklar (kod bloklari vb. temizlenir)."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE).strip()
    start, end = text.find("["), text.rfind("]")
    if start == -1 or end == -1:
        return []
    try:
        data = json.loads(text[start : end + 1])
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


async def classify_news_batch(ticker: str, titles: list[str]) -> dict[int, dict]:
    """Basliklari tek cagrida siniflandirir. Donen: {index: {sentiment, impact, rationale}}."""
    llm = get_llm_client()
    if not settings.ai_news_classify_enabled or not llm.is_configured or not titles:
        return {}

    numbered = "\n".join(f"{i}. {t}" for i, t in enumerate(titles))
    user_content = f"Sirket/hisse: {ticker}\n\nBasliklar:\n{numbered}"
    try:
        result = await llm.generate(_CLASSIFY_SYSTEM, user_content, max_tokens=2048)
    except LLMBudgetExceededError as e:
        logger.warning("news_classify_budget_exceeded", error=str(e))
        return {}
    except Exception as e:
        logger.warning("news_classify_error", ticker=ticker, error=str(e))
        return {}

    out: dict[int, dict] = {}
    for row in _extract_json(result.text):
        try:
            idx = int(row.get("i"))
        except (TypeError, ValueError):
            continue
        sentiment = str(row.get("sentiment", "")).lower().strip()
        impact = str(row.get("impact", "")).lower().strip()
        if sentiment not in _VALID_SENTIMENT:
            sentiment = "notr"
        if impact not in _VALID_IMPACT:
            impact = "dusuk"
        out[idx] = {
            "sentiment": sentiment,
            "impact": impact,
            "rationale": str(row.get("rationale", ""))[:300],
        }
    return out


async def ingest_for_company(session: AsyncSession, company: Company) -> int:
    """Bir sirketin haberlerini ceker, dedup ile kaydeder, yenileri siniflandirir.

    Donen deger: yeni eklenen haber sayisi.
    """
    items = await fetch_news(company.ticker, company.display_name)
    if not items:
        return 0

    new_items: list[NewsItem] = []
    for item in items:
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
        res = await session.execute(stmt)
        inserted = res.scalar_one_or_none()
        if inserted is not None:
            new_items.append(inserted)
    await session.commit()

    if new_items:
        labels = await classify_news_batch(company.ticker, [n.title for n in new_items])
        if labels:
            for i, news in enumerate(new_items):
                label = labels.get(i)
                if label:
                    news.sentiment = label["sentiment"]
                    news.impact = label["impact"]
                    news.rationale = label["rationale"]
            await session.commit()

    logger.info("news_ingested", ticker=company.ticker, new=len(new_items), fetched=len(items))
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


async def news_summary_for_snapshot(session: AsyncSession, company: Company, hours: int = 48) -> dict:
    """AI rapor snapshot'i icin son haberlerin ozeti (duygu dagilimi + basliklar)."""
    news = await get_news(session, company, hours)
    if not news:
        return {}
    counts = {"pozitif": 0, "notr": 0, "negatif": 0}
    for n in news:
        if n.sentiment in counts:
            counts[n.sentiment] += 1
    return {
        "son_saat_araligi": hours,
        "haber_sayisi": len(news),
        "duygu_dagilimi": counts,
        "basliklar": [
            {
                "baslik": n.title,
                "tarih": n.published_at,
                "kaynak": n.source_name,
                "duygu": n.sentiment,
                "etki": n.impact,
            }
            for n in news[:10]
        ],
    }
