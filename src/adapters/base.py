from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime

from src.db.models import PollingState


@dataclass
class RawEventData:
    external_id: str | None = None
    canonical_url: str | None = None
    source_event_type: str | None = None
    title: str | None = None
    summary: str | None = None
    published_at: datetime | None = None
    content_hash: str = ""
    raw_payload_json: dict | None = None
    raw_payload_text: str | None = None
    attachment_urls: list[str] = field(default_factory=list)
    http_status: int | None = None
    headers_json: dict | None = None
    body_text: str | None = None


@dataclass
class PriceRecord:
    ticker: str = ""
    source: str = "borsapy"
    open: float | None = None
    high: float | None = None
    low: float | None = None
    close: float | None = None
    adjusted_close: float | None = None
    volume: float | None = None
    trading_date: datetime | None = None
    interval: str = "1d"


class BaseAdapter(ABC):
    @abstractmethod
    async def fetch(self, polling_state: PollingState | None = None) -> list[RawEventData]:
        ...

    @abstractmethod
    def get_source_code(self) -> str:
        ...


class BasePriceAdapter(ABC):
    @abstractmethod
    async def fetch_prices(self, polling_state: PollingState | None = None) -> list[PriceRecord]:
        ...

    @abstractmethod
    def get_source_code(self) -> str:
        ...
