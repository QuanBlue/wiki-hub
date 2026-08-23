
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
        if username == "missing": return None
        return Mock(id=f"user-{username}")
    service.users.get_by_username.side_effect = users_get_by_username_mock

    service.users.get_by_email = AsyncMock(return_value=None)
    service.users.get = AsyncMock(return_value=None)

    service.spaces = Mock()
    async def spaces_get_by_key_mock(key):
        if key == "missing": return None
        return Mock(id=f"space-{key}")
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

    counts = {}
    async def side_effect(*args, **kwargs):
        query_str = str(args[0]).lower()
        if "from site_settings" in query_str:
            return make_result([])

        if "from groups" in query_str and "lower(groups.name) =" in query_str:
            counts["groups"] = counts.get("groups", 0) + 1
            if counts["groups"] in [1, 2]: return make_result([])
            if counts["groups"] == 3: return make_result([Mock(id="group-exist", name="exist-group")])
            if counts["groups"] == 4: return make_result([])
            return make_result([Mock(id="group-1", name="G")])

        if "from pages" in query_str and "pages.space_id =" in query_str:
            counts["pages"] = counts.get("pages", 0) + 1
            if counts["pages"] == 1: return make_result([])
            if counts["pages"] == 2: return make_result([Mock(id="page-exist")])
            return make_result([Mock(id="page-1")])

        for key in ["group_members", "group_global_permissions", "space_user_permissions", "space_group_permissions", "page_revisions", "page_likes", "page_user_restrictions", "page_group_restrictions"]:
            if key in query_str:
                counts[key] = counts.get(key, 0) + 1
                if counts[key] == 1: return make_result([Mock(id="exist-1")])
                return make_result([])

        return make_result([])

    service.session.execute.side_effect = side_effect

    doc = BackupDocument(
        wikihub_backup=BackupMeta(version=1, exported_at=datetime.now(UTC), app_version="1.0.0", site_name="Test", includes_credentials=False, counts={}),
        users=[BackupUser(id=str(uuid4()), username="u1", email="a@b.com", full_name="U1")],
        spaces=[BackupSpace(id=str(uuid4()), key="S", name="Space", status=SpaceStatus.active, visibility=SpaceVisibility.open, created_at=datetime.now(UTC), updated_at=datetime.now(UTC))],
        space_members=[BackupSpaceMember(space_key="missing", username="missing"), BackupSpaceMember(space_key="S", username="u1"), BackupSpaceMember(space_key="S", username="u2")],
        space_favorites=[BackupSpaceFavorite(space_key="missing", username="missing"), BackupSpaceFavorite(space_key="S", username="u1"), BackupSpaceFavorite(space_key="S", username="u2")],
        groups=[BackupGroup(id=str(uuid4()), name="missing", description="Desc", owner_username="missing", is_active=True), BackupGroup(id=str(uuid4()), name="exist-group", description="Desc", owner_username="u1", is_active=True), BackupGroup(id=str(uuid4()), name="G", description="Desc", owner_username="u1", is_active=True)],
        group_members=[BackupGroupMember(group_name="missing", username="missing"), BackupGroupMember(group_name="exist-group", username="u1"), BackupGroupMember(group_name="G", username="u2")],
        group_global_permissions=[BackupGroupGlobalPermission(group_name="missing", permission=GlobalPermission.create_space), BackupGroupGlobalPermission(group_name="exist-group", permission=GlobalPermission.create_space), BackupGroupGlobalPermission(group_name="G", permission=GlobalPermission.create_space)],
        space_user_permissions=[BackupSpaceUserPermission(space_key="missing", username="missing", permission=Permission.view), BackupSpaceUserPermission(space_key="S", username="u1", permission=Permission.view), BackupSpaceUserPermission(space_key="S", username="u2", permission=Permission.view)],
        space_group_permissions=[BackupSpaceGroupPermission(space_key="missing", group_name="missing", permission=Permission.view), BackupSpaceGroupPermission(space_key="S", group_name="exist-group", permission=Permission.view), BackupSpaceGroupPermission(space_key="S", group_name="G", permission=Permission.view)],
        pages=[
            BackupPage(id=str(uuid4()), space_key="missing", slug="p", title="P", content="<p>Test</p>", created_by_username="missing", updated_by_username="missing"),
            BackupPage(id=str(uuid4()), space_key="S", slug="p", title="P", content="<p>Test</p>", created_by_username="u1", updated_by_username="u1"),
            BackupPage(id=str(uuid4()), space_key="S", slug="p2", title="P", content="<p>Test</p>", created_by_username="u2", updated_by_username="u2")
        ],
        page_revisions=[BackupPageRevision(page_space_key="missing", page_slug="p", version=1, title="P", created_by_username="missing"), BackupPageRevision(page_space_key="S", page_slug="exist-page", version=1, title="P", created_by_username="u1"), BackupPageRevision(page_space_key="S", page_slug="p", version=1, title="P", created_by_username="u2")],
        page_likes=[BackupPageLike(page_space_key="missing", page_slug="p", username="missing"), BackupPageLike(page_space_key="S", page_slug="exist-page", username="u1"), BackupPageLike(page_space_key="S", page_slug="p", username="u2")],
        page_user_restrictions=[BackupPageUserRestriction(page_space_key="missing", page_slug="p", username="missing", permission=Permission.view), BackupPageUserRestriction(page_space_key="S", page_slug="exist-page", username="u1", permission=Permission.view), BackupPageUserRestriction(page_space_key="S", page_slug="p", username="u2", permission=Permission.view)],
        page_group_restrictions=[BackupPageGroupRestriction(page_space_key="missing", page_slug="p", group_name="missing", permission=Permission.view), BackupPageGroupRestriction(page_space_key="S", page_slug="exist-page", group_name="exist-group", permission=Permission.view), BackupPageGroupRestriction(page_space_key="S", page_slug="p", group_name="G", permission=Permission.view)],
        site_settings=BackupSiteSettings(site_name="Test")
    )

    # Generate exactly 101 error cases to trigger self.truncated = True (MAX_REPORT_ENTRIES = 100)
    for i in range(101):
        doc.space_members.append(BackupSpaceMember(space_key="missing", username="missing"))

    report = _ReportBuilder()
    no_password = []

    await service._apply(doc, report, no_password)

