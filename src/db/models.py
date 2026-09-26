"""SQLAlchemy 2.0 ORM models (typed ``Mapped[...]`` declarations).

The schema is owned by the Alembic migrations in ``alembic/versions``; every change
here must ship with a migration (``alembic revision --autogenerate`` should produce
an empty diff against a database at ``head``).

Data platform conventions (migration 020):

* Every persisted upstream payload carries provenance: ``source`` (short provider
  code such as ``tradingview``, ``isyatirim``, ``kap``, ``tcmb``, ``evds``) and
  ``fetched_at`` (when we received it). Observation dates (``bar_date``,
  ``observation_date``, ``as_of``) are the *data's* dates, never fetch times.
* Money is stored in full TL (``Numeric``), percentages as percent values
  (``14.85`` = %14,85), share counts as whole numbers.
* Period labels are KAP style ``"YYYY/MM"`` (``"2026/06"``); statement types keep
  the historical API values ``balance_sheet`` / ``income_stmt`` / ``cash_flow``.
* Symbols are BIST codes without suffixes (``THYAO``, ``XU100``).
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.core.enums import (
    EventCategory,
    EventType,
    NotificationChannel,
    NotificationFrequency,
    NotificationProvider,
    NotificationStatus,
    OutboxStatus,
    Severity,
    SourceKind,
)


class Base(DeclarativeBase):
    pass


def _pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def _created_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


def _updated_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


def _fetched_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


def _money() -> Mapped[Decimal | None]:
    """Full-TL amount (statements, market caps, turnover)."""
    return mapped_column(Numeric(22, 2), nullable=True)


def _price() -> Mapped[Decimal | None]:
    return mapped_column(Numeric(14, 4), nullable=True)


def _ratio() -> Mapped[Decimal | None]:
    return mapped_column(Numeric(14, 4), nullable=True)


# ---------------------------------------------------------------------------
# Reference: companies, indices
# ---------------------------------------------------------------------------

TRACKING_TIERS = ("core", "universe")
LISTING_STATUSES = ("listed", "suspended", "delisted")


class Company(Base):
    """One BIST-listed security (stock or closed-end fund).

    ``tracking_tier``: ``core`` companies (BIST 100) are polled per company for
    KAP disclosures, news and daily statement refreshes; the rest of the
    ``universe`` is served by bulk feeds (quotes, bars, index membership) and
    on-demand fetches.
    """

    __tablename__ = "companies"
    __table_args__ = (
        CheckConstraint("tracking_tier IN ('core', 'universe')", name="ck_companies_tracking_tier"),
        CheckConstraint("listing_status IN ('listed', 'suspended', 'delisted')", name="ck_companies_listing_status"),
        Index("ix_companies_tracking_tier", "tracking_tier"),
    )

    id: Mapped[uuid.UUID] = _pk()
    ticker: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, index=True)
    legal_name: Mapped[str] = mapped_column(String(500), nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    isin: Mapped[str | None] = mapped_column(String(20), nullable=True)
    exchange: Mapped[str | None] = mapped_column(String(20), nullable=True)
    aliases: Mapped[list[str] | None] = mapped_column(JSONB, default=list, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # --- reference data (migration 020) ---
    kap_member_oid: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sector: Mapped[str | None] = mapped_column(String(200), nullable=True)  # KAP sector
    industry: Mapped[str | None] = mapped_column(String(200), nullable=True)  # TradingView industry (tr)
    market_segment: Mapped[str | None] = mapped_column(String(100), nullable=True)  # KAP "pazar"
    website: Mapped[str | None] = mapped_column(String(300), nullable=True)
    security_type: Mapped[str] = mapped_column(String(20), default="stock", server_default="stock", nullable=False)
    fiscal_year_end_month: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    statement_template: Mapped[str | None] = mapped_column(String(20), nullable=True)  # industrial|bank|financial
    paid_in_capital: Mapped[Decimal | None] = _money()  # TL nominal = shares outstanding (1 TL nominal)
    free_float_pct: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    foreign_ratio_pct: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    listing_status: Mapped[str] = mapped_column(String(20), default="listed", server_default="listed", nullable=False)
    tracking_tier: Mapped[str] = mapped_column(
        String(20), default="universe", server_default="universe", nullable=False
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reference_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    raw_events: Mapped[list[RawEvent]] = relationship(back_populates="company")
    normalized_events: Mapped[list[NormalizedEvent]] = relationship(back_populates="company")
    price_bars: Mapped[list[PriceBar]] = relationship(back_populates="company")
    notification_rules: Mapped[list[NotificationRule]] = relationship(back_populates="company")
    financial_statements: Mapped[list[FinancialStatement]] = relationship(back_populates="company")
    financial_ratios: Mapped[list[FinancialRatio]] = relationship(back_populates="company")


class MarketIndex(Base):
    """BIST index catalogue (Borsa İstanbul constituent file)."""

    __tablename__ = "market_indices"

    code: Mapped[str] = mapped_column(String(10), primary_key=True)
    name_tr: Mapped[str | None] = mapped_column(String(200), nullable=True)
    name_en: Mapped[str | None] = mapped_column(String(200), nullable=True)
    as_of: Mapped[date | None] = mapped_column(Date, nullable=True)
    fetched_at: Mapped[datetime] = _fetched_at()


class IndexMembership(Base):
    """Current constituents of every BIST index (one row per index × ticker)."""

    __tablename__ = "index_memberships"
    __table_args__ = (
        UniqueConstraint("index_code", "ticker", name="uq_index_memberships_index_ticker"),
        Index("ix_index_memberships_ticker", "ticker"),
    )

    id: Mapped[uuid.UUID] = _pk()
    index_code: Mapped[str] = mapped_column(String(10), nullable=False)
    ticker: Mapped[str] = mapped_column(String(20), nullable=False)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=True)
    as_of: Mapped[date | None] = mapped_column(Date, nullable=True)
    source: Mapped[str] = mapped_column(String(30), default="borsaistanbul", nullable=False)
    fetched_at: Mapped[datetime] = _fetched_at()


# ---------------------------------------------------------------------------
# Ingestion sources (polling) — unchanged
# ---------------------------------------------------------------------------

class Source(Base):
    __tablename__ = "sources"

    id: Mapped[uuid.UUID] = _pk()
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    base_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    kind: Mapped[SourceKind] = mapped_column(SAEnum(SourceKind), nullable=False)
    poll_interval_seconds: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    polling_state: Mapped[PollingState | None] = relationship(back_populates="source", uselist=False)
    raw_events: Mapped[list[RawEvent]] = relationship(back_populates="source")


class PollingState(Base):
    __tablename__ = "polling_state"

    id: Mapped[uuid.UUID] = _pk()
    source_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sources.id"), unique=True, nullable=False
    )
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_external_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    last_seen_published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    etag: Mapped[str | None] = mapped_column(String(200), nullable=True)
    last_modified: Mapped[str | None] = mapped_column(String(200), nullable=True)
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = _updated_at()

    source: Mapped[Source] = relationship(back_populates="polling_state")


# ---------------------------------------------------------------------------
# KAP disclosures / events — unchanged (owned by the KAP pipeline)
# ---------------------------------------------------------------------------

class RawEvent(Base):
    __tablename__ = "raw_events"
    __table_args__ = (
        # Per company: one KAP disclosure can list several stock codes (migration 006).
        UniqueConstraint("source_id", "company_id", "content_hash", name="uq_raw_events_source_company_hash"),
        Index("ix_raw_events_published_at", "published_at"),
    )

    id: Mapped[uuid.UUID] = _pk()
    source_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sources.id"), nullable=False)
    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    external_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    canonical_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    source_event_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    title: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    raw_payload_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    raw_payload_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    attachment_urls: Mapped[list[str] | None] = mapped_column(JSONB, default=list, nullable=True)
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    headers_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = _created_at()

    source: Mapped[Source] = relationship(back_populates="raw_events")
    company: Mapped[Company] = relationship(back_populates="raw_events")
    normalized_event: Mapped[NormalizedEvent | None] = relationship(back_populates="raw_event", uselist=False)


class NormalizedEvent(Base):
    __tablename__ = "normalized_events"
    __table_args__ = (
        Index("ix_normalized_events_published_at", "published_at"),
        Index("ix_normalized_events_event_type", "event_type"),
        # /events filters: ticker, severity and category, each ordered by published_at
        Index("ix_normalized_events_company_published", "company_id", "published_at"),
        Index("ix_normalized_events_severity_published", "severity", "published_at"),
        Index("ix_normalized_events_category_published", "category", "published_at"),
        # One KAP disclosure = one row per concerned company; /events groups rows by URL.
        Index("ix_normalized_events_event_url", "event_url"),
    )

    id: Mapped[uuid.UUID] = _pk()
    raw_event_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("raw_events.id"), nullable=False)
    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    event_type: Mapped[EventType] = mapped_column(SAEnum(EventType), nullable=False)
    title: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    body_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Always set (falls back to the ingestion time, flagged in metadata_json).
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    event_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    source_code: Mapped[str] = mapped_column(String(50), nullable=False)
    severity: Mapped[Severity] = mapped_column(SAEnum(Severity), nullable=False, default=Severity.INFO)
    is_notifiable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    category: Mapped[EventCategory | None] = mapped_column(
        SAEnum(EventCategory), nullable=True, default=EventCategory.OTHER
    )
    dedup_key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=dict, nullable=True)
    # Full disclosure text as display blocks, fetched from KAP on first view (deferred:
    # list queries never load it; read it with an explicit select).
    content_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True, deferred=True)
    content_fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    raw_event: Mapped[RawEvent] = relationship(back_populates="normalized_event")
    company: Mapped[Company] = relationship(back_populates="normalized_events")
    outbox_entries: Mapped[list[EventOutbox]] = relationship(back_populates="normalized_event")

    @property
    def ticker(self) -> str | None:
        return self.company.ticker if self.company else None

    # --- API display helpers (read by EventOut via from_attributes) -------------------

    @property
    def company_name(self) -> str | None:
        return self.company.display_name if self.company else None

    @property
    def tickers(self) -> list[str]:
        """Every tracked company of this disclosure (set by the /events queries), else ``ticker``."""
        related = self.__dict__.get("_related_tickers")
        if related:
            return list(related)
        return [self.ticker] if self.ticker else []

    def set_related_tickers(self, tickers: Iterable[str]) -> None:
        self.__dict__["_related_tickers"] = sorted({t for t in tickers if t})

    @property
    def summary(self) -> str | None:
        """KAP's free-text headline when it says more than the form name (``title``)."""
        excerpt = (self.excerpt or "").strip()
        if not excerpt or excerpt.casefold() == (self.title or "").strip().casefold():
            return None
        return excerpt

    @property
    def category_code(self) -> str | None:
        return self.category.name if self.category is not None else None

    def _meta(self) -> dict[str, Any]:
        return self.metadata_json if isinstance(self.metadata_json, dict) else {}

    @property
    def publisher(self) -> str | None:
        value = self._meta().get("publisher")
        return value if isinstance(value, str) and value else None

    @property
    def is_correction(self) -> bool:
        return self._meta().get("is_correction") is True

    @property
    def attachment_count(self) -> int | None:
        value = self._meta().get("attachment_count")
        return value if isinstance(value, int) and value > 0 else None


