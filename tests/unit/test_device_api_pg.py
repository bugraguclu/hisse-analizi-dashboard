"""Device API, alert evaluation and push delivery against a real PostgreSQL schema.

Skipped when TEST_DATABASE_URL is unreachable (see tests/conftest.py).
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.adapters.price import ISTANBUL_TZ
from src.api.app import app
from src.core.config import settings
from src.core.device import device_key_hash
from src.core.enums import Severity
from src.core.mutations import IDEMPOTENCY_KEY_HEADER, IDEMPOTENT_REPLAY_HEADER
from src.db.models import AlertDelivery, AlertRule, Base, Company, Device, PushSubscription, Quote
from src.db.session import get_db
from src.services import alert_service
from src.services.alert_service import KapEvent, enqueue_kap_alerts, evaluate_quote_rules
from src.services.push_service import PushService, SendResult

KEY = "k" * 43
OTHER_KEY = "o" * 43
ENDPOINT = "https://fcm.googleapis.com/fcm/send/test-endpoint"
SUB = {"endpoint": ENDPOINT, "keys": {"p256dh": "B" * 87, "auth": "a" * 22}, "locale": "tr"}
# A Tuesday inside the session (Istanbul).
SESSION_NOW = datetime(2026, 11, 24, 14, 30, tzinfo=ISTANBUL_TZ)


@pytest.fixture
async def pg(pg_url, monkeypatch):
    schema = f"t_{os.getpid()}_{uuid.uuid4().hex[:8]}"
    admin = create_async_engine(pg_url)
    try:
        async with admin.begin() as conn:
            await conn.execute(text(f"CREATE SCHEMA {schema}"))
    except Exception as e:
        await admin.dispose()
        pytest.skip(f"PostgreSQL test database unavailable: {type(e).__name__}")
    engine = create_async_engine(pg_url, connect_args={"server_settings": {"search_path": schema}})
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def override_db():
        async with sessions() as db:
            yield db

    monkeypatch.setattr(settings, "vapid_public_key", "BPUBLIC")
    monkeypatch.setattr(settings, "vapid_private_key", "PRIVATE")
    app.dependency_overrides[get_db] = override_db
    async with sessions() as db:
        db.add_all(
            [
                Company(ticker="THYAO", legal_name="Türk Hava Yolları A.O.", display_name="Türk Hava Yolları"),
                Company(ticker="GARAN", legal_name="Garanti BBVA", display_name="Garanti BBVA"),
                Company(ticker="OLDCO", legal_name="Old", display_name="Old", is_active=False),
            ]
        )
        await db.commit()
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield SimpleNamespace(client=client, sessions=sessions)
    finally:
        app.dependency_overrides.pop(get_db, None)
        await engine.dispose()
        async with admin.begin() as conn:
            await conn.execute(text(f"DROP SCHEMA IF EXISTS {schema} CASCADE"))
        await admin.dispose()


def headers(key: str = KEY, idem: str | None = None) -> dict[str, str]:
    out = {"X-Device-Key": key}
    if idem:
        out[IDEMPOTENCY_KEY_HEADER] = idem
    return out


async def count(sessions, model, *where) -> int:
    async with sessions() as db:
        return (await db.execute(select(func.count()).select_from(model).where(*where))).scalar_one()


# --- API -------------------------------------------------------------------------------

async def test_push_config_reports_disabled_without_keys(pg, monkeypatch):
    assert (await pg.client.get("/push/config")).json() == {"enabled": True, "vapid_public_key": "BPUBLIC", "price_delay_minutes": 15}
    monkeypatch.setattr(settings, "vapid_private_key", "")
    assert (await pg.client.get("/push/config")).json()["enabled"] is False
    response = await pg.client.put("/me/push/subscription", json=SUB, headers=headers())
    assert response.status_code == 503


async def test_device_key_is_required_and_reads_do_not_create_devices(pg):
    assert (await pg.client.get("/me/alerts")).status_code == 401
    assert (await pg.client.get("/me/alerts", headers={"X-Device-Key": "bad"})).status_code == 401
    assert (await pg.client.get("/me/alerts", headers=headers())).json() == []
    assert await count(pg.sessions, Device) == 0


async def test_subscription_register_rejects_foreign_endpoints_and_moves_between_devices(pg):
    bad = {**SUB, "endpoint": "https://169.254.169.254/latest/meta-data"}
    assert (await pg.client.put("/me/push/subscription", json=bad, headers=headers())).status_code == 422
    first = await pg.client.put("/me/push/subscription", json=SUB, headers=headers())
    assert first.status_code == 200 and first.json()["subscriptions"] == 1
    again = await pg.client.put("/me/push/subscription", json=SUB, headers=headers(OTHER_KEY))
    assert again.json()["id"] == first.json()["id"]
    async with pg.sessions() as db:
        owner = (await db.execute(select(Device.key_hash).join(PushSubscription, PushSubscription.device_id == Device.id))).scalar_one()
    assert owner == device_key_hash(OTHER_KEY)
    assert (await pg.client.request("DELETE", "/me/push/subscription", json={"endpoint": ENDPOINT}, headers=headers(OTHER_KEY))).status_code == 204
    assert await count(pg.sessions, PushSubscription) == 0


async def test_rule_crud_is_idempotent_and_conflict_checked(pg):
    body = {"ticker": "thyao", "kind": "price_above", "threshold": 312.5, "repeat": "rearm"}
    created = await pg.client.post("/me/alerts", json=body, headers=headers(idem="create-0001"))
    assert created.status_code == 201, created.text
    rule = created.json()
    assert rule["ticker"] == "THYAO" and rule["state"] == "pending" and rule["version"] == 1

    replay = await pg.client.post("/me/alerts", json=body, headers=headers(idem="create-0001"))
    assert replay.status_code == 201 and replay.json() == rule and replay.headers[IDEMPOTENT_REPLAY_HEADER] == "true"
    clash = await pg.client.post("/me/alerts", json={**body, "threshold": 1}, headers=headers(idem="create-0001"))
    assert clash.status_code == 409 and clash.json()["code"] == "request_conflict"
    assert await count(pg.sessions, AlertRule) == 1

    update_body = {**body, "threshold": 320, "version": 1}
    updated = await pg.client.put(f"/me/alerts/{rule['id']}", json=update_body, headers=headers(idem="update-0001"))
    assert updated.status_code == 200 and updated.json()["version"] == 2 and updated.json()["threshold"] == 320
    # The same request replayed (lost response) returns the original result, not a conflict.
    replayed = await pg.client.put(f"/me/alerts/{rule['id']}", json=update_body, headers=headers(idem="update-0001"))
    assert replayed.status_code == 200 and replayed.json()["version"] == 2
    # A different edit based on the old version is a conflict carrying the current rule.
    stale = await pg.client.put(f"/me/alerts/{rule['id']}", json={**update_body, "threshold": 330}, headers=headers(idem="update-0002"))
    assert stale.status_code == 409
    assert stale.json()["code"] == "version_conflict" and stale.json()["current"]["threshold"] == 320

    other_device = await pg.client.get("/me/alerts", headers=headers(OTHER_KEY))
    assert other_device.json() == []
    assert (await pg.client.delete(f"/me/alerts/{rule['id']}?version=1", headers=headers())).status_code == 409
    assert (await pg.client.delete(f"/me/alerts/{rule['id']}?version=2", headers=headers(idem="delete-0001"))).status_code == 204
    assert (await pg.client.delete(f"/me/alerts/{rule['id']}?version=2", headers=headers(idem="delete-0001"))).status_code == 204
    gone = await pg.client.put(f"/me/alerts/{rule['id']}", json={**update_body, "version": 2}, headers=headers())
    assert gone.status_code == 409 and gone.json()["current"] is None


async def test_client_generated_ids_and_validation(pg):
    rule_id = str(uuid.uuid4())
    body = {"id": rule_id, "ticker": "GARAN", "kind": "kap", "min_severity": "HIGH"}
    first = await pg.client.post("/me/alerts", json=body, headers=headers())
    # Retried without the receipt (e.g. it expired): the same id answers with the same rule.
    second = await pg.client.post("/me/alerts", json=body, headers=headers())
    assert first.status_code == second.status_code == 201 and first.json()["id"] == second.json()["id"] == rule_id
    assert (await pg.client.post("/me/alerts", json=body, headers=headers(OTHER_KEY))).json()["code"] == "id_taken"
    assert (await pg.client.post("/me/alerts", json={"ticker": "NOPE", "kind": "kap"}, headers=headers())).status_code == 404
    assert (await pg.client.post("/me/alerts", json={"ticker": "OLDCO", "kind": "kap"}, headers=headers())).status_code == 404
    assert (await pg.client.post("/me/alerts", json={"ticker": "GARAN", "kind": "price_above"}, headers=headers())).status_code == 422
    assert (
        await pg.client.post("/me/alerts", json={"ticker": "GARAN", "kind": "change_pct", "threshold": 80}, headers=headers())
    ).status_code == 422


async def test_rule_limit(pg, monkeypatch):
    monkeypatch.setattr(settings, "alerts_max_rules_per_device", 1)
    assert (await pg.client.post("/me/alerts", json={"ticker": "GARAN", "kind": "kap"}, headers=headers())).status_code == 201
    over = await pg.client.post("/me/alerts", json={"ticker": "THYAO", "kind": "kap"}, headers=headers())
    assert over.status_code == 409 and over.json()["code"] == "limit_reached"


async def test_forget_device_erases_everything(pg):
    await pg.client.put("/me/push/subscription", json=SUB, headers=headers())
    await pg.client.post("/me/alerts", json={"ticker": "GARAN", "kind": "kap"}, headers=headers())
    assert (await pg.client.delete("/me", headers=headers())).status_code == 204
    assert await count(pg.sessions, AlertRule) == await count(pg.sessions, PushSubscription) == await count(pg.sessions, Device) == 0


# --- Evaluation + delivery ---------------------------------------------------------------

async def _quote(sessions, last: str, change: str = "1.0", *, fetched_at: datetime | None = None, session_date=None) -> None:
    async with sessions() as db:
        company_id = (await db.execute(select(Company.id).where(Company.ticker == "THYAO"))).scalar_one()
        await db.merge(
            Quote(
                symbol="THYAO",
                company_id=company_id,
                last=Decimal(last),
                change_pct=Decimal(change),
                source="test",
                session_date=session_date or SESSION_NOW.date(),
                fetched_at=fetched_at or SESSION_NOW,
                quote_time=SESSION_NOW - timedelta(minutes=15),
            )
        )
        await db.commit()


async def _evaluate(sessions, now: datetime = SESSION_NOW) -> dict[str, int]:
    async with sessions() as db:
        return await evaluate_quote_rules(db, now)


async def test_price_rule_fires_once_per_crossing_without_duplicates(pg):
    await pg.client.put("/me/push/subscription", json=SUB, headers=headers())
    await pg.client.post("/me/alerts", json={"ticker": "THYAO", "kind": "price_above", "threshold": 300}, headers=headers())

    await _quote(pg.sessions, "295")
    assert (await _evaluate(pg.sessions))["fired"] == 0  # first look arms the rule
    await _quote(pg.sessions, "301.25", "2.5")
    assert (await _evaluate(pg.sessions))["fired"] == 1
    assert (await _evaluate(pg.sessions))["fired"] == 0  # same quote, next minute
    async with pg.sessions() as db:
        delivery = (await db.execute(select(AlertDelivery))).scalar_one()
        rule = (await db.execute(select(AlertRule))).scalar_one()
    assert delivery.title == "THYAO 300,00 TL üstüne çıktı"
    assert "301,25 TL" in delivery.body and "15 dk gecikmeli" in delivery.body
    assert delivery.url == "/hisse/THYAO"
    assert rule.trigger_count == 1 and rule.armed is False and rule.version == 1  # worker state does not bump version

    listed = (await pg.client.get("/me/alerts", headers=headers())).json()
    assert listed[0]["state"] == "done"


async def test_price_rules_are_quiet_outside_the_session_and_on_stale_quotes(pg):
    await pg.client.post("/me/alerts", json={"ticker": "THYAO", "kind": "price_below", "threshold": 300}, headers=headers())
    await _quote(pg.sessions, "310")
    await _evaluate(pg.sessions)
    await _quote(pg.sessions, "290")
    assert (await _evaluate(pg.sessions, SESSION_NOW.replace(hour=20)))["rules"] == 0  # after the session
    assert (await _evaluate(pg.sessions, SESSION_NOW + timedelta(days=4)))["rules"] == 0  # Saturday
    await _quote(pg.sessions, "290", fetched_at=SESSION_NOW - timedelta(hours=1))
    assert (await _evaluate(pg.sessions))["rules"] == 0  # stale quote
    await _quote(pg.sessions, "290", session_date=SESSION_NOW.date() - timedelta(days=1))
    assert (await _evaluate(pg.sessions))["rules"] == 0  # holiday: yesterday's session


async def test_daily_change_rule_fires_at_most_once_per_session(pg):
    await pg.client.post(
        "/me/alerts", json={"ticker": "THYAO", "kind": "change_pct", "threshold": 3, "direction": "down"}, headers=headers()
    )
    await _quote(pg.sessions, "290", "-2")
    assert (await _evaluate(pg.sessions))["fired"] == 0
    await _quote(pg.sessions, "285", "-3.4")
    assert (await _evaluate(pg.sessions))["fired"] == 1
    await _quote(pg.sessions, "280", "-5")
    assert (await _evaluate(pg.sessions, SESSION_NOW + timedelta(minutes=5)))["fired"] == 0
    async with pg.sessions() as db:
        title = (await db.execute(select(AlertDelivery.title))).scalar_one()
    assert title == "THYAO günde %3,40 düştü"


class RacingSession:
    """Delegates to a real session, but lets a user edit land right before the evaluator's UPDATE."""

    def __init__(self, db, sessions):
        self.db, self.sessions, self.raced = db, sessions, False

    async def execute(self, statement, *args, **kwargs):
        if not self.raced and getattr(statement, "is_update", False) and statement.table.name == "alert_rules":
            self.raced = True
            async with self.sessions() as other:
                await other.execute(update(AlertRule).values(version=AlertRule.version + 1, threshold=Decimal("400")))
                await other.commit()
        return await self.db.execute(statement, *args, **kwargs)

    async def commit(self):
        await self.db.commit()


