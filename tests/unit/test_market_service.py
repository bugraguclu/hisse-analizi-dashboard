"""Store-first market reads: session calendar, quotes and daily bars (store hit / live miss / stale fallback)."""

from datetime import UTC, date, datetime, timedelta

import pandas as pd
import pytest

from src.adapters import isyatirim_prices, price
from src.adapters.utils import ISTANBUL_TZ, MarketDataError, adapter_cache, resolve_period
from src.core.config import settings
from src.db.repositories.market import HistoryMarker
from src.services import market_service as ms

TUE_1455 = datetime(2026, 9, 22, 14, 55, tzinfo=ISTANBUL_TZ)  # session in progress
TUE_1900 = datetime(2026, 9, 22, 19, 0, tzinfo=ISTANBUL_TZ)  # after the close
SAT_1100 = datetime(2026, 9, 26, 11, 0, tzinfo=ISTANBUL_TZ)
WED_0900 = datetime(2026, 9, 23, 9, 0, tzinfo=ISTANBUL_TZ)  # before the open


@pytest.fixture(autouse=True)
def _isolated(monkeypatch):
    adapter_cache.clear()
    monkeypatch.setattr(ms, "_store_down_until", 0.0)
    writes: dict[str, list] = {"quotes": [], "bars": []}

    async def write_quotes(quotes):
        writes["quotes"].extend(quotes)

    async def write_bars(symbol, rows, marker=None):
        writes["bars"].extend(rows)

    async def no_isyatirim(symbols):
        return {}

    async def no_quote(symbol):
        raise MarketDataError("İş Yatırım verisine ulaşılamadı", status_code=503)

    async def no_capitals():
        return None

    monkeypatch.setattr(ms, "_write_quotes", write_quotes)
    monkeypatch.setattr(ms, "_write_bars", write_bars)
    monkeypatch.setattr(isyatirim_prices, "fetch_isyatirim_quotes", no_isyatirim)
    monkeypatch.setattr(isyatirim_prices, "fetch_quote", no_quote)
    monkeypatch.setattr(ms, "_read_paid_in_capitals", no_capitals)
    yield writes
    adapter_cache.clear()


def _quote(symbol="THYAO", *, last=298.5, session_date=date(2026, 9, 22), fetched_at=None, prev=298.0, **extra):
    return {
        "symbol": symbol, "name": "TÜRK HAVA YOLLARI A.O.", "type": "stock", "currency": "TRY", "last": last,
        "open": 297.0, "high": 300.0, "low": 296.0, "prev_close": prev, "change": round(last - prev, 6),
        "change_percent": round((last - prev) / prev * 100, 6), "volume": 1_000_000.0, "turnover": 3e8,
        "market_cap": 4.1e11, "bid": None, "ask": None, "timestamp": 1790143200, "updated_at": None,
        "session_date": session_date, "delay_seconds": 900, "source": "tradingview",
        "fetched_at": fetched_at, **extra,
    }


def _bar(day: date, close: float, *, final=True, fetched_at=None, source="tradingview"):
    return ms.StoredBar(
        bar_date=day, open=close - 1, high=close + 1, low=close - 2, close=close, volume=1000.0, turnover=None,
        vwap=None, source=source, adjusted=True, is_final=final,
        fetched_at=fetched_at or datetime(2026, 9, 21, 16, 0, tzinfo=UTC),
    )


def _series(end: date, sessions: int, *, last_final=True, last_fetched=None) -> list[ms.StoredBar]:
    days = pd.bdate_range(end=end, periods=sessions)
    bars = [_bar(d.date(), 100.0 + i) for i, d in enumerate(days)]
    last = bars[-1]
    bars[-1] = _bar(last.bar_date, last.close, final=last_final, fetched_at=last_fetched)
    return bars


# --- session calendar -----------------------------------------------------------------------

