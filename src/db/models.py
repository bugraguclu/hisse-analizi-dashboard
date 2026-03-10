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
    dedup_key = Column(String(64), unique=True, nullable=False)
    metadata_json = Column(JSONB, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    raw_event = relationship("RawEvent", back_populates="normalized_event")
    company = relationship("Company", back_populates="normalized_events")
    outbox_entries = relationship("EventOutbox", back_populates="normalized_event")


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


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    action = Column(String(100), nullable=False)
    entity_type = Column(String(100), nullable=True)
    entity_id = Column(String(200), nullable=True)
    details_json = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
