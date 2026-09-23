"""Fundamentals store (data-infra WS3): statements → canonical facts → ratios, store-first reads.

Datasets (``docs/data-platform.md`` §3):

* ``financial_statements`` — one row per (company, source, period, statement type):
  the **KAP** financial summary (official, first published; balance sheet + income
  statement; presentation unit and consolidation per column) and **İş Yatırım**
  MaliTablo (12 quarters; balance sheet, income statement, cash flow; IAS 29 fiscal
  year-end columns re-expressed → ``restated`` + ``restatement_factor`` = KAP ÷ İşY).
* ``financial_facts`` — canonical items per period on the first-published basis
  (:func:`src.adapters.fundamentals_statements.build_canonical_facts`).
* ``financial_ratios`` — ``ttm`` / ``annual`` ratios (:func:`src.services.analysis_service.ratio_rows`).

Refresh (:func:`refresh_company_statements`, job ``fundamentals.statements``): fetch
KAP (process-wide gate, ≥3 s apart) and İş Yatırım (≤3 companies at once), merge
with the rows already stored (KAP's page only shows 3 year-ends + the latest interim;
earlier first-published periods stay in the store), write rows whose content hash
changed, rebuild facts, update the company's fundamentals columns, write KAP↔İşY
checks to ``data_quality_checks`` and a refresh manifest to ``data_snapshots``
(``fundamentals.statements:<TICKER>``: per-source periods/fetch time/errors — the
store-first views rebuild exactly the latest fetch from it).

Store-first reads (§4.1): statement views, cash flow, live ratios, ``/financials`` and
``/financials/ratios`` are served from the store while fresh
(``FUNDAMENTALS_MAX_AGE_*``), fetched live (and stored in the background) when stale
or missing, and served from the store with ``meta.stale = true`` when the provider
fails. Every payload keeps its historical fields and gains an additive ``meta``.
"""

from __future__ import annotations

import asyncio
import calendar
import functools
import json
import time
from collections.abc import Awaitable, Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters import fundamentals_statements as fs
from src.adapters.financial_adapter import (
    ISYATIRIM_COMPANY_CARD_URL,
    months_into_fiscal_year,
    parse_period,
    period_label,
    quarter_ends_before,
    sort_periods_desc,
    to_number,
)
from src.adapters.fundamentals_common import (
    ISTANBUL_TZ,
    _MSG_CASHFLOW,
    _MSG_RATIOS,
    _MSG_STATEMENTS,
    _failure,
    kap_gate,
)
from src.adapters.utils import MarketDataError, SymbolNotFoundError, tradingview_scan
from src.core.config import settings
from src.core.meta import DataMeta, ServedFrom, with_meta
from src.core.time import utcnow
from src.db.models import Company, DataSnapshot, FinancialFact, FinancialRatio, FinancialStatement
from src.db.repositories.fundamentals import FACT_COLUMNS, FundamentalsRepository, StatementUpsertResult
from src.db.session import async_session_factory
from src.services.analysis_service import MarketInputs, choose_shares, ratio_rows

logger = structlog.get_logger(__name__)

SessionFactory = Callable[[], Any]  # async context manager yielding an AsyncSession

SOURCE_KAP = fs.SOURCE_KAP
SOURCE_ISYATIRIM = fs.SOURCE_ISYATIRIM
_STALE_NOTE = "Sağlayıcıya ulaşılamadı; son kayıtlı veri"
_API_RETRY_COOLDOWN = timedelta(minutes=30)  # a failed refresh is not retried by readers before this
_KAP_VS_ISY_ITEMS = ("total_assets", "total_equity", "revenue", "net_income")
_TV_MARKET_COLUMNS = (
    "close", "change_abs", "market_cap_basic", "total_shares_outstanding", "price_earnings_ttm", "price_book_ratio",
)


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _parse_iso(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=ISTANBUL_TZ)


def _error_text(exc: BaseException) -> str:
    message = exc.message if isinstance(exc, MarketDataError) else str(exc)
    return f"{type(exc).__name__}: {message}"[:300]


def period_end(period: str) -> date | None:
    parsed = parse_period(period)
    if parsed is None:
        return None
    year, month = parsed
    return date(year, month, calendar.monthrange(year, month)[1])


def published_dates(
    periods: Iterable[str],
    report_times: Sequence[datetime],
    *,
    fiscal_year_end_month: int = 12,
    min_lag_days: int = 20,
    max_lag_days: int = 130,
) -> dict[str, date]:
    """``published_at`` per period from the company's KAP "Finansal Rapor" disclosures (Istanbul dates).

    Each disclosure reports the latest fiscal quarter that ended at least
    ``min_lag_days`` before it (no report comes out faster), if that was at most
    ``max_lag_days`` earlier; a period takes its earliest disclosure. A period
    whose own report is not among the disclosures stays unknown — it never
    borrows the next quarter's date.
    """
    wanted = set(periods)
    result: dict[str, date] = {}
    for day in sorted({t.astimezone(ISTANBUL_TZ).date() for t in report_times}):
        ends = quarter_ends_before(day - timedelta(days=min_lag_days), 1, fiscal_year_end_month)
        if not ends:
            continue
        label = period_label(*ends[0])
        end = period_end(label)
        if label in wanted and label not in result and end is not None and (day - end).days <= max_lag_days:
            result[label] = day
    return result


# ---------------------------------------------------------------------------
# Refresh manifest (data_snapshots row per company)
# ---------------------------------------------------------------------------

@dataclass
class Manifest:
    """Per-company refresh bookkeeping (``data_snapshots`` payload)."""

    ticker: str
    payload: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_row(cls, ticker: str, row: DataSnapshot | None) -> Manifest:
        return cls(ticker=ticker, payload=dict(row.payload or {}) if row is not None else {})

    def source(self, name: str) -> dict[str, Any]:
        value = self.payload.get(name)
        return value if isinstance(value, dict) else {}

    def fetched_at(self, name: str) -> datetime | None:
        return _parse_iso(self.source(name).get("fetched_at"))

    @property
    def refreshed_at(self) -> datetime | None:
        """Time of the last refresh in which BOTH sources answered (the store's freshness)."""
        kap, isy = self.fetched_at(SOURCE_KAP), self.fetched_at(SOURCE_ISYATIRIM)
        if kap is None or isy is None:
            return None
        return min(kap, isy)

    @property
    def last_success_at(self) -> datetime | None:
        times = [t for t in (self.fetched_at(SOURCE_KAP), self.fetched_at(SOURCE_ISYATIRIM)) if t is not None]
        return max(times) if times else None

    @property
    def last_attempt_at(self) -> datetime | None:
        return _parse_iso(self.payload.get("last_attempt_at"))

    @property
    def last_attempt_ok(self) -> bool:
        return bool(self.payload.get("last_attempt_ok"))

    def periods(self, name: str) -> list[str] | None:
        periods = self.source(name).get("periods")
        return [str(p) for p in periods] if isinstance(periods, list) else None


