"""Anonymous devices, Web Push subscriptions, alert rules and the push delivery outbox.

Revision ID: 025
Revises: 023

024 is reserved by another branch; 025 follows 023 directly.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "025"
down_revision = "023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "devices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("key_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("locale", sa.String(5), nullable=False, server_default="tr"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "push_subscriptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("device_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("devices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("endpoint", sa.String(2048), nullable=False, unique=True),
        sa.Column("p256dh", sa.String(200), nullable=False),
        sa.Column("auth", sa.String(100), nullable=False),
        sa.Column("failure_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_push_subscriptions_device_id", "push_subscriptions", ["device_id"])

    op.create_table(
        "alert_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("device_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("devices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("threshold", sa.Numeric(14, 4), nullable=True),
        sa.Column("direction", sa.String(4), nullable=True),
        sa.Column("repeat", sa.String(10), nullable=False, server_default="once"),
        sa.Column("hysteresis_pct", sa.Numeric(6, 2), nullable=False, server_default="1.00"),
        sa.Column("min_severity", sa.String(10), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("armed", sa.Boolean(), nullable=True),
        sa.Column("trigger_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_triggered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("kind IN ('price_above', 'price_below', 'change_pct', 'kap')", name="ck_alert_rules_kind"),
        sa.CheckConstraint("repeat IN ('once', 'rearm')", name="ck_alert_rules_repeat"),
        sa.CheckConstraint("direction IS NULL OR direction IN ('up', 'down', 'both')", name="ck_alert_rules_direction"),
        sa.CheckConstraint("min_severity IS NULL OR min_severity IN ('INFO', 'WATCH', 'HIGH')", name="ck_alert_rules_severity"),
    )
    op.create_index("ix_alert_rules_device", "alert_rules", ["device_id", "created_at"])
    op.create_index("ix_alert_rules_company_kind", "alert_rules", ["company_id", "kind"])

    op.create_table(
        "alert_deliveries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("device_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("devices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("rule_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("alert_rules.id", ondelete="SET NULL"), nullable=True),
        sa.Column("dedup_key", sa.String(200), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("ticker", sa.String(20), nullable=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("body", sa.String(500), nullable=False),
        sa.Column("url", sa.String(500), nullable=False),
        sa.Column("ttl_seconds", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(12), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempted_subscription_ids", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("sent_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("device_id", "dedup_key", name="uq_alert_deliveries_device_dedup"),
        sa.CheckConstraint(
            "status IN ('pending', 'processing', 'sent', 'failed', 'skipped')", name="ck_alert_deliveries_status"
        ),
    )
    op.create_index("ix_alert_deliveries_status_available", "alert_deliveries", ["status", "available_at"])
    op.create_index("ix_alert_deliveries_device_created", "alert_deliveries", ["device_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_alert_deliveries_device_created", table_name="alert_deliveries")
    op.drop_index("ix_alert_deliveries_status_available", table_name="alert_deliveries")
    op.drop_table("alert_deliveries")
    op.drop_index("ix_alert_rules_company_kind", table_name="alert_rules")
    op.drop_index("ix_alert_rules_device", table_name="alert_rules")
    op.drop_table("alert_rules")
    op.drop_index("ix_push_subscriptions_device_id", table_name="push_subscriptions")
    op.drop_table("push_subscriptions")
    op.drop_table("devices")
