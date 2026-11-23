"""HTTP request identity validation; durable receipts live in db/repositories/idempotency.py."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

IDEMPOTENCY_KEY_HEADER = "Idempotency-Key"
IDEMPOTENT_REPLAY_HEADER = "X-Idempotent-Replayed"

# Persist completed request receipts for 48 hours.
DEFAULT_IDEMPOTENCY_TTL_SECONDS = 48 * 60 * 60

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