def refresh_due(manifest: Manifest | None, now: datetime, cadence: timedelta, retry_after: timedelta) -> bool:
    """Worker schedule: refresh when the last complete refresh is older than ``cadence``,
    but not sooner than ``retry_after`` after a failed/partial attempt."""
    if manifest is None or not manifest.payload:
        return True
    refreshed = manifest.refreshed_at
    if refreshed is not None and now - refreshed < cadence:
        return False
    attempted = manifest.last_attempt_at
    return attempted is None or now - attempted >= retry_after


# ---------------------------------------------------------------------------
# Refresh: live fetch → financial_statements → financial_facts (→ ratios)
# ---------------------------------------------------------------------------

@dataclass
class RefreshResult:
    ticker: str
    ok: bool = False
    skipped: str | None = None  # "fresh" | "not_tracked"
    kap_ok: bool = False
    isy_ok: bool = False
    kap_error: str | None = None
    isy_error: str | None = None
    statements: StatementUpsertResult | None = None
    facts: int = 0
    ratios: int = 0
    duration_seconds: float = 0.0
    template: str | None = None
    isyatirim_scope: str | None = None
    kap: dict[str, Any] | None = None
    isy: dict[str, Any] | None = None

    def summary(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "skipped": self.skipped,
            "kap": "ok" if self.kap_ok else self.kap_error,
            "isyatirim": "ok" if self.isy_ok else self.isy_error,
            "inserted": self.statements.inserted if self.statements else 0,
            "updated": self.statements.updated if self.statements else 0,
            "unchanged": self.statements.unchanged if self.statements else 0,
            "facts": self.facts,
            "ratios": self.ratios,
            "template": self.template,
            "isyatirim_scope": self.isyatirim_scope,
            "seconds": round(self.duration_seconds, 2),
        }


class _LoopBound:
    """asyncio primitives created lazily per event loop (tests run several loops)."""

    def __init__(self) -> None:
        self.loop: asyncio.AbstractEventLoop | None = None
        self.isy_semaphore: asyncio.Semaphore | None = None
        self.refresh_tasks: dict[str, asyncio.Task[RefreshResult]] = {}

    def bind(self) -> _LoopBound:
        loop = asyncio.get_running_loop()
        if self.loop is not loop:
            self.loop = loop
            self.isy_semaphore = asyncio.Semaphore(max(1, settings.fundamentals_isy_concurrency))
            self.refresh_tasks = {}
        return self


_state = _LoopBound()


async def _fetch_kap(ticker: str) -> dict[str, Any]:
    return await fs._get_kap_financial_summary(ticker)


async def _fetch_isy(ticker: str, fiscal_year_end_month: int) -> dict[str, Any]:
    state = _state.bind()
    assert state.isy_semaphore is not None
    async with state.isy_semaphore:
        return await fs._get_isyatirim_quarterly(ticker, fiscal_year_end_month)


async def fetch_sources(
    ticker: str, fiscal_year_end_month: int = 12
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, str | None, str | None]:
    """``(kap, isy, kap_error, isy_error)`` — both providers, each failure isolated.

    İş Yatırım is asked for the fiscal quarters of the known fiscal year end and
    re-asked when KAP reveals a different one.
    """
    kap_task = asyncio.ensure_future(_fetch_kap(ticker))
    isy_task = asyncio.ensure_future(_fetch_isy(ticker, fiscal_year_end_month))
    kap: dict[str, Any] | None = None
    isy: dict[str, Any] | None = None
    kap_error: str | None = None
    isy_error: str | None = None
    try:
        kap = await kap_task
    except asyncio.CancelledError:
        isy_task.cancel()
        raise
    except Exception as e:
        kap_error = _error_text(e)
    try:
        isy = await isy_task
    except asyncio.CancelledError:
        raise
    except Exception as e:
        isy_error = _error_text(e)
    kap_fy = int((kap or {}).get("fiscal_year_end_month") or fiscal_year_end_month or 12)
    if kap is not None and kap_fy != fiscal_year_end_month:
        try:
            isy, isy_error = await _fetch_isy(ticker, kap_fy), None
        except Exception as e:
            isy, isy_error = None, _error_text(e)
    return kap, isy, kap_error, isy_error


def _merge_rows(stored: Iterable[FinancialStatement], fresh: Sequence[Mapping[str, Any]]) -> list[Any]:
    """Stored rows overlaid with freshly built rows (same source/period/type → fresh wins)."""
    fresh_keys = {(r["source"], r["period"], r["statement_type"]) for r in fresh}
    merged: list[Any] = [r for r in stored if (r.source, r.period, r.statement_type) not in fresh_keys]
    merged.extend(fresh)
    return merged


def _consolidation_for_isy(facts: fs.CanonicalFacts, kap_rows: Sequence[Any]) -> str | None:
    if facts.isyatirim_scope == "match":
        latest = max(kap_rows, key=lambda r: parse_period(fs._row_value(r, "period")) or (0, 0), default=None)
        return fs._row_value(latest, "consolidation") if latest is not None else None
    if facts.template == "bank":
        return "Konsolide Olmayan"  # İş Yatırım serves bank-only (solo) statements
    return None


def kap_vs_isy_checks(
    ticker: str,
    facts: fs.CanonicalFacts,
    kap_maps: Mapping[str, Mapping[str, Mapping[str, Any]]],
    isy_maps: Mapping[str, Mapping[str, Mapping[str, Any]]],
) -> list[dict[str, Any]]:
    """``data_quality_checks`` rows: KAP (expected) vs İş Yatırım (actual) per overlapping period.

    ``deviation`` is measured after converting İş Yatırım's value back to KAP's
    measuring unit with the period's restatement factor; ``details.raw_deviation``
    is the unconverted one. Different scope (bank/insurer solo figures) → ``warn``.
    """
    checks: list[dict[str, Any]] = []
    for period in sort_periods_desc(set(kap_maps) & set(isy_maps)):
        kap_items = fs._canonical_maps({period: kap_maps[period]}).get(period, {})
        isy_items = fs._canonical_maps({period: isy_maps[period]}).get(period, {})
        factor = facts.factors.get(period) or {}
        for item in _KAP_VS_ISY_ITEMS:
            expected, actual = to_number(kap_items.get(item)), to_number(isy_items.get(item))
            if expected is None or actual is None or expected == 0:
                continue
            f = fs._factor_for(item, factor) if factor.get("balance") is not None else 1.0
            deviation = actual * f / expected - 1
            raw = actual / expected - 1
            if facts.isyatirim_scope != "match":
                status = "warn"
            elif abs(deviation) <= 0.005:
                status = "pass"
            elif abs(deviation) <= 0.02:
                status = "warn"
            else:
                status = "fail"
            checks.append(
                {
                    "check_name": f"fundamentals.kap_vs_isy.{item}",
                    "subject": f"{ticker} {period}",
                    "status": status,
                    "expected": expected,
                    "actual": actual,
                    "deviation": deviation,
                    "details": {
                        "ticker": ticker,
                        "period": period,
                        "raw_deviation": raw,
                        "restatement_factor": {k: v for k, v in factor.items() if v is not None} or None,
                        "restated": period in facts.restated_periods,
                        "isyatirim_scope": facts.isyatirim_scope,
                        "template": facts.template,
                    },
                }
            )
    return checks


