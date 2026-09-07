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


class _ScalarResult:
    """Minimal stand-in for a SQLAlchemy Result: `scan` reads the existing
    space keys to flag conflicts in the picker."""

    def __init__(self, values):
        self._values = values

    def scalars(self):
        return self._values

    def first(self):
        return self._values[0] if self._values else None


@pytest.fixture
def session():
    mock = AsyncMock()
    mock.execute = AsyncMock(return_value=_ScalarResult([]))
    return mock


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
    with _mock_effective(1000), pytest.raises(PayloadTooLargeError):
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
async def test_get_archive_returns_the_found_row(archives, session):
    archive = BackupArchive(
        id=uuid.uuid4(), object_key="k", filename="f.zip", size_bytes=10,
        status="uploaded", created_by_id=uuid.uuid4(),
    )
    session.get.return_value = archive

    assert await archives.get_archive(archive.id) is archive


@pytest.mark.asyncio
async def test_spaces_for_display_recomputes_conflicts(archives):
    archive = BackupArchive(
        id=uuid.uuid4(), object_key="k", filename="f.zip", size_bytes=10,
        status="scanned", created_by_id=uuid.uuid4(),
        spaces=[{"key": "ENG", "name": "Engineering", "page_count": 1,
                 "attachment_count": 0, "conflict": False}],
    )
    archives._with_conflicts = AsyncMock(return_value=["recomputed"])

    result = await archives.spaces_for_display(archive)

    assert result == ["recomputed"]
    archives._with_conflicts.assert_awaited_once_with(archive.spaces)


@pytest.mark.asyncio
async def test_spaces_for_display_handles_a_never_scanned_archive(archives):
    archive = BackupArchive(
        id=uuid.uuid4(), object_key="k", filename="f.zip", size_bytes=10,
        status="uploaded", created_by_id=uuid.uuid4(), spaces=None,
    )
    archives._with_conflicts = AsyncMock(return_value=[])

    await archives.spaces_for_display(archive)

    archives._with_conflicts.assert_awaited_once_with([])


@pytest.mark.asyncio
async def test_uploaded_part_numbers_with_no_multipart_upload_yet(archives):
    archive = BackupArchive(
        id=uuid.uuid4(), object_key="k", filename="f.zip", size_bytes=10,
        status="uploaded", multipart_upload_id=None, created_by_id=uuid.uuid4(),
    )

    assert await archives.uploaded_part_numbers(archive) == []


@pytest.mark.asyncio
async def test_uploaded_part_numbers_lists_what_storage_already_has(archives, storage):
    archive = BackupArchive(
        id=uuid.uuid4(), object_key="k", filename="f.zip", size_bytes=10,
        status="uploading", multipart_upload_id="up-1", created_by_id=uuid.uuid4(),
    )
    storage.list_multipart_parts = AsyncMock(
        return_value=[(1, "etag1"), (2, "etag2")]
    )

    result = await archives.uploaded_part_numbers(archive)

    assert result == [1, 2]


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
async def test_complete_upload_rejects_an_already_completed_archive(archives, storage):
    archive = BackupArchive(
        id=uuid.uuid4(), object_key="k", filename="f.zip", size_bytes=10,
        status="uploaded", multipart_upload_id=None, created_by_id=uuid.uuid4(),
    )
    with pytest.raises(ConflictError, match="already completed"):
        await archives.complete_upload(archive)
    storage.list_multipart_parts.assert_not_called()


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
        return_value=[BackupSpaceSummary(key="ENG", name="Engineering", page_count=7)],
    ) as mocked_list:
        result = await archives.scan(archive)
    assert result.status == "scanned"
    assert result.spaces == [
        {"key": "ENG", "name": "Engineering", "page_count": 7, "conflict": False}
    ]
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
    ), pytest.raises(BadRequestError, match="Could not scan backup archive"):
        await archives.scan(archive)
    assert archive.error == "disk exploded"


