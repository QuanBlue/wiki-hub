"""Shared progress, cancellation, relinking, and report helpers for backups."""

from __future__ import annotations

import hashlib
import html
import re
from collections.abc import Callable, Collection, Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, NamedTuple
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.backup_job import BackupJob, BackupJobLog
from app.models.comment import CommentLike, PageComment
from app.models.share import PageShare
from app.models.user import User
from app.schemas.backup import (
    BackupPageComment,
    BackupPageShare,
    ImportEntry,
    ImportReport,
)


class ExportCancelled(Exception):
    """Raised mid-export when an operator sets ``BackupJob.cancel_requested``."""


#: How often (in processed items) the export loops checkpoint: observe
#: `cancel_requested` and refresh the heartbeat. Fixed and small on purpose -
#: large exports must not go long stretches without observing a cancel request.
_PROGRESS_CHECK_EVERY = 25

#: A running job whose heartbeat is older than this is treated as abandoned by
#: its worker. Deliberately generous compared to the checkpoint cadence above:
#: a false positive marks a genuinely running export as failed, so the margin
#: has to absorb one unusually slow item (a very large attachment download).
STALE_JOB_AFTER = timedelta(minutes=5)

#: An overwrite restore (``BackupJob.kind == "full_import"`` with
#: ``overwrite_space_keys`` set) runs its attachment-copy, relink, and
#: permission-restore phases inside a still-open SAVEPOINT that must not be
#: committed early, so `_report_progress` deliberately stops checkpointing
#: the heartbeat for that whole stretch (see its comment in
#: `restore_full_package`) - committing there would release the SAVEPOINT
#: before the eventual rollback-on-failure it exists to protect. That
#: stretch has run past five minutes on a real archive (43 spaces, ~3,000
#: pages), which the reaper then read as an abandoned worker and marked the
#: row "failed" while it was still actively - and correctly - running to
#: completion. Every restore gets this longer grace period rather than
#: singling out overwrite ones, since a plain restore enters the same
#: checkpoint-free code path whenever it hits `restore_savepoint`.
STALE_RESTORE_JOB_AFTER = timedelta(minutes=30)


async def log_backup_event(
    session: AsyncSession,
    job: BackupJob,
    level: str,
    phase: str,
    message: str,
    *,
    entity_type: str | None = None,
    entity_label: str | None = None,
) -> BackupJobLog:
    """Append one narration line to a backup job.

    Mirrors `import_export.service.log` so the admin panel can render both
    job kinds the same way.  The row is only *added* to the session - the
    caller's next `checkpoint_backup_job` or commit is what makes it visible,
    which keeps this off the hot path of loops that run per attachment.
    """
    entry = BackupJobLog(
        job_id=job.id,
        # Stamped now, not at INSERT: a failed restore re-adds these after its
        # rollback (see `job_log_recovery`) and they must keep their own time.
        created_at=datetime.now(UTC),
        level=level,
        phase=phase,
        message=message,
        entity_type=entity_type,
        entity_label=entity_label,
    )
    session.add(entry)
    return entry


async def observe_backup_cancellation(session: AsyncSession, job: BackupJob | None) -> None:
    """Honour a pending cancel without committing anything.

    `checkpoint_backup_job` is the full stop: it also writes a heartbeat and
    progress counters, and *commits* to make them visible. That commit is the
    problem in the two places a restore spends most of its time - inside
    `import_document`'s SAVEPOINT, and inside the overwrite SAVEPOINT that has
    to stay open so a later failure can roll the destructive delete back
    atomically. Committing there would release the savepoint early and leave
    the eventual rollback operating on nothing, so those stretches simply
    skipped checkpointing - and with it, cancellation. A restore could be
    minutes past a Cancel click with nothing able to observe the flag.

    Reading is safe where committing is not: this only re-SELECTs the row.
    Postgres reads at READ COMMITTED, so a fresh SELECT sees the API's
    committed `cancel_requested` even from inside an open savepoint.
    """
    if job is None:
        return
    await session.refresh(job)
    if job.cancel_requested:
        raise ExportCancelled("Export cancelled by administrator.")


async def checkpoint_backup_job(
    session: AsyncSession,
    job: BackupJob,
    *,
    counters: Mapping[str, int] | None = None,
) -> None:
    """Prove the job is alive, honour a pending cancel, and persist progress.

    Every long-running phase of an export calls this. It is the *only* thing
    that lets an operator cancel a job that has already started, and the only
    thing that distinguishes a working job from one whose worker has died.
    """
    # Re-read from the database: `cancel_requested` is written by the API in a
    # different session, so an in-memory copy would never see it.
    await session.refresh(job)
    if job.cancel_requested:
        raise ExportCancelled("Export cancelled by administrator.")
    job.heartbeat_at = datetime.now(UTC)
    if counters:
        # `job.counters or {}`, not bare `job.counters`: a `BackupJob()`
        # built in Python and never yet flushed has `None` here (the
        # `nullable=False, default=dict` column default is applied at
        # INSERT, not on construction) - merging into it directly raised
        # once this became the normal way callers report counters.
        job.counters = {**(job.counters or {}), **counters}
    await session.commit()


