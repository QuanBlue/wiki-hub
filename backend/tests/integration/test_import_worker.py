from __future__ import annotations

import uuid
import zipfile

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_job import ImportArchive, ImportJob
from app.modules.auth.service import AuthService
from app.modules.import_export import service as import_module
from app.modules.import_export.confluence import ConfluencePage, ConfluenceSpace
from app.modules.import_export.service import run_import
from app.schemas.user import UserCreate

pytestmark = pytest.mark.integration


class WorkerStorage:
    async def download_to_file(self, _key: str, destination: str, on_progress=None) -> None:
        with zipfile.ZipFile(destination, "w") as archive:
            archive.writestr("entities.xml", "<root />")
        if on_progress:
            await on_progress(10)


async def test_run_import_imports_space_pages_and_completes(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await AuthService(session).create_user(
        UserCreate(
            username=f"worker{uuid.uuid4().hex[:8]}",
            email=f"worker{uuid.uuid4().hex[:8]}@example.com",
            password="password-1234",
        )
    )
    archive = ImportArchive(
        object_key=f"imports/{uuid.uuid4()}.zip",
        filename="export.zip",
        size_bytes=10,
        sha256="a" * 64,
        status="scanned",
        created_by_id=user.id,
        spaces=[{"key": "ENG", "name": "Engineering", "page_count": 1}],
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
    source = ConfluencePage(
        source_id="p1",
        space_id="s1",
        parent_id=None,
        title="Home",
        status="current",
        created_at=None,
        updated_at=None,
        creator="missing-import-user",
        last_modifier=None,
    )
    space = ConfluenceSpace(source_id="s1", key="ENG", name="Engineering", pages=[source])
    monkeypatch.setattr(import_module, "scan_archive", lambda _path: [space])
    monkeypatch.setattr(import_module, "iter_page_bodies", lambda _path: [("p1", "<p>Body</p>")])
    monkeypatch.setattr(import_module, "iter_attachments", lambda _path: [])

    await run_import(session, WorkerStorage(), job.id)
    await session.refresh(job)
    assert job.status == "completed"
    assert job.counters["pages_processed"] == 1
