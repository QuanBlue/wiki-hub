
from __future__ import annotations

import zipfile
import io
from unittest.mock import AsyncMock, Mock, patch, mock_open
from uuid import uuid4
from datetime import datetime, UTC

import pytest
from sqlalchemy.orm import Session

from app.modules.backup.service import BackupService, ExportCancelled
from app.modules.backup.package import ScannedPackage
from app.schemas.backup import (
    BackupDocument, BackupMeta, BackupSpace, BackupPage,
    BackupAttachment, BackupAvatar, ImportReport
)
from app.models.space import SpaceStatus, SpaceVisibility
from app.models.attachment import PageAttachment

@pytest.fixture
def mock_session():
    return AsyncMock()

@pytest.fixture
def mock_storage():
    m = AsyncMock()
    m.put = AsyncMock()
    m.delete = AsyncMock()
    return m

@pytest.fixture
def service(mock_session) -> BackupService:
    result = BackupService(mock_session)
    result.audit = Mock(record=AsyncMock())
    result.users = Mock()
    result.users.get_by_username = AsyncMock(return_value=Mock(id="user-1"))
    return result

def make_result(items):
    res = Mock()
    res.all.return_value = items
    res.scalars.return_value = items
    res.scalar_one_or_none.return_value = items[0] if items else None
    return res

def create_dummy_zip():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("document.json", "{}")
        zf.writestr("att1.png", "data")
        zf.writestr("ava1.png", "data")
    buf.seek(0)
    return buf

@pytest.mark.asyncio
async def test_restore_full_package_overwrites(service: BackupService, mock_storage, tmp_path):
    zip_path = tmp_path / "backup.zip"
    with open(zip_path, "wb") as f:
        f.write(create_dummy_zip().read())

    doc = BackupDocument(
        wikihub_backup=BackupMeta(version=1, app_version="1", site_name="T", exported_at=datetime.now(UTC), includes_credentials=False, counts={}),
        users=[], spaces=[BackupSpace(id=str(uuid4()), key="S", name="Space", status=SpaceStatus.active, visibility=SpaceVisibility.open, created_at=None, updated_at=None)],
        space_members=[], space_favorites=[], groups=[], group_members=[], group_global_permissions=[], space_user_permissions=[], space_group_permissions=[],
        pages=[], page_revisions=[], page_likes=[], page_user_restrictions=[], page_group_restrictions=[],
        attachments=[BackupAttachment(page_space_key="S", page_slug="p", filename="att1.png", content_type="image/png", object_path="att1.png", sha256="abc", size_bytes=10)],
        avatars=[BackupAvatar(username="u1", content_type="image/png", object_path="ava1.png", sha256="abc", size_bytes=4)]
    )

    with patch("app.modules.backup.service.scan_full_backup", return_value=ScannedPackage(document=doc, manifest={}, entries={}, archive_sha256="", archive_size_bytes=0)):
        service.import_document = AsyncMock(return_value=ImportReport(dry_run=False, version=1, includes_credentials=False, created={"page": 1}))

        counts = {}
        async def side_effect(*args, **kwargs):
            query = str(args[0]).lower()
            if "select spaces.id" in query and "spaces.key" in query:
                return make_result([("S1", "S")])
            if "select pages.id" in query and "where pages.space_id in" in query:
                return make_result(["page-1"])
            if "select page_attachments.object_key" in query:
                return make_result(["old-key-1"])
            if "delete from pages" in query:
                print("Miss: " + query); return make_result([])
            if "select users.username" in query:
                print("Miss: " + query); return make_result([]) # No existing users
            if "select spaces.key" in query and "pages.slug" in query:
                print("Miss: " + query); return make_result([]) # No existing pages
            if "from pages join spaces" in query:
                return make_result([Mock(id="page-2", content="<p>page body</p>")])

            print("Miss: " + query); return make_result([])

        service.session.execute.side_effect = side_effect

        savepoint = AsyncMock()
        savepoint.is_active = True
        service.session.begin_nested = AsyncMock(return_value=savepoint)

        res = await service.restore_full_package(str(zip_path), storage=mock_storage, overwrite_space_keys={"S"}, dry_run=False)
        assert res.created["attachment"] == 1
        assert res.created["avatar"] == 1
        savepoint.commit.assert_awaited()
        mock_storage.delete.assert_awaited_with("old-key-1")


