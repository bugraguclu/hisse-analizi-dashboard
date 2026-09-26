"""Market store repositories (WS2): ``quotes``, bulk ``price_bars`` access, backfill markers.

``price_bars`` keeps ONE series per (symbol, interval); ``source`` is provenance,
not part of the key. Precedence when two providers write the same bar
(:func:`upsert_bars`):

1. A running-session bar (``is_final=false``) never replaces a final bar.
2. A final bar replaces a running bar from any provider.
3. Otherwise the incoming bar wins only when its provider ranks at least as high
   as the stored one: ``tradingview`` (canonical, split-adjusted) >
   ``isyatirim`` (official closes, fallback for sessions TradingView lacks) >
   ``yfinance`` (legacy fallback).
4. ``turnover``/``vwap`` enrichment (İş Yatırım) never touches OHLCV: an incoming
   row without them keeps the stored values; ``vwap`` is dropped when the close
   changes (a re-adjusted series needs a re-scaled VWAP).
5. The volume of a completed session never decreases while its close is
   unchanged (stored and incoming bar final, same close, incoming provider not
   ranked above the stored one): the day's final bar carries İş Yatırım's official
   lot count (OneEndeks ``quantity``, which includes the trades at the closing
   price), and TradingView's same-day volume, which misses them, must not undo it.
   A re-adjusted close (split/bonus issue) replaces the volume with the incoming one.

Unchanged rows are not rewritten (``fetched_at`` then reflects the last change).
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, cast

from sqlalchemy import (
    Boolean,
    ColumnElement,
    Table,
    and_,
    bindparam,
    case,
    func,
    literal_column,
    or_,
    select,
    text,
    update,
)
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import Company, DataQualityCheck, DataSnapshot, PriceBar, Quote

# Provider precedence for price_bars (higher wins; unknown sources rank lowest).
SOURCE_RANK: dict[str, int] = {"tradingview": 3, "isyatirim": 2, "yfinance": 1}

BAR_COLUMNS: tuple[str, ...] = (
    "symbol", "company_id", "interval", "bar_date", "open", "high", "low", "close", "volume",
    "turnover", "vwap", "source", "adjusted", "is_final",
)
_OHLCV_COLUMNS = ("open", "high", "low", "close", "volume")
_ENRICHMENT_COLUMNS = ("turnover", "vwap")

QUOTE_COLUMNS: tuple[str, ...] = (
    "symbol", "company_id", "security_type", "name", "currency", "last", "open", "high", "low",
    "prev_close", "change", "change_pct", "volume", "turnover", "market_cap", "bid", "ask", "source",
    "delay_seconds", "quote_time", "session_date",
)

# asyncpg accepts at most 32767 bind parameters per statement.
_BAR_CHUNK = 1000
_QUOTE_CHUNK = 1000

HISTORY_MARKER_KIND = "market.history"
HISTORY_MARKER_PREFIX = "market.history:"


def _rank(expr: Any) -> ColumnElement[int]:
    return case(*((expr == code, rank) for code, rank in SOURCE_RANK.items()), else_=0)


def _normalize_bar(row: dict[str, Any]) -> dict[str, Any]:
    values = {column: row.get(column) for column in BAR_COLUMNS}
    values["interval"] = str(values["interval"] or "1d")
    values["adjusted"] = True if values["adjusted"] is None else bool(values["adjusted"])
    values["is_final"] = True if values["is_final"] is None else bool(values["is_final"])
    if not values["symbol"] or values["bar_date"] is None or not values["source"]:
        raise ValueError("price bar rows need symbol, bar_date and source")
    return values


@dataclass
class BarUpsertStats:
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0  # identical values, or blocked by the precedence rules

    @property
    def written(self) -> int:
        return self.inserted + self.updated

    def add(self, other: BarUpsertStats) -> None:
        self.inserted += other.inserted
        self.updated += other.updated
        self.unchanged += other.unchanged

    def as_dict(self) -> dict[str, int]:
        return {"inserted": self.inserted, "updated": self.updated, "unchanged": self.unchanged}


async def upsert_bars(session: AsyncSession, rows: Iterable[dict[str, Any]]) -> BarUpsertStats:
    """Bulk upsert of ``price_bars`` rows following the module's precedence rules.

    Rows are normalised to :data:`BAR_COLUMNS`; value columns that no row of the
    call provides are left untouched on conflict (``adjusted``/``is_final`` default
    to ``True`` for new rows). Duplicate keys within one call keep the last row.
    The caller commits.
    """
    deduped: dict[tuple[str, str, date], dict[str, Any]] = {}
    provided: set[str] = set()
    for row in rows:
        provided.update(key for key in row if key in BAR_COLUMNS)
        values = _normalize_bar(row)
        deduped[(values["symbol"], values["interval"], values["bar_date"])] = values
    value_columns = tuple(col for col in _OHLCV_COLUMNS if col in provided) + ("adjusted", "is_final", "source")
    enrichment = tuple(col for col in _ENRICHMENT_COLUMNS if col in provided)
    stats = BarUpsertStats()
    items = list(deduped.values())
    for start in range(0, len(items), _BAR_CHUNK):
        chunk = items[start : start + _BAR_CHUNK]
        insert_stmt = pg_insert(PriceBar).values(chunk)
        excluded = insert_stmt.excluded
        existing = PriceBar.__table__.c
        allowed = or_(
            and_(
                existing.is_final.is_(False),
                or_(excluded.is_final.is_(True), _rank(excluded.source) >= _rank(existing.source)),
            ),
            and_(
                existing.is_final.is_(True),
                excluded.is_final.is_(True),
                _rank(excluded.source) >= _rank(existing.source),
            ),
        )
        new_values: dict[str, Any] = {col: excluded[col] for col in value_columns}
        if "volume" in new_values:
            same_session_same_close = and_(
                existing.is_final.is_(True),
                excluded.is_final.is_(True),
                _rank(existing.source) >= _rank(excluded.source),
                existing.volume.is_not(None),
                *((existing.close.is_not_distinct_from(excluded.close),) if "close" in provided else ()),
            )
            # GREATEST ignores NULL: a same-close row without a volume keeps the stored one.
            new_values["volume"] = case(
                (same_session_same_close, func.greatest(existing.volume, excluded.volume)), else_=excluded.volume
            )
        changed = or_(
            *(existing[col].is_distinct_from(new_values[col]) for col in value_columns),
            *(and_(excluded[col].is_not(None), existing[col].is_distinct_from(excluded[col])) for col in enrichment),
        )
        set_: dict[str, Any] = dict(new_values)
        set_["company_id"] = func.coalesce(excluded.company_id, existing.company_id)
        set_["turnover"] = func.coalesce(excluded.turnover, existing.turnover)
        vwap_cases: list[tuple[Any, Any]] = [(excluded.vwap.is_not(None), excluded.vwap)]
        if "close" in provided:  # a re-adjusted close invalidates the stored VWAP
            vwap_cases.append((existing.close.is_distinct_from(excluded.close), None))
        set_["vwap"] = case(*vwap_cases, else_=existing.vwap)
        set_["fetched_at"] = func.now()
        stmt = insert_stmt.on_conflict_do_update(
            constraint="uq_price_bars_symbol_interval_date",
            set_=set_,
            where=and_(allowed, changed),
        ).returning(literal_column("(xmax = 0)", Boolean).label("inserted"))
        flags = [bool(r[0]) for r in (await session.execute(stmt)).all()]
        inserted = sum(flags)
        updated = len(flags) - inserted
        stats.add(BarUpsertStats(inserted=inserted, updated=updated, unchanged=len(chunk) - len(flags)))
    return stats


async def enrich_bars(session: AsyncSession, rows: Sequence[dict[str, Any]]) -> int:
    """Set ``turnover``, ``vwap`` and (official lot counts only) ``volume`` of existing bars.

    Keys: symbol, interval, bar_date, turnover, vwap, volume. OHLC is never touched;
    a ``None`` value keeps the stored one. ``volume`` is passed only with İş Yatırım's
    official lot count of a finished session (OneEndeks ``quantity``). Callers pass
    the rows that actually differ (the reconciliation compares first), so the whole
    batch is one ``executemany``. Returns the number of rows submitted. The caller commits.
    """
    params = [
        {
            "b_symbol": row["symbol"],
            "b_interval": str(row.get("interval") or "1d"),
            "b_bar_date": row["bar_date"],
            "b_turnover": row.get("turnover"),
            "b_vwap": row.get("vwap"),
            "b_volume": row.get("volume"),
        }
        for row in rows
        if row.get("turnover") is not None or row.get("vwap") is not None or row.get("volume") is not None
    ]
    if not params:
        return 0
    table = cast(Table, PriceBar.__table__)
    stmt = (
        update(table)
        .where(
            table.c.symbol == bindparam("b_symbol"),
            table.c.interval == bindparam("b_interval"),
            table.c.bar_date == bindparam("b_bar_date"),
        )
        .values(
            turnover=func.coalesce(bindparam("b_turnover", type_=table.c.turnover.type), table.c.turnover),
            vwap=func.coalesce(bindparam("b_vwap", type_=table.c.vwap.type), table.c.vwap),
            volume=func.coalesce(bindparam("b_volume", type_=table.c.volume.type), table.c.volume),
        )
    )
    await session.execute(stmt, params)
    return len(params)


@dataclass(frozen=True)
class Coverage:
    symbol: str
    first_date: date
    last_date: date
    bars: int
    last_final_date: date | None


class MarketBarRepository:
    """Read helpers over ``price_bars`` for the market store."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def series(
        self, symbol: str, *, since: date | None = None, until: date | None = None, interval: str = "1d"
    ) -> Sequence[PriceBar]:
        """Bars of ``symbol`` in ascending date order."""
        q = select(PriceBar).where(PriceBar.symbol == symbol, PriceBar.interval == interval)
        if since is not None:
            q = q.where(PriceBar.bar_date >= since)
        if until is not None:
            q = q.where(PriceBar.bar_date <= until)
        return (await self.session.execute(q.order_by(PriceBar.bar_date))).scalars().all()

    async def coverage(self, symbols: Sequence[str] | None = None, interval: str = "1d") -> dict[str, Coverage]:
        q = (
            select(
                PriceBar.symbol,
                func.min(PriceBar.bar_date),
                func.max(PriceBar.bar_date),
                func.count(),
                func.max(PriceBar.bar_date).filter(PriceBar.is_final.is_(True)),
            )
            .where(PriceBar.interval == interval)
            .group_by(PriceBar.symbol)
        )
        if symbols is not None:
            q = q.where(PriceBar.symbol.in_(list(symbols)))
        return {
            symbol: Coverage(symbol, first, last, int(count), last_final)
            for symbol, first, last, count, last_final in (await self.session.execute(q)).all()
        }

    async def last_final_bars(
        self, symbols: Sequence[str], *, before: date | None = None, interval: str = "1d"
    ) -> dict[str, PriceBar]:
        """Most recent final bar of every symbol, optionally strictly before ``before`` (continuity checks)."""
        if not symbols:
            return {}
        conditions = [PriceBar.symbol.in_(list(symbols)), PriceBar.interval == interval, PriceBar.is_final.is_(True)]
        if before is not None:
            conditions.append(PriceBar.bar_date < before)
        ranked = (
            select(
                PriceBar.id,
                func.row_number()
                .over(partition_by=PriceBar.symbol, order_by=PriceBar.bar_date.desc())
                .label("rn"),
            )
            .where(*conditions)
            .subquery()
        )
        q = select(PriceBar).join(ranked, and_(PriceBar.id == ranked.c.id, ranked.c.rn == 1))
        return {bar.symbol: bar for bar in (await self.session.execute(q)).scalars().all()}

    async def bars_on(self, symbols: Sequence[str], bar_dates: Sequence[date], interval: str = "1d") -> dict[tuple[str, date], PriceBar]:
        if not symbols or not bar_dates:
            return {}
        q = select(PriceBar).where(
            PriceBar.symbol.in_(list(symbols)),
            PriceBar.interval == interval,
            PriceBar.bar_date.in_(list(bar_dates)),
        )
        return {(bar.symbol, bar.bar_date): bar for bar in (await self.session.execute(q)).scalars().all()}


