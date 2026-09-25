"""SQLAlchemy 2.0 ORM models (typed ``Mapped[...]`` declarations).

The schema is owned by the Alembic migrations in ``alembic/versions``; every change
here must ship with a migration (``alembic revision --autogenerate`` should produce
an empty diff against a database at ``head``).
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.core.enums import (
    EventCategory,
    EventType,
    NotificationChannel,
    NotificationFrequency,
    NotificationProvider,
    NotificationStatus,
    OutboxStatus,
    PriceInterval,
    Severity,
    SourceKind,
)


class Base(DeclarativeBase):
    pass


def _pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def _created_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


def _updated_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class Company(Base):
    __tablename__ = "companies"

    id: Mapped[uuid.UUID] = _pk()
    ticker: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, index=True)
    legal_name: Mapped[str] = mapped_column(String(500), nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    isin: Mapped[str | None] = mapped_column(String(20), nullable=True)
    exchange: Mapped[str | None] = mapped_column(String(20), nullable=True)
    aliases: Mapped[list[str] | None] = mapped_column(JSONB, default=list, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    raw_events: Mapped[list[RawEvent]] = relationship(back_populates="company")
    normalized_events: Mapped[list[NormalizedEvent]] = relationship(back_populates="company")
    price_data: Mapped[list[PriceData]] = relationship(back_populates="company")
    notification_rules: Mapped[list[NotificationRule]] = relationship(back_populates="company")
    financial_statements: Mapped[list[FinancialStatement]] = relationship(back_populates="company")
    financial_ratios: Mapped[list[FinancialRatio]] = relationship(back_populates="company")


class Source(Base):
    __tablename__ = "sources"

    id: Mapped[uuid.UUID] = _pk()
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    base_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    kind: Mapped[SourceKind] = mapped_column(SAEnum(SourceKind), nullable=False)
    poll_interval_seconds: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    polling_state: Mapped[PollingState | None] = relationship(back_populates="source", uselist=False)
    raw_events: Mapped[list[RawEvent]] = relationship(back_populates="source")


class PollingState(Base):
    __tablename__ = "polling_state"

    id: Mapped[uuid.UUID] = _pk()
    source_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sources.id"), unique=True, nullable=False
    )
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_external_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    last_seen_published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    etag: Mapped[str | None] = mapped_column(String(200), nullable=True)
    last_modified: Mapped[str | None] = mapped_column(String(200), nullable=True)
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = _updated_at()

    source: Mapped[Source] = relationship(back_populates="polling_state")


class RawEvent(Base):
    __tablename__ = "raw_events"
    __table_args__ = (
        # Per company: one KAP disclosure can list several stock codes (migration 006).
        UniqueConstraint("source_id", "company_id", "content_hash", name="uq_raw_events_source_company_hash"),
        Index("ix_raw_events_published_at", "published_at"),
    )

    id: Mapped[uuid.UUID] = _pk()
    source_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sources.id"), nullable=False)
    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    external_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    canonical_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    source_event_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    title: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    raw_payload_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    raw_payload_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    attachment_urls: Mapped[list[str] | None] = mapped_column(JSONB, default=list, nullable=True)
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    headers_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = _created_at()

    source: Mapped[Source] = relationship(back_populates="raw_events")
    company: Mapped[Company] = relationship(back_populates="raw_events")
    normalized_event: Mapped[NormalizedEvent | None] = relationship(back_populates="raw_event", uselist=False)


class NormalizedEvent(Base):
    __tablename__ = "normalized_events"
    __table_args__ = (
        Index("ix_normalized_events_published_at", "published_at"),
        Index("ix_normalized_events_event_type", "event_type"),
        # /events filters: ticker, severity and category, each ordered by published_at
        Index("ix_normalized_events_company_published", "company_id", "published_at"),
        Index("ix_normalized_events_severity_published", "severity", "published_at"),
        Index("ix_normalized_events_category_published", "category", "published_at"),
        # One KAP disclosure = one row per concerned company; /events groups rows by URL.
        Index("ix_normalized_events_event_url", "event_url"),
    )

    id: Mapped[uuid.UUID] = _pk()
    raw_event_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("raw_events.id"), nullable=False)
    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    event_type: Mapped[EventType] = mapped_column(SAEnum(EventType), nullable=False)
    title: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    body_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Always set (falls back to the ingestion time, flagged in metadata_json).
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    event_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    source_code: Mapped[str] = mapped_column(String(50), nullable=False)
    severity: Mapped[Severity] = mapped_column(SAEnum(Severity), nullable=False, default=Severity.INFO)
    is_notifiable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    category: Mapped[EventCategory | None] = mapped_column(
        SAEnum(EventCategory), nullable=True, default=EventCategory.OTHER
    )
    dedup_key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=dict, nullable=True)
    # Full disclosure text as display blocks, fetched from KAP on first view (deferred:
    # list queries never load it; read it with an explicit select).
    content_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True, deferred=True)
    content_fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    raw_event: Mapped[RawEvent] = relationship(back_populates="normalized_event")
    company: Mapped[Company] = relationship(back_populates="normalized_events")
    outbox_entries: Mapped[list[EventOutbox]] = relationship(back_populates="normalized_event")

    @property
    def ticker(self) -> str | None:
        return self.company.ticker if self.company else None

    # --- API display helpers (read by EventOut via from_attributes) -------------------

    @property
    def company_name(self) -> str | None:
        return self.company.display_name if self.company else None

    @property
    def tickers(self) -> list[str]:
        """Every tracked company of this disclosure (set by the /events queries), else ``ticker``."""
        related = self.__dict__.get("_related_tickers")
        if related:
            return list(related)
        return [self.ticker] if self.ticker else []

    def set_related_tickers(self, tickers: Iterable[str]) -> None:
        self.__dict__["_related_tickers"] = sorted({t for t in tickers if t})

    @property
    def summary(self) -> str | None:
        """KAP's free-text headline when it says more than the form name (``title``)."""
        excerpt = (self.excerpt or "").strip()
        if not excerpt or excerpt.casefold() == (self.title or "").strip().casefold():
            return None
        return excerpt

    @property
    def category_code(self) -> str | None:
        return self.category.name if self.category is not None else None

    def _meta(self) -> dict[str, Any]:
        return self.metadata_json if isinstance(self.metadata_json, dict) else {}

    @property
    def publisher(self) -> str | None:
        value = self._meta().get("publisher")
        return value if isinstance(value, str) and value else None

    @property
    def is_correction(self) -> bool:
        return self._meta().get("is_correction") is True

    @property
    def attachment_count(self) -> int | None:
        value = self._meta().get("attachment_count")
        return value if isinstance(value, int) and value > 0 else None


