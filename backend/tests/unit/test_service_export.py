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
from app.models.permission import (
    Group,
    GroupGlobalPermission,
    GroupMember,
    SpaceGroupPermission,
    SpaceUserPermission,
)
from app.models.draft import PageDraft
from app.models.restriction import PageGroupRestriction, PageUserRestriction
from app.models.revision import PageRevision
from app.models.space import Space, SpaceFavorite, SpaceMember, SpaceOwner, SpaceStatus, SpaceVisibility
from app.models.page import PageLike, UserPagePin, WikiPage
from app.models.user import User
from app.models.user_page_label import UserPageLabel
from app.models.user_tag import UserTag
from app.modules.backup.service import BackupService, ExportCancelled
from app.models.backup_job import BackupJob
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


# --- shared export_full_package query-routing helpers -----------------------
#
# export_full_package makes over a dozen distinct queries in a fixed order
# that is an internal implementation detail (and, deliberately, changed once
# already - 2026-08-25's streaming rewrite - to avoid materialising every
# page/revision at once; see that method's docstring). A positional list of
# canned `session.execute()` results breaks the moment that order changes.
# This router instead identifies each query by what it targets - the mapped
# entity, or for column-only selects, the set of column names - so tests stay
# valid across internal reordering.

def _scalars(items):
    res = Mock()
    res.scalars.return_value = list(items)
    return res

def _rows(items):
    res = Mock()
    res.all.return_value = list(items)
    return res

def _scalar(value):
    res = Mock()
    res.scalar_one.return_value = value
    return res

def _entity_of(query):
    cols = query.column_descriptions
    if len(cols) == 1 and cols[0].get("entity") is not None:
        return cols[0]["entity"]
    return None

def _column_names(query):
    return {c["name"] for c in query.column_descriptions}

def _make_user(**overrides):
    """A `User` with every field `BackupUser.model_validate` requires -
    `export_full_package` validates real rows, unlike the old tests where it
    ran behind a mocked `export_document` and never actually saw one."""
    defaults = dict(
        id=uuid4(), username="user1", email="user1@example.com", full_name="User One",
        is_active=True, is_superuser=False, is_protected=False,
        bio="", pronouns="", profile_url="", social_links=[], company="",
        avatar_object_key=None, avatar_content_type=None,
    )
    return User(**{**defaults, **overrides})

def _make_space(**overrides):
    defaults = dict(
        id=uuid4(), key="SPACE", name="Space", description="", icon="",
        status=SpaceStatus.active, visibility=SpaceVisibility.open,
        created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
    )
    return Space(**{**defaults, **overrides})

def _mock_site_settings(service):
    """`export_full_package` reads site settings through the real, session-
    sharing `SiteSettingsService` - stub it directly rather than teaching the
    query router about a table this suite otherwise never touches."""
    service.site_settings = AsyncMock()
    read_result = Mock()
    read_result.overrides = SimpleNamespace(model_dump=lambda: {})
    service.site_settings.read.return_value = read_result
    service.site_settings.get_effective.return_value = SimpleNamespace(site_name="Test")

_EMPTY_SMALL_TABLES = (
    SpaceMember, SpaceOwner, SpaceFavorite, Group, GroupMember, GroupGlobalPermission,
    SpaceUserPermission, SpaceGroupPermission, PageUserRestriction,
    PageGroupRestriction,
)

def make_export_full_package_router(
    *, users=(), spaces=(), attachments=(), page_index_rows=(), revisions_total=0,
    page_content_rows=(), revision_content_rows=(),
    pins=(), drafts=(), user_tags=(), user_page_labels=(), likes=(),
):
    """Builds the `session.execute` side_effect for `export_full_package`.

    Every small table (members, favorites, groups, ..., restrictions)
    defaults to empty - pass `page_index_rows`/`revisions_total` (and the
    matching content batches) only for tests that actually exercise pages or
    revisions. `pins`/`drafts`/`user_tags`/`user_page_labels`/`likes` default
    to empty too but, unlike the tables above, can be populated per test to
    verify they round-trip into the exported document.
    """
    overrides = {
        UserPagePin: pins, PageDraft: drafts, UserTag: user_tags,
        UserPageLabel: user_page_labels, PageLike: likes,
    }
    async def side_effect(query, *_args, **_kwargs):
        entity = _entity_of(query)
        if entity is User:
            return _scalars(users)
        if entity is Space:
            return _scalars(spaces)
        if entity in overrides:
            return _scalars(overrides[entity])
        if entity in _EMPTY_SMALL_TABLES:
            return _scalars([])
        if entity is PageAttachment:
            return _scalars(attachments)
        # Below this point every remaining query selects individual columns
        # (never a full mapped entity), so `entity` is always None - the
        # column-name set is what distinguishes them.
        names = _column_names(query)
        if names == {"id", "space_id", "slug", "parent_id"}:
            return _rows(page_index_rows)
        if any("count" in n.lower() for n in names):
            return _scalar(revisions_total)
        if "content" in names and "slug" in names:
            return _rows(page_content_rows)  # page-content batch
        if "content" in names and "page_id" in names:
            return _rows(revision_content_rows)  # revision-content batch
        raise AssertionError(f"Unmocked query in test router: columns={names}, entity={entity}")
    return side_effect

