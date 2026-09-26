"""Macro store tests: repository upserts (PostgreSQL), store-first service logic
(store hit / live miss + write-through / stale fallback), ingestion mapping rules,
and macro_worker's pure schedule helpers.

No network: ``src.adapters.macro`` (the live adapter) and ``src.adapters.tcmb_adapter``
(the full-history scraper) are monkeypatched wherever the service/ingestion layer
calls them.
"""

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select

from src.adapters import tcmb_adapter
from src.db.models import FxBulletin, MacroObservation
from src.db.repositories.macro import FxBulletinRow, MacroRepository, ObservationRow
from src.services import macro_service
from src.workers import macro_worker

D1, D2, D3 = date(2026, 9, 1), date(2026, 9, 2), date(2026, 9, 3)


# ---------------------------------------------------------------------------
# MacroRepository — macro_series
# ---------------------------------------------------------------------------

async def test_upsert_observations_inserts_then_updates_on_conflict(pg_session):
    repo = MacroRepository(pg_session)
    written = await repo.upsert_observations(
        [ObservationRow("tcmb.policy_rate", D1, Decimal("45.00"), "tcmb")]
    )
    assert written == 1
    await pg_session.commit()

    await repo.upsert_observations([ObservationRow("tcmb.policy_rate", D1, Decimal("46.00"), "tcmb")])
    await pg_session.commit()

    row = (
        await pg_session.execute(
            select(MacroObservation).where(
                MacroObservation.series_code == "tcmb.policy_rate", MacroObservation.observation_date == D1
            )
        )
    ).scalar_one()
    assert row.value == Decimal("46.000000")
    assert row.source == "tcmb"


async def test_upsert_observations_dedupes_within_one_batch_last_wins(pg_session):
    repo = MacroRepository(pg_session)
    await repo.upsert_observations(
        [
            ObservationRow("tcmb.policy_rate", D1, Decimal("45.00"), "tcmb"),
            ObservationRow("tcmb.policy_rate", D1, Decimal("46.00"), "tcmb"),  # same key — must not hit
            # Postgres's "ON CONFLICT ... affects row a second time" error.
        ]
    )
    await pg_session.commit()
    row = await repo.at("tcmb.policy_rate", D1)
    assert row is not None
    assert row.value == Decimal("46.000000")


async def test_latest_and_at(pg_session):
    repo = MacroRepository(pg_session)
    await repo.upsert_observations(
        [
            ObservationRow("tcmb.overnight.borrowing", D1, Decimal("35.00"), "tcmb"),
            ObservationRow("tcmb.overnight.borrowing", D3, Decimal("36.00"), "tcmb"),
        ]
    )
    await pg_session.commit()

    latest = await repo.latest("tcmb.overnight.borrowing")
    assert latest is not None and latest.observation_date == D3 and latest.value == Decimal("36.000000")

    assert await repo.at("tcmb.overnight.borrowing", D1) is not None
    assert await repo.at("tcmb.overnight.borrowing", D2) is None  # absent date, not zero
    assert await repo.latest("no.such.series") is None


async def test_history_limit_keeps_the_most_recent_rows_in_requested_order(pg_session):
    repo = MacroRepository(pg_session)
    rows = [ObservationRow("tuik.cpi.yoy", date(2026, m, 1), Decimal(f"{m}.0"), "tuik") for m in range(1, 9)]
    await repo.upsert_observations(rows)
    await pg_session.commit()

    ascending = await repo.history("tuik.cpi.yoy", limit=3, ascending=True)
    assert [r.observation_date.month for r in ascending] == [6, 7, 8]

    descending = await repo.history("tuik.cpi.yoy", limit=3, ascending=False)
    assert [r.observation_date.month for r in descending] == [8, 7, 6]

    full_ascending = await repo.history("tuik.cpi.yoy")
    assert [r.observation_date.month for r in full_ascending] == list(range(1, 9))


# ---------------------------------------------------------------------------
# MacroRepository — fx_bulletins
# ---------------------------------------------------------------------------

def _fx_row(day, currency="USD", selling="48.50", source="tcmb"):
    return FxBulletinRow(
        bulletin_date=day,
        currency=currency,
        quoted_unit=1,
        forex_buying=Decimal(selling) - Decimal("0.01"),
        forex_selling=Decimal(selling),
        banknote_buying=None,
        banknote_selling=None,
        source=source,
    )


