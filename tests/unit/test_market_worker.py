"""Market worker planning and reconciliation logic (no network, no database)."""

import uuid
from datetime import date, datetime, timedelta
from types import SimpleNamespace

import pytest

from src.adapters.isyatirim_prices import IsyDailyRow, parse_history_row, parse_quote
from src.adapters.utils import ISTANBUL_TZ
from src.db.repositories.market import Coverage, HistoryMarker
from src.workers import market_worker as mw

WED_1900 = datetime(2026, 9, 23, 19, 0, tzinfo=ISTANBUL_TZ)
TODAY = WED_1900.date()


def _target(symbol, tier="core"):
    return mw.Target(symbol, uuid.uuid4(), tier, "index" if tier == "index" else "stock")


def _isy(day, close, *, vwap=None, turnover=None, adjusted=None):
    return IsyDailyRow(
        symbol="X", bar_date=day, close=close, low=close - 1, high=close + 1, vwap=vwap, turnover=turnover,
        close_adjusted=adjusted or close, vwap_adjusted=vwap, capital=1e9, market_cap=None,
        free_float_market_cap=None, usd_close=None, xu100_close=None,
    )


def _stored(day, close, *, volume=None, vwap=None, turnover=None, final=True):
    return SimpleNamespace(bar_date=day, close=close, volume=volume, vwap=vwap, turnover=turnover, is_final=final)


# --- scheduling -------------------------------------------------------------------------------

def test_quote_cycles_run_inside_the_window_and_once_after_the_close():
    tue_1455 = datetime(2026, 9, 22, 14, 55, tzinfo=ISTANBUL_TZ)
    assert mw.next_quote_run(tue_1455, None) == 0.0
    # 18:25: the window closed, the bar is final at 18:30 → wait five minutes.
    assert mw.next_quote_run(datetime(2026, 9, 22, 18, 25, tzinfo=ISTANBUL_TZ), None) == pytest.approx(300.0)
    after = datetime(2026, 9, 22, 18, 35, tzinfo=ISTANBUL_TZ)
    assert mw.next_quote_run(after, None) == 0.0  # the post-close run
    wait = mw.next_quote_run(after, after.date())  # done → next morning's open
    assert wait == pytest.approx((datetime(2026, 9, 23, 9, 55, tzinfo=ISTANBUL_TZ) - after).total_seconds())
    friday_night = datetime(2026, 9, 25, 22, 0, tzinfo=ISTANBUL_TZ)
    monday_open = datetime(2026, 9, 28, 9, 55, tzinfo=ISTANBUL_TZ)
    assert mw.next_quote_run(friday_night, friday_night.date()) == pytest.approx(
        (monday_open - friday_night).total_seconds()
    )


def test_daily_jobs_are_due_once_per_weekday_after_their_time():
    due = mw.daily_job_due
    thu_1000 = datetime(2026, 9, 24, 10, 0, tzinfo=ISTANBUL_TZ)
    assert due(WED_1900, None, "18:40", "18:40")
    assert not due(WED_1900, datetime(2026, 9, 23, 18, 41, tzinfo=ISTANBUL_TZ), "18:40", "18:40")
    assert due(WED_1900, datetime(2026, 9, 23, 18, 0, tzinfo=ISTANBUL_TZ), "18:40", "18:40")
    # Thursday morning: Wednesday's run counts until Thursday 18:40.
    assert not due(thu_1000, datetime(2026, 9, 23, 18, 41, tzinfo=ISTANBUL_TZ), "18:40", "18:40")
    assert due(thu_1000, datetime(2026, 9, 22, 18, 41, tzinfo=ISTANBUL_TZ), "18:40", "18:40")  # missed Wednesday
    sunday = datetime(2026, 9, 27, 12, 0, tzinfo=ISTANBUL_TZ)
    assert not due(sunday, datetime(2026, 9, 25, 20, 1, tzinfo=ISTANBUL_TZ), "20:00", "20:00")


async def test_unknown_jobs_are_rejected():
    with pytest.raises(ValueError):
        await mw.run_market_once(jobs=("market.nope",))


