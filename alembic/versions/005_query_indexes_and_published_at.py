"""Query indexes for /events, /prices, outbox claiming and rule matching;
normalized_events.published_at becomes NOT NULL.

Revision ID: 005
Revises: 004
"""

import sqlalchemy as sa
from alembic import op

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None

_INDEXES: tuple[tuple[str, str, list[str]], ...] = (
    ("ix_normalized_events_company_published", "normalized_events", ["company_id", "published_at"]),
    ("ix_normalized_events_severity_published", "normalized_events", ["severity", "published_at"]),
    ("ix_normalized_events_category_published", "normalized_events", ["category", "published_at"]),
    ("ix_price_data_ticker_interval_date", "price_data", ["ticker", "interval", "trading_date"]),
    ("ix_event_outbox_status_created", "event_outbox", ["status", "created_at"]),
    ("ix_notification_rules_company_id", "notification_rules", ["company_id"]),
)


def upgrade() -> None:
    # The ingestion service always sets published_at (falling back to the ingestion
    # time); backfill any legacy NULL before enforcing the constraint so ordering by
    # published_at DESC never puts undated rows first.
    op.execute("UPDATE normalized_events SET published_at = created_at WHERE published_at IS NULL")
    op.alter_column(
        "normalized_events",
        "published_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
    )
    for name, table, columns in _INDEXES:
        op.create_index(name, table, columns, unique=False)


def downgrade() -> None:
    for name, table, _columns in reversed(_INDEXES):
        op.drop_index(name, table_name=table)
    op.alter_column(
        "normalized_events",
        "published_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=True,
    )
