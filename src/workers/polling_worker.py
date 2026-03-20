import asyncio
import random
from datetime import datetime

import structlog

from src.adapters.base import BaseAdapter, BasePriceAdapter
from src.adapters.kap import KAPAdapter
from src.adapters.anadoluefes_news import AnadoluEfesNewsAdapter
from src.adapters.anadoluefes_ir import AnadoluEfesIRAdapter
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

ADAPTERS: dict[str, BaseAdapter] = {
    "kap": KAPAdapter(),
    "anadoluefes_news": AnadoluEfesNewsAdapter(),
    "anadoluefes_ir": AnadoluEfesIRAdapter(),
    "financials": FinancialAdapter(),
}

PRICE_ADAPTER = PriceAdapter()


async def poll_source(source_code: str) -> dict:
    """Tüm aktif şirketler için bir kaynağı poll et."""
    started_at = datetime.now()
    stats = {"source": source_code, "started_at": started_at.isoformat(), "companies_processed": 0, "errors": []}

    async with async_session_factory() as session:
        try:
            source_repo = SourceRepository(session)
            company_repo = CompanyRepository(session)
            polling_repo = PollingStateRepository(session)
            event_service = EventService(session)
            price_service = PriceService(session)

            source = await source_repo.get_by_code(source_code)
            if not source or not source.enabled:
                stats["skipped"] = True
                return stats

            # Tüm aktif şirketleri al
            companies = await company_repo.get_active()
            if not companies:
                stats["error"] = "No active companies found"
                return stats

            for company in companies:
                try:
                    # Şirket ve kaynak bazlı polling_state (şu an sadece kaynak bazlı tutuluyor, 
                    # gelecekte (company_id, source_id) bazlı hale getirilebilir)
                    polling_state = await polling_repo.get_by_source_id(source.id)

                    # Check consecutive failures
                    if polling_state and polling_state.consecutive_failures >= settings.max_consecutive_failures:
                        continue

                    if source_code == "price":
                        records = await PRICE_ADAPTER.fetch_prices(company.ticker, polling_state)
                        result = await price_service.process_prices(records, company)
                        stats["companies_processed"] += 1
                        # Update stats with results
                        for k, v in result.items():
                            stats[k] = stats.get(k, 0) + v
                    elif source_code == "financials":
                        adapter = ADAPTERS[source_code]
                        raw_data = await adapter.fetch(company.ticker, polling_state)
                        financial_service = FinancialService(session)
                        result = await financial_service.process_financials(raw_data, company)
                        stats["companies_processed"] += 1
                        # Update stats with results
                        for k, v in result.items():
                            stats[k] = stats.get(k, 0) + v
                        
                        if raw_data:
                            await polling_repo.update_success(
                                source.id,
                                last_seen_external_id=raw_data[0].external_id,
                                last_seen_published_at=raw_data[0].published_at,
                            )
                    elif source_code in ADAPTERS:
                        adapter = ADAPTERS[source_code]
                        events = await adapter.fetch(company.ticker, polling_state)
                        
                        if events:
                            result = await event_service.process_raw_events(events, source, company)
                            # Update stats with results
                            for k, v in result.items():
                                if isinstance(v, int):
                                    stats[k] = stats.get(k, 0) + v
                            
                            # Update polling state (Sadece başarılı fetch'te güncelle)
                            await polling_repo.update_success(
                                source.id,
                                last_seen_external_id=events[0].external_id,
                                last_seen_published_at=events[0].published_at,
                            )
                        stats["companies_processed"] += 1
                except Exception as comp_e:
                    logger.error("poll_company_error", source=source_code, ticker=company.ticker, error=str(comp_e))
                    stats["errors"].append({"ticker": company.ticker, "error": str(comp_e)})

            await session.commit()

        except Exception as e:
            logger.error("poll_source_error", source=source_code, error=str(e))
            stats["error"] = str(e)
            if source:
                try:
                    await polling_repo.update_failure(source.id, str(e))
                    await session.commit()
                except Exception: pass

    ended_at = datetime.now()
    stats["ended_at"] = ended_at.isoformat()
    stats["duration_seconds"] = (ended_at - started_at).total_seconds()
    logger.info("poll_complete", **stats)
    return stats


async def run_all_sources_once() -> list[dict]:
    """Tüm kaynakları bir kez poll et."""
    results = []
    for source_code in ["kap", "anadoluefes_news", "anadoluefes_ir", "price"]:
        result = await poll_source(source_code)
        results.append(result)
    return results


async def polling_loop():
    """Sürekli polling döngüsü."""
    logger.info("polling_loop_started")

    # Source intervals
    intervals = {
        "kap": 30,
        "anadoluefes_news": 60,
        "anadoluefes_ir": 300,
        "price": 300,
        "financials": 3600,  # 1 hour for financials
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
