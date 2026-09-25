"""Notification processing service.

Concurrency / delivery model:
- Outbox entries are claimed atomically (SELECT ... FOR UPDATE SKIP LOCKED); every
  entry is then processed and committed on its own, so one failure never rolls back
  the others.
- Before an e-mail is sent, a notification row is inserted and COMMITTED as the
  idempotency record (unique on (normalized_event_id, email)). A delivered or
  in-flight notification is therefore never sent twice, even across replicas or
  after a crash; only a previously FAILED delivery is re-claimed for a retry.
- A failed delivery makes the outbox entry retry with exponential backoff; after
  OUTBOX_MAX_ATTEMPTS it is dead-lettered (status=failed) and never retried again.
- Events older than NOTIFICATION_MAX_EVENT_AGE_HOURS (backfills, worker outages)
  are marked done without sending anything.
"""

import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.core.config import settings
from src.core.enums import EventType, NotificationProvider, OutboxStatus, Severity
from src.core.time import utcnow
from src.db.models import NormalizedEvent
from src.db.repository import (
    ClaimedOutboxEntry,
    NotificationRepository,
    NotificationRuleRepository,
    OutboxRepository,
    rule_matches,
)

logger = structlog.get_logger(__name__)

# Sanitize email subject to prevent header injection
_CRLF_RE = re.compile(r"[\r\n]+")
_MAX_SUBJECT_LENGTH = 200
_STUCK_PROCESSING_SECONDS = 300


def _sanitize_header(value: str) -> str:
    """Remove CRLF characters to prevent email header injection."""
    return _CRLF_RE.sub(" ", value).strip()


def build_subject(ticker: str, source_code: str, title: str | None) -> str:
    subject = _sanitize_header(f"[{ticker}][{source_code.upper()}] Yeni olay: {title or 'Bilinmeyen'}")
    return subject if len(subject) <= _MAX_SUBJECT_LENGTH else subject[: _MAX_SUBJECT_LENGTH - 1] + "…"


def smtp_tls_mode(port: int, use_tls: bool) -> tuple[bool, bool]:
    """(implicit TLS, STARTTLS) for aiosmtplib: port 465 is SMTPS, others upgrade."""
    if not use_tls:
        return False, False
    return (True, False) if port == 465 else (False, True)


class NotificationDeliveryError(Exception):
    """At least one e-mail of an outbox entry could not be delivered (retryable)."""


@dataclass(frozen=True)
class EventSnapshot:
    """Plain copy of the event fields needed for delivery (safe across rollbacks)."""

    id: uuid.UUID
    company_id: uuid.UUID
    ticker: str
    title: str | None
    excerpt: str | None
    source_code: str
    severity: Severity
    event_type: EventType
    published_at: datetime | None
    event_url: str | None

    @classmethod
    def from_event(cls, event: NormalizedEvent) -> "EventSnapshot":
        return cls(
            id=event.id,
            company_id=event.company_id,
            ticker=event.company.ticker if event.company else "UNKNOWN",
            title=event.title,
            excerpt=event.excerpt,
            source_code=event.source_code,
            severity=event.severity,
            event_type=event.event_type,
            published_at=event.published_at,
            event_url=event.event_url,
        )


@dataclass(frozen=True)
class RuleSnapshot:
    id: uuid.UUID
    email: str
    min_severity: Severity
    source_filters: tuple[str, ...]