@pytest.mark.asyncio
async def test_export_package(service: BackupService, tmp_path):
    mock_storage = AsyncMock()
    mock_storage.get.return_value = b"testdata"

    space_id = uuid4()
    page_id = uuid4()
    space = _make_space(id=space_id)
    page_index_row = SimpleNamespace(id=page_id, space_id=space_id, slug="page-1-slug", parent_id=None)
    attachment = PageAttachment(
        id=uuid4(), page_id=page_id, filename="a.txt", content_type="text/plain", object_key="storage-att-1"
    )
    user = _make_user(avatar_object_key="storage-ava-1", avatar_content_type="image/png")

    _mock_site_settings(service)
    service.session.execute.side_effect = make_export_full_package_router(
        users=[user], spaces=[space], attachments=[attachment], page_index_rows=[page_index_row],
    )

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
async def test_export_package_includes_pins_drafts_tags_and_labels(
    service: BackupService, tmp_path
):
    """A user's personal page shortcuts, unsaved edits, and tags round-trip
    into the exported document - not just spaces/pages/attachments."""
    mock_storage = AsyncMock()
    mock_storage.get.return_value = b"testdata"

    space_id = uuid4()
    page_id = uuid4()
    space = _make_space(id=space_id, key="ENG")
    page_index_row = SimpleNamespace(id=page_id, space_id=space_id, slug="page-1-slug", parent_id=None)
    user = _make_user(username="alice")

    pin = SimpleNamespace(page_id=page_id, user_id=user.id)
    draft = SimpleNamespace(
        page_id=page_id, user_id=user.id, content="<p>wip</p>", content_format="html",
        edit_mode="normal", base_updated_at=datetime.now(UTC),
    )
    tag = SimpleNamespace(user_id=user.id, name="reading-list")
    label = SimpleNamespace(page_id=page_id, user_id=user.id, name="important")
    like = SimpleNamespace(page_id=page_id, user_id=user.id)

    _mock_site_settings(service)
    service.session.execute.side_effect = make_export_full_package_router(
        users=[user], spaces=[space], page_index_rows=[page_index_row],
        pins=[pin], drafts=[draft], user_tags=[tag], user_page_labels=[label], likes=[like],
    )

    path = str(tmp_path / "export.zip")
    await service.export_full_package(path, mock_storage, include_credentials=True)

    with zipfile.ZipFile(path, "r") as zf:
        document = json.loads(zf.read(DOCUMENT_PATH))

    assert document["page_pins"] == [
        {"page_space_key": "ENG", "page_slug": "page-1-slug", "username": "alice"}
    ]
    assert document["user_tags"] == [{"username": "alice", "name": "reading-list"}]
    assert document["user_page_labels"] == [
        {"page_space_key": "ENG", "page_slug": "page-1-slug", "username": "alice", "name": "important"}
    ]
    assert document["page_likes"] == [
        {"page_space_key": "ENG", "page_slug": "page-1-slug", "username": "alice"}
    ]
    assert len(document["page_drafts"]) == 1
    draft_entry = document["page_drafts"][0]
    assert draft_entry["page_space_key"] == "ENG"
    assert draft_entry["page_slug"] == "page-1-slug"
    assert draft_entry["username"] == "alice"
    assert draft_entry["content"] == "<p>wip</p>"


@pytest.mark.asyncio
async def test_export_package_skips_orphaned_attachments_and_users_without_avatar(
    service: BackupService, tmp_path
):
    mock_storage = AsyncMock()
    mock_storage.get.return_value = b"testdata"

    space_id = uuid4()
    page_id = uuid4()
    space = _make_space(id=space_id)
    page_index_row = SimpleNamespace(id=page_id, space_id=space_id, slug="page-1-slug", parent_id=None)
    valid_attachment = PageAttachment(
        id=uuid4(), page_id=page_id, filename="a.txt", content_type="text/plain", object_key="storage-att-1",
    )
    orphaned_attachment = PageAttachment(
        id=uuid4(), page_id=uuid4(), filename="b.txt", content_type="text/plain", object_key="storage-att-2",
    )
    user_with_avatar = _make_user(
        username="user1", avatar_object_key="storage-ava-1", avatar_content_type="image/png",
    )
    user_without_avatar = _make_user(username="user2", avatar_object_key=None)

    _mock_site_settings(service)
    service.session.execute.side_effect = make_export_full_package_router(
        users=[user_with_avatar, user_without_avatar], spaces=[space],
        attachments=[valid_attachment, orphaned_attachment], page_index_rows=[page_index_row],
    )

    path = str(tmp_path / "export.zip")
    manifest = await service.export_full_package(path, mock_storage, include_credentials=True)

    # Only the valid attachment/avatar pair was fetched from storage; the
    # orphaned attachment (its page isn't in the index) and the avatar-less
    # user were skipped.
    assert mock_storage.get.await_count == 2
    assert manifest["counts"]["attachments"] == 1
    assert manifest["counts"]["avatars"] == 1


