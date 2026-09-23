"""Data-platform schema smoke test against PostgreSQL (skipped without TEST_DATABASE_URL access)."""

from datetime import date
from decimal import Decimal

from sqlalchemy import select

from src.db.models import Company, PriceBar, Quote
from src.db.repository import PriceDataRepository


async def test_quote_and_price_bar_round_trip(pg_session):
    company = Company(ticker="THYAO", legal_name="TÜRK HAVA YOLLARI A.O.", display_name="Türk Hava Yolları",
                      exchange="BIST", tracking_tier="core")
    pg_session.add(company)
    await pg_session.flush()

    pg_session.add(Quote(symbol="THYAO", company_id=company.id, last=Decimal("298"), prev_close=Decimal("293.5"),
                         source="tradingview", delay_seconds=900, session_date=date(2026, 9, 22)))
    await pg_session.commit()

    repo = PriceDataRepository(pg_session)
    first = await repo.upsert(symbol="THYAO", company_id=company.id, bar_date=date(2026, 9, 22), open=293.5,
                              high=302.75, low=291.25, close=298.0, volume=54419270, source="tradingview")
    same = await repo.upsert(symbol="THYAO", company_id=company.id, bar_date=date(2026, 9, 22), open=293.5,
                             high=302.75, low=291.25, close=298.0, volume=54419270, source="tradingview")
    changed = await repo.upsert(symbol="THYAO", company_id=company.id, bar_date=date(2026, 9, 22), open=293.5,
                                high=302.75, low=291.25, close=298.25, volume=54419270, source="tradingview")
    await pg_session.commit()
    assert (first, same, changed) == ("inserted", "unchanged", "updated")

    latest = await repo.get_latest("THYAO")
    assert latest is not None and latest.close == Decimal("298.25")
    assert latest.trading_date == date(2026, 9, 22) and latest.ticker == "THYAO"  # historical API names
    assert (await pg_session.execute(select(PriceBar))).scalars().one().interval == "1d"
    quote = await pg_session.get(Quote, "THYAO")
    assert quote is not None and quote.company_id == company.id