async def persist_refresh(
    session: AsyncSession,
    company: Company,
    *,
    kap: Mapping[str, Any] | None,
    isy: Mapping[str, Any] | None,
    kap_error: str | None = None,
    isy_error: str | None = None,
    now: datetime | None = None,
    write_checks: bool = True,
    record_fetch: bool = True,
) -> RefreshResult:
    """Write one refresh (either source may be missing) and rebuild the company's facts.

    Pure database work (no network); the caller commits. ``record_fetch=False``
    (offline rebuild from stored rows) leaves the manifest's fetch bookkeeping alone.
    """
    now = now or utcnow()
    ticker = company.ticker
    repo = FundamentalsRepository(session)
    result = RefreshResult(
        ticker=ticker, kap_ok=kap is not None, isy_ok=isy is not None, kap_error=kap_error, isy_error=isy_error
    )
    stored = await repo.statement_rows(company.id)
    manifest = Manifest.from_row(ticker, (await repo.manifests([ticker])).get(ticker))

    fresh_kap_rows = fs.kap_statement_rows(kap) if kap is not None else []
    rows_for_facts = _merge_rows(stored, fresh_kap_rows)
    kap_maps = fs.statement_maps_from_rows(rows_for_facts, SOURCE_KAP)
    fresh_isy_maps = fs.isyatirim_statement_maps(isy) if isy is not None else {}
    isy_maps = {**fs.statement_maps_from_rows(stored, SOURCE_ISYATIRIM), **fresh_isy_maps}
    kap_units = {
        str(fs._row_value(r, "period")): fs._kap_unit(fs._row_value(r, "presentation_unit"))[0]
        for r in rows_for_facts
        if fs._row_value(r, "source") == SOURCE_KAP
        and fs._row_value(r, "statement_type") == "balance_sheet"
        and fs._row_value(r, "presentation_unit")
    }
    stored_template = next((r.template for r in stored if r.source == SOURCE_KAP and r.template), None)
    template = fs.combined_template(kap or ({"template": stored_template} if stored_template else None), isy)
    if kap is None and isy is None and company.statement_template:
        template = company.statement_template
    fy = int(
        (kap or {}).get("fiscal_year_end_month")
        or company.fiscal_year_end_month
        or next((r.fiscal_year_end_month for r in stored), 12)
    )
    facts = fs.build_canonical_facts(kap_maps, isy_maps, template=template, fiscal_year_end_month=fy, kap_units=kap_units)
    result.template, result.isyatirim_scope = template, facts.isyatirim_scope

    fresh_rows: list[dict[str, Any]] = list(fresh_kap_rows)
    if isy is not None:
        restated = {p: f for p, f in facts.restated_periods.items() if p in fresh_isy_maps}
        fresh_rows.extend(
            fs.isyatirim_statement_rows(
                isy,
                ticker=ticker,
                fiscal_year_end_month=fy,
                restated=restated,
                consolidation=_consolidation_for_isy(facts, [r for r in rows_for_facts if fs._row_value(r, "source") == SOURCE_KAP]),
            )
        )
    report_times = await repo.financial_report_times(company.id)
    if report_times:
        dates = published_dates({r["period"] for r in fresh_rows}, report_times, fiscal_year_end_month=fy)
        for row in fresh_rows:
            if row["period"] in dates:
                row["published_at"] = dates[row["period"]]
                row["content_hash"] = fs.statement_content_hash(row)
    result.statements = await repo.upsert_statements(company.id, fresh_rows, touch=record_fetch)

    months: dict[str, int | None] = {}
    for period in facts.items:
        parsed = parse_period(period)
        months[period] = months_into_fiscal_year(parsed[1], fy) if parsed else None
    result.facts = await repo.upsert_facts(
        company.id, facts.items, months=months, sources=facts.sources, template=template, fiscal_year_end_month=fy
    )
    latest_capital = next(
        (items.get("paid_in_capital") for _, items in sorted(facts.items.items(), key=lambda kv: parse_period(kv[0]) or (0, 0), reverse=True)
         if items.get("paid_in_capital") is not None),
        None,
    )
    if kap is not None or isy is not None:
        await repo.update_company_fundamentals(
            company.id, fiscal_year_end_month=fy, statement_template=template, paid_in_capital=latest_capital
        )
    if write_checks and result.statements.changed and kap_maps and isy_maps:
        await repo.add_quality_checks(kap_vs_isy_checks(ticker, facts, kap_maps, isy_maps))

    payload = dict(manifest.payload)
    if not record_fetch:
        payload.update(rebuilt_at=_iso(now), template=template, fiscal_year_end_month=fy,
                       isyatirim_scope=facts.isyatirim_scope, rejected_keys=facts.rejected_keys,
                       skipped_periods=facts.skipped_periods,
                       restated_periods={p: round(f, 6) for p, f in facts.restated_periods.items()})
        rebuilt = Manifest(ticker=ticker, payload=payload)
        await repo.save_manifest(
            ticker, payload, fetched_at=rebuilt.last_success_at or now,
            expires_at=(rebuilt.refreshed_at + timedelta(hours=settings.fundamentals_max_age_statements_hours))
            if rebuilt.refreshed_at else None,
        )
        result.ok = True
        return result
    payload.update(
        version=1,
        ticker=ticker,
        last_attempt_at=_iso(now),
        last_attempt_ok=kap is not None and isy is not None,
        template=template,
        fiscal_year_end_month=fy,
        isyatirim_scope=facts.isyatirim_scope,
        rejected_keys=facts.rejected_keys,
        skipped_periods=facts.skipped_periods,
        restated_periods={p: round(f, 6) for p, f in facts.restated_periods.items()},
        statements={
            "inserted": result.statements.inserted,
            "updated": result.statements.updated,
            "unchanged": result.statements.unchanged,
        },
        facts=result.facts,
    )
    if kap is not None:
        payload[SOURCE_KAP] = {
            "ok": True,
            "fetched_at": _iso(now),
            "periods": list(kap.get("periods") or []),
            "source_url": kap.get("source_url"),
            "error": None,
        }
    else:
        payload[SOURCE_KAP] = {**manifest.source(SOURCE_KAP), "ok": False, "error": kap_error}
    if isy is not None:
        payload[SOURCE_ISYATIRIM] = {
            "ok": True,
            "fetched_at": _iso(now),
            "periods": list(isy.get("periods") or []),
            "group": isy.get("group"),
            "template": isy.get("template"),
            "error": None,
        }
    else:
        payload[SOURCE_ISYATIRIM] = {**manifest.source(SOURCE_ISYATIRIM), "ok": False, "error": isy_error}
    failures = int(manifest.payload.get("consecutive_failures") or 0)
    payload["consecutive_failures"] = 0 if (kap is not None and isy is not None) else failures + 1
    new_manifest = Manifest(ticker=ticker, payload=payload)
    fetched_at = new_manifest.last_success_at or now
    await repo.save_manifest(
        ticker,
        payload,
        fetched_at=fetched_at,
        expires_at=(new_manifest.refreshed_at or fetched_at) + timedelta(hours=settings.fundamentals_max_age_statements_hours),
    )
    result.ok = kap is not None or isy is not None
    return result