@pytest.mark.asyncio
async def test_export_package_writes_identical_attachment_bytes_only_once(
    service: BackupService, tmp_path
):
    """Regression test for the streaming rewrite (2026-08-25, fixing an OOM on
    a ~5000-attachment real instance): two attachments with identical bytes
    are content-addressed to the same archive path, so the metadata for both
    must still be recorded while the zip only gets one physical entry."""
    mock_storage = AsyncMock()
    mock_storage.get.return_value = b"same-bytes-both-times"

    space_id = uuid4()
    page_id = uuid4()
    space = _make_space(id=space_id)
    page_index_row = SimpleNamespace(id=page_id, space_id=space_id, slug="page-1-slug", parent_id=None)
    attachment_a = PageAttachment(
        id=uuid4(), page_id=page_id, filename="a.txt", content_type="text/plain", object_key="storage-att-a"
    )
    attachment_b = PageAttachment(
        id=uuid4(), page_id=page_id, filename="b.txt", content_type="text/plain", object_key="storage-att-b"
    )

    _mock_site_settings(service)
    service.session.execute.side_effect = make_export_full_package_router(
        spaces=[space], attachments=[attachment_a, attachment_b], page_index_rows=[page_index_row],
    )

    path = str(tmp_path / "export.zip")
    manifest = await service.export_full_package(path, mock_storage, include_credentials=True)

    # Both attachments kept their own metadata record...
    assert manifest["counts"]["attachments"] == 2
    # ...but content-addressed storage means one physical object.
    object_entries = [e for e in manifest["entries"] if e["path"].startswith("objects/")]
    assert len(object_entries) == 1
    with zipfile.ZipFile(path, "r") as zf:
        object_names = [n for n in zf.namelist() if n.startswith("objects/")]
        assert len(object_names) == 1
        assert zf.read(object_names[0]) == b"same-bytes-both-times"


def _make_export_fixtures():
    space_id = uuid4()
    page_id = uuid4()
    space = _make_space(id=space_id)
    page_index_row = SimpleNamespace(id=page_id, space_id=space_id, slug="page-1-slug", parent_id=None)
    # Matches page_index_row - `total_items` counts every page up front (from
    # the index), so the content-batch fetch must return exactly one row too,
    # or `items_processed` can never catch up to `items_total`.
    page_content_row = SimpleNamespace(
        id=page_id, slug="page-1-slug", title="Page 1", content="hello", content_format="html",
        parent_id=None, created_by_id=None, updated_by_id=None, created_by_label=None, updated_by_label=None,
    )
    attachments = [
        PageAttachment(
            id=uuid4(), page_id=page_id, filename=f"a{i}.txt",
            content_type="text/plain", object_key=f"storage-att-{i}",
        )
        for i in range(2)
    ]
    user = _make_user(avatar_object_key="storage-ava-1", avatar_content_type="image/png")
    return space, page_index_row, page_content_row, attachments, user


@pytest.mark.asyncio
async def test_export_package_reports_incremental_progress(tmp_path):
    # Uses a bare AsyncMock (not `spec=Session`, unlike the `service` fixture)
    # so `.refresh`/`.commit` are awaitable - `_report_progress` calls both.
    session = AsyncMock()
    service = BackupService(session)
    storage = AsyncMock()
    storage.get.return_value = b"testdata"

    space, page_index_row, page_content_row, attachments, user = _make_export_fixtures()
    _mock_site_settings(service)
    session.execute.side_effect = make_export_full_package_router(
        users=[user], spaces=[space], attachments=attachments,
        page_index_rows=[page_index_row], page_content_rows=[page_content_row],
    )

    job = BackupJob(id=uuid4(), kind="full_export", status="running", counters={}, cancel_requested=False)
    path = str(tmp_path / "export.zip")
    await service.export_full_package(path, storage, include_credentials=True, job=job)

    # 2 attachments + 1 avatar + 1 page (+0 revisions) = 4 items total, all processed.
    assert job.counters["items_total"] == 4
    assert job.counters["items_processed"] == 4
    assert session.refresh.await_count >= 1
    assert session.commit.await_count >= 1