async def test_concurrent_user_edit_wins_over_the_evaluator(pg):
    await pg.client.post("/me/alerts", json={"ticker": "THYAO", "kind": "price_above", "threshold": 300}, headers=headers())
    await _quote(pg.sessions, "295")
    await _evaluate(pg.sessions)  # armed
    await _quote(pg.sessions, "305")
    async with pg.sessions() as db:
        stats = await evaluate_quote_rules(RacingSession(db, pg.sessions), SESSION_NOW)  # type: ignore[arg-type]
    assert stats == {"rules": 1, "fired": 0, "state_changes": 0, "conflicts": 1}
    assert await count(pg.sessions, AlertDelivery) == 0
    async with pg.sessions() as db:
        rule = (await db.execute(select(AlertRule))).scalar_one()
    assert rule.version == 2 and rule.threshold == Decimal("400") and rule.trigger_count == 0


async def test_kap_alerts_respect_severity_and_are_idempotent(pg):
    await pg.client.post("/me/alerts", json={"ticker": "THYAO", "kind": "kap", "min_severity": "WATCH"}, headers=headers())
    await pg.client.post("/me/alerts", json={"ticker": "THYAO", "kind": "kap"}, headers=headers(OTHER_KEY))
    async with pg.sessions() as db:
        company_id = (await db.execute(select(Company.id).where(Company.ticker == "THYAO"))).scalar_one()
    info = KapEvent(id=uuid.uuid4(), company_id=company_id, ticker="THYAO", title="Özel Durum", excerpt="Uçak alımı", severity=Severity.INFO)
    high = KapEvent(id=uuid.uuid4(), company_id=company_id, ticker="THYAO", title="Pay geri alımı", excerpt=None, severity=Severity.HIGH)
    async with pg.sessions() as db:
        assert await enqueue_kap_alerts(db, info) == 1  # only the unfiltered rule
        assert await enqueue_kap_alerts(db, high) == 2
        assert await enqueue_kap_alerts(db, high) == 0  # retried outbox entry
        await db.commit()
        rows = (await db.execute(select(AlertDelivery).where(AlertDelivery.dedup_key.like("%" + str(high.id))))).scalars().all()
    assert {r.url for r in rows} == {f"/events?ticker=THYAO&event={high.id}"}
    assert all(r.title == "THYAO · yeni KAP bildirimi" and r.body.startswith("Önemli: Pay geri alımı") for r in rows)


