"""Request/response models for the anonymous-device API (/push, /me/...)."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

AlertKind = Literal["price_above", "price_below", "change_pct", "kap"]
AlertRepeat = Literal["once", "rearm"]
AlertDirection = Literal["up", "down", "both"]
SeverityName = Literal["INFO", "WATCH", "HIGH"]
LocaleName = Literal["tr", "en", "fr"]

MAX_PRICE = Decimal("1000000")
MAX_CHANGE_PCT = Decimal("50")


class PushConfigOut(BaseModel):
    enabled: bool
    vapid_public_key: str | None = None
    price_delay_minutes: int = 15


class PushKeys(BaseModel):
    p256dh: str = Field(min_length=20, max_length=200, pattern=r"^[A-Za-z0-9_\-=]+$")
    auth: str = Field(min_length=8, max_length=100, pattern=r"^[A-Za-z0-9_\-=]+$")


class PushSubscriptionIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=2048)
    keys: PushKeys
    locale: LocaleName = "tr"


class PushSubscriptionDelete(BaseModel):
    endpoint: str = Field(min_length=10, max_length=2048)


class PushSubscriptionOut(BaseModel):
    id: uuid.UUID
    subscriptions: int


class AlertRuleFields(BaseModel):
    ticker: str = Field(min_length=2, max_length=12)
    kind: AlertKind
    threshold: Decimal | None = None
    direction: AlertDirection | None = None
    repeat: AlertRepeat = "once"
    hysteresis_pct: Decimal = Field(default=Decimal("1.0"), ge=Decimal("0.1"), le=Decimal("20"))
    min_severity: SeverityName | None = None
    enabled: bool = True

    @field_validator("ticker")
    @classmethod
    def _upper(cls, value: str) -> str:
        return value.strip().upper()

    @model_validator(mode="after")
    def _per_kind(self) -> AlertRuleFields:
        if self.kind in ("price_above", "price_below"):
            if self.threshold is None or not (Decimal(0) < self.threshold < MAX_PRICE):
                raise ValueError("Fiyat alarmı için 0'dan büyük bir eşik fiyatı gerekli.")
            self.threshold = round(self.threshold, 4)
            self.direction = None
            self.min_severity = None
        elif self.kind == "change_pct":
            if self.threshold is None or not (Decimal("0.1") <= self.threshold <= MAX_CHANGE_PCT):
                raise ValueError("Günlük değişim alarmı için %0,1 ile %50 arasında bir eşik gerekli.")
            self.threshold = round(self.threshold, 2)
            self.direction = self.direction or "both"
            self.min_severity = None
            self.repeat = "rearm"  # at most once per session by construction
        else:
            self.threshold = None
            self.direction = None
            self.repeat = "rearm"
        return self


class AlertRuleCreate(AlertRuleFields):
    # Client-generated id: a rule created offline can be edited/deleted before it syncs.
    id: uuid.UUID | None = None


class AlertRuleUpdate(AlertRuleFields):
    version: int = Field(ge=1)


AlertState = Literal["active", "pending", "armed", "waiting_reset", "cooldown", "done", "disabled"]


class AlertRuleOut(BaseModel):
    id: uuid.UUID
    ticker: str
    company_name: str | None = None
    kind: AlertKind
    threshold: float | None = None
    direction: AlertDirection | None = None
    repeat: AlertRepeat
    hysteresis_pct: float
    min_severity: SeverityName | None = None
    enabled: bool
    state: AlertState
    trigger_count: int
    last_triggered_at: datetime | None = None
    version: int
    created_at: datetime
    updated_at: datetime


class AlertDeliveryOut(BaseModel):
    id: uuid.UUID
    rule_id: uuid.UUID | None = None
    kind: str
    ticker: str | None = None
    title: str
    body: str
    url: str
    status: str
    sent_count: int
    created_at: datetime
    sent_at: datetime | None = None


class TestPushOut(BaseModel):
    delivery_id: uuid.UUID
    subscriptions: int


MAX_NOTE_LENGTH = 5000


class StockNoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_NOTE_LENGTH)
    # The version this edit was based on; null = the note must not exist yet.
    base_version: int | None = Field(default=None, ge=1)

    @field_validator("text")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Not boş olamaz.")
        return value


class StockNoteOut(BaseModel):
    ticker: str
    text: str
    version: int
    created_at: datetime
    updated_at: datetime
