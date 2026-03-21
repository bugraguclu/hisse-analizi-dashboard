"""Tests for timezone utilities."""

from datetime import timezone

from src.core.time import utcnow


class TestUtcNow:
    def test_returns_utc_aware(self):
        now = utcnow()
        assert now.tzinfo is not None
        assert now.tzinfo == timezone.utc

    def test_is_recent(self):
        from datetime import datetime, timedelta
        now = utcnow()
        assert (datetime.now(timezone.utc) - now) < timedelta(seconds=1)
