"""PriceService sanitising and upsert bookkeeping (repository mocked)."""

import math
import uuid
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock

import pytest

from src.adapters.base import PriceRecord
from src.core.enums import PriceInterval
from src.db.models import Company
from src.services.event_service import PriceService, _json_safe


@pytest.mark.asyncio
async def test_prices_are_sanitised_and_counted():
    session = AsyncMock()
    service = PriceService(session)
    outcomes = iter(["inserted", "updated", "unchanged"])
    calls: list[dict] = []

    async def fake_upsert(**kwargs):
        calls.append(kwargs)
        return next(outcomes)

    service.price_repo.upsert = fake_upsert  # type: ignore[method-assign]
    company = Company(id=uuid.uuid4(), ticker="THYAO")
    records = [
        PriceRecord(ticker="THYAO", open=float("nan"), close=330.25, volume=float("inf"),
                    trading_date=datetime(2026, 7, 14, tzinfo=timezone.utc)),
        PriceRecord(ticker="THYAO", close=331.0, trading_date=datetime(2026, 7, 15), interval="1h"),
        PriceRecord(ticker="", close=332.0, trading_date=datetime(2026, 7, 16)),
        PriceRecord(ticker="THYAO", close=1.0, trading_date=None),  # unusable
    ]

    stats = await service.process_prices(records, company)

    assert stats == {"new_prices": 1, "updated_prices": 1, "duplicates": 1, "invalid": 1}
    assert calls[0]["open"] is None and calls[0]["volume"] is None  # NaN/Inf never stored
    assert calls[0]["close"] == 330.25
    assert calls[0]["trading_date"] == date(2026, 7, 14)
    assert calls[1]["interval"] == PriceInterval.ONE_HOUR
    assert calls[2]["ticker"] == "THYAO"
    session.commit.assert_awaited_once()


def test_json_safe():
    assert _json_safe(float("nan")) is None
    assert _json_safe(1.5) == 1.5
    assert _json_safe(7) == 7
    assert _json_safe("x") == "x"
    assert _json_safe(None) is None

    class NumpyLike:
        def __float__(self):
            return 2.5

    assert _json_safe(NumpyLike()) == 2.5
    assert not math.isnan(_json_safe(3.0))
