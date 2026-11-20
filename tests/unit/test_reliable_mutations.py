"""Tests for idempotent mutations and conflict-checked undo (backend)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from src.api.app import app
from src.core.config import settings
from src.core.mutations import (
    IDEMPOTENCY_KEY_HEADER,
    IDEMPOTENT_REPLAY_HEADER,
    IdempotencyLedger,
    InvalidIdempotencyKeyError,
    MutationJournal,
    MutationRecord,
    RequestConflictError,
    UndoConflictError,
    UndoExpiredError,
    validate_idempotency_key,
)
from src.db.session import get_db


def test_idempotency_ledger_replays_identical_payload_and_rejects_conflict() -> None:
    ledger = IdempotencyLedger(ttl_seconds=48 * 3600)
    t0 = datetime(2026, 11, 20, 10, 0, tzinfo=timezone.utc)
    payload = {"ticker": "THYAO", "email": "user@example.com", "min_severity": "HIGH"}

    assert ledger.lookup("rules:create", "req-00000001", payload, now=t0) is None
    saved = ledger.record(
        "rules:create",
        "req-00000001",
        payload,
        status_code=201,
        body={"id": 42, "ticker": "THYAO"},
        now=t0,
    )
    assert saved.replayed is False

    # Same request_id + identical payload (different key ordering) replays cleanly.
    replayed = ledger.lookup(
        "rules:create",
        "req-00000001",
        {"min_severity": "HIGH", "email": "user@example.com", "ticker": "THYAO"},
        now=t0 + timedelta(hours=12),
    )
    assert replayed is not None
    assert replayed.replayed is True
    assert replayed.body == {"id": 42, "ticker": "THYAO"}

    # Reusing the same key with a different payload must raise 409 request_conflict.
    with pytest.raises(RequestConflictError) as exc_info:
        ledger.lookup("rules:create", "req-00000001", {**payload, "ticker": "GARAN"}, now=t0 + timedelta(minutes=5))
    assert exc_info.value.status_code == 409
    assert exc_info.value.code == "request_conflict"

    # After 48h TTL the entry expires.
    assert ledger.lookup("rules:create", "req-00000001", payload, now=t0 + timedelta(hours=49)) is None


def test_validate_idempotency_key_accepts_safe_tokens_and_rejects_bad_input() -> None:
    assert validate_idempotency_key(None) is None
    assert validate_idempotency_key("   ") is None
    assert validate_idempotency_key("req-12345678") == "req-12345678"
    with pytest.raises(InvalidIdempotencyKeyError):
        validate_idempotency_key("short")
    with pytest.raises(InvalidIdempotencyKeyError):
        validate_idempotency_key("bad key with spaces")


def test_mutation_journal_conflict_checked_undo() -> None:
    journal = MutationJournal()
    t0 = datetime(2026, 11, 20, 11, 0, tzinfo=timezone.utc)
    journal.record(
        MutationRecord(
            change_id="chg-1",
            owner_id="user-a",
            entity_type="watchlist",
            entity_id="favorites",
            action="update",
            before_revision=1,
            after_revision=2,
            before_state={"tickers": ["THYAO", "GARAN"], "note": "ilk"},
            after_state={"tickers": ["GARAN"], "note": "ilk"},
            changed_fields=("tickers",),
            decided_at=t0,
            undo_window_seconds=600,
        )
    )

    # Matching owner, revision and field values → safe undo plan.
    plan = journal.plan_undo(
        owner_id="user-a",
        change_id="chg-1",
        current_revision=2,
        current_state={"tickers": ["GARAN"], "note": "ilk"},
        now=t0 + timedelta(seconds=30),
    )
    assert plan.restore_action == "patch"
    assert plan.restore_state == {"tickers": ["THYAO", "GARAN"]}

    # Intervening edit from another device advances revision → undo must fail with 409.
    with pytest.raises(UndoConflictError) as conflict:
        journal.plan_undo(
            owner_id="user-a",
            change_id="chg-1",
            current_revision=3,
            current_state={"tickers": ["GARAN", "SISE"], "note": "ilk"},
            now=t0 + timedelta(seconds=45),
        )
    assert conflict.value.status_code == 409
    assert conflict.value.code == "undo_conflict"

    # Switching accounts must never undo user-a's change.
    with pytest.raises(UndoConflictError):
        journal.plan_undo(
            owner_id="user-b",
            change_id="chg-1",
            current_revision=2,
            current_state={"tickers": ["GARAN"], "note": "ilk"},
            now=t0 + timedelta(seconds=45),
        )

    # Past undo window → 410 undo_expired.
    with pytest.raises(UndoExpiredError) as expired:
        journal.plan_undo(
            owner_id="user-a",
            change_id="chg-1",
            current_revision=2,
            current_state={"tickers": ["GARAN"], "note": "ilk"},
            now=t0 + timedelta(seconds=601),
        )
    assert expired.value.status_code == 410
    assert expired.value.code == "undo_expired"


@pytest.mark.asyncio
async def test_notification_rule_endpoint_deduplicates_retries_with_idempotency_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "admin_api_key", "test-admin-secret")

    fake_db = MagicMock()
    fake_db.commit = AsyncMock()

    async def override_db():
        yield fake_db

    fake_company = MagicMock(id=uuid.uuid4(), ticker="THYAO")
    created_ids: list[uuid.UUID] = []

    async def fake_create(**kwargs):
        rule_id = uuid.uuid4()
        created_ids.append(rule_id)
        return MagicMock(id=rule_id, email=kwargs["email"])

    app.dependency_overrides[get_db] = override_db
    try:
        with (
            patch("src.api.routers._company_or_404", new=AsyncMock(return_value=fake_company)),
            patch("src.api.routers.NotificationRuleRepository") as repo_cls,
        ):
            repo_cls.return_value.create = AsyncMock(side_effect=fake_create)

            headers = {
                "X-Admin-Key": "test-admin-secret",
                IDEMPOTENCY_KEY_HEADER: "rule-req-20261120-01",
            }
            payload = {
                "email": "investor@example.com",
                "company_ticker": "THYAO",
                "min_severity": "HIGH",
                "source_filters": ["kap"],
            }

            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                first = await client.post("/admin/notification-rules", json=payload, headers=headers)
                assert first.status_code == 201
                assert first.json()["id"] == str(created_ids[0])
                assert IDEMPOTENT_REPLAY_HEADER not in first.headers

                # Simulated client retry after dropped response: same key + same body -> single record!
                second = await client.post("/admin/notification-rules", json=payload, headers=headers)
                assert second.status_code == 201
                assert second.json()["id"] == str(created_ids[0])
                assert second.headers.get(IDEMPOTENT_REPLAY_HEADER) == "true"
                assert len(created_ids) == 1

                # Reusing the same key with a different payload -> 409 request_conflict.
                conflict = await client.post(
                    "/admin/notification-rules",
                    json={**payload, "min_severity": "INFO"},
                    headers=headers,
                )
                assert conflict.status_code == 409
                assert conflict.json()["code"] == "request_conflict"
                assert len(created_ids) == 1
    finally:
        app.dependency_overrides.clear()