# ---------------------------------------------------------------------------
# Market data: quotes, bars
# ---------------------------------------------------------------------------

class Quote(Base):
    """Latest quote per symbol (stocks and indices), refreshed by the market worker.

    ``quote_time`` is the exchange/update time reported by the provider; the free
    TradingView feed is ~15 minutes delayed (``delay_seconds``). ``session_date`` is
    the Istanbul trading day the quote belongs to.
    """

    __tablename__ = "quotes"
    __table_args__ = (Index("ix_quotes_company_id", "company_id"),)

    symbol: Mapped[str] = mapped_column(String(20), primary_key=True)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=True)
    security_type: Mapped[str] = mapped_column(String(20), default="stock", server_default="stock", nullable=False)
    name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(5), nullable=True)
    last: Mapped[Decimal | None] = _price()
    open: Mapped[Decimal | None] = _price()
    high: Mapped[Decimal | None] = _price()
    low: Mapped[Decimal | None] = _price()
    prev_close: Mapped[Decimal | None] = _price()
    change: Mapped[Decimal | None] = mapped_column(Numeric(14, 6), nullable=True)
    change_pct: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    volume: Mapped[Decimal | None] = mapped_column(Numeric(20, 0), nullable=True)
    turnover: Mapped[Decimal | None] = _money()
    market_cap: Mapped[Decimal | None] = _money()
    bid: Mapped[Decimal | None] = _price()
    ask: Mapped[Decimal | None] = _price()
    source: Mapped[str] = mapped_column(String(30), nullable=False)
    delay_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    quote_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    session_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    fetched_at: Mapped[datetime] = _fetched_at()


