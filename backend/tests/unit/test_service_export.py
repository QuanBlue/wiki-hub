from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4
import os
import json
import zipfile
import hashlib

import pytest
from sqlalchemy.orm import Session

from app.core.exceptions import BadRequestError
from app.models.attachment import PageAttachment
from app.models.space import Space
from app.models.page import WikiPage
from app.models.user import User
from app.modules.backup.service import BackupService
from app.modules.backup.package import MANIFEST_PATH, DOCUMENT_PATH
from app.schemas.backup import BackupUser, BackupSpace, BackupPage, BackupSiteSettings

@pytest.fixture
def mock_session():
    return AsyncMock(spec=Session)

@pytest.fixture
def service(mock_session) -> BackupService:
    result = BackupService(mock_session)
    result.audit = Mock(record=AsyncMock())
    return result

@pytest.mark.asyncio
async def test_export_package(service: BackupService, tmp_path):
    # Mock export_document
    service.export_document = AsyncMock()
    mock_doc = Mock()
    mock_doc.attachments = []
    mock_doc.avatars = []
    mock_doc.wikihub_backup = Mock()
    mock_doc.wikihub_backup.counts = {}
    mock_doc.model_dump_json.return_value = '{"test": "doc"}'
    service.export_document.return_value = mock_doc

    # Mock storage
    mock_storage = AsyncMock()
    mock_storage.get.return_value = b"testdata"

    # Mock DB query for attachments and users
    page = WikiPage(id="page-1", space_id="space-1", slug="page-1-slug")
    space = Space(id="space-1", key="SPACE")
    attachment = PageAttachment(
        id=uuid4(), page_id="page-1", filename="a.txt", content_type="text/plain", object_key="storage-att-1"
    )
    user = User(
        id="user-1", username="user1", avatar_object_key="storage-ava-1", avatar_content_type="image/png"
    )

    # Setup session.execute to return these mocks in order
    def make_result(items):
        res = Mock()
        res.scalars.return_value = items
        return res
        
    async def side_effect(*args, **kwargs):
        return side_effect.results.pop(0)
    side_effect.results = [
        make_result([page]),
        make_result([space]),
        make_result([attachment]),
        make_result([user]),
    ]
    service.session.execute.side_effect = side_effect

    path = str(tmp_path / "export.zip")
    manifest = await service.export_full_package(path, mock_storage, include_credentials=True)

    assert manifest["format"] == "wikihub.full-backup"
    assert manifest["includes_credentials"] is True
    
    with zipfile.ZipFile(path, "r") as zf:
        assert MANIFEST_PATH in zf.namelist()
        assert DOCUMENT_PATH in zf.namelist()
        manifest_data = json.loads(zf.read(MANIFEST_PATH))
        assert manifest_data["format"] == "wikihub.full-backup"
        
        # Check files are written
        for entry in manifest_data["entries"]:
            if entry["path"] != DOCUMENT_PATH:
                assert zf.read(entry["path"]) == b"testdata"


