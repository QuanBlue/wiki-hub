"""Unit tests for the direct-to-storage backup archive upload endpoints in
`app/api/v1/backup.py` - mirrors `app/api/v1/confluence_import.py`'s upload
endpoints, called here the same way the rest of this test module calls
FastAPI route functions directly rather than through a TestClient."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.api.v1.backup import (
    cancel_backup_archive_upload,
    complete_backup_archive_upload,
    create_backup_import,
    get_backup_archive,
    get_backup_archive_upload_part_urls,
    get_backup_archive_upload_progress,
    list_active_backup_archive_uploads,
    scan_backup_archive,
    start_backup_archive_upload,
)
from app.core.exceptions import BadRequestError, NotFoundError
from app.models.backup_job import BackupArchive
from app.schemas.backup import (
    BackupArchiveUploadInit,
    BackupArchiveUploadPartUrlsRequest,
    BackupImportCreate,
)


def _mock_effective(max_bytes: int = 10**9):
    return patch(
        "app.api.v1.backup.SiteSettingsService",
        return_value=Mock(get_effective=AsyncMock(return_value=Mock(max_backup_import_size_bytes=max_bytes))),
    )


def _archive(**overrides):
    defaults = dict(
        id=uuid.uuid4(), object_key="backups/imports/x/f.zip", filename="f.zip",
        size_bytes=10, status="uploading", multipart_upload_id=None,
        created_by_id=uuid.uuid4(), spaces=[], error=None, sha256=None,
    )
    return BackupArchive(**{**defaults, **overrides})


@pytest.mark.asyncio
async def test_start_backup_archive_upload():
    user = Mock(id=uuid.uuid4())
    archives = AsyncMock()
    archives.session = AsyncMock()
    archives.upload_part_size_bytes = 8 * 1024 * 1024
    archives.start_upload = AsyncMock(return_value=_archive(status="uploading", sha256=None))

    with _mock_effective(10**9):
        result = await start_backup_archive_upload(
            BackupArchiveUploadInit(filename="f.zip", size_bytes=100), user, archives
        )
    assert result.object_key == "backups/imports/x/f.zip"
    assert result.part_size_bytes == 8 * 1024 * 1024
    assert result.reused is False


@pytest.mark.asyncio
async def test_start_backup_archive_upload_reports_parts_already_uploaded():
    """A resumed archive must carry its existing part numbers back to the
    client, which skips them. Without this the server could match a
    half-uploaded multi-GB archive and the browser would still re-send every
    byte of it."""
    user = Mock(id=uuid.uuid4())
    archives = AsyncMock()
    archives.session = AsyncMock()
    archives.upload_part_size_bytes = 8 * 1024 * 1024
    archives.start_upload = AsyncMock(return_value=_archive(status="uploading"))
    archives.uploaded_part_numbers = AsyncMock(return_value=[1, 2, 3])

    with _mock_effective(10**9):
        result = await start_backup_archive_upload(
            BackupArchiveUploadInit(filename="f.zip", size_bytes=100), user, archives
        )
    assert result.reused is False
    assert result.uploaded_parts == [1, 2, 3]


@pytest.mark.asyncio
async def test_start_backup_archive_upload_skips_part_lookup_when_complete():
    """A finished archive needs no part list - the client skips the upload
    entirely, so asking storage for its parts would be a wasted round trip."""
    user = Mock(id=uuid.uuid4())
    archives = AsyncMock()
    archives.session = AsyncMock()
    archives.upload_part_size_bytes = 8 * 1024 * 1024
    archives.start_upload = AsyncMock(return_value=_archive(status="scanned"))

    with _mock_effective(10**9):
        result = await start_backup_archive_upload(
            BackupArchiveUploadInit(filename="f.zip", size_bytes=100), user, archives
        )
    assert result.reused is True
    assert result.uploaded_parts == []
    archives.uploaded_part_numbers.assert_not_called()


@pytest.mark.asyncio
async def test_list_active_backup_archive_uploads():
    user = Mock(id=uuid.uuid4())
    session = AsyncMock()
    archives = AsyncMock()
    archives.upload_part_size_bytes = 8 * 1024 * 1024
    archives.uploaded_part_numbers = AsyncMock(return_value=[1, 2])

    row = _archive(status="uploading")
    result = Mock()
    result.scalars.return_value.all.return_value = [row]
    session.execute.return_value = result

    res = await list_active_backup_archive_uploads(user, session, archives)
    assert len(res) == 1
    assert res[0].archive_id == row.id
    assert res[0].uploaded_parts == [1, 2]


@pytest.mark.asyncio
async def test_get_backup_archive_upload_progress():
    archives = AsyncMock()
    archives.upload_part_size_bytes = 8 * 1024 * 1024
    archive = _archive()
    archives.get_archive = AsyncMock(return_value=archive)
    archives.uploaded_part_numbers = AsyncMock(return_value=[1])

    res = await get_backup_archive_upload_progress(archive.id, Mock(), archives)
    assert res.archive_id == archive.id
    assert res.uploaded_parts == [1]


@pytest.mark.asyncio
async def test_get_backup_archive_upload_part_urls_rejects_out_of_range_part():
    archives = AsyncMock()
    archives.upload_part_size_bytes = 10
    archive = _archive(size_bytes=10, status="uploading", multipart_upload_id="up-1")
    archives.get_archive = AsyncMock(return_value=archive)

    with pytest.raises(NotFoundError):
        await get_backup_archive_upload_part_urls(
            archive.id, BackupArchiveUploadPartUrlsRequest(part_numbers=[99]), Mock(), archives
        )


@pytest.mark.asyncio
async def test_get_backup_archive_upload_part_urls_same_origin_proxy():
    """A live multipart upload gets same-origin proxy URLs, not raw MinIO
    URLs - a direct MinIO URL carries a localhost/internal hostname that
    cannot work once WikiHub is reachable from anywhere else."""
    archives = AsyncMock()
    archives.upload_part_size_bytes = 10
    archive = _archive(size_bytes=10, status="uploading", multipart_upload_id="up-1")
    archives.get_archive = AsyncMock(return_value=archive)

    res = await get_backup_archive_upload_part_urls(
        archive.id, BackupArchiveUploadPartUrlsRequest(part_numbers=[1]), Mock(), archives
    )
    assert res.urls[1].startswith("/api/v1/storage/object?key=")
    assert "upload_id=up-1" in res.urls[1]
    archives.upload_part_urls.assert_not_called()


@pytest.mark.asyncio
async def test_get_backup_archive_upload_part_urls_delegates_when_not_live():
    archives = AsyncMock()
    archives.upload_part_size_bytes = 10
    archive = _archive(size_bytes=10, status="uploaded", multipart_upload_id=None)
    archives.get_archive = AsyncMock(return_value=archive)
    archives.upload_part_urls = AsyncMock(return_value={1: "https://presigned"})

    res = await get_backup_archive_upload_part_urls(
        archive.id, BackupArchiveUploadPartUrlsRequest(part_numbers=[1]), Mock(), archives
    )
    assert res.urls == {1: "https://presigned"}


@pytest.mark.asyncio
async def test_complete_and_cancel_backup_archive_upload():
    archives = AsyncMock()
    archive = _archive()
    archives.get_archive = AsyncMock(return_value=archive)
    archives.complete_upload = AsyncMock(return_value=_archive(status="uploaded"))

    result = await complete_backup_archive_upload(archive.id, Mock(), archives)
    assert result.status == "uploaded"

    archives.abort_upload = AsyncMock()
    await cancel_backup_archive_upload(archive.id, Mock(), archives)
    archives.abort_upload.assert_awaited_once()


@pytest.mark.asyncio
async def test_scan_and_get_backup_archive():
    archives = AsyncMock()
    archive = _archive(status="scanned", spaces=[{"key": "ENG", "name": "Engineering"}])
    archives.get_archive = AsyncMock(return_value=archive)
    archives.scan = AsyncMock(return_value=archive)

    scanned = await scan_backup_archive(archive.id, Mock(), archives)
    assert scanned.spaces[0].key == "ENG"

    got = await get_backup_archive(archive.id, Mock(), archives)
    assert got.id == archive.id


@pytest.mark.asyncio
async def test_create_backup_import_success_and_validation_error(monkeypatch):
    user = Mock(id=uuid.uuid4())
    session = AsyncMock()
    archive_id = uuid.uuid4()

    async def mock_create_import_job(*args, **kwargs):
        m = Mock()
        m.id = uuid.uuid4()
        m.kind = "full_import"
        m.status = "queued"
        m.phase = "queued"
        m.counters = {}
        m.cancel_requested = False
        m.include_credentials = False
        m.confluence_profile = None
        m.space_keys = kwargs.get("space_keys", [])
        m.archive_id = kwargs.get("archive_id")
        m.overwrite_space_keys = kwargs.get("overwrite_space_keys", [])
        m.result = None
        m.output_filename = None
        m.error = None
        m.started_at = None
        m.heartbeat_at = None
        from datetime import datetime, UTC
        m.created_at = datetime.now(UTC)
        m.updated_at = datetime.now(UTC)
        return m

    monkeypatch.setattr("app.api.v1.backup.create_import_job", mock_create_import_job)
    monkeypatch.setattr("app.api.v1.backup._enqueue", AsyncMock())
    # The "no concurrent Confluence import" guard has its own tests below;
    # here it would otherwise trip on the AsyncMock session.
    monkeypatch.setattr(
        "app.api.v1.backup.assert_no_active_confluence_import", AsyncMock()
    )

    res = await create_backup_import(
        archive_id, BackupImportCreate(space_keys=["ENG"]), user, session
    )
    assert res.kind == "full_import"
    assert res.archive_id == archive_id
    assert res.space_keys == ["ENG"]

    async def mock_create_import_job_err(*args, **kwargs):
        raise ValueError("Unknown backup archive.")

    monkeypatch.setattr("app.api.v1.backup.create_import_job", mock_create_import_job_err)
    with pytest.raises(BadRequestError):
        await create_backup_import(archive_id, BackupImportCreate(), user, session)