def test_session_windows_and_expected_trading_day():
    assert ms.in_quote_window(TUE_1455) and ms.in_session(TUE_1455)
    assert not ms.in_quote_window(TUE_1900) and not ms.in_session(TUE_1900)
    assert not ms.in_quote_window(SAT_1100)
    assert ms.in_session(datetime(2026, 9, 22, 18, 25, tzinfo=ISTANBUL_TZ))  # window closed, bar not final yet
    assert ms.expected_session_date(TUE_1455) == date(2026, 9, 22)
    assert ms.expected_session_date(WED_0900) == date(2026, 9, 22)  # before Wednesday's open
    assert ms.expected_session_date(SAT_1100) == date(2026, 9, 25)
    assert ms.last_final_moment(TUE_1900) == datetime(2026, 9, 22, 18, 30, tzinfo=ISTANBUL_TZ)
    assert ms.last_final_moment(WED_0900) == datetime(2026, 9, 22, 18, 30, tzinfo=ISTANBUL_TZ)
    assert ms.last_final_moment(datetime(2026, 9, 28, 8, 0, tzinfo=ISTANBUL_TZ)).date() == date(2026, 9, 25)


def test_session_window_is_configurable(monkeypatch):
    monkeypatch.setattr(settings, "market_session_open", "10:00")
    assert not ms.in_quote_window(datetime(2026, 9, 22, 9, 58, tzinfo=ISTANBUL_TZ))
    monkeypatch.setattr(settings, "market_session_open", "garbage")
    assert ms.session_open_time().isoformat() == "09:55:00"


def test_quote_freshness_follows_the_session():
    # In session: a couple of minutes.
    assert ms.quote_is_fresh(TUE_1455 - timedelta(seconds=90), TUE_1455)
    assert not ms.quote_is_fresh(TUE_1455 - timedelta(minutes=10), TUE_1455)
    # After the close: anything checked after the session became final, until the next open.
    assert ms.quote_is_fresh(datetime(2026, 9, 22, 18, 31, tzinfo=ISTANBUL_TZ), WED_0900)
    assert not ms.quote_is_fresh(datetime(2026, 9, 22, 18, 20, tzinfo=ISTANBUL_TZ), WED_0900)
    assert ms.quote_is_fresh(datetime(2026, 9, 25, 18, 40, tzinfo=ISTANBUL_TZ), SAT_1100)
    assert not ms.quote_is_fresh(None, SAT_1100)


# --- quotes ---------------------------------------------------------------------------------

async def test_fresh_stored_quotes_are_served_without_a_provider_call(monkeypatch):
    stored = _quote(fetched_at=TUE_1455 - timedelta(seconds=30))

    async def read(symbols):
        return {"THYAO": stored}

    async def live(symbols):
        raise AssertionError("provider must not be called")

    monkeypatch.setattr(ms, "_read_quotes", read)
    monkeypatch.setattr(ms, "_live_quotes", live)
    result = await ms.get_quotes(["THYAO"], now=TUE_1455)

    assert result.quotes["THYAO"]["last"] == 298.5
    assert result.served == {"THYAO": "store"}
    assert result.meta.served_from == "store" and result.meta.delay_seconds == 900
    assert result.meta.as_of == "2026-09-22" and result.meta.stale is False


async def test_old_quotes_are_refreshed_live_and_written_through(monkeypatch, _isolated):
    async def read(symbols):
        return {"THYAO": _quote(last=290.0, fetched_at=TUE_1455 - timedelta(minutes=20))}

    async def live(symbols):
        assert symbols == ("THYAO", "GARAN")
        return {s: _quote(s, fetched_at=datetime.now(UTC)) for s in symbols}

    monkeypatch.setattr(ms, "_read_quotes", read)
    monkeypatch.setattr(ms, "_live_quotes", live)
    result = await ms.get_quotes(["THYAO", "GARAN"], now=TUE_1455)

    assert result.quotes["THYAO"]["last"] == 298.5
    assert result.served == {"THYAO": "live", "GARAN": "live"}
    assert result.meta.served_from == "live"
    assert sorted(q["symbol"] for q in _isolated["quotes"]) == ["GARAN", "THYAO"]


async def test_provider_outage_serves_the_stored_quote_flagged_stale(monkeypatch):
    async def read(symbols):
        return {"THYAO": _quote(fetched_at=TUE_1455 - timedelta(hours=3))}

    async def down(symbols):
        raise MarketDataError("Piyasa verisi sağlayıcısına ulaşılamadı", status_code=503)

    monkeypatch.setattr(ms, "_read_quotes", read)
    monkeypatch.setattr(ms, "_live_quotes", down)
    result = await ms.get_quotes(["THYAO"], now=TUE_1455)

    assert result.quotes["THYAO"]["last"] == 298.5
    assert result.meta.served_from == "stale" and result.meta.stale is True
    assert ms.STALE_NOTE in result.meta.notes


