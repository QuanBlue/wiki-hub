"""Durable full-backup archives and background jobs.

The Confluence import rows deliberately remain separate.  A WikiHub backup has
different trust boundaries (it can carry identities and credentials) and a
different lifecycle (it can be downloaded as an export or staged for restore).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BIGINT, Boolean, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class BackupArchive(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "backup_archives"
    __table_args__ = (Index("ix_backup_archives_creator_status", "created_by_id", "status"),)

    object_key: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BIGINT, nullable=False)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="uploading")
    multipart_upload_id: Mapped[str | None] = mapped_column(String(512), nullable=True)
    manifest: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    spaces: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )


class BackupJob(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "backup_jobs"
    __table_args__ = (Index("ix_backup_jobs_created_at", "created_at"),)

    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    archive_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("backup_archives.id", ondelete="SET NULL"), nullable=True
    )
    output_key: Mapped[str | None] = mapped_column(String(512), unique=True, nullable=True)
    output_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    include_credentials: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    confluence_profile: Mapped[str | None] = mapped_column(String(32), nullable=True)
    import_all: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    space_keys: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    overwrite_space_keys: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="queued")
    phase: Mapped[str] = mapped_column(String(32), nullable=False, default="queued")
    counters: Mapped[dict[str, int]] = mapped_column(JSONB, nullable=False, default=dict)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: Refreshed by the worker while it works. A "running" row whose heartbeat
    #: has gone stale belongs to a worker that died, and is reaped - without
    #: this there is no way to tell the two apart, and an orphaned job would
    #: keep a progress bar spinning in the admin UI forever.
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Set once, when a restore (`kind="full_import"`) job reaches "complete" -
    #: the `ImportReport` the old synchronous endpoint used to return directly
    #: in its HTTP response. `counters` stays a throttled progress signal
    #: written many times while the job runs; this is the opposite shape,
    #: write-once and much richer than `dict[str, int]`.
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class BackupJobLog(UUIDPrimaryKeyMixin, Base):
    """One line of narration from a running backup job.

    `counters` answers "how far along?" and `phase` answers "doing what?", but
    neither survives being overwritten: both are current-state columns, so a
    step that has finished leaves no trace.  Watching a multi-hour restore
    against a progress bar alone gives no way to tell steady work from a
    wedged worker, and no record afterwards of what it actually touched.

    Deliberately the same shape as `ImportLog`, which the Confluence import
    already writes and the same admin panel already renders - the two job
    kinds are shown side by side, and an operator should not have to learn
    two different accounts of the same kind of work.  They stay separate
    tables for the reason the module docstring gives: different trust
    boundaries and lifecycles, and a FK can only point at one job table.
    """

    __tablename__ = "backup_job_logs"
    __table_args__ = (Index("ix_backup_job_logs_job_created", "job_id", "created_at"),)

    job_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("backup_jobs.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    level: Mapped[str] = mapped_column(String(12), nullable=False)
    phase: Mapped[str] = mapped_column(String(32), nullable=False)
    #: What the line is about ("space", "attachment", ...) and which one, kept
    #: apart from `message` so the UI can style or filter on them later
    #: without parsing prose.
    entity_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    entity_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