# --- continuity -------------------------------------------------------------------------------

def test_continuity_breaks_flag_gaps_and_splits_only():
    previous = {
        "GARAN": _stored(date(2026, 9, 22), 133.9),
        "BIMAS": _stored(date(2026, 5, 13), 813.0),  # stored before a 100 % bonus issue
        "THYAO": _stored(date(2026, 9, 22), 298.0),
    }
    rows = {
        "GARAN": {"close[1]": 133.9},
        "BIMAS": {"close[1]": 406.5},  # TradingView re-adjusted the series
        "THYAO": {"close[1]": 298.0002},  # float noise
        "NEWCO": {"close[1]": 10.0},  # nothing stored yet: nothing to compare
    }
    breaks = mw.continuity_breaks(rows, previous)
    assert list(breaks) == ["BIMAS"]
    assert "813" in breaks["BIMAS"] and "406.5" in breaks["BIMAS"]


# --- backfill planning ------------------------------------------------------------------------

def test_backfill_plan_orders_refresh_then_missing_then_short_history():
    targets = [
        _target("THYAO"),
        _target("GARAN"),
        _target("XU100", tier="index"),
        _target("KONTR", tier="universe"),
        _target("NEWCO", tier="universe"),
        _target("SASA", tier="universe"),
    ]
    five_years = TODAY - timedelta(days=round(365.25 * 5))
    coverage = {
        "THYAO": Coverage("THYAO", five_years - timedelta(days=20), TODAY, 1260, TODAY),  # complete
        "GARAN": Coverage("GARAN", date(2026, 5, 22), TODAY, 65, TODAY),  # migrated 4 months only
        "XU100": Coverage("XU100", five_years, TODAY, 1250, TODAY),
        "NEWCO": Coverage("NEWCO", date(2025, 3, 3), TODAY, 380, TODAY),  # young listing
        "SASA": Coverage("SASA", date(2024, 9, 1), TODAY, 520, TODAY),
    }
    markers = {
        "NEWCO": HistoryMarker("NEWCO", first_available=date(2025, 3, 3), requested_from=date(2024, 9, 1)),
        "SASA": HistoryMarker("SASA", refresh=True, reason="continuity: split"),
    }
    plan = mw.plan_backfill(targets, coverage, markers, TODAY)

    assert [(item.target.symbol, item.reason.split("_from_")[0]) for item in plan] == [
        ("SASA", "continuity: split"),  # wrong data first, whatever the tier
        ("GARAN", "short_history"),  # then core history
        ("KONTR", "no_history"),  # then the rest of the universe
    ]
    garan = plan[1]
    assert garan.start == five_years - timedelta(days=mw.BACKFILL_MARGIN_DAYS)
    assert plan[2].start == TODAY - timedelta(days=round(365.25 * 2) + mw.BACKFILL_MARGIN_DAYS)


# --- reconciliation ---------------------------------------------------------------------------

def test_reconcile_enriches_turnover_and_vwap_and_checks_volume_units():
    d1, d2 = date(2026, 9, 21), date(2026, 9, 22)
    isy = [_isy(d1, 293.5, vwap=289.1, turnover=14_000_000_000.0),
           _isy(d2, 298.0, vwap=297.919, turnover=16_212_514_335.0)]
    stored = {d1: _stored(d1, 293.5, volume=51_991_406.0), d2: _stored(d2, 298.0, volume=54_419_270.0)}
    outcome = mw.reconcile_symbol("THYAO", isy, stored, WED_1900)

    assert outcome.compared == 2 and not outcome.close_mismatches and outcome.split_ratio is None
    enriched = {row["bar_date"]: row for row in outcome.enrich}
    assert enriched[d2]["turnover"] == 16_212_514_335.0 and enriched[d2]["vwap"] == 297.919
    assert outcome.volume_compared == 2
    # 16 212 514 335 TL / 297.919 TL = 54 419 278 lots vs TradingView 54 419 270 → same unit.
    assert [m["date"] for m in outcome.volume_mismatches] == ["2026-09-21"]  # made-up d1 VWAP


