"""site settings: editable sign-in page showcase panel

``site_settings.login_panel`` holds the administrator's copy for the left panel
of the sign-in page (per language); NULL keeps the built-in text. The uploaded
illustration lives in its own columns so a settings PATCH can never point the
public image endpoint at an arbitrary object key.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261104_0004"
down_revision: str | None = "20261104_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "site_settings",
        sa.Column("login_panel", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column("site_settings", sa.Column("login_image_object_key", sa.Text(), nullable=True))
    op.add_column("site_settings", sa.Column("login_image_content_type", sa.Text(), nullable=True))
    op.add_column(
        "site_settings",
        sa.Column("login_image_updated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("site_settings", "login_image_updated_at")
    op.drop_column("site_settings", "login_image_content_type")
    op.drop_column("site_settings", "login_image_object_key")
    op.drop_column("site_settings", "login_panel")
