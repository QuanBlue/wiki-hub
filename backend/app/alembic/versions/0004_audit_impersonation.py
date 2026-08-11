"""add impersonation columns to audit_logs

Nullable with no backfill: every existing row predates the feature, so NULL is
the truthful value - it means "not impersonated", which is exactly what was the
case. A default of '' or 'system' would invent a fact about history.

Revision ID: 0004_audit_impersonation
Revises: 0003_audit_and_site_settings
Create Date: 2026-08-11 04:23:07.045401+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_audit_impersonation"
down_revision: str | None = "0003_audit_and_site_settings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("audit_logs", sa.Column("impersonator_id", sa.UUID(), nullable=True))
    op.add_column(
        "audit_logs", sa.Column("impersonator_username", sa.String(length=64), nullable=True)
    )
    op.create_foreign_key(
        op.f("fk_audit_logs_impersonator_id_users"),
        "audit_logs",
        "users",
        ["impersonator_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("fk_audit_logs_impersonator_id_users"), "audit_logs", type_="foreignkey"
    )
    op.drop_column("audit_logs", "impersonator_username")
    op.drop_column("audit_logs", "impersonator_id")
