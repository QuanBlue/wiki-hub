"""Direct-to-storage chunked upload lifecycle for full WikiHub backup archives.

Mirrors `ConfluenceImportService`'s upload/scan machinery
(`app/modules/import_export/service.py`) - same presigned-multipart
bookkeeping, same resumable-part tracking, same sha256-dedup-by-hash - just
parameterized onto `BackupArchive` instead of `ImportArchive`. A restore of a
large WikiHub backup ZIP needs the same fix Confluence imports already have:
one giant multipart POST forces Starlette to spool the whole upload into its
own uncapped temp storage before any of this application's own size checks
ever run. Splitting the upload into many small, bounded PUTs (this module)
avoids that failure mode by construction, instead of just raising the caps
that only run once the (already too late) spool has finished.
"""

from __future__ import annotations

import uuid
from contextlib import suppress
from typing import Any

import anyio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    BadRequestError,
    ConflictError,
    NotFoundError,
    PayloadTooLargeError,
)
from app.core.logging import get_logger
from app.models.backup_job import BackupArchive, BackupJob
from app.models.space import Space
from app.modules.backup.package import BackupSpaceSummary, list_backup_spaces
from app.services.site_settings import SiteSettingsService
from app.services.storage import ObjectStorage

logger = get_logger(__name__)


