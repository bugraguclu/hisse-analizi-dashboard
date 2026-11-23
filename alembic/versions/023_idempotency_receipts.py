"""Persist request receipts in the same transaction as notification rule creation.

Revision ID: 023
Revises: 022
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "023"
down_revision = "022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "idempotency_receipts",
        sa.Column("scope", sa.String(80), primary_key=True),
        sa.Column("request_id", sa.String(128), primary_key=True),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("response_body", postgresql.JSONB(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_idempotency_receipts_expires_at", "idempotency_receipts", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_idempotency_receipts_expires_at", table_name="idempotency_receipts")
    op.drop_table("idempotency_receipts")
