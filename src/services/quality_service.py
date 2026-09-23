"""Data-quality checks (job ``quality.daily``; docs/data-platform.md §7).

A small registry of async checks (``_CHECKS``), each producing one or more result
dicts shaped ``{check_name, subject, status, expected, actual, deviation, details}``
(``status`` is ``pass``/``warn``/``fail``). :func:`run_quality_checks` runs the
selected (or all) checks, persists one ``data_quality_checks`` row per result and
returns the canonical list; :func:`summarize_results` reduces that list to counts.

Every check function is split into a pure evaluator (synthetic-row unit tests, no
DB/network) and a thin async wrapper that fetches the inputs and calls it — see the
``_*_status`` / ``_check_*`` pairs below.

:func:`get_data_status` (the ``/data/status`` payload) is intentionally a SEPARATE,
fast, DB-aggregate-only code path: it must answer in well under a second, so it never
runs the (occasionally network-bound) checks above.
"""

from __future__ import annotations

import asyncio
import importlib
import inspect
from collections.abc import Awaitable, Callable, Mapping, Sequence
from datetime import UTC, date, datetime, timedelta
from datetime import time as dtime
from typing import Any, Literal
from zoneinfo import ZoneInfo

import httpx
import structlog
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.price import SESSION_FINAL_TIME, is_session_final, now_istanbul
from src.adapters.utils import finite_float, get_http_client
from src.core.config import settings
from src.core.time import utcnow
from src.db.models import Company, FinancialStatement, FxBulletin, IngestionRun, MacroObservation, PriceBar, Quote
from src.db.repository import PollingStateRepository
from src.db.repositories.platform import QualityCheckRepository, platform_counts
from src.services.ingestion import latest_runs

logger = structlog.get_logger(__name__)

ISTANBUL_TZ = ZoneInfo("Europe/Istanbul")
CheckStatus = Literal["pass", "warn", "fail"]
DomainStatus = Literal["ok", "degraded", "down"]
Freshness = Literal["fresh", "stale", "empty"]

# Jobs known to the platform (docs/data-platform.md §4.3); used by the ingestion-health
# check and by /data/status. A job absent from ingestion_runs entirely is reported, not
# skipped — that is itself a signal (worker never ran / module missing).
KNOWN_JOBS: tuple[str, ...] = (
    "universe.sync",
    "reference.company",
    "market.quotes",
    "market.bars.daily",
    "market.bars.backfill",
    "fundamentals.statements",
    "fundamentals.ratios",
    "macro.rates",
    "macro.inflation",
    "macro.fx",
    "quality.daily",
)


# ---------------------------------------------------------------------------
# Small shared helpers (pure)
# ---------------------------------------------------------------------------


def _is_weekday(day: date) -> bool:
    return day.weekday() < 5


def _last_weekday_on_or_before(day: date) -> date:
    while not _is_weekday(day):
        day -= timedelta(days=1)
    return day


def _istanbul(now: datetime) -> datetime:
    return now.astimezone(ISTANBUL_TZ)


def _expected_trading_day(now: datetime) -> date:
    """Most recent Istanbul weekday whose session should be fully final by ``now``.

    Holiday-naive by design (we only know weekdays here): a legitimate exchange
    holiday looks identical to "data is one day behind", which is why the freshness
    checks below treat being one weekday short as ``warn``, not ``fail``.
    """
    moment = _istanbul(now)
    today = moment.date()
    if _is_weekday(today) and is_session_final(today, moment):
        return today
    return _last_weekday_on_or_before(today - timedelta(days=1))


def _last_tcmb_working_day(now: datetime) -> date:
    """TCMB's indicative bulletin publishes ~15:30 Istanbul; before ~16:00 today's may
    not exist yet, so "expected" stays at the previous weekday until then."""
    moment = _istanbul(now)
    today = moment.date()
    if _is_weekday(today) and moment.time() >= dtime(16, 0):
        return today
    return _last_weekday_on_or_before(today - timedelta(days=1))


def _is_market_hours(now: datetime) -> bool:
    moment = _istanbul(now)
    return _is_weekday(moment.date()) and dtime(9, 55) <= moment.time() < SESSION_FINAL_TIME


def _age(reference: datetime | None, now: datetime) -> timedelta | None:
    return None if reference is None else now - reference


# ---------------------------------------------------------------------------
# Freshness: quotes
# ---------------------------------------------------------------------------


def _quotes_freshness_status(age: timedelta | None, now: datetime) -> dict[str, Any]:
    if age is None:
        return {
            "status": "fail",
            "expected": None,
            "actual": None,
            "details": {"note": "quotes tablosu boş"},
        }
    in_session = _is_market_hours(now)
    warn_after = (
        timedelta(minutes=settings.quality_quotes_session_warn_minutes)
        if in_session
        else timedelta(hours=settings.quality_quotes_offsession_warn_hours)
    )
    fail_after = (
        timedelta(minutes=settings.quality_quotes_session_fail_minutes)
        if in_session
        else timedelta(hours=settings.quality_quotes_offsession_fail_hours)
    )
    status: CheckStatus = "fail" if age > fail_after else "warn" if age > warn_after else "pass"
    return {
        "status": status,
        "expected": round(warn_after.total_seconds() / 3600, 4),
        "actual": round(age.total_seconds() / 3600, 4),
        "details": {"in_session": in_session, "age_seconds": int(age.total_seconds())},
    }


