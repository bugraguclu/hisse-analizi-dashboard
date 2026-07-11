"""Gece toplu AI rapor uretim worker'i (Faz 1).

Her gece settings.ai_nightly_batch_hour saatinde (Europe/Istanbul):
1. Aktif tum sirketler icin snapshot + hash hesaplanir
2. Hash'i DB'deki rapordan farkli olanlar toplanir
3. Saglayiciya gore uretilir:
   - anthropic: Message Batches API'ye tek batch (%50 indirimli)
   - gemini (varsayilan): sirali uretim (flash modeli zaten dusuk maliyetli),
     istekler arasi kisa bekleme ile rate limit korunur
4. Sonuclar ai_reports tablosuna yazilir

AI_NIGHTLY_BATCH_ENABLED=true ve secili saglayicinin API anahtari gerektirir.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime

import pytz
import structlog
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from src.adapters.llm import LLMBudgetExceededError, get_llm_client
from src.core.config import settings
from src.db.models import AIReport, Company
from src.db.session import async_session_factory
from src.services import ai_service

logger = structlog.get_logger(__name__)

_POLL_INTERVAL_S = 60
_BATCH_POLL_S = 60
_BATCH_MAX_WAIT_S = 3 * 3600


async def _collect_stale(session) -> list[dict]:
    """Hash'i mevcut rapordan farkli sirketleri toplar."""
    companies = (
        (await session.execute(select(Company).where(Company.is_active.is_(True))))
        .scalars()
        .all()
    )
    stale: list[dict] = []
    for company in companies:
        try:
            snapshot = await ai_service.build_snapshot(session, company)
            content_hash = ai_service.compute_snapshot_hash(snapshot)
            cached = await ai_service._find_cached(session, content_hash)
            if cached is None:
                stale.append(
                    {
                        "company_id": company.id,
                        "ticker": company.ticker,
                        "snapshot": snapshot,
                        "hash": content_hash,
                    }
                )
        except Exception as e:
            logger.warning("ai_batch_snapshot_error", ticker=company.ticker, error=str(e))
    return stale


async def _run_batch(stale: list[dict]) -> None:
    from anthropic import AsyncAnthropic

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    system_prompt = ai_service.get_system_prompt()

    requests = [
        {
            "custom_id": item["hash"][:60],
            "params": {
                "model": settings.ai_report_model,
                "max_tokens": settings.ai_report_max_tokens,
                "system": [
                    {
                        "type": "text",
                        "text": system_prompt,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                "messages": [
                    {"role": "user", "content": ai_service._user_content(item["snapshot"])}
                ],
            },
        }
        for item in stale
    ]
    by_id = {item["hash"][:60]: item for item in stale}

    batch = await client.messages.batches.create(requests=requests)
    logger.info("ai_batch_submitted", batch_id=batch.id, count=len(requests))

    waited = 0
    while waited < _BATCH_MAX_WAIT_S:
        batch = await client.messages.batches.retrieve(batch.id)
        if batch.processing_status == "ended":
            break
        await asyncio.sleep(_BATCH_POLL_S)
        waited += _BATCH_POLL_S
    else:
        logger.error("ai_batch_timeout", batch_id=batch.id)
        return

    saved = 0
    async with async_session_factory() as session:
        async for result in client.messages.batches.results(batch.id):
            item = by_id.get(result.custom_id)
            if item is None or result.result.type != "succeeded":
                if result.result.type != "succeeded":
                    logger.warning(
                        "ai_batch_item_failed",
                        custom_id=result.custom_id,
                        result_type=result.result.type,
                    )
                continue
            msg = result.result.message
            text = "".join(b.text for b in msg.content if b.type == "text")
            stmt = (
                pg_insert(AIReport)
                .values(
                    id=uuid.uuid4(),
                    company_id=item["company_id"],
                    content_hash=item["hash"],
                    report_text=text,
                    model=settings.ai_report_model,
                    input_tokens=msg.usage.input_tokens,
                    output_tokens=msg.usage.output_tokens,
                    input_data_json=item["snapshot"],
                )
                .on_conflict_do_nothing(index_elements=["content_hash"])
            )
            await session.execute(stmt)
            saved += 1
        await session.commit()
    logger.info("ai_batch_done", batch_id=batch.id, saved=saved)


async def _run_sequential(stale: list[dict]) -> None:
    """Gemini ve digerleri: raporlari tek tek uretir (butce kesici devrede)."""
    llm = get_llm_client()
    system_prompt = ai_service.get_system_prompt()
    saved = 0
    async with async_session_factory() as session:
        for item in stale:
            try:
                result = await llm.generate(system_prompt, ai_service._user_content(item["snapshot"]))
            except LLMBudgetExceededError as e:
                logger.warning("ai_sequential_budget_stop", error=str(e), saved=saved)
                break
            except Exception as e:
                logger.warning("ai_sequential_item_failed", ticker=item["ticker"], error=str(e))
                continue
            stmt = (
                pg_insert(AIReport)
                .values(
                    id=uuid.uuid4(),
                    company_id=item["company_id"],
                    content_hash=item["hash"],
                    report_text=result.text,
                    model=result.model,
                    input_tokens=result.input_tokens,
                    output_tokens=result.output_tokens,
                    input_data_json=item["snapshot"],
                )
                .on_conflict_do_nothing(index_elements=["content_hash"])
            )
            await session.execute(stmt)
            await session.commit()
            saved += 1
            await asyncio.sleep(2)  # rate limit nezaketi
    logger.info("ai_sequential_done", saved=saved, total=len(stale))


async def ai_report_loop() -> None:
    """Gece belirlenen saatte bir kez calisan dongu."""
    llm = get_llm_client()
    if not settings.ai_nightly_batch_enabled or not llm.is_configured:
        logger.info(
            "ai_report_worker_disabled",
            provider=settings.ai_provider,
            enabled=settings.ai_nightly_batch_enabled,
            configured=llm.is_configured,
        )
        return

    tz = pytz.timezone(settings.tz)
    last_run_date = None
    logger.info("ai_report_worker_started", hour=settings.ai_nightly_batch_hour)

    while True:
        now = datetime.now(tz)
        if now.hour == settings.ai_nightly_batch_hour and last_run_date != now.date():
            last_run_date = now.date()
            try:
                async with async_session_factory() as session:
                    stale = await _collect_stale(session)
                logger.info("ai_batch_stale_count", count=len(stale), provider=settings.ai_provider)
                if stale:
                    if settings.ai_provider == "anthropic":
                        await _run_batch(stale)
                    else:
                        await _run_sequential(stale)
            except Exception as e:
                logger.error("ai_batch_run_error", error=str(e))
        await asyncio.sleep(_POLL_INTERVAL_S)
