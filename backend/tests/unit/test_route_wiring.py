"""Route handlers that only look things up and hand over to a service: what
each one calls, in which order, and what it returns. The services behind them
are tested against a real database elsewhere."""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.api.v1 import comments, notifications, pages, spaces
from app.workers import tasks


def _space_service() -> Mock:
    space = SimpleNamespace(key="ENG")
    service = Mock()
    service.get_by_key = AsyncMock(return_value=space)
    service.require_view = AsyncMock()
    service.permissions = Mock()
    service.permissions.space_audience = AsyncMock(return_value=(3, 1, False))
    service.permissions.page_audience = AsyncMock(return_value=(2, 0, True))
    service.permissions.set_page_inheritance = AsyncMock()
    service.space = space
    return service


def _page_service() -> Mock:
    page = SimpleNamespace(slug="home")
    service = Mock()
    service.get_by_slug = AsyncMock(return_value=page)
    service.require_page_view = AsyncMock()
    service.likers = AsyncMock(return_value=["liker"])
    service.page = page
    return service


async def test_space_audience_checks_view_first() -> None:
    user, space_service = Mock(), _space_service()

    audience = await spaces.space_audience("ENG", user, space_service)

    space_service.require_view.assert_awaited_once_with(space_service.space, user)
    assert (audience.users, audience.groups, audience.everyone) == (3, 1, False)


async def test_page_audience_and_likers_check_the_page_too() -> None:
    user, space_service, page_service = Mock(), _space_service(), _page_service()

    audience = await pages.get_page_audience("ENG", "home", user, page_service, space_service)
    likers = await pages.get_page_likers("ENG", "home", user, page_service, space_service)

    assert (audience.users, audience.groups, audience.everyone) == (2, 0, True)
    assert likers == ["liker"]
    assert page_service.require_page_view.await_count == 2
    page_service.require_page_view.assert_awaited_with(page_service.page, user)


async def test_page_inheritance_is_handed_to_the_permission_service() -> None:
    actor, space_service, page_service = Mock(), _space_service(), _page_service()

    await pages.set_page_inheritance(
        "ENG", "home", SimpleNamespace(inherit=False), actor, page_service, space_service
    )

    space_service.permissions.set_page_inheritance.assert_awaited_once_with(
        page_service.page, actor, inherit=False
    )


async def test_comment_routes_delegate_to_the_service() -> None:
    session, user = Mock(), Mock()
    with patch.object(comments, "CommentService") as service_class:
        comments.get_comment_service(session, user)
    service_class.assert_called_once_with(session, user)

    service, comment_id, payload = Mock(), uuid.uuid4(), Mock()
    for name in ("list_comments", "create", "mentionable", "update", "delete", "likers"):
        setattr(service, name, AsyncMock(return_value=name))
    service.set_like = AsyncMock(side_effect=lambda *args: args[-1])

    assert await comments.list_comments("ENG", "home", service) == "list_comments"
    assert await comments.create_comment("ENG", "home", payload, service) == "create"
    assert await comments.mentionable("ENG", "home", service, q="al") == "mentionable"
    service.mentionable.assert_awaited_once_with("ENG", "home", "al")
    assert await comments.update_comment("ENG", "home", comment_id, payload, service) == "update"
    response = await comments.delete_comment("ENG", "home", comment_id, service)
    assert response.status_code == 204
    service.delete.assert_awaited_once_with("ENG", "home", comment_id)
    assert await comments.comment_likers("ENG", "home", comment_id, service) == "likers"
    assert await comments.like_comment("ENG", "home", comment_id, service) is True
    assert await comments.unlike_comment("ENG", "home", comment_id, service) is False


async def test_notification_routes_delegate_to_the_service() -> None:
    session, user, notification_id = Mock(), Mock(), uuid.uuid4()
    service = Mock()
    for name in ("summary", "list", "mark_all_read", "mark_read"):
        setattr(service, name, AsyncMock(return_value=name))

    with patch.object(notifications, "NotificationService", return_value=service):
        assert await notifications.read_summary(user, session) == "summary"
        assert (
            await notifications.list_notifications(user, session, unread=True, limit=5, offset=0)
            == "list"
        )
        response = await notifications.mark_all_read(user, session)
        updated = await notifications.update_notification(
            notification_id, notifications.NotificationUpdate(read=False), user, session
        )

    service.list.assert_awaited_once_with(unread_only=True, limit=5, offset=0)
    assert response.status_code == 204
    assert updated == "mark_read"
    service.mark_read.assert_awaited_once_with(notification_id, read=False)


@pytest.mark.parametrize(
    ("needs_attention", "level"),
    [(0, "info"), (2, "warning")],
)
async def test_the_mailbox_healthcheck_logs_by_outcome(needs_attention: int, level: str) -> None:
    summary = SimpleNamespace(checked=3, needs_attention=needs_attention)
    service = Mock()
    service.run_healthcheck = AsyncMock(return_value=summary)

    @asynccontextmanager
    async def scope():
        yield Mock()

    with (
        patch.object(tasks, "session_scope", scope),
        patch.object(tasks, "AdminMailService", return_value=service),
        patch.object(tasks, "logger") as logger,
    ):
        await tasks.check_admin_mailboxes({})

    service.run_healthcheck.assert_awaited_once_with()
    getattr(logger, level).assert_called_once()