@pytest.mark.asyncio
async def test_scan_records_and_reraises_a_verdict_on_the_archive_itself(
    archives, session, storage
):
    # Distinct from test_scan_wraps_unexpected_errors above: list_backup_spaces
    # raising BadRequestError/PayloadTooLargeError is itself the verdict (a
    # malformed or too-large archive), not an unexpected failure to wrap - so
    # it is recorded and re-raised as-is, not replaced with a generic message.
    archive = BackupArchive(
        id=uuid.uuid4(), object_key="k", filename="f.zip", size_bytes=10,
        status="uploaded", created_by_id=uuid.uuid4(),
    )
    storage.exists = AsyncMock(return_value=True)
    storage.open_reader = Mock(return_value=MagicMock())
    with _mock_effective(10**9), patch(
        "app.modules.backup.archives.list_backup_spaces",
        side_effect=BadRequestError("This is not a WikiHub backup archive."),
    ), pytest.raises(BadRequestError, match="not a WikiHub backup archive"):
        await archives.scan(archive)
    assert archive.error == "This is not a WikiHub backup archive."
    session.flush.assert_awaited()


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


# -- resuming a partial upload of the same file -----------------------------


def _uploading(**overrides) -> BackupArchive:
    defaults = dict(
        id=uuid.uuid4(), object_key="k", filename="f.zip", size_bytes=10,
        status="uploading", multipart_upload_id="up-1", sha256="a" * 64,
        created_by_id=uuid.uuid4(),
    )
    return BackupArchive(**{**defaults, **overrides})


def _scalars(rows):
    result = Mock()
    result.scalars.return_value = iter(rows)
    return result


@pytest.mark.asyncio
async def test_find_resumable_archive_returns_a_live_partial_upload(archives, session, storage):
    archive = _uploading()
    session.execute = AsyncMock(return_value=_scalars([archive]))
    storage.list_multipart_parts = AsyncMock(return_value=[(1, "etag1")])

    found = await archives.find_resumable_archive(sha256="a" * 64, size_bytes=10)
    assert found is archive


@pytest.mark.asyncio
async def test_find_resumable_archive_skips_an_expired_multipart_upload(archives, session, storage):
    """A row can outlive its multipart upload - S3 lifecycle rules expire
    incomplete uploads. Resuming against one of those would fail on the first
    part, so it must fall through to a fresh upload instead."""
    session.execute = AsyncMock(return_value=_scalars([_uploading()]))
    storage.list_multipart_parts = AsyncMock(side_effect=NotFoundError("gone"))

    assert await archives.find_resumable_archive(sha256="a" * 64, size_bytes=10) is None


@pytest.mark.asyncio
async def test_start_upload_resumes_a_partial_upload_of_the_same_file(archives, storage):
    """The behaviour the whole change exists for: re-selecting a multi-GB file
    whose upload was interrupted continues it rather than starting over."""
    partial = _uploading()
    archives.find_reusable_archive = AsyncMock(return_value=None)
    archives.find_resumable_archive = AsyncMock(return_value=partial)

    with _mock_effective(10**9):
        result = await archives.start_upload(
            filename="backup.zip", size_bytes=10, actor_id=uuid.uuid4(), sha256="a" * 64
        )
    assert result is partial
    storage.start_multipart_upload.assert_not_called()


@pytest.mark.asyncio
async def test_start_upload_prefers_a_completed_archive_over_a_partial_one(archives):
    """A finished archive needs no upload at all, so it wins over a partial."""
    complete = Mock(status="uploaded")
    archives.find_reusable_archive = AsyncMock(return_value=complete)
    archives.find_resumable_archive = AsyncMock()

    with _mock_effective(10**9):
        result = await archives.start_upload(
            filename="backup.zip", size_bytes=10, actor_id=uuid.uuid4(), sha256="a" * 64
        )
    assert result is complete
    archives.find_resumable_archive.assert_not_called()


@pytest.mark.asyncio
async def test_start_upload_without_a_fingerprint_never_resumes(archives, storage):
    archives.find_reusable_archive = AsyncMock()
    archives.find_resumable_archive = AsyncMock()
    storage.start_multipart_upload = AsyncMock(return_value="upload-9")

    with _mock_effective(10**9):
        await archives.start_upload(
            filename="backup.zip", size_bytes=10, actor_id=uuid.uuid4()
        )
    archives.find_reusable_archive.assert_not_called()
    archives.find_resumable_archive.assert_not_called()
    storage.start_multipart_upload.assert_awaited_once()


