"""Transactional request deduplication. Callers commit the receipt and business write together."""

from datetime import timedelta
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.mutations import DEFAULT_IDEMPOTENCY_TTL_SECONDS, RequestConflictError, canonical_payload_hash
from src.core.time import utcnow
from src.db.models import IdempotencyReceipt


class IdempotencyRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def claim(self, scope: str, request_id: str, payload: Any) -> dict[str, Any] | None:
        """Return a previous response, or reserve the key until this transaction commits/rolls back.

        INSERT ON CONFLICT waits for concurrent transactions before deciding which
        one owns the write. Failed writes roll back the reservation too.
        """
        now = utcnow()
        await self.db.execute(delete(IdempotencyReceipt).where(IdempotencyReceipt.expires_at <= now))
        digest = canonical_payload_hash(payload)
        stmt = insert(IdempotencyReceipt).values(
            scope=scope,
            request_id=request_id,
            payload_hash=digest,
            response_body=None,
            expires_at=now + timedelta(seconds=DEFAULT_IDEMPOTENCY_TTL_SECONDS),
        ).on_conflict_do_nothing().returning(IdempotencyReceipt.request_id)
        if (await self.db.execute(stmt)).scalar_one_or_none() is not None:
            return None
        receipt = (await self.db.execute(select(IdempotencyReceipt).where(
            IdempotencyReceipt.scope == scope,
            IdempotencyReceipt.request_id == request_id,
        ))).scalar_one()
        if receipt.payload_hash != digest:
            raise RequestConflictError()
        if receipt.response_body is None:
            raise RuntimeError("An incomplete idempotency receipt was committed")
        return receipt.response_body

    async def complete(self, scope: str, request_id: str, body: dict[str, Any]) -> None:
        await self.db.execute(update(IdempotencyReceipt).where(
            IdempotencyReceipt.scope == scope,
            IdempotencyReceipt.request_id == request_id,
        ).values(response_body=body))
