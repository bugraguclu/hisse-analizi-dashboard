"""Haber toplama ve AI duygu/etki sınıflandırma servisi (Faz 2).

Akış:
1. Google News RSS'ten hisse bazlı, ilgililik süzgecinden geçmiş haberler çekilir (adapters/news.py)
2. URL (unique) + şirket bazında başlık tekrarına göre dedup ile ``news_items`` tablosuna yazılır
3. Son 48 saatin etiketsiz haberleri (yeniler + LLM erişilemezken gelenler) her turda,
   ``_CLASSIFY_CHUNK_SIZE``'lık LLM çağrılarıyla sınıflandırılır:
   duygu (pozitif/notr/negatif), piyasa etkisi (yuksek/orta/dusuk), kısa gerekçe
4. Sınıflandırma kapalıysa/anahtar yoksa/bütçe dolduysa/kota aşıldıysa haberler etiketsiz
   saklanır ve sonraki turda yeniden denenir; modelin ``_MAX_CLASSIFY_ATTEMPTS`` yanıtta
   etiketleyemediği başlıklar (atlanan, kesik/boş yanıt) bir daha gönderilmez (maliyet).
"""

from __future__ import annotations

import json
import re
import time
import uuid
from collections.abc import Sequence
from datetime import datetime, timedelta, timezone
from typing import Any

import structlog
from sqlalchemy import desc, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.llm import LLMBudgetExceededError, LLMNotConfiguredError, get_llm_client, is_rate_limit_error
from src.adapters.news import fetch_news, fold
from src.core.config import settings
from src.db.models import Company, NewsItem

logger = structlog.get_logger(__name__)

_VALID_SENTIMENT = {"pozitif", "notr", "negatif"}
_VALID_IMPACT = {"yuksek", "orta", "dusuk"}
_TITLE_DEDUP_WINDOW = timedelta(days=35)
# Unlabelled headlines from this window are (re)classified on every cycle, so items that
# arrived while the LLM was unavailable get labelled once it is back.
_CLASSIFY_BACKFILL_WINDOW = timedelta(hours=48)
_CLASSIFY_BATCH_LIMIT = 30
# Headlines per LLM call: ~60-80 output tokens each, so a chunk stays well inside
# max_tokens=2048 (a truncated answer labels nothing and is billed anyway).
_CLASSIFY_CHUNK_SIZE = 15
# Model answers (per headline) without a usable label before the headline is left
# unlabelled instead of being re-sent every cycle for the whole backfill window.
_MAX_CLASSIFY_ATTEMPTS = 3
# news-item id → (answers without a label, published_at); pruned after the window.
_classify_failures: dict[Any, tuple[int, datetime]] = {}
# After a quota / rate-limit error the classifier pauses instead of hammering the provider
# (each call already retries internally) — the same error would repeat for every company.
_CLASSIFY_PAUSE_SECONDS = 30 * 60
_classify_paused_until = 0.0

_CLASSIFY_SYSTEM = """Sen Borsa Istanbul haber siniflandirma asistanisin. Sana bir sirkete ait \
haber basliklari verilecek. Her baslik icin sirket hissesi acisindan degerlendir:
- sentiment: "pozitif" | "notr" | "negatif"
- impact: "yuksek" | "orta" | "dusuk" (hisse fiyatini etkileme olasiligi)
- rationale: en fazla 200 karakter, Turkce, kisa gerekce

SADECE gecerli JSON dizisi dondur, baska hicbir sey yazma. Format:
[{"i": 0, "sentiment": "...", "impact": "...", "rationale": "..."}, ...]
Emin olamadigin basliklara "notr" + "dusuk" ver. Yatirim tavsiyesi verme."""


def _ascii_label(value: Any) -> str:
    """``"Nötr"`` / ``"Yüksek"`` → ``"notr"`` / ``"yuksek"`` (models sometimes add diacritics)."""
    return fold(str(value or "")).strip().lower()


