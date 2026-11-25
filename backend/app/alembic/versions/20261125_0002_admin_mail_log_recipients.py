"""add recipients jsonb column to admin_mail_logs for grouped broadcast deliveries

Revision ID: 20261125_0002
Revises: 20261125_0001
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "20261125_0002"
down_revision: str | None = "20261125_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("admin_mail_logs", sa.Column("recipients", JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("admin_mail_logs", "recipients")
