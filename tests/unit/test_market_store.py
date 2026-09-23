"""Market store repositories against PostgreSQL: quotes upsert and price_bars precedence (ON CONFLICT)."""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select

from src.db.models import Company, DataQualityCheck, PriceBar, Quote
from src.db.repositories.market import (
    HistoryMarker,
    HistoryMarkerRepository,
    MarketBarRepository,
    QuoteRepository,
    active_universe,
    enrich_bars,
    quality_check,
    upsert_bars,
)
from src.db.repository import PriceDataRepository

D1, D2, D3 = date(2026, 9, 21), date(2026, 9, 22), date(2026, 9, 23)


def _bar(bar_date, close, *, source="tradingview", is_final=True, **extra):
    return {"symbol": "THYAO", "interval": "1d", "bar_date": bar_date, "open": close - 1, "high": close + 1,
            "low": close - 2, "close": close, "volume": 1000, "source": source, "is_final": is_final, **extra}


async def _company(session, ticker="THYAO", tier="core", active=True):
    company = Company(ticker=ticker, legal_name=ticker, display_name=ticker, exchange="BIST",
                      tracking_tier=tier, is_active=active)
    session.add(company)
    await session.flush()
    return company


async def _stored(session, bar_date):
    return (await session.execute(select(PriceBar).where(PriceBar.bar_date == bar_date))).scalar_one()


async def test_bar_upsert_counts_and_skips_unchanged(pg_session):
    stats = await upsert_bars(pg_session, [_bar(D1, 290.0), _bar(D2, 293.5)])
    assert stats.as_dict() == {"inserted": 2, "updated": 0, "unchanged": 0}
    stats = await upsert_bars(pg_session, [_bar(D1, 290.0), _bar(D2, 294.0)])
    assert stats.as_dict() == {"inserted": 0, "updated": 1, "unchanged": 1}
    await pg_session.commit()
    assert (await _stored(pg_session, D2)).close == Decimal("294.0000")


async def test_running_bar_never_replaces_a_final_bar(pg_session):
    await upsert_bars(pg_session, [_bar(D3, 298.5, is_final=True)])
    stats = await upsert_bars(pg_session, [_bar(D3, 299.0, is_final=False)])
    assert stats.unchanged == 1
    bar = await _stored(pg_session, D3)
    assert bar.close == Decimal("298.5000") and bar.is_final is True


async def test_final_bar_replaces_running_bar_and_lower_rank_cannot_override(pg_session):
    await upsert_bars(pg_session, [_bar(D3, 297.0, is_final=False)])
    # A final İş Yatırım close replaces the running TradingView bar ...
    stats = await upsert_bars(pg_session, [_bar(D3, 298.0, source="isyatirim", open=None, volume=None)])
    assert stats.updated == 1
    # ... TradingView (higher rank) replaces İş Yatırım ...
    stats = await upsert_bars(pg_session, [_bar(D3, 298.5)])
    assert stats.updated == 1
    # ... and İş Yatırım / Yahoo can no longer override the canonical TradingView bar.
    stats = await upsert_bars(pg_session, [_bar(D3, 301.0, source="isyatirim"), _bar(D2, 1.0, source="yfinance")])
    assert stats.as_dict() == {"inserted": 1, "updated": 0, "unchanged": 1}
    bar = await _stored(pg_session, D3)
    assert (bar.source, bar.close) == ("tradingview", Decimal("298.5000"))


async def test_enrichment_is_kept_and_vwap_dropped_when_the_close_is_readjusted(pg_session):
    await upsert_bars(pg_session, [_bar(D2, 298.0)])
    written = await enrich_bars(pg_session, [{"symbol": "THYAO", "bar_date": D2, "turnover": 16212514335.0,
                                              "vwap": 297.919}])
    assert written == 1
    # Same OHLCV again without enrichment: nothing changes, enrichment survives.
    assert (await upsert_bars(pg_session, [_bar(D2, 298.0)])).unchanged == 1
    bar = await _stored(pg_session, D2)
    assert bar.turnover == Decimal("16212514335.00") and bar.vwap == Decimal("297.9190")
    # A split re-adjusts the close: turnover (TL) stays, the VWAP must be re-derived.
    await upsert_bars(pg_session, [_bar(D2, 149.0)])
    await pg_session.refresh(bar)
    assert bar.turnover == Decimal("16212514335.00") and bar.vwap is None