@pytest.mark.asyncio
async def test_scan_flags_spaces_whose_key_already_exists(archives, session, storage):
    """The Confluence picker has always shown this; the restore picker did not,
    so the only warning about existing spaces arrived *after* the restore, as a
    list of what it had skipped."""
    archive = BackupArchive(
        id=uuid.uuid4(), object_key="k", filename="f.zip", size_bytes=10,
        status="uploaded", created_by_id=uuid.uuid4(),
    )
    storage.exists = AsyncMock(return_value=True)
    storage.open_reader = Mock(return_value=MagicMock())
    session.execute = AsyncMock(return_value=_ScalarResult(["ENG"]))
    with _mock_effective(10**9), patch(
        "app.modules.backup.archives.list_backup_spaces",
        return_value=[
            BackupSpaceSummary(key="ENG", name="Engineering", page_count=2),
            BackupSpaceSummary(key="NEW", name="Brand new", page_count=5),
        ],
    ):
        result = await archives.scan(archive)
    assert result.spaces == [
        {"key": "ENG", "name": "Engineering", "page_count": 2, "conflict": True},
        {"key": "NEW", "name": "Brand new", "page_count": 5, "conflict": False},
    ]


@pytest.mark.asyncio
async def test_scan_flags_a_conflict_regardless_of_key_casing(archives, session, storage):
    """Confluence personal spaces travel as lower-case (`~jdoe`); every space
    this instance itself creates is upper-cased (`BackupService.import_document`).
    A raw, un-normalised comparison would miss this and show no conflict for
    a space that in fact already exists - the picker would offer no Replace,
    and the restore would only report the collision afterwards, as something
    it silently skipped."""
    archive = BackupArchive(
        id=uuid.uuid4(), object_key="k", filename="f.zip", size_bytes=10,
        status="uploaded", created_by_id=uuid.uuid4(),
    )
    storage.exists = AsyncMock(return_value=True)
    storage.open_reader = Mock(return_value=MagicMock())
    session.execute = AsyncMock(return_value=_ScalarResult(["~ANPB7"]))
    with _mock_effective(10**9), patch(
        "app.modules.backup.archives.list_backup_spaces",
        return_value=[
            BackupSpaceSummary(key="~anpb7", name="A N", page_count=2),
        ],
    ):
        result = await archives.scan(archive)
    assert result.spaces == [
        {"key": "~anpb7", "name": "A N", "page_count": 2, "conflict": True},
    ]


@pytest.mark.asyncio
async def test_rescan_refreshes_conflicts_it_had_cached(archives, session, storage):
    """A space that existed when the archive was scanned may have been deleted
    since. Caching the flag would warn about a collision that is no longer
    there - so it is re-derived even on the already-scanned shortcut."""
    archive = BackupArchive(
        id=uuid.uuid4(), object_key="k", filename="f.zip", size_bytes=10,
        status="scanned", created_by_id=uuid.uuid4(),
        spaces=[{"key": "ENG", "name": "Engineering", "page_count": 2, "conflict": True}],
    )
    session.execute = AsyncMock(return_value=_ScalarResult([]))

    result = await archives.scan(archive)

    assert result.spaces == [
        {"key": "ENG", "name": "Engineering", "page_count": 2, "conflict": False}
    ]
    # The shortcut must still avoid touching object storage.
    storage.open_reader.assert_not_called()


@pytest.mark.asyncio
async def test_abort_upload_retires_a_scanned_archive_without_deleting_its_object(
    archives, storage
):
    """Cancelling a restore retires the row but keeps the uploaded file.

    Two separate things had to be true here, and the first was fixed by
    breaking the second. `abort_upload` originally only acted while a
    multipart upload was open, so discarding a *scanned* archive was a no-op:
    the picker cleared itself, the row stayed "scanned", and the next page
    load handed the same archive straight back with the file input locked
    against it. Marking the row cancelled fixed that - but it was done by
    deleting the object too, which threw away an upload that may have taken
    hours, with no way to ask for it back.

    Retiring the row is what closes the picker; deleting the bytes was never
    part of it. The object is listed under `backups/imports/` in the admin
    storage panel, so removing it is an explicit decision made there.
    """
    archive = BackupArchive(
        id=uuid.uuid4(), object_key="k", filename="f.zip", size_bytes=10,
        status="scanned", multipart_upload_id=None, created_by_id=uuid.uuid4(),
        spaces=[{"key": "ENG", "name": "Engineering"}],
    )

    await archives.abort_upload(archive)

    assert archive.status == "cancelled"
    storage.delete.assert_not_awaited()
    storage.abort_multipart_upload.assert_not_awaited()


