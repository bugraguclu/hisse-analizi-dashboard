import uuid
from datetime import datetime

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.base import RawEventData, PriceRecord
from src.core.enums import EventType, Severity, PriceInterval, EventCategory
from src.db.models import Company, Source
from src.services.analysis_service import AnalysisService
from src.parsers.helpers import compute_dedup_key, clean_whitespace, strip_html, make_aware
from src.db.repository import (
    RawEventRepository,
    NormalizedEventRepository,
    PriceDataRepository,
    OutboxRepository,
    CompanyRepository,
    SourceRepository,
    PollingStateRepository,
    NotificationRuleRepository,
    FinancialStatementRepository,
    FinancialRatioRepository,
)
from src.services.analysis_service import AnalysisService

logger = structlog.get_logger(__name__)

SOURCE_TO_EVENT_TYPE = {
    "kap": EventType.KAP_DISCLOSURE,
    "official_news": EventType.OFFICIAL_NEWS,
    "official_ir": EventType.OFFICIAL_IR_UPDATE,
}

SOURCE_TO_SEVERITY = {
    "kap": Severity.WATCH,
    "official_news": Severity.INFO,
    "official_ir": Severity.WATCH,
}

CATEGORY_KEYWORDS = {
    EventCategory.DIVIDEND: ["temettü", "kar payı", "dividend"],
    EventCategory.CAPITAL_INCREASE: ["sermaye artırımı", "bedelli", "bedelsiz", "tahsisli"],
    EventCategory.NEW_BUSINESS: ["yeni iş", "ihale", "sözleşme", "sipariş"],
    EventCategory.LEGAL: ["dava", "hukuki", "ceza", "soruşturma"],
    EventCategory.MANAGEMENT: ["yönetim kurulu", "atama", "istifa", "genel müdür"],
    EventCategory.FINANCIAL_RESULTS: ["finansal rapor", "bilanço", "gelir tablosu", "kar/zarar"],
}


class EventService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.raw_repo = RawEventRepository(session)
        self.norm_repo = NormalizedEventRepository(session)
        self.outbox_repo = OutboxRepository(session)

    def _classify_event(self, title: str, summary: str | None) -> EventCategory:
        text = f"{title} {summary or ''}".lower()
        for category, keywords in CATEGORY_KEYWORDS.items():
            if any(kw in text for kw in keywords):
                return category
        return EventCategory.OTHER

    async def process_raw_events(
        self,
        events: list[RawEventData],
        source: Source,
        company: Company,
    ) -> dict:
        stats = {"new_raw": 0, "new_normalized": 0, "outbox_created": 0, "duplicates": 0}

        for event_data in events:
            # Insert raw event
            raw_event = await self.raw_repo.insert_if_not_exists(
                source_id=source.id,
                company_id=company.id,
                external_id=event_data.external_id,
                canonical_url=event_data.canonical_url,
                source_event_type=event_data.source_event_type,
                title=event_data.title,
                summary=event_data.summary,
                published_at=event_data.published_at,
                content_hash=event_data.content_hash,
                raw_payload_json=event_data.raw_payload_json,
                raw_payload_text=event_data.raw_payload_text,
                attachment_urls=event_data.attachment_urls,
                http_status=event_data.http_status,
                headers_json=event_data.headers_json,
            )

            if raw_event is None:
                stats["duplicates"] += 1
                continue
            stats["new_raw"] += 1

            # Normalize
            source_code = source.code
            event_type = SOURCE_TO_EVENT_TYPE.get(source_code, EventType.KAP_DISCLOSURE)
            severity = SOURCE_TO_SEVERITY.get(source_code, Severity.INFO)

            published_at = event_data.published_at or make_aware(datetime.now())
            category = self._classify_event(event_data.title or "", event_data.summary)
            metadata = {}
            if event_data.published_at is None:
                metadata["published_at_missing"] = True

            dedup_key = compute_dedup_key(
                source_code,
                event_data.canonical_url or "",
                published_at.isoformat(),
                event_data.title or "",
            )

            norm_event = await self.norm_repo.insert_if_not_exists(
                raw_event_id=raw_event.id,
                company_id=company.id,
                event_type=event_type,
                title=clean_whitespace(event_data.title),
                excerpt=clean_whitespace(event_data.summary)[:500] if event_data.summary else None,
                body_text=strip_html(event_data.body_text) if event_data.body_text else None,
                published_at=published_at,
                event_url=event_data.canonical_url,
                source_code=source_code,
                severity=severity,
                is_notifiable=True,
                category=category,
                dedup_key=dedup_key,
                metadata_json=metadata,
            )

            if norm_event is None:
                continue
            stats["new_normalized"] += 1

            # Create outbox entry
            payload = {
                "event_id": str(norm_event.id),
                "event_type": event_type.value,
                "title": norm_event.title,
                "source_code": source_code,
                "severity": severity.value,
                "published_at": published_at.isoformat(),
                "event_url": event_data.canonical_url,
            }
            await self.outbox_repo.create(norm_event.id, payload)
            stats["outbox_created"] += 1

        await self.session.commit()
        return stats


class PriceService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.repo = PriceDataRepository(session)

    async def process_prices(self, records: list[PriceRecord], company: Company) -> dict:
        count = 0
        for rec in records:
            inserted = await self.repo.insert_if_not_exists(
                company_id=company.id,
                ticker=company.ticker,
                source=rec.source,
                open=rec.open,
                high=rec.high,
                low=rec.low,
                close=rec.close,
                volume=rec.volume,
                trading_date=rec.trading_date,
                interval=rec.interval,
            )
            if inserted:
                count += 1
        return {"price_records_inserted": count}


class FinancialService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.repo = FinancialStatementRepository(session)
        self.ratio_repo = FinancialRatioRepository(session)
        self.analysis_service = AnalysisService(session)

    async def process_financials(self, raw_data: list[RawEventData], company: Company) -> dict:
        count = 0
        ratios_calculated = 0
        for raw in raw_data:
            payload = raw.raw_payload_json
            if not payload:
                continue

            statement_type = payload.get("statement_type")
            data = payload.get("data", {})

            # borsapy verisinden dönemleri çıkar (sütunlar dönemlerdir)
            periods = list(data.keys())

            for period in periods:
                # Her dönem için ayrı bir kayıt (veya güncelleme)
                # data formatı: { "2023/12": {"Kalem1": 100, ...}, ... }
                period_data = data.get(period, {})
                
                # JSONB formatı NaN değerlerini desteklemediği için temizliyoruz
                clean_period_data = {}
                for k, v in period_data.items():
                    if isinstance(v, float) and (v != v or v == float('inf') or v == float('-inf')):
                        clean_period_data[k] = None
                    else:
                        clean_period_data[k] = v

                await self.repo.upsert(
                    company_id=company.id,
                    period=period,
                    statement_type=statement_type,
                    data_json=clean_period_data,
                    currency="TRY"  # Varsayılan
                )
                count += 1
                
                # Oranları hesapla ve kaydet (Eğer hem bilanço hem gelir tablosu varsa)
                # Not: Bu her statement eklendiğinde tetiklenir, AnalysisService eksik tablo kontrolü yapar.
                ratios = await self.analysis_service.calculate_ratios(company, period)
                if ratios:
                    await self.ratio_repo.upsert(
                        company_id=company.id,
                        period=period,
                        **ratios
                    )
                    ratios_calculated += 1

        return {
            "financial_records_processed": count,
            "financial_ratios_calculated": ratios_calculated
        }