async def record_failed_attempt(
    session: AsyncSession, ticker: str, *, kap_error: str | None, isy_error: str | None, now: datetime | None = None
) -> None:
    """Both providers failed: only the manifest changes (stored data untouched)."""
    now = now or utcnow()
    repo = FundamentalsRepository(session)
    manifest = Manifest.from_row(ticker, (await repo.manifests([ticker])).get(ticker))
    payload = dict(manifest.payload)
    payload.update(
        version=1,
        ticker=ticker,
        last_attempt_at=_iso(now),
        last_attempt_ok=False,
        consecutive_failures=int(manifest.payload.get("consecutive_failures") or 0) + 1,
    )
    payload[SOURCE_KAP] = {**manifest.source(SOURCE_KAP), "ok": False, "error": kap_error}
    payload[SOURCE_ISYATIRIM] = {**manifest.source(SOURCE_ISYATIRIM), "ok": False, "error": isy_error}
    fetched_at = manifest.last_success_at or now
    await repo.save_manifest(ticker, payload, fetched_at=fetched_at, expires_at=None)


async def rebuild_from_store(
    ticker: str,
    *,
    compute_ratios: bool = True,
    market: MarketInputs | None = None,
    session_factory: SessionFactory = async_session_factory,
) -> RefreshResult:
    """Re-derive rows (restatement flags, published dates), facts, company columns and ratios
    from the stored statements — no provider request. Use after mapping changes."""
    ticker = ticker.strip().upper()
    started = time.monotonic()
    async with session_factory() as session:
        repo = FundamentalsRepository(session)
        company = await repo.company_by_ticker(ticker)
        if company is None:
            return RefreshResult(ticker=ticker, skipped="not_tracked")
        rows = await repo.statement_rows(company.id)
        kap = fs.kap_summary_from_rows(rows)
        isy = fs.isyatirim_table_from_rows(rows)
        if kap is None and isy is None:
            return RefreshResult(ticker=ticker, skipped="empty")
        result = await persist_refresh(session, company, kap=kap, isy=isy, record_fetch=False, write_checks=False)
        if compute_ratios and result.facts:
            inputs = market if market is not None else (await load_market_inputs([ticker], session=session)).get(ticker)
            result.ratios = await compute_company_ratios(session, company, inputs)
        await session.commit()
    result.duration_seconds = time.monotonic() - started
    return result


async def _refresh(
    ticker: str,
    *,
    max_age: timedelta | None,
    compute_ratios: bool,
    market: MarketInputs | None,
    session_factory: SessionFactory,
) -> RefreshResult:
    started = time.monotonic()
    now = utcnow()
    async with session_factory() as session:
        repo = FundamentalsRepository(session)
        company = await repo.company_by_ticker(ticker)
        manifest = Manifest.from_row(ticker, (await repo.manifests([ticker])).get(ticker)) if company else None
    if company is None:
        return RefreshResult(ticker=ticker, skipped="not_tracked")
    if max_age is not None and manifest is not None and manifest.refreshed_at is not None:
        if now - manifest.refreshed_at < max_age:
            return RefreshResult(ticker=ticker, ok=True, skipped="fresh")

    kap, isy, kap_error, isy_error = await fetch_sources(ticker, int(company.fiscal_year_end_month or 12))
    async with session_factory() as session:
        if kap is None and isy is None:
            await record_failed_attempt(session, ticker, kap_error=kap_error, isy_error=isy_error, now=now)
            await session.commit()
            result = RefreshResult(ticker=ticker, kap_error=kap_error, isy_error=isy_error)
        else:
            company = await FundamentalsRepository(session).company_by_ticker(ticker)
            assert company is not None
            result = await persist_refresh(
                session, company, kap=kap, isy=isy, kap_error=kap_error, isy_error=isy_error, now=now
            )
            if compute_ratios and result.facts:
                inputs = market
                if inputs is None:
                    inputs = (await load_market_inputs([ticker], session=session)).get(ticker)
                result.ratios = await compute_company_ratios(session, company, inputs)
            await session.commit()
    result.kap, result.isy = kap, isy
    result.duration_seconds = time.monotonic() - started
    logger.info("fundamentals_refreshed", ticker=ticker, **{k: v for k, v in result.summary().items() if k != "ok"},
                ok=result.ok)
    return result


async def refresh_company_statements(
    ticker: str,
    *,
    max_age: timedelta | None = None,
    compute_ratios: bool = True,
    market: MarketInputs | None = None,
    session_factory: SessionFactory = async_session_factory,
) -> RefreshResult:
    """Fetch KAP + İş Yatırım for ``ticker`` and store statements/facts (and ratios).

    Single-flight per ticker (concurrent callers share one refresh) and shielded:
    a cancelled caller (client went away, timeout) does not abort the write.
    ``max_age`` skips companies refreshed more recently than that.
    """
    ticker = ticker.strip().upper()
    state = _state.bind()
    task = state.refresh_tasks.get(ticker)
    if task is None or task.done():
        task = asyncio.get_running_loop().create_task(
            _refresh(ticker, max_age=max_age, compute_ratios=compute_ratios, market=market,
                     session_factory=session_factory),
            name=f"fundamentals-refresh:{ticker}",
        )
        state.refresh_tasks[ticker] = task
        task.add_done_callback(functools.partial(_forget_task, ticker))
    return await asyncio.shield(task)


def _forget_task(ticker: str, task: asyncio.Task[RefreshResult]) -> None:
    if _state.refresh_tasks.get(ticker) is task:
        del _state.refresh_tasks[ticker]
    if not task.cancelled() and task.exception() is not None:
        logger.warning("fundamentals_refresh_failed", ticker=ticker, error=repr(task.exception()))


def start_background_refresh(ticker: str, session_factory: SessionFactory = async_session_factory) -> None:
    """Fire-and-forget refresh (the API's live path stores what it just fetched)."""

    async def run() -> None:
        try:
            await refresh_company_statements(ticker, session_factory=session_factory)
        except Exception as e:  # logged; readers fall back to the store
            logger.warning("fundamentals_background_refresh_failed", ticker=ticker, error=_error_text(e))

    asyncio.get_running_loop().create_task(run(), name=f"fundamentals-bg:{ticker}")


# ---------------------------------------------------------------------------
# Market inputs and ratios
# ---------------------------------------------------------------------------

def _quote_time(quote: Any) -> datetime | None:
    return getattr(quote, "quote_time", None) or getattr(quote, "fetched_at", None)


