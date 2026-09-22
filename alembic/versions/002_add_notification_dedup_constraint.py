"""Add notification dedup unique constraint and outbox processing support.

Revision ID: 002
Revises: 001_full_schema_v1
"""

from alembic import op

revision = "002"
down_revision = "001_full_schema_v1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Notification dedup: prevent duplicate emails per event
    op.create_unique_constraint(
        "uq_notification_event_email",
        "notifications",
        ["normalized_event_id", "email"],
    )

    # Ensure the outboxstatus enum has the PROCESSING label used by outbox claiming.
    # SQLAlchemy stores Enum *names* (upper case), which 001 already creates, so this
    # is a guard only. (An earlier version checked the lower-case value and added an
    # unused 'processing' label to databases migrated before the fix; it is harmless.)
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_enum
                WHERE enumlabel = 'PROCESSING'
                AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'outboxstatus')
            ) THEN
                ALTER TYPE outboxstatus ADD VALUE 'PROCESSING';
            END IF;
        END$$;
    """)


def downgrade() -> None:
    op.drop_constraint("uq_notification_event_email", "notifications", type_="unique")