async def _check_quotes_freshness(session: AsyncSession) -> list[dict[str, Any]]:
    now = now_istanbul()
    latest = await session.scalar(select(func.max(Quote.fetched_at)))
    evaluated = _quotes_freshness_status(_age(latest, now), now)
    return [{"check_name": "freshness.quotes", "subject": "quotes", **evaluated}]


# ---------------------------------------------------------------------------
# Freshness: price_bars
# ---------------------------------------------------------------------------


def _price_bars_freshness_status(latest_bar_date: date | None, now: datetime) -> dict[str, Any]:
    expected = _expected_trading_day(now)
    if latest_bar_date is None:
        return {
            "status": "fail",
            "expected": None,
            "actual": None,
            "details": {"note": "price_bars tablosu boş", "expected_trading_day": expected.isoformat()},
        }
    lag_days = (expected - latest_bar_date).days
    if latest_bar_date >= expected:
        status: CheckStatus = "pass"
        note = None
    else:
        previous = _last_weekday_on_or_before(expected - timedelta(days=1))
        status = "warn" if latest_bar_date >= previous else "fail"
        note = "Bir önceki hafta içi güne kadar tolerans (resmi tatil olabilir)." if status == "warn" else None
    return {
        "status": status,
        "expected": 0.0,
        "actual": float(lag_days),
        "details": {
            "latest_bar_date": latest_bar_date.isoformat(),
            "expected_trading_day": expected.isoformat(),
            "lag_calendar_days": lag_days,
            "note": note,
        },
    }


async def _check_price_bars_freshness(session: AsyncSession) -> list[dict[str, Any]]:
    now = now_istanbul()
    latest = await session.scalar(select(func.max(PriceBar.bar_date)).where(PriceBar.interval == "1d"))
    evaluated = _price_bars_freshness_status(latest, now)
    return [{"check_name": "freshness.price_bars", "subject": "price_bars", **evaluated}]


# ---------------------------------------------------------------------------
# Freshness: financial_statements coverage (tracking_tier=core)
# ---------------------------------------------------------------------------


def _fundamentals_coverage_status(core_total: int, core_covered: int) -> dict[str, Any]:
    if core_total == 0:
        return {
            "status": "warn",
            "expected": settings.quality_fundamentals_coverage_warn_pct,
            "actual": None,
            "details": {"note": "tracking_tier=core şirket yok (evren henüz senkronize olmamış olabilir)"},
        }
    pct = 100.0 * core_covered / core_total
    if pct >= settings.quality_fundamentals_coverage_warn_pct:
        status: CheckStatus = "pass"
    elif pct >= settings.quality_fundamentals_coverage_fail_pct:
        status = "warn"
    else:
        status = "fail"
    return {
        "status": status,
        "expected": settings.quality_fundamentals_coverage_warn_pct,
        "actual": round(pct, 2),
        "details": {"core_total": core_total, "core_covered": core_covered, "window_days": 400},
    }


async def _check_financial_statements_coverage(session: AsyncSession) -> list[dict[str, Any]]:
    cutoff = utcnow() - timedelta(days=400)
    core_total = (
        await session.scalar(
            select(func.count())
            .select_from(Company)
            .where(Company.tracking_tier == "core", Company.is_active.is_(True))
        )
        or 0
    )
    core_covered = (
        await session.scalar(
            select(func.count(func.distinct(FinancialStatement.company_id)))
            .select_from(FinancialStatement)
            .join(Company, Company.id == FinancialStatement.company_id)
            .where(
                Company.tracking_tier == "core",
                Company.is_active.is_(True),
                FinancialStatement.fetched_at >= cutoff,
            )
        )
        or 0
    )
    evaluated = _fundamentals_coverage_status(core_total, core_covered)
    return [{"check_name": "freshness.financial_statements", "subject": "financial_statements", **evaluated}]


# ---------------------------------------------------------------------------
# Freshness: macro_series cadence
# ---------------------------------------------------------------------------

# TÜİK series are dated the 1st of the reference month and published around the
# 3rd of the following month, so a healthy series is routinely 35-65 days old.
_MACRO_CADENCE_DAYS: dict[str, int] = {
    "tuik.cpi.yoy": 70,
    "tuik.cpi.mom": 70,
    "tuik.ppi.yoy": 70,
    "tuik.ppi.mom": 70,
}
# TCMB rate series only get a new observation when the MPC changes a rate (the
# policy rate stayed at 38 % from 2026-01-23 through the 2026-09-10 meeting), so
# their freshness is the age of the last successful ``macro.rates`` fetch.
_DECISION_SERIES_PREFIX = "tcmb."
_DECISION_FETCH_WARN_DAYS = 2
_DECISION_FETCH_FAIL_DAYS = 7
_STRUCTURALLY_INACTIVE_SERIES: dict[str, str] = {
    "tcmb.late_liquidity.borrowing": "TCMB 2010'dan beri bu faizi uygulamıyor (0 / '-' yayınlanır); gözlem beklenmez",
}