class _PageIndexEntry(NamedTuple):
    """Just enough to resolve `space_key`/`slug`/`parent_slug` references.

    Deliberately not the `WikiPage` row itself, which also carries `content` -
    building this index from full rows (simplest, and what the code used to
    do) means every page's content sits in memory for the whole export just
    to answer "what space/slug does this id belong to", which does not scale.
    """

    space_id: UUID
    slug: str
    parent_id: UUID | None


class _HashingZipEntry:
    """Write UTF-8 text into an open zip entry while tracking a running
    sha256 + byte count, so a large entry's manifest checksum never requires
    holding the whole thing in memory to hash at the end."""

    def __init__(self, handle: Any) -> None:
        self._handle = handle
        self.digest = hashlib.sha256()
        self.size = 0

    def write(self, text: str) -> None:
        data = text.encode("utf-8")
        self._handle.write(data)
        self.digest.update(data)
        self.size += len(data)


#: Any tag carrying an `/api/v1/attachments/<uuid>` reference. Matched as a
#: whole tag (not just the URL) so the filename attribute sitting beside the
#: URL is available to identify what the link was *meant* to point at.
_ATTACHMENT_TAG_RE = re.compile(r"<[^>]*?/api/v1/attachments/[0-9a-fA-F-]{36}[^>]*?>")
_ATTACHMENT_ID_RE = re.compile(r"(/api/v1/attachments/)([0-9a-fA-F-]{36})")
#: In precedence order. `data-attachment` is what the editor writes on an
#: attachment link, `download` what a download anchor carries, and `alt` what
#: an embedded image keeps. Confirmed against real imported content: 346 of
#: 355 references in a production space carry one of these.
_ATTACHMENT_NAME_ATTRS = ("data-attachment", "download", "alt")


def _attachment_name_in(tag: str) -> str | None:
    for attr in _ATTACHMENT_NAME_ATTRS:
        found = re.search(rf'{attr}="([^"]*)"', tag)
        if found:
            # Attribute values are HTML-escaped; attachment filenames are not.
            return html.unescape(found.group(1))
    return None


def _relink_attachment_references(
    content: str,
    ids_by_filename: Mapping[str, UUID],
    valid_ids: Collection[UUID],
) -> str:
    """Repoint `/api/v1/attachments/<id>` links at the attachments that were
    actually restored for this page, identifying them by filename.

    Preserving attachment ids across a round trip (see ``BackupAttachment.id``)
    keeps links working when the archive is internally consistent. It cannot
    help when the archive itself is already broken - which is the normal state
    of any archive exported from an instance that was once restored by an
    older build, since that restore minted fresh ids without touching the
    content still referencing the old ones. Such an archive faithfully
    reproduces its own broken linkage no matter how correct the restore is, so
    the linkage has to be *rebuilt* rather than copied.

    Filename is the identity that survives all of it: the editor writes it into
    the tag next to the URL (`data-attachment`/`download`/`alt`), and it is the
    same string the attachment row stores.

    Deliberately conservative - a reference is only rewritten when the id it
    currently names is **not** a real attachment of this page. A link that
    already resolves is never touched, so a consistent archive restores
    byte-identical and only genuinely broken links are repaired.
    """
    if not content or not ids_by_filename:
        return content

    def rewrite(match: re.Match[str]) -> str:
        tag = match.group(0)
        current = _ATTACHMENT_ID_RE.search(tag)
        if current is None:  # pragma: no cover - guaranteed by _ATTACHMENT_TAG_RE
            return tag
        try:
            if UUID(current.group(2)) in valid_ids:
                return tag  # Already points at one of this page's attachments.
        except ValueError:  # pragma: no cover - the pattern only matches uuids
            return tag
        filename = _attachment_name_in(tag)
        replacement = ids_by_filename.get(filename) if filename else None
        if replacement is None:
            # No filename marker, or it names a file this page never had (a
            # link already dangling in the source instance). Leave it alone
            # rather than guess.
            return tag
        return _ATTACHMENT_ID_RE.sub(rf"\g<1>{replacement}", tag)

    return _ATTACHMENT_TAG_RE.sub(rewrite, content)


def _without_handled_conflicts(result: ImportReport, overwritten: set[str]) -> ImportReport:
    """Drop spaces the caller already chose to overwrite from the conflict list.

    `conflicting_space_keys` exists to ask the admin one question: "these
    spaces already exist - replace them?". An overwrite restore deletes the
    conflicting spaces' *pages* but deliberately keeps the `Space` rows
    themselves, so membership and permissions survive - which means `_apply`
    still reports every one of them as `key_exists`. Left unfiltered, the
    answer to that question comes back as the very same question, and the
    admin is stuck confirming "replace and restore" forever.

    A space named in `overwrite_space_keys` has already been dealt with in
    this run, so it is no longer an open decision.
    """
    if not overwritten:
        return result
    remaining = [key for key in result.conflicting_space_keys if key not in overwritten]
    if len(remaining) == len(result.conflicting_space_keys):
        return result
    return result.model_copy(update={"conflicting_space_keys": remaining})


