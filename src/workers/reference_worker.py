"""Referans verisi worker'ı — şirket evreni (``universe.sync``) ve şirket referans verileri (``reference.company``).

Zamanlama (Europe/Istanbul, ``REFERENCE_*`` ayarları):

* Başlangıçta son başarılı ``universe.sync`` ``REFERENCE_UNIVERSE_STALE_HOURS`` (20 sa) saatten
  eskiyse hemen, sonra her gün ``REFERENCE_UNIVERSE_SYNC_TIME`` (07:30) — TradingView tarayıcısı,
  Borsa İstanbul endeks dosyası ve üç KAP dizini: toplam ~5 istek.
* Her ``REFERENCE_TICK_SECONDS`` (15 dk) uyanır ve vadesi gelmiş en fazla ``REFERENCE_BATCH_SIZE``
  (2) çekirdek şirketi yeniler: ``reference_updated_at`` boş ya da
  ``REFERENCE_COMPANY_REFRESH_DAYS`` (7 gün) günden eski olanlar, en eskisi önce. Böylece ~100
  çekirdek şirket güne yayılır (şirket başına ~15-25 sn: İş Yatırım "sermaye" ~10 sn, şirket kartı,
  hedeffiyat, KAP genel sayfası + beklenen bildirimler). Aynı anda en fazla
  ``REFERENCE_CONCURRENCY`` (2) şirket, her şirketten sonra ``REFERENCE_COMPANY_DELAY_SECONDS``
  bekleme; KAP istekleri ayrıca süreç genelindeki KAP kapısından geçer.
* Eksik biten yenileme ``REFERENCE_RETRY_FAILED_HOURS`` (6 sa) boyunca tekrar denenmez
  (bellekte tutulur; süreç yeniden başlarsa hemen denenir).

``universe.sync`` PostgreSQL advisory kilidiyle korunur (``polling_worker.source_lock``), böylece
yönetici tetiklemesi ile worker aynı anda senkronize etmez.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, time as dtime, timedelta
from typing import Any

import structlog

from src.adapters.utils import InvalidInputError, normalize_symbol
from src.core.config import settings
from src.core.time import utcnow
from src.db.repositories.reference import UniverseRepository
from src.db.session import async_session_factory
from src.services.reference_service import refresh_company
from src.services.universe_service import JOB_UNIVERSE_SYNC, last_successful_sync, sync_universe
from src.workers.polling_worker import sleep_or_stop, source_lock

logger = structlog.get_logger(__name__)


def _now_istanbul() -> datetime:
    from src.adapters.price import now_istanbul

    return now_istanbul()


def parse_hhmm(value: str, default: dtime = dtime(7, 30)) -> dtime:
    try:
        hour, minute = (int(part) for part in value.strip().split(":", 1))
        return dtime(hour, minute)
    except (ValueError, AttributeError):
        logger.warning("reference_bad_time_setting", value=value)
        return default


def next_daily_run(now: datetime, at: dtime) -> datetime:
    """Next occurrence of ``at`` (same tz as ``now``) strictly after ``now``."""
    candidate = now.replace(hour=at.hour, minute=at.minute, second=0, microsecond=0)
    return candidate if candidate > now else candidate + timedelta(days=1)


async def universe_sync_due(stale_after: timedelta) -> bool:
    async with async_session_factory() as session:
        last = await last_successful_sync(session)
    return last is None or utcnow() - last > stale_after


async def run_universe_sync() -> dict[str, Any]:
    """``universe.sync`` under the advisory lock; never raises (errors are returned/logged)."""
    try:
        async with source_lock(JOB_UNIVERSE_SYNC) as acquired:
            if not acquired:
                logger.info("universe_sync_skipped_locked")
                return {"skipped": "locked"}
            return await sync_universe()
    except Exception as e:
        logger.error("universe_sync_failed", error=f"{type(e).__name__}: {e}")
        return {"error": f"{type(e).__name__}: {e}"}


async def refresh_many(
    tickers: list[str],
    *,
    stop: asyncio.Event | None = None,
    concurrency: int | None = None,
    delay_seconds: float | None = None,
) -> list[dict[str, Any]]:
    """``reference.company`` for ``tickers`` — at most ``concurrency`` at a time, polite pauses."""
    stop_event = stop or asyncio.Event()
    semaphore = asyncio.Semaphore(max(1, concurrency or settings.reference_concurrency))
    pause = settings.reference_company_delay_seconds if delay_seconds is None else delay_seconds

    async def one(ticker: str) -> dict[str, Any]:
        async with semaphore:
            if stop_event.is_set():
                return {"ticker": ticker, "skipped": "shutdown"}
            try:
                result = await refresh_company(ticker)
            except Exception as e:  # run_job already recorded the failure
                logger.warning("reference_company_failed", ticker=ticker, error=f"{type(e).__name__}: {e}")
                result = {"ticker": ticker, "complete": False, "error": f"{type(e).__name__}: {e}"[:300]}
            if pause > 0:
                await sleep_or_stop(stop_event, pause)
            return result

    return list(await asyncio.gather(*(one(t) for t in tickers)))


async def due_core_tickers(limit: int | None) -> list[str]:
    refreshed_before = utcnow() - timedelta(days=settings.reference_company_refresh_days)
    async with async_session_factory() as session:
        return await UniverseRepository(session).due_core_tickers(refreshed_before=refreshed_before, limit=limit)


async def refresh_tick(stop: asyncio.Event, retry_after: dict[str, float]) -> list[dict[str, Any]]:
    """One worker tick: refresh up to ``REFERENCE_BATCH_SIZE`` due core companies."""
    loop = asyncio.get_running_loop()
    now = loop.time()
    due = await due_core_tickers(limit=None)
    batch = [t for t in due if retry_after.get(t, 0.0) <= now][: max(1, settings.reference_batch_size)]
    if not batch:
        return []
    results = await refresh_many(batch, stop=stop)
    for result in results:
        ticker = str(result.get("ticker"))
        if result.get("complete"):
            retry_after.pop(ticker, None)
        elif not result.get("skipped"):
            retry_after[ticker] = loop.time() + settings.reference_retry_failed_hours * 3600
    logger.info(
        "reference_tick",
        refreshed=[r.get("ticker") for r in results],
        complete=sum(1 for r in results if r.get("complete")),
        due=len(due),
    )
    return results


async def reference_loop(stop: asyncio.Event) -> None:
    """Worker loop (wired by ``run_workers.DATA_PLATFORM_LOOPS``)."""
    if not settings.reference_worker_enabled:
        logger.info("reference_worker_disabled")
        return
    logger.info("reference_loop_started")
    sync_at = parse_hhmm(settings.reference_universe_sync_time)
    retry_after: dict[str, float] = {}
    try:
        if await universe_sync_due(timedelta(hours=settings.reference_universe_stale_hours)):
            await run_universe_sync()
    except Exception as e:  # DB unreachable at start-up: try again at the scheduled time
        logger.error("reference_startup_sync_check_failed", error=f"{type(e).__name__}: {e}")
    next_sync = next_daily_run(_now_istanbul(), sync_at)
    while not stop.is_set():
        if _now_istanbul() >= next_sync:
            await run_universe_sync()
            next_sync = next_daily_run(_now_istanbul(), sync_at)
        try:
            await refresh_tick(stop, retry_after)
        except Exception as e:  # keep the loop alive (DB hiccup etc.)
            logger.error("reference_tick_failed", error=f"{type(e).__name__}: {e}")
        until_sync = (next_sync - _now_istanbul()).total_seconds()
        await sleep_or_stop(stop, max(1.0, min(float(settings.reference_tick_seconds), until_sync)))
    logger.info("reference_loop_stopped")


async def run_reference_once(tickers: list[str] | None = None) -> dict[str, Any]:
    """Manual/admin run: ``universe.sync`` then ``reference.company`` for ``tickers``.

    Without ``tickers`` the due core companies are refreshed, at most
    ``REFERENCE_ONCE_MAX_COMPANIES`` of them. Returns the sync summary, per-company
    results and the resulting row counts.
    """
    universe = await run_universe_sync()
    if tickers is None:
        selected = await due_core_tickers(limit=settings.reference_once_max_companies)
    else:
        selected = []
        for raw in tickers:
            try:
                symbol = normalize_symbol(raw)
            except InvalidInputError:
                continue
            if symbol not in selected:
                selected.append(symbol)
    companies = await refresh_many(selected)
    async with async_session_factory() as session:
        counts = await UniverseRepository(session).counts()
    summary = {k: v for k, v in universe.items() if k not in ("core", "previous_core", "skipped_non_equity")}
    return {"universe": summary, "companies": companies, "counts": counts}