@pytest.mark.asyncio
async def test_restore_full_package_stops_reoffering_overwritten_spaces(
    service: BackupService, mock_storage, tmp_path
):
    """An overwritten space must not come back as an unresolved conflict.

    Regression test for an endless "Replace existing spaces?" loop: an
    overwrite restore deletes the conflicting spaces' pages but keeps the
    `Space` rows (so membership and permissions survive), so `_apply` still
    reports every one of them as `key_exists`. The admin panel turns
    `conflicting_space_keys` straight back into the same prompt, so
    confirming the replace re-asked the identical question forever.
    """
    zip_path = tmp_path / "backup.zip"
    with open(zip_path, "wb") as f:
        f.write(create_dummy_zip().read())

    doc = BackupDocument(
        wikihub_backup=BackupMeta(version=1, app_version="1", site_name="T", exported_at=datetime.now(UTC), includes_credentials=False, counts={}),
        users=[],
        spaces=[
            BackupSpace(id=str(uuid4()), key="S", name="Space", status=SpaceStatus.active, visibility=SpaceVisibility.open, created_at=None, updated_at=None),
            BackupSpace(id=str(uuid4()), key="OTHER", name="Other", status=SpaceStatus.active, visibility=SpaceVisibility.open, created_at=None, updated_at=None),
        ],
        space_members=[], space_favorites=[], groups=[], group_members=[], group_global_permissions=[], space_user_permissions=[], space_group_permissions=[],
        pages=[], page_revisions=[], page_likes=[], page_user_restrictions=[], page_group_restrictions=[],
        attachments=[], avatars=[],
    )

    with patch("app.modules.backup.service.scan_full_backup", return_value=ScannedPackage(document=doc, manifest={}, entries={}, archive_sha256="", archive_size_bytes=0)):
        # What the real `_apply` produces: both spaces still exist, so both
        # are skipped as `key_exists` - including the one just overwritten.
        service.import_document = AsyncMock(
            return_value=ImportReport(
                dry_run=False,
                version=1,
                includes_credentials=False,
                created={},
                conflicting_space_keys=["OTHER", "S"],
            )
        )

        async def side_effect(*args, **kwargs):
            query = str(args[0]).lower()
            if "select spaces.id" in query and "spaces.key" in query:
                return make_result([("S1", "S"), ("S2", "OTHER")])
            return make_result([])

        service.session.execute.side_effect = side_effect
        savepoint = AsyncMock()
        savepoint.is_active = True
        service.session.begin_nested = AsyncMock(return_value=savepoint)

        res = await service.restore_full_package(
            str(zip_path), storage=mock_storage, overwrite_space_keys={"S"}, dry_run=False
        )

    # "S" was handled by this very run; "OTHER" is still an open decision.
    assert res.conflicting_space_keys == ["OTHER"]