async def test_provider_outage_without_a_stored_copy_keeps_the_error(monkeypatch):
    async def read(symbols):
        return {}

    async def down(symbols):
        raise MarketDataError("Piyasa verisi sağlayıcısına ulaşılamadı", status_code=503)

    monkeypatch.setattr(ms, "_read_quotes", read)
    monkeypatch.setattr(ms, "_live_quotes", down)
    with pytest.raises(MarketDataError) as exc_info:
        await ms.get_quotes(["THYAO"], now=TUE_1455)
    assert exc_info.value.status_code == 503


async def test_unusable_database_degrades_to_live(monkeypatch):
    """A failing database never breaks a read: the provider answers and the store is skipped for a while."""

    def broken_factory():
        raise ConnectionRefusedError("database down")

    monkeypatch.setattr(ms, "async_session_factory", broken_factory)

    async def live(symbols):
        return {"THYAO": _quote(fetched_at=datetime.now(UTC))}

    monkeypatch.setattr(ms, "_live_quotes", live)
    result = await ms.get_quotes(["THYAO"], now=TUE_1455)
    assert result.served == {"THYAO": "live"}
    assert ms.store_available() is False  # circuit open: the next reads skip the database


def test_quote_row_round_trip():
    row = ms.quote_to_row(_quote(), company_id=None)
    assert row["change_pct"] == pytest.approx(0.167785) and row["session_date"] == date(2026, 9, 22)
    assert row["quote_time"] == datetime.fromtimestamp(1790143200, UTC)

    class Row:
        pass

    stored = Row()
    for key, value in {**row, "security_type": "stock", "fetched_at": TUE_1455}.items():
        setattr(stored, key, value)
    back = ms.quote_row_to_dict(stored)
    assert back["last"] == 298.5 and back["change_percent"] == pytest.approx(0.167785)
    assert back["updated_at"] == "2026-09-23T09:00:00+03:00" and back["type"] == "stock"


def test_combined_meta_reports_the_worst_freshness():
    store = ms.build_meta(source="tradingview", fetched_at=TUE_1455, served_from="store", as_of=date(2026, 9, 22))
    stale = ms.build_meta(source="isyatirim", fetched_at=TUE_1455 - timedelta(hours=1), served_from="stale")
    combined = ms.combine_meta([store, stale])
    assert combined.served_from == "stale" and combined.stale
    assert combined.source == "isyatirim+tradingview"
    assert combined.fetched_at == TUE_1455 - timedelta(hours=1)
    assert combined.as_of == "2026-09-22"


# --- daily bars -----------------------------------------------------------------------------

@pytest.fixture
def quotes(monkeypatch):
    state = {"quote": _quote(fetched_at=datetime.now(UTC)), "served": "store"}

    async def fake_get_quotes(symbols, *, now=None):
        quote = state["quote"]
        found = {quote["symbol"]: quote} if quote else {}
        return ms.QuoteResult(found, None, {s: state["served"] for s in found})

    monkeypatch.setattr(ms, "get_quotes", fake_get_quotes)
    return state


def _reader(monkeypatch, bars, marker=None):
    async def read(symbol, since):
        return list(bars), marker

    monkeypatch.setattr(ms, "_read_bars", read)


def _no_live(monkeypatch):
    async def live(symbol):
        raise AssertionError("live history must not be fetched")

    monkeypatch.setattr(price, "get_daily_bars", live)


async def test_current_stored_series_is_a_store_hit(monkeypatch, quotes):
    bars = _series(date(2026, 9, 22), 600, last_final=False, last_fetched=datetime.now(UTC))
    _reader(monkeypatch, bars)
    _no_live(monkeypatch)
    result = await ms.daily_bars("THYAO", now=TUE_1455)

    assert len(result.frame) == 600 and result.meta.served_from == "store"
    assert result.frame.index[-1] == pd.Timestamp("2026-09-22 09:00", tz=ISTANBUL_TZ)
    assert result.meta.as_of == "2026-09-22"


