"""PriceService (legacy ``price`` poll) → market store bar upsert: sanitising, counting, precedence."""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock

from sqlalchemy import select

from src.adapters.base import PriceRecord
from src.db.models import Company, PriceBar
from src.db.repositories.market import BarUpsertStats, upsert_bars
from src.services import event_service
from src.services.event_service import PriceService, price_rows


def _records():
    return [
        PriceRecord(ticker="THYAO", open=float("nan"), close=330.25, volume=float("inf"),
                    trading_date=datetime(2026, 7, 14, tzinfo=timezone.utc)),
        PriceRecord(ticker="THYAO", close=331.0, trading_date=datetime(2026, 7, 15), interval="1h"),
        PriceRecord(ticker="", close=332.0, trading_date=datetime(2026, 7, 16), source="yfinance"),
        PriceRecord(ticker="THYAO", close=1.0, trading_date=None),  # unusable
    ]


def test_price_rows_are_sanitised():
    company = Company(id=uuid.uuid4(), ticker="THYAO")
    rows, invalid = price_rows(_records(), company)

    assert invalid == 1
    assert rows[0]["open"] is None and rows[0]["volume"] is None  # NaN/Inf never stored
    assert rows[0]["close"] == 330.25
    assert rows[0]["bar_date"] == date(2026, 7, 14)
    assert rows[0]["source"] == "tradingview"  # borsapy bars are TradingView bars
    assert rows[0]["is_final"] is True and rows[0]["company_id"] == company.id
    assert rows[1]["interval"] == "1h"
    assert rows[2]["symbol"] == "THYAO" and rows[2]["source"] == "yfinance"


async def test_process_prices_counts_through_the_store_upsert(monkeypatch):
    session = AsyncMock()
    seen: list[list[dict]] = []

    async def fake_upsert(sess, rows):
        seen.append(list(rows))
        return BarUpsertStats(inserted=1, updated=1, unchanged=1)

    monkeypatch.setattr(event_service, "upsert_bars", fake_upsert)
    stats = await PriceService(session).process_prices(_records(), Company(id=uuid.uuid4(), ticker="THYAO"))

    assert stats == {"new_prices": 1, "updated_prices": 1, "duplicates": 1, "invalid": 1}
    assert len(seen) == 1 and len(seen[0]) == 3  # one statement for the whole company
    session.commit.assert_awaited_once()


async def test_process_prices_without_usable_rows_still_commits(monkeypatch):
    session = AsyncMock()
    monkeypatch.setattr(event_service, "upsert_bars", AsyncMock(side_effect=AssertionError("not called")))
    stats = await PriceService(session).process_prices(
        [PriceRecord(ticker="THYAO", close=1.0, trading_date=None)], Company(id=uuid.uuid4(), ticker="THYAO")
    )
    assert stats == {"new_prices": 0, "updated_prices": 0, "duplicates": 0, "invalid": 1}
    session.commit.assert_awaited_once()


async def test_legacy_yahoo_rows_cannot_override_canonical_bars(pg_session):
    company = Company(ticker="THYAO", legal_name="THY", display_name="THY", tracking_tier="core")
    pg_session.add(company)
    await pg_session.flush()
    await upsert_bars(pg_session, [{"symbol": "THYAO", "bar_date": date(2026, 7, 16), "close": 330.0,
                                    "source": "tradingview"}])
    await pg_session.commit()

    stats = await PriceService(pg_session).process_prices(
        [PriceRecord(ticker="THYAO", close=329.0, trading_date=datetime(2026, 7, 16), source="yfinance"),
         PriceRecord(ticker="THYAO", close=331.0, trading_date=datetime(2026, 7, 17), source="borsapy")],
        company,
    )

    assert stats == {"new_prices": 1, "updated_prices": 0, "duplicates": 1, "invalid": 0}
    bars = (await pg_session.execute(select(PriceBar).order_by(PriceBar.bar_date))).scalars().all()
    assert [(b.source, b.close) for b in bars] == [("tradingview", Decimal("330.0000")),
                                                   ("tradingview", Decimal("331.0000"))]
    assert bars[1].company_id == company.id