class PriceBar(Base):
    """One OHLCV bar per (symbol, interval, bar_date); a single series per symbol.

    Daily bars come from TradingView (split/bonus-issue adjusted, ``adjusted``)
    and are reconciled against İş Yatırım's official daily history, which also
    supplies ``turnover`` (TL) and ``vwap``. ``is_final`` is false only for the
    running session's bar.
    """

    __tablename__ = "price_bars"
    __table_args__ = (
        UniqueConstraint("symbol", "interval", "bar_date", name="uq_price_bars_symbol_interval_date"),
        Index("ix_price_bars_company_id", "company_id"),
    )

    id: Mapped[uuid.UUID] = _pk()
    symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=True)
    interval: Mapped[str] = mapped_column(String(5), default="1d", server_default="1d", nullable=False)
    bar_date: Mapped[date] = mapped_column(Date, nullable=False)
    open: Mapped[Decimal | None] = _price()
    high: Mapped[Decimal | None] = _price()
    low: Mapped[Decimal | None] = _price()
    close: Mapped[Decimal | None] = _price()
    volume: Mapped[Decimal | None] = mapped_column(Numeric(20, 0), nullable=True)
    turnover: Mapped[Decimal | None] = _money()
    vwap: Mapped[Decimal | None] = _price()
    source: Mapped[str] = mapped_column(String(30), nullable=False)
    adjusted: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    is_final: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    fetched_at: Mapped[datetime] = _fetched_at()

    company: Mapped[Company | None] = relationship(back_populates="price_bars")

    # Historical API names (``PriceOut``): ticker / trading_date / adjusted_close.
    @property
    def ticker(self) -> str:
        return self.symbol

    @property
    def trading_date(self) -> date:
        return self.bar_date

    @property
    def adjusted_close(self) -> Decimal | None:
        return self.close if self.adjusted else None


