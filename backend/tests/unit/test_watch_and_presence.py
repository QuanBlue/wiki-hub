from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.exceptions import ConflictError
from app.modules.pages.service import PageService
from app.modules.presence import service as presence_module
from app.modules.presence.service import PresenceService
from app.modules.spaces.service import SpaceService
from app.schemas.page import PageUpdate, PageWatchUpdate
from app.schemas.space import SpaceWatchUpdate


@pytest.mark.asyncio
async def test_page_watch_get_and_set() -> None:
    session = AsyncMock()
    session.add = MagicMock()
    page_service = PageService(session)
    page_service.spaces = MagicMock()
    page_service.spaces.permissions.can_view_page = AsyncMock(return_value=True)

    user = SimpleNamespace(id=uuid.uuid4(), username="alice")
    page = SimpleNamespace(id=uuid.uuid4(), title="Test Page", space_id=uuid.uuid4())

    # 1. Unwatched page
    session.scalar.return_value = None
    res = await page_service.get_watch(page, user)
    assert res.watching is False
    assert res.include_descendants is False

    # 2. Set watch with include_descendants
    res_set = await page_service.set_watch(
        page, user, PageWatchUpdate(watching=True, include_descendants=True)
    )
    assert res_set.watching is True
    assert res_set.include_descendants is True
    assert session.add.called
    assert session.flush.called

    existing_watch = MagicMock(include_descendants=False)
    session.scalar.return_value = existing_watch
    assert (await page_service.get_watch(page, user)).include_descendants is False
    updated = await page_service.set_watch(
        page, user, PageWatchUpdate(watching=True, include_descendants=True)
    )
    assert updated.include_descendants is True
    assert existing_watch.include_descendants is True

    # 3. Stop watching
    res_unwatch = await page_service.set_watch(
        page, user, PageWatchUpdate(watching=False)
    )
    assert res_unwatch.watching is False
    session.delete.assert_called_with(existing_watch)


@pytest.mark.asyncio
async def test_space_watch_get_set_and_remove() -> None:
    session = AsyncMock()
    session.add = MagicMock()
    service = SpaceService(session)
    space = SimpleNamespace(id=uuid.uuid4())
    user = SimpleNamespace(id=uuid.uuid4())

    session.scalar.return_value = None
    assert (await service.get_watch(space, user)).watching is False
    assert (await service.set_watch(space, user, SpaceWatchUpdate(watching=True))).watching is True
    session.add.assert_called_once()
    session.flush.assert_awaited_once()

    existing = SimpleNamespace(space_id=space.id, user_id=user.id)
    session.scalar.return_value = existing
    assert (await service.get_watch(space, user)).watching is True
    assert (await service.set_watch(space, user, SpaceWatchUpdate(watching=True))).watching is True
    assert (await service.set_watch(space, user, SpaceWatchUpdate(watching=False))).watching is False
    session.delete.assert_awaited_once_with(existing)
    assert session.flush.await_count == 2

    session.scalar.return_value = None
    assert (await service.set_watch(space, user, SpaceWatchUpdate(watching=False))).watching is False
    assert session.delete.await_count == 1


@pytest.mark.asyncio
async def test_page_update_conflict_detection() -> None:
    session = AsyncMock()
    session.add = MagicMock()
    page_service = PageService(session)
    page_service.require_page_editor = AsyncMock()
    page_service.snapshot_revision = AsyncMock()
    page_service.drafts = MagicMock()
    page_service.drafts.get = AsyncMock(return_value=None)
    page_service._notify_watchers = AsyncMock()

    user = SimpleNamespace(id=uuid.uuid4(), username="alice", full_name="Alice")
    space = SimpleNamespace(id=uuid.uuid4(), key="DEV")
    
    now = datetime.now(UTC)
    page = SimpleNamespace(
        id=uuid.uuid4(),
        slug="my-page",
        title="Old Title",
        content="Old Content",
        content_format="html",
        updated_at=now,
        updated_by=SimpleNamespace(id=uuid.uuid4(), username="bob", full_name="Bob"),
        updated_by_id=uuid.uuid4(),
        parent_id=None,
    )

    # Calling update with base_updated_at older than page.updated_at -> ConflictError
    stale_time = now - timedelta(minutes=5)
    payload = PageUpdate(
        title="New Title",
        content="New Content",
        base_updated_at=stale_time,
        force=False,
    )

    with pytest.raises(ConflictError) as exc_info:
        await page_service.update(space, page, payload, user)

    assert exc_info.value.code == "page_conflict"

    # Calling update with force=True bypasses conflict
    payload_force = PageUpdate(
        title="New Title",
        content="New Content",
        base_updated_at=stale_time,
        force=True,
    )
    updated = await page_service.update(space, page, payload_force, user)
    assert updated.title == "New Title"


