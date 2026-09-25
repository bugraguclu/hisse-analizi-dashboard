"""raw_events dedup is per company: a KAP disclosure that lists several stock codes
is stored once for each company instead of only for the first one polled.

Revision ID: 006
Revises: 005
"""

from alembic import op

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("uq_raw_events_source_hash", "raw_events", type_="unique")
    op.create_unique_constraint(
        "uq_raw_events_source_company_hash",
        "raw_events",
        ["source_id", "company_id", "content_hash"],
    )


def downgrade() -> None:
    # The old constraint cannot hold once a disclosure is stored for several companies.
    # Fail loudly instead of silently deleting events (and their notifications).
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM raw_events GROUP BY source_id, content_hash HAVING count(*) > 1
            ) THEN
                RAISE EXCEPTION 'raw_events has multi-company disclosures; remove the extra rows before downgrading';
            END IF;
        END $$;
        """
    )
    op.drop_constraint("uq_raw_events_source_company_hash", "raw_events", type_="unique")
    op.create_unique_constraint("uq_raw_events_source_hash", "raw_events", ["source_id", "content_hash"])