class FakeSender:
    def __init__(self, *outcomes: str):
        self.outcomes = list(outcomes)
        self.calls: list[str] = []

    async def __call__(self, target, payload, ttl, topic):
        self.calls.append(target.endpoint)
        outcome = self.outcomes.pop(0) if self.outcomes else "sent"
        status = {"sent": 201, "gone": 410, "rejected": 400, "retry": 503}[outcome]
        return SendResult(outcome, status, None if outcome == "sent" else f"HTTP {status}")  # type: ignore[arg-type]


async def _setup_delivery(pg, endpoints: list[str]) -> uuid.UUID:
    for endpoint in endpoints:
        await pg.client.put("/me/push/subscription", json={**SUB, "endpoint": endpoint}, headers=headers())
    async with pg.sessions() as db:
        device_id = (await db.execute(select(Device.id))).scalar_one()
        delivery_id = await alert_service.enqueue_delivery(
            db, device_id=device_id, rule_id=None, dedup_key="test:1", kind="test", ticker=None,
            title="T", body="B", url="/alarmlar", ttl_seconds=600,
        )
        await db.commit()
    assert delivery_id is not None
    return delivery_id


async def _process(pg, sender) -> dict[str, int]:
    async with pg.sessions() as db:
        return await PushService(db, sender=sender).process_pending()


