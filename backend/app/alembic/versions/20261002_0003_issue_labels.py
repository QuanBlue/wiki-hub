"""labels on issues

A list of label slugs per issue (bug, enhancement, ...).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261002_0003"
down_revision: str | None = "20261002_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "issues",
        sa.Column(
            "labels",
            postgresql.ARRAY(sa.String(32)),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )
    op.create_index("ix_issues_labels", "issues", ["labels"], postgresql_using="gin")


def downgrade() -> None:
    op.drop_index("ix_issues_labels", table_name="issues")
    op.drop_column("issues", "labels")