async def load_market_inputs(
    tickers: Sequence[str],
    *,
    session: AsyncSession | None = None,
    session_factory: SessionFactory = async_session_factory,
    scan: Callable[..., Awaitable[dict[str, dict[str, Any]]]] | None = None,
) -> dict[str, MarketInputs]:
    """Price and share evidence per ticker.

    Price: the ``quotes`` table (market store) when its row is recent
    (``FUNDAMENTALS_QUOTE_MAX_AGE_HOURS``), else TradingView's scanner close.
    Share evidence (TradingView ``total_shares_outstanding`` and
    ``market_cap_basic`` ÷ previous close) always comes from one scanner request.
    """
    wanted = sorted({t.strip().upper() for t in tickers if t and t.strip()})
    if not wanted:
        return {}
    quotes: dict[str, Any] = {}
    try:
        if session is not None:
            quotes = await FundamentalsRepository(session).quotes(wanted)
        else:
            async with session_factory() as own:
                quotes = await FundamentalsRepository(own).quotes(wanted)
    except Exception as e:
        logger.warning("fundamentals_quotes_unavailable", error=_error_text(e))
    rows: dict[str, dict[str, Any]] = {}
    try:
        rows = await (scan or tradingview_scan)(wanted, _TV_MARKET_COLUMNS)
    except Exception as e:
        logger.warning("fundamentals_tradingview_scan_failed", error=_error_text(e), tickers=len(wanted))
    now = utcnow()
    max_age = timedelta(hours=settings.fundamentals_quote_max_age_hours)
    result: dict[str, MarketInputs] = {}
    for ticker in wanted:
        row = rows.get(ticker) or {}
        close = to_number(row.get("close"))
        change = to_number(row.get("change_abs"))
        prev_close = close - change if close is not None and change is not None else None
        tv_cap = to_number(row.get("market_cap_basic"))
        implied = None
        if tv_cap is not None and tv_cap > 0:
            basis = prev_close if prev_close is not None and prev_close > 0 else close
            implied = tv_cap / basis if basis else None
        price, price_source, price_time = None, None, None
        quote = quotes.get(ticker)
        quote_last = to_number(getattr(quote, "last", None)) if quote is not None else None
        quote_at = _quote_time(quote) if quote is not None else None
        if quote_last is not None and quote_last > 0 and quote_at is not None and now - quote_at <= max_age:
            price, price_source, price_time = quote_last, "quotes", _iso(quote_at)
        elif close is not None and close > 0:
            price, price_source, price_time = close, "tradingview", _iso(now)
        if price is None and implied is None and to_number(row.get("total_shares_outstanding")) is None:
            continue
        result[ticker] = MarketInputs(
            price=price,
            price_source=price_source,
            price_time=price_time,
            total_shares=to_number(row.get("total_shares_outstanding")),
            implied_shares=implied,
            provider_market_cap=tv_cap,
            provider_pe=to_number(row.get("price_earnings_ttm")),
            provider_pb=to_number(row.get("price_book_ratio")),
        )
    return result


def facts_by_period(rows: Iterable[FinancialFact]) -> tuple[dict[str, dict[str, float | None]], dict[str, dict[str, Any]]]:
    items: dict[str, dict[str, float | None]] = {}
    sources: dict[str, dict[str, Any]] = {}
    for row in rows:
        items[row.period] = {column: to_number(getattr(row, column)) for column in FACT_COLUMNS}
        sources[row.period] = dict(row.sources_json or {})
    return items, sources


def shares_check(ticker: str, paid_in_capital: float | None, market: MarketInputs | None) -> dict[str, Any] | None:
    """``fundamentals.shares.paid_in_capital_vs_tradingview`` (BIST: 1 TL nominal → capital = share count)."""
    capital = to_number(paid_in_capital)
    reported = to_number(market.total_shares) if market else None
    if capital is None or capital <= 0 or reported is None or reported <= 0:
        return None
    deviation = reported / capital - 1
    implied = to_number(market.implied_shares) if market else None
    status = "pass" if abs(deviation) <= 0.01 else "warn" if abs(deviation) <= 0.15 else "fail"
    shares, source, notes = choose_shares(capital, market)
    return {
        "check_name": "fundamentals.shares.paid_in_capital_vs_tradingview",
        "subject": ticker,
        "status": status,
        "expected": capital,
        "actual": reported,
        "deviation": deviation,
        "details": {
            "ticker": ticker,
            "tradingview_total_shares": reported,
            "tradingview_implied_shares": implied,
            "implied_deviation": (implied / capital - 1) if implied else None,
            "shares_used": shares,
            "shares_source": source,
            "notes": notes,
        },
    }


def ratio_checks(ticker: str, rows: Sequence[Mapping[str, Any]], market: MarketInputs | None) -> list[dict[str, Any]]:
    """Our newest P/E (TTM) and P/B (fiscal year) against TradingView's own ratios.

    TradingView's P/E is price / TTM EPS and its P/B uses the last fiscal-year
    equity, so the TTM P/E and the *annual* P/B are the comparable figures. The
    P/E can legitimately differ for IAS 29 reporters: our TTM is on the
    first-published basis (each cumulative period in its own measuring unit).
    """
    if market is None:
        return []
    checks: list[dict[str, Any]] = []
    latest = {basis: next((r for r in rows if r["basis"] == basis), None) for basis in ("ttm", "annual")}
    pairs = (
        ("pe_vs_tradingview", latest["ttm"], "pe_ratio", market.provider_pe, (0.05, 0.25)),
        ("pb_vs_tradingview", latest["annual"], "pb_ratio", market.provider_pb, (0.02, 0.10)),
    )
    for name, row, column, provider, (pass_limit, warn_limit) in pairs:
        ours = to_number(row.get(column)) if row else None
        theirs = to_number(provider)
        if ours is None or theirs is None or theirs <= 0:
            continue
        deviation = ours / theirs - 1
        status = "pass" if abs(deviation) <= pass_limit else "warn" if abs(deviation) <= warn_limit else "fail"
        checks.append(
            {
                "check_name": f"fundamentals.ratios.{name}",
                "subject": ticker,
                "status": status,
                "expected": theirs,
                "actual": ours,
                "deviation": deviation,
                "details": {"ticker": ticker, "period": row["period"] if row else None,
                            "basis": row["basis"] if row else None, "price": market.price},
            }
        )
    return checks


async def compute_company_ratios(
    session: AsyncSession, company: Company, market: MarketInputs | None, *, write_checks: bool = False
) -> int:
    """Recompute every ``financial_ratios`` row of ``company`` from its stored facts (caller commits).

    ``write_checks``: also record the TradingView cross-checks (the daily ratio job does,
    once per company and day; ad-hoc recomputes do not).
    """
    repo = FundamentalsRepository(session)
    fact_rows = await repo.facts(company.id)
    if not fact_rows:
        return 0
    items, sources = facts_by_period(fact_rows)
    fy = int(fact_rows[0].fiscal_year_end_month or company.fiscal_year_end_month or 12)
    template = fact_rows[0].template or company.statement_template or "industrial"
    rows = ratio_rows(items, fiscal_year_end_month=fy, template=template, market=market, sources_by_period=sources)
    written = await repo.replace_ratios(company.id, rows)
    if write_checks and market is not None:
        latest = sort_periods_desc(items)[0]
        checks = ratio_checks(company.ticker, rows, market)
        shares = shares_check(company.ticker, items[latest].get("paid_in_capital"), market)
        if shares is not None:
            checks.append(shares)
        if checks:
            await repo.add_quality_checks(checks)
    return written


