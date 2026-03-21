import uuid
from typing import Sequence

from sqlalchemy import select, update, and_, desc, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.time import utcnow
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
    FinancialStatement,
    FinancialRatio,
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
        """Atomic upsert using ON CONFLICT on ticker."""
        stmt = pg_insert(Company).values(**kwargs)
        stmt = stmt.on_conflict_do_update(
            index_elements=["ticker"],
            set_={k: v for k, v in kwargs.items() if k != "ticker"},
        )
        stmt = stmt.returning(Company)
        result = await self.session.execute(stmt)
        return result.scalar_one()


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
        """Atomic upsert using ON CONFLICT on code."""
        stmt = pg_insert(Source).values(**kwargs)
        stmt = stmt.on_conflict_do_update(
            index_elements=["code"],
            set_={k: v for k, v in kwargs.items() if k != "code"},
        )
        stmt = stmt.returning(Source)
        result = await self.session.execute(stmt)
        return result.scalar_one()


class PollingStateRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_source_id(self, source_id: uuid.UUID) -> PollingState | None:
        result = await self.session.execute(
            select(PollingState).where(PollingState.source_id == source_id)
        )
        return result.scalar_one_or_none()

    async def upsert(self, source_id: uuid.UUID) -> PollingState:
        """Atomic upsert using ON CONFLICT on source_id."""
        stmt = pg_insert(PollingState).values(source_id=source_id)
        stmt = stmt.on_conflict_do_nothing(index_elements=["source_id"])
        await self.session.execute(stmt)
        # Always return the row
        result = await self.session.execute(
            select(PollingState).where(PollingState.source_id == source_id)
        )
        return result.scalar_one()

    async def update_success(
        self,
        source_id: uuid.UUID,
        last_seen_external_id: str | None = None,
        last_seen_published_at=None,
    ) -> None:
        now = utcnow()
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
        now = utcnow()
        await self.session.execute(
            update(PollingState)
            .where(PollingState.source_id == source_id)
            .values(
                last_attempt_at=now,
                consecutive_failures=PollingState.consecutive_failures + 1,
                last_error=error,
            )
        )

    async def get_all(self) -> Sequence[PollingState]:
        result = await self.session.execute(
            select(PollingState).order_by(PollingState.updated_at.desc())
        )
        return result.scalars().all()


class RawEventRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def insert_if_not_exists(self, **kwargs) -> RawEvent | None:
        """Atomic dedup insert using ON CONFLICT DO NOTHING on (source_id, content_hash)."""
        stmt = pg_insert(RawEvent).values(**kwargs)
        stmt = stmt.on_conflict_do_nothing(
            constraint="uq_raw_events_source_hash",
        )
        stmt = stmt.returning(RawEvent)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()


class NormalizedEventRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def insert_if_not_exists(self, **kwargs) -> NormalizedEvent | None:
        """Atomic dedup insert using ON CONFLICT DO NOTHING on dedup_key."""
        stmt = pg_insert(NormalizedEvent).values(**kwargs)
        stmt = stmt.on_conflict_do_nothing(index_elements=["dedup_key"])
        stmt = stmt.returning(NormalizedEvent)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_list(
        self,
        source_code: str | None = None,
        event_type: str | None = None,
        ticker: str | None = None,
        since=None,
        until=None,
        limit: int = 50,
        offset: int = 0,
    ) -> Sequence[NormalizedEvent]:
        q = select(NormalizedEvent)
        if source_code:
            q = q.where(NormalizedEvent.source_code == source_code)
        if event_type:
            q = q.where(NormalizedEvent.event_type == event_type)
        if ticker:
            q = q.join(Company, NormalizedEvent.company_id == Company.id).where(Company.ticker == ticker.upper())
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
        """Atomic dedup insert using ON CONFLICT DO NOTHING on (company_id, trading_date, interval, source)."""
        stmt = pg_insert(PriceData).values(**kwargs)
        stmt = stmt.on_conflict_do_nothing(
            constraint="uq_price_data_unique",
        )
        stmt = stmt.returning(PriceData)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

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

    async def get_latest(self, ticker: str = "THYAO") -> PriceData | None:
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

    async def claim_pending(self, limit: int = 10) -> Sequence[EventOutbox]:
        """Atomically claim pending outbox entries using SELECT ... FOR UPDATE SKIP LOCKED.

        This prevents concurrent workers from processing the same entries.
        Claimed entries are moved to PROCESSING status.
        """
        now = utcnow()
        # Select and lock rows, skipping already-locked ones
        subq = (
            select(EventOutbox.id)
            .where(EventOutbox.status == OutboxStatus.PENDING)
            .order_by(EventOutbox.created_at)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
        # Update status to PROCESSING
        stmt = (
            update(EventOutbox)
            .where(EventOutbox.id.in_(subq.scalar_subquery()))
            .values(status=OutboxStatus.PROCESSING, updated_at=now)
            .returning(EventOutbox)
        )
        result = await self.session.execute(stmt)
        await self.session.flush()
        return result.scalars().all()

    async def mark_done(self, outbox_id: uuid.UUID) -> None:
        await self.session.execute(
            update(EventOutbox)
            .where(EventOutbox.id == outbox_id)
            .values(status=OutboxStatus.DONE, processed_at=utcnow())
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

    async def reclaim_stuck(self, stuck_seconds: int = 300) -> int:
        """Reclaim entries stuck in PROCESSING state for too long.
        Returns number of reclaimed entries.
        """
        cutoff = utcnow()
        stmt = (
            update(EventOutbox)
            .where(
                and_(
                    EventOutbox.status == OutboxStatus.PROCESSING,
                    EventOutbox.updated_at < text(f"NOW() - INTERVAL '{stuck_seconds} seconds'"),
                )
            )
            .values(status=OutboxStatus.PENDING)
        )
        result = await self.session.execute(stmt)
        return result.rowcount

    async def get_all(self, limit: int = 50) -> Sequence[EventOutbox]:
        result = await self.session.execute(
            select(EventOutbox).order_by(desc(EventOutbox.created_at)).limit(limit)
        )
        return result.scalars().all()

    # Keep get_pending for backward compat in stats queries
    async def get_pending(self, limit: int = 10) -> Sequence[EventOutbox]:
        result = await self.session.execute(
            select(EventOutbox)
            .where(EventOutbox.status == OutboxStatus.PENDING)
            .order_by(EventOutbox.created_at)
            .limit(limit)
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

    async def create_if_not_exists(
        self, **kwargs
    ) -> Notification | None:
        """Atomic dedup insert for notification.
        Returns None if notification already exists (idempotent).
        Uses ON CONFLICT DO NOTHING on (normalized_event_id, email) unique constraint.
        """
        stmt = pg_insert(Notification).values(**kwargs)
        stmt = stmt.on_conflict_do_nothing(
            constraint="uq_notification_event_email",
        )
        stmt = stmt.returning(Notification)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

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


class FinancialStatementRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def upsert(self, **kwargs) -> FinancialStatement:
        """Atomic upsert using ON CONFLICT on (company_id, period, statement_type)."""
        stmt = pg_insert(FinancialStatement).values(**kwargs)
        set_fields = {k: v for k, v in kwargs.items() if k not in ("company_id", "period", "statement_type")}
        stmt = stmt.on_conflict_do_update(
            constraint="uq_financial_statements_period",
            set_=set_fields,
        )
        stmt = stmt.returning(FinancialStatement)
        result = await self.session.execute(stmt)
        return result.scalar_one()

    async def get_for_company(
        self, company_id: uuid.UUID, statement_type: str | None = None
    ) -> Sequence[FinancialStatement]:
        q = select(FinancialStatement).where(FinancialStatement.company_id == company_id)
        if statement_type:
            q = q.where(FinancialStatement.statement_type == statement_type)
        q = q.order_by(desc(FinancialStatement.period))
        result = await self.session.execute(q)
        return result.scalars().all()


class FinancialRatioRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def upsert(self, **kwargs) -> FinancialRatio:
        """Atomic upsert using ON CONFLICT on (company_id, period)."""
        stmt = pg_insert(FinancialRatio).values(**kwargs)
        set_fields = {k: v for k, v in kwargs.items() if k not in ("company_id", "period")}
        stmt = stmt.on_conflict_do_update(
            constraint="uq_financial_ratios_period",
            set_=set_fields,
        )
        stmt = stmt.returning(FinancialRatio)
        result = await self.session.execute(stmt)
        return result.scalar_one()

    async def get_for_company(self, company_id: uuid.UUID) -> Sequence[FinancialRatio]:
        result = await self.session.execute(
            select(FinancialRatio)
            .where(FinancialRatio.company_id == company_id)
            .order_by(desc(FinancialRatio.period))
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
