"""Financial ratios for the stored statements (``/financials/ratios``).

The computation itself lives in :mod:`src.adapters.financial_adapter`
(:func:`canonical_financial_items` + :func:`compute_financial_ratios`) — the single
implementation shared with ``/fundamentals/{t}/live-ratios`` — so both endpoints
agree. This module only feeds it the stored (annual) statements and maps the result
onto the ``financial_ratios`` columns.

Valuation multiples (P/E, P/B, P/S) need the period-end market value, which is not
part of the statements; they stay ``None`` (never 0).
"""

import math
from collections.abc import Iterable, Mapping, Sequence
from decimal import Decimal
from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.financial_adapter import canonical_financial_items, compute_financial_ratios, parse_period
from src.db.models import Company, FinancialStatement
from src.db.repository import FinancialStatementRepository

logger = structlog.get_logger(__name__)

#: financial_ratios columns filled from compute_financial_ratios().
DB_RATIO_COLUMNS: tuple[str, ...] = (
    "roe",
    "roa",
    "net_margin",
    "gross_margin",
    "ebitda_margin",
    "pe_ratio",
    "pb_ratio",
    "ps_ratio",
    "debt_to_equity",
    "current_ratio",
    "net_debt_ebitda",
)

# financial_ratios columns are NUMERIC(12, 4): values at or above 1e8 would overflow
# the column (and are meaningless as ratios, e.g. division by a near-zero EBITDA).
_MAX_ABS_RATIO = 1e8

StatementsByType = Mapping[str, Mapping[str, Any]]


def _items(statements: StatementsByType) -> dict[str, float | None]:
    return canonical_financial_items(
        balance=statements.get("balance_sheet"),
        income=statements.get("income_stmt"),
        cashflow=statements.get("cash_flow"),
    )


def compute_period_ratios(
    current: StatementsByType, previous: StatementsByType | None = None
) -> dict[str, float | None]:
    """All ratios for one annual period from ``{statement_type: {label: value}}``.

    ``previous`` (the year before) enables average equity/assets and growth.
    """
    return compute_financial_ratios(_items(current), previous=_items(previous) if previous else None)


def _storable(value: float | None) -> float | None:
    if value is None or not math.isfinite(value) or abs(value) >= _MAX_ABS_RATIO:
        return None
    return value


def _statements_by_period(statements: Iterable[FinancialStatement]) -> dict[str, dict[str, Mapping[str, Any]]]:
    grouped: dict[str, dict[str, Mapping[str, Any]]] = {}
    for stmt in statements:
        grouped.setdefault(stmt.period, {})[stmt.statement_type] = stmt.data_json or {}
    return grouped


def _previous_period(period: str, available: Iterable[str]) -> str | None:
    """The stored period exactly one year before ``period`` (same month)."""
    parsed = parse_period(period)
    if parsed is None:
        return None
    target = (parsed[0] - 1, parsed[1])
    return next((p for p in available if parse_period(p) == target), None)


class AnalysisService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.fs_repo = FinancialStatementRepository(session)

    def ratios_from_statements(
        self, statements: Sequence[FinancialStatement], period: str, ticker: str | None = None
    ) -> dict[str, Any]:
        """``financial_ratios`` column values for ``period`` (Decimals, ``None`` when
        not computable) plus ``raw_ratios_json`` with every computed ratio. Empty when
        the period lacks a balance sheet or an income statement."""
        grouped = _statements_by_period(statements)
        current = grouped.get(period)
        if not current or "balance_sheet" not in current or "income_stmt" not in current:
            logger.info("ratio_inputs_missing", ticker=ticker, period=period)
            return {}
        previous_key = _previous_period(period, grouped)
        ratios = compute_period_ratios(current, grouped[previous_key] if previous_key else None)

        columns: dict[str, Any] = {}
        for name in DB_RATIO_COLUMNS:
            value = _storable(ratios.get(name))
            columns[name] = Decimal(str(value)) if value is not None else None
        if all(v is None for v in columns.values()):
            return {}
        columns["raw_ratios_json"] = {k: _storable(v) for k, v in ratios.items()}
        return columns

    async def calculate_ratios(self, company: Company, period: str) -> dict[str, Any]:
        """Load the company's statements and compute ratios for ``period``."""
        statements = await self.fs_repo.get_for_company(company.id)
        return self.ratios_from_statements(statements, period, ticker=company.ticker)