@pytest.mark.asyncio
async def test_restore_full_package_reports_progress_and_honours_cancellation(
    service: BackupService, mock_storage, tmp_path
):
    """`job` progress/cancellation checkpointing mirrors export's - regression
    coverage for the same class of "cancel doesn't work" bug already fixed on
    the export side this session, now on the restore side too."""
    zip_path = tmp_path / "backup.zip"
    with open(zip_path, "wb") as f:
        f.write(create_dummy_zip().read())

    doc = BackupDocument(
        wikihub_backup=BackupMeta(version=1, app_version="1", site_name="T", exported_at=datetime.now(UTC), includes_credentials=False, counts={}),
        users=[], spaces=[], space_members=[], space_favorites=[], groups=[], group_members=[], group_global_permissions=[], space_user_permissions=[], space_group_permissions=[],
        pages=[], page_revisions=[], page_likes=[], page_user_restrictions=[], page_group_restrictions=[],
        attachments=[BackupAttachment(page_space_key="S", page_slug="p", filename="att1.png", content_type="image/png", object_path="att1.png", sha256="abc", size_bytes=4)],
        avatars=[BackupAvatar(username="u1", content_type="image/png", object_path="ava1.png", sha256="abc", size_bytes=4)],
    )

    with patch(
        "app.modules.backup.service.scan_full_backup",
        return_value=ScannedPackage(document=doc, manifest={}, entries={}, archive_sha256="", archive_size_bytes=0),
    ):
        service.import_document = AsyncMock(
            return_value=ImportReport(dry_run=False, version=1, includes_credentials=False, created={})
        )
        # No matching pages/users exist, so both loop bodies `continue`
        # immediately - only the checkpoint calls themselves are under test.
        service.session.execute.side_effect = lambda *a, **k: make_result([])
        service.session.refresh = AsyncMock()
        service.session.commit = AsyncMock()

        job = Mock(cancel_requested=False, counters={})
        res = await service.restore_full_package(
            str(zip_path), storage=mock_storage, dry_run=False, job=job
        )
        # The attachment is skipped (no matching page in this fixture), but
        # the avatar loop's user lookup is stubbed non-None by the `service`
        # fixture, so it restores - neither outcome matters here, only that
        # both loop iterations ran their checkpoint.
        assert res.created == {"avatar": 1}
        # The scan-time checkpoint (before the loop even starts) plus the
        # last-item checkpoint at the end of the 2-item loop (attachment +
        # avatar, both well under `_PROGRESS_CHECK_EVERY`) - "always check the
        # last item" is what stops a short restore from going a whole run
        # without a single cancellation check.
        assert service.session.refresh.await_count == 2
        assert job.counters["items_total"] == 2
        assert job.counters["items_processed"] == 2

        # Cancellation requested before the next run is observed immediately,
        # at the very first checkpoint - not only once the loop plateaus.
        job.cancel_requested = True
        with pytest.raises(ExportCancelled):
            await service.restore_full_package(
                str(zip_path), storage=mock_storage, dry_run=False, job=job
            )


@pytest.mark.asyncio
async def test_restore_full_package_preserves_attachment_id_when_free(
    service: BackupService, mock_storage, tmp_path
):
    """A restored attachment keeps its original id so any

    `/api/v1/attachments/<id>` link already baked into that page's content
    (from before it was exported) keeps resolving, instead of pointing at
    an id nothing was ever created with.
    """
    zip_path = tmp_path / "backup.zip"
    with open(zip_path, "wb") as f:
        f.write(create_dummy_zip().read())

    original_id = uuid4()
    doc = BackupDocument(
        wikihub_backup=BackupMeta(version=1, app_version="1", site_name="T", exported_at=datetime.now(UTC), includes_credentials=False, counts={}),
        users=[], spaces=[BackupSpace(id=str(uuid4()), key="S", name="Space", status=SpaceStatus.active, visibility=SpaceVisibility.open, created_at=None, updated_at=None)],
        space_members=[], space_favorites=[], groups=[], group_members=[], group_global_permissions=[], space_user_permissions=[], space_group_permissions=[],
        pages=[], page_revisions=[], page_likes=[], page_user_restrictions=[], page_group_restrictions=[],
        attachments=[BackupAttachment(id=original_id, page_space_key="S", page_slug="p", filename="att1.png", content_type="image/png", object_path="att1.png", sha256="abc", size_bytes=10)],
        avatars=[],
    )

    with patch("app.modules.backup.service.scan_full_backup", return_value=ScannedPackage(document=doc, manifest={}, entries={}, archive_sha256="", archive_size_bytes=0)):
        service.import_document = AsyncMock(return_value=ImportReport(dry_run=False, version=1, includes_credentials=False, created={"page": 1}))

        async def side_effect(*args, **kwargs):
            query = str(args[0]).lower()
            if "select spaces.id" in query and "spaces.key" in query:
                return make_result([])  # No pre-existing spaces.
            if "select spaces.key" in query and "pages.slug" in query:
                return make_result([])  # No pre-existing pages.
            if "from pages join spaces" in query:
                return make_result([Mock(id="page-2", content="<p>page body</p>")])
            return make_result([])

        service.session.execute.side_effect = side_effect
        service.session.get = AsyncMock(return_value=None)  # id is free.

        res = await service.restore_full_package(str(zip_path), storage=mock_storage, dry_run=False)
        assert res.created["attachment"] == 1

        added_attachments = [
            call.args[0]
            for call in service.session.add.call_args_list
            if isinstance(call.args[0], PageAttachment)
        ]
        assert len(added_attachments) == 1
        assert added_attachments[0].id == original_id
        # Restore now trusts the checksum-verified manifest's declared size
        # (`BackupAttachment.size_bytes`) rather than re-measuring the bytes
        # it just streamed - streaming means there is no `len(payload)` left
        # to measure. The manifest above declares 10, not the dummy zip
        # entry's actual 4-byte content.
        assert added_attachments[0].size_bytes == 10


