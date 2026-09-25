"""Centralized timezone-aware datetime utilities.

All DB writes and state transitions should use utcnow() from this module.
Only localize at presentation boundaries (API responses, email subjects).
"""

from datetime import datetime, timezone, tzinfo
from zoneinfo import ZoneInfo


def utcnow() -> datetime:
    """Return timezone-aware UTC datetime. Use this instead of datetime.now()."""
    return datetime.now(timezone.utc)


def to_utc(value: datetime, assume_tz: tzinfo | str = timezone.utc) -> datetime:
    """Convert ``value`` to an aware UTC datetime.

    Naive values carry no offset information; they are interpreted in ``assume_tz``
    (a tzinfo or an IANA name such as ``"Europe/Istanbul"``) before conversion.
    """
    if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
        tz = ZoneInfo(assume_tz) if isinstance(assume_tz, str) else assume_tz
        value = value.replace(tzinfo=tz)
    return value.astimezone(timezone.utc)