def test_reconcile_scales_vwap_to_the_split_adjusted_basis_and_reports_the_split():
    # KTLEV: TradingView divides pre-bonus prices by 3.38164 (ex-date 3 Aug); İş Yatırım HG_* are as traded.
    factor = 1 / 3.3816425
    pre = [(date(2026, 7, 30), 156.9, 157.02, 2_585_613_442.0), (date(2026, 7, 31), 155.6, 155.01, 1_818_275_037.0)]
    post = [(date(2026, 8, 3), 41.42, 44.456, 3_308_107_296.0), (date(2026, 8, 4), 41.52, 39.904, 8_396_366_580.0)]
    isy = [_isy(d, c, vwap=v, turnover=t) for d, c, v, t in pre + post]
    stored = {d: _stored(d, round(c * factor, 7), volume=t / v / factor) for d, c, v, t in pre}
    stored.update({d: _stored(d, c, volume=t / v) for d, c, v, t in post})
    outcome = mw.reconcile_symbol("KTLEV", isy, stored, WED_1900)

    assert outcome.split_ratio == pytest.approx(factor, rel=1e-6)
    assert not outcome.close_mismatches and outcome.compared == 4  # a corporate action is not an error
    assert outcome.stale_basis is False
    enriched = {row["bar_date"]: row for row in outcome.enrich}
    assert enriched[date(2026, 7, 30)]["vwap"] == pytest.approx(157.02 * factor, abs=1e-4)
    assert enriched[date(2026, 7, 30)]["turnover"] == 2_585_613_442.0  # TL is basis-independent
    assert enriched[date(2026, 8, 3)]["vwap"] == 44.456
    assert not outcome.volume_mismatches


def test_reconcile_flags_a_stored_series_on_a_stale_basis():
    # The newest sessions must be as traded; a constant ratio there means the store missed a re-adjustment.
    days = [date(2026, 9, 21), date(2026, 9, 22), date(2026, 9, 23)]
    isy = [_isy(d, 100.0 + i) for i, d in enumerate(days)]
    stored = {d: _stored(d, (100.0 + i) * 2) for i, d in enumerate(days)}
    outcome = mw.reconcile_symbol("ABC", isy, stored, WED_1900)
    assert outcome.stale_basis is True and not outcome.close_mismatches


def test_reconcile_fills_missing_sessions_only_on_the_same_basis():
    d1, d2, d3 = date(2026, 9, 21), date(2026, 9, 22), date(2026, 9, 23)
    isy = [_isy(d1, 100.0), _isy(d2, 101.0, vwap=100.5, turnover=1e6), _isy(d3, 102.0)]
    stored = {d1: _stored(d1, 100.0)}
    outcome = mw.reconcile_symbol("ABC", isy, stored, WED_1900)

    assert [row["bar_date"] for row in outcome.fallback_rows] == [d2, d3]
    row = outcome.fallback_rows[0]
    assert (row["source"], row["open"], row["volume"], row["is_final"]) == ("isyatirim", None, None, True)
    # Before the close the running session is never filled from İş Yatırım.
    early = mw.reconcile_symbol("ABC", isy, stored, datetime(2026, 9, 23, 15, 0, tzinfo=ISTANBUL_TZ))
    assert [row["bar_date"] for row in early.fallback_rows] == [d2]
    # A session before a corporate action (other basis) is never filled with an as-traded close.
    split_stored = {d1: _stored(d1, 50.0), d3: _stored(d3, 102.0)}
    split = mw.reconcile_symbol("ABC", [_isy(d1, 100.0), _isy(d2, 101.0), _isy(d3, 102.0)], split_stored, WED_1900)
    assert split.fallback_rows == [] and split.split_ratio == pytest.approx(0.5)


