"""Market worker jobs end-to-end against PostgreSQL (scanner / İş Yatırım mocked)."""

from contextlib import asynccontextmanager
from datetime import date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.adapters.isyatirim_prices import parse_history_row, parse_quote
from src.adapters.utils import ISTANBUL_TZ
from src.db.models import Company, DataQualityCheck, DataSnapshot, PriceBar, Quote
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


def _isyatirim(monkeypatch, quotes, official=None):
    """``quotes``: fallback quotes (symbols the scanner lacks); ``official``: per-symbol OneEndeks reads."""
    async def fake(symbols):
        return {s: quotes[s] for s in symbols if s in quotes}

    async def fake_quote(symbol):
        if official and symbol in official:
            return official[symbol]
        raise mw.MarketDataError("İş Yatırım verisine ulaşılamadı", status_code=503)

    monkeypatch.setattr(mw, "fetch_isyatirim_quotes", fake)
    monkeypatch.setattr(mw, "fetch_quote", fake_quote)
    monkeypatch.setattr(mw, "OFFICIAL_PASS_PAUSE_SECONDS", (0.0, 0.0))


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


async def test_daily_job_stores_official_lots_and_turnover_and_checks_them(store, monkeypatch):
    _scanner(monkeypatch, {"THYAO": _row(298.5, 298.0, 34150549)})
    official = parse_quote("THYAO", {
        "updateDate": "2026-09-23T18:09:53.000+03", "last": 298.5, "dayClose": 298.0, "open": 298.0,
        "high": 299.5, "low": 297.0, "quantity": 34210549, "volume": 10261241351.0, "capital": 1.38e9,
        "equity": 1.018517e12,
    })
    _isyatirim(monkeypatch, {}, {"THYAO": official})

    result = await mw.run_daily_bars(symbols=["THYAO"], now=AFTER_CLOSE)

    assert result["official_volume"] == {"skipped": None, "quotes": 1, "failures": 0, "failed_symbols": [],
                                         "tradingview_differs": 1, "check": "pass"}
    session = store["session"]
    query = select(PriceBar).where(PriceBar.symbol == "THYAO", PriceBar.bar_date == date(2026, 9, 23))
    bar = (await session.execute(query)).scalar_one()
    assert bar.volume == Decimal("34210549") and bar.turnover == Decimal("10261241351.00")
    check = (await session.execute(
        select(DataQualityCheck).where(DataQualityCheck.check_name == "market.volume_vs_oneendeks")
    )).scalar_one()
    assert check.status == "pass" and check.subject == "universe"
    assert check.details_json["tradingview_short_worst"][0]["missing_lots"] == 60_000

    # The post-close quote cycle writes TradingView's short count again: the official one stays.
    await mw.run_quotes(symbols=["THYAO"], now=AFTER_CLOSE)
    session.expire_all()
    bar = (await session.execute(query)).scalar_one()
    assert bar.volume == Decimal("34210549")


def _hisse_tekil(day, close, vwap, turnover):
    return parse_history_row("THYAO", {
        "HGDG_TARIH": day.strftime("%d-%m-%Y"), "HG_KAPANIS": close, "HG_AOF": vwap, "HG_HACIM": turnover,
        "HG_MIN": close - 5, "HG_MAX": close + 5, "HGDG_KAPANIS": close, "SERMAYE": 1.38e9,
    })


async def test_turnover_backfill_enriches_the_history_once_and_resumes_from_the_marker(store, monkeypatch):
    session = store["session"]
    days = [date(2026, 9, 21), date(2026, 9, 22), date(2026, 9, 23)]
    closes, vwaps = [293.5, 298.0, 298.5], [287.627, 297.919, 299.942]
    turnovers = [14954106168.0, 16212514335.0, 10261241351.0]
    await upsert_bars(session, [{"symbol": "THYAO", "bar_date": d, "open": c, "high": c + 1, "low": c - 1,
                                 "close": c, "volume": 1000, "source": "tradingview"} for d, c in zip(days, closes)])
    await session.commit()
    calls: list[tuple] = []

    async def history(symbol, start, end):
        calls.append((symbol, start, end))
        return [_hisse_tekil(d, c, v, t) for d, c, v, t in zip(days, closes, vwaps, turnovers) if start <= d <= end]

    monkeypatch.setattr(mw, "fetch_daily_history", history)
    monkeypatch.setattr(mw, "TURNOVER_PAUSE_SECONDS", (0.0, 0.0))

    result = await mw.run_turnover_backfill(["THYAO"], now=AFTER_CLOSE)

    assert calls == [("THYAO", date(2026, 9, 21), date(2026, 9, 23))]
    assert (result["windows"], result["enriched"], result["pending_after"]) == (1, 3, 0)
    session.expire_all()
    bars = (await session.execute(select(PriceBar).order_by(PriceBar.bar_date))).scalars().all()
    assert [b.turnover for b in bars] == [Decimal("14954106168.00"), Decimal("16212514335.00"),
                                         Decimal("10261241351.00")]
    assert [b.vwap for b in bars] == [Decimal("287.6270"), Decimal("297.9190"), Decimal("299.9420")]
    assert [b.close for b in bars] == [Decimal("293.5000"), Decimal("298.0000"), Decimal("298.5000")]
    assert all(b.volume == Decimal("1000") for b in bars)  # OHLCV untouched
    marker = (await HistoryMarkerRepository(session).get_many(["THYAO"]))["THYAO"]
    assert marker.extra["turnover_from"] == "2026-09-21" and marker.extra["turnover_done"] is True

    again = await mw.run_turnover_backfill(["THYAO"], now=AFTER_CLOSE)
    assert again["windows"] == 0 and len(calls) == 1  # done: no further İş Yatırım request


async def test_daily_job_before_the_open_skips_the_official_pass_on_reset_rows(store, monkeypatch):
    _scanner(monkeypatch, {"THYAO": _row(298.5, 298.0, 34150549), "KONTR": _row(40.1, 39.8, 1_000_000)})
    reset = {"updateDate": "2026-09-23T18:09:53.000+03", "last": 298.5, "dayClose": 298.5, "high": 0, "low": 0,
             "quantity": 0, "volume": 0, "capital": 1.38e9, "equity": 1.018517e12}
    reads: list[str] = []

    async def fake_quote(symbol):
        reads.append(symbol)
        return parse_quote(symbol, reset)

    _isyatirim(monkeypatch, {})
    monkeypatch.setattr(mw, "fetch_quote", fake_quote)
    monkeypatch.setattr(mw, "OFFICIAL_PROBE_SYMBOLS", 1)
    next_morning = datetime(2026, 9, 24, 8, 5, tzinfo=ISTANBUL_TZ)

    result = await mw.run_daily_bars(symbols=["THYAO", "KONTR"], now=next_morning)

    assert result["official_volume"]["skipped"] == "between_sessions" and reads == ["THYAO"]
    bar = (await store["session"].execute(
        select(PriceBar).where(PriceBar.symbol == "THYAO", PriceBar.bar_date == date(2026, 9, 23))
    )).scalar_one()
    assert bar.volume == Decimal("34150549") and bar.turnover is None  # nothing zeroed