class QuoteRepository:
    """``quotes``: latest quote per symbol (stocks and indices)."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def upsert_many(self, rows: Iterable[dict[str, Any]]) -> int:
        """Insert/refresh quotes; an older provider time never overwrites a newer one.

        ``fetched_at`` is refreshed on every accepted write (it is the "checked at"
        time used for freshness). Returns the number of rows written. The caller commits.
        """
        deduped: dict[str, dict[str, Any]] = {}
        for row in rows:
            values = {column: row.get(column) for column in QUOTE_COLUMNS}
            if not values["symbol"] or not values["source"]:
                raise ValueError("quote rows need symbol and source")
            values["security_type"] = values["security_type"] or "stock"
            deduped[values["symbol"]] = values
        items = list(deduped.values())
        written = 0
        for start in range(0, len(items), _QUOTE_CHUNK):
            chunk = items[start : start + _QUOTE_CHUNK]
            insert_stmt = pg_insert(Quote).values(chunk)
            excluded = insert_stmt.excluded
            existing = Quote.__table__.c
            stmt = insert_stmt.on_conflict_do_update(
                index_elements=[existing.symbol],
                set_={
                    **{col: excluded[col] for col in QUOTE_COLUMNS if col not in ("symbol", "company_id")},
                    "company_id": func.coalesce(excluded.company_id, existing.company_id),
                    "fetched_at": func.now(),
                },
                where=or_(
                    existing.quote_time.is_(None),
                    excluded.quote_time.is_(None),
                    excluded.quote_time >= existing.quote_time,
                ),
            ).returning(existing.symbol)
            written += len((await self.session.execute(stmt)).all())
        return written

    async def get_many(self, symbols: Sequence[str]) -> dict[str, Quote]:
        if not symbols:
            return {}
        q = select(Quote).where(Quote.symbol.in_(list(symbols)))
        return {quote.symbol: quote for quote in (await self.session.execute(q)).scalars().all()}

    async def get(self, symbol: str) -> Quote | None:
        return await self.session.get(Quote, symbol)

    async def latest_session_date(self, security_type: str = "stock") -> date | None:
        """Most recent trading day seen in the stored quotes (holiday detection)."""
        q = select(func.max(Quote.session_date)).where(Quote.security_type == security_type)
        return (await self.session.execute(q)).scalar_one_or_none()


@dataclass(frozen=True)
class UniverseMember:
    ticker: str
    company_id: uuid.UUID
    tracking_tier: str
    security_type: str


async def active_universe(session: AsyncSession) -> list[UniverseMember]:
    """Active companies, ``core`` first then alphabetical (works before and after the universe sync)."""
    q = (
        select(Company.ticker, Company.id, Company.tracking_tier, Company.security_type)
        .where(Company.is_active.is_(True))
        .order_by(case((Company.tracking_tier == "core", 0), else_=1), Company.ticker)
    )
    return [UniverseMember(t, cid, tier or "universe", stype or "stock") for t, cid, tier, stype in (await session.execute(q)).all()]


async def company_ids(session: AsyncSession, symbols: Sequence[str]) -> dict[str, uuid.UUID]:
    if not symbols:
        return {}
    q = select(Company.ticker, Company.id).where(Company.ticker.in_(list(symbols)))
    return {ticker: cid for ticker, cid in (await session.execute(q)).all()}


async def paid_in_capitals(session: AsyncSession, symbols: Sequence[str] | None = None) -> dict[str, float]:
    """``companies.paid_in_capital`` (TL; read-only here — the column is the fundamentals store's)."""
    q = select(Company.ticker, Company.paid_in_capital).where(
        Company.paid_in_capital.is_not(None), Company.paid_in_capital > 0
    )
    if symbols is not None:
        q = q.where(Company.ticker.in_(list(symbols)))
    return {ticker: float(value) for ticker, value in (await session.execute(q)).all()}


# ---------------------------------------------------------------------------
# History markers (data_snapshots) — what the provider's history covers
# ---------------------------------------------------------------------------

@dataclass
class HistoryMarker:
    """Backfill bookkeeping of one symbol, persisted as a ``data_snapshots`` row.

    ``first_available`` is the oldest bar the provider returned for a request that
    started at ``requested_from`` — when it is later than the request, the listing
    is younger and older history does not exist. ``refresh`` asks the backfill to
    re-download the whole series (e.g. after a split re-adjusted it).
    """

    symbol: str
    first_available: date | None = None
    requested_from: date | None = None
    bars: int = 0
    refresh: bool = False
    reason: str | None = None
    checked_at: datetime | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def to_payload(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "first_available": self.first_available.isoformat() if self.first_available else None,
            "requested_from": self.requested_from.isoformat() if self.requested_from else None,
            "bars": self.bars,
            "refresh": self.refresh,
            "reason": self.reason,
            **({"extra": self.extra} if self.extra else {}),
        }

    @classmethod
    def from_row(cls, row: DataSnapshot) -> HistoryMarker:
        payload = row.payload or {}

        def _date(key: str) -> date | None:
            value = payload.get(key)
            try:
                return date.fromisoformat(value) if isinstance(value, str) else None
            except ValueError:
                return None

        return cls(
            symbol=str(payload.get("symbol") or row.key.removeprefix(HISTORY_MARKER_PREFIX)),
            first_available=_date("first_available"),
            requested_from=_date("requested_from"),
            bars=int(payload.get("bars") or 0),
            refresh=bool(payload.get("refresh")),
            reason=payload.get("reason"),
            checked_at=row.fetched_at,
            extra=dict(payload.get("extra") or {}),
        )


async def save_snapshot(session: AsyncSession, key: str, kind: str, payload: dict[str, Any], source: str) -> None:
    """Upsert one ``data_snapshots`` row (the market store only writes ``market.*`` keys)."""
    stmt = pg_insert(DataSnapshot).values(key=key, kind=kind, payload=payload, source=source)
    stmt = stmt.on_conflict_do_update(
        index_elements=[DataSnapshot.__table__.c.key],
        set_={"payload": stmt.excluded.payload, "source": stmt.excluded.source, "fetched_at": func.now()},
    )
    await session.execute(stmt)


async def load_snapshot(session: AsyncSession, key: str) -> DataSnapshot | None:
    return await session.get(DataSnapshot, key)


class HistoryMarkerRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_many(self, symbols: Sequence[str] | None = None) -> dict[str, HistoryMarker]:
        q = select(DataSnapshot).where(DataSnapshot.kind == HISTORY_MARKER_KIND)
        if symbols is not None:
            q = q.where(DataSnapshot.key.in_([f"{HISTORY_MARKER_PREFIX}{s}" for s in symbols]))
        markers = [HistoryMarker.from_row(row) for row in (await self.session.execute(q)).scalars().all()]
        return {marker.symbol: marker for marker in markers}

    async def save(self, marker: HistoryMarker, source: str = "tradingview") -> None:
        await save_snapshot(
            self.session, f"{HISTORY_MARKER_PREFIX}{marker.symbol}", HISTORY_MARKER_KIND, marker.to_payload(), source
        )

    async def save_if_missing(self, marker: HistoryMarker, source: str = "tradingview") -> None:
        """Insert a marker unless the symbol already has one (live reads never clobber backfill state)."""
        stmt = (
            pg_insert(DataSnapshot)
            .values(
                key=f"{HISTORY_MARKER_PREFIX}{marker.symbol}",
                kind=HISTORY_MARKER_KIND,
                payload=marker.to_payload(),
                source=source,
            )
            .on_conflict_do_nothing(index_elements=[DataSnapshot.__table__.c.key])
        )
        await self.session.execute(stmt)

    async def request_refresh(self, symbol: str, reason: str) -> None:
        """Flag ``symbol`` for a full re-download (keeps the other marker fields)."""
        current = (await self.get_many([symbol])).get(symbol) or HistoryMarker(symbol=symbol)
        current.refresh = True
        current.reason = reason
        await self.save(current)

    async def merge_extra(self, symbol: str, patch: dict[str, Any], source: str = "tradingview") -> None:
        """Merge ``patch`` into the marker's ``extra`` in one statement (other fields untouched;
        creates the marker when missing). Used for progress bookkeeping that must not race with
        :meth:`request_refresh` / the history backfill."""
        payload = HistoryMarker(symbol=symbol, extra=dict(patch)).to_payload()
        stmt = text(
            "INSERT INTO data_snapshots (key, kind, payload, source, fetched_at) "
            "VALUES (:key, :kind, CAST(:payload AS jsonb), :source, now()) "
            "ON CONFLICT (key) DO UPDATE SET payload = jsonb_set(data_snapshots.payload, '{extra}', "
            "COALESCE(data_snapshots.payload -> 'extra', '{}'::jsonb) || CAST(:patch AS jsonb))"
        )
        await self.session.execute(
            stmt,
            {
                "key": f"{HISTORY_MARKER_PREFIX}{symbol}",
                "kind": HISTORY_MARKER_KIND,
                "payload": json.dumps(payload),
                "source": source,
                "patch": json.dumps(patch),
            },
        )


# ---------------------------------------------------------------------------
# Data quality rows (cross-source checks written by the market worker)
# ---------------------------------------------------------------------------

def quality_check(
    check_name: str,
    status: str,
    *,
    subject: str | None = None,
    expected: float | None = None,
    actual: float | None = None,
    deviation: float | None = None,
    details: dict[str, Any] | None = None,
) -> DataQualityCheck:
    """A ``data_quality_checks`` row (``status``: pass | warn | fail)."""
    if status not in ("pass", "warn", "fail"):
        raise ValueError(f"invalid quality status: {status}")
    return DataQualityCheck(
        check_name=check_name[:80],
        subject=subject[:60] if subject else None,
        status=status,
        expected=expected,
        actual=actual,
        deviation=deviation,
        details_json=details,
    )
