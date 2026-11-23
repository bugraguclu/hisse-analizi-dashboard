"""Web Push delivery of ``alert_deliveries`` (the push outbox).

Same model as the e-mail outbox (notification_service.py):

* Deliveries are claimed with ``FOR UPDATE SKIP LOCKED`` (several API/worker
  processes may drain the table) and handled one at a time, each committed alone.
* Before each send the subscription id is committed into
  ``attempted_subscription_ids``. A delivery is therefore never sent twice to the
  same subscription — not on retry, not after a crash (a send whose outcome is
  unknown counts as done). A send that fails with a known, retryable error is
  removed from the list again and retried with exponential backoff; after
  ``PUSH_MAX_ATTEMPTS`` the delivery is dead-lettered (status ``failed``).
* 404/410 from the push service (and 403: the subscription belongs to another
  VAPID key) delete the subscription. A delivery past its TTL is not sent.
* The notification ``tag`` is stable per delivery, so even a duplicate that a
  push service redelivers replaces the shown notification instead of stacking.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Literal

import structlog
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.time import utcnow
from src.db.models import AlertDelivery, PushSubscription
from src.db.repository import outbox_retry_delay

logger = structlog.get_logger(__name__)

Outcome = Literal["sent", "gone", "rejected", "retry"]
_STUCK_SECONDS = 300
_MAX_ERROR = 500


@dataclass(frozen=True)
class SubscriptionTarget:
    id: uuid.UUID
    endpoint: str
    p256dh: str
    auth: str


@dataclass(frozen=True)
class SendResult:
    outcome: Outcome
    status: int | None = None
    error: str | None = None


Sender = Callable[[SubscriptionTarget, str, int, str], Awaitable[SendResult]]


def classify_status(status: int | None) -> Outcome:
    if status is not None and 200 <= status < 300:
        return "sent"
    if status in (404, 410, 403):
        return "gone"
    if status in (400, 413):
        return "rejected"
    return "retry"  # 429, 5xx, timeouts, connection errors


def _send_sync(target: SubscriptionTarget, payload: str, ttl: int, topic: str) -> SendResult:
    from pywebpush import WebPushException, webpush

    try:
        response = webpush(
            subscription_info={"endpoint": target.endpoint, "keys": {"p256dh": target.p256dh, "auth": target.auth}},
            data=payload,
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},  # fresh dict: pywebpush adds aud/exp to it
            ttl=ttl,
            timeout=settings.push_timeout_seconds,
            headers={"Urgency": "high", "Topic": topic},
        )
    except WebPushException as exc:
        failed = exc.response.status_code if exc.response is not None else None
        return SendResult(classify_status(failed), failed, f"WebPushException {failed}: {exc}"[:_MAX_ERROR])
    except Exception as exc:  # network errors, timeouts
        return SendResult("retry", None, f"{type(exc).__name__}: {exc}"[:_MAX_ERROR])
    code = int(getattr(response, "status_code", 201) or 201)
    return SendResult(classify_status(code), code, None if 200 <= code < 300 else f"HTTP {code}")


async def webpush_sender(target: SubscriptionTarget, payload: str, ttl: int, topic: str) -> SendResult:
    """pywebpush is synchronous (requests); run it off the event loop."""
    return await asyncio.to_thread(_send_sync, target, payload, ttl, topic)


def push_topic(delivery_id: uuid.UUID) -> str:
    """RFC 8030 Topic (<= 32 URL-safe chars): the push service collapses duplicates."""
    return delivery_id.hex[:32]


def build_payload(delivery: dict[str, Any]) -> str:
    return json.dumps(
        {
            "title": delivery["title"],
            "body": delivery["body"],
            "url": delivery["url"],
            "tag": f"alert-{delivery['id']}",
            "deliveryId": str(delivery["id"]),
            "kind": delivery["kind"],
            "ticker": delivery["ticker"],
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


class PushService:
    def __init__(self, session: AsyncSession, sender: Sender | None = None) -> None:
        self.session = session
        self.sender = sender or webpush_sender

    async def process_pending(self, batch_size: int | None = None) -> dict[str, int]:
        stats = {"claimed": 0, "sent": 0, "retried": 0, "dead_lettered": 0, "skipped": 0, "subscriptions_removed": 0}
        if not settings.push_enabled:
            return stats
        stats["dead_lettered"] += await self._reclaim_stuck()
        await self.session.commit()

        ids = await self._claim(batch_size or settings.push_batch_size)
        await self.session.commit()
        stats["claimed"] = len(ids)
        for delivery_id in ids:
            try:
                await self._deliver(delivery_id, stats)
            except Exception as exc:  # never let one delivery stop the batch
                await self.session.rollback()
                logger.error("push_delivery_error", delivery_id=str(delivery_id), error=f"{type(exc).__name__}: {exc}")
                if await self._mark_retry(delivery_id, f"{type(exc).__name__}: {exc}") == "failed":
                    stats["dead_lettered"] += 1
                else:
                    stats["retried"] += 1
                await self.session.commit()
        return stats

    async def _claim(self, limit: int) -> list[uuid.UUID]:
        candidates = (
            select(AlertDelivery.id)
            .where(
                AlertDelivery.status == "pending",
                or_(AlertDelivery.available_at.is_(None), AlertDelivery.available_at <= func.now()),
            )
            .order_by(AlertDelivery.created_at)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
        rows = await self.session.execute(
            update(AlertDelivery)
            .where(AlertDelivery.id.in_(candidates.scalar_subquery()))
            .values(status="processing", updated_at=func.now())
            .returning(AlertDelivery.id)
            .execution_options(synchronize_session=False)
        )
        return [row[0] for row in rows.all()]

    async def _reclaim_stuck(self) -> int:
        """A crashed sender leaves ``processing`` rows: requeue them (attempted subscriptions are skipped)."""
        stuck = and_(
            AlertDelivery.status == "processing",
            AlertDelivery.updated_at < func.now() - timedelta(seconds=_STUCK_SECONDS),
        )
        note = "processing timed out (worker crashed or stalled)"
        dead = await self.session.execute(
            update(AlertDelivery)
            .where(stuck, AlertDelivery.attempts + 1 >= settings.push_max_attempts)
            .values(status="failed", attempts=AlertDelivery.attempts + 1, last_error=note, updated_at=func.now())
            .returning(AlertDelivery.id)
            .execution_options(synchronize_session=False)
        )
        await self.session.execute(
            update(AlertDelivery)
            .where(stuck)
            .values(status="pending", attempts=AlertDelivery.attempts + 1, last_error=note, available_at=func.now(), updated_at=func.now())
            .execution_options(synchronize_session=False)
        )
        return len(dead.all())

    async def _set(self, delivery_id: uuid.UUID, **values: Any) -> None:
        await self.session.execute(
            update(AlertDelivery)
            .where(AlertDelivery.id == delivery_id)
            .values(updated_at=func.now(), **values)
            .execution_options(synchronize_session=False)
        )

    async def _mark_retry(self, delivery_id: uuid.UUID, error: str) -> str:
        attempts = (
            await self.session.execute(select(AlertDelivery.attempts).where(AlertDelivery.id == delivery_id))
        ).scalar_one() + 1
        if attempts >= settings.push_max_attempts:
            await self._set(delivery_id, status="failed", attempts=attempts, last_error=error[:_MAX_ERROR])
            return "failed"
        delay = outbox_retry_delay(attempts, settings.backoff_base_seconds, settings.backoff_max_seconds)
        await self._set(
            delivery_id,
            status="pending",
            attempts=attempts,
            last_error=error[:_MAX_ERROR],
            available_at=func.now() + timedelta(seconds=delay),
        )
        return "pending"

    async def _deliver(self, delivery_id: uuid.UUID, stats: dict[str, int]) -> None:
        row = (
            await self.session.execute(
                select(
                    AlertDelivery.id,
                    AlertDelivery.device_id,
                    AlertDelivery.kind,
                    AlertDelivery.ticker,
                    AlertDelivery.title,
                    AlertDelivery.body,
                    AlertDelivery.url,
                    AlertDelivery.ttl_seconds,
                    AlertDelivery.created_at,
                    AlertDelivery.attempted_subscription_ids,
                    AlertDelivery.sent_count,
                ).where(AlertDelivery.id == delivery_id)
            )
        ).mappings().one()
        delivery = dict(row)

        remaining_ttl = int(delivery["ttl_seconds"] - (utcnow() - delivery["created_at"]).total_seconds())
        if remaining_ttl <= 0:
            await self._set(delivery_id, status="failed", last_error="expired before it could be sent")
            await self.session.commit()
            stats["dead_lettered"] += 1
            return

        targets = [
            SubscriptionTarget(id=s.id, endpoint=s.endpoint, p256dh=s.p256dh, auth=s.auth)
            for s in (
                await self.session.execute(
                    select(PushSubscription).where(PushSubscription.device_id == delivery["device_id"]).order_by(PushSubscription.created_at)
                )
            ).scalars()
        ]
        attempted = set(delivery["attempted_subscription_ids"] or [])
        pending = [t for t in targets if str(t.id) not in attempted]
        if not targets:
            await self._set(delivery_id, status="skipped", last_error="no push subscription on this device")
            await self.session.commit()
            stats["skipped"] += 1
            return

        payload = build_payload(delivery)
        topic = push_topic(delivery_id)
        sent = int(delivery["sent_count"])
        retryable_errors: list[str] = []
        last_error: str | None = None
        for target in pending:
            attempted.add(str(target.id))
            await self._set(delivery_id, attempted_subscription_ids=sorted(attempted))
            await self.session.commit()  # the reservation is durable BEFORE the side effect

            result = await self.sender(target, payload, remaining_ttl, topic)
            if result.outcome == "sent":
                sent += 1
                await self._set(delivery_id, sent_count=sent)
                await self.session.execute(
                    update(PushSubscription)
                    .where(PushSubscription.id == target.id)
                    .values(last_success_at=func.now(), failure_count=0)
                )
            elif result.outcome == "gone":
                await self.session.execute(delete(PushSubscription).where(PushSubscription.id == target.id))
                stats["subscriptions_removed"] += 1
                logger.info("push_subscription_removed", subscription_id=str(target.id), status=result.status)
            else:
                last_error = result.error or result.outcome
                await self.session.execute(
                    update(PushSubscription)
                    .where(PushSubscription.id == target.id)
                    .values(failure_count=PushSubscription.failure_count + 1)
                )
                if result.outcome == "retry":
                    attempted.discard(str(target.id))
                    await self._set(delivery_id, attempted_subscription_ids=sorted(attempted))
                    retryable_errors.append(last_error)
            await self.session.commit()

        if retryable_errors:
            status = await self._mark_retry(delivery_id, "; ".join(retryable_errors))
            stats["dead_lettered" if status == "failed" else "retried"] += 1
        elif sent > 0:
            await self._set(delivery_id, status="sent", sent_at=func.now(), last_error=last_error)
            stats["sent"] += 1
        else:
            await self._set(delivery_id, status="failed", last_error=last_error or "no subscription accepted the push")
            stats["dead_lettered"] += 1
        await self.session.commit()

    async def purge_finished(self) -> int:
        cutoff = utcnow() - timedelta(days=settings.push_retention_days)
        result = await self.session.execute(
            delete(AlertDelivery)
            .where(AlertDelivery.status.in_(("sent", "failed", "skipped")), AlertDelivery.created_at < cutoff)
            .returning(AlertDelivery.id)
        )
        deleted = len(result.all())
        await self.session.commit()
        return deleted
