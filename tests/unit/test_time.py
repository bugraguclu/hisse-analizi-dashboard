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


class TestToUtc:
    def test_naive_values_use_the_given_zone(self):
        from datetime import datetime

        from src.core.time import to_utc

        result = to_utc(datetime(2026, 8, 1, 10, 0), "Europe/Istanbul")
        assert result == datetime(2026, 8, 1, 7, 0, tzinfo=timezone.utc)
        assert result.tzinfo == timezone.utc

    def test_aware_values_are_converted(self):
        from datetime import datetime, timedelta

        from src.core.time import to_utc

        plus3 = timezone(timedelta(hours=3))
        assert to_utc(datetime(2026, 8, 1, 10, 0, tzinfo=plus3)) == datetime(2026, 8, 1, 7, 0, tzinfo=timezone.utc)

    def test_naive_default_is_utc(self):
        from datetime import datetime

        from src.core.time import to_utc

        assert to_utc(datetime(2026, 8, 1, 10, 0)) == datetime(2026, 8, 1, 10, 0, tzinfo=timezone.utc)