async def test_upsert_fx_bulletins_and_latest_fx(pg_session):
    repo = MacroRepository(pg_session)
    await repo.upsert_fx_bulletins([_fx_row(D1, selling="48.00"), _fx_row(D2, selling="48.50")])
    await pg_session.commit()

    latest = await repo.latest_fx("USD")
    assert latest is not None
    assert latest.bulletin_date == D2
    assert latest.forex_selling == Decimal("48.500000")

    # re-upsert the same date updates in place rather than duplicating.
    await repo.upsert_fx_bulletins([_fx_row(D2, selling="48.60")])
    await pg_session.commit()
    pg_session.expire_all()  # the session (expire_on_commit=False) would otherwise return the cached object
    row = (await pg_session.execute(select(FxBulletin).where(FxBulletin.bulletin_date == D2))).scalar_one()
    assert row.forex_selling == Decimal("48.600000")


async def test_fx_history_ascending_and_since_filter(pg_session):
    repo = MacroRepository(pg_session)
    await repo.upsert_fx_bulletins([_fx_row(D1, selling="1"), _fx_row(D2, selling="2"), _fx_row(D3, selling="3")])
    await pg_session.commit()

    history = await repo.fx_history("USD", since=D2, ascending=True)
    assert [r.bulletin_date for r in history] == [D2, D3]


async def test_has_fx_bulletin(pg_session):
    repo = MacroRepository(pg_session)
    await repo.upsert_fx_bulletins([_fx_row(D1)])
    await pg_session.commit()
    assert await repo.has_fx_bulletin(D1) is True
    assert await repo.has_fx_bulletin(D2) is False


# ---------------------------------------------------------------------------
# Ingestion mapping rules (tcmb_adapter monkeypatched — pure mapping logic)
# ---------------------------------------------------------------------------

async def test_ingest_rates_drops_non_positive_legs_and_maps_series_codes(pg_session, monkeypatch):
    async def fake_history(rate_type):
        if rate_type == "policy":
            return [tcmb_adapter.RateObservation(D1, None, Decimal("45.00"))]
        if rate_type == "overnight":
            return [tcmb_adapter.RateObservation(D1, Decimal("43.00"), Decimal("46.00"))]
        return [tcmb_adapter.RateObservation(D1, Decimal("0.00"), Decimal("48.00"))]  # late_liquidity: borrowing N/A

    monkeypatch.setattr(tcmb_adapter, "fetch_rate_history", fake_history)

    result = await macro_service.ingest_rates(pg_session)

    assert result["errors"] == {}
    assert result["series"]["tcmb.policy_rate"] == 1
    assert result["series"]["tcmb.late_liquidity.borrowing"] == 0  # dropped: 0.00 is "not applicable"
    assert result["series"]["tcmb.late_liquidity.lending"] == 1

    repo = MacroRepository(pg_session)
    assert await repo.at("tcmb.late_liquidity.borrowing", D1) is None
    lending = await repo.at("tcmb.late_liquidity.lending", D1)
    assert lending is not None and lending.value == Decimal("48.000000")


async def test_ingest_rates_records_per_rate_type_errors_without_failing_the_others(pg_session, monkeypatch):
    async def fake_history(rate_type):
        if rate_type == "policy":
            raise RuntimeError("tcmb.gov.tr 503")
        return [tcmb_adapter.RateObservation(D1, Decimal("1.0"), Decimal("2.0"))]

    monkeypatch.setattr(tcmb_adapter, "fetch_rate_history", fake_history)

    result = await macro_service.ingest_rates(pg_session)

    assert "policy" in result["errors"]
    assert result["series"]["tcmb.overnight.borrowing"] == 1  # the other rate types still ingested


async def test_ingest_inflation_populates_cpi_and_ppi_independently(pg_session, monkeypatch):
    monkeypatch.setattr(
        tcmb_adapter, "fetch_cpi_history", lambda: _fut([tcmb_adapter.InflationObservation(D1, "09-2026", Decimal("31.5"), Decimal("1.8"))])
    )
    monkeypatch.setattr(
        tcmb_adapter, "fetch_ppi_history", lambda: _fut([tcmb_adapter.InflationObservation(D1, "09-2026", Decimal("27.9"), Decimal("2.5"))])
    )

    result = await macro_service.ingest_inflation(pg_session)

    assert result["series"] == {"tuik.cpi.yoy": 1, "tuik.cpi.mom": 1, "tuik.ppi.yoy": 1, "tuik.ppi.mom": 1}
    repo = MacroRepository(pg_session)
    assert (await repo.at("tuik.cpi.yoy", D1)).value == Decimal("31.500000")
    assert (await repo.at("tuik.ppi.mom", D1)).value == Decimal("2.500000")


