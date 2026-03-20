"""full schema v1 — tum tablolar

Revision ID: 001_full_schema_v1
Revises:
Create Date: 2026-03-20
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "001_full_schema_v1"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Independent tables ---
    op.create_table(
        "audit_log",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("entity_type", sa.String(length=100), nullable=True),
        sa.Column("entity_id", sa.String(length=200), nullable=True),
        sa.Column("details_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "companies",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("ticker", sa.String(length=20), nullable=False),
        sa.Column("legal_name", sa.String(length=500), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("isin", sa.String(length=20), nullable=True),
        sa.Column("exchange", sa.String(length=20), nullable=True),
        sa.Column("aliases", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_companies_ticker"), "companies", ["ticker"], unique=True)

    op.create_table(
        "sources",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("code", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("base_url", sa.String(length=500), nullable=True),
        sa.Column("kind", sa.Enum("KAP", "OFFICIAL_NEWS", "OFFICIAL_IR", "PRICE_DATA", "FINANCIAL_STATEMENTS", name="sourcekind"), nullable=False),
        sa.Column("poll_interval_seconds", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_sources_code"), "sources", ["code"], unique=True)

    # --- Company-dependent tables ---
    op.create_table(
        "financial_statements",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("period", sa.String(length=20), nullable=False),
        sa.Column("statement_type", sa.String(length=50), nullable=False),
        sa.Column("period_type", sa.String(length=20), nullable=True),
        sa.Column("data_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("currency", sa.String(length=10), nullable=True),
        sa.Column("fetched_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "period", "statement_type", name="uq_financial_statements_period"),
    )
    op.create_index("ix_financial_statements_period", "financial_statements", ["period"], unique=False)

    op.create_table(
        "financial_ratios",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("period", sa.String(length=20), nullable=False),
        sa.Column("roe", sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column("roa", sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column("net_margin", sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column("gross_margin", sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column("ebitda_margin", sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column("pe_ratio", sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column("pb_ratio", sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column("ps_ratio", sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column("debt_to_equity", sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column("current_ratio", sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column("net_debt_ebitda", sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column("raw_ratios_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("calculated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "period", name="uq_financial_ratios_period"),
    )
    op.create_index("ix_financial_ratios_period", "financial_ratios", ["period"], unique=False)

    op.create_table(
        "notification_rules",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("channel", sa.Enum("EMAIL", name="notificationchannel"), nullable=False),
        sa.Column("frequency", sa.Enum("INSTANT", name="notificationfrequency"), nullable=False),
        sa.Column("source_filters", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("min_severity", sa.Enum("INFO", "WATCH", "HIGH", name="severity"), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "polling_state",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("source_id", sa.UUID(), nullable=False),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_external_id", sa.String(length=200), nullable=True),
        sa.Column("last_seen_published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("etag", sa.String(length=200), nullable=True),
        sa.Column("last_modified", sa.String(length=200), nullable=True),
        sa.Column("consecutive_failures", sa.Integer(), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["source_id"], ["sources.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_id"),
    )

    op.create_table(
        "price_data",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("ticker", sa.String(length=20), nullable=False),
        sa.Column("source", sa.String(length=50), nullable=False),
        sa.Column("open", sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column("high", sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column("low", sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column("close", sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column("adjusted_close", sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column("volume", sa.Float(), nullable=True),
        sa.Column("trading_date", sa.Date(), nullable=False),
        sa.Column("interval", sa.Enum("ONE_DAY", "ONE_HOUR", "FIFTEEN_MIN", name="priceinterval"), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "trading_date", "interval", "source", name="uq_price_data_unique"),
    )

    # --- Source-dependent tables ---
    op.create_table(
        "raw_events",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("source_id", sa.UUID(), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("external_id", sa.String(length=200), nullable=True),
        sa.Column("canonical_url", sa.String(length=1000), nullable=True),
        sa.Column("source_event_type", sa.String(length=100), nullable=True),
        sa.Column("title", sa.String(length=1000), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("fetched_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("raw_payload_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("raw_payload_text", sa.Text(), nullable=True),
        sa.Column("attachment_urls", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.Column("headers_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["source_id"], ["sources.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_id", "content_hash", name="uq_raw_events_source_hash"),
    )
    op.create_index(op.f("ix_raw_events_content_hash"), "raw_events", ["content_hash"], unique=False)
    op.create_index("ix_raw_events_published_at", "raw_events", ["published_at"], unique=False)

    op.create_table(
        "normalized_events",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("raw_event_id", sa.UUID(), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("event_type", sa.Enum("KAP_DISCLOSURE", "OFFICIAL_NEWS", "OFFICIAL_IR_UPDATE", name="eventtype"), nullable=False),
        sa.Column("title", sa.String(length=1000), nullable=True),
        sa.Column("excerpt", sa.Text(), nullable=True),
        sa.Column("body_text", sa.Text(), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("event_url", sa.String(length=1000), nullable=True),
        sa.Column("source_code", sa.String(length=50), nullable=False),
        sa.Column("severity", sa.Enum("INFO", "WATCH", "HIGH", name="severity"), nullable=False),
        sa.Column("is_notifiable", sa.Boolean(), nullable=False),
        sa.Column("category", sa.Enum("DIVIDEND", "CAPITAL_INCREASE", "NEW_BUSINESS", "LEGAL", "MANAGEMENT", "FINANCIAL_RESULTS", "OTHER", name="eventcategory"), nullable=True),
        sa.Column("dedup_key", sa.String(length=64), nullable=False),
        sa.Column("metadata_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["raw_event_id"], ["raw_events.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("dedup_key"),
    )
    op.create_index("ix_normalized_events_event_type", "normalized_events", ["event_type"], unique=False)
    op.create_index("ix_normalized_events_published_at", "normalized_events", ["published_at"], unique=False)

    op.create_table(
        "event_outbox",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("normalized_event_id", sa.UUID(), nullable=False),
        sa.Column("event_name", sa.String(length=100), nullable=False),
        sa.Column("payload_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("status", sa.Enum("PENDING", "PROCESSING", "DONE", "FAILED", name="outboxstatus"), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["normalized_event_id"], ["normalized_events.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_event_outbox_status"), "event_outbox", ["status"], unique=False)

    op.create_table(
        "notifications",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("rule_id", sa.UUID(), nullable=False),
        sa.Column("outbox_id", sa.UUID(), nullable=False),
        sa.Column("normalized_event_id", sa.UUID(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("provider", sa.Enum("SMTP", "DRY_RUN", name="notificationprovider"), nullable=False),
        sa.Column("status", sa.Enum("PENDING", "SENT", "FAILED", "SKIPPED", name="notificationstatus"), nullable=False),
        sa.Column("subject", sa.String(length=500), nullable=True),
        sa.Column("body_text", sa.Text(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["normalized_event_id"], ["normalized_events.id"]),
        sa.ForeignKeyConstraint(["outbox_id"], ["event_outbox.id"]),
        sa.ForeignKeyConstraint(["rule_id"], ["notification_rules.id"]),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("notifications")
    op.drop_index(op.f("ix_event_outbox_status"), table_name="event_outbox")
    op.drop_table("event_outbox")
    op.drop_index("ix_normalized_events_published_at", table_name="normalized_events")
    op.drop_index("ix_normalized_events_event_type", table_name="normalized_events")
    op.drop_table("normalized_events")
    op.drop_index("ix_raw_events_published_at", table_name="raw_events")
    op.drop_index(op.f("ix_raw_events_content_hash"), table_name="raw_events")
    op.drop_table("raw_events")
    op.drop_table("price_data")
    op.drop_table("polling_state")
    op.drop_table("notification_rules")
    op.drop_index("ix_financial_statements_period", table_name="financial_statements")
    op.drop_table("financial_statements")
    op.drop_index("ix_financial_ratios_period", table_name="financial_ratios")
    op.drop_table("financial_ratios")
    op.drop_index(op.f("ix_sources_code"), table_name="sources")
    op.drop_table("sources")
    op.drop_index(op.f("ix_companies_ticker"), table_name="companies")
    op.drop_table("companies")
    op.drop_table("audit_log")
