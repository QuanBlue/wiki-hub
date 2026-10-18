from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
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
    result.spaces.permissions.nearest_restricting_ancestor = AsyncMock(return_value=None)
    result.spaces.permissions.require = AsyncMock()
    result.pages = Mock()
    result.revisions = Mock()
    # The administrators' Trash period lives in site settings (a database read).
    result.trash_retention_days = AsyncMock(return_value=30)
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
    current.deleted_at = None
    result = await service.trash(space, current, actor)
    assert result.moved_children == 1 and result.id == current.id
    # Binned, not deleted: the row stays for the Trash.
    assert current.deleted_at is not None and current.deleted_by_id == actor.id
    service.pages.delete.assert_not_awaited()
    current.deleted_at = None
    service.spaces.permissions.effective_permissions = AsyncMock(return_value=set())
    with pytest.raises(PermissionDeniedError):
        await service.trash(space, current, actor)
    service.spaces.permissions.can_view_page = AsyncMock(return_value=False)
    with pytest.raises(PermissionDeniedError):
        await service.trash(space, current, actor)

    current.space = SimpleNamespace(key="ENG", name="Engineering")
    current.updated_by = SimpleNamespace(username="alice", full_name="Alice")
    service.pages.list_recent_pages = AsyncMock(return_value=[current])
    service.spaces.permissions.can_view_page = AsyncMock(return_value=True)
    assert (await service.list_recent_pages(actor))[0].user_full_name == "Alice"


def trashed(**extra):
    deleted = datetime(2026, 10, 1, tzinfo=UTC)
    remover = SimpleNamespace(username="bob", full_name="Bob")
    item = page()
    item.deleted_at = deleted
    item.deleted_by_id = uuid.uuid4()
    item.deleted_by = remover
    item.created_by_id = None
    for key, value in extra.items():
        setattr(item, key, value)
    return item


@pytest.mark.asyncio
async def test_trash_lists_what_each_person_may_restore() -> None:
    service = make_service()
    owner = SimpleNamespace(id=uuid.uuid4(), username="alice")
    space = SimpleNamespace(id=uuid.uuid4(), key="ENG")
    parent = page()
    mine = trashed(created_by_id=owner.id, parent_id=parent.id)
    theirs = trashed(deleted_by=None)
    hidden = trashed()
    service.spaces.require_view = AsyncMock()
    service.pages.list_trashed = AsyncMock(return_value=[mine, theirs, hidden])
    service.pages.get = AsyncMock(return_value=parent)

    # Delete own: only the pages this person created.
    service.spaces.permissions.effective_permissions = AsyncMock(
        return_value={Permission.view, Permission.delete_own}
    )
    listing = await service.list_trash(space, owner)
    assert [item.id for item in listing.items] == [mine.id]
    assert listing.items[0].parent_title == parent.title
    assert listing.items[0].deleted_by_username == "bob"
    assert listing.items[0].purge_at == mine.deleted_at + timedelta(days=listing.retention_days)
    assert listing.can_purge is False

    # Delete (and admin): everything they can see - a page restricted from them stays out.
    service.spaces.permissions.effective_permissions = AsyncMock(
        return_value={Permission.view, Permission.delete, Permission.admin}
    )
    service.spaces.permissions.can_view_page = AsyncMock(side_effect=[True, True, False])
    service.pages.get = AsyncMock(return_value=None)
    listing = await service.list_trash(space, owner)
    assert [item.id for item in listing.items] == [mine.id, theirs.id]
    assert listing.items[1].deleted_by_username is None
    assert listing.items[0].parent_title is None
    assert listing.can_purge is True


@pytest.mark.asyncio
async def test_restore_puts_a_page_back_where_it_was_or_at_the_top() -> None:
    service = make_service()
    actor = SimpleNamespace(id=uuid.uuid4(), username="alice")
    space = SimpleNamespace(id=uuid.uuid4(), key="ENG")
    service.spaces.permissions.effective_permissions = AsyncMock(return_value={Permission.delete})

    item = trashed(parent_id=uuid.uuid4())
    service.pages.get_trashed = AsyncMock(return_value=item)
    service.pages.get = AsyncMock(return_value=page())
    result = await service.restore(space, item.id, actor)
    assert result.restored_to_parent is True and result.slug == item.slug
    assert item.deleted_at is None and item.deleted_by_id is None
    assert item.parent_id is not None

    # Its parent went to the Trash too: back at the top of the space instead.
    item = trashed(parent_id=uuid.uuid4())
    service.pages.get_trashed = AsyncMock(return_value=item)
    service.pages.get = AsyncMock(return_value=None)
    result = await service.restore(space, item.id, actor)
    assert result.restored_to_parent is False and item.parent_id is None

    # A root page was never under anything.
    item = trashed()
    service.pages.get_trashed = AsyncMock(return_value=item)
    assert (await service.restore(space, item.id, actor)).restored_to_parent is True

    # Not in the Trash, hidden from them, or not theirs to restore: all "not found".
    service.pages.get_trashed = AsyncMock(return_value=None)
    with pytest.raises(NotFoundError):
        await service.restore(space, uuid.uuid4(), actor)
    service.pages.get_trashed = AsyncMock(return_value=trashed())
    service.spaces.permissions.can_view_page = AsyncMock(return_value=False)
    with pytest.raises(NotFoundError):
        await service.restore(space, uuid.uuid4(), actor)
    service.spaces.permissions.can_view_page = AsyncMock(return_value=True)
    service.spaces.permissions.effective_permissions = AsyncMock(return_value={Permission.view})
    with pytest.raises(NotFoundError):
        await service.restore(space, uuid.uuid4(), actor)


