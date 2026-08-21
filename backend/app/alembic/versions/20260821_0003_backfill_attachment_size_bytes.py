"""Backfill attachment size_bytes from S3 storage for existing attachments.

Revision ID: 20260821_0003
Revises: 20260821_0002
Create Date: 2026-08-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from app.services.storage import S3ObjectStorage

revision: str = "20260821_0003"
down_revision: str = "20260821_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    attachments_table = sa.table(
        "page_attachments",
        sa.column("id", sa.UUID),
        sa.column("object_key", sa.String),
        sa.column("size_bytes", sa.BigInteger),
    )

    rows = connection.execute(
        sa.select(attachments_table.c.id, attachments_table.c.object_key).where(
            sa.or_(
                attachments_table.c.size_bytes == 0,
                attachments_table.c.size_bytes.is_(None),
            )
        )
    ).fetchall()

    if not rows:
        return

    storage = S3ObjectStorage()
    client = storage.client
    bucket = storage.bucket

    for att_id, object_key in rows:
        if not object_key:
            continue
        try:
            resp = client.head_object(Bucket=bucket, Key=object_key)
            size = resp.get("ContentLength", 0)
            if size > 0:
                connection.execute(
                    attachments_table.update()
                    .where(attachments_table.c.id == att_id)
                    .values(size_bytes=size)
                )
        except Exception:
            continue


def downgrade() -> None:
    pass