async def test_missing_session_bar_is_rebuilt_from_the_quote_when_the_series_is_continuous(
    monkeypatch, quotes, _isolated
):
    bars = _series(date(2026, 9, 21), 600)  # last stored session: Monday
    quotes["quote"] = _quote(prev=bars[-1].close, prev_bar_close=bars[-1].close, fetched_at=datetime.now(UTC))
    _reader(monkeypatch, bars)
    _no_live(monkeypatch)
    result = await ms.daily_bars("THYAO", now=TUE_1455)

    assert result.frame.index[-1].date() == date(2026, 9, 22)
    assert result.frame["Close"].iloc[-1] == 298.5
    assert result.meta.served_from == "store"
    assert _isolated["bars"][0]["bar_date"] == date(2026, 9, 22) and _isolated["bars"][0]["is_final"] is False


async def test_a_gap_before_the_quote_forces_a_live_download(monkeypatch, quotes, _isolated):
    bars = _series(date(2026, 9, 18), 600)  # Monday missing
    quotes["quote"] = _quote(prev=250.0, prev_bar_close=250.0, fetched_at=datetime.now(UTC))
    _reader(monkeypatch, bars)
    live_frame = price.clean_bars(pd.DataFrame(
        {"Open": [1.0, 2.0], "High": [1.0, 2.0], "Low": [1.0, 2.0], "Close": [250.0, 298.5], "Volume": [1.0, 2.0]},
        index=pd.DatetimeIndex(["2026-09-21 09:00", "2026-09-22 09:00"], tz=ISTANBUL_TZ),
    ))

    async def live(symbol):
        return live_frame

    monkeypatch.setattr(price, "get_daily_bars", live)
    result = await ms.daily_bars("THYAO", now=TUE_1455)

    assert result.meta.served_from == "live" and len(result.frame) == 2
    written = {row["bar_date"]: row for row in _isolated["bars"]}
    assert written[date(2026, 9, 21)]["is_final"] is True and written[date(2026, 9, 22)]["is_final"] is False


async def test_short_history_goes_live_and_falls_back_to_stale_bars(monkeypatch, quotes):
    bars = _series(date(2026, 9, 22), 60)  # the 63-bar migrated series is not enough for 2 years
    _reader(monkeypatch, bars)

    async def down(symbol):
        raise MarketDataError("Fiyat geçmişi sağlayıcıdan alınamadı", status_code=503)

    monkeypatch.setattr(price, "get_daily_bars", down)
    result = await ms.daily_bars("THYAO", now=TUE_1900)

    assert result.meta.served_from == "stale" and result.meta.stale
    assert len(result.frame) == 60

    _reader(monkeypatch, [])
    with pytest.raises(MarketDataError):
        await ms.daily_bars("THYAO", now=TUE_1900)


def test_history_coverage_accepts_younger_listings():
    start = date(2024, 9, 22)
    assert ms.history_covers(date(2024, 9, 30), start, None)  # within the weekend/holiday tolerance
    assert not ms.history_covers(date(2025, 3, 1), start, None)
    young = HistoryMarker(symbol="NEWCO", first_available=date(2025, 3, 3), requested_from=date(2024, 9, 1))
    assert ms.history_covers(date(2025, 3, 3), start, young)
    assert not ms.history_covers(date(2025, 6, 1), start, young)


def test_weekly_bars_are_derived_like_tradingview():
    # 18-22 May 2026: 19 May is a holiday; TradingView stamps the week with Monday 09:00.
    days = pd.DatetimeIndex(["2026-05-18 09:00", "2026-05-20 09:00", "2026-05-21 09:00", "2026-05-22 09:00",
                             "2026-05-25 09:00", "2026-05-26 09:30"], tz=ISTANBUL_TZ)
    frame = pd.DataFrame(
        {"Open": [299.5, 292.0, 295.0, 274.0, 299.0, 297.5], "High": [301.0, 300.25, 295.75, 290.25, 300.5, 298.0],
         "Low": [294.5, 289.75, 273.25, 271.5, 296.0, 295.25], "Close": [294.5, 295.0, 274.0, 288.0, 297.5, 296.75],
         "Volume": [36354194.0, 34515033.0, 57504394.0, 62579877.0, 44110081.0, 11744557.0]},
        index=days,
    )
    weekly = ms.weekly_from_daily(frame)

    assert [ts.isoformat() for ts in weekly.index] == ["2026-05-18T09:00:00+03:00", "2026-05-25T09:00:00+03:00"]
    first = weekly.iloc[0]
    assert (first["Open"], first["High"], first["Low"], first["Close"]) == (299.5, 301.0, 271.5, 288.0)
    assert first["Volume"] == 190953498.0  # TradingView's weekly volume for that week