def test_reconcile_reports_close_mismatches():
    d0, d1, d2, d3 = date(2026, 9, 18), date(2026, 9, 21), date(2026, 9, 22), date(2026, 9, 23)
    isy = [_isy(d0, 99.0), _isy(d1, 100.0), _isy(d2, 101.0), _isy(d3, 102.0)]
    stored = {d0: _stored(d0, 99.0), d1: _stored(d1, 100.0), d2: _stored(d2, 101.5), d3: _stored(d3, 102.0)}
    outcome = mw.reconcile_symbol("ABC", isy, stored, WED_1900)

    assert outcome.split_ratio is None and outcome.stale_basis is False
    assert [m["date"] for m in outcome.close_mismatches] == ["2026-09-22"]  # a lone session, not a basis change
    assert outcome.max_close_deviation == pytest.approx(0.5 / 101.0, rel=1e-6)
    assert all(row["bar_date"] != d2 for row in outcome.enrich)  # no enrichment from a disputed session
    checks = mw.reconcile_checks(outcome.compared, outcome.close_mismatches, outcome.max_close_deviation,
                                 0, [], {}, 10)
    assert checks[0].check_name == "market.close_tv_vs_isy" and checks[0].status == "warn"


# --- İş Yatırım parsing -----------------------------------------------------------------------

def test_isyatirim_history_row_uses_unadjusted_prices_and_keeps_the_adjusted_close():
    row = parse_history_row("BIMAS", {
        "HGDG_TARIH": "13-05-2026", "HGDG_KAPANIS": 401.9621, "HGDG_AOF": 399.0, "HG_KAPANIS": 813.0,
        "HG_AOF": 802.786, "HG_MIN": 790.0, "HG_MAX": 820.0, "HG_HACIM": 6272610373.0, "SERMAYE": 1.2e9,
        "PD": 9.756e11, "HAO_PD": None, "DOLAR_BAZLI_FIYAT": 16.7, "END_DEGER": 13000.0,
    })
    assert row.bar_date == date(2026, 5, 13) and row.close == 813.0 and row.close_adjusted == 401.9621
    assert row.lots == pytest.approx(6272610373.0 / 802.786)
    assert parse_history_row("BIMAS", {"HGDG_TARIH": "bad", "HG_KAPANIS": 1.0}) is None


def test_isyatirim_quote_units():
    quote = parse_quote("THYAO", {
        "updateDate": "2026-09-23T18:09:53.000+03", "bid": 298.5, "ask": 298.75, "low": 297.25, "high": 302.25,
        "last": 298.5, "dayClose": 298.0, "quantity": 34210549, "volume": 10261241351.0, "open": 298.75,
    })
    assert quote["volume"] == 34210549 and quote["turnover"] == 10261241351.0  # lots vs TL
    assert quote["prev_close"] == 298.0 and quote["change"] == 0.5
    assert quote["updated_at"] == "2026-09-23T18:09:53+03:00"


# --- daily quote cross-check ------------------------------------------------------------------

def test_quote_sample_rotates_over_the_core():
    targets = [_target(f"C{i:03d}") for i in range(100)] + [_target("U1", tier="universe")]
    monday = mw.pick_quote_sample(targets, date(2026, 9, 21))
    tuesday = mw.pick_quote_sample(targets, date(2026, 9, 22))
    assert len(monday) == 10 and not set(monday) & set(tuesday)
    assert "U1" not in monday + tuesday
    assert mw.pick_quote_sample([_target("U1", tier="universe")], date(2026, 9, 21)) == []


def test_quote_cross_check_compares_the_same_snapshot():
    row = {"close": 298.5, "open": 298.75, "high": 302.25, "low": 297.25, "volume": 34150549, "change_abs": 0.5,
           "close[1]": 298.0, "time": 1790143200, "update_time": 1790176194}
    isy = {"THYAO": {"last": 298.5, "open": 298.75, "high": 302.25, "low": 297.25, "prev_close": 298.0,
                     "volume": 34210549.0, "session_date": date(2026, 9, 23)}}
    check = mw.quote_cross_check({"THYAO": row}, isy)
    assert check.check_name == "market.quote_tv_vs_isy" and check.status == "pass"
    assert check.expected == 5.0 and check.actual == 5.0
    assert check.details_json["volume_differences"] == []  # 60 000 lots = 0.18 % < tolerance

    isy["THYAO"]["last"] = 299.5
    assert mw.quote_cross_check({"THYAO": row}, isy).status == "warn"
    stale = {"THYAO": {**isy["THYAO"], "session_date": date(2026, 9, 22)}}
    assert mw.quote_cross_check({"THYAO": row}, stale) is None  # different sessions are not compared