# ---------------------------------------------------------------------------
# Fundamentals: statements, canonical facts, ratios
# ---------------------------------------------------------------------------

class FinancialStatement(Base):
    """One statement of one period from one source, as reported (line items in order).

    ``items_json`` is a list of ``{"code": str | None, "label": str, "key": str,
    "value": float | None}`` rows (``key`` = ``normalize_label(label)``); values are
    full TL. ``restated`` marks İş Yatırım's IAS 29 re-expressed year-end columns;
    ``restatement_factor`` (KAP ÷ İş Yatırım) converts them back to reported values.
    """

    __tablename__ = "financial_statements"
    __table_args__ = (
        UniqueConstraint("company_id", "source", "period", "statement_type", name="uq_financial_statements_key"),
        Index("ix_financial_statements_company_period", "company_id", "period"),
        Index("ix_financial_statements_period", "period"),
    )

    id: Mapped[uuid.UUID] = _pk()
    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False)  # kap | isyatirim
    period: Mapped[str] = mapped_column(String(20), nullable=False)  # "YYYY/MM"
    statement_type: Mapped[str] = mapped_column(String(50), nullable=False)  # balance_sheet | income_stmt | cash_flow
    fiscal_year_end_month: Mapped[int] = mapped_column(SmallInteger, default=12, server_default="12", nullable=False)
    months: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)  # months covered by flow figures
    period_type: Mapped[str | None] = mapped_column(String(20), nullable=True)  # annual | interim
    template: Mapped[str | None] = mapped_column(String(20), nullable=True)  # industrial | bank | financial
    consolidation: Mapped[str | None] = mapped_column(String(80), nullable=True)
    presentation_unit: Mapped[str | None] = mapped_column(String(40), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(10), default="TRY", nullable=True)
    restated: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    restatement_factor: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    items_json: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    source_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    published_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    fetched_at: Mapped[datetime] = _fetched_at()
    created_at: Mapped[datetime] = _created_at()

    company: Mapped[Company] = relationship(back_populates="financial_statements")

    @property
    def data_json(self) -> dict[str, Any]:
        """``{label: value}`` view of the line items (historical ``/financials`` shape)."""
        result: dict[str, Any] = {}
        for item in self.items_json or []:
            label = str(item.get("label") or "")
            if label and label not in result:
                result[label] = item.get("value")
        return result