def _decision_series_status(
    series_code: str, latest: date | None, now: datetime, last_fetch: datetime | None
) -> dict[str, Any]:
    details: dict[str, Any] = {
        "latest_observation_date": latest.isoformat() if latest else None,
        "basis": "son başarılı macro.rates çekimi",
    }
    note = _STRUCTURALLY_INACTIVE_SERIES.get(series_code)
    if note:
        details["note"] = note
    if latest is None and not note:
        return {
            "status": "fail",
            "expected": float(_DECISION_FETCH_FAIL_DAYS),
            "actual": None,
            "details": {**details, "note": "seri hiç gözlenmemiş"},
        }
    if last_fetch is None:
        return {
            "status": "warn",
            "expected": float(_DECISION_FETCH_FAIL_DAYS),
            "actual": None,
            "details": {**details, "note": "macro.rates işi hiç başarıyla çalışmamış"},
        }
    fetch_age = (_istanbul(now).date() - last_fetch.astimezone(ISTANBUL_TZ).date()).days
    status: CheckStatus = (
        "fail" if fetch_age > _DECISION_FETCH_FAIL_DAYS else "warn" if fetch_age > _DECISION_FETCH_WARN_DAYS else "pass"
    )
    details["last_fetch_at"] = last_fetch.isoformat()
    return {
        "status": status,
        "expected": float(_DECISION_FETCH_FAIL_DAYS),
        "actual": float(fetch_age),
        "details": details,
    }


def _macro_cadence_status(
    series_code: str, latest: date | None, now: datetime, *, last_fetch: datetime | None = None
) -> dict[str, Any]:
    if series_code.startswith(_DECISION_SERIES_PREFIX):
        return _decision_series_status(series_code, latest, now, last_fetch)
    cadence_days = _MACRO_CADENCE_DAYS.get(series_code, settings.quality_macro_cadence_default_days)
    if latest is None:
        return {
            "status": "fail",
            "expected": float(cadence_days),
            "actual": None,
            "details": {"note": "seri hiç gözlenmemiş"},
        }
    age_days = (_istanbul(now).date() - latest).days
    status: CheckStatus = "fail" if age_days > cadence_days * 2 else "warn" if age_days > cadence_days else "pass"
    return {
        "status": status,
        "expected": float(cadence_days),
        "actual": float(age_days),
        "details": {"latest_observation_date": latest.isoformat(), "basis": "gözlem tarihi + yayın gecikmesi"},
    }


async def _last_successful_run(session: AsyncSession, job: str) -> datetime | None:
    value = (
        await session.execute(
            select(func.max(IngestionRun.finished_at)).where(
                IngestionRun.job == job, IngestionRun.status.in_(("ok", "partial"))
            )
        )
    ).scalar_one_or_none()
    if value is not None and value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value


async def _check_macro_cadence(session: AsyncSession) -> list[dict[str, Any]]:
    now = now_istanbul()
    rows = (
        await session.execute(
            select(MacroObservation.series_code, func.max(MacroObservation.observation_date)).group_by(
                MacroObservation.series_code
            )
        )
    ).all()
    latest_by_series: dict[str, date] = {code: latest for code, latest in rows if latest is not None}
    last_rates_fetch = await _last_successful_run(session, "macro.rates")
    series_codes = sorted(set(_MACRO_CADENCE_DAYS) | set(_STRUCTURALLY_INACTIVE_SERIES) | set(latest_by_series))
    return [
        {
            "check_name": "freshness.macro_series",
            "subject": code,
            **_macro_cadence_status(code, latest_by_series.get(code), now, last_fetch=last_rates_fetch),
        }
        for code in series_codes
    ]


# ---------------------------------------------------------------------------
# Freshness: fx_bulletins
# ---------------------------------------------------------------------------


def _fx_freshness_status(latest: date | None, now: datetime) -> dict[str, Any]:
    expected = _last_tcmb_working_day(now)
    if latest is None:
        return {
            "status": "fail",
            "expected": None,
            "actual": None,
            "details": {"note": "fx_bulletins tablosu boş", "expected_working_day": expected.isoformat()},
        }
    lag = (expected - latest).days
    if latest >= expected:
        status: CheckStatus = "pass"
    else:
        previous = _last_weekday_on_or_before(expected - timedelta(days=1))
        status = "warn" if latest >= previous else "fail"
    return {
        "status": status,
        "expected": 0.0,
        "actual": float(lag),
        "details": {"latest_bulletin_date": latest.isoformat(), "expected_working_day": expected.isoformat()},
    }


async def _check_fx_freshness(session: AsyncSession) -> list[dict[str, Any]]:
    now = now_istanbul()
    latest = await session.scalar(select(func.max(FxBulletin.bulletin_date)))
    evaluated = _fx_freshness_status(latest, now)
    return [{"check_name": "freshness.fx_bulletins", "subject": "fx_bulletins", **evaluated}]