@pytest.mark.asyncio
async def test_restore_full_package_skips_attachment_id_when_taken(
    service: BackupService, mock_storage, tmp_path
):
    """If that id is already in use, restore still creates the attachment -

    just without forcing a colliding primary key onto it.
    """
    zip_path = tmp_path / "backup.zip"
    with open(zip_path, "wb") as f:
        f.write(create_dummy_zip().read())

    original_id = uuid4()
    doc = BackupDocument(
        wikihub_backup=BackupMeta(version=1, app_version="1", site_name="T", exported_at=datetime.now(UTC), includes_credentials=False, counts={}),
        users=[], spaces=[BackupSpace(id=str(uuid4()), key="S", name="Space", status=SpaceStatus.active, visibility=SpaceVisibility.open, created_at=None, updated_at=None)],
        space_members=[], space_favorites=[], groups=[], group_members=[], group_global_permissions=[], space_user_permissions=[], space_group_permissions=[],
        pages=[], page_revisions=[], page_likes=[], page_user_restrictions=[], page_group_restrictions=[],
        attachments=[BackupAttachment(id=original_id, page_space_key="S", page_slug="p", filename="att1.png", content_type="image/png", object_path="att1.png", sha256="abc", size_bytes=10)],
        avatars=[],
    )

    with patch("app.modules.backup.service.scan_full_backup", return_value=ScannedPackage(document=doc, manifest={}, entries={}, archive_sha256="", archive_size_bytes=0)):
        service.import_document = AsyncMock(return_value=ImportReport(dry_run=False, version=1, includes_credentials=False, created={"page": 1}))

        async def side_effect(*args, **kwargs):
            query = str(args[0]).lower()
            if "select spaces.id" in query and "spaces.key" in query:
                return make_result([])
            if "select spaces.key" in query and "pages.slug" in query:
                return make_result([])
            if "from pages join spaces" in query:
                return make_result([Mock(id="page-2", content="<p>page body</p>")])
            return make_result([])

        service.session.execute.side_effect = side_effect
        service.session.get = AsyncMock(return_value=Mock())  # id already taken.

        res = await service.restore_full_package(str(zip_path), storage=mock_storage, dry_run=False)
        assert res.created["attachment"] == 1

        added_attachments = [
            call.args[0]
            for call in service.session.add.call_args_list
            if isinstance(call.args[0], PageAttachment)
        ]
        assert len(added_attachments) == 1
        assert added_attachments[0].id != original_id