class PriceData(Base):
    __tablename__ = "price_data"
    __table_args__ = (
        UniqueConstraint("company_id", "trading_date", "interval", "source", name="uq_price_data_unique"),
        # /prices?ticker=...&interval=... ordered by trading_date
        Index("ix_price_data_ticker_interval_date", "ticker", "interval", "trading_date"),
    )

    id: Mapped[uuid.UUID] = _pk()
    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    ticker: Mapped[str] = mapped_column(String(20), nullable=False)
    source: Mapped[str] = mapped_column(String(50), default="borsapy", nullable=False)
    open: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    high: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    low: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    close: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    adjusted_close: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    volume: Mapped[float | None] = mapped_column(Float, nullable=True)
    trading_date: Mapped[date] = mapped_column(Date, nullable=False)
    interval: Mapped[PriceInterval] = mapped_column(
        SAEnum(PriceInterval), default=PriceInterval.ONE_DAY, nullable=False
    )
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_at: Mapped[datetime] = _created_at()

    company: Mapped[Company] = relationship(back_populates="price_data")


class EventOutbox(Base):
    __tablename__ = "event_outbox"
    __table_args__ = (
        # claim_pending: WHERE status = 'PENDING' ORDER BY created_at
        Index("ix_event_outbox_status_created", "status", "created_at"),
    )

    id: Mapped[uuid.UUID] = _pk()
    normalized_event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("normalized_events.id"), nullable=False
    )
    event_name: Mapped[str] = mapped_column(String(100), default="NEW_COMPANY_EVENT", nullable=False)
    payload_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[OutboxStatus] = mapped_column(
        SAEnum(OutboxStatus), default=OutboxStatus.PENDING, nullable=False, index=True
    )
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Retry backoff: a pending entry is not claimed before this instant (NULL = now).
    available_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    normalized_event: Mapped[NormalizedEvent] = relationship(back_populates="outbox_entries")
    notifications: Mapped[list[Notification]] = relationship(back_populates="outbox_entry")


