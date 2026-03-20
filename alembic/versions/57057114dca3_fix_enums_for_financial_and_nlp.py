"""fix enums for financial and nlp

Revision ID: 57057114dca3
Revises: b68da92264cf
Create Date: 2026-03-20 14:36:36.591560
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '57057114dca3'
down_revision: Union[str, None] = 'b68da92264cf'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PostgreSQL'de Enum tipine yeni değer eklemek için raw SQL kullanıyoruz.
    # 'commit' bloğu dışında çalışması gerektiği için op.execute kullanıyoruz.
    op.execute("ALTER TYPE sourcekind ADD VALUE IF NOT EXISTS 'FINANCIAL_STATEMENTS'")


def downgrade() -> None:
    # PostgreSQL enum değerlerini silmeyi kolayca desteklemez, genelde boş bırakılır veya tip yeniden oluşturulur.
    pass
