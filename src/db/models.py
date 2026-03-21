import uuid
from datetime import datetime, date
from decimal import Decimal

from sqlalchemy import (
    Column,
    String,
    Boolean,
    Integer,
    Float,
    Text,
    DateTime,
    Date,
    ForeignKey,
    UniqueConstraint,
    Index,
    Enum as SAEnum,
    Numeric,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import DeclarativeBase, relationship
from sqlalchemy.sql import func

from src.core.enums import (
    EventType,
    Severity,
    SourceKind,
    OutboxStatus,
    NotificationChannel,
    NotificationFrequency,
    NotificationProvider,
    NotificationStatus,
    PriceInterval,
    EventCategory,
)


class Base(DeclarativeBase):
    pass


class Company(Base):
    __tablename__ = "companies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ticker = Column(String(20), unique=True, nullable=False, index=True)
    legal_name = Column(String(500), nullable=False)
    display_name = Column(String(200), nullable=False)
    isin = Column(String(20), nullable=True)
    exchange = Column(String(20), nullable=True)
    aliases = Column(JSONB, default=list)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    raw_events = relationship("RawEvent", back_populates="company")
    normalized_events = relationship("NormalizedEvent", back_populates="company")
    price_data = relationship("PriceData", back_populates="company")
    notification_rules = relationship("NotificationRule", back_populates="company")
    financial_statements = relationship("FinancialStatement", back_populates="company")
    financial_ratios = relationship("FinancialRatio", back_populates="company")


class Source(Base):
    __tablename__ = "sources"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(50), unique=True, nullable=False, index=True)
    name = Column(String(200), nullable=False)
    base_url = Column(String(500), nullable=True)
    kind = Column(SAEnum(SourceKind), nullable=False)
    poll_interval_seconds = Column(Integer, default=30, nullable=False)
    enabled = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    polling_state = relationship("PollingState", back_populates="source", uselist=False)
    raw_events = relationship("RawEvent", back_populates="source")


