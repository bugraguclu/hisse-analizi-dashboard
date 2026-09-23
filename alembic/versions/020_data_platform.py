"""Data platform: persisted market data, canonical fundamentals, reference data,
macro series, last-good payload store, ingestion runs and data-quality checks.

* companies: reference columns (KAP oid, sector/industry/market, fiscal year,
  statement template, capital, free float, listing status, tracking tier).
* price_data → price_bars (one adjusted daily series per symbol; borsapy rows are
  carried over as ``tradingview``); the ``priceinterval`` enum type is dropped.
* financial_statements / financial_ratios are rebuilt in their v2 shape (source-
  tagged "YYYY/MM" statements with line items; ratios keyed by period + basis).
  They are caches of upstream data and are re-ingested by the fundamentals worker,
  so the v1 rows are not migrated.
* New: market_indices, index_memberships, quotes, financial_facts, dividends,
  capital_increases, shareholders, analyst_targets, expected_disclosures,
  macro_series, fx_bulletins, data_snapshots, ingestion_runs, data_quality_checks.

Revision ID: 020
Revises: 009
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "020"
down_revision = "009"
branch_labels = None
depends_on = None


def _uuid_pk() -> sa.Column:
    return sa.Column("id", sa.UUID(), nullable=False)


def _fetched_at() -> sa.Column:
    return sa.Column("fetched_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False)


def _money(name: str) -> sa.Column:
    return sa.Column(name, sa.Numeric(22, 2), nullable=True)


def _price(name: str) -> sa.Column:
    return sa.Column(name, sa.Numeric(14, 4), nullable=True)


_FACT_MONEY_COLUMNS = (
    "revenue", "gross_profit", "operating_profit", "net_income", "net_income_parent", "net_interest_income",
    "depreciation_amortization", "operating_cash_flow", "investing_cash_flow", "financing_cash_flow", "capex",
    "free_cash_flow", "total_assets", "current_assets", "current_liabilities", "non_current_liabilities",
    "total_liabilities", "total_equity", "parent_equity", "minority_interest", "paid_in_capital", "cash",
    "short_term_investments", "financial_debt", "deposits",
)
_RATIO_COLUMNS = (
    "gross_margin", "operating_margin", "ebitda_margin", "net_margin", "roe", "roa", "current_ratio",
    "net_debt_ebitda", "debt_to_equity", "pe_ratio", "pb_ratio", "ps_ratio", "ev_ebitda", "revenue_growth_yoy",
    "net_income_growth_yoy",
)
_V1_RATIO_COLUMNS = (
    "roe", "roa", "net_margin", "gross_margin", "ebitda_margin", "pe_ratio", "pb_ratio", "ps_ratio",
    "debt_to_equity", "current_ratio", "net_debt_ebitda",
)


def upgrade() -> None:
    # --- companies: reference data ---------------------------------------------------
    op.add_column("companies", sa.Column("kap_member_oid", sa.String(length=64), nullable=True))
    op.add_column("companies", sa.Column("sector", sa.String(length=200), nullable=True))
    op.add_column("companies", sa.Column("industry", sa.String(length=200), nullable=True))
    op.add_column("companies", sa.Column("market_segment", sa.String(length=100), nullable=True))
    op.add_column("companies", sa.Column("website", sa.String(length=300), nullable=True))
    op.add_column("companies", sa.Column("security_type", sa.String(length=20), server_default="stock", nullable=False))
    op.add_column("companies", sa.Column("fiscal_year_end_month", sa.SmallInteger(), nullable=True))
    op.add_column("companies", sa.Column("statement_template", sa.String(length=20), nullable=True))
    op.add_column("companies", sa.Column("paid_in_capital", sa.Numeric(22, 2), nullable=True))
    op.add_column("companies", sa.Column("free_float_pct", sa.Numeric(6, 2), nullable=True))
    op.add_column("companies", sa.Column("foreign_ratio_pct", sa.Numeric(6, 2), nullable=True))
    op.add_column("companies", sa.Column("listing_status", sa.String(length=20), server_default="listed", nullable=False))
    op.add_column("companies", sa.Column("tracking_tier", sa.String(length=20), server_default="universe", nullable=False))
    op.add_column("companies", sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("companies", sa.Column("reference_updated_at", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint("ck_companies_tracking_tier", "companies", "tracking_tier IN ('core', 'universe')")
    op.create_check_constraint(
        "ck_companies_listing_status", "companies", "listing_status IN ('listed', 'suspended', 'delisted')"
    )
    op.create_index("ix_companies_tracking_tier", "companies", ["tracking_tier"], unique=False)
    # Every company seeded so far is a BIST 100 member polled per company.
    op.execute("UPDATE companies SET tracking_tier = 'core'")

    # --- indices ----------------------------------------------------------------------
    op.create_table(
        "market_indices",
        sa.Column("code", sa.String(length=10), nullable=False),
        sa.Column("name_tr", sa.String(length=200), nullable=True),
        sa.Column("name_en", sa.String(length=200), nullable=True),
        sa.Column("as_of", sa.Date(), nullable=True),
        _fetched_at(),
        sa.PrimaryKeyConstraint("code"),
    )
    op.create_table(
        "index_memberships",
        _uuid_pk(),
        sa.Column("index_code", sa.String(length=10), nullable=False),
        sa.Column("ticker", sa.String(length=20), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=True),
        sa.Column("as_of", sa.Date(), nullable=True),
        sa.Column("source", sa.String(length=30), nullable=False),
        _fetched_at(),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("index_code", "ticker", name="uq_index_memberships_index_ticker"),
    )
    op.create_index("ix_index_memberships_ticker", "index_memberships", ["ticker"], unique=False)

    # --- quotes -----------------------------------------------------------------------
    op.create_table(
        "quotes",
        sa.Column("symbol", sa.String(length=20), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=True),
        sa.Column("security_type", sa.String(length=20), server_default="stock", nullable=False),
        sa.Column("name", sa.String(length=300), nullable=True),
        sa.Column("currency", sa.String(length=5), nullable=True),
        _price("last"),
        _price("open"),
        _price("high"),
        _price("low"),
        _price("prev_close"),
        sa.Column("change", sa.Numeric(14, 6), nullable=True),
        sa.Column("change_pct", sa.Numeric(12, 6), nullable=True),
        sa.Column("volume", sa.Numeric(20, 0), nullable=True),
        _money("turnover"),
        _money("market_cap"),
        _price("bid"),
        _price("ask"),
        sa.Column("source", sa.String(length=30), nullable=False),
        sa.Column("delay_seconds", sa.Integer(), nullable=True),
        sa.Column("quote_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("session_date", sa.Date(), nullable=True),
        _fetched_at(),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("symbol"),
    )
    op.create_index("ix_quotes_company_id", "quotes", ["company_id"], unique=False)

    # --- price bars (replaces price_data) ------------------------------------------------
    op.create_table(
        "price_bars",
        _uuid_pk(),
        sa.Column("symbol", sa.String(length=20), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=True),
        sa.Column("interval", sa.String(length=5), server_default="1d", nullable=False),
        sa.Column("bar_date", sa.Date(), nullable=False),
        _price("open"),
        _price("high"),
        _price("low"),
        _price("close"),
        sa.Column("volume", sa.Numeric(20, 0), nullable=True),
        _money("turnover"),
        _price("vwap"),
        sa.Column("source", sa.String(length=30), nullable=False),
        sa.Column("adjusted", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("is_final", sa.Boolean(), server_default="true", nullable=False),
        _fetched_at(),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("symbol", "interval", "bar_date", name="uq_price_bars_symbol_interval_date"),
    )
    op.create_index("ix_price_bars_company_id", "price_bars", ["company_id"], unique=False)
    op.execute(
        """
        INSERT INTO price_bars (id, symbol, company_id, interval, bar_date, open, high, low, close, volume,
                                source, adjusted, is_final, fetched_at)
        SELECT id, ticker, company_id,
               CASE interval WHEN 'ONE_DAY' THEN '1d' WHEN 'ONE_HOUR' THEN '1h' ELSE '15m' END,
               trading_date, open, high, low, close, volume,
               CASE source WHEN 'borsapy' THEN 'tradingview' ELSE source END,
               true, true, fetched_at
        FROM price_data
        WHERE source = 'borsapy' AND close IS NOT NULL
        ON CONFLICT DO NOTHING
        """
    )
    op.drop_index("ix_price_data_ticker_interval_date", table_name="price_data")
    op.drop_table("price_data")
    op.execute("DROP TYPE IF EXISTS priceinterval")

    # --- fundamentals v2 ------------------------------------------------------------------
    op.drop_index("ix_financial_ratios_period", table_name="financial_ratios")
    op.drop_table("financial_ratios")
    op.drop_index("ix_financial_statements_period", table_name="financial_statements")
    op.drop_table("financial_statements")
    op.create_table(
        "financial_statements",
        _uuid_pk(),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("period", sa.String(length=20), nullable=False),
        sa.Column("statement_type", sa.String(length=50), nullable=False),
        sa.Column("fiscal_year_end_month", sa.SmallInteger(), server_default="12", nullable=False),
        sa.Column("months", sa.SmallInteger(), nullable=True),
        sa.Column("period_type", sa.String(length=20), nullable=True),
        sa.Column("template", sa.String(length=20), nullable=True),
        sa.Column("consolidation", sa.String(length=80), nullable=True),
        sa.Column("presentation_unit", sa.String(length=40), nullable=True),
        sa.Column("currency", sa.String(length=10), nullable=True),
        sa.Column("restated", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("restatement_factor", sa.Numeric(12, 6), nullable=True),
        sa.Column("items_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("source_url", sa.String(length=500), nullable=True),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("published_at", sa.Date(), nullable=True),
        _fetched_at(),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "source", "period", "statement_type", name="uq_financial_statements_key"),
    )
    op.create_index("ix_financial_statements_company_period", "financial_statements", ["company_id", "period"])
    op.create_index("ix_financial_statements_period", "financial_statements", ["period"], unique=False)

    op.create_table(
        "financial_facts",
        _uuid_pk(),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("period", sa.String(length=20), nullable=False),
        sa.Column("fiscal_year_end_month", sa.SmallInteger(), server_default="12", nullable=False),
        sa.Column("months", sa.SmallInteger(), nullable=True),
        sa.Column("template", sa.String(length=20), nullable=True),
        *[_money(name) for name in _FACT_MONEY_COLUMNS],
        sa.Column("sources_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("computed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "period", name="uq_financial_facts_period"),
    )
    op.create_index("ix_financial_facts_period", "financial_facts", ["period"], unique=False)

    op.create_table(
        "financial_ratios",
        _uuid_pk(),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("period", sa.String(length=20), nullable=False),
        sa.Column("basis", sa.String(length=10), server_default="annual", nullable=False),
        *[sa.Column(name, sa.Numeric(14, 4), nullable=True) for name in _RATIO_COLUMNS],
        _money("market_cap"),
        _price("price"),
        sa.Column("shares_outstanding", sa.Numeric(20, 0), nullable=True),
        sa.Column("shares_source", sa.String(length=20), nullable=True),
        sa.Column("ttm_quarters", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("raw_ratios_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("inputs_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("calculated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("basis IN ('ttm', 'annual')", name="ck_financial_ratios_basis"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "period", "basis", name="uq_financial_ratios_period_basis"),
    )
    op.create_index("ix_financial_ratios_period", "financial_ratios", ["period"], unique=False)

    # --- company reference data ---------------------------------------------------------
    op.create_table(
        "dividends",
        _uuid_pk(),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("ex_date", sa.Date(), nullable=False),
        sa.Column("payment_date", sa.Date(), nullable=True),
        sa.Column("gross_rate_pct", sa.Numeric(12, 4), nullable=False),
        sa.Column("net_rate_pct", sa.Numeric(12, 4), nullable=True),
        sa.Column("gross_per_share", sa.Numeric(14, 6), nullable=True),
        sa.Column("net_per_share", sa.Numeric(14, 6), nullable=True),
        _money("total_amount"),
        sa.Column("source", sa.String(length=30), nullable=False),
        _fetched_at(),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "source", "ex_date", "gross_rate_pct", name="uq_dividends_key"),
    )
    op.create_index("ix_dividends_company_date", "dividends", ["company_id", "ex_date"], unique=False)

    op.create_table(
        "capital_increases",
        _uuid_pk(),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("event_date", sa.Date(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("bonus_rate_pct", sa.Numeric(12, 4), nullable=True),
        sa.Column("rights_rate_pct", sa.Numeric(12, 4), nullable=True),
        _price("rights_price"),
        _money("capital_before"),
        _money("capital_after"),
        sa.Column("source", sa.String(length=30), nullable=False),
        _fetched_at(),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "source", "event_date", "kind", name="uq_capital_increases_key"),
    )
    op.create_index("ix_capital_increases_company_date", "capital_increases", ["company_id", "event_date"])

    op.create_table(
        "shareholders",
        _uuid_pk(),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("holder_name", sa.String(length=300), nullable=False),
        sa.Column("share_pct", sa.Numeric(8, 4), nullable=True),
        sa.Column("as_of", sa.Date(), nullable=True),
        sa.Column("source", sa.String(length=30), nullable=False),
        _fetched_at(),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "source", "holder_name", name="uq_shareholders_key"),
    )

    op.create_table(
        "analyst_targets",
        _uuid_pk(),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("source", sa.String(length=30), nullable=False),
        sa.Column("as_of", sa.Date(), nullable=True),
        _price("target_low"),
        _price("target_high"),
        _price("target_mean"),
        _price("target_median"),
        sa.Column("analysts_count", sa.Integer(), nullable=True),
        sa.Column("recommendation", sa.String(length=30), nullable=True),
        sa.Column("upside_pct", sa.Numeric(12, 4), nullable=True),
        _fetched_at(),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "source", name="uq_analyst_targets_key"),
    )

    op.create_table(
        "expected_disclosures",
        _uuid_pk(),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("subject", sa.String(length=200), nullable=False),
        sa.Column("period_term", sa.String(length=80), nullable=True),
        sa.Column("fiscal_year", sa.SmallInteger(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("dedup_key", sa.String(length=64), nullable=False),
        sa.Column("source", sa.String(length=20), server_default="kap", nullable=False),
        _fetched_at(),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "dedup_key", name="uq_expected_disclosures_key"),
    )
    op.create_index(
        "ix_expected_disclosures_company_start", "expected_disclosures", ["company_id", "start_date"], unique=False
    )

    # --- macro ----------------------------------------------------------------------------
    op.create_table(
        "macro_series",
        _uuid_pk(),
        sa.Column("series_code", sa.String(length=60), nullable=False),
        sa.Column("observation_date", sa.Date(), nullable=False),
        sa.Column("value", sa.Numeric(20, 6), nullable=False),
        sa.Column("source", sa.String(length=30), nullable=False),
        _fetched_at(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("series_code", "observation_date", name="uq_macro_series_key"),
    )
    op.create_index("ix_macro_series_code_date", "macro_series", ["series_code", "observation_date"], unique=False)

    op.create_table(
        "fx_bulletins",
        _uuid_pk(),
        sa.Column("bulletin_date", sa.Date(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("quoted_unit", sa.Integer(), server_default="1", nullable=False),
        sa.Column("forex_buying", sa.Numeric(14, 6), nullable=True),
        sa.Column("forex_selling", sa.Numeric(14, 6), nullable=True),
        sa.Column("banknote_buying", sa.Numeric(14, 6), nullable=True),
        sa.Column("banknote_selling", sa.Numeric(14, 6), nullable=True),
        sa.Column("source", sa.String(length=20), server_default="tcmb", nullable=False),
        _fetched_at(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("bulletin_date", "currency", name="uq_fx_bulletins_key"),
    )
    op.create_index("ix_fx_bulletins_currency_date", "fx_bulletins", ["currency", "bulletin_date"], unique=False)

    # --- platform -------------------------------------------------------------------------
    op.create_table(
        "data_snapshots",
        sa.Column("key", sa.String(length=200), nullable=False),
        sa.Column("kind", sa.String(length=50), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("source", sa.String(length=60), nullable=True),
        _fetched_at(),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("key"),
    )
    op.create_index("ix_data_snapshots_kind", "data_snapshots", ["kind"], unique=False)

    op.create_table(
        "ingestion_runs",
        _uuid_pk(),
        sa.Column("job", sa.String(length=60), nullable=False),
        sa.Column("scope", sa.String(length=80), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="running", nullable=False),
        sa.Column("items_total", sa.Integer(), server_default="0", nullable=False),
        sa.Column("items_ok", sa.Integer(), server_default="0", nullable=False),
        sa.Column("items_failed", sa.Integer(), server_default="0", nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("details_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.CheckConstraint("status IN ('running', 'ok', 'partial', 'failed')", name="ck_ingestion_runs_status"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ingestion_runs_job_started", "ingestion_runs", ["job", "started_at"], unique=False)

    op.create_table(
        "data_quality_checks",
        _uuid_pk(),
        sa.Column("check_name", sa.String(length=80), nullable=False),
        sa.Column("subject", sa.String(length=60), nullable=True),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("expected", sa.Numeric(24, 6), nullable=True),
        sa.Column("actual", sa.Numeric(24, 6), nullable=True),
        sa.Column("deviation", sa.Numeric(16, 6), nullable=True),
        sa.Column("details_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("checked_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("status IN ('pass', 'warn', 'fail')", name="ck_data_quality_checks_status"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_data_quality_checks_name_time", "data_quality_checks", ["check_name", "checked_at"])
    op.create_index("ix_data_quality_checks_status_time", "data_quality_checks", ["status", "checked_at"])


def downgrade() -> None:
    # Platform / macro / reference tables (no data is carried back).
    for name, indexes in (
        ("data_quality_checks", ("ix_data_quality_checks_status_time", "ix_data_quality_checks_name_time")),
        ("ingestion_runs", ("ix_ingestion_runs_job_started",)),
        ("data_snapshots", ("ix_data_snapshots_kind",)),
        ("fx_bulletins", ("ix_fx_bulletins_currency_date",)),
        ("macro_series", ("ix_macro_series_code_date",)),
        ("expected_disclosures", ("ix_expected_disclosures_company_start",)),
        ("analyst_targets", ()),
        ("shareholders", ()),
        ("capital_increases", ("ix_capital_increases_company_date",)),
        ("dividends", ("ix_dividends_company_date",)),
        ("financial_ratios", ("ix_financial_ratios_period",)),
        ("financial_facts", ("ix_financial_facts_period",)),
        ("financial_statements", ("ix_financial_statements_period", "ix_financial_statements_company_period")),
        ("quotes", ("ix_quotes_company_id",)),
        ("index_memberships", ("ix_index_memberships_ticker",)),
        ("market_indices", ()),
    ):
        for index in indexes:
            op.drop_index(index, table_name=name)
        op.drop_table(name)

    # v1 fundamentals tables (empty).
    op.create_table(
        "financial_statements",
        _uuid_pk(),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("period", sa.String(length=20), nullable=False),
        sa.Column("statement_type", sa.String(length=50), nullable=False),
        sa.Column("period_type", sa.String(length=20), nullable=True),
        sa.Column("data_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("currency", sa.String(length=10), nullable=True),
        _fetched_at(),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "period", "statement_type", name="uq_financial_statements_period"),
    )
    op.create_index("ix_financial_statements_period", "financial_statements", ["period"], unique=False)
    op.create_table(
        "financial_ratios",
        _uuid_pk(),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("period", sa.String(length=20), nullable=False),
        *[sa.Column(name, sa.Numeric(12, 4), nullable=True) for name in _V1_RATIO_COLUMNS],
        sa.Column("raw_ratios_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("calculated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "period", name="uq_financial_ratios_period"),
    )
    op.create_index("ix_financial_ratios_period", "financial_ratios", ["period"], unique=False)

    # price_data (daily borsapy rows carried back from price_bars).
    op.create_table(
        "price_data",
        _uuid_pk(),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("ticker", sa.String(length=20), nullable=False),
        sa.Column("source", sa.String(length=50), nullable=False),
        sa.Column("open", sa.Numeric(12, 4), nullable=True),
        sa.Column("high", sa.Numeric(12, 4), nullable=True),
        sa.Column("low", sa.Numeric(12, 4), nullable=True),
        sa.Column("close", sa.Numeric(12, 4), nullable=True),
        sa.Column("adjusted_close", sa.Numeric(12, 4), nullable=True),
        sa.Column("volume", sa.Float(), nullable=True),
        sa.Column("trading_date", sa.Date(), nullable=False),
        sa.Column("interval", sa.Enum("ONE_DAY", "ONE_HOUR", "FIFTEEN_MIN", name="priceinterval"), nullable=False),
        _fetched_at(),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "trading_date", "interval", "source", name="uq_price_data_unique"),
    )
    op.create_index("ix_price_data_ticker_interval_date", "price_data", ["ticker", "interval", "trading_date"])
    op.execute(
        """
        INSERT INTO price_data (id, company_id, ticker, source, open, high, low, close, volume, trading_date,
                                interval, fetched_at, created_at)
        SELECT id, company_id, symbol, 'borsapy', open, high, low, close, volume, bar_date,
               CASE interval WHEN '1d' THEN 'ONE_DAY' WHEN '1h' THEN 'ONE_HOUR' ELSE 'FIFTEEN_MIN' END::priceinterval,
               fetched_at, fetched_at
        FROM price_bars
        WHERE company_id IS NOT NULL AND source = 'tradingview'
        """
    )
    op.drop_index("ix_price_bars_company_id", table_name="price_bars")
    op.drop_table("price_bars")

    op.drop_index("ix_companies_tracking_tier", table_name="companies")
    op.drop_constraint("ck_companies_listing_status", "companies", type_="check")
    op.drop_constraint("ck_companies_tracking_tier", "companies", type_="check")
    for column in (
        "reference_updated_at", "last_seen_at", "tracking_tier", "listing_status", "foreign_ratio_pct",
        "free_float_pct", "paid_in_capital", "statement_template", "fiscal_year_end_month", "security_type",
        "website", "market_segment", "industry", "sector", "kap_member_oid",
    ):
        op.drop_column("companies", column)
