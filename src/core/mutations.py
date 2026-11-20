"""Reliable user mutation primitives: idempotency ledger & conflict-checked undo.

Adapted from the proven Yemek Takibi request-identity and revision-guarded undo
patterns so that:
1. A retried write after a dropped network response never creates a duplicate record
   (same ``Idempotency-Key`` + identical payload returns the completed response).
2. Reusing an ``Idempotency-Key`` with a different payload or scope fails loudly
   with HTTP 409 (``request_conflict``).
3. Undoing a prior change refuses to overwrite newer edits made by another tab or
   device, failing with HTTP 409 (``undo_conflict``) or 410 (``undo_expired``).
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any, Literal

IDEMPOTENCY_KEY_HEADER = "Idempotency-Key"
IDEMPOTENT_REPLAY_HEADER = "X-Idempotent-Replayed"

# Backend keeps idempotency keys for at least 48h while clients may retry outbox
# entries for up to 24h, eliminating late-retry duplicates across offline periods.
DEFAULT_IDEMPOTENCY_TTL_SECONDS = 48 * 60 * 60
DEFAULT_UNDO_WINDOW_SECONDS = 15 * 60
MAX_LEDGER_ENTRIES = 2_000

_KEY_RE = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")


class MutationError(Exception):
    """Base error carrying an HTTP status and machine-readable error code."""

    def __init__(self, detail: str, status_code: int, code: str) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code
        self.code = code


class InvalidIdempotencyKeyError(MutationError):
    def __init__(self, detail: str = "Geçersiz Idempotency-Key başlığı.") -> None:
        super().__init__(detail, status_code=400, code="invalid_idempotency_key")


class RequestConflictError(MutationError):
    def __init__(self, detail: str = "İstek kimliği farklı bir içerikle zaten kullanıldı.") -> None:
        super().__init__(detail, status_code=409, code="request_conflict")


class UndoConflictError(MutationError):
    def __init__(self, detail: str = "Kayıt sonradan değiştiği için geri alma uygulanmadı.") -> None:
        super().__init__(detail, status_code=409, code="undo_conflict")


class UndoExpiredError(MutationError):
    def __init__(self, detail: str = "Geri alma süresi doldu.") -> None:
        super().__init__(detail, status_code=410, code="undo_expired")


def validate_idempotency_key(raw: str | None) -> str | None:
    """Validate an optional ``Idempotency-Key`` header value."""
    if raw is None:
        return None
    key = raw.strip()
    if not key:
        return None
    if not _KEY_RE.match(key):
        raise InvalidIdempotencyKeyError()
    return key


def canonical_payload_hash(payload: Any) -> str:
    """Stable SHA-256 digest of a JSON-serializable mutation payload."""
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True)
class StoredMutationResponse:
    scope: str
    request_id: str
    payload_hash: str
    status_code: int
    body: dict[str, Any]
    created_at: datetime
    expires_at: datetime
    replayed: bool = False


class IdempotencyLedger:
    """Bounded, TTL-enforced idempotency ledger keyed by ``(scope, request_id)``."""

    def __init__(
        self,
        ttl_seconds: int = DEFAULT_IDEMPOTENCY_TTL_SECONDS,
        max_entries: int = MAX_LEDGER_ENTRIES,
    ) -> None:
        self._ttl_seconds = ttl_seconds
        self._max_entries = max_entries
        self._entries: dict[tuple[str, str], StoredMutationResponse] = {}
        self._lock = Lock()

    def _prune_locked(self, now: datetime) -> None:
        expired = [k for k, v in self._entries.items() if v.expires_at <= now]
        for key in expired:
            del self._entries[key]
        if len(self._entries) > self._max_entries:
            overflow = len(self._entries) - self._max_entries
            oldest = sorted(self._entries.items(), key=lambda item: item[1].created_at)[:overflow]
            for key, _ in oldest:
                del self._entries[key]

    def lookup(
        self,
        scope: str,
        request_id: str,
        payload: Any,
        *,
        now: datetime | None = None,
    ) -> StoredMutationResponse | None:
        current = now or datetime.now(timezone.utc)
        digest = canonical_payload_hash(payload)
        with self._lock:
            self._prune_locked(current)
            existing = self._entries.get((scope, request_id))
            if existing is None:
                return None
            if existing.payload_hash != digest:
                raise RequestConflictError()
            return StoredMutationResponse(
                scope=existing.scope,
                request_id=existing.request_id,
                payload_hash=existing.payload_hash,
                status_code=existing.status_code,
                body=dict(existing.body),
                created_at=existing.created_at,
                expires_at=existing.expires_at,
                replayed=True,
            )

    def record(
        self,
        scope: str,
        request_id: str,
        payload: Any,
        *,
        status_code: int,
        body: dict[str, Any],
        now: datetime | None = None,
    ) -> StoredMutationResponse:
        current = now or datetime.now(timezone.utc)
        digest = canonical_payload_hash(payload)
        with self._lock:
            self._prune_locked(current)
            existing = self._entries.get((scope, request_id))
            if existing is not None:
                if existing.payload_hash != digest:
                    raise RequestConflictError()
                return StoredMutationResponse(
                    scope=existing.scope,
                    request_id=existing.request_id,
                    payload_hash=existing.payload_hash,
                    status_code=existing.status_code,
                    body=dict(existing.body),
                    created_at=existing.created_at,
                    expires_at=existing.expires_at,
                    replayed=True,
                )
            entry = StoredMutationResponse(
                scope=scope,
                request_id=request_id,
                payload_hash=digest,
                status_code=status_code,
                body=dict(body),
                created_at=current,
                expires_at=current + timedelta(seconds=self._ttl_seconds),
                replayed=False,
            )
            self._entries[(scope, request_id)] = entry
            return entry

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()


MutationAction = Literal["create", "update", "delete"]


@dataclass(frozen=True)
class MutationRecord:
    change_id: str
    owner_id: str
    entity_type: str
    entity_id: str
    action: MutationAction
    before_revision: int
    after_revision: int
    before_state: dict[str, Any] | None
    after_state: dict[str, Any] | None
    changed_fields: tuple[str, ...] = field(default_factory=tuple)
    decided_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    undo_window_seconds: int = DEFAULT_UNDO_WINDOW_SECONDS


@dataclass(frozen=True)
class UndoPlan:
    change_id: str
    entity_type: str
    entity_id: str
    restore_action: Literal["delete", "restore", "patch"]
    restore_state: dict[str, Any] | None
    expected_revision: int


class MutationJournal:
    """Revision- and field-checked undo planner protecting newer device edits."""

    def __init__(self, max_entries: int = MAX_LEDGER_ENTRIES) -> None:
        self._max_entries = max_entries
        self._records: dict[str, MutationRecord] = {}
        self._lock = Lock()

    def record(self, entry: MutationRecord) -> MutationRecord:
        with self._lock:
            self._records[entry.change_id] = entry
            if len(self._records) > self._max_entries:
                overflow = len(self._records) - self._max_entries
                oldest = sorted(self._records.items(), key=lambda item: item[1].decided_at)[:overflow]
                for key, _ in oldest:
                    del self._records[key]
        return entry

    def plan_undo(
        self,
        *,
        owner_id: str,
        change_id: str,
        current_revision: int | None,
        current_state: dict[str, Any] | None,
        now: datetime | None = None,
    ) -> UndoPlan:
        """Compute a safe undo plan or raise ``UndoConflictError`` / ``UndoExpiredError``."""
        current_time = now or datetime.now(timezone.utc)
        with self._lock:
            record = self._records.get(change_id)

        if record is None or record.owner_id != owner_id:
            raise UndoConflictError()

        if current_time > record.decided_at + timedelta(seconds=record.undo_window_seconds):
            raise UndoExpiredError()

        if record.action == "delete":
            # A deleted entity must still be absent (or at the tombstoned revision) before restore.
            if current_state is not None and current_revision != record.after_revision:
                raise UndoConflictError()
            return UndoPlan(
                change_id=record.change_id,
                entity_type=record.entity_type,
                entity_id=record.entity_id,
                restore_action="restore",
                restore_state=dict(record.before_state) if record.before_state is not None else None,
                expected_revision=record.after_revision,
            )

        if current_state is None:
            if record.action == "create":
                # Already deleted by the user — idempotent no-op delete plan.
                return UndoPlan(
                    change_id=record.change_id,
                    entity_type=record.entity_type,
                    entity_id=record.entity_id,
                    restore_action="delete",
                    restore_state=None,
                    expected_revision=record.after_revision,
                )
            raise UndoConflictError()

        if current_revision != record.after_revision:
            raise UndoConflictError()

        after = record.after_state or {}
        for field_name in record.changed_fields:
            if current_state.get(field_name) != after.get(field_name):
                raise UndoConflictError()

        if record.action == "create":
            return UndoPlan(
                change_id=record.change_id,
                entity_type=record.entity_type,
                entity_id=record.entity_id,
                restore_action="delete",
                restore_state=None,
                expected_revision=record.after_revision,
            )

        before = record.before_state or {}
        patch = {name: before.get(name) for name in record.changed_fields} if record.changed_fields else dict(before)
        return UndoPlan(
            change_id=record.change_id,
            entity_type=record.entity_type,
            entity_id=record.entity_id,
            restore_action="patch",
            restore_state=patch,
            expected_revision=record.after_revision,
        )

    def clear(self) -> None:
        with self._lock:
            self._records.clear()


# Process-level ledger for API write endpoints (reset in test fixtures).
notification_rule_idempotency = IdempotencyLedger()
