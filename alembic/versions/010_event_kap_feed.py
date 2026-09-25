"""KAP feed overhaul: new event categories, disclosure content cache, faster polling.

- ``eventcategory`` gains SHARE_BUYBACK, MERGER_ACQUISITION, INSIDER_TRADING,
  DEBT_INSTRUMENT, CREDIT_RATING, GENERAL_ASSEMBLY and MARKET_NOTICE (89 % of the
  disclosures used to land in OTHER).
- ``normalized_events.content_json`` / ``content_fetched_at`` cache the full disclosure
  text fetched from KAP when a user opens it; ``event_url`` is indexed because /events
  groups the per-company rows of one disclosure by URL.
- KAP is now polled with ONE list request per cycle (instead of one per company), so the
  seeded 300 s interval drops to 60 s (only where it was never customised).

Downgrade maps the new categories back to OTHER and rebuilds the enum type.

Revision ID: 010
Revises: 009
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None

OLD_CATEGORIES = ("DIVIDEND", "CAPITAL_INCREASE", "NEW_BUSINESS", "LEGAL", "MANAGEMENT", "FINANCIAL_RESULTS", "OTHER")
NEW_CATEGORIES = (
    "SHARE_BUYBACK",
    "MERGER_ACQUISITION",
    "INSIDER_TRADING",
    "DEBT_INSTRUMENT",
    "CREDIT_RATING",
    "GENERAL_ASSEMBLY",
    "MARKET_NOTICE",
)


def upgrade() -> None:
    # ADD VALUE must be committed before the values can be used; run it outside the
    # migration transaction (idempotent thanks to IF NOT EXISTS).
    with op.get_context().autocommit_block():
        for value in NEW_CATEGORIES:
            op.execute(f"ALTER TYPE eventcategory ADD VALUE IF NOT EXISTS '{value}'")

    op.add_column("normalized_events", sa.Column("content_json", JSONB(), nullable=True))
    op.add_column("normalized_events", sa.Column("content_fetched_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_normalized_events_event_url", "normalized_events", ["event_url"])
    op.execute("UPDATE sources SET poll_interval_seconds = 60 WHERE code = 'kap' AND poll_interval_seconds = 300")


def downgrade() -> None:
    op.execute("UPDATE sources SET poll_interval_seconds = 300 WHERE code = 'kap' AND poll_interval_seconds = 60")
    op.drop_index("ix_normalized_events_event_url", table_name="normalized_events")
    op.drop_column("normalized_events", "content_fetched_at")
    op.drop_column("normalized_events", "content_json")

    new_values = ", ".join(f"'{v}'" for v in NEW_CATEGORIES)
    old_values = ", ".join(f"'{v}'" for v in OLD_CATEGORIES)
    op.execute(f"UPDATE normalized_events SET category = 'OTHER' WHERE category::text IN ({new_values})")
    op.execute("ALTER TYPE eventcategory RENAME TO eventcategory_old")
    op.execute(f"CREATE TYPE eventcategory AS ENUM ({old_values})")
    op.execute(
        "ALTER TABLE normalized_events ALTER COLUMN category TYPE eventcategory USING category::text::eventcategory"
    )
    op.execute("DROP TYPE eventcategory_old")
