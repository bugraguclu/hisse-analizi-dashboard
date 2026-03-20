from datetime import datetime

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.enums import NotificationProvider, NotificationStatus, OutboxStatus
from src.db.models import NormalizedEvent
from src.db.repository import (
    OutboxRepository,
    NotificationRuleRepository,
    NotificationRepository,
)

logger = structlog.get_logger(__name__)


class NotificationService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.outbox_repo = OutboxRepository(session)
        self.rule_repo = NotificationRuleRepository(session)
        self.notif_repo = NotificationRepository(session)

    async def process_pending(self) -> dict:
        stats = {"processed": 0, "notifications_sent": 0, "skipped": 0, "errors": 0}

        pending = await self.outbox_repo.get_pending(limit=10)
        for outbox_entry in pending:
            try:
                payload = outbox_entry.payload_json or {}
                company_id = None
                source_code = payload.get("source_code", "")
                severity_str = payload.get("severity", "INFO")

                # Get the normalized event to find company_id
                from sqlalchemy import select
                from sqlalchemy.orm import selectinload
                from src.db.models import NormalizedEvent, Company
                from src.core.enums import Severity

                result = await self.session.execute(
                    select(NormalizedEvent)
                    .options(selectinload(NormalizedEvent.company))
                    .where(NormalizedEvent.id == outbox_entry.normalized_event_id)
                )
                norm_event = result.scalar_one_or_none()
                if not norm_event:
                    await self.outbox_repo.mark_failed(outbox_entry.id, "normalized_event_not_found")
                    stats["errors"] += 1
                    continue

                company = norm_event.company
                if not company:
                    await self.outbox_repo.mark_failed(outbox_entry.id, "company_not_found")
                    stats["errors"] += 1
                    continue

                severity = Severity(severity_str) if severity_str in Severity.__members__ else Severity.INFO

                # Find matching rules
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
                    # Check if already notified
                    already_sent = await self.notif_repo.exists(
                        normalized_event_id=norm_event.id,
                        email=rule.email,
                    )
                    if already_sent:
                        stats["skipped"] += 1
                        continue

                    # Build notification
                    subject = f"[{company.ticker}][{source_code.upper()}] Yeni olay: {norm_event.title or 'Bilinmeyen'}"
                    body = self._build_body(norm_event, payload)

                    provider = (
                        NotificationProvider.SMTP
                        if settings.enable_real_email and settings.smtp_host
                        else NotificationProvider.DRY_RUN
                    )

                    status = NotificationStatus.SENT
                    error_msg = None

                    if provider == NotificationProvider.SMTP:
                        try:
                            await self._send_email(rule.email, subject, body)
                        except Exception as e:
                            status = NotificationStatus.FAILED
                            error_msg = str(e)
                            logger.error("email_send_error", email=rule.email, error=str(e))
                    else:
                        logger.info(
                            "dry_run_notification",
                            email=rule.email,
                            subject=subject,
                        )

                    await self.notif_repo.create(
                        rule_id=rule.id,
                        outbox_id=outbox_entry.id,
                        normalized_event_id=norm_event.id,
                        email=rule.email,
                        provider=provider,
                        status=status,
                        subject=subject,
                        body_text=body,
                        sent_at=datetime.now() if status == NotificationStatus.SENT else None,
                        error_message=error_msg,
                    )
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
            f"Başlık: {event.title or 'N/A'}",
            f"Kaynak: {event.source_code}",
            f"Tür: {event.event_type.value if event.event_type else 'N/A'}",
            f"Önem: {event.severity.value if event.severity else 'N/A'}",
            f"Yayın Zamanı: {event.published_at.isoformat() if event.published_at else 'N/A'}",
            "",
        ]
        if event.excerpt:
            lines.append(f"Özet: {event.excerpt}")
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
        msg["Subject"] = subject
        msg["From"] = settings.smtp_from
        msg["To"] = to
        return msg