# --- loops ------------------------------------------------------------------------------------

async def test_quote_loop_runs_a_cycle_then_sleeps_until_stopped(monkeypatch):
    import asyncio

    stop = asyncio.Event()
    runs: list[datetime] = []
    sleeps: list[float] = []

    async def fake_run_quotes(symbols=None, *, now=None):
        runs.append(now)
        return {}

    async def fake_sleep(event, seconds):
        sleeps.append(seconds)
        event.set()

    tue_1455 = datetime(2026, 9, 22, 14, 55, tzinfo=ISTANBUL_TZ)
    monkeypatch.setattr(mw, "run_quotes", fake_run_quotes)
    monkeypatch.setattr(mw, "sleep_or_stop", fake_sleep)
    monkeypatch.setattr(mw.price, "now_istanbul", lambda: tue_1455)
    await mw._quotes_loop(stop)

    assert runs == [tue_1455]
    assert 0 < sleeps[0] <= mw.settings.market_quote_interval_seconds


async def test_market_loop_returns_when_stopped():
    import asyncio

    stop = asyncio.Event()
    stop.set()
    await asyncio.wait_for(mw.market_loop(stop), timeout=5)


async def test_scheduled_job_runs_only_when_due(monkeypatch):
    import asyncio

    stop = asyncio.Event()
    ran: list[str] = []

    async def last_success(job):
        return datetime(2026, 9, 23, 18, 41, tzinfo=ISTANBUL_TZ)

    async def fake_sleep(event, seconds):
        event.set()

    async def fake_daily(symbols):
        ran.append("daily")
        return {}

    monkeypatch.setattr(mw, "_last_success", last_success)
    monkeypatch.setattr(mw, "sleep_or_stop", fake_sleep)
    monkeypatch.setitem(mw._RUNNERS, mw.JOB_BARS_DAILY, fake_daily)
    monkeypatch.setattr(mw.price, "now_istanbul", lambda: WED_1900)
    await mw._scheduled_loop(stop, mw.JOB_BARS_DAILY, "18:40", "18:40")
    assert ran == []  # already done after today's 18:40

    stop.clear()
    monkeypatch.setattr(mw.price, "now_istanbul", lambda: datetime(2026, 9, 24, 18, 45, tzinfo=ISTANBUL_TZ))
    await mw._scheduled_loop(stop, mw.JOB_BARS_DAILY, "18:40", "18:40")
    assert ran == ["daily"]


# --- official lots / TL turnover (İş Yatırım OneEndeks) ---------------------------------------

def _official(symbol, lots, turnover, *, session=TODAY, traded=True):
    return parse_quote(symbol, {
        "updateDate": f"{session.isoformat()}T18:09:56.000+03", "last": 2.26, "dayClose": 2.29,
        "high": 2.3 if traded else 0, "low": 2.24 if traded else 0, "quantity": lots if traded else 0,
        "volume": turnover if traded else 0, "capital": 52_501_931_146.27, "equity": 192_675_743_000,
    })


def _final_row(symbol, volume, *, day=TODAY, final=True):
    return {"symbol": symbol, "bar_date": day, "close": 2.26, "volume": volume, "is_final": final,
            "source": "tradingview"}