class _ReportBuilder:
    """Accumulates counts exactly, per-item entries only up to a cap."""

    def __init__(self) -> None:
        self.created: dict[str, int] = {}
        self.skipped: dict[str, int] = {}
        self.errors: dict[str, int] = {}
        self.entries: list[ImportEntry] = []
        self.truncated = False
        #: Not capped like `entries` - the caller needs the exact set of
        #: conflicting space keys to offer a follow-up overwrite restore.
        self.conflicting_space_keys: list[str] = []

    def add(
        self,
        kind: str,
        label: str,
        outcome: Literal["created", "skipped", "error"],
        reason: str = "",
    ) -> None:
        bucket = {"created": self.created, "skipped": self.skipped, "error": self.errors}[outcome]
        bucket[kind] = bucket.get(kind, 0) + 1
        from app.modules.backup import service as _service

        if len(self.entries) < _service.MAX_REPORT_ENTRIES:
            self.entries.append(ImportEntry(kind=kind, label=label, outcome=outcome, reason=reason))
        else:
            self.truncated = True


def _parents_first(
    items: Sequence[Any],
    key: Callable[[Any], UUID],
    parent: Callable[[Any], UUID | None],
) -> list[Any]:
    """``items`` reordered so every parent comes before its replies, keeping
    the given order otherwise. Ordering by time alone cannot promise that:
    a reply written in the same transaction as its parent (an import, a
    script) shares its timestamp, and a tie broken by random UUID put the
    reply first - which a restore then skipped as "missing parent"."""
    by_id = {key(item): item for item in items}
    placed: set[UUID] = set()
    ordered: list[Any] = []
    for start in items:
        # Walk up to the oldest unplaced ancestor, then place downward.
        chain: list[Any] = []
        current: Any = start
        while current is not None and key(current) not in placed:
            chain.append(current)
            parent_id = parent(current)
            current = by_id.get(parent_id) if parent_id is not None else None
            if current is not None and any(key(current) == key(seen) for seen in chain):
                break  # a cycle cannot happen, but must not loop forever
        for item in reversed(chain):
            if key(item) not in placed:
                placed.add(key(item))
                ordered.append(item)
    return ordered


def _comment_entries(
    comments: Sequence[PageComment],
    likes: Sequence[CommentLike],
    page_ref: Callable[[UUID], tuple[str, str] | None],
    users_by_id: dict[UUID, User],
) -> list[BackupPageComment]:
    """Backup rows for the comments whose page is part of this backup.

    ``comments`` must already be oldest first, so a restore meets every parent
    before its replies. A reply whose parent was filtered out (it cannot be:
    both live on the same page) is dropped with it.
    """
    comments = _parents_first(comments, lambda c: c.id, lambda c: c.parent_id)
    likers: dict[UUID, list[str]] = {}
    for like in likes:
        user = users_by_id.get(like.user_id)
        if user is not None:
            likers.setdefault(like.comment_id, []).append(user.username)
    entries: list[BackupPageComment] = []
    for comment in comments:
        ref = page_ref(comment.page_id)
        if ref is None:
            continue
        author = users_by_id.get(comment.author_id) if comment.author_id else None
        entries.append(
            BackupPageComment(
                id=comment.id,
                parent_id=comment.parent_id,
                page_space_key=ref[0],
                page_slug=ref[1],
                author_username=author.username if author else None,
                body=comment.body,
                created_at=comment.created_at,
                edited_at=comment.edited_at,
                mentions=list(comment.mentions or []),
                liked_by=sorted(likers.get(comment.id, [])),
            )
        )
    return entries


def _share_entries(
    shares: Sequence[PageShare],
    page_ref: Callable[[UUID], tuple[str, str] | None],
    users_by_id: dict[UUID, User],
) -> list[BackupPageShare]:
    """Backup rows for the shares whose page and recipient are part of this backup."""
    entries: list[BackupPageShare] = []
    for share in sorted(shares, key=lambda row: (row.created_at, row.id)):
        ref = page_ref(share.page_id)
        recipient = users_by_id.get(share.recipient_id)
        if ref is None or recipient is None:
            continue
        sharer = users_by_id.get(share.shared_by_id) if share.shared_by_id else None
        entries.append(
            BackupPageShare(
                id=share.id,
                page_space_key=ref[0],
                page_slug=ref[1],
                recipient_username=recipient.username,
                shared_by_username=sharer.username if sharer else None,
                created_at=share.created_at,
            )
        )
    return entries