@pytest.mark.asyncio
async def test_export_package_cancelled_mid_run(tmp_path):
    session = AsyncMock()
    service = BackupService(session)
    storage = AsyncMock()
    storage.get.return_value = b"testdata"

    space, page_index_row, page_content_row, attachments, user = _make_export_fixtures()
    _mock_site_settings(service)
    session.execute.side_effect = make_export_full_package_router(
        users=[user], spaces=[space], attachments=attachments,
        page_index_rows=[page_index_row], page_content_rows=[page_content_row],
    )

    job = BackupJob(id=uuid4(), kind="full_export", status="running", counters={}, cancel_requested=False)

    # Let the very first checkpoint (at the top of export_full_package, before
    # any querying) succeed normally, then cancel on the next one - which
    # lands mid-loop, in the attachment/avatar streaming.
    calls = {"n": 0}

    async def cancel_after_first_checkpoint(_obj):
        calls["n"] += 1
        if calls["n"] >= 2:
            job.cancel_requested = True

    session.refresh.side_effect = cancel_after_first_checkpoint

    path = str(tmp_path / "export.zip")
    with pytest.raises(ExportCancelled):
        await service.export_full_package(path, storage, include_credentials=True, job=job)


@pytest.mark.asyncio
async def test_export_package_streams_pages_and_revisions_correctly(
    service: BackupService, tmp_path
):
    """The riskiest part of the streaming rewrite: `workspace.json` is no
    longer built by one `model_dump_json()` call - it's spliced together
    from a "shell" (everything but pages/page_revisions) plus each page and
    revision's own `model_dump_json()`, written incrementally. Verify the
    result is still one valid JSON document with the right data in the right
    places, and that the manifest's checksum for it is actually correct.
    """
    mock_storage = AsyncMock()

    space_id = uuid4()
    page_id = uuid4()
    space = _make_space(id=space_id, key="SPACE")
    page_index_row = SimpleNamespace(id=page_id, space_id=space_id, slug="page-1-slug", parent_id=None)
    page_content_row = SimpleNamespace(
        id=page_id, slug="page-1-slug", title="Page One", content="<p>hi</p>", content_format="html",
        parent_id=None, created_by_id=None, updated_by_id=None, created_by_label=None, updated_by_label=None,
    )
    revision_rows = [
        SimpleNamespace(
            page_id=page_id, version=v, title="Page One", content=f"rev {v}", content_format="html",
            created_by_id=None, change_summary=f"edit {v}",
        )
        for v in (1, 2)
    ]
    user = _make_user(username="author")

    _mock_site_settings(service)
    service.session.execute.side_effect = make_export_full_package_router(
        users=[user], spaces=[space], page_index_rows=[page_index_row],
        revisions_total=len(revision_rows), page_content_rows=[page_content_row],
        revision_content_rows=revision_rows,
    )

    path = str(tmp_path / "export.zip")
    manifest = await service.export_full_package(path, mock_storage, include_credentials=False)

    with zipfile.ZipFile(path, "r") as zf:
        raw = zf.read(DOCUMENT_PATH)
        data = json.loads(raw)  # raises if the splice produced invalid JSON

    assert [p["slug"] for p in data["pages"]] == ["page-1-slug"]
    assert data["pages"][0]["content"] == "<p>hi</p>"
    assert data["pages"][0]["space_key"] == "SPACE"
    assert {r["version"] for r in data["page_revisions"]} == {1, 2}
    assert {r["content"] for r in data["page_revisions"]} == {"rev 1", "rev 2"}
    assert [u["username"] for u in data["users"]] == ["author"]
    assert data["wikihub_backup"]["counts"]["pages"] == 1
    assert data["wikihub_backup"]["counts"]["page_revisions"] == 2

    # The manifest's checksum for workspace.json was computed while streaming
    # it out - confirm it actually matches the bytes that landed in the zip.
    doc_entry = next(e for e in manifest["entries"] if e["path"] == DOCUMENT_PATH)
    assert doc_entry["sha256"] == hashlib.sha256(raw).hexdigest()
    assert doc_entry["size_bytes"] == len(raw)


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
        make_result([]),  # 4. SpaceOwner
        make_result([]),  # 5. SpaceFavorite
        make_result([]),  # 6. Group
        make_result([]),  # 7. GroupMember
        make_result([]),  # 8. GroupGlobalPermission
        make_result([]),  # 9. SpaceUserPermission
        make_result([]),  # 10. SpaceGroupPermission
        make_result([page]),  # 11. WikiPage
        make_result([]),  # 12. PageRevision
        make_result([]),  # 13. PageLike
        # Not modeled: UserPagePin, PageDraft, UserTag, UserPageLabel,
        # PageUserRestriction, PageGroupRestriction - once this list is
        # exhausted, `side_effect`'s fallback returns an empty result for
        # each, which every one of those queries wants here anyway.
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
