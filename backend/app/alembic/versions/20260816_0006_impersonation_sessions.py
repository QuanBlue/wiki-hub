"""Mark sessions created through administrator impersonation."""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260816_0006"
down_revision: str | None = "20260816_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_sessions",
        sa.Column("impersonator_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_user_sessions_impersonator_id_users",
        "user_sessions",
        "users",
        ["impersonator_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_user_sessions_impersonator_id_users",
        "user_sessions",
        type_="foreignkey",
    )
    op.drop_column("user_sessions", "impersonator_id")
