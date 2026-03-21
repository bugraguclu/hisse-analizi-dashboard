"""Centralized timezone-aware datetime utilities.

All DB writes and state transitions should use utcnow() from this module.
Only localize at presentation boundaries (API responses, email subjects).
"""

from datetime import datetime, timezone


def utcnow() -> datetime:
    """Return timezone-aware UTC datetime. Use this instead of datetime.now()."""
    return datetime.now(timezone.utc)
