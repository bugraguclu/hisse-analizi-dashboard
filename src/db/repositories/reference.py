"""Referans verisi deposu (WS1) — şirket evreni, endeks üyelikleri ve şirket başına referans kümeleri.

Kolon sahipliği (``docs/data-platform.md`` §3): ``companies`` tablosunda yalnızca kimlik ve
referans kolonları yazılır (``COMPANY_REFERENCE_COLUMNS``); WS3'ün
``fiscal_year_end_month`` / ``statement_template`` / ``paid_in_capital`` kolonlarına ve
küratörlü ``display_name`` / ``aliases`` değerlerine mevcut satırlarda dokunulmaz. Tam satır
upsert yoktur: yeni şirketler ``INSERT ... ON CONFLICT DO NOTHING``, mevcutlar birincil anahtara
göre toplu ``UPDATE`` ile yazılır.

Referans kümelerinin yazım kuralları:

* ``dividends`` / ``capital_increases`` — upsert; kaynak boş olmayan bir liste döndürdüğünde o
  şirket+kaynak için listede artık bulunmayan satırlar silinir (düzeltmeler doğal anahtarı
  değiştirir: aynı günün düzeltilmiş brüt oranı eski satırı yetim bırakmasın). Boş liste mevcut
  satırlara dokunmaz.
* ``shareholders`` — şirket+kaynak için her yenilemede tamamen değiştirilir; sağlayıcı sırası
  ``fetched_at``'e eklenen mikro saniyelerle korunur (tabloda sıra kolonu yok).
* ``analyst_targets`` — (şirket, kaynak) başına tek satır upsert.
* ``expected_disclosures`` — upsert; bugün hâlâ açık olup yeni yanıtta bulunmayan pencereler
  silinir, geçmiş pencereler tarihçe olarak kalır.
"""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import delete, func, insert, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.bist_reference import ExpectedDisclosureRecord
from src.adapters.fundamentals_reference import (
    CapitalIncreaseRecord,
    DividendRecord,
    HolderRecord,
    to_decimal,
)
from src.db.models import (
    AnalystTarget,
    CapitalIncrease,
    Company,
    DataQualityCheck,
    Dividend,
    ExpectedDisclosure,
    IndexMembership,
    IngestionRun,
    MarketIndex,
    Shareholder,
)

# Columns of ``companies`` this workstream writes on existing rows.
COMPANY_REFERENCE_COLUMNS = (
    "legal_name",
    "isin",
    "exchange",
    "kap_member_oid",
    "sector",
    "industry",
    "market_segment",
    "website",
    "security_type",
    "free_float_pct",
    "foreign_ratio_pct",
    "listing_status",
    "tracking_tier",
    "is_active",
    "last_seen_at",
    "reference_updated_at",
)
# Additionally required when a company row is created.
COMPANY_INSERT_ONLY_COLUMNS = ("id", "ticker", "display_name", "aliases")

REFERENCE_COMPANY_JOB = "reference.company"


@dataclass(frozen=True)
class CompanyState:
    """The reference columns of one ``companies`` row, as read before a sync."""

    id: uuid.UUID
    ticker: str
    legal_name: str
    display_name: str
    isin: str | None
    kap_member_oid: str | None
    tracking_tier: str
    listing_status: str
    is_active: bool
    free_float_pct: Decimal | None
    reference_updated_at: datetime | None
    aliases: tuple[str, ...] = ()


