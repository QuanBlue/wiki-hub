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
from app.models.backup_job import BackupArchive
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
        archives = (
            await self.session.execute(
                select(BackupArchive)
                .where(
                    BackupArchive.sha256 == sha256,
                    BackupArchive.size_bytes == size_bytes,
                    BackupArchive.status.in_(["uploaded", "scanned"]),
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
            reusable = await self.find_reusable_archive(sha256=sha256, size_bytes=size_bytes)
            if reusable is not None:
                return reusable
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
        if archive.multipart_upload_id:
            with suppress(NotFoundError):
                await self.storage.abort_multipart_upload(
                    archive.object_key, archive.multipart_upload_id
                )
            archive.multipart_upload_id = None
            archive.status = "cancelled"
            await self.session.flush()

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
        archive.spaces = [{"key": space.key, "name": space.name} for space in spaces]
        archive.status = "scanned"
        archive.error = None
        await self.session.flush()
        return archive
