"""issues, issue attachments and the manage_issues global permission

Adds the ``issues`` and ``issue_attachments`` tables, and widens the CHECK
constraint on ``group_global_permissions.permission`` (a non-native enum, see
``_enum_column`` in app/models/permission.py) so ``manage_issues`` can be
granted to a group. ``user_global_permission_overrides.permission`` has no
CHECK constraint, so it needs nothing.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261002_0001"
down_revision: str | None = "20260928_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CONSTRAINT = "ck_group_global_permissions_global_permission"
_OLD = ("create_space", "manage_users", "manage_groups", "system_admin")
_NEW = ("create_space", "manage_users", "manage_groups", "manage_issues", "system_admin")


def _replace_permission_check(values: tuple[str, ...]) -> None:
    """Drop whatever CHECK(s) constrain the permission column, then add one.

    The old constraint's name depends on how the original migration was run, so
    it is looked up rather than assumed.
    """
    op.execute(
        """
        DO $$
        DECLARE c record;
        BEGIN
          FOR c IN
            SELECT conname FROM pg_constraint
            WHERE conrelid = 'group_global_permissions'::regclass AND contype = 'c'
          LOOP
            EXECUTE format('ALTER TABLE group_global_permissions DROP CONSTRAINT %I', c.conname);
          END LOOP;
        END $$;
        """
    )
    listed = ", ".join(f"'{value}'" for value in values)
    op.execute(
        f"ALTER TABLE group_global_permissions ADD CONSTRAINT {_CONSTRAINT} "
        f"CHECK (permission IN ({listed}))"
    )


def upgrade() -> None:
    op.create_table(
        "issues",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "reporter_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(16), nullable=False, server_default="open"),
        sa.Column(
            "assignee_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
        ),
        sa.Column("page_url", sa.String(500)),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_issues_status_created", "issues", ["status", "created_at"])
    op.create_index("ix_issues_reporter", "issues", ["reporter_id", "created_at"])

    op.create_table(
        "issue_attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "issue_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("issues.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(128), nullable=False),
        sa.Column("object_key", sa.String(512), nullable=False, unique=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_issue_attachments_issue", "issue_attachments", ["issue_id"])

    _replace_permission_check(_NEW)


def downgrade() -> None:
    op.execute("DELETE FROM group_global_permissions WHERE permission = 'manage_issues'")
    op.execute("DELETE FROM user_global_permission_overrides WHERE permission = 'manage_issues'")
    _replace_permission_check(_OLD)
    op.drop_table("issue_attachments")
    op.drop_table("issues")