@pytest.mark.asyncio
async def test_a_trashed_page_can_be_read_by_whoever_may_restore_it() -> None:
    service = make_service()
    actor = SimpleNamespace(id=uuid.uuid4(), username="alice")
    space = SimpleNamespace(id=uuid.uuid4(), key="ENG")
    parent = page()
    item = trashed(parent_id=parent.id, content="<p>Old notes</p>", content_format="html")
    service.pages.get_trashed = AsyncMock(return_value=item)
    service.pages.get = AsyncMock(return_value=parent)
    service.spaces.permissions.effective_permissions = AsyncMock(return_value={Permission.delete})

    detail = await service.preview_trashed(space, item.id, actor)
    assert detail.content == "<p>Old notes</p>" and detail.content_format == "html"
    assert detail.title == item.title and detail.parent_title == parent.title
    assert detail.deleted_by_username == "bob"
    assert detail.purge_at == item.deleted_at + timedelta(days=30)

    # A page whose parent is gone, with no one recorded as having deleted it.
    service.pages.get = AsyncMock(return_value=None)
    orphan = trashed(
        parent_id=uuid.uuid4(), deleted_by=None, content="# Title", content_format="markdown"
    )
    service.pages.get_trashed = AsyncMock(return_value=orphan)
    detail = await service.preview_trashed(space, orphan.id, actor)
    assert detail.parent_title is None and detail.deleted_by_username is None
    assert detail.content_format == "markdown"

    # Not theirs to read: the same "not found" as restoring it.
    service.spaces.permissions.effective_permissions = AsyncMock(return_value={Permission.view})
    with pytest.raises(NotFoundError):
        await service.preview_trashed(space, orphan.id, actor)
    service.spaces.permissions.effective_permissions = AsyncMock(return_value={Permission.delete})
    service.spaces.permissions.can_view_page = AsyncMock(return_value=False)
    with pytest.raises(NotFoundError):
        await service.preview_trashed(space, orphan.id, actor)
    service.pages.get_trashed = AsyncMock(return_value=None)
    service.spaces.permissions.can_view_page = AsyncMock(return_value=True)
    with pytest.raises(NotFoundError):
        await service.preview_trashed(space, uuid.uuid4(), actor)


@pytest.mark.asyncio
async def test_purge_and_empty_trash_are_for_space_admins() -> None:
    service = make_service()
    actor = SimpleNamespace(id=uuid.uuid4(), username="alice")
    space = SimpleNamespace(id=uuid.uuid4(), key="ENG")
    service.spaces.permissions.effective_permissions = AsyncMock(
        return_value={Permission.delete, Permission.admin}
    )
    service.pages.delete = AsyncMock()
    item = trashed()
    service.pages.get_trashed = AsyncMock(return_value=item)
    await service.purge(space, item.id, actor)
    service.pages.delete.assert_awaited_once_with(item)
    service.spaces.permissions.require.assert_awaited_with(space, actor, Permission.admin)

    service.pages.delete.reset_mock()
    service.pages.list_trashed = AsyncMock(return_value=[trashed(), trashed()])
    assert await service.empty_trash(space, actor) == 2
    assert service.pages.delete.await_count == 2

    service.spaces.permissions.require = AsyncMock(side_effect=PermissionDeniedError("no"))
    with pytest.raises(PermissionDeniedError):
        await service.purge(space, item.id, actor)
    with pytest.raises(PermissionDeniedError):
        await service.empty_trash(space, actor)


def _retention(monkeypatch: pytest.MonkeyPatch, days: int) -> None:
    from app.modules.pages import service as pages_service

    class _Settings:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        async def get_effective(self):
            return SimpleNamespace(trash_retention_days=days)

    monkeypatch.setattr(pages_service, "SiteSettingsService", _Settings)


@pytest.mark.asyncio
async def test_the_trash_follows_the_period_an_administrator_chose(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _retention(monkeypatch, 7)
    service = make_service()
    del service.trash_retention_days  # read it for real, from the settings
    space = SimpleNamespace(id=uuid.uuid4(), key="ENG")
    owner = SimpleNamespace(id=uuid.uuid4(), username="alice")
    item = trashed()
    service.spaces.require_view = AsyncMock()
    service.pages.list_trashed = AsyncMock(return_value=[item])
    service.pages.get = AsyncMock(return_value=None)
    service.spaces.permissions.effective_permissions = AsyncMock(
        return_value={Permission.view, Permission.delete}
    )

    listing = await service.list_trash(space, owner)
    assert listing.retention_days == 7
    assert listing.items[0].purge_at == item.deleted_at + timedelta(days=7)

    # Pages are removed once they are older than that period - not the old 30 days.
    service.pages.delete = AsyncMock()
    service.pages.list_trashed_before = AsyncMock(return_value=[])
    await service.purge_expired()
    cutoff = service.pages.list_trashed_before.await_args.args[0]
    assert timedelta(days=6, hours=23) < datetime.now(UTC) - cutoff < timedelta(days=7, hours=1)


@pytest.mark.asyncio
async def test_purge_expired_removes_only_what_the_repository_finds() -> None:
    service = make_service()
    service.pages.delete = AsyncMock()
    service.pages.list_trashed_before = AsyncMock(return_value=[trashed()])
    assert await service.purge_expired() == 1
    cutoff = service.pages.list_trashed_before.await_args.args[0]
    assert datetime.now(UTC) - cutoff > timedelta(days=29)
    service.pages.list_trashed_before = AsyncMock(return_value=[])
    assert await service.purge_expired() == 0