class FinancialFact(Base):
    """Canonical statement items per (company, period), as reported (KAP basis).

    Flow items are cumulative from the fiscal year start (KAP convention) —
    ``months`` tells how many months they cover; TTM and discrete quarters are
    derived from these rows (``src.adapters.financial_adapter``).
    """

    __tablename__ = "financial_facts"
    __table_args__ = (
        UniqueConstraint("company_id", "period", name="uq_financial_facts_period"),
        Index("ix_financial_facts_period", "period"),
    )

    id: Mapped[uuid.UUID] = _pk()
    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    period: Mapped[str] = mapped_column(String(20), nullable=False)
    fiscal_year_end_month: Mapped[int] = mapped_column(SmallInteger, default=12, server_default="12", nullable=False)
    months: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    template: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # flows (cumulative YTD)
    revenue: Mapped[Decimal | None] = _money()
    gross_profit: Mapped[Decimal | None] = _money()
    operating_profit: Mapped[Decimal | None] = _money()
    net_income: Mapped[Decimal | None] = _money()
    net_income_parent: Mapped[Decimal | None] = _money()
    net_interest_income: Mapped[Decimal | None] = _money()
    depreciation_amortization: Mapped[Decimal | None] = _money()
    operating_cash_flow: Mapped[Decimal | None] = _money()
    investing_cash_flow: Mapped[Decimal | None] = _money()
    financing_cash_flow: Mapped[Decimal | None] = _money()
    capex: Mapped[Decimal | None] = _money()
    free_cash_flow: Mapped[Decimal | None] = _money()
    # stocks (period end)
    total_assets: Mapped[Decimal | None] = _money()
    current_assets: Mapped[Decimal | None] = _money()
    current_liabilities: Mapped[Decimal | None] = _money()
    non_current_liabilities: Mapped[Decimal | None] = _money()
    total_liabilities: Mapped[Decimal | None] = _money()
    total_equity: Mapped[Decimal | None] = _money()
    parent_equity: Mapped[Decimal | None] = _money()
    minority_interest: Mapped[Decimal | None] = _money()
    paid_in_capital: Mapped[Decimal | None] = _money()
    cash: Mapped[Decimal | None] = _money()
    short_term_investments: Mapped[Decimal | None] = _money()
    financial_debt: Mapped[Decimal | None] = _money()
    deposits: Mapped[Decimal | None] = _money()
    # provenance: {"balance": "kap", "income": "kap", "cashflow": "isyatirim", ...}
    sources_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    computed_at: Mapped[datetime] = _fetched_at()


class FinancialRatio(Base):
    """Ratios per (company, period, basis); ``basis`` is ``ttm`` (flows = last four
    quarters ending at ``period``) or ``annual`` (fiscal-year figures).

    Valuation multiples use ``market_cap`` = ``price`` × ``shares_outstanding``
    at ``calculated_at``; they are ``None`` when no price was available.
    """

    __tablename__ = "financial_ratios"
    __table_args__ = (
        CheckConstraint("basis IN ('ttm', 'annual')", name="ck_financial_ratios_basis"),
        UniqueConstraint("company_id", "period", "basis", name="uq_financial_ratios_period_basis"),
        Index("ix_financial_ratios_period", "period"),
    )

    id: Mapped[uuid.UUID] = _pk()
    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    period: Mapped[str] = mapped_column(String(20), nullable=False)
    basis: Mapped[str] = mapped_column(String(10), default="annual", server_default="annual", nullable=False)
    gross_margin: Mapped[Decimal | None] = _ratio()
    operating_margin: Mapped[Decimal | None] = _ratio()
    ebitda_margin: Mapped[Decimal | None] = _ratio()
    net_margin: Mapped[Decimal | None] = _ratio()
    roe: Mapped[Decimal | None] = _ratio()
    roa: Mapped[Decimal | None] = _ratio()
    current_ratio: Mapped[Decimal | None] = _ratio()
    net_debt_ebitda: Mapped[Decimal | None] = _ratio()
    debt_to_equity: Mapped[Decimal | None] = _ratio()
    pe_ratio: Mapped[Decimal | None] = _ratio()
    pb_ratio: Mapped[Decimal | None] = _ratio()
    ps_ratio: Mapped[Decimal | None] = _ratio()
    ev_ebitda: Mapped[Decimal | None] = _ratio()
    revenue_growth_yoy: Mapped[Decimal | None] = _ratio()
    net_income_growth_yoy: Mapped[Decimal | None] = _ratio()
    market_cap: Mapped[Decimal | None] = _money()
    price: Mapped[Decimal | None] = _price()
    shares_outstanding: Mapped[Decimal | None] = mapped_column(Numeric(20, 0), nullable=True)
    shares_source: Mapped[str | None] = mapped_column(String(20), nullable=True)
    ttm_quarters: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    raw_ratios_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=dict, nullable=True)
    inputs_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    calculated_at: Mapped[datetime] = _fetched_at()

    company: Mapped[Company] = relationship(back_populates="financial_ratios")