def test_official_lots_and_turnover_replace_tradingview_on_final_bars_of_the_same_session():
    rows = [_final_row("SASA", 2_453_505_160.0), _final_row("BIMAS", 6_580_903.0),
            _final_row("KONTR", 1_000.0, final=False), _final_row("EKGYO", 132_769_300.0)]
    official = {
        "SASA": _official("SASA", 2_473_505_158, 5_665_266_988.47),
        "BIMAS": _official("BIMAS", 6_580_903, 2_854_686_306.5),
        "KONTR": _official("KONTR", 2_000, 50_000.0),  # running bar: untouched
        "EKGYO": _official("EKGYO", 0, 0, traded=False),  # overnight reset: no session figures
    }
    differences = mw.apply_official_volumes(rows, official)

    assert [d["symbol"] for d in differences] == ["SASA"]
    assert rows[0]["volume"] == 2_473_505_158 and rows[0]["turnover"] == 5_665_266_988.47
    assert rows[1]["volume"] == 6_580_903 and rows[1]["turnover"] == 2_854_686_306.5
    assert rows[2]["volume"] == 1_000.0 and "turnover" not in rows[2]
    assert rows[3]["volume"] == 132_769_300.0 and "turnover" not in rows[3]
    other_day = [_final_row("SASA", 2_453_505_160.0, day=date(2026, 9, 22))]
    assert mw.apply_official_volumes(other_day, official) == [] and other_day[0]["volume"] == 2_453_505_160.0


def test_oneendeks_overnight_reset_carries_no_session():
    reset = _official("BIMAS", 0, 0, traded=False)
    assert reset["session_date"] is None and reset["volume"] is None and reset["turnover"] is None
    assert reset["capital"] == 52_501_931_146.27  # capital/equity stay usable between sessions


def test_reconcile_retries_official_lots_only_where_the_stored_count_is_short():
    sasa = _isy(TODAY, 2.26, vwap=2.29, turnover=5_665_266_988.0)  # implies 2,473,915,715 lots
    stored = {TODAY: _stored(TODAY, 2.26, volume=2_453_505_160.0)}
    candidate = mw.official_volume_candidate("SASA", [sasa], stored, WED_1900)
    assert candidate == {"symbol": "SASA", "bar_date": TODAY, "stored": 2_453_505_160.0, "implied": 2_473_915_715}

    bimas = _isy(TODAY, 433.75, vwap=433.783, turnover=2_854_686_307.0)  # 6,580,908.7 implied vs 6,580,903
    assert mw.official_volume_candidate("BIMAS", [bimas], {TODAY: _stored(TODAY, 433.75, volume=6_580_903.0)},
                                        WED_1900) is None
    split = {TODAY: _stored(TODAY, 1.13, volume=2_453_505_160.0)}  # another price basis
    assert mw.official_volume_candidate("SASA", [sasa], split, WED_1900) is None
    early = datetime(2026, 9, 23, 17, 0, tzinfo=ISTANBUL_TZ)  # the session is not final yet
    assert mw.official_volume_candidate("SASA", [sasa], stored, early) is None


# --- accuracy checks (market.pb_field / market.shares_vs_paid_in / market.volume_vs_oneendeks) ---

BIMAS_TV = {"close": 433.75, "change_abs": 3.5, "volume": 6580903, "Value.Traded": 2854466676.25,
            "market_cap_basic": 510181857605, "total_shares_outstanding": 1185780000,
            "price_book_fq": 2.5543749125108186, "price_book_ratio": 3.106159175279112, "time": 1790143200}
BIMAS_OFFICIAL = parse_quote("BIMAS", {
    "updateDate": "2026-09-23T18:09:54.000+03", "last": 433.75, "dayClose": 430.25, "high": 437.5, "low": 429.75,
    "quantity": 6580903, "volume": 2854686306.5, "capital": 1_200_000_000, "equity": 201_353_398_000,
})
BIMAS_CARD = {"market_cap": 520_500_000_000, "pb_ratio": 2.6}


def _inputs(served, *, official=BIMAS_OFFICIAL, bar=None):
    return mw.AccuracyInputs(symbol="BIMAS", served=served, tradingview=BIMAS_TV, official=official,
                             card=BIMAS_CARD, stored_capital=1.2e9, stored_bar=bar)


