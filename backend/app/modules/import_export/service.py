"""Confluence import orchestration shared by the API and ARQ worker."""

from __future__ import annotations

import re
import tempfile
import uuid
import zipfile
from pathlib import Path

import anyio
from bs4 import BeautifulSoup
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestError, ConflictError, NotFoundError, PayloadTooLargeError
from app.models.attachment import PageAttachment
from app.models.import_job import ImportArchive, ImportJob, ImportLog
from app.models.page import WikiPage
from app.models.space import Space, SpaceMember, SpaceRole
from app.modules.import_export.confluence import iter_attachments, iter_page_bodies, scan_archive
from app.services.storage import ObjectStorage


def _slug(value: str, occupied: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:240] or "page"
    candidate, suffix = base, 2
    while candidate in occupied:
        candidate = f"{base[: 240 - len(str(suffix)) - 1]}-{suffix}"
        suffix += 1
    occupied.add(candidate)
    return candidate


def _link_imported_attachments(content: str, source_page_id: str, urls: dict[tuple[str, str], str]) -> str:
    """Turn Confluence attachment/image macros into usable WikiHub HTML."""
    page_urls = {filename: url for (page_id, filename), url in urls.items() if page_id == source_page_id}
    if not page_urls:
        return content
    soup = BeautifulSoup(content, "html.parser")
    for macro in soup.find_all("ac:image"):
        attachment = macro.find("ri:attachment")
        filename = attachment.get("ri:filename") if attachment else None
        if isinstance(filename, str) and filename in page_urls:
            image = soup.new_tag("img", src=page_urls[filename], alt=filename)
            macro.replace_with(image)
    for macro in soup.find_all("ac:link"):
        attachment = macro.find("ri:attachment")
        filename = attachment.get("ri:filename") if attachment else None
        if isinstance(filename, str) and filename in page_urls:
            link = soup.new_tag("a", href=page_urls[filename])
            link.string = macro.get_text(" ", strip=True) or filename
            macro.replace_with(link)
    result = str(soup)
    for filename, url in page_urls.items():
        result = result.replace(f"/download/attachments/{source_page_id}/{filename}", url)
    return result


class ConfluenceImportService:
    # S3 multipart uploads require every non-final part to be at least 5 MiB.
    # Eight MiB keeps retry costs reasonable without creating too many requests.
    upload_part_size_bytes = 8 * 1024 * 1024

    def __init__(self, session: AsyncSession, storage: ObjectStorage) -> None:
        self.session, self.storage = session, storage

    async def start_upload(
        self, *, filename: str, size_bytes: int, actor_id: uuid.UUID
    ) -> ImportArchive:
        if not filename.lower().endswith(".zip"):
            raise BadRequestError("Choose a .zip archive exported by Confluence.")
        from app.services.site_settings import SiteSettingsService

        limit = (
            await SiteSettingsService(self.session).get_effective()
        ).max_backup_import_size_bytes
        if size_bytes > limit:
            raise PayloadTooLargeError(
                f"Archive exceeds the configured {limit // (1024 * 1024)} MB limit."
            )
        archive = ImportArchive(
            object_key=f"imports/confluence/{uuid.uuid4()}/{filename}",
            filename=filename,
            size_bytes=size_bytes,
            created_by_id=actor_id,
        )
        self.session.add(archive)
        await self.session.flush()
        archive.multipart_upload_id = await self.storage.start_multipart_upload(
            archive.object_key, content_type="application/zip"
        )
        await self.session.flush()
        return archive

    async def get_archive(self, archive_id: uuid.UUID) -> ImportArchive:
        archive = await self.session.get(ImportArchive, archive_id)
        if archive is None:
            raise NotFoundError("Import archive was not found.")
        return archive

    async def uploaded_part_numbers(self, archive: ImportArchive) -> list[int]:
        if not archive.multipart_upload_id:
            return []
        return [
            number
            for number, _etag in await self.storage.list_multipart_parts(
                archive.object_key, archive.multipart_upload_id
            )
        ]

    async def upload_part_urls(
        self, archive: ImportArchive, part_numbers: list[int]
    ) -> dict[int, str]:
        if archive.status != "uploading" or not archive.multipart_upload_id:
            raise ConflictError("This archive is not accepting upload parts.")
        return {
            part_number: await self.storage.presigned_upload_part_url(
                archive.object_key, archive.multipart_upload_id, part_number, expires_in=3600
            )
            for part_number in part_numbers
        }

    async def complete_upload(self, archive: ImportArchive) -> ImportArchive:
        if archive.status != "uploading" or not archive.multipart_upload_id:
            raise ConflictError("This archive upload has already completed.")
        parts = await self.storage.list_multipart_parts(
            archive.object_key, archive.multipart_upload_id
        )
        expected_parts = (archive.size_bytes + self.upload_part_size_bytes - 1) // self.upload_part_size_bytes
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

    async def abort_upload(self, archive: ImportArchive) -> None:
        if archive.multipart_upload_id:
            try:
                await self.storage.abort_multipart_upload(
                    archive.object_key, archive.multipart_upload_id
                )
            except NotFoundError:
                # MinIO has already removed the multipart session (for example
                # after a previous abort). Cancellation is still complete.
                pass
        archive.multipart_upload_id = None
        archive.status = "cancelled"
        await self.session.flush()

    async def scan(self, archive: ImportArchive) -> ImportArchive:
        if not await self.storage.exists(archive.object_key):
            raise BadRequestError("The archive upload has not completed yet.")
        with tempfile.TemporaryDirectory(prefix="wikihub-confluence-scan-") as directory:
            path = Path(directory) / "archive.zip"
            await self.storage.download_to_file(archive.object_key, str(path))
            spaces = await anyio.to_thread.run_sync(scan_archive, path)
        existing = set((await self.session.execute(select(Space.key))).scalars())
        archive.spaces = [
            {
                "key": item.key,
                "name": item.name,
                "page_count": len(item.pages),
                "attachment_count": item.attachment_count,
                "conflict": item.key in existing,
            }
            for item in spaces
        ]
        archive.status = "scanned"
        archive.error = None
        await self.session.flush()
        return archive

    async def create_job(
        self,
        archive: ImportArchive,
        *,
        import_all: bool,
        space_keys: list[str],
        overwrite_existing: bool,
        actor_id: uuid.UUID,
    ) -> ImportJob:
        if archive.status != "scanned":
            raise ConflictError("Wait until the archive scan finishes before starting import.")
        available = {item["key"] for item in archive.spaces}
        selected = sorted(set(space_keys))
        if not import_all and not selected:
            raise BadRequestError("Select at least one Space or choose Import all spaces.")
        if set(selected) - available:
            raise BadRequestError("One or more selected Space keys are not in this archive.")
        selected_keys = available if import_all else set(selected)
        selected_spaces = [item for item in archive.spaces if item["key"] in selected_keys]
        job = ImportJob(
            archive_id=archive.id,
            created_by_id=actor_id,
            import_all=import_all,
            space_keys=[] if import_all else selected,
            overwrite_existing=overwrite_existing,
            counters={
                "spaces_total": len(selected_spaces),
                "spaces_completed": 0,
                "pages_total": sum(int(item.get("page_count", 0)) for item in selected_spaces),
                "pages_processed": 0,
                "attachments_processed": 0,
                "downloaded_bytes": 0,
                "download_total_bytes": archive.size_bytes,
                "download_percent": 0,
            },
        )
        self.session.add(job)
        await self.session.flush()
        return job


