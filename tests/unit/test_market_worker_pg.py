"""Market worker jobs end-to-end against PostgreSQL (scanner / İş Yatırım mocked)."""

from contextlib import asynccontextmanager
from datetime import date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.adapters.utils import ISTANBUL_TZ
from src.db.models import Company, DataSnapshot, PriceBar, Quote
from src.db.repositories.market import HistoryMarkerRepository, upsert_bars
from src.services import market_service
from src.services.ingestion import JobRun
from src.workers import market_worker as mw

SESSION_TIME = 1790143200  # 2026-09-23 09:00 Istanbul (the daily bar's open)
IN_SESSION = datetime(2026, 9, 23, 14, 0, tzinfo=ISTANBUL_TZ)
AFTER_CLOSE = datetime(2026, 9, 23, 18, 45, tzinfo=ISTANBUL_TZ)


def _row(close, prev, volume, **extra):
    return {"close": close, "open": prev, "high": close + 1, "low": prev - 1, "volume": volume,
            "change": (close - prev) / prev * 100, "change_abs": close - prev, "close[1]": prev,
            "market_cap_basic": 1e11, "Value.Traded": close * volume, "description": "X", "type": "stock",
            "currency": "TRY", "update_time": SESSION_TIME + 20000, "update_mode": "delayed_streaming_900",
            "time": SESSION_TIME, "price_earnings_ttm": 4.2, "SMA50": 290.0, **extra}


@pytest.fixture
async def store(pg_session, pg_url, monkeypatch):
    schema = (await pg_session.execute(text("show search_path"))).scalar()
    engine = create_async_engine(pg_url, connect_args={"server_settings": {"search_path": schema}})
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(mw, "async_session_factory", factory)
    monkeypatch.setattr(market_service, "async_session_factory", factory)
    monkeypatch.setattr(market_service, "_store_down_until", 0.0)

    @asynccontextmanager
    async def no_lock(name):
        yield True

    @asynccontextmanager
    async def no_bookkeeping(job, scope=None):  # ingestion_runs bookkeeping has its own tests
        yield JobRun(job=job, scope=scope)

    monkeypatch.setattr(mw, "source_lock", no_lock)
    monkeypatch.setattr(mw, "run_job", no_bookkeeping)

    thy = Company(ticker="THYAO", legal_name="THY", display_name="THY", tracking_tier="core")
    kon = Company(ticker="KONTR", legal_name="KONTROLMATIK", display_name="Kontrolmatik", tracking_tier="universe")
    pg_session.add_all([thy, kon])
    await pg_session.commit()
    yield {"session": pg_session, "factory": factory, "ids": {"THYAO": thy.id, "KONTR": kon.id}}
    await engine.dispose()


def _scanner(monkeypatch, rows):
    async def fake_scan(symbols, columns, **kwargs):
        return {s: rows[s] for s in symbols if s in rows}

    monkeypatch.setattr(mw, "tradingview_scan", fake_scan)


def _isyatirim(monkeypatch, quotes):
    async def fake(symbols):
        return {s: quotes[s] for s in symbols if s in quotes}

    monkeypatch.setattr(mw, "fetch_isyatirim_quotes", fake)


async def test_quote_cycle_writes_quotes_running_bars_and_extras(store, monkeypatch):
    _scanner(monkeypatch, {
        "THYAO": _row(298.5, 298.0, 34150549),
        "KONTR": _row(40.1, 39.8, 1_000_000),
        "XU100": {**_row(13251.85, 13198.84, 6931772953), "type": "index", "market_cap_basic": None},
    })
    _isyatirim(monkeypatch, {"XUSIN": {
        "symbol": "XUSIN", "last": 17713.37, "open": 17432.37, "high": 17875.94, "low": 17432.37,
        "prev_close": 17613.11, "change": 100.26, "change_percent": 0.569, "volume": 5850137659.0,
        "turnover": 68585390542.21, "bid": None, "ask": None, "timestamp": SESSION_TIME + 33012,
        "updated_at": None, "name": None, "type": "index", "currency": "TRY", "market_cap": None,
        "source": "isyatirim", "delay_seconds": 900, "session_date": date(2026, 9, 23)}})

    result = await mw.run_quotes(now=IN_SESSION)

    # 2 companies + the 4 main indices requested; XU030/XBANK are unknown to the fake scanner.
    assert (result["items_total"], result["items_ok"]) == (6, 4)
    assert result["isyatirim_fallback"] == ["XUSIN"]
    session = store["session"]
    quotes = {q.symbol: q for q in (await session.execute(select(Quote))).scalars().all()}
    assert set(quotes) == {"THYAO", "KONTR", "XU100", "XUSIN"}
    thy = quotes["THYAO"]
    assert (thy.source, thy.delay_seconds, thy.session_date) == ("tradingview", 900, date(2026, 9, 23))
    assert thy.company_id == store["ids"]["THYAO"] and thy.security_type == "stock"
    assert thy.prev_close == Decimal("298.0000") and thy.volume == Decimal("34150549")
    assert quotes["XUSIN"].source == "isyatirim" and quotes["XUSIN"].security_type == "index"
    bars = {b.symbol: b for b in (await session.execute(select(PriceBar))).scalars().all()}
    assert bars["THYAO"].is_final is False and bars["THYAO"].bar_date == date(2026, 9, 23)
    assert bars["XUSIN"].source == "isyatirim"
    extras = await session.get(DataSnapshot, market_service.EXTRAS_KEY)
    assert extras.payload["symbols"]["THYAO"] == {"SMA50": 290.0, "price_earnings_ttm": 4.2}


