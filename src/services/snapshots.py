"""Last-good-copy store for live payloads with no dedicated table (``data_snapshots``).

Implements the store-first read-through of docs/data-platform.md §4.1::

    row = await repo.get(key)
    if row and age(row) <= max_age:            -> served_from="store"
        return row_payload, meta(store)
    try:
        fresh = await fetch_live(key)           # existing adapter call
        await repo.upsert(fresh); commit
        return fresh, meta(live)                -> served_from="live"
    except MarketDataError / httpx errors:
        if row:                                 -> served_from="stale", stale=True
            return row_payload, meta(stale, notes=["Sağlayıcıya ulaşılamadı; son kayıtlı veri"])
        raise

``None``/error payloads (an adapter's own ``{"error": ..., "error_status": ...}`` soft-fail
shape) are treated exactly like a raised exception for the store: never written, and
stale-served when a copy exists. When there is no copy either, the payload is returned
as-is — the existing error contract is preserved unchanged (the caller's router still
runs it through ``src.adapters.utils.upstream_failure``).
"""

from __future__ import annotations

import math
from collections.abc import Awaitable, Callable
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

import httpx
import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.utils import MarketDataError, upstream_failure
from src.core.meta import DataMeta
from src.core.time import utcnow
from src.db.models import DataSnapshot
from src.db.repositories.platform import SnapshotRepository

logger = structlog.get_logger(__name__)

_STALE_NOTE = "Sağlayıcıya ulaşılamadı; son kayıtlı veri gösteriliyor."

# Exceptions that mean "the live provider failed this time" (stale-serve candidates),
# as opposed to a bug in our own code (which should crash, not be swallowed).
_UPSTREAM_ERRORS: tuple[type[BaseException], ...] = (MarketDataError, httpx.HTTPError, TimeoutError)


def json_safe(value: Any) -> Any:
    """Recursively coerce ``value`` into JSONB-safe types.

    ``dict``/``list``/``tuple``/``set`` recurse, ``date``/``datetime`` -> ISO string,
    ``Decimal`` -> ``float``, non-finite ``float`` (NaN/Inf) -> ``None``. Everything else
    passes through unchanged.
    """
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_safe(v) for v in value]
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _is_failure_payload(payload: Any) -> bool:
    """``None`` or an adapter ``{"error": ...}`` dict — the two shapes never stored."""
    return payload is None or upstream_failure(payload) is not None


def _stale_meta(row: DataSnapshot, fallback_source: str) -> DataMeta:
    return DataMeta(
        source=row.source or fallback_source,
        fetched_at=row.fetched_at,
        served_from="stale",
        stale=True,
        notes=[_STALE_NOTE],
    )


async def get_or_fetch(
    session: AsyncSession,
    key: str,
    fetch: Callable[[], Awaitable[dict[str, Any]]],
    *,
    kind: str,
    source: str,
    max_age: timedelta,
    ttl: timedelta | None = None,
) -> tuple[dict[str, Any], DataMeta]:
    """Store-first read-through for one snapshot ``key`` (see module docstring).

    ``max_age`` decides whether the stored copy is fresh enough to skip the live fetch.
    ``ttl`` (optional) sets ``expires_at`` for informational/purge purposes only — it does
    NOT gate the stale-serve fallback, which always uses whatever copy is on file
    regardless of age (a very old copy is still better than a hard failure).
    """
    repo = SnapshotRepository(session)
    row = await repo.get(key)
    now = utcnow()

    if row is not None and (now - row.fetched_at) <= max_age:
        return row.payload, DataMeta(source=row.source or source, fetched_at=row.fetched_at, served_from="store")

    try:
        fresh = await fetch()
    except _UPSTREAM_ERRORS as exc:
        if row is not None:
            logger.info("snapshot_stale_serve", key=key, kind=kind, error=str(exc))
            return row.payload, _stale_meta(row, source)
        raise

    if _is_failure_payload(fresh):
        if row is not None:
            logger.info("snapshot_stale_serve_error_payload", key=key, kind=kind)
            return row.payload, _stale_meta(row, source)
        # No fallback copy: preserve the existing {"error": ..., "error_status": ...}
        # contract unchanged (docs/data-platform.md §4.1).
        return fresh, DataMeta(source=source, fetched_at=now, served_from="live")

    expires_at = now + ttl if ttl else None
    await repo.upsert(key, kind=kind, payload=json_safe(fresh), source=source, fetched_at=now, expires_at=expires_at)
    await session.commit()
    return fresh, DataMeta(source=source, fetched_at=now, served_from="live")


async def put(
    session: AsyncSession,
    key: str,
    payload: dict[str, Any],
    *,
    kind: str,
    source: str,
    ttl: timedelta | None = None,
) -> DataSnapshot:
    """Force-write the store without a read-through fetch (e.g. a worker priming a key).

    Raises ``ValueError`` for a ``None``/error-shaped payload — those are never stored
    (see module docstring); callers that already checked should not hit this.
    """
    if _is_failure_payload(payload):
        raise ValueError("failure payloads (None / {'error': ...}) are never stored")
    now = utcnow()
    expires_at = now + ttl if ttl else None
    row = await SnapshotRepository(session).upsert(
        key, kind=kind, payload=json_safe(payload), source=source, fetched_at=now, expires_at=expires_at
    )
    await session.commit()
    return row


async def get(session: AsyncSession, key: str) -> DataSnapshot | None:
    return await SnapshotRepository(session).get(key)


async def purge_expired(session: AsyncSession, *, grace: timedelta | None = None) -> int:
    """Delete snapshots expired for longer than ``grace`` (default ``QUALITY_SNAPSHOT_PURGE_GRACE_DAYS``).

    A snapshot past ``expires_at`` is still served (flagged ``stale``) by
    :func:`get_or_fetch` — this only reclaims keys nobody has successfully refreshed in a
    long time. Commits.
    """
    from src.core.config import settings  # local: config.py is edited by every workstream

    grace = grace if grace is not None else timedelta(days=settings.quality_snapshot_purge_grace_days)
    deleted = await SnapshotRepository(session).purge_expired(before=utcnow() - grace)
    await session.commit()
    return deleted
