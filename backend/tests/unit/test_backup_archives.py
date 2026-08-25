"""Unit tests for `BackupArchiveService` - the direct-to-storage chunked
upload lifecycle for full WikiHub backup archives. Mirrors the shape of
`ConfluenceImportService`'s equivalent methods, which this module was
modelled on."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest

from app.core.exceptions import (
    BadRequestError,
    ConflictError,
    NotFoundError,
    PayloadTooLargeError,
)
from app.models.backup_job import BackupArchive
from app.modules.backup.archives import BackupArchiveService
from app.modules.backup.package import BackupSpaceSummary


@pytest.fixture
def session():
    return AsyncMock()


@pytest.fixture
def storage():
    return AsyncMock()


@pytest.fixture
def archives(session, storage) -> BackupArchiveService:
    return BackupArchiveService(session, storage)


def _mock_effective(max_bytes: int):
    return patch(
        "app.modules.backup.archives.SiteSettingsService",
        return_value=Mock(get_effective=AsyncMock(return_value=Mock(max_backup_import_size_bytes=max_bytes))),
    )


@pytest.mark.asyncio
async def test_start_upload_rejects_non_zip(archives):
    with pytest.raises(BadRequestError, match="Choose a .zip file"):
        await archives.start_upload(filename="notes.txt", size_bytes=10, actor_id=uuid.uuid4())


@pytest.mark.asyncio
async def test_start_upload_rejects_oversized_archive(archives):
    with _mock_effective(1000):
        with pytest.raises(PayloadTooLargeError):
            await archives.start_upload(filename="backup.zip", size_bytes=2000, actor_id=uuid.uuid4())


@pytest.mark.asyncio
async def test_start_upload_reuses_matching_archive_by_hash(archives, storage):
    reusable = Mock(status="uploaded", object_key="k")
    archives.find_reusable_archive = AsyncMock(return_value=reusable)
    with _mock_effective(10**9):
        result = await archives.start_upload(
            filename="backup.zip", size_bytes=100, actor_id=uuid.uuid4(), sha256="a" * 64
        )
    assert result is reusable
    storage.start_multipart_upload.assert_not_called()


@pytest.mark.asyncio
async def test_start_upload_creates_archive_and_starts_multipart(archives, session, storage):
    archives.find_reusable_archive = AsyncMock(return_value=None)
    storage.start_multipart_upload = AsyncMock(return_value="upload-1")
    with _mock_effective(10**9):
        archive = await archives.start_upload(
            filename="backup.zip", size_bytes=100, actor_id=uuid.uuid4()
        )
    assert archive.filename == "backup.zip"
    assert archive.multipart_upload_id == "upload-1"
    assert archive.object_key.startswith("backups/imports/")
    session.add.assert_called_once()


@pytest.mark.asyncio
async def test_get_archive_not_found(archives, session):
    session.get.return_value = None
    with pytest.raises(NotFoundError):
        await archives.get_archive(uuid.uuid4())


@pytest.mark.asyncio
async def test_upload_part_urls_rejects_when_not_uploading(archives):
    archive = BackupArchive(
        id=uuid.uuid4(), object_key="k", filename="f.zip", size_bytes=10,
        status="uploaded", multipart_upload_id=None, created_by_id=uuid.uuid4(),
    )
    with pytest.raises(ConflictError):
        await archives.upload_part_urls(archive, [1])


@pytest.mark.asyncio
async def test_upload_part_urls_returns_presigned_urls(archives, storage):
    archive = BackupArchive(
        id=uuid.uuid4(), object_key="k", filename="f.zip", size_bytes=10,
        status="uploading", multipart_upload_id="up-1", created_by_id=uuid.uuid4(),
    )
    storage.presigned_upload_part_url = AsyncMock(return_value="https://example/part")
    urls = await archives.upload_part_urls(archive, [2, 1, 2])
    assert urls == {1: "https://example/part", 2: "https://example/part"}


@pytest.mark.asyncio
async def test_complete_upload_requires_every_part(archives, storage):
    archive = BackupArchive(
        id=uuid.uuid4(), object_key="k", filename="f.zip",
        size_bytes=archives.upload_part_size_bytes * 2, status="uploading",
        multipart_upload_id="up-1", created_by_id=uuid.uuid4(),
    )
    storage.list_multipart_parts = AsyncMock(return_value=[(1, "etag1")])  # missing part 2
    with pytest.raises(BadRequestError, match="incomplete"):
        await archives.complete_upload(archive)
    storage.complete_multipart_upload.assert_not_called()


@pytest.mark.asyncio
async def test_complete_upload_success(archives, session, storage):
    archive = BackupArchive(
        id=uuid.uuid4(), object_key="k", filename="f.zip",
        size_bytes=archives.upload_part_size_bytes, status="uploading",
        multipart_upload_id="up-1", created_by_id=uuid.uuid4(),
    )
    storage.list_multipart_parts = AsyncMock(return_value=[(1, "etag1")])
    result = await archives.complete_upload(archive)
    assert result.status == "uploaded"
    assert result.multipart_upload_id is None
    storage.complete_multipart_upload.assert_awaited_once()


@pytest.mark.asyncio
async def test_abort_upload_clears_multipart_state(archives, storage):
    archive = BackupArchive(
        id=uuid.uuid4(), object_key="k", filename="f.zip", size_bytes=10,
        status="uploading", multipart_upload_id="up-1", created_by_id=uuid.uuid4(),
    )
    await archives.abort_upload(archive)
    assert archive.status == "cancelled"
    assert archive.multipart_upload_id is None
    storage.abort_multipart_upload.assert_awaited_once_with("k", "up-1")


@pytest.mark.asyncio
async def test_scan_rejects_when_upload_incomplete(archives, storage):
    archive = BackupArchive(
        id=uuid.uuid4(), object_key="k", filename="f.zip", size_bytes=10,
        status="uploading", created_by_id=uuid.uuid4(),
    )
    storage.exists = AsyncMock(return_value=False)
    with pytest.raises(BadRequestError, match="has not completed"):
        await archives.scan(archive)


@pytest.mark.asyncio
async def test_scan_reads_spaces_through_a_ranged_reader_without_downloading(archives, storage):
    """The picker's space list must never pull the whole archive down.

    Regression test: `scan` used to download the archive and run the full
    `scan_full_backup` (whole-archive SHA-256 plus a checksum re-read of every
    entry), which for a real 16 GB backup took minutes and died in the proxy.
    """
    archive = BackupArchive(
        id=uuid.uuid4(), object_key="k", filename="f.zip", size_bytes=10,
        status="uploaded", created_by_id=uuid.uuid4(),
    )
    storage.exists = AsyncMock(return_value=True)
    reader = MagicMock()
    storage.open_reader = Mock(return_value=reader)
    with _mock_effective(10**9), patch(
        "app.modules.backup.archives.list_backup_spaces",
        return_value=[BackupSpaceSummary(key="ENG", name="Engineering")],
    ) as mocked_list:
        result = await archives.scan(archive)
    assert result.status == "scanned"
    assert result.spaces == [{"key": "ENG", "name": "Engineering"}]
    storage.open_reader.assert_called_once_with("k")
    mocked_list.assert_called_once()
    storage.download_to_file.assert_not_called()
    # The handle is context-managed, so a failed scan cannot leak a connection.
    reader.__exit__.assert_called_once()


@pytest.mark.asyncio
async def test_scan_rejects_an_archive_over_the_configured_limit(archives, storage):
    archive = BackupArchive(
        id=uuid.uuid4(), object_key="k", filename="f.zip", size_bytes=5000,
        status="uploaded", created_by_id=uuid.uuid4(),
    )
    storage.exists = AsyncMock(return_value=True)
    with _mock_effective(1000), pytest.raises(PayloadTooLargeError):
        await archives.scan(archive)
    storage.open_reader.assert_not_called()


@pytest.mark.asyncio
async def test_scan_wraps_unexpected_errors(archives, storage):
    archive = BackupArchive(
        id=uuid.uuid4(), object_key="k", filename="f.zip", size_bytes=10,
        status="uploaded", created_by_id=uuid.uuid4(),
    )
    storage.exists = AsyncMock(return_value=True)
    storage.open_reader = Mock(return_value=MagicMock())
    with _mock_effective(10**9), patch(
        "app.modules.backup.archives.list_backup_spaces",
        side_effect=RuntimeError("disk exploded"),
    ):
        with pytest.raises(BadRequestError, match="Could not scan backup archive"):
            await archives.scan(archive)
    assert archive.error == "disk exploded"


@pytest.mark.asyncio
async def test_scan_reuses_already_scanned_archive(archives, storage):
    archive = BackupArchive(
        id=uuid.uuid4(), object_key="k", filename="f.zip", size_bytes=10,
        status="scanned", spaces=[{"key": "ENG", "name": "Engineering"}],
        created_by_id=uuid.uuid4(),
    )
    result = await archives.scan(archive)
    assert result is archive
    storage.download_to_file.assert_not_called()