class BackupArchiveService:
    #: Matches `ConfluenceImportService.upload_part_size_bytes` - S3 multipart
    #: uploads require every non-final part to be at least 5 MiB, and every
    #: part transits this process as one bounded PUT body, never a multipart
    #: form field, so Starlette's uncapped file-part spool never applies.
    upload_part_size_bytes = 8 * 1024 * 1024

    def __init__(self, session: AsyncSession, storage: ObjectStorage) -> None:
        self.session, self.storage = session, storage

    async def find_reusable_archive(
        self, *, sha256: str, size_bytes: int
    ) -> BackupArchive | None:
        """A finished archive whose bytes are already in storage, if one exists.

        "cancelled" counts. Since `abort_upload` stopped deleting the object,
        a cancelled row is a file still sitting in the bucket, and the whole
        point of keeping it is that picking the same backup again costs
        nothing. Excluding it would mean every cancelled restore charged a
        fresh multi-GB upload *and* left a second copy of the same bytes
        behind. `storage.exists` below is what keeps this honest: a row whose
        object really is gone - deleted by hand from the storage panel - is
        skipped, and the caller starts a genuine upload.
        """
        archives = (
            await self.session.execute(
                select(BackupArchive)
                .where(
                    BackupArchive.sha256 == sha256,
                    BackupArchive.size_bytes == size_bytes,
                    BackupArchive.status.in_(["uploaded", "scanned", "cancelled"]),
                    BackupArchive.multipart_upload_id.is_(None),
                )
                .order_by(BackupArchive.updated_at.desc(), BackupArchive.created_at.desc())
                .limit(5)
            )
        ).scalars()
        for archive in archives:
            if await self.storage.exists(archive.object_key):
                return archive
        return None

    async def find_resumable_archive(
        self, *, sha256: str, size_bytes: int
    ) -> BackupArchive | None:
        """An *unfinished* upload of this same file that can be continued.

        `find_reusable_archive` above only matches an archive that finished
        uploading, which never happens for a backup big enough to need more
        than one sitting: every attempt at a multi-GB archive then starts a
        brand-new upload from part 1. Matching a partial upload by the same
        fingerprint is what lets the client pick up where it left off.

        The match is keyed on the fingerprint rather than on an id the client
        remembered, so a resume survives a reload, a new tab, or a different
        browser - the file itself is the key.
        """
        archives = (
            await self.session.execute(
                select(BackupArchive)
                .where(
                    BackupArchive.sha256 == sha256,
                    BackupArchive.size_bytes == size_bytes,
                    BackupArchive.status == "uploading",
                    BackupArchive.multipart_upload_id.is_not(None),
                )
                .order_by(BackupArchive.updated_at.desc(), BackupArchive.created_at.desc())
                .limit(5)
            )
        ).scalars()
        for archive in archives:
            # The row outliving its multipart upload is normal - S3 lifecycle
            # rules expire incomplete uploads, and an aborted one is gone
            # immediately. Only a still-live upload can be resumed; anything
            # else falls through to a fresh one.
            try:
                await self.storage.list_multipart_parts(
                    archive.object_key, str(archive.multipart_upload_id)
                )
            except NotFoundError:
                continue
            return archive
        return None

    async def start_upload(
        self, *, filename: str, size_bytes: int, actor_id: uuid.UUID, sha256: str | None = None
    ) -> BackupArchive:
        if not filename.lower().endswith(".zip"):
            raise BadRequestError(
                "Choose a .zip file created by WikiHub.", code="invalid_backup_file"
            )
        limit = (
            await SiteSettingsService(self.session).get_effective()
        ).max_backup_import_size_bytes
        if size_bytes > limit:
            raise PayloadTooLargeError(
                f"Archive exceeds the configured {limit // (1024 * 1024)} MB limit."
            )
        if sha256:
            # A finished archive wins: its bytes are whole, so the client can
            # skip the upload entirely. Only if there is none does a partial
            # upload of the same file become worth continuing.
            reusable = await self.find_reusable_archive(sha256=sha256, size_bytes=size_bytes)
            if reusable is not None:
                if reusable.status == "cancelled":
                    # Choosing a previously cancelled backup again is a
                    # re-selection, not a re-upload: its bytes never left the
                    # bucket. Revive to "scanned" when the space list from the
                    # earlier scan is still on the row, so the picker opens
                    # immediately instead of re-reading a multi-GB archive.
                    reusable.status = "scanned" if reusable.spaces else "uploaded"
                    await self.session.flush()
                return reusable
            resumable = await self.find_resumable_archive(sha256=sha256, size_bytes=size_bytes)
            if resumable is not None:
                return resumable
        archive = BackupArchive(
            object_key=f"backups/imports/{uuid.uuid4()}/{filename}",
            filename=filename,
            size_bytes=size_bytes,
            sha256=sha256,
            created_by_id=actor_id,
        )
        self.session.add(archive)
        await self.session.flush()
        archive.multipart_upload_id = await self.storage.start_multipart_upload(
            archive.object_key, content_type="application/zip"
        )
        await self.session.flush()
        return archive

    async def get_archive(self, archive_id: uuid.UUID) -> BackupArchive:
        archive = await self.session.get(BackupArchive, archive_id)
        if archive is None:
            raise NotFoundError("Backup archive was not found.")
        return archive

    async def spaces_for_display(self, archive: BackupArchive) -> list[dict[str, Any]]:
        """The archive's space list with its conflict flags recomputed now.

        `archive.spaces` stores whatever `scan` found, conflict flags and all,
        and those were true only at scan time. A restore creates spaces, so
        every key it just restored stops being a conflict-free choice the
        moment it finishes - and the picker, reopened to restore the spaces
        that were skipped, would still be inviting the user to pick the ones
        already done.

        Recomputed rather than written back: this is a view of the archive
        against the current workspace, not a fact about the archive.
        """
        return await self._with_conflicts(archive.spaces or [])

    async def uploaded_part_numbers(self, archive: BackupArchive) -> list[int]:
        if not archive.multipart_upload_id:
            return []
        return [
            number
            for number, _etag in await self.storage.list_multipart_parts(
                archive.object_key, archive.multipart_upload_id
            )
        ]

    async def upload_part_urls(
        self, archive: BackupArchive, part_numbers: list[int]
    ) -> dict[int, str]:
        if archive.status != "uploading" or not archive.multipart_upload_id:
            raise ConflictError("This archive is not accepting upload parts.")
        return {
            part_number: await self.storage.presigned_upload_part_url(
                archive.object_key, archive.multipart_upload_id, part_number, expires_in=3600
            )
            for part_number in part_numbers
        }

    async def complete_upload(self, archive: BackupArchive) -> BackupArchive:
        if archive.status != "uploading" or not archive.multipart_upload_id:
            raise ConflictError("This archive upload has already completed.")
        parts = await self.storage.list_multipart_parts(
            archive.object_key, archive.multipart_upload_id
        )
        expected_parts = (
            archive.size_bytes + self.upload_part_size_bytes - 1
        ) // self.upload_part_size_bytes
        actual_parts = {number for number, _etag in parts}
        if actual_parts != set(range(1, expected_parts + 1)):
            raise BadRequestError("The archive upload is incomplete.")
        await self.storage.complete_multipart_upload(
            archive.object_key, archive.multipart_upload_id, parts
        )
        archive.multipart_upload_id = None
        archive.status = "uploaded"
        await self.session.flush()
        return archive

    async def abort_upload(self, archive: BackupArchive) -> None:
        """Take an archive out of the restore flow, whatever stage it reached.

        Out of the flow, not out of the bucket. Cancelling a restore is a
        decision about this workspace's data; it is not a decision to throw
        away the file the operator uploaded, which may have taken hours to
        get here. A finished upload is a real object under `backups/imports/`,
        listed and deletable in Administration > Object storage, so deleting
        it belongs to whoever goes there and asks for it - and until they do,
        `find_reusable_archive` can hand the same bytes straight back instead
        of charging another multi-GB upload for the same file.

        An *unfinished* multipart upload is the one thing that still has to
        go. Its parts are not an object yet: nothing lists them, nothing in
        the admin panel can delete them, and abandoning them leaks storage
        that no operator can ever reach. Those are aborted, as before.

        This method also used to act *only* while a multipart upload was open,
        which left a different hole: a scanned archive has no multipart id, so
        discarding one did nothing at all - the picker cleared itself, the row
        stayed "scanned", and the next page load handed the same archive
        straight back with the file input locked against it. Marking the row
        cancelled is what closes that, and it does not depend on deleting
        anything.
        """
        active_job = (
            await self.session.execute(
                select(BackupJob.id)
                .where(
                    BackupJob.archive_id == archive.id,
                    BackupJob.status.in_(["queued", "running"]),
                )
                .limit(1)
            )
        ).first()
        if active_job is not None:
            raise ConflictError(
                "A restore is running from this archive. Cancel the restore first."
            )

        if archive.multipart_upload_id:
            with suppress(NotFoundError):
                await self.storage.abort_multipart_upload(
                    archive.object_key, archive.multipart_upload_id
                )
            archive.multipart_upload_id = None
        # No `else`: a completed upload's object stays put. See the docstring.
        archive.status = "cancelled"
        await self.session.flush()

    async def _with_conflicts(
        self, spaces: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Flag the spaces whose key already exists in this instance.

        The Confluence picker has always shown this (`ConfluenceImportService.
        scan`); the restore picker did not, so the only warning about existing
        spaces arrived after the restore, as a list of what it had skipped.
        """
        existing = set((await self.session.execute(select(Space.key))).scalars())
        return [
            {**space, "conflict": space.get("key") in existing} for space in spaces
        ]

    async def scan(self, archive: BackupArchive) -> BackupArchive:
        """Populate `archive.spaces` for the "select spaces to restore" picker.

        Reads the archive *in place* in object storage through a ranged
        reader, pulling only the ZIP central directory and the workspace
        manifest - a few MB even for a multi-GB backup. It deliberately does
        not use `scan_full_backup`: that verifies every checksum in the
        archive, which for a 16 GB backup meant downloading and hashing it
        twice over, taking minutes and timing out this request long before it
        answered. Full verification still happens, in the restore job, right
        before anything is written.
        """
        if archive.status == "scanned" and archive.spaces:
            # Conflicts are re-derived, never cached: a space that existed when
            # this archive was scanned may have been deleted since, and the
            # picker must not warn about a collision that is no longer there.
            archive.spaces = await self._with_conflicts(archive.spaces)
            await self.session.flush()
            return archive
        if not await self.storage.exists(archive.object_key):
            raise BadRequestError("The archive upload has not completed yet.")
        limit = (
            await SiteSettingsService(self.session).get_effective()
        ).max_backup_import_size_bytes
        if archive.size_bytes > limit:
            raise PayloadTooLargeError(
                f"Archive exceeds the configured {limit // (1024 * 1024)} MB limit."
            )

        def _read_spaces() -> list[BackupSpaceSummary]:
            with self.storage.open_reader(archive.object_key) as reader:
                return list_backup_spaces(reader, max_size_bytes=limit)

        try:
            spaces = await anyio.to_thread.run_sync(_read_spaces)
        except (BadRequestError, PayloadTooLargeError) as scan_error:
            archive.error = str(scan_error)
            await self.session.flush()
            raise
        except Exception as scan_error:
            logger.error(
                "backup_archive_scan_failed",
                archive_id=str(archive.id),
                error=str(scan_error),
                exc_info=True,
            )
            archive.error = str(scan_error)
            await self.session.flush()
            raise BadRequestError(
                f"Could not scan backup archive: {scan_error}"
            ) from scan_error
        archive.spaces = await self._with_conflicts(
            [
                {
                    "key": space.key,
                    "name": space.name,
                    "page_count": space.page_count,
                }
                for space in spaces
            ]
        )
        archive.status = "scanned"
        archive.error = None
        await self.session.flush()
        return archive