class PollingState(Base):
    __tablename__ = "polling_state"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_id = Column(UUID(as_uuid=True), ForeignKey("sources.id"), unique=True, nullable=False)
    last_success_at = Column(DateTime(timezone=True), nullable=True)
    last_attempt_at = Column(DateTime(timezone=True), nullable=True)
    last_seen_external_id = Column(String(200), nullable=True)
    last_seen_published_at = Column(DateTime(timezone=True), nullable=True)
    etag = Column(String(200), nullable=True)
    last_modified = Column(String(200), nullable=True)
    consecutive_failures = Column(Integer, default=0, nullable=False)
    last_error = Column(Text, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    source = relationship("Source", back_populates="polling_state")


class RawEvent(Base):
    __tablename__ = "raw_events"
    __table_args__ = (
        UniqueConstraint("source_id", "content_hash", name="uq_raw_events_source_hash"),
        Index("ix_raw_events_published_at", "published_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_id = Column(UUID(as_uuid=True), ForeignKey("sources.id"), nullable=False)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    external_id = Column(String(200), nullable=True)
    canonical_url = Column(String(1000), nullable=True)
    source_event_type = Column(String(100), nullable=True)
    title = Column(String(1000), nullable=True)
    summary = Column(Text, nullable=True)
    published_at = Column(DateTime(timezone=True), nullable=True)
    fetched_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    content_hash = Column(String(64), nullable=False, index=True)
    raw_payload_json = Column(JSONB, nullable=True)
    raw_payload_text = Column(Text, nullable=True)
    attachment_urls = Column(JSONB, default=list)
    http_status = Column(Integer, nullable=True)
    headers_json = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    source = relationship("Source", back_populates="raw_events")
    company = relationship("Company", back_populates="raw_events")
    normalized_event = relationship("NormalizedEvent", back_populates="raw_event", uselist=False)


class NormalizedEvent(Base):
    __tablename__ = "normalized_events"
    __table_args__ = (
        Index("ix_normalized_events_published_at", "published_at"),
        Index("ix_normalized_events_event_type", "event_type"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    raw_event_id = Column(UUID(as_uuid=True), ForeignKey("raw_events.id"), nullable=False)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    event_type = Column(SAEnum(EventType), nullable=False)
    title = Column(String(1000), nullable=True)
    excerpt = Column(Text, nullable=True)
    body_text = Column(Text, nullable=True)
    published_at = Column(DateTime(timezone=True), nullable=True)
    event_url = Column(String(1000), nullable=True)
    source_code = Column(String(50), nullable=False)
    severity = Column(SAEnum(Severity), nullable=False, default=Severity.INFO)
    is_notifiable = Column(Boolean, default=True, nullable=False)
    category = Column(SAEnum(EventCategory), nullable=True, default=EventCategory.OTHER)
    dedup_key = Column(String(64), unique=True, nullable=False)
    metadata_json = Column(JSONB, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    raw_event = relationship("RawEvent", back_populates="normalized_event")
    company = relationship("Company", back_populates="normalized_events")
    outbox_entries = relationship("EventOutbox", back_populates="normalized_event")

    @property
    def ticker(self) -> str | None:
        return self.company.ticker if self.company else None


class PriceData(Base):
    __tablename__ = "price_data"
    __table_args__ = (
        UniqueConstraint("company_id", "trading_date", "interval", "source", name="uq_price_data_unique"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    ticker = Column(String(20), nullable=False)
    source = Column(String(50), default="borsapy", nullable=False)
    open = Column(Numeric(12, 4), nullable=True)
    high = Column(Numeric(12, 4), nullable=True)
    low = Column(Numeric(12, 4), nullable=True)
    close = Column(Numeric(12, 4), nullable=True)
    adjusted_close = Column(Numeric(12, 4), nullable=True)
    volume = Column(Float, nullable=True)
    trading_date = Column(Date, nullable=False)
    interval = Column(SAEnum(PriceInterval), default=PriceInterval.ONE_DAY, nullable=False)
    fetched_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    company = relationship("Company", back_populates="price_data")


class EventOutbox(Base):
    __tablename__ = "event_outbox"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    normalized_event_id = Column(UUID(as_uuid=True), ForeignKey("normalized_events.id"), nullable=False)
    event_name = Column(String(100), default="NEW_COMPANY_EVENT", nullable=False)
    payload_json = Column(JSONB, nullable=True)
    status = Column(SAEnum(OutboxStatus), default=OutboxStatus.PENDING, nullable=False, index=True)
    attempts = Column(Integer, default=0, nullable=False)
    available_at = Column(DateTime(timezone=True), nullable=True)
    processed_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    normalized_event = relationship("NormalizedEvent", back_populates="outbox_entries")
    notifications = relationship("Notification", back_populates="outbox_entry")


class NotificationRule(Base):
    __tablename__ = "notification_rules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    email = Column(String(320), nullable=False)
    channel = Column(SAEnum(NotificationChannel), default=NotificationChannel.EMAIL, nullable=False)
    frequency = Column(SAEnum(NotificationFrequency), default=NotificationFrequency.INSTANT, nullable=False)
    source_filters = Column(JSONB, default=list)
    min_severity = Column(SAEnum(Severity), default=Severity.INFO, nullable=False)
    enabled = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    company = relationship("Company", back_populates="notification_rules")


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        UniqueConstraint("normalized_event_id", "email", name="uq_notification_event_email"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    rule_id = Column(UUID(as_uuid=True), ForeignKey("notification_rules.id"), nullable=False)
    outbox_id = Column(UUID(as_uuid=True), ForeignKey("event_outbox.id"), nullable=False)
    normalized_event_id = Column(UUID(as_uuid=True), ForeignKey("normalized_events.id"), nullable=False)
    email = Column(String(320), nullable=False)
    provider = Column(SAEnum(NotificationProvider), nullable=False)
    status = Column(SAEnum(NotificationStatus), default=NotificationStatus.PENDING, nullable=False)
    subject = Column(String(500), nullable=True)
    body_text = Column(Text, nullable=True)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    outbox_entry = relationship("EventOutbox", back_populates="notifications")


class FinancialStatement(Base):
    __tablename__ = "financial_statements"
    __table_args__ = (
        UniqueConstraint("company_id", "period", "statement_type", name="uq_financial_statements_period"),
        Index("ix_financial_statements_period", "period"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    period = Column(String(20), nullable=False)
    statement_type = Column(String(50), nullable=False)
    period_type = Column(String(20), nullable=True)
    data_json = Column(JSONB, nullable=False)
    currency = Column(String(10), default="TRY")
    fetched_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    company = relationship("Company", back_populates="financial_statements")


class FinancialRatio(Base):
    __tablename__ = "financial_ratios"
    __table_args__ = (
        UniqueConstraint("company_id", "period", name="uq_financial_ratios_period"),
        Index("ix_financial_ratios_period", "period"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    period = Column(String(20), nullable=False)
    roe = Column(Numeric(12, 4), nullable=True)
    roa = Column(Numeric(12, 4), nullable=True)
    net_margin = Column(Numeric(12, 4), nullable=True)
    gross_margin = Column(Numeric(12, 4), nullable=True)
    ebitda_margin = Column(Numeric(12, 4), nullable=True)
    pe_ratio = Column(Numeric(12, 4), nullable=True)
    pb_ratio = Column(Numeric(12, 4), nullable=True)
    ps_ratio = Column(Numeric(12, 4), nullable=True)
    debt_to_equity = Column(Numeric(12, 4), nullable=True)
    current_ratio = Column(Numeric(12, 4), nullable=True)
    net_debt_ebitda = Column(Numeric(12, 4), nullable=True)
    raw_ratios_json = Column(JSONB, default=dict)
    calculated_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    company = relationship("Company", back_populates="financial_ratios")


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    action = Column(String(100), nullable=False)
    entity_type = Column(String(100), nullable=True)
    entity_id = Column(String(200), nullable=True)
    details_json = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