@pytest.mark.asyncio
async def test_notify_watchers_direct_and_ancestors() -> None:
    session = AsyncMock()
    session.add = MagicMock()
    page_service = PageService(session)
    page_service.spaces = MagicMock()
    page_service.spaces.permissions.can_view_page = AsyncMock(return_value=True)

    actor = SimpleNamespace(id=uuid.uuid4(), username="alice", full_name="Alice")
    watcher1_id = uuid.uuid4()
    watcher2_id = uuid.uuid4()

    space = SimpleNamespace(id=uuid.uuid4(), key="DEV", name="Dev Space")
    page = SimpleNamespace(id=uuid.uuid4(), slug="child-page", title="Child Page", parent_id=uuid.uuid4())

    # Ancestor resolution
    parent_page = SimpleNamespace(id=page.parent_id, parent_id=None)
    session.get.return_value = parent_page

    # Return watcher IDs
    session.scalars.side_effect = [
        [watcher1_id],  # direct watchers
        [watcher2_id],  # branch watchers
        [],             # space watchers
        [
            SimpleNamespace(id=watcher1_id, is_active=True),
            SimpleNamespace(id=watcher2_id, is_active=True),
        ],  # User entities
    ]

    with patch("app.modules.pages.service.notify", new_callable=AsyncMock) as mock_notify:
        await page_service._notify_watchers(space, page, actor, is_create=False)
        assert mock_notify.call_count == 2
        notified_users = {c.args[1] for c in mock_notify.call_args_list}
        assert notified_users == {watcher1_id, watcher2_id}
        assert all(c.kwargs["kind"] == "page_updated" for c in mock_notify.call_args_list)


@pytest.mark.asyncio
async def test_presence_service_in_memory_fallback() -> None:
    page_id = uuid.uuid4()
    user1 = SimpleNamespace(
        id=uuid.uuid4(),
        username="carol",
        full_name="Carol Danvers",
        avatar_url=None,
        avatar_object_key=None,
    )

    with patch("app.modules.presence.service.get_redis", side_effect=Exception("Redis down")):
        # Heartbeat sets user
        active = await PresenceService.heartbeat(page_id, user1, editing=True)
        assert len(active) == 1
        assert active[0].username == "carol"
        assert active[0].state == "editing"

        # Active users retrieval
        active_list = await PresenceService.get_active_users(page_id)
        assert len(active_list) == 1

        # Leave removes user
        await PresenceService.leave(page_id, user1.id)
        active_after_leave = await PresenceService.get_active_users(page_id)
        assert len(active_after_leave) == 0


@pytest.mark.asyncio
async def test_presence_service_redis_lifecycle_and_expiration() -> None:
    import json
    import time

    page_id = uuid.uuid4()
    user = SimpleNamespace(
        id=uuid.uuid4(), username="Zoe", full_name=" ", avatar_url=None,
        avatar_object_key="avatars/zoe.png",
    )
    redis = AsyncMock()
    current = PresenceService._user_dict(user, "editing")
    old = {**current, "timestamp": time.time() - 100}
    redis.hgetall.return_value = {
        str(user.id): json.dumps(current),
        "old": json.dumps(old),
        "bad": "not-json",
    }
    with patch("app.modules.presence.service.get_redis", return_value=redis):
        active = await PresenceService.heartbeat(page_id, user, editing=True)
        assert [item.username for item in active] == ["Zoe"]
        assert active[0].avatar_url == f"/api/v1/users/{user.id}/avatar"
        assert active[0].full_name == "Zoe"
        redis.hset.assert_awaited_once()
        redis.expire.assert_awaited_once()
        redis.hdel.assert_awaited_with(f"wikihub:presence:page:{page_id}", "old", "bad")
        await PresenceService.leave(page_id, user.id)
        await PresenceService.broadcast_page_saved(page_id, user, datetime.now(UTC), "Runbook")
        assert redis.publish.await_count == 3


@pytest.mark.asyncio
async def test_presence_service_memory_expiration_and_publish_failure() -> None:
    import time

    page_id = uuid.uuid4()
    user = SimpleNamespace(id=uuid.uuid4(), username="ann", full_name="Ann", avatar_url="/a")
    key = str(page_id)
    old = PresenceService._user_dict(user, "viewing")
    old["timestamp"] = time.time() - 100
    presence_module._memory_presence[key] = {str(user.id): old}
    with patch("app.modules.presence.service.get_redis", side_effect=RuntimeError("offline")):
        assert await PresenceService.get_active_users(page_id) == []
        assert presence_module._memory_presence[key] == {}
        await PresenceService.broadcast_page_saved(page_id, user, datetime.now(UTC), "Runbook")
    presence_module._memory_presence.pop(key, None)
