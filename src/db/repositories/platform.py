"""Platform repositories (data-infra WS6; see docs/data-platform.md §7).

Three areas:

* :class:`SnapshotRepository` — CRUD for ``data_snapshots`` (the last-good-copy store
  behind ``src.services.snapshots.get_or_fetch``).
* :class:`QualityCheckRepository` — persists and reads back ``data_quality_checks``
  rows (``src.services.quality_service``).
* :func:`platform_counts` — every row count / latest-date figure ``/data/status``
  needs, as ONE round trip (mirrors ``src.db.repository.StatsRepository.get_counts``).

Callers commit; this module never does (matches the other data-infra repositories).
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from decimal import Decimal
from typing import Any, cast

from sqlalchemy import CursorResult, delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from src.adapters.utils import finite_float
from src.db.models import (
    Company,
    DataQualityCheck,
    DataSnapshot,
    FinancialRatio,
    FinancialStatement,
    FxBulletin,
    IndexMembership,
    MacroObservation,
    MarketIndex,
    PriceBar,
    Quote,
)


class SnapshotRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get(self, key: str) -> DataSnapshot | None:
        return await self.session.get(DataSnapshot, key)

    async def upsert(
        self,
        key: str,
        *,
        kind: str,
        payload: dict[str, Any],
        source: str | None,
        fetched_at: datetime,
        expires_at: datetime | None,
    ) -> DataSnapshot:
        stmt = pg_insert(DataSnapshot).values(
            key=key, kind=kind, payload=payload, source=source, fetched_at=fetched_at, expires_at=expires_at,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[DataSnapshot.key],
            set_={
                "kind": stmt.excluded.kind,
                "payload": stmt.excluded.payload,
                "source": stmt.excluded.source,
                "fetched_at": stmt.excluded.fetched_at,
                "expires_at": stmt.excluded.expires_at,
            },
        )
        await self.session.execute(stmt)
        await self.session.flush()
        row = await self.get(key)
        assert row is not None  # just written in this same transaction
        return row

    async def purge_expired(self, *, before: datetime) -> int:
        """Delete snapshots whose ``expires_at`` is older than ``before`` (a grace cutoff,
        not "now" — a copy is still stale-served well past ``expires_at``; see
        ``src.services.snapshots``)."""
        result = await self.session.execute(
            delete(DataSnapshot).where(DataSnapshot.expires_at.is_not(None), DataSnapshot.expires_at < before)
        )
        return cast(CursorResult, result).rowcount or 0


def _decimal(value: Any) -> Decimal | None:
    """``value`` as a ``Numeric``-safe :class:`Decimal` (NaN/Inf/non-numeric -> ``None``)."""
    number = finite_float(value)
    return None if number is None else Decimal(str(round(number, 6)))


class QualityCheckRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    def record(self, result: Mapping[str, Any]) -> None:
        """Stage one ``data_quality_checks`` row from a check-result dict (see
        ``quality_service.run_quality_checks``'s canonical shape). Caller flushes/commits."""
        self.session.add(
            DataQualityCheck(
                check_name=str(result["check_name"]),
                subject=result.get("subject"),
                status=str(result["status"]),
                expected=_decimal(result.get("expected")),
                actual=_decimal(result.get("actual")),
                deviation=_decimal(result.get("deviation")),
                details_json=result.get("details") or None,
            )
        )

    async def latest(
        self,
        *,
        status: str | None = None,
        check_name: str | None = None,
        limit: int = 200,
    ) -> list[DataQualityCheck]:
        """Most recent row per ``(check_name, subject)`` (``DISTINCT ON``), newest first."""
        base = select(DataQualityCheck)
        if status:
            base = base.where(DataQualityCheck.status == status)
        if check_name:
            base = base.where(DataQualityCheck.check_name == check_name)
        latest_sq = (
            base.distinct(DataQualityCheck.check_name, DataQualityCheck.subject)
            .order_by(DataQualityCheck.check_name, DataQualityCheck.subject, DataQualityCheck.checked_at.desc())
            .subquery()
        )
        latest_row = aliased(DataQualityCheck, latest_sq)
        final = select(latest_row).order_by(latest_row.checked_at.desc()).limit(limit)
        return list((await self.session.execute(final)).scalars().all())

    async def history(
        self,
        *,
        check_name: str | None = None,
        subject: str | None = None,
        since: datetime | None = None,
        limit: int = 500,
    ) -> list[DataQualityCheck]:
        q = select(DataQualityCheck)
        if check_name:
            q = q.where(DataQualityCheck.check_name == check_name)
        if subject:
            q = q.where(DataQualityCheck.subject == subject)
        if since is not None:
            q = q.where(DataQualityCheck.checked_at >= since)
        q = q.order_by(DataQualityCheck.checked_at.desc()).limit(limit)
        return list((await self.session.execute(q)).scalars().all())

    async def purge_older_than(self, *, before: datetime) -> int:
        result = await self.session.execute(delete(DataQualityCheck).where(DataQualityCheck.checked_at < before))
        return cast(CursorResult, result).rowcount or 0


async def platform_counts(session: AsyncSession) -> dict[str, Any]:
    """Row counts + latest data dates across every data-platform table, in ONE round trip.

    Same pattern as ``src.db.repository.StatsRepository.get_counts``: every figure is a
    correlated scalar subquery in a single ``SELECT``, so this is one query regardless of
    how many tables it touches (fast and safe on an empty database — ``MAX``/``COUNT`` on
    zero rows is ``NULL``/``0``, never an error).
    """

    def count(model: Any, *where: Any) -> Any:
        return select(func.count()).select_from(model).where(*where).scalar_subquery()

    def maximum(col: Any) -> Any:
        return select(func.max(col)).scalar_subquery()

    stmt = select(
        count(Company).label("companies_total"),
        count(Company, Company.is_active.is_(True)).label("companies_active"),
        count(Company, Company.is_active.is_(True), Company.tracking_tier == "core").label("companies_core"),
        maximum(Company.reference_updated_at).label("companies_reference_latest"),
        count(MarketIndex).label("market_indices_total"),
        count(IndexMembership).label("index_memberships_total"),
        maximum(IndexMembership.fetched_at).label("index_memberships_latest"),
        count(Quote).label("quotes_total"),
        maximum(Quote.fetched_at).label("quotes_latest_fetched_at"),
        count(PriceBar).label("price_bars_total"),
        maximum(PriceBar.bar_date).label("price_bars_latest_date"),
        count(FinancialStatement).label("financial_statements_total"),
        maximum(FinancialStatement.period).label("financial_statements_latest_period"),
        maximum(FinancialStatement.fetched_at).label("financial_statements_latest_fetched_at"),
        count(FinancialRatio).label("financial_ratios_total"),
        count(MacroObservation).label("macro_observations_total"),
        maximum(MacroObservation.observation_date).label("macro_observations_latest_date"),
        count(FxBulletin).label("fx_bulletins_total"),
        maximum(FxBulletin.bulletin_date).label("fx_bulletins_latest_date"),
        count(DataQualityCheck).label("quality_checks_total"),
        maximum(DataQualityCheck.checked_at).label("quality_checks_latest"),
        count(DataSnapshot).label("data_snapshots_total"),
    )
    row = (await session.execute(stmt)).one()
    return dict(row._mapping)
