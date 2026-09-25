"""Drop ai_usage and the news AI labels: the news sentiment classifier was removed.

With the AI report (009) and the news classifier both gone, nothing calls an LLM any
more, so the shared daily budget table ``ai_usage`` and the ``news_items`` label
columns (sentiment, impact, rationale) are dropped. Headlines themselves stay.

Downgrade recreates the table (as in 008) and the columns (as in 004) empty; the
dropped usage rows and labels are not restored.

Revision ID: 011
Revises: 010
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ix_ai_usage_created_at", table_name="ai_usage")
    op.drop_table("ai_usage")
    op.drop_column("news_items", "rationale")
    op.drop_column("news_items", "impact")
    op.drop_column("news_items", "sentiment")


def downgrade() -> None:
    op.add_column("news_items", sa.Column("sentiment", sa.String(20), nullable=True))
    op.add_column("news_items", sa.Column("impact", sa.String(20), nullable=True))
    op.add_column("news_items", sa.Column("rationale", sa.String(300), nullable=True))
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