def test_a_week_starting_with_a_holiday_is_stamped_with_its_first_session():
    # 2-4 May 2022 Ramazan Bayramı: TradingView's weekly bar is dated Thursday 5 May.
    days = pd.DatetimeIndex(["2022-04-29 09:00", "2022-05-05 09:00", "2022-05-06 09:00"], tz=ISTANBUL_TZ)
    frame = pd.DataFrame({"Open": [1.0, 2.0, 3.0], "High": [1.0, 2.0, 3.0], "Low": [1.0, 2.0, 3.0],
                          "Close": [1.0, 2.0, 3.0], "Volume": [1.0, 2.0, 3.0]}, index=days)
    weekly = ms.weekly_from_daily(frame)
    assert [ts.date().isoformat() for ts in weekly.index] == ["2022-04-29", "2022-05-05"]
    assert list(weekly["Volume"]) == [1.0, 5.0]


async def test_weekly_chart_uses_stored_history_when_it_reaches_back(monkeypatch, quotes):
    bars = _series(date(2026, 9, 22), 1330, last_final=False, last_fetched=datetime.now(UTC))
    _reader(monkeypatch, bars)
    _no_live(monkeypatch)

    async def no_live_weekly(symbol, spec):
        raise AssertionError("TradingView weekly bars must not be fetched")

    monkeypatch.setattr(price, "get_chart_window_parts", no_live_weekly)
    window = await ms.get_chart_window("THYAO", resolve_period("5y"), now=TUE_1455)

    assert window.meta.served_from == "store"
    assert window.bars.index[0].date() >= date(2021, 9, 22)
    assert all(ts.weekday() == 0 for ts in window.bars.index)  # synthetic series: no holidays
    assert window.reference["reference_date"] is not None


async def test_weekly_chart_without_stored_history_uses_tradingview(monkeypatch, quotes):
    _reader(monkeypatch, _series(date(2026, 9, 22), 500))
    calls = []

    async def live_weekly(symbol, spec):
        calls.append(spec.key)
        frame = price.clean_bars(None)
        return frame, frame, {"reference_close": None, "reference_date": None}

    monkeypatch.setattr(price, "get_chart_window_parts", live_weekly)
    window = await ms.get_chart_window("KONTR", resolve_period("5y"), now=TUE_1455)

    assert calls == ["5y"] and window.meta.served_from == "live"


def test_rebased_sessions_detect_a_readjusted_provider_series():
    stored = [_bar(date(2026, 5, 12), 781.0), _bar(date(2026, 5, 13), 813.0), _bar(date(2026, 5, 14), 414.0)]
    live = price.clean_bars(pd.DataFrame(
        {"Open": [390.5, 406.5, 414.0], "High": [391.0, 407.0, 415.0], "Low": [389.0, 405.0, 410.0],
         "Close": [390.5, 406.5, 414.0], "Volume": [1.0, 1.0, 1.0]},
        index=pd.DatetimeIndex(["2026-05-12 09:00", "2026-05-13 09:00", "2026-05-14 09:00"], tz=ISTANBUL_TZ),
    ))
    assert ms.rebased_sessions(stored, live) == [date(2026, 5, 12), date(2026, 5, 13)]  # BIMAS 100 % bonus issue


async def test_live_read_that_rebases_the_series_requests_a_history_refresh(monkeypatch, quotes):
    stored = [_bar(date(2026, 5, 13), 813.0)]
    _reader(monkeypatch, stored)
    live = price.clean_bars(pd.DataFrame(
        {"Open": [406.5], "High": [407.0], "Low": [405.0], "Close": [406.5], "Volume": [1.0]},
        index=pd.DatetimeIndex(["2026-05-13 09:00"], tz=ISTANBUL_TZ),
    ))
    refreshed: list[tuple[str, str]] = []

    async def fake_live(symbol):
        return live

    async def fake_refresh(symbol, reason):
        refreshed.append((symbol, reason))

    monkeypatch.setattr(price, "get_daily_bars", fake_live)
    monkeypatch.setattr(ms, "_request_refresh", fake_refresh)
    result = await ms.daily_bars("BIMAS", now=TUE_1900)

    assert result.meta.served_from == "live"
    assert refreshed and refreshed[0][0] == "BIMAS" and "1 stored closes differ" in refreshed[0][1]
