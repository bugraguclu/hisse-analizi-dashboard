"""Pydantic schemas for iOS widget pairing, device management, and read-only summary."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

EventKind = Literal["earnings", "dividend", "economic"]


class WidgetPairingCreateIn(BaseModel):
    watchlist_id: str = Field(default="favorites", min_length=1, max_length=80)
    watchlist_name: str = Field(default="", max_length=80)
    tickers: list[str] = Field(default_factory=list, max_length=25)
    dashboard_id: str | None = Field(default=None, max_length=80)


class WidgetPairingOut(BaseModel):
    code: str
    expires_at: datetime
    watchlist_id: str
    watchlist_name: str
    tickers: list[str]


class WidgetDeviceUpdateIn(BaseModel):
    watchlist_id: str = Field(default="favorites", min_length=1, max_length=80)
    watchlist_name: str = Field(default="", max_length=80)
    tickers: list[str] = Field(default_factory=list, max_length=25)
    dashboard_id: str | None = Field(default=None, max_length=80)


class WidgetDeviceOut(BaseModel):
    id: uuid.UUID
    name: str
    scope: str
    watchlist_id: str
    watchlist_name: str
    tickers: list[str]
    dashboard_id: str | None = None
    created_at: datetime
    last_seen_at: datetime | None = None

    model_config = {"from_attributes": True}


class WidgetDevicesListOut(BaseModel):
    devices: list[WidgetDeviceOut]


class WidgetPairRequestIn(BaseModel):
    code: str = Field(min_length=4, max_length=32)
    name: str | None = Field(default="iPhone", max_length=60)


class WidgetPairOut(BaseModel):
    token: str
    scope: str = "widget:read"
    device: WidgetDeviceOut


class WidgetIndexSummaryOut(BaseModel):
    symbol: str = "XU100"
    name: str = "BIST 100"
    last: float | None = None
    change: float | None = None
    change_percent: float | None = None
    updated_at: str | None = None
    session_state: str | None = None


class WidgetStockQuoteOut(BaseModel):
    ticker: str
    name: str | None = None
    last: float | None = None
    change: float | None = None
    change_percent: float | None = None
    updated_at: str | None = None


class WidgetWatchlistSummaryOut(BaseModel):
    id: str
    name: str
    items: list[WidgetStockQuoteOut]


class WidgetCalendarEventOut(BaseModel):
    id: str
    kind: EventKind
    title: str
    subtitle: str | None = None
    ticker: str | None = None
    country: str | None = None
    scheduled_at: datetime
    date: str
    end_date: str | None = None
    importance: str | None = None
    deep_link: str


class WidgetSummaryOut(BaseModel):
    generated_at: datetime
    data_as_of: str | None = None
    timezone: str = "Europe/Istanbul"
    session_state: str = "closed"
    delay_seconds: int = 900
    stale: bool = False
    bist100: WidgetIndexSummaryOut
    watchlist: WidgetWatchlistSummaryOut
    upcoming_events: list[WidgetCalendarEventOut]
    dashboard_id: str | None = None