async def test_ingest_fx_skips_currencies_with_no_rate_at_all(pg_session, monkeypatch):
    bulletin = tcmb_adapter.FxBulletinData(
        bulletin_date=D1,
        rates={
            "USD": {"quoted_unit": 1, "forex_buying": Decimal("48"), "forex_selling": Decimal("48.1"), "banknote_buying": None, "banknote_selling": None},
            "XXX": {"quoted_unit": 1, "forex_buying": None, "forex_selling": None, "banknote_buying": None, "banknote_selling": None},
        },
    )
    monkeypatch.setattr(tcmb_adapter, "fetch_fx_backfill", lambda days, concurrency=6: _fut([bulletin]))

    result = await macro_service.ingest_fx(pg_session)

    assert result["currencies"] == {"USD": 1}  # XXX has neither buying nor selling -> not stored
    assert result["bulletin_days"] == 1


def _fut(value):
    async def _coro(*_args, **_kwargs):
        return value

    return _coro()


# ---------------------------------------------------------------------------
# Store-first service — store hit / live miss + write-through / stale fallback
# ---------------------------------------------------------------------------

def _live_tcmb_rates_payload():
    return {
        "source": "TCMB",
        "source_url": tcmb_adapter.RATE_PAGE_URLS["policy"],
        "as_of": "2026-09-10",
        "data": [
            {"type": "policy", "date": "2026-09-10", "borrowing": None, "lending": 40.0},
            {"type": "overnight", "date": "2026-09-10", "borrowing": 38.0, "lending": 43.0},
            {"type": "late_liquidity", "date": "2026-09-10", "borrowing": None, "lending": 45.0},
        ],
    }


async def test_get_tcmb_store_first_serves_from_store_when_fresh(pg_session, monkeypatch):
    async def must_not_be_called():  # pragma: no cover — fails the test if reached
        raise AssertionError("should not call the live adapter when the store is fresh")

    monkeypatch.setattr(macro_service.macro_adapter, "get_tcmb_rates", must_not_be_called)
    repo = MacroRepository(pg_session)
    await repo.upsert_observations(
        [
            ObservationRow("tcmb.policy_rate", D1, Decimal("40.00"), "tcmb"),
            ObservationRow("tcmb.overnight.borrowing", D1, Decimal("38.00"), "tcmb"),
            ObservationRow("tcmb.overnight.lending", D1, Decimal("43.00"), "tcmb"),
            ObservationRow("tcmb.late_liquidity.lending", D1, Decimal("45.00"), "tcmb"),
        ]
    )
    await pg_session.commit()

    result = await macro_service.get_tcmb_store_first(pg_session)

    assert result["meta"]["served_from"] == "store"
    assert result["meta"]["stale"] is False
    assert result["data"][0] == {"type": "policy", "date": D1.isoformat(), "borrowing": None, "lending": 40.0}
    # late_liquidity.borrowing has no row at D1 -> reported as None, not fabricated.
    late = next(d for d in result["data"] if d["type"] == "late_liquidity")
    assert late["borrowing"] is None and late["lending"] == 45.0


async def test_get_tcmb_store_first_goes_live_when_store_empty_and_writes_through(pg_session, monkeypatch):
    async def fake_live():
        return _live_tcmb_rates_payload()

    monkeypatch.setattr(macro_service.macro_adapter, "get_tcmb_rates", fake_live)

    result = await macro_service.get_tcmb_store_first(pg_session)

    assert result["meta"]["served_from"] == "live"
    assert result["data"] == _live_tcmb_rates_payload()["data"]
    # write-through populated the store from the live payload.
    repo = MacroRepository(pg_session)
    written = await repo.at("tcmb.policy_rate", date(2026, 9, 10))
    assert written is not None and written.value == Decimal("40.000000")