async def recompute_ratios(
    tickers: Sequence[str] | None = None,
    *,
    session_factory: SessionFactory = async_session_factory,
    market: Mapping[str, MarketInputs] | None = None,
    write_checks: bool = False,
) -> dict[str, Any]:
    """Ratios for every company with facts (or ``tickers``): one market scan, one commit per company."""
    async with session_factory() as session:
        repo = FundamentalsRepository(session)
        with_facts = set(await repo.companies_with_facts())
        companies = [
            c for c in await repo.companies(tickers=tickers, stocks_only=False, active_only=tickers is None)
            if c.id in with_facts
        ]
    inputs = dict(market) if market is not None else await load_market_inputs([c.ticker for c in companies])
    written = failed = 0
    errors: dict[str, str] = {}
    for company in companies:
        try:
            async with session_factory() as session:
                written += await compute_company_ratios(
                    session, company, inputs.get(company.ticker), write_checks=write_checks
                )
                await session.commit()
        except Exception as e:
            failed += 1
            errors[company.ticker] = _error_text(e)
            logger.warning("fundamentals_ratios_failed", ticker=company.ticker, error=_error_text(e))
    priced = sum(1 for c in companies if (inputs.get(c.ticker) and inputs[c.ticker].price is not None))
    return {
        "companies": len(companies),
        "ratios_written": written,
        "failed": failed,
        "priced": priced,
        "errors": dict(list(errors.items())[:20]),
    }


# ---------------------------------------------------------------------------
# Store-first reads
# ---------------------------------------------------------------------------

@dataclass
class StoreState:
    """What the store holds for one ticker (loaded in one short session)."""

    ticker: str
    company: Company | None = None
    manifest: Manifest | None = None
    rows: list[FinancialStatement] = field(default_factory=list)
    facts: list[FinancialFact] = field(default_factory=list)

    @property
    def tracked(self) -> bool:
        return self.company is not None

    @property
    def refreshed_at(self) -> datetime | None:
        if self.manifest is not None and self.manifest.refreshed_at is not None:
            return self.manifest.refreshed_at
        return max((r.fetched_at for r in self.rows), default=None) if self.rows else None

    def is_fresh(self, max_age: timedelta, now: datetime) -> bool:
        refreshed = self.refreshed_at
        return refreshed is not None and now - refreshed <= max_age

    def recently_attempted(self, now: datetime) -> bool:
        """A refresh failed moments ago: readers serve the store instead of retrying the providers."""
        if self.manifest is None or self.manifest.last_attempt_ok:
            return False
        attempted = self.manifest.last_attempt_at
        return attempted is not None and now - attempted < _API_RETRY_COOLDOWN

    def sources(self) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        """Adapter payloads of the latest fetch (manifest periods; every stored period without one)."""
        kap_periods = self.manifest.periods(SOURCE_KAP) if self.manifest else None
        isy_periods = self.manifest.periods(SOURCE_ISYATIRIM) if self.manifest else None
        kap = fs.kap_summary_from_rows(self.rows, set(kap_periods) if kap_periods else None)
        isy = fs.isyatirim_table_from_rows(self.rows, set(isy_periods) if isy_periods else None)
        return kap, isy

    def meta(
        self, served_from: ServedFrom, *, stale: bool = False, notes: Sequence[str] = (), as_of: str | None = None
    ) -> DataMeta:
        sources = {r.source for r in self.rows}
        source = "+".join(s for s in (SOURCE_KAP, SOURCE_ISYATIRIM) if s in sources) or "kap+isyatirim"
        kap_url = self.manifest.source(SOURCE_KAP).get("source_url") if self.manifest else None
        kap_url = kap_url or next((r.source_url for r in self.rows if r.source == SOURCE_KAP and r.source_url), None)
        return DataMeta(
            source=source,
            fetched_at=self.refreshed_at or (self.manifest.last_success_at if self.manifest else None) or utcnow(),
            source_url=kap_url or ISYATIRIM_COMPANY_CARD_URL.format(ticker=self.ticker),
            as_of=as_of or next(iter(sort_periods_desc({r.period for r in self.rows})), None),
            served_from=served_from,
            stale=stale,
            notes=list(notes),
        )


async def load_store(
    ticker: str, *, with_facts: bool = False, session_factory: SessionFactory = async_session_factory
) -> StoreState:
    state = StoreState(ticker=ticker)
    async with session_factory() as session:
        repo = FundamentalsRepository(session)
        company = await repo.company_by_ticker(ticker)
        if company is None:
            return state
        state.company = company
        state.manifest = Manifest.from_row(ticker, (await repo.manifests([ticker])).get(ticker))
        state.rows = await repo.statement_rows(company.id)
        if with_facts:
            state.facts = await repo.facts(company.id)
    return state


def _live_meta(ticker: str, kap: Mapping[str, Any] | None, isy: Mapping[str, Any] | None, as_of: Any) -> DataMeta:
    source = "+".join(name for name, present in ((SOURCE_KAP, kap), (SOURCE_ISYATIRIM, isy)) if present) or SOURCE_KAP
    return DataMeta(
        source=source,
        fetched_at=utcnow(),
        source_url=(kap or {}).get("source_url") or ISYATIRIM_COMPANY_CARD_URL.format(ticker=ticker),
        as_of=str(as_of) if as_of else None,
        served_from="live",
    )


def _is_error(payload: Any) -> bool:
    return isinstance(payload, dict) and bool(payload.get("error"))


async def _live_sources(ticker: str, isy_wait: float) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Adapter sources within the view's latency budget; the full fetch is stored in the background."""
    return await asyncio.wait_for(
        fs._load_statement_sources(ticker, isy_wait=isy_wait), timeout=settings.fundamentals_live_timeout_seconds
    )


async def _store_first_view(
    ticker: str,
    *,
    build: Callable[[dict[str, Any] | None, dict[str, Any] | None], dict[str, Any]],
    isy_wait: float,
    message: str,
    event: str,
    session_factory: SessionFactory,
) -> dict[str, Any]:
    now = utcnow()
    max_age = timedelta(hours=settings.fundamentals_max_age_statements_hours)
    try:
        store = await load_store(ticker, session_factory=session_factory)
    except Exception as e:  # database down: behave like before (live only)
        logger.warning("fundamentals_store_unavailable", ticker=ticker, error=_error_text(e))
        store = StoreState(ticker=ticker)

    def from_store(served_from: ServedFrom, stale: bool, notes: Sequence[str] = ()) -> dict[str, Any]:
        kap, isy = store.sources()
        payload = build(kap, isy)
        return with_meta(payload, store.meta(served_from, stale=stale, notes=notes, as_of=payload.get("as_of")))

    if store.rows and store.is_fresh(max_age, now):
        return from_store("store", False)
    if store.rows and store.recently_attempted(now):
        return from_store("stale", True, [_STALE_NOTE])
    try:
        if store.tracked:
            start_background_refresh(ticker, session_factory)
        kap, isy = await _live_sources(ticker, isy_wait)
        payload = build(kap, isy)
        return with_meta(payload, _live_meta(ticker, kap, isy, payload.get("as_of")))
    except SymbolNotFoundError as e:
        if store.rows:
            return from_store("stale", True, [_STALE_NOTE])
        return _failure(e, message, event, ticker, data=[])
    except Exception as e:
        if store.rows:
            logger.info("fundamentals_served_stale", ticker=ticker, error=_error_text(e))
            return from_store("stale", True, [_STALE_NOTE])
        return _failure(e, message, event, ticker, data=[])