async def test_price_data_repository_upsert_follows_the_same_rules(pg_session):
    repo = PriceDataRepository(pg_session)
    assert await repo.upsert(symbol="THYAO", bar_date=D2, close=298.0, source="tradingview") == "inserted"
    assert await repo.upsert(symbol="THYAO", bar_date=D2, close=298.0, source="tradingview") == "unchanged"
    assert await repo.upsert(symbol="THYAO", bar_date=D2, close=297.0, source="yfinance") == "unchanged"
    assert await repo.upsert(symbol="THYAO", bar_date=D2, close=298.25, source="tradingview") == "updated"


async def test_series_coverage_and_last_final_bars(pg_session):
    await upsert_bars(pg_session, [_bar(D1, 290.0), _bar(D2, 293.5), _bar(D3, 298.5, is_final=False)])
    repo = MarketBarRepository(pg_session)
    series = await repo.series("THYAO", since=D2)
    assert [b.bar_date for b in series] == [D2, D3]
    coverage = (await repo.coverage(["THYAO"]))["THYAO"]
    assert (coverage.first_date, coverage.last_date, coverage.bars, coverage.last_final_date) == (D1, D3, 3, D2)
    assert (await repo.last_final_bars(["THYAO", "GARAN"]))["THYAO"].bar_date == D2


async def test_quote_upsert_keeps_newer_provider_time(pg_session):
    company = await _company(pg_session)
    repo = QuoteRepository(pg_session)
    t0 = datetime(2026, 9, 23, 15, 9, 59, tzinfo=timezone.utc)
    row = {"symbol": "THYAO", "company_id": company.id, "last": 298.5, "prev_close": 298.0, "change": 0.5,
           "change_pct": 0.167785, "volume": 34150549, "source": "tradingview", "delay_seconds": 900,
           "quote_time": t0, "session_date": D3}
    assert await repo.upsert_many([row]) == 1
    # An older İş Yatırım quote does not overwrite the newer TradingView one ...
    older = {**row, "last": 1.0, "source": "isyatirim", "quote_time": t0 - timedelta(minutes=5), "company_id": None}
    assert await repo.upsert_many([older]) == 0
    # ... a same-time refresh is accepted (it refreshes fetched_at) and keeps the company link.
    assert await repo.upsert_many([{**row, "company_id": None, "bid": 298.5, "ask": 298.75}]) == 1
    await pg_session.commit()
    quote = await pg_session.get(Quote, "THYAO")
    assert quote is not None and quote.last == Decimal("298.5000") and quote.company_id == company.id
    assert quote.bid == Decimal("298.5000") and quote.session_date == D3
    assert await repo.latest_session_date() == D3


async def test_active_universe_lists_core_first(pg_session):
    await _company(pg_session, "ZRGYO", tier="universe")
    await _company(pg_session, "THYAO", tier="core")
    await _company(pg_session, "AAAAA", tier="universe", active=False)
    members = await active_universe(pg_session)
    assert [(m.ticker, m.tracking_tier) for m in members] == [("THYAO", "core"), ("ZRGYO", "universe")]


async def test_history_marker_round_trip_and_refresh_flag(pg_session):
    repo = HistoryMarkerRepository(pg_session)
    await repo.save(HistoryMarker(symbol="TRALT", first_available=date(2023, 2, 17),
                                  requested_from=date(2021, 9, 1), bars=900))
    await repo.request_refresh("TRALT", "split")
    await pg_session.commit()
    marker = (await repo.get_many(["TRALT"]))["TRALT"]
    assert marker.first_available == date(2023, 2, 17) and marker.bars == 900
    assert marker.refresh is True and marker.reason == "split"


async def test_quality_rows_are_valid(pg_session):
    pg_session.add(quality_check("market.close_tv_vs_isy", "pass", subject="GARAN", expected=133.1,
                                 actual=133.1, deviation=0.0, details={"days": 30}))
    await pg_session.commit()
    row = (await pg_session.execute(select(DataQualityCheck))).scalar_one()
    assert row.check_name == "market.close_tv_vs_isy" and row.details_json == {"days": 30}