class UniverseRepository:
    """Company universe (column-wise) and the index catalogue / memberships."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def company_states(self) -> dict[str, CompanyState]:
        rows = (
            await self.session.execute(
                select(
                    Company.id,
                    Company.ticker,
                    Company.legal_name,
                    Company.display_name,
                    Company.isin,
                    Company.kap_member_oid,
                    Company.tracking_tier,
                    Company.listing_status,
                    Company.is_active,
                    Company.free_float_pct,
                    Company.reference_updated_at,
                    Company.aliases,
                )
            )
        ).all()
        return {
            row.ticker: CompanyState(
                id=row.id,
                ticker=row.ticker,
                legal_name=row.legal_name,
                display_name=row.display_name,
                isin=row.isin,
                kap_member_oid=row.kap_member_oid,
                tracking_tier=row.tracking_tier,
                listing_status=row.listing_status,
                is_active=row.is_active,
                free_float_pct=row.free_float_pct,
                reference_updated_at=row.reference_updated_at,
                aliases=tuple(str(a) for a in (row.aliases or [])),
            )
            for row in rows
        }

    async def insert_companies(self, rows: Sequence[Mapping[str, Any]]) -> int:
        """Create new company rows; a ticker created concurrently is left alone."""
        if not rows:
            return 0
        allowed = set(COMPANY_REFERENCE_COLUMNS) | set(COMPANY_INSERT_ONLY_COLUMNS)
        values = [{k: v for k, v in row.items() if k in allowed} for row in rows]
        result = await self.session.execute(
            pg_insert(Company).values(values).on_conflict_do_nothing(index_elements=["ticker"]).returning(Company.id)
        )
        return len(result.all())

    async def update_companies(self, rows: Sequence[Mapping[str, Any]]) -> int:
        """Bulk UPDATE by primary key; only :data:`COMPANY_REFERENCE_COLUMNS` are written.

        Rows are grouped by their key set (bulk UPDATE needs uniform parameter sets).
        """
        groups: dict[tuple[str, ...], list[dict[str, Any]]] = {}
        for row in rows:
            values = {k: v for k, v in row.items() if k in COMPANY_REFERENCE_COLUMNS}
            if not values or row.get("id") is None:
                continue
            groups.setdefault(tuple(sorted(values)), []).append({"id": row["id"], **values})
        for params in groups.values():
            await self.session.execute(update(Company), params)
        return sum(len(p) for p in groups.values())

    async def replace_indices(
        self,
        indices: Sequence[Mapping[str, Any]],
        memberships: Sequence[Mapping[str, Any]],
    ) -> tuple[int, int]:
        """Replace the whole index catalogue and every membership (one transaction, caller commits)."""
        await self.session.execute(delete(IndexMembership))
        await self.session.execute(delete(MarketIndex))
        if indices:
            await self.session.execute(insert(MarketIndex), [dict(i) for i in indices])
        if memberships:
            await self.session.execute(
                insert(IndexMembership), [{"id": uuid.uuid4(), **dict(m)} for m in memberships]
            )
        return len(indices), len(memberships)

    async def index_members(self, index_code: str) -> set[str]:
        rows = await self.session.execute(select(IndexMembership.ticker).where(IndexMembership.index_code == index_code))
        return {str(t) for t in rows.scalars().all()}

    async def core_tickers(self) -> set[str]:
        rows = await self.session.execute(
            select(Company.ticker).where(Company.tracking_tier == "core", Company.is_active.is_(True))
        )
        return {str(t) for t in rows.scalars().all()}

    async def due_core_tickers(self, *, refreshed_before: datetime, limit: int | None = None) -> list[str]:
        """Active core companies whose reference data is missing or older than ``refreshed_before``."""
        q = (
            select(Company.ticker)
            .where(
                Company.tracking_tier == "core",
                Company.is_active.is_(True),
                or_(Company.reference_updated_at.is_(None), Company.reference_updated_at < refreshed_before),
            )
            .order_by(Company.reference_updated_at.asc().nulls_first(), Company.ticker)
        )
        if limit is not None:
            q = q.limit(limit)
        return [str(t) for t in (await self.session.execute(q)).scalars().all()]

    async def counts(self) -> dict[str, Any]:
        """Row counts for reports (companies by tier/status, memberships, reference tables)."""
        by_tier = (
            await self.session.execute(
                select(Company.tracking_tier, Company.listing_status, Company.is_active, func.count())
                .group_by(Company.tracking_tier, Company.listing_status, Company.is_active)
            )
        ).all()
        result: dict[str, Any] = {
            "companies": {f"{t}/{s}/{'active' if a else 'inactive'}": int(n) for t, s, a, n in by_tier},
        }
        for name, model in (
            ("market_indices", MarketIndex),
            ("index_memberships", IndexMembership),
            ("dividends", Dividend),
            ("capital_increases", CapitalIncrease),
            ("shareholders", Shareholder),
            ("analyst_targets", AnalystTarget),
            ("expected_disclosures", ExpectedDisclosure),
        ):
            result[name] = int((await self.session.execute(select(func.count()).select_from(model))).scalar_one())
        return result


def expected_dedup_key(record: ExpectedDisclosureRecord) -> str:
    return hashlib.sha256(record.natural_key().encode("utf-8")).hexdigest()


def _max_fetched(rows: Iterable[Any]) -> datetime | None:
    stamps = [row.fetched_at for row in rows if row.fetched_at is not None]
    return max(stamps) if stamps else None


class ReferenceRepository:
    """Per-company reference datasets (dividends, capital increases, holders, targets, calendar)."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def company(self, ticker: str) -> Company | None:
        result = await self.session.execute(select(Company).where(Company.ticker == ticker))
        return result.scalar_one_or_none()

    async def update_company(self, company_id: uuid.UUID, values: Mapping[str, Any]) -> None:
        """Column-wise UPDATE of reference columns only."""
        clean = {k: v for k, v in values.items() if k in COMPANY_REFERENCE_COLUMNS}
        if clean:
            await self.session.execute(update(Company).where(Company.id == company_id).values(**clean))

    # --- dividends -----------------------------------------------------------

    async def dividends(self, company_id: uuid.UUID, source: str) -> tuple[list[DividendRecord], datetime | None]:
        rows = (
            await self.session.execute(
                select(Dividend).where(Dividend.company_id == company_id, Dividend.source == source)
            )
        ).scalars().all()
        records = [
            DividendRecord(
                ex_date=row.ex_date,
                gross_rate_pct=row.gross_rate_pct,
                net_rate_pct=row.net_rate_pct,
                total_amount=row.total_amount,
            )
            for row in rows
        ]
        return records, _max_fetched(rows)

    async def replace_dividends(
        self, company_id: uuid.UUID, source: str, records: Sequence[DividendRecord], fetched_at: datetime
    ) -> int:
        if not records:
            return 0
        values = [
            {
                "id": uuid.uuid4(),
                "company_id": company_id,
                "source": source,
                "ex_date": r.ex_date,
                "payment_date": None,
                "gross_rate_pct": r.gross_rate_pct,
                "net_rate_pct": r.net_rate_pct,
                "gross_per_share": r.gross_per_share,
                "net_per_share": r.net_per_share,
                "total_amount": r.total_amount,
                "fetched_at": fetched_at,
            }
            for r in records
        ]
        stmt = pg_insert(Dividend).values(values)
        await self.session.execute(
            stmt.on_conflict_do_update(
                constraint="uq_dividends_key",
                set_={
                    "net_rate_pct": stmt.excluded.net_rate_pct,
                    "gross_per_share": stmt.excluded.gross_per_share,
                    "net_per_share": stmt.excluded.net_per_share,
                    "total_amount": stmt.excluded.total_amount,
                    "fetched_at": stmt.excluded.fetched_at,
                },
            )
        )
        keep = {(r.ex_date, r.gross_rate_pct) for r in records}
        existing = (
            await self.session.execute(
                select(Dividend.id, Dividend.ex_date, Dividend.gross_rate_pct).where(
                    Dividend.company_id == company_id, Dividend.source == source
                )
            )
        ).all()
        stale = [row.id for row in existing if (row.ex_date, row.gross_rate_pct) not in keep]
        if stale:
            await self.session.execute(delete(Dividend).where(Dividend.id.in_(stale)))
        return len(values)

    # --- capital increases ---------------------------------------------------

    async def capital_increases(
        self, company_id: uuid.UUID, source: str
    ) -> tuple[list[CapitalIncreaseRecord], datetime | None]:
        rows = (
            await self.session.execute(
                select(CapitalIncrease).where(CapitalIncrease.company_id == company_id, CapitalIncrease.source == source)
            )
        ).scalars().all()
        records = [
            CapitalIncreaseRecord(
                event_date=row.event_date,
                kind=row.kind,
                bonus_rate_pct=row.bonus_rate_pct,
                rights_rate_pct=row.rights_rate_pct,
                rights_price=row.rights_price,
                capital_before=row.capital_before,
                capital_after=row.capital_after,
            )
            for row in rows
        ]
        records.sort(key=lambda r: (r.event_date, r.kind), reverse=True)
        return records, _max_fetched(rows)

    async def replace_capital_increases(
        self, company_id: uuid.UUID, source: str, records: Sequence[CapitalIncreaseRecord], fetched_at: datetime
    ) -> int:
        if not records:
            return 0
        values = [
            {
                "id": uuid.uuid4(),
                "company_id": company_id,
                "source": source,
                "event_date": r.event_date,
                "kind": r.kind,
                "bonus_rate_pct": r.bonus_rate_pct,
                "rights_rate_pct": r.rights_rate_pct,
                "rights_price": r.rights_price,
                "capital_before": r.capital_before,
                "capital_after": r.capital_after,
                "fetched_at": fetched_at,
            }
            for r in records
        ]
        stmt = pg_insert(CapitalIncrease).values(values)
        await self.session.execute(
            stmt.on_conflict_do_update(
                constraint="uq_capital_increases_key",
                set_={
                    "bonus_rate_pct": stmt.excluded.bonus_rate_pct,
                    "rights_rate_pct": stmt.excluded.rights_rate_pct,
                    "rights_price": stmt.excluded.rights_price,
                    "capital_before": stmt.excluded.capital_before,
                    "capital_after": stmt.excluded.capital_after,
                    "fetched_at": stmt.excluded.fetched_at,
                },
            )
        )
        keep = {(r.event_date, r.kind) for r in records}
        existing = (
            await self.session.execute(
                select(CapitalIncrease.id, CapitalIncrease.event_date, CapitalIncrease.kind).where(
                    CapitalIncrease.company_id == company_id, CapitalIncrease.source == source
                )
            )
        ).all()
        stale = [row.id for row in existing if (row.event_date, row.kind) not in keep]
        if stale:
            await self.session.execute(delete(CapitalIncrease).where(CapitalIncrease.id.in_(stale)))
        return len(values)

    # --- shareholders --------------------------------------------------------

    async def shareholders(
        self, company_id: uuid.UUID, source: str
    ) -> tuple[list[HolderRecord], datetime | None, date | None]:
        rows = (
            await self.session.execute(
                select(Shareholder)
                .where(Shareholder.company_id == company_id, Shareholder.source == source)
                .order_by(Shareholder.fetched_at, Shareholder.holder_name)
            )
        ).scalars().all()
        records = [HolderRecord(name=row.holder_name, share_pct=row.share_pct) for row in rows]
        as_of = next((row.as_of for row in rows if row.as_of is not None), None)
        return records, _max_fetched(rows), as_of

    async def replace_shareholders(
        self,
        company_id: uuid.UUID,
        source: str,
        records: Sequence[HolderRecord],
        fetched_at: datetime,
        as_of: date | None = None,
    ) -> int:
        """Replace the company's holders from ``source`` wholesale (keeps the provider order)."""
        await self.session.execute(
            delete(Shareholder).where(Shareholder.company_id == company_id, Shareholder.source == source)
        )
        values = []
        seen: set[str] = set()
        for position, record in enumerate(records):
            name = record.name[:300]
            if name in seen:
                continue
            seen.add(name)
            values.append({
                "id": uuid.uuid4(),
                "company_id": company_id,
                "source": source,
                "holder_name": name,
                "share_pct": record.share_pct,
                "as_of": as_of,
                "fetched_at": fetched_at + timedelta(microseconds=position),
            })
        if values:
            await self.session.execute(insert(Shareholder), values)
        return len(values)

    # --- analyst targets -----------------------------------------------------

    async def target(self, company_id: uuid.UUID, source: str) -> AnalystTarget | None:
        result = await self.session.execute(
            select(AnalystTarget).where(AnalystTarget.company_id == company_id, AnalystTarget.source == source)
        )
        return result.scalar_one_or_none()

    async def delete_target(self, company_id: uuid.UUID, source: str) -> None:
        await self.session.execute(
            delete(AnalystTarget).where(AnalystTarget.company_id == company_id, AnalystTarget.source == source)
        )

    async def upsert_target(
        self, company_id: uuid.UUID, source: str, values: Mapping[str, Any], fetched_at: datetime
    ) -> None:
        columns = (
            "as_of", "target_low", "target_high", "target_mean", "target_median",
            "analysts_count", "recommendation", "upside_pct",
        )
        row = {k: values.get(k) for k in columns}
        stmt = pg_insert(AnalystTarget).values(
            id=uuid.uuid4(), company_id=company_id, source=source, fetched_at=fetched_at, **row
        )
        await self.session.execute(
            stmt.on_conflict_do_update(
                constraint="uq_analyst_targets_key",
                set_={**{k: getattr(stmt.excluded, k) for k in columns}, "fetched_at": stmt.excluded.fetched_at},
            )
        )

    # --- expected disclosures --------------------------------------------------

    async def expected_disclosures(
        self, company_id: uuid.UUID
    ) -> tuple[list[ExpectedDisclosureRecord], datetime | None]:
        rows = (
            await self.session.execute(
                select(ExpectedDisclosure)
                .where(ExpectedDisclosure.company_id == company_id)
                .order_by(ExpectedDisclosure.end_date, ExpectedDisclosure.subject)
            )
        ).scalars().all()
        records = [
            ExpectedDisclosureRecord(
                subject=row.subject,
                period_term=row.period_term,
                fiscal_year=row.fiscal_year,
                start_date=row.start_date,
                end_date=row.end_date,
                rule_oid=None,
                taxonomy_oid=None,
            )
            for row in rows
        ]
        return records, _max_fetched(rows)

    async def replace_expected_disclosures(
        self,
        company_id: uuid.UUID,
        records: Sequence[ExpectedDisclosureRecord],
        fetched_at: datetime,
        today: date,
        source: str = "kap",
    ) -> int:
        """Upsert the open/upcoming windows; open windows missing from the answer are removed."""
        keys = {expected_dedup_key(r): r for r in records}
        if keys:
            values = [
                {
                    "id": uuid.uuid4(),
                    "company_id": company_id,
                    "subject": r.subject[:200],
                    "period_term": r.period_term[:80] if r.period_term else None,
                    "fiscal_year": r.fiscal_year,
                    "start_date": r.start_date,
                    "end_date": r.end_date,
                    "dedup_key": key,
                    "source": source,
                    "fetched_at": fetched_at,
                }
                for key, r in keys.items()
            ]
            stmt = pg_insert(ExpectedDisclosure).values(values)
            await self.session.execute(
                stmt.on_conflict_do_update(
                    constraint="uq_expected_disclosures_key",
                    set_={
                        "subject": stmt.excluded.subject,
                        "period_term": stmt.excluded.period_term,
                        "fiscal_year": stmt.excluded.fiscal_year,
                        "start_date": stmt.excluded.start_date,
                        "end_date": stmt.excluded.end_date,
                        "fetched_at": stmt.excluded.fetched_at,
                    },
                )
            )
        await self.session.execute(
            delete(ExpectedDisclosure).where(
                ExpectedDisclosure.company_id == company_id,
                ExpectedDisclosure.dedup_key.not_in(list(keys) or [""]),
                or_(ExpectedDisclosure.end_date.is_(None), ExpectedDisclosure.end_date >= today),
            )
        )
        return len(keys)

    # --- freshness markers -------------------------------------------------------

    async def last_company_refresh(self, ticker: str) -> IngestionRun | None:
        """Latest finished ``reference.company`` run of ``ticker`` (its details say which datasets succeeded)."""
        result = await self.session.execute(
            select(IngestionRun)
            .where(
                IngestionRun.job == REFERENCE_COMPANY_JOB,
                IngestionRun.scope == ticker,
                IngestionRun.status.in_(("ok", "partial")),
                IngestionRun.finished_at.is_not(None),
            )
            .order_by(IngestionRun.started_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()


def quality_check(
    check_name: str,
    status: str,
    *,
    subject: str | None = None,
    expected: float | Decimal | None = None,
    actual: float | Decimal | None = None,
    deviation: float | Decimal | None = None,
    details: Mapping[str, Any] | None = None,
) -> DataQualityCheck:
    """A ``data_quality_checks`` row (WS6 owns the runner; WS1 records its cross-source checks)."""
    return DataQualityCheck(
        check_name=check_name[:80],
        subject=subject[:60] if subject else None,
        status=status,
        expected=to_decimal(expected, 6),
        actual=to_decimal(actual, 6),
        deviation=to_decimal(deviation, 6),
        details_json=dict(details) if details else None,
    )