# ---------------------------------------------------------------------------
# Company reference data
# ---------------------------------------------------------------------------

class Dividend(Base):
    """Cash dividend (rates are % of the 1 TL nominal share; amounts TL per share)."""

    __tablename__ = "dividends"
    __table_args__ = (
        UniqueConstraint("company_id", "source", "ex_date", "gross_rate_pct", name="uq_dividends_key"),
        Index("ix_dividends_company_date", "company_id", "ex_date"),
    )

    id: Mapped[uuid.UUID] = _pk()
    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    ex_date: Mapped[date] = mapped_column(Date, nullable=False)
    payment_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    gross_rate_pct: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=Decimal("0"), nullable=False)
    net_rate_pct: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    gross_per_share: Mapped[Decimal | None] = mapped_column(Numeric(14, 6), nullable=True)
    net_per_share: Mapped[Decimal | None] = mapped_column(Numeric(14, 6), nullable=True)
    total_amount: Mapped[Decimal | None] = _money()
    source: Mapped[str] = mapped_column(String(30), nullable=False)
    fetched_at: Mapped[datetime] = _fetched_at()


class CapitalIncrease(Base):
    """Bonus (``bedelsiz``), rights (``bedelli``) and other capital changes."""

    __tablename__ = "capital_increases"
    __table_args__ = (
        UniqueConstraint("company_id", "source", "event_date", "kind", name="uq_capital_increases_key"),
        Index("ix_capital_increases_company_date", "company_id", "event_date"),
    )

    id: Mapped[uuid.UUID] = _pk()
    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    event_date: Mapped[date] = mapped_column(Date, nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)  # bonus | rights | private | other
    bonus_rate_pct: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    rights_rate_pct: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    rights_price: Mapped[Decimal | None] = _price()
    capital_before: Mapped[Decimal | None] = _money()
    capital_after: Mapped[Decimal | None] = _money()
    source: Mapped[str] = mapped_column(String(30), nullable=False)
    fetched_at: Mapped[datetime] = _fetched_at()


class Shareholder(Base):
    """Ownership structure (replaced wholesale on every refresh of a company)."""

    __tablename__ = "shareholders"
    __table_args__ = (
        UniqueConstraint("company_id", "source", "holder_name", name="uq_shareholders_key"),
    )

    id: Mapped[uuid.UUID] = _pk()
    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    holder_name: Mapped[str] = mapped_column(String(300), nullable=False)
    share_pct: Mapped[Decimal | None] = mapped_column(Numeric(8, 4), nullable=True)
    as_of: Mapped[date | None] = mapped_column(Date, nullable=True)
    source: Mapped[str] = mapped_column(String(30), nullable=False)
    fetched_at: Mapped[datetime] = _fetched_at()


class AnalystTarget(Base):
    """Latest analyst consensus per (company, source)."""

    __tablename__ = "analyst_targets"
    __table_args__ = (UniqueConstraint("company_id", "source", name="uq_analyst_targets_key"),)

    id: Mapped[uuid.UUID] = _pk()
    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    source: Mapped[str] = mapped_column(String(30), nullable=False)
    as_of: Mapped[date | None] = mapped_column(Date, nullable=True)
    target_low: Mapped[Decimal | None] = _price()
    target_high: Mapped[Decimal | None] = _price()
    target_mean: Mapped[Decimal | None] = _price()
    target_median: Mapped[Decimal | None] = _price()
    analysts_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recommendation: Mapped[str | None] = mapped_column(String(30), nullable=True)
    upside_pct: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    fetched_at: Mapped[datetime] = _fetched_at()


