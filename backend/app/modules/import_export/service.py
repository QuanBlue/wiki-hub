"""Confluence import orchestration shared by the API and ARQ worker."""

from __future__ import annotations

import re
import tempfile
import uuid
from pathlib import Path

import anyio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestError, ConflictError, NotFoundError, PayloadTooLargeError
from app.models.import_job import ImportArchive, ImportJob, ImportLog
from app.models.page import WikiPage
from app.models.space import Space, SpaceMember, SpaceRole
from app.modules.import_export.confluence import iter_page_bodies, scan_archive
from app.services.storage import ObjectStorage


def _slug(value: str, occupied: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:240] or "page"
    candidate, suffix = base, 2
    while candidate in occupied:
        candidate = f"{base[: 240 - len(str(suffix)) - 1]}-{suffix}"
        suffix += 1
    occupied.add(candidate)
    return candidate


class ConfluenceImportService:
    def __init__(self, session: AsyncSession, storage: ObjectStorage) -> None:
        self.session, self.storage = session, storage

    async def start_upload(
        self, *, filename: str, size_bytes: int, actor_id: uuid.UUID
    ) -> tuple[ImportArchive, str]:
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
        return archive, await self.storage.presigned_upload_url(
            archive.object_key, content_type="application/zip", expires_in=3600
        )

    async def get_archive(self, archive_id: uuid.UUID) -> ImportArchive:
        archive = await self.session.get(ImportArchive, archive_id)
        if archive is None:
            raise NotFoundError("Import archive was not found.")
        return archive

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
                "attachment_count": 0,
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
        job = ImportJob(
            archive_id=archive.id,
            created_by_id=actor_id,
            import_all=import_all,
            space_keys=[] if import_all else selected,
            counters={
                "spaces_total": len(available) if import_all else len(selected),
                "spaces_completed": 0,
                "pages_processed": 0,
                "attachments_processed": 0,
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
    job.status, job.phase = "running", "preparing"
    await log(session, job, "info", "preparing", "Downloading archive to worker scratch space.")
    await session.commit()
    try:
        with tempfile.TemporaryDirectory(prefix="wikihub-confluence-import-") as directory:
            path = Path(directory) / "archive.zip"
            await storage.download_to_file(archive.object_key, str(path))
            scanned = await anyio.to_thread.run_sync(scan_archive, path)
            selected = {space.key for space in scanned} if job.import_all else set(job.space_keys)
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
                await session.flush()
                for source_page in source_space.pages:
                    parent = pages.get(source_page.parent_id or "")
                    if parent:
                        pages[source_page.source_id].parent_id = parent.id
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
        job.status, job.phase = "completed", "completed"
        await log(
            session,
            job,
            "warning",
            "attachments",
            "Attachments are not imported because WikiHub attachment storage is not available yet.",
        )
        await session.commit()
    except Exception as exc:  # noqa: BLE001 - persist any worker failure for the operator
        await session.rollback()
        job = await session.get(ImportJob, job_id)
        if job:
            job.status, job.phase, job.error = "failed", "failed", str(exc)
            await log(session, job, "error", "failed", str(exc))
            await session.commit()
