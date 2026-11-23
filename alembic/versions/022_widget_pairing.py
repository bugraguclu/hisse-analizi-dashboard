"""Add widget_pairings and widget_devices tables for iOS widget QR pairing.

Revision ID: 022
Revises: 021
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "022"
down_revision = "021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "widget_pairings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("owner_hash", sa.String(length=64), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("watchlist_id", sa.String(length=80), server_default="favorites", nullable=False),
        sa.Column("watchlist_name", sa.String(length=80), server_default="", nullable=False),
        sa.Column("tickers", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("dashboard_id", sa.String(length=80), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_widget_pairings_owner_hash", "widget_pairings", ["owner_hash"])
    op.create_index("ix_widget_pairings_code_hash", "widget_pairings", ["code_hash"], unique=True)
    op.create_index("ix_widget_pairings_expires_at", "widget_pairings", ["expires_at"])

    op.create_table(
        "widget_devices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("owner_hash", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=60), server_default="iPhone", nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("scope", sa.String(length=40), server_default="widget:read", nullable=False),
        sa.Column("watchlist_id", sa.String(length=80), server_default="favorites", nullable=False),
        sa.Column("watchlist_name", sa.String(length=80), server_default="", nullable=False),
        sa.Column("tickers", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("dashboard_id", sa.String(length=80), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("scope IN ('widget:read')", name="ck_widget_devices_scope"),
    )
    op.create_index("ix_widget_devices_owner_created", "widget_devices", ["owner_hash", "created_at"])
    op.create_index("ix_widget_devices_token_hash", "widget_devices", ["token_hash"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_widget_devices_token_hash", table_name="widget_devices")
    op.drop_index("ix_widget_devices_owner_created", table_name="widget_devices")
    op.drop_table("widget_devices")

    op.drop_index("ix_widget_pairings_expires_at", table_name="widget_pairings")
    op.drop_index("ix_widget_pairings_code_hash", table_name="widget_pairings")
    op.drop_index("ix_widget_pairings_owner_hash", table_name="widget_pairings")
    op.drop_table("widget_pairings")