class ExpectedDisclosure(Base):
    """KAP expected-disclosure calendar (financial report windows etc.)."""

    __tablename__ = "expected_disclosures"
    __table_args__ = (
        UniqueConstraint("company_id", "dedup_key", name="uq_expected_disclosures_key"),
        Index("ix_expected_disclosures_company_start", "company_id", "start_date"),
    )

    id: Mapped[uuid.UUID] = _pk()
    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    period_term: Mapped[str | None] = mapped_column(String(80), nullable=True)
    fiscal_year: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    dedup_key: Mapped[str] = mapped_column(String(64), nullable=False)  # sha256 of the natural key
    source: Mapped[str] = mapped_column(String(20), default="kap", server_default="kap", nullable=False)
    fetched_at: Mapped[datetime] = _fetched_at()


# ---------------------------------------------------------------------------
# Macro series
# ---------------------------------------------------------------------------

class MacroObservation(Base):
    """One observation of a macro series (``tcmb.policy_rate``, ``tuik.cpi.yoy`` ...)."""

    __tablename__ = "macro_series"
    __table_args__ = (
        UniqueConstraint("series_code", "observation_date", name="uq_macro_series_key"),
        Index("ix_macro_series_code_date", "series_code", "observation_date"),
    )

    id: Mapped[uuid.UUID] = _pk()
    series_code: Mapped[str] = mapped_column(String(60), nullable=False)
    observation_date: Mapped[date] = mapped_column(Date, nullable=False)
    value: Mapped[Decimal] = mapped_column(Numeric(20, 6), nullable=False)
    source: Mapped[str] = mapped_column(String(30), nullable=False)
    fetched_at: Mapped[datetime] = _fetched_at()


class FxBulletin(Base):
    """TCMB indicative daily bulletin, per currency, normalised to one unit."""

    __tablename__ = "fx_bulletins"
    __table_args__ = (
        UniqueConstraint("bulletin_date", "currency", name="uq_fx_bulletins_key"),
        Index("ix_fx_bulletins_currency_date", "currency", "bulletin_date"),
    )

    id: Mapped[uuid.UUID] = _pk()
    bulletin_date: Mapped[date] = mapped_column(Date, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    quoted_unit: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    forex_buying: Mapped[Decimal | None] = mapped_column(Numeric(14, 6), nullable=True)
    forex_selling: Mapped[Decimal | None] = mapped_column(Numeric(14, 6), nullable=True)
    banknote_buying: Mapped[Decimal | None] = mapped_column(Numeric(14, 6), nullable=True)
    banknote_selling: Mapped[Decimal | None] = mapped_column(Numeric(14, 6), nullable=True)
    source: Mapped[str] = mapped_column(String(20), default="tcmb", server_default="tcmb", nullable=False)
    fetched_at: Mapped[datetime] = _fetched_at()


# ---------------------------------------------------------------------------
# Platform: last-good payload store, ingestion runs, data quality
# ---------------------------------------------------------------------------

class DataSnapshot(Base):
    """Last good copy of a live payload (stale-serve when the upstream is down).

    ``key`` identifies the payload (``"ta_bundle:THYAO"``); ``expires_at`` is the
    freshness horizon — after it the copy is still served, flagged ``stale``.
    """

    __tablename__ = "data_snapshots"
    __table_args__ = (Index("ix_data_snapshots_kind", "kind"),)

    key: Mapped[str] = mapped_column(String(200), primary_key=True)
    kind: Mapped[str] = mapped_column(String(50), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    source: Mapped[str | None] = mapped_column(String(60), nullable=True)
    fetched_at: Mapped[datetime] = _fetched_at()
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class IngestionRun(Base):
    """One execution of an ingestion job (worker loop cycle or admin trigger)."""

    __tablename__ = "ingestion_runs"
    __table_args__ = (
        CheckConstraint("status IN ('running', 'ok', 'partial', 'failed')", name="ck_ingestion_runs_status"),
        Index("ix_ingestion_runs_job_started", "job", "started_at"),
    )

    id: Mapped[uuid.UUID] = _pk()
    job: Mapped[str] = mapped_column(String(60), nullable=False)
    scope: Mapped[str | None] = mapped_column(String(80), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="running", server_default="running", nullable=False)
    items_total: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    items_ok: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    items_failed: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    details_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)


class DataQualityCheck(Base):
    """Result of a cross-source / consistency check (``pass`` | ``warn`` | ``fail``)."""

    __tablename__ = "data_quality_checks"
    __table_args__ = (
        CheckConstraint("status IN ('pass', 'warn', 'fail')", name="ck_data_quality_checks_status"),
        Index("ix_data_quality_checks_name_time", "check_name", "checked_at"),
        Index("ix_data_quality_checks_status_time", "status", "checked_at"),
    )

    id: Mapped[uuid.UUID] = _pk()
    check_name: Mapped[str] = mapped_column(String(80), nullable=False)
    subject: Mapped[str | None] = mapped_column(String(60), nullable=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False)
    expected: Mapped[Decimal | None] = mapped_column(Numeric(24, 6), nullable=True)
    actual: Mapped[Decimal | None] = mapped_column(Numeric(24, 6), nullable=True)
    deviation: Mapped[Decimal | None] = mapped_column(Numeric(16, 6), nullable=True)
    details_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ---------------------------------------------------------------------------
# Notifications (outbox) — unchanged
# ---------------------------------------------------------------------------

class EventOutbox(Base):
    __tablename__ = "event_outbox"
    __table_args__ = (
        # claim_pending: WHERE status = 'PENDING' ORDER BY created_at
        Index("ix_event_outbox_status_created", "status", "created_at"),
    )

    id: Mapped[uuid.UUID] = _pk()
    normalized_event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("normalized_events.id"), nullable=False
    )
    event_name: Mapped[str] = mapped_column(String(100), default="NEW_COMPANY_EVENT", nullable=False)
    payload_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[OutboxStatus] = mapped_column(
        SAEnum(OutboxStatus), default=OutboxStatus.PENDING, nullable=False, index=True
    )
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Retry backoff: a pending entry is not claimed before this instant (NULL = now).
    available_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    normalized_event: Mapped[NormalizedEvent] = relationship(back_populates="outbox_entries")
    notifications: Mapped[list[Notification]] = relationship(back_populates="outbox_entry")


