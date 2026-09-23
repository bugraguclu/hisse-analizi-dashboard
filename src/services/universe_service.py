"""Şirket evreni senkronizasyonu (``universe.sync``) — TradingView + Borsa İstanbul + KAP.

Bir çalıştırma:

1. Kaynakları paralel çeker (:func:`src.adapters.bist_reference.fetch_universe_sources`):
   TradingView tüm piyasa taraması, Borsa İstanbul endeks bileşen dosyası, KAP şirket /
   sektör / pazar dizinleri. Başarısız kaynak kaydedilir, çalıştırma ``partial`` olur.
2. Evreni birleştirir (:func:`~src.adapters.bist_reference.build_universe`) ve mevcut
   ``companies`` satırlarına göre bir plan çıkarır (:func:`plan_universe`):

   * ``tracking_tier``: XU100 bileşeni (resmî dosyadan) + ``REFERENCE_EXTRA_CORE_TICKERS`` →
     ``core``, diğerleri ``universe``. Dosya alınamadıysa/şüpheliyse mevcut kademe korunur.
   * Hiçbir kaynakta görünmeyen şirket silinmez: ``listing_status='delisted'``,
     ``is_active=false``. Yalnızca TradingView ve endeks dosyası ikisi de sağlıklıysa ve
     kaybolan sayı makul sınırdaysa (``max(10, %5)``) uygulanır — kısmi bir kaynak yanıtı
     evrenin yarısını "borsadan çıkmış" saymasın.
   * Tekrar görünen şirket yeniden ``listed``/aktif olur.
   * Kaynak alanı boş gelirse mevcut değer silinmez (ör. KAP düştüğünde sektör kalır).
   * ``free_float_pct`` TradingView'den yalnızca şirket için henüz resmî (KAP/MKK) değer
     yazılmamışsa (``reference_updated_at`` boş) yazılır.

3. ``market_indices`` ve ``index_memberships`` her çalıştırmada resmî dosyadan tamamen
   yenilenir (tek transaction).
4. Çapraz kaynak kontrollerini ``data_quality_checks`` tablosuna yazar: XU100 üyeliği
   (dosya ↔ TradingView ↔ önceki çekirdek), tüm endeks üyelikleri, evren kapsamı ve
   ISIN Türkiye (MKK) örneklemi.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any

import structlog
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.bist_reference import (
    IndexFile,
    TvSecurity,
    UniverseEntry,
    UniverseSources,
    build_universe,
    fetch_universe_sources,
)
from src.adapters.fundamentals_reference import to_decimal
from src.adapters.utils import MarketDataError, run_sync
from src.core.config import settings, split_csv
from src.core.time import utcnow
from src.db.models import DataQualityCheck, IngestionRun
from src.db.repositories.reference import CompanyState, UniverseRepository, quality_check
from src.db.session import async_session_factory
from src.services.ingestion import run_job

logger = structlog.get_logger(__name__)

JOB_UNIVERSE_SYNC = "universe.sync"
CORE_INDEX = "XU100"

# Sanity bounds: below these a source answer is treated as partial.
MIN_TRADINGVIEW_EQUITIES = 400
MIN_INDEX_FILE_TICKERS = 400
CORE_INDEX_BOUNDS = (90, 110)
DELIST_MIN_CAP = 10
DELIST_MAX_FRACTION = 0.05
_DETAIL_LIST_LIMIT = 60


def extra_core_tickers() -> set[str]:
    return {t.strip().upper() for t in split_csv(settings.reference_extra_core_tickers)}


@dataclass
class UniversePlan:
    inserts: list[dict[str, Any]] = field(default_factory=list)
    updates: list[dict[str, Any]] = field(default_factory=list)
    delisted: list[str] = field(default_factory=list)
    reactivated: list[str] = field(default_factory=list)
    promoted: list[str] = field(default_factory=list)  # universe → core
    demoted: list[str] = field(default_factory=list)   # core → universe
    renamed: dict[str, str] = field(default_factory=dict)  # vanished ticker → ticker with the same ISIN/OID
    missing: list[str] = field(default_factory=list)   # active rows absent from every source
    delisting_skipped: str | None = None
    notes: list[str] = field(default_factory=list)


def _tier_for(ticker: str, core_set: set[str] | None, extra_core: set[str], state: CompanyState | None) -> str:
    if core_set is None:  # index file unavailable/implausible: keep what we had
        if state is not None:
            return state.tracking_tier
        return "core" if ticker in extra_core else "universe"
    return "core" if ticker in core_set or ticker in extra_core else "universe"


def plan_universe(
    entries: Iterable[UniverseEntry],
    existing: Mapping[str, CompanyState],
    *,
    now: datetime,
    core_set: set[str] | None,
    sources_complete: bool,
    extra_core: set[str] | None = None,
    official_titles: set[str] | None = None,
    listed_elsewhere: set[str] | None = None,
) -> UniversePlan:
    """Pure transition rules (see module docstring); no I/O.

    ``official_titles``: tickers whose ``legal_name`` is the KAP title — only those
    overwrite an existing legal name (a TradingView description never does).
    ``listed_elsewhere``: tickers still traded but outside the equity universe
    (ETFs, certificates); an existing row for them is left untouched, never delisted.
    """
    extra = extra_core or set()
    official = official_titles or set()
    plan = UniversePlan()
    seen: set[str] = set()
    by_isin: dict[str, str] = {}
    by_oid: dict[str, str] = {}
    for entry in entries:
        seen.add(entry.ticker)
        if entry.isin:
            by_isin.setdefault(entry.isin, entry.ticker)
        if entry.kap_member_oid:
            by_oid.setdefault(entry.kap_member_oid, entry.ticker)
        state = existing.get(entry.ticker)
        tier = _tier_for(entry.ticker, core_set, extra, state)
        values: dict[str, Any] = {
            "exchange": "BIST",
            "security_type": entry.security_type,
            "listing_status": "listed",
            "tracking_tier": tier,
            "is_active": True,
            "last_seen_at": now,
        }
        enrich = {
            "isin": entry.isin,
            "kap_member_oid": entry.kap_member_oid,
            "sector": entry.sector,
            "industry": entry.industry,
            "market_segment": entry.market_segment,
        }
        if state is None:
            values.update(enrich)
            values.update({
                "id": uuid.uuid4(),
                "ticker": entry.ticker,
                "legal_name": entry.legal_name,
                "display_name": entry.display_name,
                "aliases": [entry.ticker, entry.display_name],
                "free_float_pct": to_decimal(entry.free_float_pct, 2),
            })
            plan.inserts.append(values)
            if tier == "core":
                plan.promoted.append(entry.ticker)
            continue
        values["id"] = state.id
        values.update({k: v for k, v in enrich.items() if v is not None})  # never erase a known value
        if entry.ticker in official and entry.legal_name and entry.legal_name != state.legal_name:
            values["legal_name"] = entry.legal_name
        if state.reference_updated_at is None and entry.free_float_pct is not None:
            values["free_float_pct"] = to_decimal(entry.free_float_pct, 2)
        plan.updates.append(values)
        if state.tracking_tier != tier:
            (plan.promoted if tier == "core" else plan.demoted).append(entry.ticker)
        if state.listing_status != "listed" or not state.is_active:
            plan.reactivated.append(entry.ticker)

    active = [s for s in existing.values() if s.is_active or s.listing_status != "delisted"]
    elsewhere = listed_elsewhere or set()
    plan.missing = sorted(s.ticker for s in active if s.ticker not in seen and s.ticker not in elsewhere)
    for ticker in plan.missing:
        state = existing[ticker]
        successor = (by_isin.get(state.isin) if state.isin else None) or (
            by_oid.get(state.kap_member_oid) if state.kap_member_oid else None
        )
        if successor and successor != ticker:
            plan.renamed[ticker] = successor
    limit = max(DELIST_MIN_CAP, int(len(active) * DELIST_MAX_FRACTION))
    if not plan.missing:
        return plan
    if not sources_complete:
        plan.delisting_skipped = "kaynaklar eksik: TradingView veya endeks dosyası alınamadı"
    elif len(plan.missing) > limit:
        plan.delisting_skipped = f"{len(plan.missing)} şirket kayboldu (sınır {limit}); kaynak yanıtı şüpheli"
    if plan.delisting_skipped:
        plan.notes.append(f"Borsadan çıkarma atlandı: {plan.delisting_skipped}")
        return plan
    for ticker in plan.missing:
        state = existing[ticker]
        plan.updates.append({
            "id": state.id,
            "listing_status": "delisted",
            "is_active": False,
            "tracking_tier": "universe" if core_set is not None else state.tracking_tier,
        })
        plan.delisted.append(ticker)
        if state.tracking_tier == "core" and core_set is not None:
            plan.demoted.append(ticker)
    return plan


def _core_set(index_file: IndexFile | None, notes: list[str]) -> set[str] | None:
    if index_file is None:
        return None
    members = index_file.members(CORE_INDEX)
    low, high = CORE_INDEX_BOUNDS
    if not low <= len(members) <= high:
        notes.append(f"{CORE_INDEX} üye sayısı şüpheli ({len(members)}); çekirdek kademe değiştirilmedi")
        return None
    return members


def _equities(tv: Mapping[str, TvSecurity] | None) -> dict[str, TvSecurity]:
    return {t: s for t, s in (tv or {}).items() if (s.type or "").lower() == "stock"}


def _index_file_ok(index_file: IndexFile | None) -> bool:
    return index_file is not None and len(index_file.tickers()) >= MIN_INDEX_FILE_TICKERS


def _limited(values: Iterable[str]) -> list[str]:
    items = sorted(values)
    return items[:_DETAIL_LIST_LIMIT] + ([f"... +{len(items) - _DETAIL_LIST_LIMIT}"] if len(items) > _DETAIL_LIST_LIMIT else [])


async def apply_universe(
    session: AsyncSession,
    sources: UniverseSources,
    *,
    now: datetime,
    extra_core: set[str] | None = None,
) -> dict[str, Any]:
    """Write the merged universe + index memberships (caller commits). Returns the run summary."""
    entries, skipped = build_universe(sources)
    notes: list[str] = []
    core_set = _core_set(sources.index_file, notes)
    tv_ok = len(_equities(sources.tradingview)) >= MIN_TRADINGVIEW_EQUITIES
    index_ok = _index_file_ok(sources.index_file)
    kap = sources.kap
    official = {e.ticker for e in entries if kap is not None and kap.title(e.ticker)}

    repo = UniverseRepository(session)
    existing = await repo.company_states()
    previous_core = {t for t, s in existing.items() if s.tracking_tier == "core" and s.is_active}
    plan = plan_universe(
        entries,
        existing,
        now=now,
        core_set=core_set,
        sources_complete=tv_ok and index_ok,
        extra_core=extra_core if extra_core is not None else extra_core_tickers(),
        official_titles=official,
        listed_elsewhere=set(skipped),
    )
    notes.extend(plan.notes)
    inserted = await repo.insert_companies(plan.inserts)
    updated = await repo.update_companies(plan.updates)

    indices_written = memberships_written = 0
    index_file = sources.index_file
    if index_file is not None and index_ok and core_set is not None:
        ids = {t: s.id for t, s in (await repo.company_states()).items()}
        indices = [
            {"code": info.code, "name_tr": info.name_tr, "name_en": info.name_en, "as_of": index_file.as_of,
             "fetched_at": now}
            for info in index_file.indices.values()
        ]
        memberships = [
            {"index_code": c.index_code, "ticker": c.ticker, "company_id": ids.get(c.ticker),
             "as_of": index_file.as_of, "source": "borsaistanbul", "fetched_at": now}
            for c in index_file.constituents
        ]
        indices_written, memberships_written = await repo.replace_indices(indices, memberships)
    else:
        notes.append("Endeks üyelikleri güncellenmedi (dosya alınamadı veya şüpheli)")

    source_counts: dict[str, Any] = {
        "tradingview_rows": len(sources.tradingview or {}),
        "tradingview_equities": len(_equities(sources.tradingview)),
        "index_file_rows": len(index_file.constituents) if index_file else 0,
        "index_file_tickers": len(index_file.tickers()) if index_file else 0,
        "index_file_as_of": index_file.as_of.isoformat() if index_file and index_file.as_of else None,
        "kap_members": len(kap.members) if kap else 0,
        "kap_sectors": len(kap.sectors) if kap else 0,
        "kap_markets": len(kap.markets) if kap else 0,
    }
    security_types: dict[str, int] = {}
    for e in entries:
        security_types[e.security_type] = security_types.get(e.security_type, 0) + 1
    return {
        "universe": len(entries),
        "security_types": security_types,
        "core": sorted(core_set) if core_set is not None else None,
        "previous_core": sorted(previous_core),
        "inserted": inserted,
        "updated": updated,
        "delisted": plan.delisted,
        "missing": plan.missing,
        "reactivated": plan.reactivated,
        "promoted": plan.promoted,
        "demoted": plan.demoted,
        "renamed": plan.renamed,
        "delisting_skipped": plan.delisting_skipped,
        "skipped_non_equity": skipped,
        "indices": indices_written,
        "memberships": memberships_written,
        "sources": source_counts,
        "source_errors": dict(sources.errors),
        "notes": notes,
    }


# ---------------------------------------------------------------------------
# Cross-source checks (data_quality_checks)
# ---------------------------------------------------------------------------

def _status(deviation: int, *, warn_up_to: int) -> str:
    if deviation == 0:
        return "pass"
    return "warn" if deviation <= warn_up_to else "fail"


def universe_checks(
    sources: UniverseSources,
    entries: list[UniverseEntry],
    previous_core: set[str],
    skipped: Mapping[str, str],
) -> list[DataQualityCheck]:
    """XU100 membership (file ↔ TradingView ↔ previous core), all index memberships, coverage."""
    checks: list[DataQualityCheck] = []
    index_file = sources.index_file
    tv = _equities(sources.tradingview)
    funds = {t: s for t, s in (sources.tradingview or {}).items() if t not in tv}
    if index_file is not None and tv:
        csv_core = index_file.members(CORE_INDEX)
        tv_core = {t for t, s in (sources.tradingview or {}).items() if CORE_INDEX in s.index_codes}
        diff = csv_core ^ tv_core
        checks.append(quality_check(
            "reference.xu100_membership", _status(len(diff), warn_up_to=2), subject=CORE_INDEX,
            expected=len(csv_core), actual=len(tv_core), deviation=len(diff),
            details={"reference": "borsaistanbul", "compared": "tradingview",
                     "as_of": index_file.as_of.isoformat() if index_file.as_of else None,
                     "index_file_only": sorted(csv_core - tv_core), "tradingview_only": sorted(tv_core - csv_core)},
        ))
        tv_by_index: dict[str, set[str]] = {}
        for ticker, security in (sources.tradingview or {}).items():
            for code in security.index_codes:
                tv_by_index.setdefault(code, set()).add(ticker)
        csv_codes = set(index_file.indices)
        common = sorted(csv_codes & set(tv_by_index))
        carried = set(sources.tradingview or {})
        mismatches: dict[str, Any] = {}
        not_carried: set[str] = set()
        worst = 0.0
        for code in common:
            # Constituents TradingView does not carry at all (ISATR) are a coverage gap,
            # reported separately — only securities present in both sources are compared.
            csv_all = index_file.members(code)
            not_carried |= csv_all - carried
            csv_members, tv_members = csv_all & carried, tv_by_index[code]
            if csv_members == tv_members:
                continue
            share = len(csv_members ^ tv_members) / max(len(csv_members), 1)
            worst = max(worst, share)
            mismatches[code] = {
                "index_file": len(csv_members), "tradingview": len(tv_members),
                "index_file_only": sorted(csv_members - tv_members)[:20],
                "tradingview_only": sorted(tv_members - csv_members)[:20],
            }
        status = "pass" if not mismatches else ("warn" if worst <= 0.05 else "fail")
        checks.append(quality_check(
            "reference.index_membership", status, subject="all",
            expected=len(common), actual=len(common) - len(mismatches), deviation=len(mismatches),
            details={"mismatches": mismatches, "worst_share": round(worst, 4),
                     "constituents_compared": len(set().union(*(index_file.members(c) for c in common)) & carried)
                     if common else 0,
                     "not_on_tradingview": sorted(not_carried),
                     "index_file_only_indices": sorted(csv_codes - set(tv_by_index)),
                     "tradingview_only_indices": sorted(set(tv_by_index) - csv_codes)},
        ))
    if index_file is not None and previous_core:
        csv_core = index_file.members(CORE_INDEX)
        diff = csv_core ^ previous_core
        checks.append(quality_check(
            "reference.xu100_vs_core", "pass" if not diff else "warn", subject=CORE_INDEX,
            expected=len(csv_core), actual=len(previous_core), deviation=len(diff),
            details={"left_index": sorted(previous_core - csv_core), "joined_index": sorted(csv_core - previous_core)},
        ))
    if entries:
        entry_tickers = {e.ticker for e in entries}
        csv_tickers = index_file.tickers() if index_file else set()
        without_kap = sorted(e.ticker for e in entries if not e.kap_member_oid)
        without_isin = sorted(e.ticker for e in entries if not e.isin)
        checks.append(quality_check(
            "reference.universe_coverage", "pass" if len(without_kap) <= len(entries) * 0.01 else "warn",
            subject="all", expected=len(tv) + len(funds), actual=len(entries), deviation=len(without_kap),
            details={
                "tradingview_only": _limited(entry_tickers & (set(tv) - csv_tickers)),
                "index_file_only": _limited(csv_tickers - set(tv) - set(funds)),
                "without_kap": _limited(without_kap),
                "without_isin": _limited(without_isin),
                "skipped_non_equity": dict(sorted(skipped.items())[:_DETAIL_LIST_LIMIT]),
            },
        ))
    return checks


def _isin_lookup_sync(ticker: str) -> str | None:
    from borsapy._providers.isin import get_isin_provider

    value = get_isin_provider().get_isin(ticker)
    return str(value).strip().upper() if value else None


def isin_sample(entries: list[UniverseEntry], core: set[str] | None, size: int, day_of_year: int) -> list[UniverseEntry]:
    """A rotating daily sample of core companies with a known ISIN."""
    pool = sorted((e for e in entries if e.isin and (core is None or e.ticker in core)), key=lambda e: e.ticker)
    if not pool or size <= 0:
        return []
    start = (day_of_year * size) % len(pool)
    rotated = pool[start:] + pool[:start]
    return rotated[:size]


async def isin_checks(sample: list[UniverseEntry], *, timeout: float = 20.0) -> list[DataQualityCheck]:
    """TradingView ISIN vs the official ISIN registry (ISIN Türkiye, run by MKK)."""
    checks: list[DataQualityCheck] = []
    for entry in sample:
        try:
            official = await asyncio.wait_for(run_sync(_isin_lookup_sync, entry.ticker), timeout)
        except Exception as e:  # registry down / slow: record, do not fail the sync
            logger.info("isin_lookup_failed", ticker=entry.ticker, error=f"{type(e).__name__}: {e}")
            official = None
        if official is None:
            status = "warn"
        else:
            status = "pass" if official == entry.isin else "fail"
        checks.append(quality_check(
            "reference.isin_match", status, subject=entry.ticker,
            details={"stored": entry.isin, "stored_source": "tradingview", "reference": official,
                     "reference_source": "isinturkiye.com.tr (MKK)"},
        ))
    return checks


# ---------------------------------------------------------------------------
# Job
# ---------------------------------------------------------------------------

async def last_successful_sync(session: AsyncSession) -> datetime | None:
    row = (
        await session.execute(
            select(IngestionRun.finished_at)
            .where(IngestionRun.job == JOB_UNIVERSE_SYNC, IngestionRun.status.in_(("ok", "partial")),
                   IngestionRun.finished_at.is_not(None))
            .order_by(desc(IngestionRun.finished_at))
            .limit(1)
        )
    ).scalar_one_or_none()
    return row


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(v) for v in value]
    if isinstance(value, (datetime,)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


async def sync_universe(*, with_checks: bool = True) -> dict[str, Any]:
    """Run ``universe.sync`` once (fetch → merge → write → checks) inside :func:`run_job`."""
    async with run_job(JOB_UNIVERSE_SYNC, scope="all") as run:
        sources = await fetch_universe_sources()
        if sources.tradingview is None and sources.index_file is None:
            raise MarketDataError("Şirket evreni kaynaklarına ulaşılamadı", status_code=503)
        now = utcnow()
        async with async_session_factory() as session:
            summary = await apply_universe(session, sources, now=now)
            await session.commit()
            check_rows = 0
            if with_checks:
                try:
                    entries, skipped = build_universe(sources)
                    checks = universe_checks(sources, entries, set(summary["previous_core"]), skipped)
                    core = set(summary["core"]) if summary["core"] is not None else None
                    sample = isin_sample(entries, core, settings.reference_isin_sample_size, now.timetuple().tm_yday)
                    checks.extend(await isin_checks(sample))
                    session.add_all(checks)
                    await session.commit()
                    check_rows = len(checks)
                    summary["checks"] = {c.check_name + (f":{c.subject}" if c.subject else ""): c.status for c in checks}
                except Exception as e:  # quality bookkeeping never fails the sync itself
                    await session.rollback()
                    logger.warning("universe_checks_failed", error=f"{type(e).__name__}: {e}")
            summary["check_rows"] = check_rows
        run.items_total = summary["universe"]
        run.items_ok = summary["inserted"] + summary["updated"]
        run.items_failed = len(summary["source_errors"])  # any failed source marks the run partial
        details = dict(summary)
        details["core"] = len(summary["core"]) if summary["core"] is not None else None
        details["previous_core"] = len(summary["previous_core"])
        details["skipped_non_equity"] = len(summary["skipped_non_equity"])
        run.details = _json_safe(details)
    logger.info(
        "universe_synced",
        universe=summary["universe"],
        inserted=summary["inserted"],
        delisted=len(summary["delisted"]),
        promoted=len(summary["promoted"]),
        demoted=len(summary["demoted"]),
        errors=summary["source_errors"],
    )
    return summary
