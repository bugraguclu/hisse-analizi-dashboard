"""Add news_items table for per-ticker web news with AI sentiment.

Revision ID: 004
Revises: 003
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "news_items",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "company_id",
            UUID(as_uuid=True),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("url", sa.String(1024), nullable=False, unique=True),
        sa.Column("snippet", sa.Text(), nullable=True),
        sa.Column("source_name", sa.String(200), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sentiment", sa.String(20), nullable=True),
        sa.Column("impact", sa.String(20), nullable=True),
        sa.Column("rationale", sa.String(300), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_news_published", "news_items", ["company_id", "published_at"])


def downgrade() -> None:
    op.drop_index("ix_news_published", table_name="news_items")
    op.drop_table("news_items")
