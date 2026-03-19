from datetime import datetime, date
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field
from src.core.enums import EventType, Severity, OutboxStatus, NotificationStatus, PriceInterval


class CompanyOut(BaseModel):
    id: UUID
    ticker: str
    legal_name: str
    display_name: str
    isin: str | None = None
    exchange: str | None = None
    is_active: bool
    model_config = {"from_attributes": True}


class SourceOut(BaseModel):
    id: UUID
    code: str
    name: str
    base_url: str | None = None
    kind: str
    poll_interval_seconds: int
    enabled: bool
    model_config = {"from_attributes": True}


class EventOut(BaseModel):
    id: UUID
    event_type: EventType
    title: str | None = None
    excerpt: str | None = None
    published_at: datetime | None = None
    event_url: str | None = None
    source_code: str
    severity: Severity
    is_notifiable: bool
    created_at: datetime
    model_config = {"from_attributes": True}


class EventDetailOut(EventOut):
    body_text: str | None = None
    metadata_json: dict | None = None
    raw_event_id: UUID


class PriceOut(BaseModel):
    id: UUID
    ticker: str
    source: str
    open: Decimal | None = None
    high: Decimal | None = None
    low: Decimal | None = None
    close: Decimal | None = None
    adjusted_close: Decimal | None = None
    volume: float | None = None
    trading_date: date
    interval: PriceInterval
    fetched_at: datetime
    model_config = {"from_attributes": True}


class OutboxOut(BaseModel):
    id: UUID
    normalized_event_id: UUID
    event_name: str
    status: OutboxStatus
    attempts: int
    created_at: datetime
    model_config = {"from_attributes": True}


class NotificationOut(BaseModel):
    id: UUID
    email: str
    provider: str
    status: NotificationStatus
    subject: str | None = None
    sent_at: datetime | None = None
    created_at: datetime
    model_config = {"from_attributes": True}


class NotificationRuleCreate(BaseModel):
    company_ticker: str = "AEFES"
    email: str
    min_severity: Severity = Severity.INFO
    source_filters: list[str] = Field(default_factory=list)


class PollingStateOut(BaseModel):
    id: UUID
    source_id: UUID
    last_success_at: datetime | None = None
    last_attempt_at: datetime | None = None
    last_seen_external_id: str | None = None
    consecutive_failures: int
    last_error: str | None = None
    model_config = {"from_attributes": True}


class PollRunRequest(BaseModel):
    source_code: str | None = None


class BackfillRequest(BaseModel):
    days: int = 30
    source_code: str | None = None


class StatsOut(BaseModel):
    total_raw_events: int
    total_normalized_events: int
    total_price_records: int
    total_notifications: int
    pending_outbox: int


class HealthOut(BaseModel):
    status: str = "ok"
    version: str = "0.2.0"
    environment: str = "development"