@pytest.mark.asyncio
async def test_restore_full_package_skips_existing_refs_and_missing_targets(
    service: BackupService, mock_storage, tmp_path
):
    zip_path = tmp_path / "backup.zip"
    with open(zip_path, "wb") as f:
        f.write(create_dummy_zip().read())

    doc = BackupDocument(
        wikihub_backup=BackupMeta(version=1, app_version="1", site_name="T", exported_at=datetime.now(UTC), includes_credentials=False, counts={}),
        users=[], spaces=[BackupSpace(id=str(uuid4()), key="S", name="Space", status=SpaceStatus.active, visibility=SpaceVisibility.open, created_at=None, updated_at=None)],
        space_members=[], space_favorites=[], groups=[], group_members=[], group_global_permissions=[], space_user_permissions=[], space_group_permissions=[],
        pages=[], page_revisions=[], page_likes=[], page_user_restrictions=[], page_group_restrictions=[],
        attachments=[
            # Already imported by import_document (its page ref pre-exists): skipped without a lookup.
            BackupAttachment(page_space_key="S", page_slug="existing", filename="att1.png", content_type="image/png", object_path="att1.png", sha256="abc", size_bytes=10),
            # Not pre-existing, but its page cannot be found either: skipped after the lookup.
            BackupAttachment(page_space_key="S", page_slug="missing", filename="att1.png", content_type="image/png", object_path="att1.png", sha256="abc", size_bytes=10),
        ],
        avatars=[
            # Already an existing user: skipped without a lookup.
            BackupAvatar(username="existing_user", content_type="image/png", object_path="ava1.png", sha256="abc", size_bytes=4),
            # Not an existing user, but no matching user record either: skipped after the lookup.
            BackupAvatar(username="missing_user", content_type="image/png", object_path="ava1.png", sha256="abc", size_bytes=4),
        ],
    )

    with patch("app.modules.backup.service.scan_full_backup", return_value=ScannedPackage(document=doc, manifest={}, entries={}, archive_sha256="", archive_size_bytes=0)):
        service.import_document = AsyncMock(return_value=ImportReport(dry_run=False, version=1, includes_credentials=False, created={}))

        async def users_side_effect(username):
            return None if username == "missing_user" else Mock(id=f"user-{username}")

        service.users.get_by_username = AsyncMock(side_effect=users_side_effect)

        async def side_effect(*args, **kwargs):
            query = str(args[0]).lower()
            if "select spaces.id" in query and "spaces.key" in query:
                return make_result([])
            if "select users.username" in query:
                return make_result(["existing_user"])
            if "select spaces.key" in query and "pages.slug" in query:
                return make_result([("S", "existing")])
            if "from pages join spaces" in query:
                return make_result([])  # No page found for "S/missing".
            return make_result([])

        service.session.execute.side_effect = side_effect

        res = await service.restore_full_package(str(zip_path), storage=mock_storage, overwrite_space_keys=None, dry_run=False)
        assert res.created.get("attachment", 0) == 0
        assert res.created.get("avatar", 0) == 0
        mock_storage.put.assert_not_called()


@pytest.mark.asyncio
async def test_scan_full_package_delegates_to_scan_full_backup(tmp_path) -> None:
    zip_path = tmp_path / "backup.zip"
    with open(zip_path, "wb") as f:
        f.write(create_dummy_zip().read())

    with patch("app.modules.backup.service.scan_full_backup") as mocked:
        mocked.return_value = "sentinel"
        assert BackupService.scan_full_package(str(zip_path)) == "sentinel"
        mocked.assert_called_once_with(str(zip_path), max_size_bytes=None)


@pytest.mark.asyncio
async def test_restore_full_package_dry_run(service: BackupService, mock_storage, tmp_path):
    zip_path = tmp_path / "backup.zip"
    with open(zip_path, "wb") as f:
        f.write(create_dummy_zip().read())

    doc = BackupDocument(
        wikihub_backup=BackupMeta(version=1, app_version="1", site_name="T", exported_at=datetime.now(UTC), includes_credentials=False, counts={}),
        users=[], spaces=[BackupSpace(id=str(uuid4()), key="S", name="Space", status=SpaceStatus.active, visibility=SpaceVisibility.open, created_at=None, updated_at=None)],
        space_members=[], space_favorites=[], groups=[], group_members=[], group_global_permissions=[], space_user_permissions=[], space_group_permissions=[],
        pages=[], page_revisions=[], page_likes=[], page_user_restrictions=[], page_group_restrictions=[],
        attachments=[], avatars=[]
    )

    with patch("app.modules.backup.service.scan_full_backup", return_value=ScannedPackage(document=doc, manifest={}, entries={}, archive_sha256="", archive_size_bytes=0)):
        service.import_document = AsyncMock(return_value=ImportReport(dry_run=False, version=1, includes_credentials=False, created={"page": 1}))
        service.session.execute.return_value = make_result([("S1", "S")])

        savepoint = AsyncMock()
        savepoint.is_active = True
        service.session.begin_nested = AsyncMock(return_value=savepoint)

        res = await service.restore_full_package(str(zip_path), storage=mock_storage, overwrite_space_keys={"S"}, dry_run=True)
        assert res.dry_run is True
        savepoint.rollback.assert_awaited()