@pytest.mark.asyncio
async def test_export_package_skips_orphaned_attachments_and_users_without_avatar(
    service: BackupService, tmp_path
):
    service.export_document = AsyncMock()
    mock_doc = Mock()
    mock_doc.attachments = []
    mock_doc.avatars = []
    mock_doc.wikihub_backup = Mock()
    mock_doc.wikihub_backup.counts = {}
    mock_doc.model_dump_json.return_value = '{"test": "doc"}'
    service.export_document.return_value = mock_doc

    mock_storage = AsyncMock()
    mock_storage.get.return_value = b"testdata"

    page = WikiPage(id="page-1", space_id="space-1", slug="page-1-slug")
    space = Space(id="space-1", key="SPACE")
    valid_attachment = PageAttachment(
        id=uuid4(),
        page_id="page-1",
        filename="a.txt",
        content_type="text/plain",
        object_key="storage-att-1",
    )
    orphaned_attachment = PageAttachment(
        id=uuid4(),
        page_id="missing-page",
        filename="b.txt",
        content_type="text/plain",
        object_key="storage-att-2",
    )
    user_with_avatar = User(
        id="user-1",
        username="user1",
        avatar_object_key="storage-ava-1",
        avatar_content_type="image/png",
    )
    user_without_avatar = User(id="user-2", username="user2", avatar_object_key=None)

    def make_result(items):
        res = Mock()
        res.scalars.return_value = items
        return res

    async def side_effect(*args, **kwargs):
        return side_effect.results.pop(0)

    side_effect.results = [
        make_result([page]),
        make_result([space]),
        make_result([valid_attachment, orphaned_attachment]),
        make_result([user_with_avatar, user_without_avatar]),
    ]
    service.session.execute.side_effect = side_effect

    path = str(tmp_path / "export.zip")
    await service.export_full_package(path, mock_storage, include_credentials=True)

    # Only the valid attachment/avatar pair was fetched from storage; the
    # orphaned attachment and the avatar-less user were skipped.
    assert mock_storage.get.await_count == 2
    assert len(mock_doc.attachments) == 1
    assert len(mock_doc.avatars) == 1


@pytest.mark.asyncio
async def test_export_document(service: BackupService):
    def make_result(items):
        res = Mock()
        res.scalars.return_value = items
        return res
        
    async def side_effect(*args, **kwargs):
        if side_effect.results:
            return side_effect.results.pop(0)
        return make_result([])
        
    user = User(
        id="00000000-0000-0000-0000-000000000001",
        username="user1",
        email="a@b.com",
        full_name="User",
        is_active=True,
        is_superuser=False,
        is_protected=False,
        bio="",
        pronouns="",
        profile_url="",
        social_links=[],
        company=""
    )
    from app.models.space import SpaceStatus, SpaceVisibility
    space = Space(
        id="00000000-0000-0000-0000-000000000002",
        key="SPACE",
        name="Space Name",
        description="",
        icon="",
        status=SpaceStatus.active,
        visibility=SpaceVisibility.open,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC)
    )
    page = WikiPage(
        id="00000000-0000-0000-0000-000000000003",
        space_id="00000000-0000-0000-0000-000000000002",
        slug="page-1-slug",
        title="T",
        content="",
        content_format="html",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC)
    )
    
    side_effect.results = [
        make_result([user]),  # 1. User
        make_result([space]),  # 2. Space
        make_result([]),  # 3. SpaceMember
        make_result([]),  # 4. SpaceFavorite
        make_result([]),  # 5. Group
        make_result([]),  # 6. GroupMember
        make_result([]),  # 7. GroupGlobalPermission
        make_result([]),  # 8. SpaceUserPermission
        make_result([]),  # 9. SpaceGroupPermission
        make_result([page]),  # 10. WikiPage
        make_result([]),  # 11. PageRevision
        make_result([]),  # 12. PageLike
        make_result([]),  # 13. PageUserRestriction
        make_result([]),  # 14. PageGroupRestriction
    ]
    service.session.execute.side_effect = side_effect
    
    mock_settings = Mock()
    mock_settings.to_backup = Mock(return_value=BackupSiteSettings(site_name="Test"))
    mock_settings.overrides = SimpleNamespace(model_dump=lambda: {})
    service.site_settings = AsyncMock()
    service.site_settings.read.return_value = mock_settings
    service.site_settings.get_effective.return_value = SimpleNamespace(site_name="Test")

    doc = await service.export_document(include_credentials=False)
    
    assert doc.wikihub_backup.site_name == "Test"
    assert doc.wikihub_backup.includes_credentials is False
    assert len(doc.users) == 1
    assert len(doc.spaces) == 1
    assert len(doc.pages) == 1
    assert doc.wikihub_backup.counts["users"] == 1
    assert doc.wikihub_backup.counts["spaces"] == 1
    assert doc.wikihub_backup.counts["pages"] == 1
