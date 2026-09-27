"""Sektör karşılaştırması okumaları — işlem gören hisselerin KAP sektörü ve son finansal oranları.

Yalnızca okur; ``companies.sector`` universe.sync (WS1), ``financial_ratios`` fundamentals.ratios
(WS3) tarafından yazılır.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import Company, FinancialRatio

# ``financial_ratios`` columns the sector comparison reads (percent / plain multiples).
RATIO_COLUMNS: tuple[str, ...] = (
    "gross_margin",
    "operating_margin",
    "ebitda_margin",
    "net_margin",
    "roe",
    "roa",
    "current_ratio",
    "debt_to_equity",
    "net_debt_ebitda",
    "revenue_growth_yoy",
    "net_income_growth_yoy",
    "ps_ratio",
    "ev_ebitda",
)


@dataclass(frozen=True)
class ListedStock:
    id: uuid.UUID
    ticker: str
    name: str
    sector: str | None


@dataclass(frozen=True)
class RatioRow:
    company_id: uuid.UUID
    period: str
    basis: str
    values: dict[str, float | None]


def _number(value: Decimal | float | None) -> float | None:
    return None if value is None else float(value)


class SectorRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def listed_stocks(self) -> list[ListedStock]:
        """Active, listed stocks (funds and delisted/suspended companies are left out)."""
        stmt = select(Company.id, Company.ticker, Company.display_name, Company.sector).where(
            Company.is_active.is_(True),
            Company.security_type == "stock",
            Company.listing_status == "listed",
        )
        rows = (await self.session.execute(stmt)).all()
        return [ListedStock(id=row.id, ticker=row.ticker, name=row.display_name, sector=row.sector) for row in rows]

    async def ratio_rows(self, company_ids: Iterable[uuid.UUID], *, since_period: str) -> list[RatioRow]:
        """Ratio rows of ``company_ids`` for periods ``>= since_period`` ("YYYY/MM" sorts as text)."""
        ids = list(company_ids)
        if not ids:
            return []
        columns: Sequence = [getattr(FinancialRatio, name) for name in RATIO_COLUMNS]
        stmt = select(FinancialRatio.company_id, FinancialRatio.period, FinancialRatio.basis, *columns).where(
            FinancialRatio.company_id.in_(ids),
            FinancialRatio.period >= since_period,
        )
        rows = (await self.session.execute(stmt)).all()
        return [
            RatioRow(
                company_id=row.company_id,
                period=row.period,
                basis=row.basis,
                values={name: _number(getattr(row, name)) for name in RATIO_COLUMNS},
            )
            for row in rows
        ]