# ---------------------------------------------------------------------------
# Ingestion runs health
# ---------------------------------------------------------------------------


def _ingestion_health_status(
    had_recent_failure: bool,
    latest_started_at: datetime | None,
    now: datetime,
    *,
    expected_interval_hours: float,
) -> dict[str, Any]:
    if latest_started_at is None:
        return {
            "status": "warn",
            "expected": expected_interval_hours,
            "actual": None,
            "details": {"note": "iş hiç çalışmamış"},
        }
    age_hours = (now - latest_started_at).total_seconds() / 3600
    if age_hours > 2 * expected_interval_hours:
        status: CheckStatus = "fail"
    elif had_recent_failure:
        status = "warn"
    else:
        status = "pass"
    return {
        "status": status,
        "expected": expected_interval_hours,
        "actual": round(age_hours, 2),
        "details": {"latest_started_at": latest_started_at.isoformat(), "recent_failure_24h": had_recent_failure},
    }


async def _check_ingestion_health(session: AsyncSession) -> list[dict[str, Any]]:
    now = utcnow()
    cutoff = now - timedelta(hours=24)
    failed_jobs = set(
        (
            await session.execute(
                select(IngestionRun.job)
                .where(IngestionRun.started_at >= cutoff, IngestionRun.status == "failed")
                .distinct()
            )
        ).scalars()
    )
    job_rows = (
        await session.execute(select(IngestionRun.job, func.max(IngestionRun.started_at)).group_by(IngestionRun.job))
    ).all()
    latest_by_job: dict[str, datetime] = {job: started for job, started in job_rows if started is not None}
    return [
        {
            "check_name": "ingestion.health",
            "subject": job,
            **_ingestion_health_status(
                job in failed_jobs,
                latest_by_job.get(job),
                now,
                expected_interval_hours=settings.quality_ingestion_default_interval_hours,
            ),
        }
        for job in KNOWN_JOBS
    ]


# ---------------------------------------------------------------------------
# Integrity
# ---------------------------------------------------------------------------


def _integrity_status(violations: int, total: int) -> dict[str, Any]:
    if violations == 0:
        status: CheckStatus = "pass"
    elif violations > settings.quality_integrity_fail_threshold:
        status = "fail"
    else:
        status = "warn"
    return {
        "status": status,
        "expected": 0.0,
        "actual": float(violations),
        "details": {"violations": violations, "total": total},
    }


async def _check_price_bars_integrity(session: AsyncSession) -> list[dict[str, Any]]:
    total = await session.scalar(select(func.count()).select_from(PriceBar)) or 0
    bad = (
        await session.scalar(
            select(func.count())
            .select_from(PriceBar)
            .where(
                or_(
                    and_(PriceBar.high.is_not(None), PriceBar.low.is_not(None), PriceBar.high < PriceBar.low),
                    and_(PriceBar.close.is_not(None), PriceBar.low.is_not(None), PriceBar.close < PriceBar.low),
                    and_(PriceBar.close.is_not(None), PriceBar.high.is_not(None), PriceBar.close > PriceBar.high),
                    and_(PriceBar.close.is_not(None), PriceBar.close <= 0),
                )
            )
        )
        or 0
    )
    evaluated = _integrity_status(bad, total)
    return [{"check_name": "integrity.price_bars", "subject": "price_bars", **evaluated}]


async def _check_quotes_integrity(session: AsyncSession) -> list[dict[str, Any]]:
    total = await session.scalar(select(func.count()).select_from(Quote)) or 0
    bad = (
        await session.scalar(select(func.count()).select_from(Quote).where(Quote.last.is_not(None), Quote.last <= 0))
        or 0
    )
    evaluated = _integrity_status(bad, total)
    return [{"check_name": "integrity.quotes", "subject": "quotes", **evaluated}]


async def _check_stale_active_companies(session: AsyncSession) -> list[dict[str, Any]]:
    cutoff = utcnow() - timedelta(days=settings.quality_stale_active_company_days)
    total_active = (
        await session.scalar(
            select(func.count())
            .select_from(Company)
            .where(Company.is_active.is_(True), Company.security_type == "stock")
        )
        or 0
    )
    stale = (
        await session.scalar(
            select(func.count())
            .select_from(Company)
            .outerjoin(Quote, and_(Quote.company_id == Company.id, Quote.fetched_at >= cutoff))
            .where(Company.is_active.is_(True), Company.security_type == "stock", Quote.symbol.is_(None))
        )
        or 0
    )
    status: CheckStatus = "pass" if stale == 0 else "warn"
    return [
        {
            "check_name": "integrity.stale_active_companies",
            "subject": "companies",
            "status": status,
            "expected": 0.0,
            "actual": float(stale),
            "details": {
                "stale": stale,
                "active_total": total_active,
                "window_days": settings.quality_stale_active_company_days,
            },
        }
    ]


# ---------------------------------------------------------------------------
# Cross-source: delegate to the macro workstream's own accuracy checks
# ---------------------------------------------------------------------------


