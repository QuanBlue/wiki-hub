"""Durable background export jobs for portable backup artifacts."""

from __future__ import annotations

import os
import tempfile
import uuid
from contextlib import suppress

import anyio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.attachment import PageAttachment
from app.models.backup_job import BackupJob
from app.models.page import WikiPage
from app.models.space import Space
from app.modules.backup.confluence_export import CONFLUENCE_DC_PROFILES, write_confluence_dc_export
from app.modules.backup.service import BackupService
from app.services.storage import ObjectStorage


def _read_file(path: str) -> bytes:
    with open(path, "rb") as source:
        return source.read()


async def create_export_job(
    session: AsyncSession,
    *,
    actor_id: uuid.UUID,
    kind: str,
    include_credentials: bool = False,
    confluence_profile: str | None = None,
    space_keys: list[str] | None = None,
) -> BackupJob:
    if kind not in {"full_export", "confluence_export"}:
        raise ValueError("Unknown backup export type.")
    if kind == "confluence_export" and confluence_profile not in CONFLUENCE_DC_PROFILES:
        raise ValueError("A Confluence Data Center compatibility profile is required.")
    job = BackupJob(
        kind=kind,
        created_by_id=actor_id,
        include_credentials=include_credentials if kind == "full_export" else False,
        confluence_profile=confluence_profile,
        space_keys=space_keys or [],
        status="queued",
        phase="queued",
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)
    return job


async def run_backup_job(session: AsyncSession, storage: ObjectStorage, job_id: uuid.UUID) -> None:
    job = await session.get(BackupJob, job_id)
    if job is None or job.status in {"complete", "cancelled"}:
        return
    job.status, job.phase, job.error = "running", "exporting", None
    await session.commit()
    suffix = "full.zip" if job.kind == "full_export" else "confluence-dc.zip"
    local_path = ""
    try:
        with tempfile.NamedTemporaryFile(
            prefix="wikihub-backup-", suffix=f"-{suffix}", delete=False
        ) as temp:
            local_path = temp.name
        if job.cancel_requested:
            job.status, job.phase = "cancelled", "cancelled"
            await session.commit()
            return
        if job.kind == "full_export":
            service = BackupService(session)
            manifest = await service.export_full_package(
                local_path, storage, include_credentials=job.include_credentials
            )
            job.counters = {
                str(key): int(value) for key, value in manifest.get("counts", {}).items()
            }
            filename = f"wikihub-full-backup-{job.created_at:%Y%m%d-%H%M%S}.zip"
        elif job.kind == "confluence_export":
            spaces_query = select(Space).order_by(Space.key)
            if job.space_keys:
                spaces_query = spaces_query.where(Space.key.in_(job.space_keys))
            spaces = list((await session.execute(spaces_query)).scalars())
            pages = list((await session.execute(select(WikiPage))).scalars())
            attachments = list((await session.execute(select(PageAttachment))).scalars())
            await write_confluence_dc_export(
                local_path,
                storage,
                profile=job.confluence_profile or "",
                spaces=spaces,
                pages=pages,
                attachments=attachments,
            )
            job.counters = {"spaces": len(spaces)}
            filename = (
                f"wikihub-confluence-{job.confluence_profile}-{job.created_at:%Y%m%d-%H%M%S}.zip"
            )
        else:
            raise ValueError("Unknown backup job.")
        if job.cancel_requested:
            job.status, job.phase = "cancelled", "cancelled"
            await session.commit()
            return
        key = f"backups/exports/{job.id}/{filename}"
        contents = await anyio.to_thread.run_sync(_read_file, local_path)
        await storage.put(key, contents, content_type="application/zip")
        job.output_key, job.output_filename = key, filename
        job.status, job.phase = "complete", "complete"
        await session.commit()
    except Exception as exc:
        job.status, job.phase, job.error = "failed", "failed", str(exc)[:4000]
        await session.commit()
        raise
    finally:
        if local_path:
            with suppress(FileNotFoundError):
                os.unlink(local_path)