async def test_get_tcmb_store_first_stale_fallback_on_provider_failure(pg_session, monkeypatch):
    async def failing_live():
        return {"source": "TCMB", "data": [], "error": "saglayiciya ulasilamadi", "error_status": 503}

    monkeypatch.setattr(macro_service.macro_adapter, "get_tcmb_rates", failing_live)
    monkeypatch.setattr(macro_service.settings, "macro_max_age_rates_hours", 0.0)  # force "not fresh"

    repo = MacroRepository(pg_session)
    await repo.upsert_observations(
        [
            ObservationRow("tcmb.policy_rate", D1, Decimal("40.00"), "tcmb"),
            ObservationRow("tcmb.overnight.borrowing", D1, Decimal("38.00"), "tcmb"),
            ObservationRow("tcmb.overnight.lending", D1, Decimal("43.00"), "tcmb"),
            ObservationRow("tcmb.late_liquidity.lending", D1, Decimal("45.00"), "tcmb"),
        ]
    )
    await pg_session.commit()

    result = await macro_service.get_tcmb_store_first(pg_session)

    assert result["meta"]["served_from"] == "stale"
    assert result["meta"]["stale"] is True
    assert result["meta"]["notes"] == [macro_service._STALE_NOTE]
    assert result["data"]  # the last stored copy, not empty


async def test_get_tcmb_store_first_propagates_existing_error_contract_when_store_empty(pg_session, monkeypatch):
    async def failing_live():
        return {"source": "TCMB", "data": [], "error": "saglayiciya ulasilamadi", "error_status": 503}

    monkeypatch.setattr(macro_service.macro_adapter, "get_tcmb_rates", failing_live)

    result = await macro_service.get_tcmb_store_first(pg_session)

    assert result == {"source": "TCMB", "data": [], "error": "saglayiciya ulasilamadi", "error_status": 503}
    assert "meta" not in result


async def test_get_tcmb_store_first_survives_live_adapter_raising(pg_session, monkeypatch):
    async def raises():
        raise RuntimeError("unexpected")

    monkeypatch.setattr(macro_service.macro_adapter, "get_tcmb_rates", raises)

    result = await macro_service.get_tcmb_store_first(pg_session)

    assert result["error_status"] == 502
    assert "RuntimeError" not in result["error"]  # raw exception text never leaks


async def test_get_policy_rate_store_first_history_dates_carry_midnight_time(pg_session, monkeypatch):
    async def must_not_be_called():  # pragma: no cover
        raise AssertionError

    monkeypatch.setattr(macro_service.macro_adapter, "get_policy_rate", must_not_be_called)
    repo = MacroRepository(pg_session)
    await repo.upsert_observations([ObservationRow("tcmb.policy_rate", D1, Decimal("40.00"), "tcmb")])
    await pg_session.commit()

    result = await macro_service.get_policy_rate_store_first(pg_session)

    assert result["policy_rate"] == {"value": 40.0, "date": D1.isoformat()}
    assert result["history"] == [{"date": f"{D1.isoformat()}T00:00:00", "borrowing": None, "lending": 40.0}]
    assert result["meta"]["served_from"] == "store"


async def test_get_inflation_store_first_combines_yoy_and_mom_from_separate_series(pg_session, monkeypatch):
    async def must_not_be_called():  # pragma: no cover
        raise AssertionError

    monkeypatch.setattr(macro_service.macro_adapter, "get_inflation", must_not_be_called)
    repo = MacroRepository(pg_session)
    await repo.upsert_observations(
        [
            ObservationRow("tuik.cpi.yoy", D1, Decimal("31.5"), "tuik"),
            ObservationRow("tuik.cpi.mom", D1, Decimal("1.8"), "tuik"),
        ]
    )
    await pg_session.commit()

    result = await macro_service.get_inflation_store_first(pg_session)

    assert result["latest"] == {
        "date": D1.isoformat(),
        "year_month": f"{D1.month:02d}-{D1.year}",
        "yearly_inflation": 31.5,
        "monthly_inflation": 1.8,
        "type": "TUFE",
    }
    assert result["meta"]["source"] == "tuik"


async def test_get_policy_rate_store_first_carries_every_change_like_the_live_payload(pg_session, monkeypatch):
    async def must_not_be_called():  # pragma: no cover
        raise AssertionError

    monkeypatch.setattr(macro_service.macro_adapter, "get_policy_rate", must_not_be_called)
    days = [date(2024, m, 1) for m in range(1, 13)] + [date(2025, m, 1) for m in range(1, 13)] + [D1]
    rates = [50.0 - 0.5 * i for i in range(len(days))]
    repo = MacroRepository(pg_session)
    await repo.upsert_observations(
        [ObservationRow("tcmb.policy_rate", d, Decimal(str(r)), "tcmb") for d, r in zip(days, rates)]
    )
    await pg_session.commit()

    result = await macro_service.get_policy_rate_store_first(pg_session)

    assert len(result["history"]) == 24  # the live payload's last 24 decisions
    assert len(result["changes"]) == len(days) == 25  # but every change, like the live payload
    assert result["changes"][0] == {"date": "2024-01-01", "rate": 50.0, "previous": None, "change_bp": None}
    assert result["last_change"] == {"date": D1.isoformat(), "rate": 38.0, "previous": 38.5, "change_bp": -50}


