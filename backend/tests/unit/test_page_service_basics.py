from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.core.exceptions import BadRequestError, NotFoundError, PermissionDeniedError
from app.models.permission import Permission
from app.models.space import SpaceStatus
from app.modules.pages.service import PageService
from app.schemas.page import PageCreate, PageMove, PageUpdate


def make_service() -> PageService:
    result = PageService(Mock())
    result.session.get = AsyncMock()
    result.session.flush = AsyncMock()
    result.session.refresh = AsyncMock()
    result.spaces.require_add = AsyncMock()
    result.spaces.permissions = Mock()
    result.spaces.permissions.can_edit_page = AsyncMock(return_value=True)
    result.spaces.permissions.can_view_page = AsyncMock(return_value=True)
    result.spaces.permissions.effective_permissions = AsyncMock(return_value={Permission.export})
    result.spaces.permissions.page_view_is_restricted = AsyncMock(return_value=False)
    result.spaces.permissions.require = AsyncMock()
    result.pages = Mock()
    result.revisions = Mock()
    return result


def page():
    now = datetime.now(UTC)
    creator = SimpleNamespace(username="alice", full_name="Alice")
    return SimpleNamespace(
        id=uuid.uuid4(),
        space_id=uuid.uuid4(),
        parent_id=None,
        title="Title",
        slug="title",
        content="Body",
        content_format="html",
        created_at=now,
        updated_at=now,
        created_by_label=None,
        updated_by_label=None,
        created_by=creator,
        updated_by=creator,
    )


@pytest.mark.asyncio
async def test_page_permissions_serialization_and_likes() -> None:
    service = make_service()
    current = page()
    actor = SimpleNamespace(id=uuid.uuid4())
    await service.require_editor(SimpleNamespace(), actor)
    await service.require_page_editor(current, actor)
    await service.require_page_view(current, actor)
    service.spaces.permissions.can_view_page = AsyncMock(return_value=False)
    with pytest.raises(PermissionDeniedError):
        await service.require_page_view(current, actor)
    service.spaces.permissions.can_view_page = AsyncMock(return_value=True)
    read = service.to_read(current)
    assert read.title == "Title" and read.created_by_username == "alice"
    result = await service.to_read_for_user(current, actor)
    assert result.can_edit is True and result.can_export is True
    assert service.to_read_many([current])[0].slug == "title"

    service.pages.list_for_space = AsyncMock(return_value=[current])
    assert len(await service.list_for_space(SimpleNamespace(id=current.space_id))) == 1
    service.pages.list_for_space = AsyncMock(return_value=[current])
    service.spaces.permissions.can_view_page = AsyncMock(return_value=False)
    assert await service.list_for_space(SimpleNamespace(id=current.space_id), actor) == []
    service.pages.get_by_slug = AsyncMock(return_value=None)
    with pytest.raises(NotFoundError):
        await service.get_by_slug(SimpleNamespace(id=current.space_id), "missing")
    service.pages.get_by_slug = AsyncMock(return_value=current)
    assert await service.get_by_slug(SimpleNamespace(id=current.space_id), "title") is current

    service.pages.is_liked = AsyncMock(return_value=True)
    service.pages.like_count = AsyncMock(return_value=2)
    assert (await service.like_status(current, actor)).like_count == 2
    service.pages.set_like = AsyncMock()
    service.spaces.permissions.can_view_page = AsyncMock(return_value=True)
    assert (await service.set_like(current, actor, True)).liked_by_me is True


@pytest.mark.asyncio
async def test_page_create_and_revision_read_paths() -> None:
    service = make_service()
    current = page()
    space = SimpleNamespace(id=current.space_id, key="ENG")
    actor = SimpleNamespace(id=uuid.uuid4(), username="alice")
    service.unique_slug = AsyncMock(return_value="new-page")
    service.pages.get = AsyncMock(return_value=None)
    service.pages.add = Mock()
    service.snapshot_revision = AsyncMock()
    created = await service.create(
        space, PageCreate(title=" New Page ", content=" Body ", parent_id=None), actor
    )
    assert created.slug == "new-page" and created.content == "Body"
    service.pages.get = AsyncMock(return_value=None)
    with pytest.raises(NotFoundError):
        await service.create(
            space,
            PageCreate(title="Child", parent_id=uuid.uuid4()),
            actor,
        )

    service.revisions.get_max_version = AsyncMock(return_value=2)
    service.revisions.add = Mock()
    service.snapshot_revision = PageService.snapshot_revision.__get__(service)
    snapshot = await service.snapshot_revision(current, actor, "summary")
    assert snapshot.version == 3 and snapshot.change_summary == "summary"
    service.drafts.get = AsyncMock(return_value=None)
    service.drafts.delete = AsyncMock()
    service.snapshot_revision = AsyncMock()
    await service.update(
        space, current, PageUpdate(title="Updated", content_format="markdown"), actor
    )
    assert current.title == "Updated" and current.content_format == "markdown"

    revision = SimpleNamespace(
        id=uuid.uuid4(),
        page_id=current.id,
        version=1,
        title="Title",
        content="Body",
        content_format="html",
        created_at=datetime.now(UTC),
        change_summary="initial",
        created_by=SimpleNamespace(username="alice", full_name="Alice"),
    )
    service.revisions.list_for_page = AsyncMock(return_value=[revision])
    listed = await service.list_revisions(current)
    assert listed[0].version == 1
    service.revisions.get_by_version = AsyncMock(return_value=revision)
    assert (await service.get_revision(current, 1)).title == "Title"

    service.revisions.get_by_version = AsyncMock(return_value=None)
    service.list_revisions = AsyncMock(return_value=listed)
    assert (await service.get_revision(current, 1)).version == 1
    with pytest.raises(NotFoundError):
        await service.get_revision(current, 9)

    legacy = SimpleNamespace(
        version=1,
        created_by=None,
        id=uuid.uuid4(),
        page_id=current.id,
        title=current.title,
        content=current.content,
        content_format="html",
        created_at=datetime.now(UTC),
        change_summary="legacy",
    )
    service.revisions.list_for_page = AsyncMock(return_value=[])
    service.snapshot_revision = AsyncMock(return_value=legacy)
    service.list_revisions = PageService.list_revisions.__get__(service)
    assert (await service.list_revisions(current))[0].created_by_full_name == "System"

    service.spaces.permissions.can_edit_page = AsyncMock(return_value=False)
    with pytest.raises(PermissionDeniedError):
        await service.require_page_editor(current, actor)


