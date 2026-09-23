"""Fundamentals store (WS3): ``financial_statements``, ``financial_facts``, ``financial_ratios``.

Also the fundamentals-owned ``companies`` columns (``fiscal_year_end_month``,
``statement_template``, ``paid_in_capital`` — updated column-wise, never a full
row upsert), the per-company refresh manifest kept in ``data_snapshots``
(``fundamentals.statements:<TICKER>``) and the cross-source checks written to
``data_quality_checks``. The caller owns the transaction (commit/rollback).
"""

from __future__ import annotations

import math
import uuid
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import delete, func, literal_column, select, tuple_, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import (
    Company,
    DataQualityCheck,
    DataSnapshot,
    FinancialFact,
    FinancialRatio,
    FinancialStatement,
    NormalizedEvent,
    Quote,
)

MANIFEST_KIND = "fundamentals.refresh"
MANIFEST_PREFIX = "fundamentals.statements:"

#: financial_facts value columns (canonical keys).
FACT_COLUMNS: tuple[str, ...] = (
    "revenue", "gross_profit", "operating_profit", "net_income", "net_income_parent", "net_interest_income",
    "depreciation_amortization", "operating_cash_flow", "investing_cash_flow", "financing_cash_flow", "capex",
    "free_cash_flow", "total_assets", "current_assets", "current_liabilities", "non_current_liabilities",
    "total_liabilities", "total_equity", "parent_equity", "minority_interest", "paid_in_capital", "cash",
    "short_term_investments", "financial_debt", "deposits",
)

_STATEMENT_COLUMNS = (
    "fiscal_year_end_month", "months", "period_type", "template", "consolidation", "presentation_unit", "currency",
    "restated", "restatement_factor", "items_json", "source_url", "content_hash", "published_at",
)
_RATIO_COLUMNS = (
    "gross_margin", "operating_margin", "ebitda_margin", "net_margin", "roe", "roa", "current_ratio",
    "net_debt_ebitda", "debt_to_equity", "pe_ratio", "pb_ratio", "ps_ratio", "ev_ebitda", "revenue_growth_yoy",
    "net_income_growth_yoy", "market_cap", "price", "shares_outstanding", "shares_source", "ttm_quarters",
    "raw_ratios_json", "inputs_json",
)
_UNSET: Any = object()