def test_accuracy_checks_fail_the_audited_values_and_pass_the_fixed_ones():
    legacy = {"last_price": 433.75, "pb_ratio": 3.11, "shares": 1_209_761_766.0, "market_cap": 524_734_166_002.5,
              "volume": 6580903.0, "amount": 2854466676.25}
    fixed = {**legacy, "pb_ratio": 2.59, "pb_source": "isyatirim_equity", "shares": 1_200_000_000.0,
             "market_cap": 520_500_000_000.0, "amount": 2854686306.5, "volume_source": "isyatirim"}

    pb_old, pb_new = mw.pb_field_check(_inputs(legacy)), mw.pb_field_check(_inputs(fixed))
    assert (pb_old.status, pb_new.status) == ("fail", "pass") and pb_new.expected == 2.59
    assert pb_new.details_json["tradingview_price_book_fq"] == 2.5544
    assert pb_new.details_json["legacy_tradingview_price_book_ratio"] == pytest.approx(3.106159)

    shares_old, shares_new = mw.shares_vs_paid_in_check(_inputs(legacy)), mw.shares_vs_paid_in_check(_inputs(fixed))
    assert (shares_old.status, shares_new.status) == ("fail", "pass")
    assert shares_new.details_json["expected_market_cap"] == 520_500_000_000.0
    assert shares_new.details_json["legacy_shares"] == 1_209_761_766.0  # the old algorithm, for the record

    final_bar = SimpleNamespace(bar_date=TODAY, volume=6580903.0, turnover=2854686307.0, is_final=True)
    volume_new = mw.volume_vs_oneendeks_check(_inputs(fixed, bar=final_bar), now=WED_1900)
    assert volume_new.status == "pass" and volume_new.expected == 6580903
    short = {**fixed, "volume": 6_500_000.0}
    assert mw.volume_vs_oneendeks_check(_inputs(short, bar=final_bar), now=WED_1900).status == "fail"
    tv_amount = mw.volume_vs_oneendeks_check(_inputs(legacy, bar=final_bar), now=WED_1900)
    assert tv_amount.status == "warn"  # lots equal, TL turnover = close × lots (219,630 TL short)
    reset = parse_quote("BIMAS", {"updateDate": "2026-09-23T18:09:54.000+03", "last": 433.75, "dayClose": 433.75,
                                  "high": 0, "low": 0, "quantity": 0, "volume": 0})
    assert mw.volume_vs_oneendeks_check(_inputs(fixed, official=reset), now=WED_1900) is None


# --- historical turnover/VWAP backfill (market.bars.reconcile.backfill) -------------------------

def test_turnover_backfill_walks_back_newest_window_first_and_resumes_from_the_marker():
    targets = [_target("THYAO"), _target("KONTR", tier="universe"), _target("XU100", tier="index")]
    coverage = {
        "THYAO": Coverage("THYAO", date(2021, 9, 1), TODAY, 1260, TODAY),
        "KONTR": Coverage("KONTR", date(2024, 9, 2), TODAY, 510, TODAY),
        "XU100": Coverage("XU100", date(2021, 9, 1), TODAY, 1260, TODAY),
    }
    plan = mw.plan_turnover_backfill(targets, coverage, {}, TODAY)
    assert [(i.target.symbol, i.start, i.end) for i in plan] == [
        ("THYAO", TODAY - timedelta(days=mw.TURNOVER_CHUNK_DAYS), TODAY),  # core first, newest window first
        ("KONTR", date(2024, 9, 2), TODAY),  # a 2-year history fits in one window
    ]
    assert plan[1].completes and not plan[0].completes

    markers = {
        "THYAO": HistoryMarker("THYAO", extra={"turnover_from": plan[0].start.isoformat()}),
        "KONTR": HistoryMarker("KONTR", extra={"turnover_from": "2024-09-02", "turnover_done": True}),
    }
    resumed = mw.plan_turnover_backfill(targets, coverage, markers, TODAY)
    assert [(i.target.symbol, i.start, i.end) for i in resumed] == [
        ("THYAO", date(2021, 9, 1), plan[0].start - timedelta(days=1))]
    assert resumed[0].completes
    markers["THYAO"].extra["turnover_from"] = "2021-09-03"  # İş Yatırım starts two sessions later: done
    assert mw.plan_turnover_backfill(targets, coverage, markers, TODAY) == []
    failed = {"THYAO": HistoryMarker("THYAO", extra={"turnover_failed_on": TODAY.isoformat()})}
    assert [i.target.symbol for i in mw.plan_turnover_backfill(targets, coverage, failed, TODAY)] == ["KONTR"]
