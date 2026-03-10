import uuid
from datetime import datetime
from typing import Sequence

from sqlalchemy import select, update, and_, desc
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import (
    Company,
    Source,
    PollingState,
    RawEvent,
    NormalizedEvent,
    PriceData,
    EventOutbox,
    NotificationRule,
    Notification,
    AuditLog,
)
from src.core.enums import OutboxStatus, Severity


class CompanyRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_ticker(self, ticker: str) -> Company | None:
        result = await self.session.execute(select(Company).where(Company.ticker == ticker))
        return result.scalar_one_or_none()

    async def get_all(self) -> Sequence[Company]:
        result = await self.session.execute(select(Company).where(Company.is_active == True).order_by(Company.ticker))
        return result.scalars().all()

    async def upsert(self, **kwargs) -> Company:
        ticker = kwargs["ticker"]
        existing = await self.get_by_ticker(ticker)
        if existing:
            for k, v in kwargs.items():
                setattr(existing, k, v)
            await self.session.flush()
            return existing
        company = Company(**kwargs)
        self.session.add(company)
        await self.session.flush()
        return company


class SourceRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_code(self, code: str) -> Source | None:
        result = await self.session.execute(select(Source).where(Source.code == code))
        return result.scalar_one_or_none()

    async def get_enabled(self) -> Sequence[Source]:
        result = await self.session.execute(select(Source).where(Source.enabled == True))
        return result.scalars().all()

    async def get_all(self) -> Sequence[Source]:
        result = await self.session.execute(select(Source).order_by(Source.code))
        return result.scalars().all()

    async def upsert(self, **kwargs) -> Source:
        code = kwargs["code"]
        existing = await self.get_by_code(code)
        if existing:
            for k, v in kwargs.items():
                setattr(existing, k, v)
            await self.session.flush()
            return existing
        source = Source(**kwargs)
        self.session.add(source)
        await self.session.flush()
        return source


class PollingStateRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_source_id(self, source_id: uuid.UUID) -> PollingState | None:
        result = await self.session.execute(
            select(PollingState).where(PollingState.source_id == source_id)
        )
        return result.scalar_one_or_none()

    async def upsert(self, source_id: uuid.UUID) -> PollingState:
        existing = await self.get_by_source_id(source_id)
        if existing:
            return existing
        ps = PollingState(source_id=source_id)
        self.session.add(ps)
        await self.session.flush()
        return ps

    async def update_success(
        self,
        source_id: uuid.UUID,
        last_seen_external_id: str | None = None,
        last_seen_published_at: datetime | None = None,
    ) -> None:
        now = datetime.now()
        values = {
            "last_success_at": now,
            "last_attempt_at": now,
            "consecutive_failures": 0,
            "last_error": None,
        }
        if last_seen_external_id is not None:
            values["last_seen_external_id"] = last_seen_external_id
        if last_seen_published_at is not None:
            values["last_seen_published_at"] = last_seen_published_at
        await self.session.execute(
            update(PollingState).where(PollingState.source_id == source_id).values(**values)
        )

    async def update_failure(self, source_id: uuid.UUID, error: str) -> None:
        ps = await self.get_by_source_id(source_id)
        if ps:
            ps.last_attempt_at = datetime.now()
            ps.consecutive_failures = (ps.consecutive_failures or 0) + 1
            ps.last_error = error
            await self.session.flush()

    async def get_all(self) -> Sequence[PollingState]:
        result = await self.session.execute(
            select(PollingState).order_by(PollingState.updated_at.desc())
        )
        return result.scalars().all()


class RawEventRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def insert_if_not_exists(self, **kwargs) -> RawEvent | None:
        content_hash = kwargs["content_hash"]
        source_id = kwargs["source_id"]
        existing = await self.session.execute(
            select(RawEvent).where(
                and_(RawEvent.source_id == source_id, RawEvent.content_hash == content_hash)
            )
        )
        if existing.scalar_one_or_none():
            return None
        raw_event = RawEvent(**kwargs)
        self.session.add(raw_event)
        await self.session.flush()
        return raw_event


class NormalizedEventRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def insert_if_not_exists(self, **kwargs) -> NormalizedEvent | None:
        dedup_key = kwargs["dedup_key"]
        existing = await self.session.execute(
            select(NormalizedEvent).where(NormalizedEvent.dedup_key == dedup_key)
        )
        if existing.scalar_one_or_none():
            return None
        event = NormalizedEvent(**kwargs)
        self.session.add(event)
        await self.session.flush()
        return event

    async def get_list(
        self,
        source_code: str | None = None,
        event_type: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Sequence[NormalizedEvent]:
        q = select(NormalizedEvent)
        if source_code:
            q = q.where(NormalizedEvent.source_code == source_code)
        if event_type:
            q = q.where(NormalizedEvent.event_type == event_type)
        if since:
            q = q.where(NormalizedEvent.published_at >= since)
        if until:
            q = q.where(NormalizedEvent.published_at <= until)
        q = q.order_by(desc(NormalizedEvent.published_at)).limit(limit).offset(offset)
        result = await self.session.execute(q)
        return result.scalars().all()

    async def get_by_id(self, event_id: uuid.UUID) -> NormalizedEvent | None:
        result = await self.session.execute(
            select(NormalizedEvent).where(NormalizedEvent.id == event_id)
        )
        return result.scalar_one_or_none()

    async def get_latest(self) -> Sequence[NormalizedEvent]:
        result = await self.session.execute(
            select(NormalizedEvent).order_by(desc(NormalizedEvent.published_at)).limit(10)
        )
        return result.scalars().all()


class PriceDataRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def insert_if_not_exists(self, **kwargs) -> PriceData | None:
        existing = await self.session.execute(
            select(PriceData).where(
                and_(
                    PriceData.company_id == kwargs["company_id"],
                    PriceData.trading_date == kwargs["trading_date"],
                    PriceData.interval == kwargs["interval"],
                    PriceData.source == kwargs["source"],
                )
            )
        )
        if existing.scalar_one_or_none():
            return None
        price = PriceData(**kwargs)
        self.session.add(price)
        await self.session.flush()
        return price

    async def get_list(
        self,
        ticker: str | None = None,
        since=None,
        until=None,
        interval: str = "1d",
        limit: int = 100,
    ) -> Sequence[PriceData]:
        q = select(PriceData)
        if ticker:
            q = q.where(PriceData.ticker == ticker)
        if since:
            q = q.where(PriceData.trading_date >= since)
        if until:
            q = q.where(PriceData.trading_date <= until)
        q = q.where(PriceData.interval == interval)
        q = q.order_by(desc(PriceData.trading_date)).limit(limit)
        result = await self.session.execute(q)
        return result.scalars().all()

    async def get_latest(self, ticker: str = "AEFES") -> PriceData | None:
        result = await self.session.execute(
            select(PriceData)
            .where(PriceData.ticker == ticker)
            .order_by(desc(PriceData.trading_date))
            .limit(1)
        )
        return result.scalar_one_or_none()


class OutboxRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, normalized_event_id: uuid.UUID, payload: dict) -> EventOutbox:
        entry = EventOutbox(
            normalized_event_id=normalized_event_id,
            payload_json=payload,
            status=OutboxStatus.PENDING,
        )
        self.session.add(entry)
        await self.session.flush()
        return entry

    async def get_pending(self, limit: int = 10) -> Sequence[EventOutbox]:
        result = await self.session.execute(
            select(EventOutbox)
            .where(EventOutbox.status == OutboxStatus.PENDING)
            .order_by(EventOutbox.created_at)
            .limit(limit)
        )
        return result.scalars().all()

    async def mark_done(self, outbox_id: uuid.UUID) -> None:
        await self.session.execute(
            update(EventOutbox)
            .where(EventOutbox.id == outbox_id)
            .values(status=OutboxStatus.DONE, processed_at=datetime.now())
        )

    async def mark_failed(self, outbox_id: uuid.UUID, error: str) -> None:
        await self.session.execute(
            update(EventOutbox)
            .where(EventOutbox.id == outbox_id)
            .values(
                status=OutboxStatus.FAILED,
                last_error=error,
                attempts=EventOutbox.attempts + 1,
            )
        )

    async def get_all(self, limit: int = 50) -> Sequence[EventOutbox]:
        result = await self.session.execute(
            select(EventOutbox).order_by(desc(EventOutbox.created_at)).limit(limit)
        )
        return result.scalars().all()


class NotificationRuleRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_matching(
        self,
        company_id: uuid.UUID,
        source_code: str,
        severity: Severity,
    ) -> Sequence[NotificationRule]:
        severity_order = {Severity.INFO: 0, Severity.WATCH: 1, Severity.HIGH: 2}
        result = await self.session.execute(
            select(NotificationRule).where(
                and_(
                    NotificationRule.company_id == company_id,
                    NotificationRule.enabled == True,
                )
            )
        )
        rules = result.scalars().all()
        return [
            r
            for r in rules
            if severity_order.get(severity, 0) >= severity_order.get(r.min_severity, 0)
            and (not r.source_filters or source_code in r.source_filters)
        ]

    async def get_all(self) -> Sequence[NotificationRule]:
        result = await self.session.execute(select(NotificationRule))
        return result.scalars().all()

    async def create(self, **kwargs) -> NotificationRule:
        rule = NotificationRule(**kwargs)
        self.session.add(rule)
        await self.session.flush()
        return rule


class NotificationRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, **kwargs) -> Notification:
        notif = Notification(**kwargs)
        self.session.add(notif)
        await self.session.flush()
        return notif

    async def exists(self, normalized_event_id: uuid.UUID, email: str) -> bool:
        result = await self.session.execute(
            select(Notification).where(
                and_(
                    Notification.normalized_event_id == normalized_event_id,
                    Notification.email == email,
                )
            )
        )
        return result.scalar_one_or_none() is not None

    async def get_all(self, limit: int = 50) -> Sequence[Notification]:
        result = await self.session.execute(
            select(Notification).order_by(desc(Notification.created_at)).limit(limit)
        )
        return result.scalars().all()


class AuditLogRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def log(self, action: str, entity_type: str | None = None, entity_id: str | None = None, details: dict | None = None) -> None:
        entry = AuditLog(
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            details_json=details,
        )
        self.session.add(entry)
        await self.session.flush()
