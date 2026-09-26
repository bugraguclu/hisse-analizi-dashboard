"""Macro store repository — ``macro_series`` (rate/inflation observations) and
``fx_bulletins`` (TCMB daily indicative bulletin).

Upserts are chunked multi-row ``INSERT ... ON CONFLICT DO UPDATE`` statements
keyed on the models' unique constraints (``uq_macro_series_key`` /
``uq_fx_bulletins_key``). Callers commit; this module never does.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import FxBulletin, MacroObservation

_UPSERT_CHUNK = 500


@dataclass(frozen=True)
class ObservationRow:
    series_code: str
    observation_date: date
    value: Decimal
    source: str


@dataclass(frozen=True)
class FxBulletinRow:
    bulletin_date: date
    currency: str
    quoted_unit: int
    forex_buying: Decimal | None
    forex_selling: Decimal | None
    banknote_buying: Decimal | None
    banknote_selling: Decimal | None
    source: str = "tcmb"


def _dedupe_observations(rows: Sequence[ObservationRow]) -> list[ObservationRow]:
    """Last write wins for a repeated (series_code, observation_date) — Postgres
    rejects a multi-row upsert that hits the same conflict target twice."""
    by_key: dict[tuple[str, date], ObservationRow] = {}
    for row in rows:
        by_key[(row.series_code, row.observation_date)] = row
    return list(by_key.values())


def _dedupe_fx(rows: Sequence[FxBulletinRow]) -> list[FxBulletinRow]:
    by_key: dict[tuple[date, str], FxBulletinRow] = {}
    for row in rows:
        by_key[(row.bulletin_date, row.currency)] = row
    return list(by_key.values())


class MacroRepository:
    """``macro_series`` + ``fx_bulletins`` reads/upserts."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ----- macro_series ------------------------------------------------

    async def upsert_observations(self, rows: Sequence[ObservationRow]) -> int:
        """Upsert ``rows``; returns the number of distinct (series_code, date) written."""
        deduped = _dedupe_observations(rows)
        for start in range(0, len(deduped), _UPSERT_CHUNK):
            chunk = deduped[start : start + _UPSERT_CHUNK]
            values = [
                {
                    "series_code": r.series_code,
                    "observation_date": r.observation_date,
                    "value": r.value,
                    "source": r.source,
                }
                for r in chunk
            ]
            stmt = pg_insert(MacroObservation).values(values)
            stmt = stmt.on_conflict_do_update(
                constraint="uq_macro_series_key",
                set_={"value": stmt.excluded.value, "source": stmt.excluded.source, "fetched_at": func.now()},
            )
            await self.session.execute(stmt)
        return len(deduped)

    async def at(self, series_code: str, observation_date: date) -> MacroObservation | None:
        """The single observation at an exact date, or ``None`` (e.g. a corridor leg
        that does not apply on that date — never fabricated, simply absent)."""
        q = select(MacroObservation).where(
            MacroObservation.series_code == series_code,
            MacroObservation.observation_date == observation_date,
        )
        return (await self.session.execute(q)).scalar_one_or_none()

    async def latest(self, series_code: str) -> MacroObservation | None:
        q = (
            select(MacroObservation)
            .where(MacroObservation.series_code == series_code)
            .order_by(MacroObservation.observation_date.desc())
            .limit(1)
        )
        return (await self.session.execute(q)).scalar_one_or_none()

    async def latest_many(self, series_codes: Sequence[str]) -> dict[str, MacroObservation]:
        out: dict[str, MacroObservation] = {}
        for code in series_codes:
            row = await self.latest(code)
            if row is not None:
                out[code] = row
        return out

    async def history(
        self,
        series_code: str,
        *,
        limit: int | None = None,
        ascending: bool = True,
        since: date | None = None,
    ) -> list[MacroObservation]:
        """Observations for ``series_code``. With ``limit``, the most recent N rows
        (chosen SQL-side), returned ascending or descending per ``ascending``."""
        q = select(MacroObservation).where(MacroObservation.series_code == series_code)
        if since is not None:
            q = q.where(MacroObservation.observation_date >= since)
        if limit is not None:
            q = q.order_by(MacroObservation.observation_date.desc()).limit(limit)
            rows = list((await self.session.execute(q)).scalars().all())
            if ascending:
                rows.reverse()
            return rows
        q = q.order_by(MacroObservation.observation_date.asc() if ascending else MacroObservation.observation_date.desc())
        return list((await self.session.execute(q)).scalars().all())

    # ----- fx_bulletins --------------------------------------------------

    async def upsert_fx_bulletins(self, rows: Sequence[FxBulletinRow]) -> int:
        deduped = _dedupe_fx(rows)
        for start in range(0, len(deduped), _UPSERT_CHUNK):
            chunk = deduped[start : start + _UPSERT_CHUNK]
            values = [
                {
                    "bulletin_date": r.bulletin_date,
                    "currency": r.currency,
                    "quoted_unit": r.quoted_unit,
                    "forex_buying": r.forex_buying,
                    "forex_selling": r.forex_selling,
                    "banknote_buying": r.banknote_buying,
                    "banknote_selling": r.banknote_selling,
                    "source": r.source,
                }
                for r in chunk
            ]
            stmt = pg_insert(FxBulletin).values(values)
            stmt = stmt.on_conflict_do_update(
                constraint="uq_fx_bulletins_key",
                set_={
                    "quoted_unit": stmt.excluded.quoted_unit,
                    "forex_buying": stmt.excluded.forex_buying,
                    "forex_selling": stmt.excluded.forex_selling,
                    "banknote_buying": stmt.excluded.banknote_buying,
                    "banknote_selling": stmt.excluded.banknote_selling,
                    "source": stmt.excluded.source,
                    "fetched_at": func.now(),
                },
            )
            await self.session.execute(stmt)
        return len(deduped)

    async def latest_fx(self, currency: str) -> FxBulletin | None:
        q = (
            select(FxBulletin)
            .where(FxBulletin.currency == currency)
            .order_by(FxBulletin.bulletin_date.desc())
            .limit(1)
        )
        return (await self.session.execute(q)).scalar_one_or_none()

    async def fx_history(
        self,
        currency: str,
        *,
        limit: int | None = None,
        ascending: bool = True,
        since: date | None = None,
    ) -> list[FxBulletin]:
        q = select(FxBulletin).where(FxBulletin.currency == currency)
        if since is not None:
            q = q.where(FxBulletin.bulletin_date >= since)
        if limit is not None:
            q = q.order_by(FxBulletin.bulletin_date.desc()).limit(limit)
            rows = list((await self.session.execute(q)).scalars().all())
            if ascending:
                rows.reverse()
            return rows
        q = q.order_by(FxBulletin.bulletin_date.asc() if ascending else FxBulletin.bulletin_date.desc())
        return list((await self.session.execute(q)).scalars().all())

    async def has_fx_bulletin(self, day: date) -> bool:
        q = select(func.count()).select_from(FxBulletin).where(FxBulletin.bulletin_date == day)
        count = (await self.session.execute(q)).scalar_one()
        return bool(count)