async def get_statement_view(
    ticker: str,
    *,
    section: str,
    quarterly: bool = False,
    session_factory: SessionFactory = async_session_factory,
) -> dict[str, Any]:
    """``/fundamentals/{t}/balance-sheet`` (``section="balance"``) and ``/income-statement`` (``"income"``)."""
    ticker = ticker.strip().upper()

    def build(kap: dict[str, Any] | None, isy: dict[str, Any] | None) -> dict[str, Any]:
        return fs.build_statement_view(ticker, kap, isy, quarterly=quarterly, section=section)

    return await _store_first_view(
        ticker,
        build=build,
        isy_wait=fs._ISY_WAIT_STATEMENTS if quarterly else 0.0,
        message=_MSG_STATEMENTS,
        event="fundamentals_balance_sheet_error" if section == "balance" else "fundamentals_income_stmt_error",
        session_factory=session_factory,
    )


async def get_cashflow_view(
    ticker: str, *, quarterly: bool = False, session_factory: SessionFactory = async_session_factory
) -> dict[str, Any]:
    """``/fundamentals/{t}/cashflow``."""
    ticker = ticker.strip().upper()

    def build(kap: dict[str, Any] | None, isy: dict[str, Any] | None) -> dict[str, Any]:
        return fs.build_cashflow_view(ticker, kap, isy, quarterly=quarterly)

    return await _store_first_view(
        ticker,
        build=build,
        isy_wait=fs._ISY_WAIT_RATIOS,
        message=_MSG_CASHFLOW,
        event="fundamentals_cashflow_error",
        session_factory=session_factory,
    )


def _facts_sources_label(sources: Mapping[str, Mapping[str, Any]]) -> list[str]:
    used: set[str] = set()
    for summary in sources.values():
        for key, value in summary.items():
            if key in ("balance", "income", "cashflow") and isinstance(value, str):
                used.update(value.split("+"))
    return [label for code, label in ((SOURCE_KAP, fs._SOURCE_KAP), (SOURCE_ISYATIRIM, fs._SOURCE_ISY)) if code in used]


async def _market_snapshot(ticker: str, company: Company | None, session_factory: SessionFactory) -> dict[str, Any]:
    """Live price snapshot; the stored quote when the live one fails (shares then come from the capital)."""
    snapshot = await fs.live_market_snapshot(ticker)
    if snapshot.get("last_price") is not None or company is None:
        return snapshot
    try:
        async with session_factory() as session:
            quote = (await FundamentalsRepository(session).quotes([ticker])).get(ticker)
    except Exception:
        return snapshot
    last = to_number(getattr(quote, "last", None)) if quote is not None else None
    return {"last_price": last} if last is not None else snapshot


async def get_live_ratios_view(
    ticker: str, *, session_factory: SessionFactory = async_session_factory
) -> dict[str, Any]:
    """``/fundamentals/{t}/live-ratios``: stored facts (fresh) + live price; live statements otherwise."""
    ticker = ticker.strip().upper()
    now = utcnow()
    max_age = timedelta(hours=settings.fundamentals_max_age_statements_hours)
    try:
        store = await load_store(ticker, with_facts=True, session_factory=session_factory)
    except Exception as e:
        logger.warning("fundamentals_store_unavailable", ticker=ticker, error=_error_text(e))
        store = StoreState(ticker=ticker)

    async def from_store(served_from: ServedFrom, stale: bool, notes: Sequence[str] = ()) -> dict[str, Any]:
        assert store.company is not None
        items, sources = facts_by_period(store.facts)
        fy = int(store.facts[0].fiscal_year_end_month or 12)
        template = store.facts[0].template or store.company.statement_template or "industrial"
        snapshot = await _market_snapshot(ticker, store.company, session_factory)
        payload = fs.build_live_ratios_view(
            ticker, items, template=template, fiscal_year_end_month=fy, snapshot=snapshot,
            sources=_facts_sources_label(sources) or [fs._SOURCE_KAP],
        )
        return with_meta(payload, store.meta(served_from, stale=stale, notes=notes, as_of=payload.get("as_of")))

    if store.facts and store.is_fresh(max_age, now):
        return await from_store("store", False)
    if store.facts and store.recently_attempted(now):
        return await from_store("stale", True, [_STALE_NOTE])
    try:
        if store.tracked:
            start_background_refresh(ticker, session_factory)
        kap, isy = await _live_sources(ticker, fs._ISY_WAIT_RATIOS)
        facts = fs.facts_from_sources(kap, isy)
        snapshot = await fs.live_market_snapshot(ticker)
        payload = fs.build_live_ratios_view(
            ticker, facts.items, template=facts.template, fiscal_year_end_month=facts.fiscal_year_end_month,
            snapshot=snapshot,
            sources=[s for s, present in ((fs._SOURCE_KAP, kap), (fs._SOURCE_ISY, isy)) if present],
        )
        return with_meta(payload, _live_meta(ticker, kap, isy, payload.get("as_of")))
    except Exception as e:
        if store.facts:
            logger.info("fundamentals_ratios_served_stale", ticker=ticker, error=_error_text(e))
            return await from_store("stale", True, [_STALE_NOTE])
        return _failure(e, _MSG_RATIOS, "live_ratios_error", ticker, ratios=None)


# ---------------------------------------------------------------------------
# /financials and /financials/ratios (store-first lists)
# ---------------------------------------------------------------------------

DATA_META_HEADER = "X-Data-Meta"


def meta_header(meta: DataMeta) -> str:
    """``X-Data-Meta`` header value (list endpoints cannot carry a ``meta`` key)."""
    return json.dumps(meta.to_dict(), ensure_ascii=True, separators=(",", ":"), default=str)