def _normalize_external_result(raw: Mapping[str, Any]) -> dict[str, Any]:
    """Another workstream's check-result dict -> our canonical shape.

    Their dicts (e.g. ``macro_service.run_accuracy_checks``) are ad hoc
    ``{check_name, status, **details}``; everything besides the five known keys is
    folded into ``details`` so nothing is lost.
    """
    reserved = {"check_name", "status", "subject", "expected", "actual", "deviation"}
    details = {k: v for k, v in raw.items() if k not in reserved}
    return {
        "check_name": str(raw.get("check_name", "cross_source.unknown")),
        "subject": raw.get("subject"),
        "status": str(raw.get("status", "warn")),
        "expected": raw.get("expected"),
        "actual": raw.get("actual"),
        "deviation": raw.get("deviation"),
        "details": details,
    }


async def _check_cross_source_macro(session: AsyncSession) -> list[dict[str, Any]]:
    check_name = "cross_source.macro"
    try:
        module = importlib.import_module("src.services.macro_service")
        run_accuracy_checks = module.run_accuracy_checks
    except (ImportError, AttributeError) as exc:
        return [
            {
                "check_name": check_name,
                "subject": None,
                "status": "warn",
                "expected": None,
                "actual": None,
                "details": {
                    "note": "macro_service.run_accuracy_checks içe aktarılamadı (WS4 henüz hazır olmayabilir)",
                    "error": str(exc),
                },
            }
        ]
    try:
        raw_results = await run_accuracy_checks(session)
    except Exception as exc:  # a peer workstream's bug must not break the whole quality run
        logger.warning("quality_cross_source_macro_failed", error=str(exc))
        return [
            {
                "check_name": check_name,
                "subject": None,
                "status": "warn",
                "expected": None,
                "actual": None,
                "details": {
                    "note": "macro doğruluk kontrolleri çalıştırılamadı",
                    "error": f"{type(exc).__name__}: {exc}",
                },
            }
        ]
    normalized = [_normalize_external_result(r) for r in raw_results]
    for item in normalized:
        item["_already_persisted"] = True  # run_accuracy_checks already wrote + committed its own rows
    return normalized


# ---------------------------------------------------------------------------
# Cross-source: TradingView (price_bars) vs İş Yatırım HGDG_KAPANIS
# ---------------------------------------------------------------------------

_ISY_HISTORY_URL = "https://www.isyatirim.com.tr/_layouts/15/IsYatirim.Website/Common/Data.aspx/HisseTekil"
_ISY_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.isyatirim.com.tr/tr-tr/analiz/hisse/Sayfalar/default.aspx",
}


def _price_crosscheck_status(deviations_pct: list[float]) -> dict[str, Any]:
    if not deviations_pct:
        return {
            "status": "warn",
            "expected": settings.quality_price_crosscheck_warn_pct,
            "actual": None,
            "details": {"note": "karşılaştırılabilir ortak gün bulunamadı"},
        }
    max_dev = max(deviations_pct)
    avg_dev = sum(deviations_pct) / len(deviations_pct)
    if max_dev > settings.quality_price_crosscheck_fail_pct:
        status: CheckStatus = "fail"
    elif max_dev > settings.quality_price_crosscheck_warn_pct:
        status = "warn"
    else:
        status = "pass"
    return {
        "status": status,
        "expected": settings.quality_price_crosscheck_warn_pct,
        "actual": round(max_dev, 4),
        "details": {
            "points_compared": len(deviations_pct),
            "avg_deviation_pct": round(avg_dev, 4),
            "max_deviation_pct": round(max_dev, 4),
            "note": (
                "HGDG_KAPANIS temettü ve sermaye artışına göre düzeltilir; TradingView barları "
                "yalnızca bölünme/bedelsize göre düzeltilir — son kurumsal aksiyon çevresinde fark beklenir."
            ),
        },
    }


async def _random_core_symbols_with_bars(session: AsyncSession, n: int, bar_count: int) -> dict[str, dict[date, float]]:
    candidates_stmt = (
        select(PriceBar.symbol)
        .join(Company, Company.id == PriceBar.company_id)
        .where(Company.tracking_tier == "core", Company.is_active.is_(True), PriceBar.interval == "1d")
        .group_by(PriceBar.symbol)
        .having(func.count() >= bar_count)
        .order_by(func.random())
        .limit(n)
    )
    symbols = list((await session.execute(candidates_stmt)).scalars().all())
    result: dict[str, dict[date, float]] = {}
    for symbol in symbols:
        rows_stmt = (
            select(PriceBar.bar_date, PriceBar.close)
            .where(PriceBar.symbol == symbol, PriceBar.interval == "1d")
            .order_by(PriceBar.bar_date.desc())
            .limit(bar_count)
        )
        rows = (await session.execute(rows_stmt)).all()
        result[symbol] = {bar_date: float(close) for bar_date, close in rows if close is not None}
    return result