async def log(
    session: AsyncSession,
    job: ImportJob,
    level: str,
    phase: str,
    message: str,
    *,
    entity_type: str | None = None,
    entity_label: str | None = None,
) -> None:
    session.add(
        ImportLog(
            job_id=job.id,
            level=level,
            phase=phase,
            message=message,
            entity_type=entity_type,
            entity_label=entity_label,
        )
    )


async def run_import(session: AsyncSession, storage: ObjectStorage, job_id: uuid.UUID) -> None:
    job = await session.get(ImportJob, job_id)
    if job is None or job.status not in {"queued", "retrying"}:
        return
    archive = await session.get(ImportArchive, job.archive_id)
    if archive is None:
        return
    job.status, job.phase = "running", "downloading"
    await log(session, job, "info", "downloading", "Downloading archive to worker scratch space: 0%.")
    await session.commit()
    try:
        with tempfile.TemporaryDirectory(prefix="wikihub-confluence-import-") as directory:
            path = Path(directory) / "archive.zip"
            last_logged_tenth = 0

            async def record_download_progress(downloaded_bytes: int) -> None:
                nonlocal last_logged_tenth
                percent = min(100, int(downloaded_bytes * 100 / max(1, archive.size_bytes)))
                if percent == job.counters.get("download_percent", 0):
                    return
                job.counters = {
                    **job.counters,
                    "downloaded_bytes": min(downloaded_bytes, archive.size_bytes),
                    "download_total_bytes": archive.size_bytes,
                    "download_percent": percent,
                }
                if percent // 10 > last_logged_tenth:
                    last_logged_tenth = percent // 10
                    await log(
                        session,
                        job,
                        "info",
                        "downloading",
                        f"Downloading archive to worker scratch space: {percent}%.",
                    )
                await session.commit()

            await storage.download_to_file(
                archive.object_key,
                str(path),
                on_progress=record_download_progress,
            )
            job.phase = "scanning"
            job.counters = {
                **job.counters,
                "downloaded_bytes": archive.size_bytes,
                "download_total_bytes": archive.size_bytes,
                "download_percent": 100,
            }
            await log(session, job, "info", "scanning", "Archive downloaded. Reading its space structure.")
            await session.commit()
            scanned = await anyio.to_thread.run_sync(scan_archive, path)
            selected = {space.key for space in scanned} if job.import_all else set(job.space_keys)
            job.phase = "importing"
            await log(session, job, "info", "importing", "Archive ready. Importing selected spaces.")
            await session.commit()
            imported_pages: dict[str, WikiPage] = {}
            for source_space in scanned:
                if source_space.key not in selected:
                    continue
                await session.refresh(job)
                if job.cancel_requested:
                    job.status, job.phase = "cancelled", "cancelled"
                    await log(
                        session, job, "warning", "cancelled", "Import cancelled by administrator."
                    )
                    await session.commit()
                    return
                existing = (
                    await session.execute(select(Space).where(Space.key == source_space.key))
                ).scalar_one_or_none()
                if existing:
                    if job.overwrite_existing:
                        await session.delete(existing)
                        await session.flush()
                        await log(
                            session,
                            job,
                            "warning",
                            "spaces",
                            "Existing space was replaced with the archive version.",
                            entity_type="space",
                            entity_label=source_space.key,
                        )
                    else:
                        job.counters = {
                            **job.counters,
                            "spaces_completed": job.counters.get("spaces_completed", 0) + 1,
                        }
                        await log(
                            session,
                            job,
                            "warning",
                            "spaces",
                            "Skipped: Space key already exists.",
                            entity_type="space",
                            entity_label=source_space.key,
                        )
                        await session.commit()
                        continue
                space = Space(
                    key=source_space.key, name=source_space.name, created_by_id=job.created_by_id
                )
                session.add(space)
                await session.flush()
                session.add(
                    SpaceMember(space_id=space.id, user_id=job.created_by_id, role=SpaceRole.admin)
                )
                pages: dict[str, WikiPage] = {}
                occupied: set[str] = set()
                for source_page in source_space.pages:
                    page = WikiPage(
                        space_id=space.id,
                        title=source_page.title,
                        slug=_slug(source_page.title, occupied),
                        created_by_id=job.created_by_id,
                        updated_by_id=job.created_by_id,
                        content_format="html",
                    )
                    session.add(page)
                    pages[source_page.source_id] = page
                    imported_pages[source_page.source_id] = page
                await session.flush()
                for source_page in source_space.pages:
                    parent = pages.get(source_page.parent_id or "")
                    if parent:
                        pages[source_page.source_id].parent_id = parent.id
                    imported_page = pages[source_page.source_id]
                    if source_page.created_at:
                        imported_page.created_at = source_page.created_at
                    if source_page.updated_at:
                        imported_page.updated_at = source_page.updated_at
                    elif source_page.created_at:
                        imported_page.updated_at = source_page.created_at
                await session.flush()
                # Bodies are streamed in a second pass; only selected page ids are retained.
                for page_source_id, html in await anyio.to_thread.run_sync(
                    lambda: list(iter_page_bodies(path))
                ):
                    body_page: WikiPage | None = pages.get(page_source_id)
                    if body_page:
                        body_page.content = html
                count = len(pages)
                job.counters = {
                    **job.counters,
                    "spaces_completed": job.counters.get("spaces_completed", 0) + 1,
                    "pages_processed": job.counters.get("pages_processed", 0) + count,
                }
                await log(
                    session,
                    job,
                    "info",
                    "spaces",
                    f"Imported {count} current pages.",
                    entity_type="space",
                    entity_label=space.key,
                )
                await session.commit()
            attachments_imported = 0
            attachment_urls: dict[tuple[str, str], str] = {}
            attachment_sources = await anyio.to_thread.run_sync(lambda: list(iter_attachments(path)))
            with zipfile.ZipFile(path) as source_archive:
                for source_attachment, archive_member in attachment_sources:
                    target_page = imported_pages.get(source_attachment.page_id)
                    if target_page is None:
                        continue
                    attachment = PageAttachment(
                        page_id=target_page.id,
                        filename=source_attachment.filename[:255],
                        content_type=source_attachment.content_type[:255],
                        object_key="",
                    )
                    session.add(attachment)
                    await session.flush()
                    attachment.object_key = f"attachments/{target_page.id}/{attachment.id}/{source_attachment.filename}"
                    with source_archive.open(archive_member) as binary:
                        await storage.put(
                            attachment.object_key,
                            binary,
                            content_type=attachment.content_type,
                            metadata={"source": "confluence-import"},
                        )
                    attachment_urls[(source_attachment.page_id, source_attachment.filename)] = f"/api/v1/attachments/{attachment.id}/content"
                    attachments_imported += 1
            if attachment_urls:
                for source_page_id, target_page in imported_pages.items():
                    target_page.content = _link_imported_attachments(
                        target_page.content, source_page_id, attachment_urls
                    )
            job.counters = {
                **job.counters,
                "attachments_processed": attachments_imported,
            }
            await log(
                session,
                job,
                "info",
                "attachments",
                f"Imported {attachments_imported} attachments and linked them to their pages.",
            )
            await session.commit()
        job.status, job.phase = "completed", "completed"
        await session.commit()
    except Exception as exc:  # noqa: BLE001 - persist any worker failure for the operator
        await session.rollback()
        job = await session.get(ImportJob, job_id)
        if job:
            job.status, job.phase, job.error = "failed", "failed", str(exc)
            await log(session, job, "error", "failed", str(exc))
            await session.commit()