@pytest.mark.asyncio
async def test_page_restore_move_delete_slugs_and_recent() -> None:
    service = make_service()
    current = page()
    actor = SimpleNamespace(id=uuid.uuid4(), username="alice")
    space = SimpleNamespace(id=current.space_id, key="ENG", status="active")
    revision = SimpleNamespace(title="Restored", content="Old", content_format="markdown")
    service.revisions.get_by_version = AsyncMock(return_value=revision)
    service.snapshot_revision = AsyncMock()
    assert await service.restore_revision(space, current, 1, actor) is current
    assert current.title == "Restored"
    service.revisions.get_by_version = AsyncMock(return_value=None)
    with pytest.raises(NotFoundError):
        await service.restore_revision(space, current, 9, actor)

    service.pages.slug_exists = AsyncMock(side_effect=[True, False])
    assert await service.unique_slug(space, " Hello World ") == "hello-world-2"
    assert service.unique_slug_from_occupied("page", {"page", "page-2"}) == "page-3"
    assert service.unique_slug_from_occupied("", set()) == ""

    destination = SimpleNamespace(id=uuid.uuid4(), key="OPS", status=SpaceStatus.active)
    child = SimpleNamespace(
        id=uuid.uuid4(), parent_id=current.id, space_id=space.id, slug="child", updated_by_id=None
    )
    service.spaces.get_by_key = AsyncMock(return_value=destination)
    service.pages.list_all_for_space = AsyncMock(side_effect=[[current, child, child], []])
    moved = await service.move(space, current, PageMove(destination_space_key="OPS"), actor)
    assert moved.space_id == destination.id
    service.pages.list_all_for_space = AsyncMock(side_effect=[[current, child], []])
    service.pages.get = AsyncMock(return_value=None)
    with pytest.raises(NotFoundError):
        await service.move(
            space, current, PageMove(destination_space_key="OPS", parent_id=uuid.uuid4()), actor
        )
    service.pages.list_all_for_space = AsyncMock(side_effect=[[current, child], []])
    service.pages.get = AsyncMock(return_value=current)
    with pytest.raises(BadRequestError, match="itself"):
        await service.move(
            space, current, PageMove(destination_space_key="OPS", parent_id=current.id), actor
        )
    inactive = SimpleNamespace(id=uuid.uuid4(), key="OLD", status=SpaceStatus.archived)
    service.spaces.get_by_key = AsyncMock(return_value=inactive)
    with pytest.raises(BadRequestError, match="active space"):
        await service.move(space, current, PageMove(destination_space_key="OLD"), actor)

    service.spaces.permissions.can_view_page = AsyncMock(return_value=True)
    service.spaces.permissions.effective_permissions = AsyncMock(return_value={Permission.delete})
    child.parent_id = current.parent_id
    service.pages.list_children = AsyncMock(return_value=[child])
    service.pages.delete = AsyncMock()
    assert await service.delete(space, current, actor) == 1
    service.spaces.permissions.effective_permissions = AsyncMock(return_value=set())
    with pytest.raises(PermissionDeniedError):
        await service.delete(space, current, actor)
    service.spaces.permissions.can_view_page = AsyncMock(return_value=False)
    with pytest.raises(PermissionDeniedError):
        await service.delete(space, current, actor)

    current.space = SimpleNamespace(key="ENG", name="Engineering")
    current.updated_by = SimpleNamespace(username="alice", full_name="Alice")
    service.pages.list_recent_pages = AsyncMock(return_value=[current])
    service.spaces.permissions.can_view_page = AsyncMock(return_value=True)
    assert (await service.list_recent_pages(actor))[0].user_full_name == "Alice"
