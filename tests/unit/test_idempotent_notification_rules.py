"""Exercise retries through HTTP with independent database transactions, including concurrency."""

import asyncio
import uuid
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import Column, MetaData, String, Table, func, insert, select, text, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from src.api import routers
from src.api.app import app
from src.core.config import settings
from src.core.mutations import IDEMPOTENCY_KEY_HEADER, IDEMPOTENT_REPLAY_HEADER, validate_idempotency_key
from src.core.mutations import InvalidIdempotencyKeyError
from src.core.mutations import RequestConflictError
from src.core.time import utcnow
from src.db.models import IdempotencyReceipt
from src.db.repositories.idempotency import IdempotencyRepository
from src.db.session import get_db

PAYLOAD = {"email": "investor@example.com", "company_ticker": "THYAO", "min_severity": "HIGH"}
HEADERS = {"X-Admin-Key": "test-admin-secret", IDEMPOTENCY_KEY_HEADER: "rule-req-20261120-01"}
SCOPE = "admin:notification_rules:create"


@pytest.fixture
async def mutation_api(tmp_path, monkeypatch):
    url = f"sqlite+aiosqlite:///{tmp_path / 'receipts.db'}"
    engine = create_async_engine(url)
    metadata = MetaData()
    # A real transactional write stands in for the notification rule. Market data is unrelated.
    writes = Table("test_rule_writes", metadata, Column("id", String, primary_key=True))
    async with engine.begin() as conn:
        await conn.run_sync(IdempotencyReceipt.__table__.create)
        await conn.run_sync(metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    state = SimpleNamespace(fail=False, sessions=sessions, writes=writes, url=url)

    class Rules:
        def __init__(self, db):
            self.db = db

        async def create(self, **kwargs):
            rule_id = uuid.uuid4()
            await self.db.execute(insert(writes).values(id=str(rule_id)))
            await asyncio.sleep(0.02)  # Let an overlapping HTTP request reach the reservation.
            if state.fail:
                state.fail = False
                raise RuntimeError("write failed after flush")
            return SimpleNamespace(id=rule_id, email=kwargs["email"])

    async def override_db():
        async with sessions() as db:
            yield db

    monkeypatch.setattr(settings, "admin_api_key", "test-admin-secret")
    monkeypatch.setattr(routers, "_company_or_404", AsyncMock(return_value=SimpleNamespace(id=uuid.uuid4(), ticker="THYAO")))
    monkeypatch.setattr(routers, "NotificationRuleRepository", Rules)
    app.dependency_overrides[get_db] = override_db
    try:
        async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
            state.client = client
            yield state
    finally:
        app.dependency_overrides.pop(get_db, None)
        await engine.dispose()


async def write_count(state) -> int:
    async with state.sessions() as db:
        return (await db.execute(select(func.count()).select_from(state.writes))).scalar_one()


async def test_notification_rule_retry_is_durable_and_conflicting_payload_is_rejected(mutation_api):
    state = mutation_api
    first = await state.client.post("/admin/notification-rules", json=PAYLOAD, headers=HEADERS)
    assert first.status_code == 201
    assert IDEMPOTENT_REPLAY_HEADER not in first.headers
    second = await state.client.post("/admin/notification-rules", json=PAYLOAD, headers=HEADERS)
    assert second.json() == first.json()
    assert second.headers[IDEMPOTENT_REPLAY_HEADER] == "true"
    conflict = await state.client.post("/admin/notification-rules", json={**PAYLOAD, "min_severity": "INFO"}, headers=HEADERS)
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "request_conflict"
    assert await write_count(state) == 1

    # A separate engine/repository has no access to the original API process's memory.
    fresh_engine = create_async_engine(state.url)
    try:
        async with async_sessionmaker(fresh_engine)() as db:
            payload = routers.NotificationRuleCreate(**PAYLOAD).model_dump(mode="json")
            assert await IdempotencyRepository(db).claim(SCOPE, HEADERS[IDEMPOTENCY_KEY_HEADER], payload) == first.json()
    finally:
        await fresh_engine.dispose()


@pytest.mark.parametrize("conflicting", [False, True])
async def test_overlapping_requests_cannot_commit_two_rules(mutation_api, conflicting):
    state = mutation_api
    first, second = await asyncio.gather(
        state.client.post("/admin/notification-rules", json=PAYLOAD, headers=HEADERS),
        state.client.post("/admin/notification-rules", json={**PAYLOAD, "min_severity": "INFO"} if conflicting else PAYLOAD, headers=HEADERS),
    )
    if conflicting:
        assert sorted([first.status_code, second.status_code]) == [201, 409]
    else:
        assert first.status_code == second.status_code == 201
        assert first.json()["id"] == second.json()["id"]
        assert sum(r.headers.get(IDEMPOTENT_REPLAY_HEADER) == "true" for r in [first, second]) == 1
    assert await write_count(state) == 1


async def test_failed_transaction_releases_request_key_and_business_write(mutation_api):
    state = mutation_api
    state.fail = True
    failed = await state.client.post("/admin/notification-rules", json=PAYLOAD, headers=HEADERS)
    assert failed.status_code == 500
    assert await write_count(state) == 0
    retried = await state.client.post("/admin/notification-rules", json=PAYLOAD, headers=HEADERS)
    assert retried.status_code == 201
    assert IDEMPOTENT_REPLAY_HEADER not in retried.headers
    assert await write_count(state) == 1


async def test_expired_key_can_be_reused(mutation_api):
    state = mutation_api
    first = await state.client.post("/admin/notification-rules", json=PAYLOAD, headers=HEADERS)
    async with state.sessions() as db:
        await db.execute(update(IdempotencyReceipt).values(expires_at=utcnow() - timedelta(seconds=1)))
        await db.commit()
    second = await state.client.post("/admin/notification-rules", json=PAYLOAD, headers=HEADERS)
    assert first.status_code == second.status_code == 201
    assert first.json()["id"] != second.json()["id"]


async def test_optional_and_invalid_idempotency_keys(mutation_api):
    assert validate_idempotency_key(None) is None
    assert validate_idempotency_key("   ") is None
    assert validate_idempotency_key("req-12345678") == "req-12345678"
    with pytest.raises(InvalidIdempotencyKeyError):
        validate_idempotency_key("bad key")
    bad = await mutation_api.client.post("/admin/notification-rules", json=PAYLOAD, headers={**HEADERS, IDEMPOTENCY_KEY_HEADER: "short"})
    assert bad.status_code == 400
    assert await write_count(mutation_api) == 0


@pytest.mark.parametrize("conflicting", [False, True])
async def test_postgres_serializes_requests_from_independent_sessions(pg_session, conflicting):
    schema = (await pg_session.execute(text("SELECT current_schema()"))).scalar_one()
    sessions = async_sessionmaker(pg_session.bind, expire_on_commit=False)

    async def write(payload):
        async with sessions() as db:
            await db.execute(text("SELECT set_config('search_path', :schema, true)"), {"schema": schema})
            repo = IdempotencyRepository(db)
            replay = await repo.claim(SCOPE, "postgres-request-01", payload)
            if replay is None:
                await asyncio.sleep(0.03)
                replay = {"id": str(uuid.uuid4())}
                await repo.complete(SCOPE, "postgres-request-01", replay)
            await db.commit()
            return replay

    results = await asyncio.gather(write(PAYLOAD), write({**PAYLOAD, "min_severity": "INFO"} if conflicting else PAYLOAD), return_exceptions=True)
    if conflicting:
        assert sum(isinstance(result, RequestConflictError) for result in results) == 1
        assert sum(isinstance(result, dict) for result in results) == 1
    else:
        assert isinstance(results[0], dict)
        assert results[0] == results[1]
    assert (await pg_session.execute(select(func.count()).select_from(IdempotencyReceipt))).scalar_one() == 1