class NotificationRule(Base):
    __tablename__ = "notification_rules"

    id: Mapped[uuid.UUID] = _pk()
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    channel: Mapped[NotificationChannel] = mapped_column(
        SAEnum(NotificationChannel), default=NotificationChannel.EMAIL, nullable=False
    )
    frequency: Mapped[NotificationFrequency] = mapped_column(
        SAEnum(NotificationFrequency), default=NotificationFrequency.INSTANT, nullable=False
    )
    source_filters: Mapped[list[str] | None] = mapped_column(JSONB, default=list, nullable=True)
    min_severity: Mapped[Severity] = mapped_column(SAEnum(Severity), default=Severity.INFO, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    company: Mapped[Company] = relationship(back_populates="notification_rules")


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        UniqueConstraint("normalized_event_id", "email", name="uq_notification_event_email"),
    )

    id: Mapped[uuid.UUID] = _pk()
    rule_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("notification_rules.id"), nullable=False)
    outbox_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("event_outbox.id"), nullable=False)
    normalized_event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("normalized_events.id"), nullable=False
    )
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    provider: Mapped[NotificationProvider] = mapped_column(SAEnum(NotificationProvider), nullable=False)
    status: Mapped[NotificationStatus] = mapped_column(
        SAEnum(NotificationStatus), default=NotificationStatus.PENDING, nullable=False
    )
    subject: Mapped[str | None] = mapped_column(String(500), nullable=True)
    body_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    outbox_entry: Mapped[EventOutbox] = relationship(back_populates="notifications")


class FinancialStatement(Base):
    __tablename__ = "financial_statements"
    __table_args__ = (
        UniqueConstraint("company_id", "period", "statement_type", name="uq_financial_statements_period"),
        Index("ix_financial_statements_period", "period"),
    )

    id: Mapped[uuid.UUID] = _pk()
    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    period: Mapped[str] = mapped_column(String(20), nullable=False)
    statement_type: Mapped[str] = mapped_column(String(50), nullable=False)
    period_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    data_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    currency: Mapped[str | None] = mapped_column(String(10), default="TRY", nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_at: Mapped[datetime] = _created_at()

    company: Mapped[Company] = relationship(back_populates="financial_statements")


class FinancialRatio(Base):
    __tablename__ = "financial_ratios"
    __table_args__ = (
        UniqueConstraint("company_id", "period", name="uq_financial_ratios_period"),
        Index("ix_financial_ratios_period", "period"),
    )

    id: Mapped[uuid.UUID] = _pk()
    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    period: Mapped[str] = mapped_column(String(20), nullable=False)
    roe: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    roa: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    net_margin: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    gross_margin: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    ebitda_margin: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    pe_ratio: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    pb_ratio: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    ps_ratio: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    debt_to_equity: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    current_ratio: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    net_debt_ebitda: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    raw_ratios_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=dict, nullable=True)
    calculated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    company: Mapped[Company] = relationship(back_populates="financial_ratios")


class NewsItem(Base):
    __tablename__ = "news_items"
    __table_args__ = (
        Index("ix_news_published", "company_id", "published_at"),
    )

    id: Mapped[uuid.UUID] = _pk()
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    url: Mapped[str] = mapped_column(String(1024), unique=True, nullable=False)
    snippet: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = _created_at()

    company: Mapped[Company] = relationship()


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = _pk()
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    details_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = _created_at()
