from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.core.exceptions import BadRequestError, NotFoundError, PayloadTooLargeError
from app.models.import_job import ImportArchive
from app.modules.import_export import service as import_module
from app.modules.import_export.service import ConfluenceImportService


class _ScalarResult:
    def __init__(self, values):
        self.values = values

    def scalars(self):
        return self

    def first(self):
        return self.values[0] if self.values else None

    def __iter__(self):
        return iter(self.values)


@pytest.mark.asyncio
async def test_resolve_users_reuses_cache_and_creates_missing_user() -> None:
    session = Mock()
    session.execute = AsyncMock(side_effect=[_ScalarResult([]), _ScalarResult([])])
    session.flush = AsyncMock()
    added = []
    session.add.side_effect = added.append

    async def assign_id() -> None:
        if added and getattr(added[-1], "id", None) is None:
            added[-1].id = uuid.uuid4()

    session.flush.side_effect = assign_id
    service = ConfluenceImportService(session, Mock())
    assert await service._resolve_or_create_user("  Alice ") is not None
    assert await service._resolve_or_create_user("Alice") == added[0].id
    assert await service._resolve_or_create_user("0123456789abcdef0123456789abcdef") is None

    existing = SimpleNamespace(id=uuid.uuid4())
    session.execute = AsyncMock(return_value=_ScalarResult([existing]))
    service = ConfluenceImportService(session, Mock())
    assert await service._resolve_or_create_user("Existing") == existing.id


@pytest.mark.asyncio
async def test_upload_lifecycle_and_archive_conflicts(monkeypatch: pytest.MonkeyPatch) -> None:
    session = Mock()
    session.execute = AsyncMock()
    session.flush = AsyncMock()
    storage = Mock()
    storage.exists = AsyncMock(return_value=False)
    storage.start_multipart_upload = AsyncMock(return_value="upload-1")
    storage.list_multipart_parts = AsyncMock(return_value=[(1, "etag")])
    storage.presigned_upload_part_url = AsyncMock(return_value="part-url")
    storage.complete_multipart_upload = AsyncMock()
    storage.abort_multipart_upload = AsyncMock()
    service = ConfluenceImportService(session, storage)

    with pytest.raises(BadRequestError):
        await service.start_upload(filename="archive.tar", size_bytes=1, actor_id=uuid.uuid4())

    monkeypatch.setattr(
        "app.services.site_settings.SiteSettingsService.get_effective",
        AsyncMock(return_value=SimpleNamespace(max_backup_import_size_bytes=10)),
    )
    with pytest.raises(PayloadTooLargeError):
        await service.start_upload(filename="archive.zip", size_bytes=11, actor_id=uuid.uuid4())

    archive = await service.start_upload(filename="archive.zip", size_bytes=1, actor_id=uuid.uuid4())
    archive.status = "uploading"
    assert archive.status == "uploading"
    assert archive.multipart_upload_id == "upload-1"

    archive.spaces = [{"key": "ENG"}]
    session.execute.return_value = _ScalarResult([])
    session.get = AsyncMock(return_value=archive)
    assert await service.get_archive(archive.id) is archive
    archive.multipart_upload_id = None
    assert await service.uploaded_part_numbers(archive) == []
    archive.multipart_upload_id = "upload-1"
    assert await service.uploaded_part_numbers(archive) == [1]
    archive.status = "uploading"
    assert await service.upload_part_urls(archive, [1]) == {1: "part-url"}

    archive.size_bytes = service.upload_part_size_bytes
    await service.complete_upload(archive)
    assert archive.status == "uploaded"
    assert archive.multipart_upload_id is None

    archive.status = "uploading"
    archive.multipart_upload_id = "upload-2"
    storage.abort_multipart_upload.side_effect = NotFoundError("gone")
    await service.abort_upload(archive)
    assert archive.status == "cancelled"


@pytest.mark.asyncio
async def test_upload_reuse_and_job_validation() -> None:
    session = Mock()
    session.execute = AsyncMock(return_value=_ScalarResult([]))
    session.flush = AsyncMock()
    storage = Mock()
    storage.exists = AsyncMock(return_value=True)
    service = ConfluenceImportService(session, storage)
    archive = SimpleNamespace(object_key="key", status="uploaded", sha256="hash", size_bytes=3, multipart_upload_id=None)
    session.execute.return_value = _ScalarResult([archive])
    assert await service.find_reusable_archive(sha256="hash", size_bytes=3) is archive

    scanned = ImportArchive(
        object_key="key",
        filename="archive.zip",
        size_bytes=10,
        status="scanned",
        spaces=[{"key": "ENG", "page_count": 2}],
        created_by_id=uuid.uuid4(),
    )
    with pytest.raises(BadRequestError):
        await service.create_job(scanned, import_all=False, space_keys=[], overwrite_existing=False, actor_id=uuid.uuid4())
    with pytest.raises(BadRequestError):
        await service.create_job(scanned, import_all=False, space_keys=["NOPE"], overwrite_existing=False, actor_id=uuid.uuid4())
    job = await service.create_job(scanned, import_all=True, space_keys=[], overwrite_existing=True, actor_id=uuid.uuid4())
    assert job.import_all is True
    assert job.counters["pages_total"] == 2


@pytest.mark.asyncio
async def test_scan_paths_and_log(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    session = Mock()
    session.execute = AsyncMock(return_value=_ScalarResult([]))
    session.flush = AsyncMock()
    storage = Mock()
    storage.exists = AsyncMock(return_value=False)
    service = ConfluenceImportService(session, storage)
    archive = ImportArchive(
        object_key="key",
        filename="archive.zip",
        size_bytes=1,
        status="uploading",
        spaces=[],
        created_by_id=uuid.uuid4(),
    )
    with pytest.raises(BadRequestError):
        await service.scan(archive)

    archive.status = "scanned"
    archive.spaces = [{"key": "ENG"}]
    session.execute.return_value = _ScalarResult([])
    await service.scan(archive)
    assert archive.error is None

    job = SimpleNamespace(id=uuid.uuid4())
    entry = await import_module.log(session, job, "info", "scan", "done", entity_type="space")
    assert entry.message == "done"
