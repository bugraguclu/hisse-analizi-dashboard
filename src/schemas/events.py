import re
from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_serializer, field_validator

from src.core.enums import EventType, NotificationStatus, OutboxStatus, PriceInterval, Severity
from src.core.version import get_version

# Sources that the polling worker knows how to run.
PollSourceCode = Literal["kap", "price", "financials"]
StatementType = Literal["balance_sheet", "income_stmt", "cash_flow"]

_EMAIL_RE = re.compile(
    r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@"
    r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$"
)
_TICKER_RE = re.compile(r"^[A-Z0-9]{1,10}$")
_SOURCE_CODE_RE = re.compile(r"^[a-z0-9_]{1,50}$")


def mask_email(email: str) -> str:
    """``test@example.com`` -> ``t***@example.com`` (public endpoints must not leak PII)."""
    local, sep, domain = email.partition("@")
    if not sep:
        return "***"
    return f"{local[:1]}***@{domain}"


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
    ticker: str | None = None
    category: str | None = None  # EventCategory value, e.g. "temettü"
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

    @field_serializer("email")
    def _mask_email(self, email: str) -> str:
        return mask_email(email)


class NotificationRuleCreate(BaseModel):
    company_ticker: str = "THYAO"
    email: str = Field(max_length=254)
    min_severity: Severity = Severity.INFO
    source_filters: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("company_ticker")
    @classmethod
    def _validate_ticker(cls, value: str) -> str:
        ticker = value.strip().upper()
        if not _TICKER_RE.match(ticker):
            raise ValueError("Geçersiz hisse kodu (1-10 harf/rakam olmalı)")
        return ticker

    @field_validator("email")
    @classmethod
    def _validate_email(cls, value: str) -> str:
        email = value.strip()
        if not _EMAIL_RE.match(email):
            raise ValueError("Geçersiz e-posta adresi")
        return email

    @field_validator("source_filters")
    @classmethod
    def _validate_source_filters(cls, value: list[str]) -> list[str]:
        cleaned = [item.strip().lower() for item in value if item.strip()]
        for item in cleaned:
            if not _SOURCE_CODE_RE.match(item):
                raise ValueError(f"Geçersiz kaynak kodu: {item!r}")
        return sorted(set(cleaned))


class NotificationRuleOut(BaseModel):
    id: UUID
    email: str
    status: str = "created"
    company_ticker: str
    min_severity: Severity
    source_filters: list[str]


class PollingStateOut(BaseModel):
    id: UUID
    source_id: UUID
    last_success_at: datetime | None = None
    last_attempt_at: datetime | None = None
    last_seen_external_id: str | None = None
    consecutive_failures: int
    last_error: str | None = None
    model_config = {"from_attributes": True}

    @field_serializer("last_error")
    def _truncate_error(self, value: str | None) -> str | None:
        return value[:300] if value else value


class PollRunRequest(BaseModel):
    source_code: PollSourceCode | None = None


class BackfillRequest(BaseModel):
    days: int = Field(default=30, ge=1, le=3650)
    source_code: PollSourceCode | None = None


class PollAcceptedOut(BaseModel):
    status: str = "accepted"
    source_code: str


class BackfillAcceptedOut(BaseModel):
    status: str = "accepted"
    days: int
    source_code: str


class TaskAcceptedOut(BaseModel):
    status: str = "accepted"


class ReclassifyRequest(BaseModel):
    dry_run: bool = True


class ReclassifyOut(BaseModel):
    dry_run: bool
    scanned: int
    changed: int
    severity_changes: dict[str, int] = Field(default_factory=dict, description='e.g. {"HIGH->WATCH": 12}')
    category_changes: dict[str, int] = Field(default_factory=dict)


class RecomputeRatiosRequest(BaseModel):
    ticker: str | None = Field(default=None, description="Tek şirket; boşsa tüm aktif şirketler")

    @field_validator("ticker")
    @classmethod
    def _validate_ticker(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        ticker = value.strip().upper()
        if not _TICKER_RE.match(ticker):
            raise ValueError("Geçersiz hisse kodu (1-10 harf/rakam olmalı)")
        return ticker


class RecomputeRatiosOut(BaseModel):
    companies: int
    ratios_written: int


class StatsOut(BaseModel):
    total_raw_events: int
    total_normalized_events: int
    total_price_records: int
    total_notifications: int
    total_financial_records: int
    pending_outbox: int


class HealthOut(BaseModel):
    status: Literal["ok", "degraded"] = "ok"
    version: str = Field(default_factory=get_version)
    environment: str = "development"
    database: Literal["ok", "unavailable"] = "ok"


class FinancialStatementOut(BaseModel):
    """One stored statement; ``data_json`` is the ``{label: value}`` view of ``items_json``."""

    id: UUID
    period: str
    statement_type: str
    period_type: str | None = None
    currency: str
    data_json: dict
    fetched_at: datetime
    # add-only (data platform)
    source: str | None = None
    months: int | None = None
    template: str | None = None
    restated: bool | None = None
    model_config = {"from_attributes": True}

    @field_validator("currency", mode="before")
    @classmethod
    def _default_currency(cls, value: str | None) -> str:
        return value or "TRY"


class FinancialRatioOut(BaseModel):
    id: UUID
    period: str
    # add-only (data platform): "ttm" (flows = last four quarters) or "annual"
    basis: str | None = None
    operating_margin: float | None = None
    ev_ebitda: float | None = None
    revenue_growth_yoy: float | None = None
    net_income_growth_yoy: float | None = None
    market_cap: float | None = None
    roe: float | None = None
    roa: float | None = None
    net_margin: float | None = None
    gross_margin: float | None = None
    ebitda_margin: float | None = None
    pe_ratio: float | None = None
    pb_ratio: float | None = None
    ps_ratio: float | None = None
    debt_to_equity: float | None = None
    current_ratio: float | None = None
    net_debt_ebitda: float | None = None
    calculated_at: datetime
    model_config = {"from_attributes": True}