async def _fetch_isy_close_by_date(symbol: str, start: date, end: date) -> dict[date, float]:
    params = {"hisse": symbol, "startdate": start.strftime("%d-%m-%Y"), "enddate": end.strftime("%d-%m-%Y")}
    response = await get_http_client().get(
        _ISY_HISTORY_URL, params=params, headers=_ISY_HEADERS, timeout=httpx.Timeout(15.0, connect=5.0)
    )
    response.raise_for_status()
    body = response.json()
    rows = body.get("value") if isinstance(body, dict) else None
    result: dict[date, float] = {}
    for row in rows or []:
        raw_date = row.get("HGDG_TARIH")
        if not isinstance(raw_date, str):
            continue
        try:
            bar_date = datetime.strptime(raw_date.strip()[:10], "%d-%m-%Y").date()
        except ValueError:
            continue
        close = finite_float(row.get("HGDG_KAPANIS"))
        if close is not None and close > 0:
            result[bar_date] = close
    return result


async def _check_price_vs_isyatirim(session: AsyncSession) -> list[dict[str, Any]]:
    check_name = "cross_source.price_tv_vs_isyatirim"
    try:
        symbols = await _random_core_symbols_with_bars(
            session, settings.quality_price_crosscheck_symbols, settings.quality_price_crosscheck_bars
        )
    except Exception as exc:
        logger.warning("quality_price_crosscheck_symbol_pick_failed", error=str(exc))
        return [
            {
                "check_name": check_name,
                "subject": None,
                "status": "warn",
                "expected": None,
                "actual": None,
                "details": {"note": "karşılaştırılacak sembol seçilemedi", "error": str(exc)},
            }
        ]
    if not symbols:
        return [
            {
                "check_name": check_name,
                "subject": None,
                "status": "warn",
                "expected": None,
                "actual": None,
                "details": {"note": "karşılaştırılacak sembol yok (price_bars henüz yeterince dolu değil)"},
            }
        ]

    async def _one(symbol: str, bars: dict[date, float]) -> dict[str, Any]:
        try:
            isy = await _fetch_isy_close_by_date(symbol, min(bars), max(bars))
        except Exception as exc:
            return {
                "check_name": check_name,
                "subject": symbol,
                "status": "warn",
                "expected": None,
                "actual": None,
                "details": {"note": "İş Yatırım'a ulaşılamadı", "error": f"{type(exc).__name__}: {exc}"},
            }
        deviations = [
            abs(tv_close - isy[bar_date]) / tv_close * 100.0
            for bar_date, tv_close in bars.items()
            if bar_date in isy and tv_close
        ]
        evaluated = _price_crosscheck_status(deviations)
        return {"check_name": check_name, "subject": symbol, **evaluated}

    async def _run() -> list[dict[str, Any]]:
        # Fetched concurrently (İş Yatırım's WAF tolerates a handful of parallel
        # requests fine, per src/adapters/isyatirim_prices.py's own _MAX_CONCURRENCY=4) —
        # sequential fetches of 5 symbols at ~5-6s each would blow the timeout budget below.
        return list(await asyncio.gather(*(_one(symbol, bars) for symbol, bars in symbols.items())))

    try:
        return await asyncio.wait_for(_run(), timeout=settings.quality_price_crosscheck_timeout_seconds)
    except TimeoutError:
        return [
            {
                "check_name": check_name,
                "subject": None,
                "status": "warn",
                "expected": None,
                "actual": None,
                "details": {"note": f"{settings.quality_price_crosscheck_timeout_seconds:.0f} sn zaman aşımı"},
            }
        ]


# ---------------------------------------------------------------------------
# Registry + orchestration
# ---------------------------------------------------------------------------

_CHECKS: dict[str, Callable[[AsyncSession], Awaitable[list[dict[str, Any]]]]] = {
    "freshness.quotes": _check_quotes_freshness,
    "freshness.price_bars": _check_price_bars_freshness,
    "freshness.financial_statements": _check_financial_statements_coverage,
    "freshness.macro_series": _check_macro_cadence,
    "freshness.fx_bulletins": _check_fx_freshness,
    "ingestion.health": _check_ingestion_health,
    "integrity.price_bars": _check_price_bars_integrity,
    "integrity.quotes": _check_quotes_integrity,
    "integrity.stale_active_companies": _check_stale_active_companies,
    "cross_source.macro": _check_cross_source_macro,
    "cross_source.price_isyatirim": _check_price_vs_isyatirim,
}

CHECK_NAMES: tuple[str, ...] = tuple(_CHECKS)