async def _delivery(pg, delivery_id):
    async with pg.sessions() as db:
        return (await db.execute(select(AlertDelivery).where(AlertDelivery.id == delivery_id))).scalar_one()


async def test_push_retry_never_resends_to_a_subscription_that_already_got_it(pg):
    a, b = ENDPOINT + "-a", ENDPOINT + "-b"
    delivery_id = await _setup_delivery(pg, [a, b])
    sender = FakeSender("sent", "retry")
    stats = await _process(pg, sender)
    assert stats["retried"] == 1 and sender.calls == [a, b]
    row = await _delivery(pg, delivery_id)
    assert row.status == "pending" and row.attempts == 1 and row.available_at is not None and row.sent_count == 1

    async with pg.sessions() as db:  # make it due now
        await db.execute(update(AlertDelivery).values(available_at=None))
        await db.commit()
    sender2 = FakeSender("sent")
    await _process(pg, sender2)
    assert sender2.calls == [b], "the subscription that already received it is skipped"
    row = await _delivery(pg, delivery_id)
    assert row.status == "sent" and row.sent_count == 2
    assert await _process(pg, FakeSender()) == {"claimed": 0, "sent": 0, "retried": 0, "dead_lettered": 0, "skipped": 0, "subscriptions_removed": 0}


async def test_expired_subscriptions_are_removed_and_dead_letter_after_max_attempts(pg, monkeypatch):
    delivery_id = await _setup_delivery(pg, [ENDPOINT])
    stats = await _process(pg, FakeSender("gone"))
    assert stats["subscriptions_removed"] == 1 and await count(pg.sessions, PushSubscription) == 0
    assert (await _delivery(pg, delivery_id)).status == "failed"

    monkeypatch.setattr(settings, "push_max_attempts", 2)
    async with pg.sessions() as db:
        await db.execute(text("DELETE FROM alert_deliveries"))
        await db.commit()
    delivery_id = await _setup_delivery(pg, [ENDPOINT])
    await _process(pg, FakeSender("retry"))
    async with pg.sessions() as db:
        await db.execute(update(AlertDelivery).values(available_at=None))
        await db.commit()
    stats = await _process(pg, FakeSender("retry"))
    assert stats["dead_lettered"] == 1 and (await _delivery(pg, delivery_id)).status == "failed"


