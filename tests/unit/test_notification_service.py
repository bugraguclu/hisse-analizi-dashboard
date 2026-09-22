"""Outbox processing: idempotent delivery, retries with dead-lettering, stale events."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from src.core.enums import EventType, OutboxStatus, Severity
from src.db.repository import ClaimedOutboxEntry, outbox_retry_delay
from src.services import notification_service as ns
from src.services.notification_service import (
    EventSnapshot,
    NotificationService,
    RuleSnapshot,
    build_subject,
    smtp_tls_mode,
)

COMPANY = uuid.uuid4()


def _event(**overrides) -> EventSnapshot:
    values = dict(
        id=uuid.uuid4(),
        company_id=COMPANY,
        ticker="THYAO",
        title="Kar Payı Dağıtım İşlemlerine İlişkin Bildirim",
        excerpt=None,
        source_code="kap",
        severity=Severity.HIGH,
        event_type=EventType.KAP_DISCLOSURE,
        published_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        event_url="https://www.kap.org.tr/tr/Bildirim/1",
    )
    values.update(overrides)
    return EventSnapshot(**values)


class Log(list):
    pass


class FakeSession:
    def __init__(self, log: Log):
        self.log = log

    async def commit(self):
        self.log.append("commit")

    async def rollback(self):
        self.log.append("rollback")


class FakeOutbox:
    def __init__(self, log: Log, entries):
        self.log, self.entries = log, entries

    async def reclaim_stuck(self, stuck_seconds, max_attempts):
        return 0, 0

    async def claim_pending(self, limit):
        return self.entries

    async def mark_done(self, outbox_id, note=None):
        self.log.append(("done", outbox_id, note))

    async def mark_failed(self, outbox_id, error):
        self.log.append(("dead", outbox_id, error))

    async def mark_retry(self, entry, error, *, max_attempts, base_delay_seconds, max_delay_seconds):
        status = OutboxStatus.FAILED if entry.attempts + 1 >= max_attempts else OutboxStatus.PENDING
        self.log.append(("retry", entry.id, status))
        return status


class FakeNotifications:
    def __init__(self, log: Log, delivered: set):
        self.log, self.delivered = log, delivered

    async def claim(self, *, rule_id, outbox_id, normalized_event_id, email, provider, subject, body_text):
        key = (normalized_event_id, email)
        if key in self.delivered:
            return None
        self.delivered.add(key)
        self.log.append(("claim", email))
        return uuid.uuid4()

    async def mark_sent(self, notification_id):
        self.log.append("sent")

    async def mark_failed(self, notification_id, error):
        self.log.append(("notification_failed", error))


def make_service(monkeypatch, events, rules, *, attempts=0, delivered=None, send_error=None):
    log = Log()
    entries = [ClaimedOutboxEntry(id=uuid.uuid4(), normalized_event_id=e.id, attempts=attempts) for e in events]
    service = NotificationService(FakeSession(log))  # type: ignore[arg-type]
    service.outbox_repo = FakeOutbox(log, entries)  # type: ignore[assignment]
    service.notif_repo = FakeNotifications(log, delivered if delivered is not None else set())  # type: ignore[assignment]

    async def load_events(ids):
        return {e.id: e for e in events}

    async def load_rules(company_ids):
        return {COMPANY: rules}

    async def send_email(to, subject, body, notification_id=None):
        log.append(("smtp", to))
        if send_error:
            raise send_error

    monkeypatch.setattr(service, "_load_events", load_events)
    monkeypatch.setattr(service, "_load_rules", load_rules)
    monkeypatch.setattr(service, "_send_email", send_email)
    return service, log, entries


def _rule(email="a@example.com", min_severity=Severity.INFO, filters=()):
    return RuleSnapshot(id=uuid.uuid4(), email=email, min_severity=min_severity, source_filters=tuple(filters))


@pytest.fixture
def real_email(monkeypatch):
    monkeypatch.setattr(ns.settings, "enable_real_email", True)
    monkeypatch.setattr(ns.settings, "smtp_host", "smtp.example.com")


@pytest.mark.asyncio
async def test_successful_delivery_commits_idempotency_record_before_sending(monkeypatch, real_email):
    service, log, entries = make_service(monkeypatch, [_event()], [_rule()])
    stats = await service.process_pending()
    assert stats["notifications_sent"] == 1 and stats["processed"] == 1
    claim_at = log.index(("claim", "a@example.com"))
    assert log[claim_at + 1] == "commit"  # committed before the SMTP call
    assert log.index(("smtp", "a@example.com")) > claim_at + 1
    assert ("done", entries[0].id, None) in log


@pytest.mark.asyncio
async def test_already_delivered_notification_is_not_sent_again(monkeypatch, real_email):
    event = _event()
    service, log, _ = make_service(monkeypatch, [event], [_rule()], delivered={(event.id, "a@example.com")})
    stats = await service.process_pending()
    assert stats["skipped"] == 1 and stats["notifications_sent"] == 0
    assert not any(isinstance(x, tuple) and x[0] == "smtp" for x in log)


@pytest.mark.asyncio
async def test_smtp_failure_schedules_retry(monkeypatch, real_email):
    service, log, entries = make_service(monkeypatch, [_event()], [_rule()], send_error=OSError("connection refused"))
    stats = await service.process_pending()
    assert stats["retried"] == 1 and stats["dead_lettered"] == 0
    assert ("retry", entries[0].id, OutboxStatus.PENDING) in log
    assert any(isinstance(x, tuple) and x[0] == "notification_failed" for x in log)


@pytest.mark.asyncio
async def test_last_attempt_is_dead_lettered(monkeypatch, real_email):
    monkeypatch.setattr(ns.settings, "outbox_max_attempts", 5)
    service, log, entries = make_service(monkeypatch, [_event()], [_rule()], attempts=4, send_error=OSError("down"))
    stats = await service.process_pending()
    assert stats["dead_lettered"] == 1
    assert ("retry", entries[0].id, OutboxStatus.FAILED) in log


@pytest.mark.asyncio
async def test_stale_events_are_not_emailed(monkeypatch, real_email):
    old = _event(published_at=datetime.now(timezone.utc) - timedelta(days=40))
    service, log, entries = make_service(monkeypatch, [old], [_rule()])
    stats = await service.process_pending()
    assert stats["stale_skipped"] == 1
    assert not any(isinstance(x, tuple) and x[0] in ("claim", "smtp") for x in log)
    done = next(x for x in log if isinstance(x, tuple) and x[0] == "done")
    assert "older than" in done[2]


@pytest.mark.asyncio
async def test_missing_event_is_dead_lettered(monkeypatch):
    service, log, entries = make_service(monkeypatch, [], [])
    service.outbox_repo.entries = [ClaimedOutboxEntry(id=uuid.uuid4(), normalized_event_id=uuid.uuid4(), attempts=0)]
    stats = await service.process_pending()
    assert stats["dead_lettered"] == 1


@pytest.mark.asyncio
async def test_rules_filter_by_severity_and_source(monkeypatch):
    rules = [
        _rule("high@example.com", min_severity=Severity.HIGH),
        _rule("watch@example.com", min_severity=Severity.WATCH),
        _rule("news@example.com", filters=["official_news"]),
    ]
    service, log, _ = make_service(monkeypatch, [_event(severity=Severity.WATCH)], rules)
    await service.process_pending()
    claimed = [x[1] for x in log if isinstance(x, tuple) and x[0] == "claim"]
    assert claimed == ["watch@example.com"]


def test_outbox_retry_delay_is_exponential_and_capped():
    assert [outbox_retry_delay(n, 60, 900) for n in (1, 2, 3, 4, 5, 50)] == [60, 120, 240, 480, 900, 900]


def test_subject_is_single_line_and_bounded():
    subject = build_subject("THYAO", "kap", "Başlık\r\nBcc: x@evil.com" + "x" * 500)
    assert "\n" not in subject and "\r" not in subject
    assert len(subject) <= 200


@pytest.mark.parametrize(("port", "use_tls", "expected"), [(465, True, (True, False)), (587, True, (False, True)), (1025, False, (False, False))])
def test_smtp_tls_mode(port, use_tls, expected):
    assert smtp_tls_mode(port, use_tls) == expected


def test_mime_message_has_date_and_stable_message_id(monkeypatch):
    monkeypatch.setattr(ns.settings, "smtp_from", "noreply@borsa.example.com")
    notification_id = uuid.uuid4()
    msg = NotificationService(None)._build_mime_message(  # type: ignore[arg-type]
        "a@example.com", "Konu\nX-Injected: 1", "Gövde", notification_id
    )
    assert msg["Message-ID"] == f"<{notification_id}@borsa.example.com>"
    assert msg["Date"]
    assert "\n" not in msg["Subject"]
    assert msg.get_content().strip() == "Gövde"
