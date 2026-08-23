
from __future__ import annotations

from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session
from datetime import datetime, UTC

from app.modules.backup.service import BackupService, _ReportBuilder
from app.schemas.backup import (
    BackupDocument, BackupMeta, BackupUser, BackupSpace, BackupSpaceMember,
    BackupGroup, BackupGroupMember, BackupGroupGlobalPermission,
    BackupPage, BackupPageRevision, BackupPageLike, BackupPageUserRestriction, BackupPageGroupRestriction,
    BackupSiteSettings
)
from app.models.space import SpaceStatus, SpaceVisibility
from app.models.permission import GlobalPermission, Permission

@pytest.fixture
def mock_session():
    return AsyncMock(spec=Session)

@pytest.fixture
def service(mock_session) -> BackupService:
    result = BackupService(mock_session)
    result.audit = Mock(record=AsyncMock())
    return result

@pytest.mark.asyncio
async def test_apply_remaining_errors(service: BackupService):
    service.users = Mock()
    service.users.get_protected = AsyncMock(return_value=Mock(username="admin", email="admin@a.com"))

    async def users_get_by_username_mock(username):
        if username == "missing": return None
        return Mock(id=f"user-{username}")
    service.users.get_by_username.side_effect = users_get_by_username_mock

    service.spaces = Mock()
    async def spaces_get_by_key_mock(key):
        if key == "missing": return None
        return Mock(id=f"space-{key}")
    service.spaces.get_by_key.side_effect = spaces_get_by_key_mock

    service.groups = Mock()

    service.site_settings = Mock()
    settings_read = Mock()
    settings_read.overrides = Mock()
    settings_read.overrides.model_dump.return_value = {"site_name": "AlreadyConfigured"}
    service.site_settings.read = AsyncMock(return_value=settings_read)

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
            if counts["groups"] in [1]: return make_result([])
            return make_result([Mock(id="group-1", name="G")])

        if "from pages" in query_str and "pages.space_id =" in query_str:
            counts["pages"] = counts.get("pages", 0) + 1
            if counts["pages"] in [1]: return make_result([])
            return make_result([Mock(id="page-1")])

        return make_result([])

    service.session.execute.side_effect = side_effect
    service.session.flush = AsyncMock()
    service.session.commit = AsyncMock()
    service.session.refresh = AsyncMock()
    service.session.get = AsyncMock(return_value=None)

    doc = BackupDocument(
        wikihub_backup=BackupMeta(version=1, exported_at=datetime.now(UTC), app_version="1", site_name="Test", includes_credentials=False, counts={}),
        users=[],
        spaces=[],
        space_members=[],
        space_favorites=[],
        groups=[],
        group_members=[],
        group_global_permissions=[
            BackupGroupGlobalPermission(group_name="missing", permission=GlobalPermission.create_space)
        ],
        space_user_permissions=[],
        space_group_permissions=[],
        pages=[
            BackupPage(id=str(uuid4()), space_key="S", slug="p2", title="P2", content="<p>Test</p>", created_by_username="u1", updated_by_username="u1", parent_slug="exist-parent"),
        ],
        page_revisions=[],
        page_likes=[],
        page_user_restrictions=[],
        page_group_restrictions=[],
        site_settings=BackupSiteSettings(site_name="Test")
    )

    # Trigger line 113 (self.truncated = True)
    doc.space_members = [BackupSpaceMember(space_key="missing", username="missing") for _ in range(1001)]

    report = _ReportBuilder()
    await service._apply(doc, report, [])

    assert report.truncated == True


@pytest.mark.asyncio
async def test_apply_reports_a_child_page_whose_parent_is_missing(service: BackupService):
    service.users = Mock()
    service.users.get_protected = AsyncMock(return_value=Mock(username="admin", email="admin@a.com"))
    service.users.get_by_username = AsyncMock(return_value=None)

    service.spaces = Mock()
    service.spaces.get_by_key = AsyncMock(return_value=Mock(id="space-S"))

    service.groups = Mock()
    service.site_settings = Mock()

    def make_result(items):
        res = Mock()
        res.all.return_value = items
        res.scalars.return_value = items
        res.scalar_one_or_none.return_value = items[0] if items else None
        return res

    counts = {"pages": 0}

    async def side_effect(*args, **kwargs):
        query_str = str(args[0]).lower()
        if "from pages" in query_str and "pages.space_id =" in query_str:
            counts["pages"] += 1
            # 1st call: the pre-creation "does this slug already exist" check - no.
            # 2nd call: looking the just-created child page back up - yes.
            # 3rd call: looking up its claimed parent slug "ghost" - not found.
            if counts["pages"] == 2:
                return make_result([Mock(id="child-id")])
            return make_result([])
        return make_result([])

    service.session.execute.side_effect = side_effect
    service.session.flush = AsyncMock()
    service.session.get = AsyncMock(return_value=None)

    doc = BackupDocument(
        wikihub_backup=BackupMeta(version=1, exported_at=datetime.now(UTC), app_version="1", site_name="Test", includes_credentials=False, counts={}),
        users=[], spaces=[], space_members=[], space_favorites=[],
        groups=[], group_members=[], group_global_permissions=[],
        space_user_permissions=[], space_group_permissions=[],
        pages=[
            BackupPage(id=str(uuid4()), space_key="S", slug="child", title="Child", content="<p>x</p>", parent_slug="ghost"),
        ],
        page_revisions=[], page_likes=[], page_user_restrictions=[], page_group_restrictions=[],
        site_settings=None,
    )

    report = _ReportBuilder()
    await service._apply(doc, report, [])

    entries = [e for e in report.entries if e.kind == "page_parent"]
    assert len(entries) == 1
    assert entries[0].label == "S/child"
    assert entries[0].outcome == "skipped"
    assert entries[0].reason == "missing_parent"
