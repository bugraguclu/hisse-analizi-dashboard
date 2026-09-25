"""ai_usage: one row per billed LLM provider call.

The daily AI budget is SUM(cost_usd) since Europe/Istanbul midnight, shared by the API
and worker processes (reports, news classification, admin regenerate, batch results).
Additive only.

Revision ID: 008
Revises: 007
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_usage",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("ticker", sa.String(20), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column("cost_usd", sa.Numeric(12, 6), nullable=False),
        sa.CheckConstraint("kind IN ('report', 'classification', 'batch')", name="ck_ai_usage_kind"),
    )
    op.create_index("ix_ai_usage_created_at", "ai_usage", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_ai_usage_created_at", table_name="ai_usage")
    op.drop_table("ai_usage")
