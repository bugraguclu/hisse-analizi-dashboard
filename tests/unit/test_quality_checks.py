"""Unit tests for ``src.services.quality_service``.

Evaluators (``_*_status``) are pure functions tested with synthetic inputs — no DB, no
network. A handful of ``pg_session`` tests exercise the async wrappers end to end
(minus the two network cross-source checks, which get their own monkeypatched tests).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from src.core.config import settings
from src.db.models import Company, PriceBar
from src.services import quality_service as qs

IST = ZoneInfo("Europe/Istanbul")


def _ist(y, m, d, hh=12, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=IST)


# ---------------------------------------------------------------------------
# Calendar helpers
# ---------------------------------------------------------------------------


def test_expected_trading_day_before_session_final_uses_previous_weekday():
    # Wednesday 2026-09-23, 12:00 — before the 18:30 close, so the freshest FINAL
    # session is still Tuesday's.
    assert qs._expected_trading_day(_ist(2026, 9, 23, 12, 0)) == date(2026, 9, 22)


def test_expected_trading_day_after_session_final_is_today():
    assert qs._expected_trading_day(_ist(2026, 9, 23, 19, 0)) == date(2026, 9, 23)


def test_expected_trading_day_on_weekend_is_friday():
    # Saturday 2026-09-26
    assert qs._expected_trading_day(_ist(2026, 9, 26, 10, 0)) == date(2026, 9, 25)


def test_expected_trading_day_monday_before_final_skips_the_weekend():
    assert qs._expected_trading_day(_ist(2026, 9, 28, 8, 0)) == date(2026, 9, 25)


def test_last_tcmb_working_day_before_1600_is_previous_weekday():
    assert qs._last_tcmb_working_day(_ist(2026, 9, 23, 12, 0)) == date(2026, 9, 22)


def test_last_tcmb_working_day_after_1600_is_today():
    assert qs._last_tcmb_working_day(_ist(2026, 9, 23, 17, 0)) == date(2026, 9, 23)


def test_last_tcmb_working_day_on_weekend_is_friday():
    assert qs._last_tcmb_working_day(_ist(2026, 9, 26, 10, 0)) == date(2026, 9, 25)


def test_is_market_hours():
    assert qs._is_market_hours(_ist(2026, 9, 23, 12, 0)) is True
    assert qs._is_market_hours(_ist(2026, 9, 23, 8, 0)) is False  # before open
    assert qs._is_market_hours(_ist(2026, 9, 23, 19, 0)) is False  # after close
    assert qs._is_market_hours(_ist(2026, 9, 26, 12, 0)) is False  # Saturday


# ---------------------------------------------------------------------------
# freshness.quotes
# ---------------------------------------------------------------------------


def test_quotes_freshness_missing_is_fail():
    result = qs._quotes_freshness_status(None, _ist(2026, 9, 23))
    assert result["status"] == "fail"
    assert result["actual"] is None


def test_quotes_freshness_in_session_thresholds():
    now = _ist(2026, 9, 23, 12, 0)
    fresh = qs._quotes_freshness_status(timedelta(minutes=1), now)
    warn = qs._quotes_freshness_status(timedelta(minutes=settings.quality_quotes_session_warn_minutes + 1), now)
    failing = qs._quotes_freshness_status(timedelta(minutes=settings.quality_quotes_session_fail_minutes + 1), now)
    assert fresh["status"] == "pass"
    assert warn["status"] == "warn"
    assert failing["status"] == "fail"
    assert fresh["details"]["in_session"] is True


def test_quotes_freshness_off_session_thresholds():
    now = _ist(2026, 9, 23, 22, 0)  # after close, still a weekday
    fresh = qs._quotes_freshness_status(timedelta(hours=1), now)
    warn = qs._quotes_freshness_status(timedelta(hours=settings.quality_quotes_offsession_warn_hours + 1), now)
    failing = qs._quotes_freshness_status(timedelta(hours=settings.quality_quotes_offsession_fail_hours + 1), now)
    assert fresh["status"] == "pass"
    assert warn["status"] == "warn"
    assert failing["status"] == "fail"
    assert fresh["details"]["in_session"] is False


# ---------------------------------------------------------------------------
# freshness.price_bars
# ---------------------------------------------------------------------------


def test_price_bars_freshness_missing_is_fail():
    result = qs._price_bars_freshness_status(None, _ist(2026, 9, 23, 19, 0))
    assert result["status"] == "fail"


def test_price_bars_freshness_on_time_is_pass():
    now = _ist(2026, 9, 23, 19, 0)  # expected trading day: 2026-09-23
    result = qs._price_bars_freshness_status(date(2026, 9, 23), now)
    assert result["status"] == "pass"
    assert result["actual"] == 0.0


def test_price_bars_freshness_one_weekday_short_is_warn_not_fail():
    now = _ist(2026, 9, 23, 19, 0)  # expected 2026-09-23; a bar from 2026-09-22 is one short
    result = qs._price_bars_freshness_status(date(2026, 9, 22), now)
    assert result["status"] == "warn"
    assert "tolerans" in (result["details"]["note"] or "")


def test_price_bars_freshness_far_behind_is_fail():
    now = _ist(2026, 9, 23, 19, 0)
    result = qs._price_bars_freshness_status(date(2026, 9, 10), now)
    assert result["status"] == "fail"


# ---------------------------------------------------------------------------
# freshness.fx_bulletins
# ---------------------------------------------------------------------------


def test_fx_freshness_missing_is_fail():
    assert qs._fx_freshness_status(None, _ist(2026, 9, 23, 17, 0))["status"] == "fail"


def test_fx_freshness_on_time_is_pass():
    result = qs._fx_freshness_status(date(2026, 9, 23), _ist(2026, 9, 23, 17, 0))
    assert result["status"] == "pass"


def test_fx_freshness_one_working_day_short_is_warn():
    result = qs._fx_freshness_status(date(2026, 9, 22), _ist(2026, 9, 23, 17, 0))
    assert result["status"] == "warn"


def test_fx_freshness_far_behind_is_fail():
    result = qs._fx_freshness_status(date(2026, 9, 1), _ist(2026, 9, 23, 17, 0))
    assert result["status"] == "fail"


# ---------------------------------------------------------------------------
# freshness.financial_statements coverage
# ---------------------------------------------------------------------------


def test_fundamentals_coverage_no_core_companies_is_warn():
    result = qs._fundamentals_coverage_status(0, 0)
    assert result["status"] == "warn"


def test_fundamentals_coverage_thresholds():
    assert qs._fundamentals_coverage_status(10, 9)["status"] == "pass"  # 90%
    assert qs._fundamentals_coverage_status(10, 6)["status"] == "warn"  # 60%
    assert qs._fundamentals_coverage_status(10, 3)["status"] == "fail"  # 30%


# ---------------------------------------------------------------------------
# freshness.macro_series cadence
# ---------------------------------------------------------------------------


def test_macro_cadence_missing_series_is_fail():
    assert qs._macro_cadence_status("tuik.cpi.yoy", None, _ist(2026, 9, 23))["status"] == "fail"
    assert qs._macro_cadence_status("tcmb.policy_rate", None, _ist(2026, 9, 23))["status"] == "fail"


def test_macro_cadence_tuik_allows_the_publication_lag():
    now = _ist(2026, 9, 23)
    # dated the 1st of the reference month, published ~5 weeks later: 53 days is normal
    assert qs._macro_cadence_status("tuik.cpi.yoy", now.date() - timedelta(days=53), now)["status"] == "pass"
    assert qs._macro_cadence_status("tuik.cpi.yoy", now.date() - timedelta(days=80), now)["status"] == "warn"
    assert qs._macro_cadence_status("tuik.cpi.yoy", now.date() - timedelta(days=150), now)["status"] == "fail"


def test_macro_cadence_tcmb_series_judged_by_the_last_successful_fetch():
    now = _ist(2026, 9, 23)
    unchanged_since_january = now.date() - timedelta(days=243)  # the MPC simply left the rate alone
    fresh = qs._macro_cadence_status("tcmb.policy_rate", unchanged_since_january, now, last_fetch=now - timedelta(hours=5))
    assert fresh["status"] == "pass"
    assert fresh["actual"] == 0.0
    stale = qs._macro_cadence_status("tcmb.policy_rate", unchanged_since_january, now, last_fetch=now - timedelta(days=4))
    assert stale["status"] == "warn"
    dead = qs._macro_cadence_status("tcmb.policy_rate", unchanged_since_january, now, last_fetch=now - timedelta(days=9))
    assert dead["status"] == "fail"
    never = qs._macro_cadence_status("tcmb.policy_rate", unchanged_since_january, now)
    assert never["status"] == "warn"
    assert "macro.rates" in never["details"]["note"]


def test_macro_cadence_structurally_inactive_series_never_fails_on_age():
    now = _ist(2026, 9, 23)
    result = qs._macro_cadence_status(
        "tcmb.late_liquidity.borrowing", date(2010, 5, 20), now, last_fetch=now - timedelta(hours=1)
    )
    assert result["status"] == "pass"
    assert "2010" in result["details"]["note"]
    missing = qs._macro_cadence_status("tcmb.late_liquidity.borrowing", None, now, last_fetch=now)
    assert missing["status"] == "pass"


def test_macro_cadence_unknown_series_uses_default_days():
    now = _ist(2026, 9, 23)
    default_days = settings.quality_macro_cadence_default_days
    result = qs._macro_cadence_status("some.unmapped.series", now.date() - timedelta(days=default_days + 1), now)
    assert result["status"] == "warn"
    assert result["expected"] == float(default_days)


# ---------------------------------------------------------------------------
# ingestion.health
# ---------------------------------------------------------------------------


def test_ingestion_health_never_run_is_warn():
    result = qs._ingestion_health_status(False, None, datetime.now(IST), expected_interval_hours=24.0)
    assert result["status"] == "warn"


def test_ingestion_health_recent_ok_run_is_pass():
    now = datetime.now(IST)
    result = qs._ingestion_health_status(False, now - timedelta(hours=1), now, expected_interval_hours=24.0)
    assert result["status"] == "pass"


def test_ingestion_health_recent_failure_is_warn():
    now = datetime.now(IST)
    result = qs._ingestion_health_status(True, now - timedelta(hours=1), now, expected_interval_hours=24.0)
    assert result["status"] == "warn"


def test_ingestion_health_stale_beyond_2x_interval_is_fail():
    now = datetime.now(IST)
    result = qs._ingestion_health_status(False, now - timedelta(hours=50), now, expected_interval_hours=24.0)
    assert result["status"] == "fail"


# ---------------------------------------------------------------------------
# integrity.*
# ---------------------------------------------------------------------------


def test_integrity_status_thresholds():
    assert qs._integrity_status(0, 100)["status"] == "pass"
    assert qs._integrity_status(min(2, settings.quality_integrity_fail_threshold), 100)["status"] == "warn"
    assert qs._integrity_status(settings.quality_integrity_fail_threshold + 1, 100)["status"] == "fail"


# ---------------------------------------------------------------------------
# cross_source.price_isyatirim
# ---------------------------------------------------------------------------


def test_price_crosscheck_status_empty_is_warn():
    assert qs._price_crosscheck_status([])["status"] == "warn"


def test_price_crosscheck_status_thresholds():
    assert qs._price_crosscheck_status([0.01, 0.02])["status"] == "pass"
    mid = (settings.quality_price_crosscheck_warn_pct + settings.quality_price_crosscheck_fail_pct) / 2
    assert qs._price_crosscheck_status([mid])["status"] == "warn"
    assert qs._price_crosscheck_status([settings.quality_price_crosscheck_fail_pct + 1])["status"] == "fail"


def test_normalize_external_result_folds_extras_into_details():
    raw = {"check_name": "macro.cpi_tcmb_vs_borsapy", "status": "pass", "subject": "tuik.cpi", "months_compared": 12, "mismatches": 0}
    normalized = qs._normalize_external_result(raw)
    assert normalized["check_name"] == "macro.cpi_tcmb_vs_borsapy"
    assert normalized["status"] == "pass"
    assert normalized["subject"] == "tuik.cpi"
    assert normalized["expected"] is None and normalized["actual"] is None
    assert normalized["details"] == {"months_compared": 12, "mismatches": 0}


# ---------------------------------------------------------------------------
# /data/status pure building blocks
# ---------------------------------------------------------------------------


def test_freshness_flag():
    window = timedelta(days=2)
    assert qs._freshness_flag(0, timedelta(hours=1), window) == "empty"
    assert qs._freshness_flag(5, None, window) == "stale"
    assert qs._freshness_flag(5, timedelta(hours=1), window) == "fresh"
    assert qs._freshness_flag(5, timedelta(days=3), window) == "stale"


def test_domain_status_matrix():
    assert qs._domain_status("empty", []) == "down"
    assert qs._domain_status("fresh", [None]) == "ok"
    assert qs._domain_status("fresh", ["ok"]) == "ok"
    assert qs._domain_status("fresh", ["failed"]) == "degraded"
    assert qs._domain_status("stale", ["failed"]) == "down"
    assert qs._domain_status("stale", ["ok"]) == "degraded"


def test_worst_status():
    assert qs._worst_status([]) == "ok"
    assert qs._worst_status(["ok", "ok"]) == "ok"
    assert qs._worst_status(["ok", "degraded"]) == "degraded"
    assert qs._worst_status(["ok", "down", "degraded"]) == "down"


def test_summarize_results_counts_and_lists_failures():
    results = [
        {"check_name": "a", "subject": "x", "status": "pass"},
        {"check_name": "b", "subject": "y", "status": "warn"},
        {"check_name": "c", "subject": "z", "status": "fail"},
        {"check_name": "d", "subject": None, "status": "fail"},
    ]
    summary = qs.summarize_results(results)
    assert summary["total"] == 4
    assert summary["pass"] == 1 and summary["warn"] == 1 and summary["fail"] == 2
    assert {f["check_name"] for f in summary["failing"]} == {"c", "d"}
    assert {w["check_name"] for w in summary["warning"]} == {"b"}


# ---------------------------------------------------------------------------
# Orchestration (no DB touched before the ValueError)
# ---------------------------------------------------------------------------


async def test_run_quality_checks_rejects_unknown_names():
    with pytest.raises(ValueError, match="bilinmeyen"):
        await qs.run_quality_checks(None, names=["not_a_real_check"])  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# run_domain_refresh dispatch (importlib monkeypatched — no real worker modules touched)
# ---------------------------------------------------------------------------


async def test_run_domain_refresh_unknown_domain_raises():
    with pytest.raises(qs.UnknownDomainError):
        await qs.run_domain_refresh("not-a-real-domain")


async def test_run_domain_refresh_missing_module_raises(monkeypatch):
    def fake_import(name):
        raise ImportError("boom")

    monkeypatch.setattr(qs.importlib, "import_module", fake_import)
    with pytest.raises(qs.DomainModuleUnavailableError):
        await qs.run_domain_refresh("market")


async def test_run_domain_refresh_maps_tickers_to_the_targets_own_param_name(monkeypatch):
    captured: dict = {}

    async def fake_run_reference_once(tickers=None):
        captured["tickers"] = tickers
        return {"ok": True}

    fake_module = type("FakeReferenceWorker", (), {"run_reference_once": staticmethod(fake_run_reference_once)})

    monkeypatch.setattr(qs.importlib, "import_module", lambda name: fake_module)
    result = await qs.run_domain_refresh("reference", tickers=["GARAN"], jobs=["ignored.unsupported.param"])

    assert result == {"domain": "reference", "result": {"ok": True}}
    assert captured["tickers"] == ["GARAN"]


async def test_run_domain_refresh_maps_tickers_to_symbols_when_thats_the_param_name(monkeypatch):
    captured: dict = {}

    async def fake_run_market_once(*, symbols=None, jobs=("market.quotes",)):
        captured["symbols"] = symbols
        captured["jobs"] = jobs
        return {"ok": True}

    fake_module = type("FakeMarketWorker", (), {"run_market_once": staticmethod(fake_run_market_once)})

    monkeypatch.setattr(qs.importlib, "import_module", lambda name: fake_module)
    result = await qs.run_domain_refresh("market", tickers=["GARAN", "THYAO"], jobs=["market.quotes"])

    assert result == {"domain": "market", "result": {"ok": True}}
    assert captured["symbols"] == ["GARAN", "THYAO"]
    assert captured["jobs"] == ["market.quotes"]


# ---------------------------------------------------------------------------
# cross_source.macro — delegates to macro_service, network-free (monkeypatched)
# ---------------------------------------------------------------------------


async def test_check_cross_source_macro_normalizes_results_and_marks_persisted(monkeypatch):
    from src.services import macro_service as real_macro_service

    async def fake_accuracy_checks(session):
        return [{"check_name": "macro.cpi_tcmb_vs_borsapy", "status": "pass", "months_compared": 12}]

    monkeypatch.setattr(real_macro_service, "run_accuracy_checks", fake_accuracy_checks)

    results = await qs._check_cross_source_macro(None)  # type: ignore[arg-type]

    assert len(results) == 1
    assert results[0]["check_name"] == "macro.cpi_tcmb_vs_borsapy"
    assert results[0]["status"] == "pass"
    assert results[0]["_already_persisted"] is True
    assert results[0]["details"] == {"months_compared": 12}


async def test_check_cross_source_macro_handles_missing_module_gracefully(monkeypatch):
    def fake_import(name):
        raise ImportError("boom")

    monkeypatch.setattr(qs.importlib, "import_module", fake_import)

    results = await qs._check_cross_source_macro(None)  # type: ignore[arg-type]

    assert results[0]["status"] == "warn"
    assert "error" in results[0]["details"]


async def test_check_cross_source_macro_handles_exception_from_the_peer_check(monkeypatch):
    from src.services import macro_service as real_macro_service

    async def boom(session):
        raise RuntimeError("kırık")

    monkeypatch.setattr(real_macro_service, "run_accuracy_checks", boom)

    results = await qs._check_cross_source_macro(None)  # type: ignore[arg-type]

    assert results[0]["status"] == "warn"


# ---------------------------------------------------------------------------
# cross_source.price_isyatirim — network-free (monkeypatched fetch)
# ---------------------------------------------------------------------------


async def test_check_price_vs_isyatirim_pass_when_prices_match(pg_session, monkeypatch):
    company = Company(ticker="GARAN", legal_name="Garanti BBVA", display_name="Garanti BBVA", tracking_tier="core")
    pg_session.add(company)
    await pg_session.flush()

    bars = {}
    for i in range(settings.quality_price_crosscheck_bars):
        bar_date = date(2026, 9, 1) + timedelta(days=i)
        close = 100.0 + i
        pg_session.add(PriceBar(symbol="GARAN", company_id=company.id, bar_date=bar_date, close=close, source="tradingview"))
        bars[bar_date] = close
    await pg_session.commit()

    async def fake_fetch(symbol, start, end):
        assert symbol == "GARAN"
        return dict(bars)

    monkeypatch.setattr(qs, "_fetch_isy_close_by_date", fake_fetch)
    monkeypatch.setattr(qs.settings, "quality_price_crosscheck_symbols", 1)

    results = await qs._check_price_vs_isyatirim(pg_session)

    assert len(results) == 1
    assert results[0]["subject"] == "GARAN"
    assert results[0]["status"] == "pass"


async def test_check_price_vs_isyatirim_no_candidates_is_warn(pg_session):
    results = await qs._check_price_vs_isyatirim(pg_session)
    assert results[0]["status"] == "warn"


async def test_check_price_vs_isyatirim_network_failure_is_warn_not_crash(pg_session, monkeypatch):
    company = Company(ticker="THYAO", legal_name="THY", display_name="THY", tracking_tier="core")
    pg_session.add(company)
    await pg_session.flush()
    for i in range(settings.quality_price_crosscheck_bars):
        pg_session.add(
            PriceBar(
                symbol="THYAO", company_id=company.id, bar_date=date(2026, 9, 1) + timedelta(days=i), close=100.0 + i, source="tradingview"
            )
        )
    await pg_session.commit()

    async def failing_fetch(symbol, start, end):
        raise TimeoutError("network down")

    monkeypatch.setattr(qs, "_fetch_isy_close_by_date", failing_fetch)
    monkeypatch.setattr(qs.settings, "quality_price_crosscheck_symbols", 1)

    results = await qs._check_price_vs_isyatirim(pg_session)

    assert results[0]["status"] == "warn"


# ---------------------------------------------------------------------------
# run_quality_checks end to end (pg_session, DB-only checks — no network)
# ---------------------------------------------------------------------------

_DB_ONLY_CHECKS = [name for name in qs.CHECK_NAMES if not name.startswith("cross_source")]


async def test_run_quality_checks_persists_one_row_per_result(pg_session):
    from sqlalchemy import select

    from src.db.models import DataQualityCheck

    results = await qs.run_quality_checks(pg_session, names=_DB_ONLY_CHECKS)

    assert len(results) > 0
    assert {r["status"] for r in results} <= {"pass", "warn", "fail"}
    for result in results:
        assert set(result) >= {"check_name", "subject", "status", "expected", "actual", "deviation", "details"}

    rows = (await pg_session.execute(select(DataQualityCheck))).scalars().all()
    assert len(rows) == len(results)


async def test_run_quality_checks_empty_db_never_crashes_and_flags_freshness_problems(pg_session):
    results = await qs.run_quality_checks(pg_session, names=_DB_ONLY_CHECKS)
    by_name: dict[str, list[dict]] = {}
    for r in results:
        by_name.setdefault(r["check_name"], []).append(r)

    # An empty database is a real freshness/coverage/ingestion problem: never silently "pass".
    for name in (
        "freshness.quotes",
        "freshness.price_bars",
        "freshness.financial_statements",
        "freshness.macro_series",
        "freshness.fx_bulletins",
        "ingestion.health",
    ):
        assert all(r["status"] in ("warn", "fail") for r in by_name[name]), name

    # Integrity checks are vacuously true on empty tables (nothing to violate) — that is correct.
    assert all(r["status"] == "pass" for r in by_name["integrity.price_bars"])
    assert all(r["status"] == "pass" for r in by_name["integrity.quotes"])
