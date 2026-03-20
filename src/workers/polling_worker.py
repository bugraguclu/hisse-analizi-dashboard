import asyncio
import random
from datetime import datetime

import structlog

from src.adapters.base import BaseAdapter, BasePriceAdapter
from src.adapters.kap import KAPAdapter
from src.adapters.price import PriceAdapter
from src.adapters.financial_adapter import FinancialAdapter
from src.core.config import settings
from src.db.session import async_session_factory
from src.db.repository import (
    CompanyRepository,
    SourceRepository,
    PollingStateRepository,
)
from src.services.event_service import EventService, PriceService, FinancialService

logger = structlog.get_logger(__name__)


async def poll_source_for_company(source_code: str, ticker: str) -> dict:
    """Tek bir kaynak + tek bir şirket için poll çalıştır."""
    started_at = datetime.now()
    stats = {"source": source_code, "ticker": ticker, "started_at": started_at.isoformat()}

    async with async_session_factory() as session:
        try:
            source_repo = SourceRepository(session)
            company_repo = CompanyRepository(session)
            polling_repo = PollingStateRepository(session)

            source = await source_repo.get_by_code(source_code)
            if not source or not source.enabled:
                stats["skipped"] = True
                return stats

            company = await company_repo.get_by_ticker(ticker)
            if not company:
                stats["error"] = f"{ticker} company not found"
                return stats

            polling_state = await polling_repo.get_by_source_id(source.id)

            # Check consecutive failures
            if polling_state and polling_state.consecutive_failures >= settings.max_consecutive_failures:
                logger.warning(
                    "source_disabled_too_many_failures",
                    source=source_code,
                    ticker=ticker,
                    failures=polling_state.consecutive_failures,
                )
                stats["skipped"] = True
                stats["reason"] = "too_many_failures"
                return stats

            if source_code == "price":
                adapter = PriceAdapter(ticker=ticker)
                records = await adapter.fetch_prices(polling_state)
                price_service = PriceService(session)
                result = await price_service.process_prices(records, company)
                stats.update(result)
            elif source_code == "financials":
                fin_adapter = FinancialAdapter()
                raw_data = await fin_adapter.fetch(ticker, polling_state)
                financial_service = FinancialService(session)
                result = await financial_service.process_financials(raw_data, company)
                stats.update(result)

                if raw_data:
                    await polling_repo.update_success(
                        source.id,
                        last_seen_external_id=raw_data[0].external_id,
                        last_seen_published_at=raw_data[0].published_at,
                    )
                await session.commit()
            elif source_code == "kap":
                adapter = KAPAdapter(ticker=ticker)
                events = await adapter.fetch(polling_state)
                event_service = EventService(session)
                result = await event_service.process_raw_events(events, source, company)
                stats.update(result)

                # Update polling state
                last_external_id = None
                last_published = None
                if events:
                    last_external_id = events[0].external_id
                    last_published = events[0].published_at

                await polling_repo.update_success(
                    source.id,
                    last_seen_external_id=last_external_id,
                    last_seen_published_at=last_published,
                )
                await session.commit()
            else:
                stats["error"] = f"unknown_source: {source_code}"

        except Exception as e:
            logger.error("poll_source_error", source=source_code, ticker=ticker, error=str(e))
            stats["error"] = str(e)
            try:
                if source:
                    await polling_repo.update_failure(source.id, str(e))
                    await session.commit()
            except Exception:
                pass

    ended_at = datetime.now()
    stats["ended_at"] = ended_at.isoformat()
    stats["duration_seconds"] = (ended_at - started_at).total_seconds()
    logger.info("poll_complete", **stats)
    return stats


async def poll_source(source_code: str) -> list[dict]:
    """Tüm aktif şirketler için tek bir kaynağı poll et."""
    results = []
    async with async_session_factory() as session:
        company_repo = CompanyRepository(session)
        companies = await company_repo.get_all()

    for company in companies:
        result = await poll_source_for_company(source_code, company.ticker)
        results.append(result)
        # Rate limiting: şirketler arası kısa bekleme
        await asyncio.sleep(1)

    return results


async def run_all_sources_once() -> list[dict]:
    """Tüm kaynakları tüm şirketler için bir kez poll et."""
    results = []
    for source_code in ["kap", "price", "financials"]:
        source_results = await poll_source(source_code)
        results.extend(source_results)
    return results


async def polling_loop():
    """Sürekli polling döngüsü — tüm şirketler için."""
    logger.info("polling_loop_started")

    # Source intervals
    intervals = {
        "kap": 30,
        "price": 300,
        "financials": 3600,  # saatte bir — finansal tablolar sik degismez
    }
    last_poll = {code: 0.0 for code in intervals}

    while True:
        now = asyncio.get_event_loop().time()

        for source_code, interval in intervals.items():
            jitter = random.uniform(-interval * 0.1, interval * 0.1)
            effective_interval = interval + jitter

            if now - last_poll[source_code] >= effective_interval:
                try:
                    await poll_source(source_code)
                except Exception as e:
                    logger.error("polling_loop_error", source=source_code, error=str(e))
                last_poll[source_code] = now

        await asyncio.sleep(5)  # Check every 5 seconds