async def test_daily_job_finalises_bars_and_flags_broken_continuity(store, monkeypatch):
    session = store["session"]
    await upsert_bars(session, [
        {"symbol": "THYAO", "bar_date": date(2026, 9, 22), "close": 298.0, "source": "tradingview"},
        {"symbol": "KONTR", "bar_date": date(2026, 9, 22), "close": 80.2, "source": "tradingview"},  # pre-split
    ])
    await session.commit()
    _scanner(monkeypatch, {"THYAO": _row(298.5, 298.0, 34150549), "KONTR": _row(40.1, 40.1, 1_000_000)})
    _isyatirim(monkeypatch, {})

    result = await mw.run_daily_bars(now=AFTER_CLOSE)

    assert result["final_bars"] == 2 and result["refresh_flagged"] == ["KONTR"]
    assert list(result["continuity_breaks"]) == ["KONTR"]
    bar = (await session.execute(
        select(PriceBar).where(PriceBar.symbol == "THYAO", PriceBar.bar_date == date(2026, 9, 23))
    )).scalar_one()
    assert bar.is_final is True and bar.close == Decimal("298.5000") and bar.company_id == store["ids"]["THYAO"]
    marker = (await HistoryMarkerRepository(session).get_many(["KONTR"]))["KONTR"]
    assert marker.refresh is True and "80.2" in marker.reason
    plan = mw.plan_backfill(
        [mw.Target("KONTR", store["ids"]["KONTR"], "universe", "stock")], {}, {"KONTR": marker}, AFTER_CLOSE.date()
    )
    assert plan[0].priority == 1  # a refresh outranks every history extension


async def test_market_service_reads_what_the_worker_wrote(store, monkeypatch):
    _scanner(monkeypatch, {"THYAO": _row(298.5, 298.0, 34150549)})
    _isyatirim(monkeypatch, {})
    await mw.run_quotes(symbols=["THYAO"], now=IN_SESSION)

    async def no_live(symbols):
        raise AssertionError("fresh store: no provider call expected")

    monkeypatch.setattr(market_service, "_live_quotes", no_live)
    now = datetime.now(ISTANBUL_TZ)
    monkeypatch.setattr(market_service, "quote_is_fresh", lambda fetched_at, now=None: True)
    result = await market_service.get_quotes(["THYAO"], now=now)
    assert result.served == {"THYAO": "store"} and result.quotes["THYAO"]["last"] == 298.5
    assert result.meta.delay_seconds == 900 and result.meta.as_of == "2026-09-23"


async def test_backfill_loads_history_records_markers_and_retries_failures_tomorrow(store, monkeypatch):
    import pandas as pd

    from src.adapters import price

    index = pd.bdate_range("2024-09-02", "2026-09-22", tz=ISTANBUL_TZ) + pd.Timedelta(hours=9)
    frame = price.clean_bars(pd.DataFrame(
        {"Open": 10.0, "High": 11.0, "Low": 9.0, "Close": 10.5, "Volume": 1000.0}, index=index))
    calls: list[str] = []

    async def fake_load(symbol, period, interval, start=None):
        calls.append(symbol)
        if symbol == "KONTR":
            raise price.MarketDataError("Fiyat geçmişi sağlayıcıdan alınamadı", status_code=503)
        return frame[frame.index >= pd.Timestamp(start, tz=ISTANBUL_TZ)]

    async def two_targets(symbols=None, include_indices=True):
        return [mw.Target("THYAO", store["ids"]["THYAO"], "universe", "stock"),
                mw.Target("KONTR", store["ids"]["KONTR"], "universe", "stock")]

    monkeypatch.setattr(price, "_load_bars", fake_load)
    monkeypatch.setattr(mw, "load_targets", two_targets)
    monkeypatch.setattr(mw.settings, "market_backfill_delay_seconds", 0.0)

    first = await mw.run_backfill(now=AFTER_CLOSE)
    assert first["symbols"] == ["THYAO"] and list(first["failures"]) == ["KONTR"]
    assert first["bars_inserted"] > 400  # ~2 years of sessions for a universe company
    session = store["session"]
    markers = await HistoryMarkerRepository(session).get_many(["THYAO", "KONTR"])
    assert markers["THYAO"].first_available is not None and markers["THYAO"].refresh is False
    assert markers["KONTR"].extra["failed_on"] == AFTER_CLOSE.date().isoformat()

    calls.clear()
    second = await mw.run_backfill(now=AFTER_CLOSE)  # same day: THYAO covered, KONTR waits for tomorrow
    assert calls == [] and second["pending_after"] == 0


async def test_idle_backfill_pass_is_still_recorded(store, monkeypatch):
    recorded: list[JobRun] = []

    @asynccontextmanager
    async def bookkeeping(job, scope=None):
        run = JobRun(job=job, scope=scope)
        recorded.append(run)
        yield run

    async def no_targets(symbols=None, include_indices=True):
        return []

    monkeypatch.setattr(mw, "run_job", bookkeeping)
    monkeypatch.setattr(mw, "load_targets", no_targets)
    result = await mw.run_backfill(now=AFTER_CLOSE)
    assert result["pending_after"] == 0 and [r.job for r in recorded] == ["market.bars.backfill"]
