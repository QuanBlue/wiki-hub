"""create page revisions table

Revision ID: b82c402c2158
Revises: a71b391b1047
Create Date: 2026-08-14 10:30:00.000000+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'b82c402c2158'
down_revision: str | None = 'a71b391b1047'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'page_revisions',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('page_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('content_format', sa.String(length=16), server_default='html', nullable=False),
        sa.Column('created_by_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('change_summary', sa.String(length=255), nullable=True),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['page_id'], ['pages.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('page_id', 'version', name='uq_page_revisions_version')
    )
    op.create_index('ix_page_revisions_page_id', 'page_revisions', ['page_id'], unique=False)
    op.create_index('ix_page_revisions_page_id_created', 'page_revisions', ['page_id', 'created_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_page_revisions_page_id_created', table_name='page_revisions')
    op.drop_index('ix_page_revisions_page_id', table_name='page_revisions')
    op.drop_table('page_revisions')