class NotificationRule(Base):
    __tablename__ = "notification_rules"

    id: Mapped[uuid.UUID] = _pk()
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    channel: Mapped[NotificationChannel] = mapped_column(
        SAEnum(NotificationChannel), default=NotificationChannel.EMAIL, nullable=False
    )
    frequency: Mapped[NotificationFrequency] = mapped_column(
        SAEnum(NotificationFrequency), default=NotificationFrequency.INSTANT, nullable=False
    )
    source_filters: Mapped[list[str] | None] = mapped_column(JSONB, default=list, nullable=True)
    min_severity: Mapped[Severity] = mapped_column(SAEnum(Severity), default=Severity.INFO, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    company: Mapped[Company] = relationship(back_populates="notification_rules")


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        UniqueConstraint("normalized_event_id", "email", name="uq_notification_event_email"),
    )

    id: Mapped[uuid.UUID] = _pk()
    rule_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("notification_rules.id"), nullable=False)
    outbox_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("event_outbox.id"), nullable=False)
    normalized_event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("normalized_events.id"), nullable=False
    )
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    provider: Mapped[NotificationProvider] = mapped_column(SAEnum(NotificationProvider), nullable=False)
    status: Mapped[NotificationStatus] = mapped_column(
        SAEnum(NotificationStatus), default=NotificationStatus.PENDING, nullable=False
    )
    subject: Mapped[str | None] = mapped_column(String(500), nullable=True)
    body_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    outbox_entry: Mapped[EventOutbox] = relationship(back_populates="notifications")


# ---------------------------------------------------------------------------
# News, AI usage, audit — unchanged
# ---------------------------------------------------------------------------

class NewsItem(Base):
    __tablename__ = "news_items"
    __table_args__ = (
        Index("ix_news_published", "company_id", "published_at"),
    )

    id: Mapped[uuid.UUID] = _pk()
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    url: Mapped[str] = mapped_column(String(1024), unique=True, nullable=False)
    snippet: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = _created_at()

    company: Mapped[Company] = relationship()


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = _pk()
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    details_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = _created_at()
