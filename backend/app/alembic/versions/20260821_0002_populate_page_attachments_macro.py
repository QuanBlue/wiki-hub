"""Populate attachments and galleries for imported pages in database.

Revision ID: 20260821_0002
Revises: 20260821_0001
Create Date: 2026-08-21
"""

from __future__ import annotations

import html
import sqlalchemy as sa
from alembic import op
from app.modules.import_export.service import (
    _build_attachments_table_html,
    _build_gallery_html,
)

revision: str = "20260821_0002"
down_revision: str = "20260821_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    pages_table = sa.table(
        "pages",
        sa.column("id", sa.UUID),
        sa.column("content", sa.Text),
    )
    attachments_table = sa.table(
        "page_attachments",
        sa.column("id", sa.UUID),
        sa.column("page_id", sa.UUID),
        sa.column("filename", sa.String),
    )

    # Fetch all pages that have attachments
    page_rows = connection.execute(
        sa.select(pages_table.c.id, pages_table.c.content)
    ).fetchall()

    for page_id, raw_content in page_rows:
        att_rows = connection.execute(
            sa.select(attachments_table.c.id, attachments_table.c.filename)
            .where(attachments_table.c.page_id == page_id)
            .order_by(attachments_table.c.filename)
        ).fetchall()

        if not att_rows:
            continue

        content = raw_content or ""
        doc_files = []
        img_files = []
        for att_id, filename in att_rows:
            url = f"/api/v1/attachments/{att_id}/content"
            ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
            item = {"filename": filename, "url": url}
            if ext in {"png", "jpg", "jpeg", "gif", "webp", "svg"}:
                img_files.append(item)
            else:
                doc_files.append(item)

        # Check unlinked items
        unlinked_docs = [f for f in doc_files if f["url"] not in content and f["filename"] not in content]
        unlinked_imgs = [img for img in img_files if img["url"] not in content and img["filename"] not in content]

        if not unlinked_docs and not unlinked_imgs:
            continue

        new_content = content
        if unlinked_docs:
            new_content += _build_attachments_table_html(unlinked_docs)
        if unlinked_imgs:
            new_content += _build_gallery_html(unlinked_imgs)

        if new_content != content:
            connection.execute(
                pages_table.update()
                .where(pages_table.c.id == page_id)
                .values(content=new_content)
            )


def downgrade() -> None:
    pass
