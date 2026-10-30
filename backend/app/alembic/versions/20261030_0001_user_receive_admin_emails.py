"""user receive_admin_emails: allow admins to turn off email notifications

Admins (such as executive/supervisor accounts) can turn off receiving notification
emails to prevent mailbox spam for user requests and issues, while keeping their
administrative access and in-app notifications intact.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261030_0001"
down_revision: str | None = "20261027_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "receive_admin_emails",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "receive_admin_emails")
