"""KAP polling every 30 s gets the per-company fetch throttled by kap.org.tr; raise the
seeded default to 300 s (only where it was never customised).

Revision ID: 007
Revises: 006
"""

from alembic import op

revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE sources SET poll_interval_seconds = 300 WHERE code = 'kap' AND poll_interval_seconds = 30")


def downgrade() -> None:
    op.execute("UPDATE sources SET poll_interval_seconds = 30 WHERE code = 'kap' AND poll_interval_seconds = 300")
