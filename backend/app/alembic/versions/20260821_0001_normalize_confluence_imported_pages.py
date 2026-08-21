"""Normalize imported Confluence XML macros, task-lists, layout sections and parameter leakages in existing pages.

Revision ID: 20260821_0001
Revises: 20260820_0001
Create Date: 2026-08-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from app.modules.import_export.service import _normalize_confluence_html

revision: str = "20260821_0001"
down_revision: str = "20260820_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    pages_table = sa.table(
        "pages",
        sa.column("id", sa.UUID),
        sa.column("content", sa.Text),
    )

    results = connection.execute(
        sa.select(pages_table.c.id, pages_table.c.content).where(
            sa.or_(
                pages_table.c.content.like("%<ac:%"),
                pages_table.c.content.like("%<ri:%"),
                pages_table.c.content.like("%<task-list%"),
                pages_table.c.content.like("%<layout%"),
            )
        )
    ).fetchall()

    for page_id, raw_content in results:
        if raw_content:
            normalized = _normalize_confluence_html(raw_content)
            if normalized != raw_content:
                connection.execute(
                    pages_table.update()
                    .where(pages_table.c.id == page_id)
                    .values(content=normalized)
                )


def downgrade() -> None:
    pass
