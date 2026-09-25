"""A failed Confluence import keeps the log lines written since its last commit."""

from __future__ import annotations

import asyncio
import uuid
import zipfile

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_job import ImportArchive, ImportJob, ImportLog
from app.modules.auth.service import AuthService
from app.modules.import_export import service as import_module
from app.modules.import_export.confluence import ConfluencePage, ConfluenceSpace
from app.modules.import_export.service import run_import
from app.schemas.user import UserCreate

pytestmark = pytest.mark.integration


class _Storage:
    async def download_to_file(self, _key: str, destination: str, on_progress=None) -> None:
        with zipfile.ZipFile(destination, "w") as archive:
            archive.writestr("entities.xml", "<root />")


async def _queued_job(session: AsyncSession) -> ImportJob:
    user = await AuthService(session).create_user(
        UserCreate(
            username=f"logs{uuid.uuid4().hex[:8]}",
            email=f"logs{uuid.uuid4().hex[:8]}@example.com",
            password="password-1234",
        )
    )
    archive = ImportArchive(
        object_key=f"imports/{uuid.uuid4()}.zip",
        filename="export.zip",
        size_bytes=10,
        sha256=uuid.uuid4().hex * 2,
        status="scanned",
        created_by_id=user.id,
        spaces=[{"key": "LOGS", "name": "Logs", "page_count": 1}],
    )
    session.add(archive)
    await session.flush()
    job = ImportJob(
        archive_id=archive.id,
        created_by_id=user.id,
        import_all=True,
        space_keys=[],
        overwrite_existing=False,
        status="queued",
        phase="queued",
        counters={},
    )
    session.add(job)
    await session.flush()
    return job


def _patch_scan(monkeypatch: pytest.MonkeyPatch) -> None:
    page = ConfluencePage(
        source_id="p1", space_id="s1", parent_id=None, title="Home", status="current",
        created_at=None, updated_at=None,
    )
    space = ConfluenceSpace(source_id="s1", key="LOGS", name="Logs", pages=[page])
    monkeypatch.setattr(import_module, "scan_archive", lambda _path: [space])
    monkeypatch.setattr(import_module, "iter_page_bodies", lambda _path: [("p1", "<p>x</p>")])


@pytest.mark.parametrize(
    ("error", "status"),
    [(RuntimeError("boom"), "failed"), (asyncio.CancelledError(), "failed")],
)
async def test_a_failed_import_keeps_the_lines_it_had_not_yet_committed(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch, error: BaseException, status: str
) -> None:
    job = await _queued_job(session)
    _patch_scan(monkeypatch)

    async def dies_after_logging(session_, job_, _blocking):
        # Added to the session but never committed - what a mid-loop failure leaves behind.
        await import_module.log(session_, job_, "warning", "attachments", "the line that explains it")
        raise error

    monkeypatch.setattr(import_module, "_run_with_heartbeat", dies_after_logging)

    if isinstance(error, asyncio.CancelledError):
        with pytest.raises(asyncio.CancelledError):
            await run_import(session, _Storage(), job.id)
    else:
        await run_import(session, _Storage(), job.id)

    await session.refresh(job)
    assert job.status == status
    messages = (
        await session.execute(select(ImportLog.message).where(ImportLog.job_id == job.id))
    ).scalars().all()
    assert "the line that explains it" in messages
    assert any(message for message in messages if message != "the line that explains it")
