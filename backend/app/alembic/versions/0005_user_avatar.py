"""add avatar URL to users

Revision ID: 0005_user_avatar
Revises: 0004_audit_impersonation
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_user_avatar"
down_revision: str | None = "0004_audit_impersonation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar_url", sa.String(length=2048), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "avatar_url")
