"""Document imports: turning uploaded Word/PDF/HTML files into wiki pages.

Separate tables from `ImportJob` (Confluence) and `BackupJob` deliberately.
Those two are admin-only workspace-wide operations, and
`app/services/import_concurrency.py` treats an active row in either as "the
workspace is claimed". Reusing them would mean an ordinary user importing a
Word file blocks an administrator from running a restore - and, in the other
direction, that they inherit `archive_id`, `space_keys` and `overwrite_existing`
columns that mean nothing here.

There is no third `*_logs` table on purpose. `ImportLog` and `BackupJobLog`
exist because those jobs narrate thousands of unrelated entities against a
single job row. Here the batch is at most a handful of files, and every line
worth writing is about exactly one of them - so `DocumentImportItem` *is* the
log, one row per file, and the admin panel's log list renders it directly.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BIGINT, Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class DocumentImportJob(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One "import these files" request, covering a batch of documents."""

    __tablename__ = "document_import_jobs"
    __table_args__ = (
        Index("ix_document_import_jobs_space_created", "space_id", "created_at"),
        Index("ix_document_import_jobs_creator_status", "created_by_id", "status"),
    )

    space_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("spaces.id", ondelete="CASCADE"), nullable=False
    )
    #: Where the new pages are attached. Null means top level. `SET NULL`
    #: rather than cascade: the job is a historical record and outlives the
    #: page someone happened to have open when they started it.
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("pages.id", ondelete="SET NULL"), nullable=True
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="queued")
    phase: Mapped[str] = mapped_column(String(32), nullable=False, default="queued")
    #: How a title collision should be handled once the worker derives the
    #: document's real page title (which can differ from the filename).
    conflict_mode: Mapped[str] = mapped_column(
        String(16), nullable=False, default="rename", server_default="rename"
    )
    #: Throttled progress signal, shaped to match what `backup.py::_job_progress`
    #: reads so percent and ETA are derived by the same code:
    #: items_total, items_processed, items_failed, pages_created,
    #: attachments_created.
    counters: Mapped[dict[str, int]] = mapped_column(JSONB, nullable=False, default=dict)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: Refreshed while the worker works. A "running" row with a stale heartbeat
    #: belongs to a worker that died and is reaped; without it there is no way
    #: to distinguish that from slow progress, and the UI would spin forever.
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    items: Mapped[list[DocumentImportItem]] = relationship(
        back_populates="job",
        cascade="all, delete-orphan",
        order_by="DocumentImportItem.position",
        lazy="selectin",
    )


class DocumentImportItem(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One uploaded file, and what became of it."""

    __tablename__ = "document_import_items"
    __table_args__ = (Index("ix_document_import_items_job_position", "job_id", "position"),)

    job_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("document_import_jobs.id", ondelete="CASCADE"),
        nullable=False,
    )
    #: The order the user picked the files in, preserved so the created pages
    #: appear in the order they expect rather than in upload-completion order.
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(
        String(255), nullable=False, default="application/octet-stream"
    )
    #: Staged in object storage because the API and the worker are separate
    #: containers - a temp file written by uvicorn is invisible to arq.
    object_key: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    size_bytes: Mapped[int] = mapped_column(BIGINT, nullable=False, default=0)
    source_format: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="queued")
    page_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("pages.id", ondelete="SET NULL"), nullable=True
    )
    #: Denormalised beside the FK on purpose. This row records what happened;
    #: a page later renamed or deleted must not silently rewrite or blank the
    #: history entry, so the title and slug as created are kept verbatim.
    page_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    page_slug: Mapped[str | None] = mapped_column(String(255), nullable=True)
    attachments_created: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    #: Non-fatal notes: images dropped by the workspace allowlist, a scanned
    #: PDF, content truncated. The file still imported; the user should know
    #: what it cost.
    warnings: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    job: Mapped[DocumentImportJob] = relationship(back_populates="items")