async def test_get_inflation_store_first_serves_ufe_in_the_live_shape(pg_session, monkeypatch):
    async def must_not_be_called():  # pragma: no cover
        raise AssertionError

    monkeypatch.setattr(macro_service.macro_adapter, "get_inflation", must_not_be_called)
    repo = MacroRepository(pg_session)
    await repo.upsert_observations(
        [
            ObservationRow("tuik.cpi.yoy", D1, Decimal("31.5"), "tuik"),
            ObservationRow("tuik.cpi.mom", D1, Decimal("1.8"), "tuik"),
            ObservationRow("tuik.ppi.yoy", D1, Decimal("27.9"), "tuik"),
            ObservationRow("tuik.ppi.mom", D1, Decimal("2.5"), "tuik"),
        ]
    )
    await pg_session.commit()

    result = await macro_service.get_inflation_store_first(pg_session)

    assert result["ufe_latest"] == {
        "date": D1.isoformat(),
        "year_month": f"{D1.month:02d}-{D1.year}",
        "yearly_inflation": 27.9,
        "monthly_inflation": 2.5,
        "type": "UFE",
    }
    assert result["ufe_history"] == [
        {"Date": f"{D1.isoformat()}T00:00:00", "YearMonth": f"{D1.month:02d}-{D1.year}", "YearlyInflation": 27.9, "MonthlyInflation": 2.5}
    ]


async def test_get_inflation_store_first_without_stored_ufe_still_serves_tufe(pg_session, monkeypatch):
    async def must_not_be_called():  # pragma: no cover
        raise AssertionError

    monkeypatch.setattr(macro_service.macro_adapter, "get_inflation", must_not_be_called)
    await MacroRepository(pg_session).upsert_observations([ObservationRow("tuik.cpi.yoy", D1, Decimal("31.5"), "tuik")])
    await pg_session.commit()

    result = await macro_service.get_inflation_store_first(pg_session)

    assert result["latest"]["yearly_inflation"] == 31.5
    assert result["ufe_latest"] is None and result["ufe_history"] == []


async def test_policy_rate_write_through_stores_every_change_not_only_the_last_24(pg_session, monkeypatch):
    changes = [{"date": f"20{10 + i // 12:02d}-{i % 12 + 1:02d}-01", "rate": 10.0 + i, "previous": None, "change_bp": None} for i in range(30)]
    live = {
        "source": "TCMB",
        "source_url": "https://www.tcmb.gov.tr",
        "as_of": changes[-1]["date"],
        "policy_rate": {"value": 39.0, "date": changes[-1]["date"]},
        "history": [{"date": f"{c['date']}T00:00:00", "borrowing": None, "lending": c["rate"]} for c in changes[-24:]],
        "changes": changes,
        "last_change": changes[-1],
    }

    async def live_policy_rate():
        return live

    monkeypatch.setattr(macro_service.macro_adapter, "get_policy_rate", live_policy_rate)

    first = await macro_service.get_policy_rate_store_first(pg_session)  # store empty → live + write-through
    second = await macro_service.get_policy_rate_store_first(pg_session)  # now from the store

    assert first["meta"]["served_from"] == "live"
    assert second["meta"]["served_from"] == "store"
    assert [c["date"] for c in second["changes"]] == [c["date"] for c in changes]


async def test_get_fx_store_first_rejects_invalid_currency_without_querying_store(pg_session):
    result = await macro_service.get_fx_store_first(pg_session, "US1")
    assert result["error_status"] == 400
    assert result["history"] == []


async def test_get_fx_store_first_rejects_try(pg_session):
    result = await macro_service.get_fx_store_first(pg_session, "TRY")
    assert result["error_status"] == 400


async def test_get_fx_store_first_serves_from_store_when_fresh(pg_session, monkeypatch):
    async def must_not_be_called(_currency):  # pragma: no cover
        raise AssertionError

    monkeypatch.setattr(macro_service.macro_adapter, "get_fx_rates", must_not_be_called)
    repo = MacroRepository(pg_session)
    await repo.upsert_fx_bulletins([_fx_row(D1, selling="48.00"), _fx_row(D2, selling="48.50")])
    await pg_session.commit()

    result = await macro_service.get_fx_store_first(pg_session, "usd")  # lower-case input is normalised

    assert result["currency"] == "USD"
    assert result["info"]["last"] == 48.50
    assert result["info"]["previous_close"] == 48.00
    assert result["meta"]["served_from"] == "store"


