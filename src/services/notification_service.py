"""Notification processing service.

Concurrency model:
- Outbox entries are claimed atomically using SELECT ... FOR UPDATE SKIP LOCKED.
- Notifications are deduplicated using a unique constraint on (normalized_event_id, email).
- Email side effects are preceded by an atomic DB insert that serves as an idempotency record.
- Multiple worker replicas can safely process notifications concurrently.
"""

import re

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.core.config import settings
from src.core.enums import NotificationProvider, NotificationStatus, Severity
from src.core.time import utcnow
from src.db.models import NormalizedEvent
from src.db.repository import (
    OutboxRepository,
    NotificationRuleRepository,
    NotificationRepository,
)

logger = structlog.get_logger(__name__)

# Sanitize email subject to prevent header injection
_CRLF_RE = re.compile(r"[\r\n]")


def _sanitize_header(value: str) -> str:
    """Remove CRLF characters to prevent email header injection."""
    return _CRLF_RE.sub(" ", value).strip()


class NotificationService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.outbox_repo = OutboxRepository(session)
        self.rule_repo = NotificationRuleRepository(session)
        self.notif_repo = NotificationRepository(session)

    async def process_pending(self) -> dict:
        stats = {"processed": 0, "notifications_sent": 0, "skipped": 0, "errors": 0, "claimed": 0}

        # Reclaim stuck PROCESSING entries (older than 5 minutes)
        reclaimed = await self.outbox_repo.reclaim_stuck(stuck_seconds=300)
        if reclaimed:
            logger.info("outbox_reclaimed_stuck", count=reclaimed)
            await self.session.commit()

        # Atomically claim pending outbox entries
        claimed = await self.outbox_repo.claim_pending(limit=10)
        await self.session.commit()
        stats["claimed"] = len(claimed)

        if not claimed:
            return stats

        # Batch load normalized events with company data
        event_ids = [entry.normalized_event_id for entry in claimed]
        events_result = await self.session.execute(
            select(NormalizedEvent)
            .options(selectinload(NormalizedEvent.company))
            .where(NormalizedEvent.id.in_(event_ids))
        )
        events_by_id = {e.id: e for e in events_result.scalars().all()}

        for outbox_entry in claimed:
            try:
                payload = outbox_entry.payload_json or {}
                source_code = payload.get("source_code", "")
                severity_str = payload.get("severity", "INFO")

                norm_event = events_by_id.get(outbox_entry.normalized_event_id)
                if not norm_event:
                    await self.outbox_repo.mark_failed(outbox_entry.id, "normalized_event_not_found")
                    stats["errors"] += 1
                    continue

                severity = Severity(severity_str) if severity_str in Severity.__members__ else Severity.INFO

                # Find matching notification rules
                rules = await self.rule_repo.get_matching(
                    company_id=norm_event.company_id,
                    source_code=source_code,
                    severity=severity,
                )

                if not rules:
                    await self.outbox_repo.mark_done(outbox_entry.id)
                    stats["processed"] += 1
                    continue

                for rule in rules:
                    company_ticker = norm_event.company.ticker if norm_event.company else "UNKNOWN"
                    subject = _sanitize_header(
                        f"[{company_ticker}][{source_code.upper()}] Yeni olay: {norm_event.title or 'Bilinmeyen'}"
                    )
                    body = self._build_body(norm_event, payload)

                    provider = (
                        NotificationProvider.SMTP
                        if settings.enable_real_email and settings.smtp_host
                        else NotificationProvider.DRY_RUN
                    )

                    # Atomically insert notification as idempotency record BEFORE sending
                    # If another worker already created this notification, create_if_not_exists returns None
                    notif = await self.notif_repo.create_if_not_exists(
                        rule_id=rule.id,
                        outbox_id=outbox_entry.id,
                        normalized_event_id=norm_event.id,
                        email=rule.email,
                        provider=provider,
                        status=NotificationStatus.PENDING,
                        subject=subject,
                        body_text=body,
                    )

                    if notif is None:
                        # Already sent/claimed by another worker
                        logger.info("notification_duplicate_skipped",
                                    event_id=str(norm_event.id), email=rule.email)
                        stats["skipped"] += 1
                        continue

                    # Now actually send
                    if provider == NotificationProvider.SMTP:
                        try:
                            await self._send_email(rule.email, subject, body)
                            notif.status = NotificationStatus.SENT
                            notif.sent_at = utcnow()
                        except Exception as e:
                            notif.status = NotificationStatus.FAILED
                            notif.error_message = str(e)
                            logger.error("email_send_error", email=rule.email, error=str(e))
                    else:
                        notif.status = NotificationStatus.SENT
                        notif.sent_at = utcnow()
                        logger.info("dry_run_notification", email=rule.email, subject=subject)

                    await self.session.flush()
                    stats["notifications_sent"] += 1

                await self.outbox_repo.mark_done(outbox_entry.id)
                stats["processed"] += 1

            except Exception as e:
                logger.error("outbox_processing_error", outbox_id=str(outbox_entry.id), error=str(e))
                await self.outbox_repo.mark_failed(outbox_entry.id, str(e))
                stats["errors"] += 1

        await self.session.commit()
        return stats

    def _build_body(self, event: NormalizedEvent, payload: dict) -> str:
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

    async def _send_email(self, to: str, subject: str, body: str) -> None:
        try:
            import aiosmtplib

            await aiosmtplib.send(
                message=self._build_mime_message(to, subject, body),
                hostname=settings.smtp_host,
                port=settings.smtp_port,
                username=settings.smtp_username or None,
                password=settings.smtp_password or None,
                use_tls=settings.smtp_use_tls,
            )
        except ImportError:
            logger.warning("aiosmtplib_not_installed_using_dry_run")
            raise

    def _build_mime_message(self, to: str, subject: str, body: str):
        from email.mime.text import MIMEText

        msg = MIMEText(body, "plain", "utf-8")
        msg["Subject"] = _sanitize_header(subject)
        msg["From"] = settings.smtp_from
        msg["To"] = to
        return msg
