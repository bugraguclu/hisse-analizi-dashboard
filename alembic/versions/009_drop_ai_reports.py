"""Drop ai_reports: the AI analysis report feature was removed.

ai_usage stays — news classification still books its LLM calls there. Downgrade
recreates the table (as in 003) empty; the dropped reports are not restored.

Revision ID: 009
Revises: 008
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ix_ai_reports_company_hash", table_name="ai_reports")
    op.drop_table("ai_reports")


def downgrade() -> None:
    op.create_table(
        "ai_reports",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "company_id",
            UUID(as_uuid=True),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("content_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("report_text", sa.Text(), nullable=False),
        sa.Column("model", sa.String(100), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("input_data_json", JSONB(), nullable=False, server_default="{}"),
        sa.Column(
            "generated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_ai_reports_company_hash", "ai_reports", ["company_id", "content_hash"])
