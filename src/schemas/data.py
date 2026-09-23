"""Pydantic models for ``/data/*`` and ``/admin/data/*`` (data-infra WS6).

See ``src.services.quality_service`` for the business logic that produces these
shapes and ``docs/data-platform.md`` §7 for the endpoint contract.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_serializer, field_validator

from src.schemas.events import PollingStateOut

DomainStatus = Literal["ok", "degraded", "down"]
Freshness = Literal["fresh", "stale", "empty"]
CheckStatus = Literal["pass", "warn", "fail"]


class JobRunOut(BaseModel):
    job: str
    scope: str | None = None
    status: str
    started_at: datetime | None = None
    finished_at: datetime | None = None
    items_total: int = 0
    items_ok: int = 0
    items_failed: int = 0
    error: str | None = None
    model_config = {"from_attributes": True}

    @field_serializer("error")
    def _truncate_error(self, value: str | None) -> str | None:
        return value[:300] if value else value


class TableStatOut(BaseModel):
    table: str
    row_count: int
    latest: str | None = None


class DomainStatusOut(BaseModel):
    domain: str
    status: DomainStatus
    freshness: Freshness
    jobs: list[JobRunOut] = Field(default_factory=list)
    tables: list[TableStatOut] = Field(default_factory=list)


class DataStatusOut(BaseModel):
    generated_at: datetime
    status: DomainStatus
    domains: list[DomainStatusOut]
    polling_state: list[PollingStateOut]


class QualityCheckOut(BaseModel):
    id: UUID
    check_name: str
    subject: str | None = None
    status: CheckStatus
    expected: Decimal | None = None
    actual: Decimal | None = None
    deviation: Decimal | None = None
    details_json: dict[str, Any] | None = None
    checked_at: datetime
    model_config = {"from_attributes": True}


class QualityRunRequest(BaseModel):
    names: list[str] | None = Field(default=None, description="Boşsa tüm kontroller çalışır")


class RefreshRequest(BaseModel):
    domain: str = Field(description="market | fundamentals | reference | macro")
    tickers: list[str] | None = None
    jobs: list[str] | None = None

    @field_validator("tickers")
    @classmethod
    def _normalize_tickers(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned = [t.strip().upper() for t in value if t and t.strip()]
        return cleaned or None
