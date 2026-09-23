"""Provenance / freshness metadata attached to API payloads (``meta`` block).

Every payload that leaves the data platform should say where its data came
from and how fresh it is. The block is *additive*: existing response fields are
never renamed or removed, ``meta`` is simply merged in.

    {"meta": {"source": "tradingview", "source_url": ..., "as_of": "2026-09-22",
              "fetched_at": "2026-09-22T18:31:04+03:00", "age_seconds": 41,
              "stale": false, "delay_seconds": 900, "served_from": "store"}}

``served_from`` is ``"live"`` (fetched from the provider for this request),
``"store"`` (the persisted copy, fresh within the dataset's policy) or
``"stale"`` (persisted copy served because the provider failed / the copy is
older than its policy — ``stale`` is then ``true``).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Literal

ServedFrom = Literal["live", "store", "stale"]


@dataclass(frozen=True)
class DataMeta:
    source: str
    fetched_at: datetime
    source_url: str | None = None
    as_of: str | None = None  # ISO date / period label the data describes
    served_from: ServedFrom = "live"
    stale: bool = False
    delay_seconds: int | None = None  # provider delay (e.g. 900 for the free TradingView feed)
    notes: list[str] = field(default_factory=list)

    def age_seconds(self, now: datetime | None = None) -> int:
        current = now or datetime.now(timezone.utc)
        return max(0, int((current - self.fetched_at).total_seconds()))

    def to_dict(self, now: datetime | None = None) -> dict[str, Any]:
        data = asdict(self)
        data["fetched_at"] = self.fetched_at.isoformat()
        data["age_seconds"] = self.age_seconds(now)
        return data


def as_of_label(value: date | datetime | str | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def with_meta(payload: dict[str, Any], meta: DataMeta, now: datetime | None = None) -> dict[str, Any]:
    """Return ``payload`` with the ``meta`` block merged in (existing keys untouched)."""
    return {**payload, "meta": meta.to_dict(now)}