async def test_get_fx_store_first_does_not_write_through_a_tradingview_fallback(pg_session, monkeypatch):
    async def fallback_payload(_currency):
        return {
            "currency": "USD",
            "source": "TradingView (borsapy yedek)",
            "warning": "TCMB günlük kur bülteni alınamadı; piyasa kuru gösteriliyor.",
            "info": {"last": 49.0},
            "history": [],
        }

    monkeypatch.setattr(macro_service.macro_adapter, "get_fx_rates", fallback_payload)

    result = await macro_service.get_fx_store_first(pg_session, "USD")

    assert result["meta"]["served_from"] == "live"
    assert result["meta"]["source"] == "TradingView (borsapy yedek)"
    repo = MacroRepository(pg_session)
    assert await repo.latest_fx("USD") is None  # not written into fx_bulletins — not an official fixing


# ---------------------------------------------------------------------------
# macro_worker — pure schedule helpers (no network, no sleeping)
# ---------------------------------------------------------------------------

ISTANBUL = macro_worker.ISTANBUL_TZ


def test_next_run_time_picks_the_soonest_later_time_today():
    now = datetime(2026, 9, 23, 9, 0, tzinfo=ISTANBUL)
    target = macro_worker.next_run_time(now, (macro_worker._RATES_TIMES))
    assert target == datetime(2026, 9, 23, 10, 0, tzinfo=ISTANBUL)

    now = datetime(2026, 9, 23, 11, 0, tzinfo=ISTANBUL)
    target = macro_worker.next_run_time(now, macro_worker._RATES_TIMES)
    assert target == datetime(2026, 9, 23, 14, 30, tzinfo=ISTANBUL)


def test_next_run_time_wraps_to_tomorrow_once_all_times_have_passed():
    now = datetime(2026, 9, 23, 23, 0, tzinfo=ISTANBUL)
    target = macro_worker.next_run_time(now, macro_worker._RATES_TIMES)
    assert target == datetime(2026, 9, 24, 10, 0, tzinfo=ISTANBUL)


def test_next_run_time_accepts_naive_datetime_as_istanbul_local():
    now = datetime(2026, 9, 23, 9, 0)  # naive
    target = macro_worker.next_run_time(now, (macro_worker._FX_TIME,))
    assert target == datetime(2026, 9, 23, 15, 35, tzinfo=ISTANBUL)


def test_next_run_time_converts_other_timezones_to_istanbul():
    utc_now = datetime(2026, 9, 23, 6, 0, tzinfo=timezone.utc)  # 09:00 Istanbul
    target = macro_worker.next_run_time(utc_now, macro_worker._RATES_TIMES)
    assert target == datetime(2026, 9, 23, 10, 0, tzinfo=ISTANBUL)


@pytest.mark.parametrize(
    ("day", "expected"),
    [(date(2026, 9, 2), False), (date(2026, 9, 3), True), (date(2026, 9, 4), True), (date(2026, 9, 5), True), (date(2026, 9, 6), False)],
)
def test_is_inflation_release_window(day, expected):
    assert macro_worker.is_inflation_release_window(day) is expected


def test_job_counts_from_ingest_result_shape():
    result = {"series": {"a": 3, "b": 0}, "rows_upserted": 3, "errors": {"c": "boom"}}
    assert macro_worker._job_counts(result) == (3, 2, 1)

    result_fx = {"currencies": {"USD": 5}, "rows_upserted": 5, "errors": {}}
    assert macro_worker._job_counts(result_fx) == (1, 1, 0)


async def test_execute_job_skips_when_lock_held(monkeypatch):
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def locked(_name):
        yield False  # advisory lock already held elsewhere

    monkeypatch.setattr(macro_worker, "source_lock", locked)

    async def must_not_run(_session):  # pragma: no cover
        raise AssertionError("must not ingest while the lock is held")

    monkeypatch.setattr(macro_worker, "_INGEST_FUNCS", {"macro.rates": must_not_run})

    result = await macro_worker._execute_job("macro.rates")

    assert result == {"skipped": "locked"}


async def test_execute_job_reports_unknown_job():
    result = await macro_worker._execute_job("macro.nonsense")
    assert result == {"skipped": "unknown_job"}