class NotificationService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.outbox_repo = OutboxRepository(session)
        self.rule_repo = NotificationRuleRepository(session)
        self.notif_repo = NotificationRepository(session)

    async def process_pending(self, batch_size: int | None = None) -> dict[str, int]:
        stats = {
            "claimed": 0,
            "processed": 0,
            "notifications_sent": 0,
            "skipped": 0,
            "stale_skipped": 0,
            "retried": 0,
            "dead_lettered": 0,
            "errors": 0,
        }

        requeued, dead = await self.outbox_repo.reclaim_stuck(
            stuck_seconds=_STUCK_PROCESSING_SECONDS, max_attempts=settings.outbox_max_attempts
        )
        await self.session.commit()
        if requeued or dead:
            logger.warning("outbox_reclaimed_stuck", requeued=requeued, dead_lettered=dead)
        stats["dead_lettered"] += dead

        claimed = await self.outbox_repo.claim_pending(limit=batch_size or settings.outbox_batch_size)
        await self.session.commit()
        stats["claimed"] = len(claimed)
        if not claimed:
            return stats

        events = await self._load_events({entry.normalized_event_id for entry in claimed})
        rules_by_company = await self._load_rules({e.company_id for e in events.values()})
        stale_before = utcnow() - timedelta(hours=settings.notification_max_event_age_hours)

        for entry in claimed:
            try:
                event = events.get(entry.normalized_event_id)
                if event is None:
                    await self.outbox_repo.mark_failed(entry.id, "normalized_event_not_found")
                    await self.session.commit()
                    stats["errors"] += 1
                    stats["dead_lettered"] += 1
                    continue

                if event.published_at is not None and event.published_at < stale_before:
                    await self.outbox_repo.mark_done(
                        entry.id, note=f"skipped: event older than {settings.notification_max_event_age_hours}h"
                    )
                    await self.session.commit()
                    stats["stale_skipped"] += 1
                    stats["processed"] += 1
                    continue

                rules = [
                    r for r in rules_by_company.get(event.company_id, []) if rule_matches(r, event.source_code, event.severity)
                ]
                sent, skipped, failures = await self._deliver(entry, event, rules)
                stats["notifications_sent"] += sent
                stats["skipped"] += skipped
                if failures:
                    raise NotificationDeliveryError(f"{failures}/{len(rules)} deliveries failed")

                await self.outbox_repo.mark_done(entry.id)
                await self.session.commit()
                stats["processed"] += 1

            except Exception as e:
                await self.session.rollback()
                logger.error("outbox_processing_error", outbox_id=str(entry.id), error=str(e))
                status = await self.outbox_repo.mark_retry(
                    entry,
                    f"{type(e).__name__}: {e}",
                    max_attempts=settings.outbox_max_attempts,
                    base_delay_seconds=settings.backoff_base_seconds,
                    max_delay_seconds=settings.backoff_max_seconds,
                )
                await self.session.commit()
                stats["errors"] += 1
                stats["dead_lettered" if status == OutboxStatus.FAILED else "retried"] += 1

        return stats

    async def purge_processed(self) -> int:
        deleted = await self.outbox_repo.purge_processed(settings.outbox_retention_days)
        await self.session.commit()
        if deleted:
            logger.info("outbox_purged", deleted=deleted, retention_days=settings.outbox_retention_days)
        return deleted

    async def _load_events(self, event_ids: set[uuid.UUID]) -> dict[uuid.UUID, EventSnapshot]:
        result = await self.session.execute(
            select(NormalizedEvent)
            .options(selectinload(NormalizedEvent.company))
            .where(NormalizedEvent.id.in_(event_ids))
        )
        return {e.id: EventSnapshot.from_event(e) for e in result.scalars().all()}

    async def _load_rules(self, company_ids: set[uuid.UUID]) -> dict[uuid.UUID, list[RuleSnapshot]]:
        """Plain copies: ORM instances expire on rollback, snapshots stay usable."""
        grouped = await self.rule_repo.get_enabled_by_company(list(company_ids))
        return {
            company_id: [
                RuleSnapshot(id=r.id, email=r.email, min_severity=r.min_severity, source_filters=tuple(r.source_filters or ()))
                for r in rules
            ]
            for company_id, rules in grouped.items()
        }

    async def _deliver(
        self, entry: ClaimedOutboxEntry, event: EventSnapshot, rules: list[RuleSnapshot]
    ) -> tuple[int, int, int]:
        """Returns (sent, skipped, failed) counts for this outbox entry."""
        sent = skipped = failed = 0
        provider = (
            NotificationProvider.SMTP
            if settings.enable_real_email and settings.smtp_host
            else NotificationProvider.DRY_RUN
        )
        subject = build_subject(event.ticker, event.source_code, event.title)
        body = self._build_body(event)

        for rule in rules:
            notification_id = await self.notif_repo.claim(
                rule_id=rule.id,
                outbox_id=entry.id,
                normalized_event_id=event.id,
                email=rule.email,
                provider=provider,
                subject=subject,
                body_text=body,
            )
            # Commit the idempotency record BEFORE the side effect.
            await self.session.commit()
            if notification_id is None:
                logger.info("notification_duplicate_skipped", event_id=str(event.id), rule_id=str(rule.id))
                skipped += 1
                continue

            try:
                if provider == NotificationProvider.SMTP:
                    await self._send_email(rule.email, subject, body, notification_id)
                else:
                    logger.info("dry_run_notification", rule_id=str(rule.id), subject=subject)
            except Exception as e:
                failed += 1
                logger.error("email_send_error", rule_id=str(rule.id), error=str(e))
                await self.notif_repo.mark_failed(notification_id, f"{type(e).__name__}: {e}")
            else:
                sent += 1
                await self.notif_repo.mark_sent(notification_id)
            await self.session.commit()

        return sent, skipped, failed

    def _build_body(self, event: EventSnapshot) -> str:
        lines = [
            f"Baslik: {event.title or 'N/A'}",
            f"Kaynak: {event.source_code}",
            f"Tur: {event.event_type.value if event.event_type else 'N/A'}",
            f"Onem: {event.severity.value if event.severity else 'N/A'}",
            f"Yayin Zamani: {event.published_at.isoformat() if event.published_at else 'N/A'}",
            "",
        ]
        if event.excerpt:
            lines.append(f"Ozet: {event.excerpt}")
            lines.append("")
        if event.event_url:
            lines.append(f"Detay: {event.event_url}")
        return "\n".join(lines)

    async def _send_email(self, to: str, subject: str, body: str, notification_id: uuid.UUID | None = None) -> None:
        try:
            import aiosmtplib
        except ImportError as exc:  # optional dependency: pip install '.[email]'
            raise RuntimeError("aiosmtplib is not installed; install the 'email' extra") from exc

        implicit_tls, starttls = smtp_tls_mode(settings.smtp_port, settings.smtp_use_tls)
        await aiosmtplib.send(
            self._build_mime_message(to, subject, body, notification_id),
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_username or None,
            password=settings.smtp_password or None,
            use_tls=implicit_tls,
            start_tls=starttls,
            timeout=settings.smtp_timeout_seconds,
        )

    def _build_mime_message(
        self, to: str, subject: str, body: str, notification_id: uuid.UUID | None = None
    ) -> EmailMessage:
        msg = EmailMessage()
        msg["Subject"] = _sanitize_header(subject)
        msg["From"] = _sanitize_header(settings.smtp_from)
        msg["To"] = _sanitize_header(to)
        msg["Date"] = formatdate(localtime=False)
        domain = settings.smtp_from.rpartition("@")[2] or None
        # Stable Message-ID per notification lets receivers drop duplicates.
        msg["Message-ID"] = f"<{notification_id}@{domain}>" if notification_id and domain else make_msgid(domain=domain)
        msg.set_content(body, charset="utf-8")
        return msg