async def statements_for_api(
    session: AsyncSession,
    company: Company,
    *,
    statement_type: str | None = None,
    source: str | None = None,
    session_factory: SessionFactory = async_session_factory,
) -> tuple[list[FinancialStatement], DataMeta]:
    """Stored statement rows, refreshed first when stale (bounded wait; stale rows on failure)."""
    ticker, company_id = company.ticker, company.id  # ``company`` is expired after a refresh
    repo = FundamentalsRepository(session)
    manifest = Manifest.from_row(ticker, (await repo.manifests([ticker])).get(ticker))
    rows = await repo.statement_rows(company_id)
    state = StoreState(ticker=ticker, company=company, manifest=manifest, rows=rows)
    now = utcnow()
    served_from: ServedFrom = "store"
    stale, notes = False, list[str]()
    if not state.is_fresh(timedelta(hours=settings.fundamentals_max_age_statements_hours), now):
        if rows and state.recently_attempted(now):
            served_from, stale, notes = "stale", True, [_STALE_NOTE]
        else:
            await session.commit()  # end the read transaction: no connection held while waiting
            try:
                result = await asyncio.wait_for(
                    refresh_company_statements(ticker, session_factory=session_factory),
                    timeout=settings.fundamentals_live_timeout_seconds,
                )
                if not result.ok:
                    raise MarketDataError(_MSG_STATEMENTS, status_code=503)
                served_from = "live"
                session.expire_all()  # rows written by the refresh session must be re-read, not the identity map
                state.manifest = Manifest.from_row(ticker, (await repo.manifests([ticker])).get(ticker))
                state.rows = await repo.statement_rows(company_id)
            except Exception as e:
                logger.info("fundamentals_financials_stale", ticker=ticker, error=_error_text(e))
                served_from, stale, notes = "stale", True, [_STALE_NOTE]
    selected = [
        r for r in state.rows
        if (statement_type is None or r.statement_type == statement_type) and (source is None or r.source == source)
    ]
    return selected, state.meta(served_from, stale=stale, notes=notes)


async def ratios_for_api(
    session: AsyncSession,
    company: Company,
    *,
    basis: str | None = None,
    session_factory: SessionFactory = async_session_factory,
) -> tuple[list[FinancialRatio], DataMeta]:
    """Stored ratio rows; recomputed (statements refreshed if needed) when older than the ratio max age."""
    ticker, company_id = company.ticker, company.id  # ``company`` is expired after a refresh
    repo = FundamentalsRepository(session)
    rows = await repo.ratio_rows(company_id)
    manifest = Manifest.from_row(ticker, (await repo.manifests([ticker])).get(ticker))
    now = utcnow()
    calculated = max((r.calculated_at for r in rows), default=None)
    served_from: ServedFrom = "store"
    stale, notes = False, list[str]()
    if calculated is None or now - calculated > timedelta(hours=settings.fundamentals_max_age_ratios_hours):
        await session.commit()  # end the read transaction: no connection held while waiting
        try:
            async def recompute() -> None:
                result = await refresh_company_statements(
                    ticker,
                    max_age=timedelta(hours=settings.fundamentals_max_age_statements_hours),
                    session_factory=session_factory,
                )
                if result.skipped == "fresh" or not result.ok:
                    await recompute_ratios([ticker], session_factory=session_factory)

            await asyncio.wait_for(asyncio.shield(recompute()), timeout=settings.fundamentals_live_timeout_seconds)
            session.expire_all()  # re-read what the recompute session wrote
            rows = await repo.ratio_rows(company_id)
            served_from = "live"
            if not rows:
                served_from, stale, notes = "stale", True, [_STALE_NOTE]
        except Exception as e:
            logger.info("fundamentals_ratios_stale", ticker=ticker, error=_error_text(e))
            session.expire_all()
            rows = await repo.ratio_rows(company_id)
            served_from, stale, notes = "stale", True, [_STALE_NOTE]
    selected = [r for r in rows if basis is None or r.basis == basis]
    latest_calc = max((r.calculated_at for r in selected), default=None)
    meta = DataMeta(
        source="kap+isyatirim",
        fetched_at=latest_calc or now,
        source_url=manifest.source(SOURCE_KAP).get("source_url") or ISYATIRIM_COMPANY_CARD_URL.format(ticker=ticker),
        as_of=next(iter(sort_periods_desc({r.period for r in selected})), None),
        served_from=served_from,
        stale=stale,
        notes=notes,
    )
    return selected, meta


# ---------------------------------------------------------------------------
# Batch refresh (worker / admin)
# ---------------------------------------------------------------------------

async def due_companies(
    *,
    now: datetime | None = None,
    limit: int | None = None,
    tickers: Sequence[str] | None = None,
    force: bool = False,
    session_factory: SessionFactory = async_session_factory,
) -> list[Company]:
    """Companies whose statements should be refreshed now (core first, oldest refresh first)."""
    now = now or utcnow()
    async with session_factory() as session:
        repo = FundamentalsRepository(session)
        companies = await repo.companies(tickers=tickers, active_only=tickers is None)
        manifests = await repo.manifests([c.ticker for c in companies])
    retry = timedelta(hours=settings.fundamentals_retry_failed_hours)
    due: list[tuple[int, datetime, Company]] = []
    for company in companies:
        manifest = Manifest.from_row(company.ticker, manifests.get(company.ticker))
        cadence = timedelta(
            hours=settings.fundamentals_refresh_core_hours
            if company.tracking_tier == "core"
            else settings.fundamentals_refresh_universe_hours
        )
        if force or refresh_due(manifest, now, cadence, retry):
            oldest = manifest.refreshed_at or datetime.min.replace(tzinfo=now.tzinfo)
            due.append((0 if company.tracking_tier == "core" else 1, oldest, company))
    due.sort(key=lambda item: (item[0], item[1], item[2].ticker))
    selected = [company for _, _, company in due]
    return selected[:limit] if limit is not None else selected


async def refresh_many(
    companies: Sequence[Company],
    *,
    force: bool = False,
    compute_ratios: bool = True,
    stop: asyncio.Event | None = None,
    session_factory: SessionFactory = async_session_factory,
) -> list[RefreshResult]:
    """Refresh ``companies`` (KAP serialised by the gate, İş Yatırım ≤ FUNDAMENTALS_ISY_CONCURRENCY)."""
    market = await load_market_inputs([c.ticker for c in companies]) if compute_ratios and companies else {}
    workers = max(1, settings.fundamentals_isy_concurrency)
    queue: asyncio.Queue[Company] = asyncio.Queue()
    for company in companies:
        queue.put_nowait(company)
    results: list[RefreshResult] = []

    async def worker() -> None:
        while not queue.empty():
            if stop is not None and stop.is_set():
                return
            company = queue.get_nowait()
            try:
                results.append(
                    await refresh_company_statements(
                        company.ticker,
                        compute_ratios=compute_ratios,
                        market=market.get(company.ticker),
                        session_factory=session_factory,
                    )
                )
            except Exception as e:
                logger.warning("fundamentals_refresh_error", ticker=company.ticker, error=_error_text(e))
                results.append(RefreshResult(ticker=company.ticker, kap_error=_error_text(e)))

    await asyncio.gather(*(worker() for _ in range(min(workers, len(companies)) or 1)))
    return results


def kap_requests_made() -> int:
    """KAP page requests sent by this process (the gate's counter; for run details)."""
    return kap_gate.requests


__all__ = [
    "DATA_META_HEADER",
    "Manifest",
    "MarketInputs",
    "RefreshResult",
    "StoreState",
    "compute_company_ratios",
    "due_companies",
    "fetch_sources",
    "get_cashflow_view",
    "get_live_ratios_view",
    "get_statement_view",
    "kap_vs_isy_checks",
    "load_market_inputs",
    "load_store",
    "meta_header",
    "persist_refresh",
    "published_dates",
    "ratios_for_api",
    "rebuild_from_store",
    "recompute_ratios",
    "refresh_company_statements",
    "refresh_due",
    "refresh_many",
    "shares_check",
    "statements_for_api",
]