async def run_quality_checks(session: AsyncSession, *, names: list[str] | None = None) -> list[dict[str, Any]]:
    """Run the selected (or all) checks, persist one row per result, return them.

    Unknown ``names`` raise ``ValueError``. A check that raises is caught here (its own
    bug must not take the whole batch down) and recorded as a single ``fail`` result.
    Commits once at the end.
    """
    selected = names if names is not None else list(_CHECKS)
    unknown = [n for n in selected if n not in _CHECKS]
    if unknown:
        raise ValueError(f"bilinmeyen kontrol adı: {', '.join(unknown)}")

    repo = QualityCheckRepository(session)
    all_results: list[dict[str, Any]] = []
    for name in selected:
        try:
            results = await _CHECKS[name](session)
        except Exception as exc:
            logger.error("quality_check_failed", check=name, error=f"{type(exc).__name__}: {exc}")
            results = [
                {
                    "check_name": name,
                    "subject": None,
                    "status": "fail",
                    "expected": None,
                    "actual": None,
                    "details": {"note": "kontrol çalıştırılamadı", "error": f"{type(exc).__name__}: {exc}"},
                }
            ]
        for result in results:
            already_persisted = result.pop("_already_persisted", False)
            if result.get("deviation") is None:
                expected, actual = result.get("expected"), result.get("actual")
                if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
                    result["deviation"] = actual - expected
                else:
                    result.setdefault("deviation", None)
            if not already_persisted:
                repo.record(result)
            all_results.append(result)
    await session.commit()
    return all_results


