from __future__ import annotations

from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session
from datetime import datetime, UTC

from app.modules.backup.service import BackupService, _ReportBuilder
from app.schemas.backup import (
    BackupDocument,
    BackupMeta,
    BackupUser,
    BackupSpace,
    BackupPage,
    BackupSiteSettings,
    BackupSpaceMember,
    BackupSpaceFavorite,
    BackupGroup,
    BackupGroupMember,
    BackupGroupGlobalPermission,
    BackupSpaceUserPermission,
    BackupSpaceGroupPermission,
    BackupPageRevision,
    BackupPageLike,
    BackupPageUserRestriction,
    BackupPageGroupRestriction,
)
from app.models.space import SpaceStatus, SpaceVisibility
from app.models.permission import Permission, GlobalPermission

@pytest.fixture
def mock_session():
    return AsyncMock(spec=Session)

@pytest.fixture
def service(mock_session) -> BackupService:
    result = BackupService(mock_session)
    result.audit = Mock(record=AsyncMock())
    return result

@pytest.mark.asyncio
async def test_apply(service: BackupService):
    service.users = Mock()
    service.users.get_protected = AsyncMock(return_value=Mock(username="admin", email="admin@a.com"))
    
    async def users_get_by_username_mock(username):
        if users_get_by_username_mock.count == 0:
            users_get_by_username_mock.count += 1
            return None
        return Mock(id="user-1")
    users_get_by_username_mock.count = 0
    service.users.get_by_username.side_effect = users_get_by_username_mock
    
    service.users.get_by_email = AsyncMock(return_value=None)
    service.users.get = AsyncMock(return_value=None)
    
    service.spaces = Mock()
    async def spaces_get_by_key_mock(key):
        if spaces_get_by_key_mock.count == 0:
            spaces_get_by_key_mock.count += 1
            return None
        return Mock(id="space-1")
    spaces_get_by_key_mock.count = 0
    service.spaces.get_by_key.side_effect = spaces_get_by_key_mock
    service.spaces.get = AsyncMock(return_value=None)
    service.spaces.get_member = AsyncMock(return_value=None)
    service.spaces.is_favorite = AsyncMock(return_value=False)
    
    service.groups = Mock()
    service.groups.get_by_name = AsyncMock(return_value=None)
    service.groups.get = AsyncMock(return_value=None)
    
    service.session.flush = AsyncMock()
    service.session.commit = AsyncMock()
    service.session.rollback = AsyncMock()
    service.session.refresh = AsyncMock()
    service.session.get = AsyncMock(return_value=None)
    
    def make_result(items):
        res = Mock()
        res.all.return_value = items
        res.scalars.return_value = items
        res.scalar_one_or_none.return_value = items[0] if items else None
        return res
        
    async def side_effect(*args, **kwargs):
        query_str = str(args[0]).lower()
        print("QUERY:", query_str)
        if "group_members" in query_str or "group_global_permissions" in query_str or "space_user_permissions" in query_str or "space_group_permissions" in query_str or "page_revisions" in query_str or "page_likes" in query_str or "page_user_restrictions" in query_str or "page_group_restrictions" in query_str:
            return make_result([])
        if "groups" in query_str and "groups.name =" in query_str:
            if side_effect.group_lookup_count == 0:
                side_effect.group_lookup_count += 1
                return make_result([])
            return make_result([Mock(id="group-1", name="G")])
        if "wiki_pages" in query_str and "spaces.key =" in query_str:
            if side_effect.page_lookup_count == 0:
                side_effect.page_lookup_count += 1
                return make_result([])
            return make_result([Mock(id="page-1")])
        return make_result([])

    side_effect.group_lookup_count = 0
    side_effect.page_lookup_count = 0
    service.session.execute.side_effect = side_effect
    
    doc = BackupDocument(
        wikihub_backup=BackupMeta(
            version=1,
            exported_at=datetime.now(UTC),
            app_version="1.0.0",
            site_name="Test",
            includes_credentials=False,
            counts={}
        ),
        users=[
            BackupUser(
                id=str(uuid4()),
                username="u1",
                email="a@b.com",
                full_name="U1"
            )
        ],
        spaces=[
            BackupSpace(
                id=str(uuid4()),
                key="S",
                name="Space",
                status=SpaceStatus.active,
                visibility=SpaceVisibility.open,
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC)
            )
        ],
        space_members=[BackupSpaceMember(space_key="S", username="u1")],
        space_favorites=[BackupSpaceFavorite(space_key="S", username="u1")],
        groups=[BackupGroup(id=str(uuid4()), name="G", description="Desc", owner_username="u1", is_active=True)],
        group_members=[BackupGroupMember(group_name="G", username="u1")],
        group_global_permissions=[BackupGroupGlobalPermission(group_name="G", permission=GlobalPermission.create_space)],
        space_user_permissions=[BackupSpaceUserPermission(space_key="S", username="u1", permission=Permission.view)],
        space_group_permissions=[BackupSpaceGroupPermission(space_key="S", group_name="G", permission=Permission.view)],
        pages=[
            BackupPage(
                id=str(uuid4()),
                space_key="S",
                slug="p",
                title="P",
                content="<p>Test</p>",
                created_by_username="u1",
                updated_by_username="u1"
            )
        ],
        page_revisions=[BackupPageRevision(page_space_key="S", page_slug="p", version=1, title="P", created_by_username="u1")],
        page_likes=[BackupPageLike(page_space_key="S", page_slug="p", username="u1")],
        page_user_restrictions=[BackupPageUserRestriction(page_space_key="S", page_slug="p", username="u1", permission=Permission.view)],
        page_group_restrictions=[BackupPageGroupRestriction(page_space_key="S", page_slug="p", group_name="G", permission=Permission.view)],
        site_settings=BackupSiteSettings(site_name="Test")
    )
    
    report = _ReportBuilder()
    no_password = []
    
    await service._apply(doc, report, no_password)