async def test_crash_mid_send_is_not_resent_and_expired_deliveries_are_dropped(pg):
    delivery_id = await _setup_delivery(pg, [ENDPOINT])
    async with pg.sessions() as db:  # a worker reserved the subscription, then died while sending
        sub_id = (await db.execute(select(PushSubscription.id))).scalar_one()
        await db.execute(
            update(AlertDelivery).values(
                status="processing", attempted_subscription_ids=[str(sub_id)], updated_at=func.now() - timedelta(minutes=10)
            )
        )
        await db.commit()
    sender = FakeSender()
    await _process(pg, sender)
    assert sender.calls == [] and (await _delivery(pg, delivery_id)).status in ("failed", "sent")

    async with pg.sessions() as db:
        await db.execute(text("DELETE FROM alert_deliveries"))
        await db.commit()
    delivery_id = await _setup_delivery(pg, [ENDPOINT])
    async with pg.sessions() as db:
        await db.execute(update(AlertDelivery).values(created_at=func.now() - timedelta(hours=1)))
        await db.commit()
    sender = FakeSender()
    await _process(pg, sender)
    assert sender.calls == [] and (await _delivery(pg, delivery_id)).last_error == "expired before it could be sent"


async def test_test_push_endpoint_requires_a_subscription(pg, monkeypatch):
    assert (await pg.client.post("/me/push/test", headers=headers())).status_code == 409
    await pg.client.put("/me/push/subscription", json=SUB, headers=headers())
    sent: list[str] = []

    async def fake_process_once():
        async with pg.sessions() as db:
            await PushService(db, sender=FakeSender()).process_pending()
        sent.append("done")

    import src.workers.push_worker as push_worker

    monkeypatch.setattr(push_worker, "process_push_once", fake_process_once)
    response = await pg.client.post("/me/push/test", headers=headers())
    assert response.status_code == 202 and response.json()["subscriptions"] == 1
    deliveries = (await pg.client.get("/me/alerts/deliveries", headers=headers())).json()
    assert deliveries[0]["kind"] == "test" and deliveries[0]["status"] == "sent" and sent == ["done"]


