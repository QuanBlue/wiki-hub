
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
    BackupPagePin,
    BackupPageDraft,
    BackupUserTag,
    BackupUserPageLabel,
)
from app.models.page import UserPagePin
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


@pytest.mark.asyncio
async def test_apply_page_pins_drafts_tags_and_labels_skip_and_dedupe(
    service: BackupService,
) -> None:
    """Each of the four per-user-data loops has its own "missing_reference"
    (page or user does not resolve) and "already_exists" (the row is already
    there) skip branch, distinct from the "created" path the round-trip
    integration test already covers.
    """
    space = Mock(id="space-S")

    async def spaces_get_by_key(key):
        return space if key == "S" else None

    service.spaces = Mock()
    service.spaces.get_by_key = AsyncMock(side_effect=spaces_get_by_key)

    users_by_name = {"u1": Mock(id="user-u1")}

    async def users_get_by_username(username):
        return users_by_name.get(username)

    service.users = Mock()
    service.users.get_protected = AsyncMock(return_value=None)
    service.users.get_by_username = AsyncMock(side_effect=users_get_by_username)

    page = Mock(id="page-1")
    calls = {"drafts": 0, "tags": 0, "labels": 0}

    def make_result(items):
        res = Mock()
        res.scalar_one_or_none.return_value = items[0] if items else None
        return res

    async def execute_side_effect(stmt):
        query = str(stmt).lower()
        if "from pages" in query:
            return make_result([page])
        for key in ("page_drafts", "user_tags", "user_page_labels"):
            if key in query:
                short = key.split("_")[-1] if key != "user_page_labels" else "labels"
                calls[short] = calls.get(short, 0) + 1
                # First occurrence is "not yet created"; the second (the
                # identical entry repeated below) is "already exists".
                return make_result([Mock()] if calls[short] > 1 else [])
        return make_result([])

    service.session.execute = AsyncMock(side_effect=execute_side_effect)
    service.session.flush = AsyncMock()
    service.session.refresh = AsyncMock()

    pin_calls = {"count": 0}

    async def get_side_effect(model, _ident):
        if model is UserPagePin:
            pin_calls["count"] += 1
            return Mock() if pin_calls["count"] > 1 else None
        return None

    service.session.get = AsyncMock(side_effect=get_side_effect)

    now = datetime.now(UTC)
    doc = BackupDocument(
        wikihub_backup=BackupMeta(
            version=1, exported_at=now, app_version="1.0.0", site_name="Test", includes_credentials=False, counts={}
        ),
        users=[BackupUser(id=str(uuid4()), username="u1", email="a@b.com", full_name="U1")],
        spaces=[
            BackupSpace(
                id=str(uuid4()), key="S", name="Space", status=SpaceStatus.active,
                visibility=SpaceVisibility.open, created_at=now, updated_at=now,
            )
        ],
        page_pins=[
            BackupPagePin(page_space_key="missing", page_slug="p", username="u1"),
            BackupPagePin(page_space_key="S", page_slug="p", username="u1"),
            BackupPagePin(page_space_key="S", page_slug="p", username="u1"),
        ],
        page_drafts=[
            BackupPageDraft(page_space_key="missing", page_slug="p", username="u1", base_updated_at=now),
            BackupPageDraft(page_space_key="S", page_slug="p", username="u1", base_updated_at=now),
            BackupPageDraft(page_space_key="S", page_slug="p", username="u1", base_updated_at=now),
        ],
        user_tags=[
            BackupUserTag(username="missing", name="on-call"),
            BackupUserTag(username="u1", name="on-call"),
            BackupUserTag(username="u1", name="on-call"),
        ],
        user_page_labels=[
            BackupUserPageLabel(page_space_key="missing", page_slug="p", username="u1", name="needs-review"),
            BackupUserPageLabel(page_space_key="S", page_slug="p", username="u1", name="needs-review"),
            BackupUserPageLabel(page_space_key="S", page_slug="p", username="u1", name="needs-review"),
        ],
        site_settings=BackupSiteSettings(site_name="Test"),
    )

    report = _ReportBuilder()
    await service._apply(doc, report, [])

    entries = {(entry.kind, entry.outcome, entry.reason) for entry in report.entries}
    assert ("page_pin", "skipped", "missing_reference") in entries
    assert ("page_pin", "created", "") in entries
    assert ("page_pin", "skipped", "already_pinned") in entries
    assert ("page_draft", "skipped", "missing_reference") in entries
    assert ("page_draft", "created", "") in entries
    assert ("page_draft", "skipped", "already_exists") in entries
    assert ("user_tag", "skipped", "missing_user") in entries
    assert ("user_tag", "created", "") in entries
    assert ("user_tag", "skipped", "already_exists") in entries
    assert ("user_page_label", "skipped", "missing_reference") in entries
    assert ("user_page_label", "created", "") in entries
    assert ("user_page_label", "skipped", "already_exists") in entries