def summarize_results(results: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    counts = {"pass": 0, "warn": 0, "fail": 0}
    for r in results:
        status = str(r.get("status", "warn"))
        counts[status] = counts.get(status, 0) + 1
    failing = [
        {"check_name": r["check_name"], "subject": r.get("subject")} for r in results if r.get("status") == "fail"
    ]
    warning = [
        {"check_name": r["check_name"], "subject": r.get("subject")} for r in results if r.get("status") == "warn"
    ]
    return {"total": len(results), **counts, "failing": failing, "warning": warning}


# ---------------------------------------------------------------------------
# /admin/data/refresh dispatch (lazy import of the other workstreams' run_*_once)
# ---------------------------------------------------------------------------


class UnknownDomainError(ValueError):
    def __init__(self, domain: str):
        super().__init__(f"unknown domain: {domain}")
        self.domain = domain


class DomainModuleUnavailableError(RuntimeError):
    def __init__(self, domain: str, reason: str):
        super().__init__(reason)
        self.domain = domain
        self.reason = reason


_REFRESH_TARGETS: dict[str, tuple[str, str]] = {
    "market": ("src.workers.market_worker", "run_market_once"),
    "fundamentals": ("src.workers.fundamentals_worker", "run_fundamentals_once"),
    "reference": ("src.workers.reference_worker", "run_reference_once"),
    "macro": ("src.workers.macro_worker", "run_macro_once"),
}


async def run_domain_refresh(
    domain: str, *, tickers: list[str] | None = None, jobs: list[str] | None = None
) -> dict[str, Any]:
    """Lazily import ``run_<domain>_once`` and run it now, bounded by
    ``QUALITY_REFRESH_TIMEOUT_SECONDS``.

    Each domain's ``run_*_once`` has a slightly different signature (``tickers`` vs.
    ``symbols``, ``jobs`` present or not) since the workstreams are developed
    independently; only the parameters the target function actually declares are
    passed, so this stays compatible as those signatures evolve.
    """
    target = _REFRESH_TARGETS.get(domain)
    if target is None:
        raise UnknownDomainError(domain)
    module_name, func_name = target
    try:
        module = importlib.import_module(module_name)
        func = getattr(module, func_name)
    except (ImportError, AttributeError) as exc:
        raise DomainModuleUnavailableError(domain, f"{type(exc).__name__}: {exc}") from exc

    params = inspect.signature(func).parameters
    kwargs: dict[str, Any] = {}
    if tickers is not None:
        if "tickers" in params:
            kwargs["tickers"] = tickers
        elif "symbols" in params:
            kwargs["symbols"] = tickers
    if jobs is not None and "jobs" in params:
        kwargs["jobs"] = jobs

    result = await asyncio.wait_for(func(**kwargs), timeout=settings.quality_refresh_timeout_seconds)
    return {"domain": domain, "result": result}


# ---------------------------------------------------------------------------
# /data/status — fast, DB-aggregate-only domain status
# ---------------------------------------------------------------------------


def _freshness_flag(row_count: int, age: timedelta | None, max_fresh_age: timedelta) -> Freshness:
    if row_count == 0:
        return "empty"
    if age is None or age > max_fresh_age:
        return "stale"
    return "fresh"


def _domain_status(freshness: Freshness, job_statuses: Sequence[str | None]) -> DomainStatus:
    if freshness == "empty":
        return "down"
    known = [s for s in job_statuses if s is not None]
    if any(s == "failed" for s in known):
        return "down" if freshness == "stale" else "degraded"
    if freshness == "stale":
        return "degraded"
    return "ok"


def _to_datetime(value: date | datetime | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    return datetime.combine(value, dtime.min, tzinfo=ISTANBUL_TZ)


def _job_out(run: IngestionRun) -> dict[str, Any]:
    return {
        "job": run.job,
        "scope": run.scope,
        "status": run.status,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
        "items_total": run.items_total,
        "items_ok": run.items_ok,
        "items_failed": run.items_failed,
        "error": run.error,
    }


# Domains intentionally use their own, generous, hardcoded freshness windows —
# independent from the (tighter, tunable) thresholds the checks above use for
# alerting. /data/status is a fast at-a-glance signal, not the alerting source of truth
# (that is /data/quality).
_STATUS_FRESH_WINDOWS: dict[str, timedelta] = {
    "universe": timedelta(days=3),
    "market": timedelta(days=4),
    "fundamentals": timedelta(days=10),
    "macro": timedelta(days=10),
    "quality": timedelta(hours=30),
}


def _build_domain(
    domain: str,
    *,
    row_count: int,
    latest: date | datetime | None,
    now: datetime,
    jobs: list[IngestionRun],
    tables: list[dict[str, Any]],
) -> dict[str, Any]:
    latest_dt = _to_datetime(latest)
    age = _age(latest_dt, now)
    freshness = _freshness_flag(row_count, age, _STATUS_FRESH_WINDOWS[domain])
    status = _domain_status(freshness, [j.status for j in jobs])
    return {
        "domain": domain,
        "status": status,
        "freshness": freshness,
        "jobs": [_job_out(j) for j in jobs],
        "tables": tables,
    }


async def get_data_status(session: AsyncSession) -> dict[str, Any]:
    """Build the full ``/data/status`` payload — a handful of aggregate queries, no
    per-row Python loops; safe (never raises) on an entirely empty database."""
    now = now_istanbul()
    counts = await platform_counts(session)
    runs = await latest_runs(session, jobs=list(KNOWN_JOBS))
    by_job: dict[str, list[IngestionRun]] = {}
    for run in runs:
        by_job.setdefault(run.job, []).append(run)

    def jobs_for(*names: str) -> list[IngestionRun]:
        result: list[IngestionRun] = []
        for name in names:
            result.extend(by_job.get(name, []))
        return result

    domains = [
        _build_domain(
            "universe",
            row_count=counts["companies_total"],
            latest=counts["companies_reference_latest"] or counts["index_memberships_latest"],
            now=now,
            jobs=jobs_for("universe.sync", "reference.company"),
            tables=[
                {"table": "companies", "row_count": counts["companies_total"], "latest": None},
                {
                    "table": "index_memberships",
                    "row_count": counts["index_memberships_total"],
                    "latest": _iso(counts["index_memberships_latest"]),
                },
            ],
        ),
        _build_domain(
            "market",
            row_count=counts["quotes_total"] + counts["price_bars_total"],
            latest=counts["quotes_latest_fetched_at"],
            now=now,
            jobs=jobs_for("market.quotes", "market.bars.daily", "market.bars.backfill"),
            tables=[
                {
                    "table": "quotes",
                    "row_count": counts["quotes_total"],
                    "latest": _iso(counts["quotes_latest_fetched_at"]),
                },
                {
                    "table": "price_bars",
                    "row_count": counts["price_bars_total"],
                    "latest": _iso(counts["price_bars_latest_date"]),
                },
            ],
        ),
        _build_domain(
            "fundamentals",
            row_count=counts["financial_statements_total"],
            latest=counts["financial_statements_latest_fetched_at"],
            now=now,
            jobs=jobs_for("fundamentals.statements", "fundamentals.ratios"),
            tables=[
                {
                    "table": "financial_statements",
                    "row_count": counts["financial_statements_total"],
                    "latest": counts["financial_statements_latest_period"],
                },
                {"table": "financial_ratios", "row_count": counts["financial_ratios_total"], "latest": None},
            ],
        ),
        _build_domain(
            "macro",
            row_count=counts["macro_observations_total"] + counts["fx_bulletins_total"],
            latest=max(
                (
                    d
                    for d in (counts["macro_observations_latest_date"], counts["fx_bulletins_latest_date"])
                    if d is not None
                ),
                default=None,
            ),
            now=now,
            jobs=jobs_for("macro.rates", "macro.inflation", "macro.fx"),
            tables=[
                {
                    "table": "macro_series",
                    "row_count": counts["macro_observations_total"],
                    "latest": _iso(counts["macro_observations_latest_date"]),
                },
                {
                    "table": "fx_bulletins",
                    "row_count": counts["fx_bulletins_total"],
                    "latest": _iso(counts["fx_bulletins_latest_date"]),
                },
            ],
        ),
        _build_domain(
            "quality",
            row_count=counts["quality_checks_total"],
            latest=counts["quality_checks_latest"],
            now=now,
            jobs=jobs_for("quality.daily"),
            tables=[
                {
                    "table": "data_quality_checks",
                    "row_count": counts["quality_checks_total"],
                    "latest": _iso(counts["quality_checks_latest"]),
                },
                {"table": "data_snapshots", "row_count": counts["data_snapshots_total"], "latest": None},
            ],
        ),
    ]

    polling_state = await PollingStateRepository(session).get_all()
    overall = _worst_status([d["status"] for d in domains])
    return {
        "generated_at": utcnow(),
        "status": overall,
        "domains": domains,
        "polling_state": list(polling_state),
    }


def _iso(value: date | datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


_STATUS_RANK: dict[DomainStatus, int] = {"ok": 0, "degraded": 1, "down": 2}


def _worst_status(statuses: Sequence[DomainStatus]) -> DomainStatus:
    if not statuses:
        return "ok"
    return max(statuses, key=lambda s: _STATUS_RANK[s])