# --- Stock notes -----------------------------------------------------------------------

async def test_notes_create_edit_conflict_and_delete(pg):
    created = await pg.client.put("/me/notes/thyao", json={"text": "Bilanço 12 Mart", "base_version": None}, headers=headers(idem="note-0001"))
    assert created.status_code == 200 and created.json()["version"] == 1 and created.json()["ticker"] == "THYAO"
    # Lost response → the outbox replays the same request: same answer, no second write.
    replay = await pg.client.put("/me/notes/THYAO", json={"text": "Bilanço 12 Mart", "base_version": None}, headers=headers(idem="note-0001"))
    assert replay.json() == created.json() and replay.headers[IDEMPOTENT_REPLAY_HEADER] == "true"

    # Another browser (same key, other edit) creating from scratch conflicts with the existing note.
    other = await pg.client.put("/me/notes/THYAO", json={"text": "Başka", "base_version": None}, headers=headers(idem="note-0002"))
    assert other.status_code == 409 and other.json()["current"]["text"] == "Bilanço 12 Mart"

    edited = await pg.client.put("/me/notes/THYAO", json={"text": "Bilanço 14 Mart", "base_version": 1}, headers=headers())
    assert edited.json()["version"] == 2
    stale = await pg.client.put("/me/notes/THYAO", json={"text": "eski", "base_version": 1}, headers=headers())
    assert stale.status_code == 409 and stale.json()["code"] == "version_conflict" and stale.json()["current"]["version"] == 2

    assert (await pg.client.get("/me/notes", headers=headers())).json()[0]["text"] == "Bilanço 14 Mart"
    assert (await pg.client.get("/me/notes", headers=headers(OTHER_KEY))).json() == []
    assert (await pg.client.delete("/me/notes/THYAO?base_version=1", headers=headers())).status_code == 409
    assert (await pg.client.delete("/me/notes/THYAO?base_version=2", headers=headers())).status_code == 204
    assert (await pg.client.delete("/me/notes/THYAO?base_version=2", headers=headers())).status_code == 204
    gone = await pg.client.put("/me/notes/THYAO", json={"text": "x", "base_version": 2}, headers=headers())
    assert gone.status_code == 409 and gone.json()["current"] is None


async def test_note_validation(pg):
    assert (await pg.client.put("/me/notes/NOPE", json={"text": "x"}, headers=headers())).status_code == 404
    assert (await pg.client.put("/me/notes/THYAO", json={"text": "   "}, headers=headers())).status_code == 422
    assert (await pg.client.put("/me/notes/THYAO", json={"text": "x" * 5001}, headers=headers())).status_code == 422
    assert (await pg.client.put("/me/notes/THYAO", json={"text": "x"})).status_code == 401