def money(value: Any) -> Decimal | None:
    """Full-TL amount for a NUMERIC(22, 2) column (NaN/Inf/garbage → ``None``)."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, Decimal):
        return value if value.is_finite() else None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or abs(number) >= 1e20:
        return None
    return Decimal(str(round(number, 2)))


def manifest_key(ticker: str) -> str:
    return f"{MANIFEST_PREFIX}{ticker.upper()}"


@dataclass(frozen=True)
class StatementUpsertResult:
    inserted: int
    updated: int
    unchanged: int

    @property
    def changed(self) -> int:
        return self.inserted + self.updated


class FundamentalsRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    # -- companies -----------------------------------------------------------------

    async def company_by_ticker(self, ticker: str) -> Company | None:
        result = await self.session.execute(select(Company).where(Company.ticker == ticker.strip().upper()))
        return result.scalar_one_or_none()

    async def companies(
        self,
        *,
        tickers: Sequence[str] | None = None,
        tiers: Sequence[str] | None = None,
        active_only: bool = True,
        stocks_only: bool = True,
    ) -> list[Company]:
        q = select(Company)
        if tickers is not None:
            q = q.where(Company.ticker.in_([t.strip().upper() for t in tickers]))
        if tiers is not None:
            q = q.where(Company.tracking_tier.in_(list(tiers)))
        if active_only:
            q = q.where(Company.is_active.is_(True))
        if stocks_only:
            q = q.where(Company.security_type == "stock")
        result = await self.session.execute(q.order_by(Company.ticker))
        return list(result.scalars().all())

    async def update_company_fundamentals(
        self,
        company_id: uuid.UUID,
        *,
        fiscal_year_end_month: int | None = _UNSET,
        statement_template: str | None = _UNSET,
        paid_in_capital: Any = _UNSET,
    ) -> None:
        """Column-wise UPDATE of the fundamentals-owned ``companies`` columns only."""
        values: dict[str, Any] = {}
        if fiscal_year_end_month is not _UNSET and fiscal_year_end_month is not None:
            values["fiscal_year_end_month"] = int(fiscal_year_end_month)
        if statement_template is not _UNSET and statement_template:
            values["statement_template"] = str(statement_template)[:20]
        if paid_in_capital is not _UNSET and money(paid_in_capital) is not None:
            values["paid_in_capital"] = money(paid_in_capital)
        if values:
            await self.session.execute(update(Company).where(Company.id == company_id).values(**values))

    # -- statements -----------------------------------------------------------------

    async def statement_rows(
        self,
        company_id: uuid.UUID,
        *,
        sources: Sequence[str] | None = None,
        statement_type: str | None = None,
    ) -> list[FinancialStatement]:
        q = select(FinancialStatement).where(FinancialStatement.company_id == company_id)
        if sources:
            q = q.where(FinancialStatement.source.in_(list(sources)))
        if statement_type:
            q = q.where(FinancialStatement.statement_type == statement_type)
        q = q.order_by(FinancialStatement.period.desc(), FinancialStatement.source, FinancialStatement.statement_type)
        return list((await self.session.execute(q)).scalars().all())

    async def upsert_statements(
        self, company_id: uuid.UUID, rows: Sequence[Mapping[str, Any]], *, touch: bool = True
    ) -> StatementUpsertResult:
        """Insert / update statement rows; rows whose ``content_hash`` is unchanged are not rewritten.

        ``touch``: every row of the batch gets ``fetched_at = now()`` (content confirmed by
        the provider now). An offline rebuild passes ``False`` and keeps the fetch times.
        """
        if not rows:
            return StatementUpsertResult(0, 0, 0)
        values = []
        for row in rows:
            record = {column: row.get(column) for column in _STATEMENT_COLUMNS}
            record.update(
                id=uuid.uuid4(),
                company_id=company_id,
                source=row["source"],
                period=row["period"],
                statement_type=row["statement_type"],
            )
            factor = record.get("restatement_factor")
            record["restatement_factor"] = Decimal(str(round(float(factor), 6))) if factor is not None else None
            values.append(record)
        insert_stmt = pg_insert(FinancialStatement).values(values)
        excluded = insert_stmt.excluded
        set_: dict[str, Any] = {column: excluded[column] for column in _STATEMENT_COLUMNS}
        if touch:
            set_["fetched_at"] = func.now()
        upsert_stmt: Any = insert_stmt.on_conflict_do_update(
            constraint="uq_financial_statements_key",
            set_=set_,
            where=FinancialStatement.content_hash.is_distinct_from(excluded.content_hash),
        ).returning(FinancialStatement.id, literal_column("(xmax = 0)").label("inserted"))
        written = (await self.session.execute(upsert_stmt)).all()
        inserted = sum(1 for row in written if row.inserted)
        updated = len(written) - inserted
        if touch:
            keys = [(row["source"], row["period"], row["statement_type"]) for row in rows]
            await self.session.execute(
                update(FinancialStatement)
                .where(
                    FinancialStatement.company_id == company_id,
                    tuple_(FinancialStatement.source, FinancialStatement.period, FinancialStatement.statement_type)
                    .in_(keys),
                )
                .values(fetched_at=func.now())
            )
        return StatementUpsertResult(inserted=inserted, updated=updated, unchanged=len(rows) - len(written))

    async def set_published_dates(self, company_id: uuid.UUID, dates: Mapping[str, Any]) -> int:
        """Fill ``published_at`` per period where it is still unknown."""
        changed = 0
        for period, published in dates.items():
            result = await self.session.execute(
                update(FinancialStatement)
                .where(
                    FinancialStatement.company_id == company_id,
                    FinancialStatement.period == period,
                    FinancialStatement.published_at.is_(None),
                )
                .values(published_at=published)
            )
            changed += int(getattr(result, "rowcount", 0) or 0)
        return changed

    async def financial_report_times(self, company_id: uuid.UUID) -> list[datetime]:
        """Publication times of the company's KAP "Finansal Rapor" disclosures (oldest first)."""
        q = (
            select(NormalizedEvent.published_at)
            .where(NormalizedEvent.company_id == company_id, func.lower(NormalizedEvent.title) == "finansal rapor")
            .order_by(NormalizedEvent.published_at)
        )
        return [row[0] for row in (await self.session.execute(q)).all()]

    # -- facts ------------------------------------------------------------------------

    async def facts(self, company_id: uuid.UUID) -> list[FinancialFact]:
        q = select(FinancialFact).where(FinancialFact.company_id == company_id).order_by(FinancialFact.period.desc())
        return list((await self.session.execute(q)).scalars().all())

    async def upsert_facts(
        self,
        company_id: uuid.UUID,
        facts: Mapping[str, Mapping[str, Any]],
        *,
        months: Mapping[str, int | None],
        sources: Mapping[str, Mapping[str, Any]],
        template: str | None,
        fiscal_year_end_month: int,
    ) -> int:
        """Upsert one ``financial_facts`` row per period; removes periods no longer derivable.

        An empty ``facts`` mapping changes nothing (never wipes a company's facts).
        """
        if not facts:
            return 0
        values = []
        for period, items in facts.items():
            record: dict[str, Any] = {column: money(items.get(column)) for column in FACT_COLUMNS}
            record.update(
                id=uuid.uuid4(),
                company_id=company_id,
                period=period,
                fiscal_year_end_month=fiscal_year_end_month,
                months=months.get(period),
                template=template,
                sources_json=dict(sources.get(period) or {}),
            )
            values.append(record)
        stmt = pg_insert(FinancialFact).values(values)
        excluded = stmt.excluded
        columns = (*FACT_COLUMNS, "fiscal_year_end_month", "months", "template", "sources_json")
        await self.session.execute(
            stmt.on_conflict_do_update(
                constraint="uq_financial_facts_period",
                set_={**{c: excluded[c] for c in columns}, "computed_at": func.now()},
            )
        )
        await self.session.execute(
            delete(FinancialFact).where(
                FinancialFact.company_id == company_id, FinancialFact.period.not_in(list(facts))
            )
        )
        return len(values)

    async def companies_with_facts(self) -> list[uuid.UUID]:
        result = await self.session.execute(select(FinancialFact.company_id).distinct())
        return [row[0] for row in result.all()]

    # -- ratios -----------------------------------------------------------------------

    async def ratio_rows(self, company_id: uuid.UUID, basis: str | None = None) -> list[FinancialRatio]:
        q = select(FinancialRatio).where(FinancialRatio.company_id == company_id)
        if basis:
            q = q.where(FinancialRatio.basis == basis)
        q = q.order_by(FinancialRatio.period.desc(), FinancialRatio.basis)
        return list((await self.session.execute(q)).scalars().all())

    async def replace_ratios(self, company_id: uuid.UUID, rows: Sequence[Mapping[str, Any]]) -> int:
        """Upsert ratio rows by (period, basis) and delete the company's other rows."""
        if rows:
            values = []
            for row in rows:
                record = {column: row.get(column) for column in _RATIO_COLUMNS}
                record.update(id=uuid.uuid4(), company_id=company_id, period=row["period"], basis=row["basis"])
                values.append(record)
            stmt = pg_insert(FinancialRatio).values(values)
            excluded = stmt.excluded
            await self.session.execute(
                stmt.on_conflict_do_update(
                    constraint="uq_financial_ratios_period_basis",
                    set_={**{c: excluded[c] for c in _RATIO_COLUMNS}, "calculated_at": func.now()},
                )
            )
        keep = [(row["period"], row["basis"]) for row in rows]
        stale = delete(FinancialRatio).where(FinancialRatio.company_id == company_id)
        if keep:
            stale = stale.where(tuple_(FinancialRatio.period, FinancialRatio.basis).not_in(keep))
        await self.session.execute(stale)
        return len(rows)

    # -- refresh manifest (data_snapshots) ----------------------------------------------

    async def manifests(self, tickers: Iterable[str] | None = None) -> dict[str, DataSnapshot]:
        q = select(DataSnapshot).where(DataSnapshot.kind == MANIFEST_KIND)
        if tickers is not None:
            q = q.where(DataSnapshot.key.in_([manifest_key(t) for t in tickers]))
        rows = (await self.session.execute(q)).scalars().all()
        return {row.key[len(MANIFEST_PREFIX):]: row for row in rows}

    async def save_manifest(
        self,
        ticker: str,
        payload: Mapping[str, Any],
        *,
        fetched_at: datetime,
        expires_at: datetime | None,
    ) -> None:
        stmt = pg_insert(DataSnapshot).values(
            key=manifest_key(ticker),
            kind=MANIFEST_KIND,
            payload=dict(payload),
            source="kap+isyatirim",
            fetched_at=fetched_at,
            expires_at=expires_at,
        )
        await self.session.execute(
            stmt.on_conflict_do_update(
                index_elements=[DataSnapshot.key],
                set_={
                    "kind": stmt.excluded.kind,
                    "payload": stmt.excluded.payload,
                    "source": stmt.excluded.source,
                    "fetched_at": stmt.excluded.fetched_at,
                    "expires_at": stmt.excluded.expires_at,
                },
            )
        )

    # -- market inputs ----------------------------------------------------------------

    async def quotes(self, symbols: Iterable[str]) -> dict[str, Quote]:
        wanted = sorted({s.strip().upper() for s in symbols})
        if not wanted:
            return {}
        rows = (await self.session.execute(select(Quote).where(Quote.symbol.in_(wanted)))).scalars().all()
        return {row.symbol: row for row in rows}

    # -- data quality ------------------------------------------------------------------

    async def add_quality_checks(self, checks: Sequence[Mapping[str, Any]]) -> int:
        for check in checks:
            self.session.add(
                DataQualityCheck(
                    check_name=str(check["check_name"])[:80],
                    subject=(str(check["subject"])[:60] if check.get("subject") else None),
                    status=check["status"],
                    expected=_quality_number(check.get("expected")),
                    actual=_quality_number(check.get("actual")),
                    deviation=_quality_number(check.get("deviation"), limit=1e10),
                    details_json=dict(check.get("details") or {}) or None,
                )
            )
        await self.session.flush()
        return len(checks)


def _quality_number(value: Any, limit: float = 1e18) -> Decimal | None:
    """NUMERIC(24, 6) / (16, 6) safe value."""
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or abs(number) >= limit:
        return None
    return Decimal(str(round(number, 6)))