def _extract_json(text: str) -> list[dict]:
    """LLM çıktısından JSON dizisini ayıklar (kod blokları vb. temizlenir)."""
    text = (text or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE).strip()
    start, end = text.find("["), text.rfind("]")
    if start == -1 or end == -1 or end < start:
        return []
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return []
    return [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []


def parse_classification(text: str, count: int) -> dict[int, dict[str, str]]:
    """Validated ``{index: {sentiment, impact, rationale}}`` for indices ``0..count-1``."""
    out: dict[int, dict[str, str]] = {}
    for row in _extract_json(text):
        raw_index = row.get("i")
        if isinstance(raw_index, bool):
            continue
        try:
            idx = int(raw_index) if isinstance(raw_index, (int, float, str)) else -1
        except (TypeError, ValueError):
            continue
        if not 0 <= idx < count or idx in out:
            continue
        sentiment = _ascii_label(row.get("sentiment"))
        impact = _ascii_label(row.get("impact"))
        out[idx] = {
            "sentiment": sentiment if sentiment in _VALID_SENTIMENT else "notr",
            "impact": impact if impact in _VALID_IMPACT else "dusuk",
            "rationale": re.sub(r"\s+", " ", str(row.get("rationale") or "")).strip()[:300],
        }
    return out


async def _classify_titles(
    ticker: str,
    titles: list[str],
    company_name: str | None = None,
) -> dict[int, dict[str, str]] | None:
    """One LLM call. ``None`` when the model gave no answer to judge the headlines by
    (disabled, no key, paused, budget, quota, provider/network error); otherwise the
    labels it produced — possibly none (truncated, empty or unparseable answer)."""
    global _classify_paused_until
    llm = get_llm_client()
    if not settings.ai_news_classify_enabled or not llm.is_configured or not titles:
        return None
    if time.monotonic() < _classify_paused_until:
        return None

    numbered = "\n".join(f"{i}. {t}" for i, t in enumerate(titles))
    subject = f"{company_name} ({ticker})" if company_name else ticker
    user_content = f"Sirket/hisse: {subject}\n\nBasliklar:\n{numbered}"
    try:
        result = await llm.generate(
            _CLASSIFY_SYSTEM, user_content, max_tokens=2048, kind="classification", ticker=ticker
        )
    except LLMBudgetExceededError as e:
        logger.warning("news_classify_budget_exceeded", error=str(e))
        return None
    except LLMNotConfiguredError:
        return None
    except Exception as e:
        if is_rate_limit_error(e):
            _classify_paused_until = time.monotonic() + _CLASSIFY_PAUSE_SECONDS
            logger.warning(
                "news_classify_paused",
                ticker=ticker,
                pause_seconds=_CLASSIFY_PAUSE_SECONDS,
                error=f"{type(e).__name__}: {str(e)[:200]}",
            )
            return None
        logger.warning("news_classify_error", ticker=ticker, error=f"{type(e).__name__}: {str(e)[:300]}")
        # The LLM adapter raises RuntimeError subclasses when the model answered but the
        # answer is unusable (truncated / empty / blocked); SDK and network errors are not.
        return {} if isinstance(e, RuntimeError) else None
    labels = parse_classification(result.text, len(titles))
    if len(labels) < len(titles):
        logger.info("news_classify_partial", ticker=ticker, labelled=len(labels), total=len(titles))
    return labels


async def classify_news_batch(
    ticker: str,
    titles: list[str],
    company_name: str | None = None,
) -> dict[int, dict]:
    """Başlıkları tek çağrıda sınıflandırır. Dönen: {index: {sentiment, impact, rationale}}."""
    return await _classify_titles(ticker, titles, company_name) or {}


def title_key(title: str) -> str:
    """Normalized headline used to spot the same story under another URL."""
    return re.sub(r"[^a-z0-9]+", " ", fold(title or "")).strip()


async def _recent_title_keys(session: AsyncSession, company_id: Any) -> set[str]:
    since = datetime.now(timezone.utc) - _TITLE_DEDUP_WINDOW
    rows = await session.execute(
        select(NewsItem.title).where(NewsItem.company_id == company_id, NewsItem.published_at >= since)
    )
    return {title_key(str(title)) for (title,) in rows.all()}


async def _unlabelled_recent(
    session: AsyncSession, company_id: Any, exclude: Sequence[Any] = ()
) -> list[NewsItem]:
    """Recent headlines without a sentiment label (new ones plus any missed earlier)."""
    since = datetime.now(timezone.utc) - _CLASSIFY_BACKFILL_WINDOW
    conditions = [
        NewsItem.company_id == company_id,
        NewsItem.published_at >= since,
        NewsItem.sentiment.is_(None),
    ]
    if exclude:
        conditions.append(NewsItem.id.not_in(list(exclude)))
    rows = await session.execute(
        select(NewsItem).where(*conditions).order_by(desc(NewsItem.published_at)).limit(_CLASSIFY_BATCH_LIMIT)
    )
    return list(rows.scalars().all())


def _given_up_ids() -> list[Any]:
    """Headlines the model repeatedly answered without labelling (entries expire with the window)."""
    cutoff = datetime.now(timezone.utc) - _CLASSIFY_BACKFILL_WINDOW
    for key in [k for k, (_, published_at) in _classify_failures.items() if published_at < cutoff]:
        del _classify_failures[key]
    return [k for k, (count, _) in _classify_failures.items() if count >= _MAX_CLASSIFY_ATTEMPTS]


async def _classify_backlog(session: AsyncSession, company: Company, ticker: str, name: str) -> int:
    """Label the company's unlabelled recent headlines; returns how many got a label."""
    unlabelled = await _unlabelled_recent(session, company.id, exclude=_given_up_ids())
    labelled = 0
    for start in range(0, len(unlabelled), _CLASSIFY_CHUNK_SIZE):
        chunk = unlabelled[start : start + _CLASSIFY_CHUNK_SIZE]
        labels = await _classify_titles(ticker, [str(n.title) for n in chunk], name)
        if labels is None:
            break  # classifier unavailable: retry next cycle without counting an attempt
        for i, news in enumerate(chunk):
            label = labels.get(i)
            if label:
                news.sentiment = label["sentiment"]
                news.impact = label["impact"]
                news.rationale = label["rationale"] or None
                _classify_failures.pop(news.id, None)
                labelled += 1
            else:
                count = _classify_failures.get(news.id, (0, news.published_at))[0]
                _classify_failures[news.id] = (count + 1, news.published_at)
        if labels:
            await session.commit()  # keep finished chunks if the company times out later
    return labelled


async def ingest_for_company(
    session: AsyncSession,
    company: Company,
    exclude_names: Sequence[str] = (),
) -> int:
    """Bir şirketin haberlerini çeker, dedup ile kaydeder, etiketsizleri sınıflandırır.

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

    # Also when nothing was fetched (feed down): the backlog still needs its labels.
    labelled = await _classify_backlog(session, company, ticker, name)

    logger.info("news_ingested", ticker=ticker, new=len(new_items), fetched=len(items), labelled=labelled)
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
