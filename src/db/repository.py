import uuid
from collections.abc import AsyncIterator, Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Literal, Protocol

from sqlalchemy import (
    Boolean,
    ColumnElement,
    Row,
    Select,
    and_,
    delete,
    exists,
    func,
    literal_column,
    or_,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import contains_eager, selectinload

from src.core.enums import (
    SEVERITY_RANK,
    EventCategory,
    EventType,
    NotificationProvider,
    NotificationStatus,
    OutboxStatus,
    PriceInterval,
    Severity,
)
from src.core.time import utcnow
from src.db.models import (
    AIUsage,
    AuditLog,
    Company,
    EventOutbox,
    FinancialRatio,
    FinancialStatement,
    NormalizedEvent,
    Notification,
    NotificationRule,
    PollingState,
    PriceBar,
    RawEvent,
    Source,
)

_MAX_ERROR_LENGTH = 2000


def _truncate_error(error: str) -> str:
    return error if len(error) <= _MAX_ERROR_LENGTH else error[: _MAX_ERROR_LENGTH - 1] + "…"


def escape_like(term: str, escape_char: str = "\\") -> str:
    """Escape LIKE/ILIKE wildcards so user input is matched literally."""
    return (
        term.replace(escape_char, escape_char * 2)
        .replace("%", f"{escape_char}%")
        .replace("_", f"{escape_char}_")
    )


class CompanyRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_ticker(self, ticker: str) -> Company | None:
        result = await self.session.execute(select(Company).where(Company.ticker == ticker))
        return result.scalar_one_or_none()

    async def get_all(self) -> Sequence[Company]:
        result = await self.session.execute(select(Company).where(Company.is_active.is_(True)).order_by(Company.ticker))
        return result.scalars().all()

    async def upsert(self, **kwargs: Any) -> Company:
        """Atomic upsert using ON CONFLICT on ticker."""
        stmt = (
            pg_insert(Company)
            .values(**kwargs)
            .on_conflict_do_update(
                index_elements=["ticker"],
                set_={**{k: v for k, v in kwargs.items() if k != "ticker"}, "updated_at": func.now()},
            )
            .returning(Company)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one()


class SourceRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_code(self, code: str) -> Source | None:
        result = await self.session.execute(select(Source).where(Source.code == code))
        return result.scalar_one_or_none()

    async def get_enabled(self) -> Sequence[Source]:
        result = await self.session.execute(select(Source).where(Source.enabled.is_(True)))
        return result.scalars().all()

    async def get_all(self) -> Sequence[Source]:
        result = await self.session.execute(select(Source).order_by(Source.code))
        return result.scalars().all()

    async def upsert(self, *, keep_existing: Iterable[str] = (), **kwargs: Any) -> Source:
        """Atomic upsert using ON CONFLICT on code.

        ``keep_existing`` names columns that are only set on insert, so operator-tuned
        values (e.g. ``poll_interval_seconds``) survive a re-seed.
        """
        preserved = {"code", *keep_existing}
        stmt = (
            pg_insert(Source)
            .values(**kwargs)
            .on_conflict_do_update(
                index_elements=["code"],
                set_={**{k: v for k, v in kwargs.items() if k not in preserved}, "updated_at": func.now()},
            )
            .returning(Source)
        )
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
        """Create the polling state row if missing (idempotent) and return it."""
        stmt = pg_insert(PollingState).values(source_id=source_id).on_conflict_do_nothing(index_elements=["source_id"])
        await self.session.execute(stmt)
        result = await self.session.execute(
            select(PollingState).where(PollingState.source_id == source_id)
        )
        return result.scalar_one()

    async def update_success(
        self,
        source_id: uuid.UUID,
        last_seen_external_id: str | None = None,
        last_seen_published_at: datetime | None = None,
        warning: str | None = None,
    ) -> None:
        """Record a successful cycle; ``warning`` keeps a note about partial failures."""
        now = utcnow()
        values: dict[str, Any] = {
            "last_success_at": now,
            "last_attempt_at": now,
            "consecutive_failures": 0,
            "last_error": _truncate_error(warning) if warning else None,
        }
        if last_seen_external_id is not None:
            values["last_seen_external_id"] = last_seen_external_id
        if last_seen_published_at is not None:
            values["last_seen_published_at"] = last_seen_published_at
        await self.session.execute(
            update(PollingState).where(PollingState.source_id == source_id).values(**values)
        )

    async def update_failure(self, source_id: uuid.UUID, error: str) -> None:
        await self.session.execute(
            update(PollingState)
            .where(PollingState.source_id == source_id)
            .values(
                last_attempt_at=utcnow(),
                consecutive_failures=PollingState.consecutive_failures + 1,
                last_error=_truncate_error(error),
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

    async def insert_if_not_exists(self, **kwargs: Any) -> RawEvent | None:
        """Atomic dedup insert using ON CONFLICT DO NOTHING on (source_id, company_id, content_hash)."""
        stmt = (
            pg_insert(RawEvent)
            .values(**kwargs)
            .on_conflict_do_nothing(constraint="uq_raw_events_source_company_hash")
            .returning(RawEvent)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()


@dataclass(frozen=True)
class EventFilters:
    """/events filters. ``ticker`` is an exact match; ``search`` is a case-insensitive
    substring match on the title / company name plus a ticker prefix match; the
    category/severity sequences match any of their values."""

    source_code: str | None = None
    event_type: EventType | None = None
    ticker: str | None = None
    categories: Sequence[EventCategory] = ()
    severities: Sequence[Severity] = ()
    since: datetime | None = None
    until: datetime | None = None
    search: str | None = None

    def clauses(self) -> list[ColumnElement[bool]]:
        clauses: list[ColumnElement[bool]] = []
        if self.source_code:
            clauses.append(NormalizedEvent.source_code == self.source_code)
        if self.event_type is not None:
            clauses.append(NormalizedEvent.event_type == self.event_type)
        if self.ticker:
            clauses.append(Company.ticker == self.ticker.strip().upper())
        if self.categories:
            clauses.append(NormalizedEvent.category.in_(list(self.categories)))
        if self.severities:
            clauses.append(NormalizedEvent.severity.in_(list(self.severities)))
        if self.since is not None:
            clauses.append(NormalizedEvent.published_at >= self.since)
        if self.until is not None:
            clauses.append(NormalizedEvent.published_at <= self.until)
        term = (self.search or "").strip()
        if term:
            contains = f"%{escape_like(term)}%"
            clauses.append(
                or_(
                    NormalizedEvent.title.ilike(contains, escape="\\"),
                    Company.display_name.ilike(contains, escape="\\"),
                    Company.ticker.like(f"{escape_like(term.upper())}%", escape="\\"),
                )
            )
        return clauses


def build_event_list_query(
    filters: EventFilters | None = None, *, limit: int = 50, offset: int = 0
) -> Select[tuple[NormalizedEvent]]:
    """One round trip (company joined + eager-loaded), newest first, with ``id`` as a
    stable tie-breaker so offset pagination never skips or repeats rows."""
    return (
        select(NormalizedEvent)
        .join(NormalizedEvent.company)
        .options(contains_eager(NormalizedEvent.company))
        .where(*(filters or EventFilters()).clauses())
        .order_by(NormalizedEvent.published_at.desc(), NormalizedEvent.id.desc())
        .limit(limit)
        .offset(offset)
    )


def build_event_count_query(filters: EventFilters | None = None) -> Select[tuple[int]]:
    return (
        select(func.count())
        .select_from(NormalizedEvent)
        .join(NormalizedEvent.company)
        .where(*(filters or EventFilters()).clauses())
    )


class NormalizedEventRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def insert_if_not_exists(self, **kwargs: Any) -> NormalizedEvent | None:
        """Atomic dedup insert using ON CONFLICT DO NOTHING on dedup_key."""
        stmt = (
            pg_insert(NormalizedEvent)
            .values(**kwargs)
            .on_conflict_do_nothing(index_elements=["dedup_key"])
            .returning(NormalizedEvent)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_list(
        self, filters: EventFilters | None = None, *, limit: int = 50, offset: int = 0
    ) -> Sequence[NormalizedEvent]:
        result = await self.session.execute(build_event_list_query(filters, limit=limit, offset=offset))
        return result.scalars().all()

    async def count(self, filters: EventFilters | None = None) -> int:
        return int((await self.session.execute(build_event_count_query(filters))).scalar_one())

    async def get_by_id(self, event_id: uuid.UUID) -> NormalizedEvent | None:
        result = await self.session.execute(
            select(NormalizedEvent)
            .options(selectinload(NormalizedEvent.company))
            .where(NormalizedEvent.id == event_id)
        )
        return result.scalar_one_or_none()

    async def get_latest(self, limit: int = 10) -> Sequence[NormalizedEvent]:
        return await self.get_list(limit=limit)

    async def iter_classification_batches(
        self, batch_size: int = 500
    ) -> AsyncIterator[Sequence[Row[tuple[uuid.UUID, str | None, str | None, str, Severity, EventCategory | None]]]]:
        """Yield (id, title, excerpt, source_code, severity, category) rows in keyset pages."""
        last_id: uuid.UUID | None = None
        while True:
            q = (
                select(
                    NormalizedEvent.id,
                    NormalizedEvent.title,
                    NormalizedEvent.excerpt,
                    NormalizedEvent.source_code,
                    NormalizedEvent.severity,
                    NormalizedEvent.category,
                )
                .order_by(NormalizedEvent.id)
                .limit(batch_size)
            )
            if last_id is not None:
                q = q.where(NormalizedEvent.id > last_id)
            rows = (await self.session.execute(q)).all()
            if not rows:
                return
            yield rows
            last_id = rows[-1][0]

    async def bulk_update_classification(self, changes: list[dict[str, Any]]) -> None:
        """ORM bulk UPDATE by primary key; each dict holds id, severity, category."""
        if changes:
            await self.session.execute(update(NormalizedEvent), changes)


PriceUpsertOutcome = Literal["inserted", "updated", "unchanged"]
_PRICE_VALUE_COLUMNS = ("open", "high", "low", "close", "volume", "turnover", "vwap", "adjusted", "is_final")


def _interval_value(interval: PriceInterval | str) -> str:
    return interval.value if isinstance(interval, PriceInterval) else str(interval)


class PriceDataRepository:
    """``price_bars``: one series per symbol — unique on (symbol, interval, bar_date)."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def insert_if_not_exists(self, **kwargs: Any) -> PriceBar | None:
        """Atomic dedup insert using ON CONFLICT DO NOTHING on (symbol, interval, bar_date)."""
        stmt = (
            pg_insert(PriceBar)
            .values(**kwargs)
            .on_conflict_do_nothing(constraint="uq_price_bars_symbol_interval_date")
            .returning(PriceBar)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def upsert(self, **kwargs: Any) -> PriceUpsertOutcome:
        """Insert a bar or refresh its values when they changed (the running session's
        bar keeps moving until the close). Unchanged rows are not rewritten."""
        values = {"interval": "1d", **kwargs}
        values["interval"] = _interval_value(values["interval"])
        insert_stmt = pg_insert(PriceBar).values(**values)
        excluded = insert_stmt.excluded
        table = PriceBar.__table__.c
        changed = [col for col in _PRICE_VALUE_COLUMNS if col in values]
        stmt = insert_stmt.on_conflict_do_update(
            constraint="uq_price_bars_symbol_interval_date",
            set_={**{col: excluded[col] for col in changed}, "source": excluded["source"], "fetched_at": func.now()},
            # Postgres: xmax = 0 only for a freshly inserted row version.
            where=or_(*(table[col].is_distinct_from(excluded[col]) for col in changed)),
        ).returning(literal_column("(xmax = 0)", Boolean).label("inserted"))
        row = (await self.session.execute(stmt)).first()
        if row is None:
            return "unchanged"
        return "inserted" if row[0] else "updated"

    def _bars(self, symbol: str, interval: PriceInterval | str) -> Select[tuple[PriceBar]]:
        return (
            select(PriceBar)
            .where(PriceBar.symbol == symbol, PriceBar.interval == _interval_value(interval))
            .order_by(PriceBar.bar_date.desc())
        )

    async def get_list(
        self,
        ticker: str,
        since: date | None = None,
        until: date | None = None,
        interval: PriceInterval | str = PriceInterval.ONE_DAY,
        limit: int = 100,
    ) -> Sequence[PriceBar]:
        q = self._bars(ticker, interval)
        if since is not None:
            q = q.where(PriceBar.bar_date >= since)
        if until is not None:
            q = q.where(PriceBar.bar_date <= until)
        result = await self.session.execute(q.limit(limit))
        return result.scalars().all()

    async def get_latest(self, ticker: str, interval: PriceInterval | str = PriceInterval.ONE_DAY) -> PriceBar | None:
        result = await self.session.execute(self._bars(ticker, interval).limit(1))
        return result.scalar_one_or_none()


PriceBarRepository = PriceDataRepository


@dataclass(frozen=True)
class ClaimedOutboxEntry:
    id: uuid.UUID
    normalized_event_id: uuid.UUID
    attempts: int


def outbox_retry_delay(attempt: int, base_seconds: int, max_seconds: int) -> int:
    """Exponential retry delay after the ``attempt``-th failure (1-based), capped."""
    exponent = min(max(attempt, 1) - 1, 16)
    return int(min(base_seconds * (2**exponent), max_seconds))


class OutboxRepository:
    """Transactional outbox. ``attempts`` counts failed processing attempts; an entry
    that reaches ``max_attempts`` is dead (status=failed) and never retried again."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, normalized_event_id: uuid.UUID, payload: dict[str, Any]) -> EventOutbox:
        entry = EventOutbox(
            normalized_event_id=normalized_event_id,
            payload_json=payload,
            status=OutboxStatus.PENDING,
        )
        self.session.add(entry)
        await self.session.flush()
        return entry

    async def claim_pending(self, limit: int = 10) -> list[ClaimedOutboxEntry]:
        """Atomically claim due pending entries (SELECT ... FOR UPDATE SKIP LOCKED).

        Concurrent workers never receive the same entry; claimed entries move to
        PROCESSING. The caller must commit to publish the claim.
        """
        candidates = (
            select(EventOutbox.id)
            .where(
                EventOutbox.status == OutboxStatus.PENDING,
                or_(EventOutbox.available_at.is_(None), EventOutbox.available_at <= func.now()),
            )
            .order_by(EventOutbox.created_at)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
        stmt = (
            update(EventOutbox)
            .where(EventOutbox.id.in_(candidates.scalar_subquery()))
            .values(status=OutboxStatus.PROCESSING, updated_at=func.now())
            .returning(EventOutbox.id, EventOutbox.normalized_event_id, EventOutbox.attempts)
            .execution_options(synchronize_session=False)
        )
        rows = (await self.session.execute(stmt)).all()
        return [ClaimedOutboxEntry(id=r[0], normalized_event_id=r[1], attempts=r[2]) for r in rows]

    async def mark_done(self, outbox_id: uuid.UUID, note: str | None = None) -> None:
        await self.session.execute(
            update(EventOutbox)
            .where(EventOutbox.id == outbox_id)
            .values(status=OutboxStatus.DONE, processed_at=func.now(), updated_at=func.now(), last_error=note)
            .execution_options(synchronize_session=False)
        )

    async def mark_failed(self, outbox_id: uuid.UUID, error: str) -> None:
        """Dead-letter an entry immediately (non-retryable error)."""
        await self.session.execute(
            update(EventOutbox)
            .where(EventOutbox.id == outbox_id)
            .values(
                status=OutboxStatus.FAILED,
                last_error=_truncate_error(error),
                attempts=EventOutbox.attempts + 1,
                processed_at=func.now(),
                updated_at=func.now(),
            )
            .execution_options(synchronize_session=False)
        )

    async def mark_retry(
        self,
        entry: ClaimedOutboxEntry,
        error: str,
        *,
        max_attempts: int,
        base_delay_seconds: int,
        max_delay_seconds: int,
    ) -> OutboxStatus:
        """Record a failed attempt: requeue with exponential backoff, or dead-letter
        the entry once ``max_attempts`` is reached. Returns the new status."""
        attempts = entry.attempts + 1
        if attempts >= max_attempts:
            status = OutboxStatus.FAILED
            values: dict[str, Any] = {"processed_at": func.now()}
        else:
            status = OutboxStatus.PENDING
            delay = outbox_retry_delay(attempts, base_delay_seconds, max_delay_seconds)
            values = {"available_at": func.now() + timedelta(seconds=delay)}
        await self.session.execute(
            update(EventOutbox)
            .where(EventOutbox.id == entry.id)
            .values(status=status, attempts=attempts, last_error=_truncate_error(error), updated_at=func.now(), **values)
            .execution_options(synchronize_session=False)
        )
        return status

    async def reclaim_stuck(self, stuck_seconds: int = 300, max_attempts: int = 5) -> tuple[int, int]:
        """Recover entries left in PROCESSING by a crashed worker.

        Each recovery counts as a failed attempt, so a poison entry that keeps killing
        the worker is dead-lettered instead of looping forever.
        Returns (requeued, dead_lettered).
        """
        stuck = and_(
            EventOutbox.status == OutboxStatus.PROCESSING,
            EventOutbox.updated_at < func.now() - timedelta(seconds=stuck_seconds),
        )
        note = "processing timed out (worker crashed or stalled)"
        dead = await self.session.execute(
            update(EventOutbox)
            .where(stuck, EventOutbox.attempts + 1 >= max_attempts)
            .values(
                status=OutboxStatus.FAILED,
                attempts=EventOutbox.attempts + 1,
                last_error=note,
                processed_at=func.now(),
                updated_at=func.now(),
            )
            .returning(EventOutbox.id)
            .execution_options(synchronize_session=False)
        )
        dead_count = len(dead.all())
        requeued = await self.session.execute(
            update(EventOutbox)
            .where(stuck)
            .values(
                status=OutboxStatus.PENDING,
                attempts=EventOutbox.attempts + 1,
                last_error=note,
                available_at=func.now(),
                updated_at=func.now(),
            )
            .returning(EventOutbox.id)
            .execution_options(synchronize_session=False)
        )
        return len(requeued.all()), dead_count

    async def purge_processed(self, older_than_days: int) -> int:
        """Delete DONE entries older than the retention window that have no
        notification rows referencing them. Returns the number of deleted rows."""
        referenced = exists().where(Notification.outbox_id == EventOutbox.id)
        result = await self.session.execute(
            delete(EventOutbox)
            .where(
                EventOutbox.status == OutboxStatus.DONE,
                EventOutbox.processed_at < func.now() - timedelta(days=older_than_days),
                ~referenced,
            )
            .returning(EventOutbox.id)
            .execution_options(synchronize_session=False)
        )
        return len(result.all())

    async def get_all(self, limit: int = 50) -> Sequence[EventOutbox]:
        result = await self.session.execute(
            select(EventOutbox).order_by(EventOutbox.created_at.desc()).limit(limit)
        )
        return result.scalars().all()


class RuleLike(Protocol):
    @property
    def min_severity(self) -> Severity: ...
    @property
    def source_filters(self) -> Sequence[str] | None: ...


def rule_matches(rule: RuleLike, source_code: str, severity: Severity) -> bool:
    """Severity threshold + optional source filter."""
    if SEVERITY_RANK.get(severity, 0) < SEVERITY_RANK.get(rule.min_severity, 0):
        return False
    return not rule.source_filters or source_code in rule.source_filters


class NotificationRuleRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_matching(
        self,
        company_id: uuid.UUID,
        source_code: str,
        severity: Severity,
    ) -> list[NotificationRule]:
        rules = await self.get_enabled_by_company([company_id])
        return [r for r in rules.get(company_id, []) if rule_matches(r, source_code, severity)]

    async def get_enabled_by_company(self, company_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, list[NotificationRule]]:
        """All enabled rules for the given companies in one query, grouped by company."""
        grouped: dict[uuid.UUID, list[NotificationRule]] = {}
        if not company_ids:
            return grouped
        result = await self.session.execute(
            select(NotificationRule).where(
                NotificationRule.company_id.in_(set(company_ids)),
                NotificationRule.enabled.is_(True),
            )
        )
        for rule in result.scalars().all():
            grouped.setdefault(rule.company_id, []).append(rule)
        return grouped

    async def get_all(self) -> Sequence[NotificationRule]:
        result = await self.session.execute(select(NotificationRule))
        return result.scalars().all()

    async def create(self, **kwargs: Any) -> NotificationRule:
        rule = NotificationRule(**kwargs)
        self.session.add(rule)
        await self.session.flush()
        return rule


class NotificationRepository:
    """Notification rows double as idempotency records: at most one row per
    (normalized_event_id, email), inserted and committed BEFORE the e-mail is sent."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def claim(
        self,
        *,
        rule_id: uuid.UUID,
        outbox_id: uuid.UUID,
        normalized_event_id: uuid.UUID,
        email: str,
        provider: NotificationProvider,
        subject: str,
        body_text: str,
    ) -> uuid.UUID | None:
        """Claim the right to deliver (event, email). Returns the notification id, or
        None when it was already delivered/claimed. A previous FAILED delivery is
        re-claimed atomically (FAILED -> PENDING) so it can be retried exactly once
        per outbox attempt."""
        inserted = await self.session.execute(
            pg_insert(Notification)
            .values(
                id=uuid.uuid4(),
                rule_id=rule_id,
                outbox_id=outbox_id,
                normalized_event_id=normalized_event_id,
                email=email,
                provider=provider,
                status=NotificationStatus.PENDING,
                subject=subject,
                body_text=body_text,
            )
            .on_conflict_do_nothing(constraint="uq_notification_event_email")
            .returning(Notification.id)
        )
        new_id = inserted.scalar_one_or_none()
        if new_id is not None:
            return new_id
        retried = await self.session.execute(
            update(Notification)
            .where(
                Notification.normalized_event_id == normalized_event_id,
                Notification.email == email,
                Notification.status == NotificationStatus.FAILED,
            )
            .values(
                status=NotificationStatus.PENDING,
                rule_id=rule_id,
                outbox_id=outbox_id,
                provider=provider,
                subject=subject,
                body_text=body_text,
                error_message=None,
                updated_at=func.now(),
            )
            .returning(Notification.id)
            .execution_options(synchronize_session=False)
        )
        return retried.scalar_one_or_none()

    async def mark_sent(self, notification_id: uuid.UUID) -> None:
        await self.session.execute(
            update(Notification)
            .where(Notification.id == notification_id)
            .values(status=NotificationStatus.SENT, sent_at=func.now(), error_message=None, updated_at=func.now())
            .execution_options(synchronize_session=False)
        )

    async def mark_failed(self, notification_id: uuid.UUID, error: str) -> None:
        await self.session.execute(
            update(Notification)
            .where(Notification.id == notification_id)
            .values(status=NotificationStatus.FAILED, error_message=_truncate_error(error), updated_at=func.now())
            .execution_options(synchronize_session=False)
        )

    async def create_if_not_exists(self, **kwargs: Any) -> Notification | None:
        """Atomic dedup insert (ON CONFLICT DO NOTHING on (normalized_event_id, email))."""
        stmt = (
            pg_insert(Notification)
            .values(**kwargs)
            .on_conflict_do_nothing(constraint="uq_notification_event_email")
            .returning(Notification)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def exists(self, normalized_event_id: uuid.UUID, email: str) -> bool:
        result = await self.session.execute(
            select(Notification.id).where(
                Notification.normalized_event_id == normalized_event_id,
                Notification.email == email,
            )
        )
        return result.first() is not None

    async def get_all(self, limit: int = 50) -> Sequence[Notification]:
        result = await self.session.execute(
            select(Notification).order_by(Notification.created_at.desc()).limit(limit)
        )
        return result.scalars().all()


class FinancialStatementRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def upsert(self, **kwargs: Any) -> FinancialStatement:
        """Atomic upsert using ON CONFLICT on (company_id, source, period, statement_type)."""
        key = ("company_id", "source", "period", "statement_type")
        set_fields = {k: v for k, v in kwargs.items() if k not in key}
        set_fields["fetched_at"] = func.now()
        stmt = (
            pg_insert(FinancialStatement)
            .values(**kwargs)
            .on_conflict_do_update(constraint="uq_financial_statements_key", set_=set_fields)
            .returning(FinancialStatement)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one()

    async def get_for_company(
        self, company_id: uuid.UUID, statement_type: str | None = None, source: str | None = None
    ) -> Sequence[FinancialStatement]:
        q = select(FinancialStatement).where(FinancialStatement.company_id == company_id)
        if statement_type:
            q = q.where(FinancialStatement.statement_type == statement_type)
        if source:
            q = q.where(FinancialStatement.source == source)
        q = q.order_by(FinancialStatement.period.desc(), FinancialStatement.source, FinancialStatement.statement_type)
        result = await self.session.execute(q)
        return result.scalars().all()


class FinancialRatioRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def upsert(self, **kwargs: Any) -> FinancialRatio:
        """Atomic upsert using ON CONFLICT on (company_id, period, basis); ``basis`` defaults to annual."""
        values = {"basis": "annual", **kwargs}
        set_fields = {k: v for k, v in values.items() if k not in ("company_id", "period", "basis")}
        set_fields["calculated_at"] = func.now()
        stmt = (
            pg_insert(FinancialRatio)
            .values(**values)
            .on_conflict_do_update(constraint="uq_financial_ratios_period_basis", set_=set_fields)
            .returning(FinancialRatio)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one()

    async def get_for_company(self, company_id: uuid.UUID, basis: str | None = None) -> Sequence[FinancialRatio]:
        q = select(FinancialRatio).where(FinancialRatio.company_id == company_id)
        if basis:
            q = q.where(FinancialRatio.basis == basis)
        result = await self.session.execute(q.order_by(FinancialRatio.period.desc(), FinancialRatio.basis))
        return result.scalars().all()


class StatsRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_counts(self) -> dict[str, int]:
        """All dashboard counters in a single round trip."""

        def count(model: Any, *where: Any) -> Any:
            return select(func.count()).select_from(model).where(*where).scalar_subquery()

        stmt = select(
            count(RawEvent).label("total_raw_events"),
            count(NormalizedEvent).label("total_normalized_events"),
            count(PriceBar).label("total_price_records"),
            count(Notification).label("total_notifications"),
            count(FinancialStatement).label("total_financial_records"),
            count(EventOutbox, EventOutbox.status == OutboxStatus.PENDING).label("pending_outbox"),
        )
        row = (await self.session.execute(stmt)).one()
        return {key: int(value or 0) for key, value in row._mapping.items()}


class AuditLogRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def log(
        self,
        action: str,
        entity_type: str | None = None,
        entity_id: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        entry = AuditLog(
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            details_json=details,
        )
        self.session.add(entry)
        await self.session.flush()


class AIUsageRepository:
    """Billed LLM calls (``ai_usage``) — the source of the shared daily AI budget."""

    def __init__(self, session: AsyncSession):
        self.session = session

    def add(
        self,
        *,
        provider: str,
        model: str,
        kind: str,
        ticker: str | None,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
    ) -> None:
        self.session.add(
            AIUsage(
                provider=provider,
                model=model,
                kind=kind,
                ticker=ticker,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                # 6 decimals = NUMERIC(12, 6); via str() so the float's binary noise is not stored.
                cost_usd=Decimal(str(round(cost_usd, 6))),
            )
        )

    async def cost_between(self, start: datetime, end: datetime) -> float:
        """SUM(cost_usd) for calls made in [start, end)."""
        total = await self.session.scalar(
            select(func.coalesce(func.sum(AIUsage.cost_usd), 0)).where(
                AIUsage.created_at >= start, AIUsage.created_at < end
            )
        )
        return float(total or 0)