@pytest.mark.asyncio
async def test_find_reusable_archive_matches_a_cancelled_row_whose_object_remains(
    archives, session, storage
):
    """A cancelled archive is a file still in the bucket, so it is reusable.

    Without this the file kept by `abort_upload` above would be unreachable:
    re-selecting the same backup would upload every byte again *and* leave a
    second copy of it behind.
    """
    cancelled = BackupArchive(
        id=uuid.uuid4(), object_key="k", filename="f.zip", size_bytes=10,
        status="cancelled", multipart_upload_id=None, created_by_id=uuid.uuid4(),
    )
    session.execute = AsyncMock(return_value=_ScalarResult([cancelled]))
    storage.exists = AsyncMock(return_value=True)

    found = await archives.find_reusable_archive(sha256="a" * 64, size_bytes=10)
    assert found is cancelled


@pytest.mark.asyncio
async def test_find_reusable_archive_skips_a_cancelled_row_deleted_by_hand(
    archives, session, storage
):
    """Deleting the object in the storage panel really does undo the reuse."""
    cancelled = BackupArchive(
        id=uuid.uuid4(), object_key="k", filename="f.zip", size_bytes=10,
        status="cancelled", multipart_upload_id=None, created_by_id=uuid.uuid4(),
    )
    session.execute = AsyncMock(return_value=_ScalarResult([cancelled]))
    storage.exists = AsyncMock(return_value=False)

    assert await archives.find_reusable_archive(sha256="a" * 64, size_bytes=10) is None


@pytest.mark.asyncio
async def test_start_upload_revives_a_cancelled_archive_it_reuses(archives, storage):
    """Reusing a cancelled row has to put it back in the restore flow.

    Handing it back still marked "cancelled" would leave the client with an
    archive the panel does not consider ready and `/archives/uploads/active`
    does not list - the reuse would look like nothing happened.
    """
    cancelled = BackupArchive(
        id=uuid.uuid4(), object_key="k", filename="f.zip", size_bytes=10,
        status="cancelled", multipart_upload_id=None, created_by_id=uuid.uuid4(),
        spaces=[{"key": "ENG", "name": "Engineering"}],
    )
    archives.find_reusable_archive = AsyncMock(return_value=cancelled)

    with _mock_effective(10**9):
        result = await archives.start_upload(
            filename="f.zip", size_bytes=10, actor_id=uuid.uuid4(), sha256="a" * 64
        )

    # Scanned, not merely uploaded: the space list from the earlier scan is
    # still on the row, so the picker opens without re-reading the archive.
    assert result is cancelled
    assert cancelled.status == "scanned"
    storage.start_multipart_upload.assert_not_called()


@pytest.mark.asyncio
async def test_start_upload_revives_an_unscanned_cancelled_archive_as_uploaded(archives):
    """No space list means there is still a scan to do."""
    cancelled = BackupArchive(
        id=uuid.uuid4(), object_key="k", filename="f.zip", size_bytes=10,
        status="cancelled", multipart_upload_id=None, created_by_id=uuid.uuid4(),
        spaces=[],
    )
    archives.find_reusable_archive = AsyncMock(return_value=cancelled)

    with _mock_effective(10**9):
        await archives.start_upload(
            filename="f.zip", size_bytes=10, actor_id=uuid.uuid4(), sha256="a" * 64
        )
    assert cancelled.status == "uploaded"


@pytest.mark.asyncio
async def test_abort_upload_refuses_while_a_restore_is_running_from_it(
    archives, session, storage
):
    """Deleting the object out from under a running job would break it."""
    archive = BackupArchive(
        id=uuid.uuid4(), object_key="k", filename="f.zip", size_bytes=10,
        status="scanned", created_by_id=uuid.uuid4(),
    )
    session.execute = AsyncMock(return_value=_ScalarResult([uuid.uuid4()]))

    with pytest.raises(ConflictError, match="Cancel the restore first"):
        await archives.abort_upload(archive)

    storage.delete.assert_not_awaited()
    assert archive.status == "scanned"