@pytest.mark.asyncio
async def test_restore_full_package_import_exception(service: BackupService, mock_storage, tmp_path):
    zip_path = tmp_path / "backup.zip"
    with open(zip_path, "wb") as f:
        f.write(create_dummy_zip().read())

    doc = BackupDocument(
        wikihub_backup=BackupMeta(version=1, app_version="1", site_name="T", exported_at=datetime.now(UTC), includes_credentials=False, counts={}),
        users=[], spaces=[BackupSpace(id=str(uuid4()), key="S", name="Space", status=SpaceStatus.active, visibility=SpaceVisibility.open, created_at=None, updated_at=None)],
        space_members=[], space_favorites=[], groups=[], group_members=[], group_global_permissions=[], space_user_permissions=[], space_group_permissions=[],
        pages=[], page_revisions=[], page_likes=[], page_user_restrictions=[], page_group_restrictions=[],
        attachments=[], avatars=[]
    )

    with patch("app.modules.backup.service.scan_full_backup", return_value=ScannedPackage(document=doc, manifest={}, entries={}, archive_sha256="", archive_size_bytes=0)):
        service.import_document = AsyncMock(side_effect=ValueError("Boom"))
        service.session.execute.return_value = make_result([("S1", "S")])

        savepoint = AsyncMock()
        savepoint.is_active = True
        service.session.begin_nested = AsyncMock(return_value=savepoint)

        with pytest.raises(ValueError, match="Boom"):
            await service.restore_full_package(str(zip_path), storage=mock_storage, overwrite_space_keys={"S"}, dry_run=False)
        savepoint.rollback.assert_awaited()

@pytest.mark.asyncio
async def test_restore_full_package_zip_exception(service: BackupService, mock_storage, tmp_path):
    zip_path = tmp_path / "backup.zip"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("document.json", "{}")
        zf.writestr("att1.png", "data")
        zf.writestr("att2.png", "data")
    buf.seek(0)
    with open(zip_path, "wb") as f:
        f.write(buf.read())

    doc = BackupDocument(
        wikihub_backup=BackupMeta(version=1, app_version="1", site_name="T", exported_at=datetime.now(UTC), includes_credentials=False, counts={}),
        users=[], spaces=[BackupSpace(id=str(uuid4()), key="S", name="Space", status=SpaceStatus.active, visibility=SpaceVisibility.open, created_at=None, updated_at=None)],
        space_members=[], space_favorites=[], groups=[], group_members=[], group_global_permissions=[], space_user_permissions=[], space_group_permissions=[],
        pages=[], page_revisions=[], page_likes=[], page_user_restrictions=[], page_group_restrictions=[],
        attachments=[
            BackupAttachment(page_space_key="S", page_slug="p1", filename="att1.png", content_type="image/png", object_path="att1.png", sha256="abc", size_bytes=10),
            BackupAttachment(page_space_key="S", page_slug="p2", filename="att2.png", content_type="image/png", object_path="att2.png", sha256="abc", size_bytes=10),
        ],
        avatars=[]
    )

    with patch("app.modules.backup.service.scan_full_backup", return_value=ScannedPackage(document=doc, manifest={}, entries={}, archive_sha256="", archive_size_bytes=0)):
        service.import_document = AsyncMock(return_value=ImportReport(dry_run=False, version=1, includes_credentials=False, created={"page": 1}))

        async def side_effect(*args, **kwargs):
            query = str(args[0]).lower()
            if "select spaces.id" in query and "spaces.key" in query:
                return make_result([("S1", "S")])
            if "select users.username" in query:
                print("Miss: " + query); return make_result([]) # No existing users
            if "select spaces.key" in query and "pages.slug" in query:
                print("Miss: " + query); return make_result([]) # No existing pages
            if "from pages join spaces" in query:
                return make_result([Mock(id="page-2", content="<p>page body</p>")])
            print("Miss: " + query); return make_result([])

        service.session.execute.side_effect = side_effect
        # First attachment upload succeeds (so it lands in created_object_keys),
        # the second fails and triggers cleanup of everything already uploaded.
        mock_storage.put.side_effect = [None, ValueError("Storage boom")]

        with pytest.raises(ValueError, match="Storage boom"):
            await service.restore_full_package(str(zip_path), storage=mock_storage, overwrite_space_keys={"S"}, dry_run=False)

        mock_storage.delete.assert_called()
        service.session.rollback.assert_awaited()
