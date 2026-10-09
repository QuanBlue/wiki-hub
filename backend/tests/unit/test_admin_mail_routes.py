"""The admin-mail route handlers' own wiring: which service call each makes,
with what, and which guard runs first. The services themselves are tested
against a real database in tests/integration/test_admin_mail_*."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.api.v1 import admin_mail as routes
from app.core.exceptions import NotFoundError
from app.models.permission import GlobalPermission, Permission


def _service() -> Mock:
    service = Mock()
    for name in (
        "summary",
        "list_inbox",
        "inbox_counts",
        "mark_all_read",
        "get_inbox_item",
        "update_inbox_item",
        "set_password",
        "send_account_email",
        "send_admin_granted_email",
        "send_space_access_email",
        "list_mailboxes",
        "create_mailbox",
        "update_mailbox",
        "test_mailbox",
        "delete_mailbox",
        "preview",
        "create_account",
        "reset_password",
    ):
        setattr(service, name, AsyncMock(return_value=name))
    return service


def test_dependencies_bind_the_caller() -> None:
    session, user, client, impersonator = Mock(), Mock(), Mock(), Mock()
    with patch.object(routes, "AdminMailService") as mail:
        routes.get_acting_admin_mail_service(session, user, client, impersonator)
    mail.assert_called_once_with(session, actor=user, client=client, impersonator=impersonator)
    with patch.object(routes, "RequestActionService") as actions:
        routes.get_request_action_service(session, user, client, impersonator)
    actions.assert_called_once_with(session, actor=user, client=client, impersonator=impersonator)


async def test_inbox_routes_delegate_to_the_service() -> None:
    user, service, request_id = Mock(), _service(), uuid.uuid4()

    assert await routes.read_summary(user, service) == "summary"
    assert (
        await routes.list_inbox(user, service, status_filter="open", limit=5, offset=10, kind=None)
        == "list_inbox"
    )
    service.list_inbox.assert_awaited_once_with(user, status="open", limit=5, offset=10, kind=None)
    assert await routes.inbox_counts(user, service, kind="account_request") == "inbox_counts"
    service.inbox_counts.assert_awaited_once_with(user, kind="account_request")

    response = await routes.mark_all_read(user, service)
    assert response.status_code == 204
    service.mark_all_read.assert_awaited_once_with(user)

    assert await routes.read_inbox_item(request_id, user, service) == "get_inbox_item"
    payload = Mock()
    assert await routes.update_inbox_item(request_id, payload, user, service) == "update_inbox_item"
    service.update_inbox_item.assert_awaited_once_with(user, request_id, payload)


async def test_request_action_routes_delegate_to_the_service() -> None:
    service, request_id = _service(), uuid.uuid4()
    payload = SimpleNamespace(login_url="https://wiki.example.com/login")

    assert await routes.preview_request_actions(request_id, service) == "preview"
    assert await routes.create_account_from_request(request_id, payload, service) == (
        "create_account"
    )
    service.create_account.assert_awaited_once_with(request_id, login_url=payload.login_url)
    assert await routes.reset_password_from_request(request_id, payload, service) == (
        "reset_password"
    )
    service.reset_password.assert_awaited_once_with(request_id, login_url=payload.login_url)


async def test_mailbox_routes_delegate_to_the_service() -> None:
    admin, service, mailbox_id = Mock(), _service(), uuid.uuid4()

    assert (
        await routes.set_mailbox_password(mailbox_id, SimpleNamespace(password="pw"), service)
        == "set_password"
    )
    service.set_password.assert_awaited_once_with(mailbox_id, "pw")
    assert await routes.list_mailboxes(admin, service) == "list_mailboxes"
    payload = Mock()
    assert await routes.create_mailbox(payload, admin, service) == "create_mailbox"
    assert await routes.update_mailbox(mailbox_id, payload, admin, service) == "update_mailbox"
    service.update_mailbox.assert_awaited_once_with(mailbox_id, payload)
    assert await routes.test_mailbox(mailbox_id, admin, service) == "test_mailbox"

    response = await routes.delete_mailbox(mailbox_id, admin, service)
    assert response.status_code == 204
    service.delete_mailbox.assert_awaited_once_with(mailbox_id)


@pytest.fixture
def guards():
    """The permission check and the user lookup each notice route starts with."""
    permissions = Mock()
    permissions.require_global = AsyncMock()
    permissions.require = AsyncMock()
    target = SimpleNamespace(id=uuid.uuid4())
    users = Mock()
    users.get = AsyncMock(return_value=target)
    space = SimpleNamespace(name="Engineering")
    spaces = Mock()
    spaces.get_by_key = AsyncMock(return_value=space)
    with (
        patch.object(routes, "PermissionService", return_value=permissions),
        patch.object(routes, "UserRepository", return_value=users),
        patch.object(routes, "SpaceService", return_value=spaces),
    ):
        yield SimpleNamespace(permissions=permissions, users=users, target=target, space=space)


async def test_account_notices_need_manage_users(guards) -> None:
    user, session, service = Mock(), Mock(), _service()
    payload = SimpleNamespace(user_id=guards.target.id, password="Secret-pass-1", login_url=None)

    assert await routes.notify_account_created(payload, user, session, service) == (
        "send_account_email"
    )
    service.send_account_email.assert_awaited_with(
        user, to_user=guards.target, password="Secret-pass-1", created=True, login_url=None
    )
    assert await routes.notify_password_reset(payload, user, session, service) == (
        "send_account_email"
    )
    service.send_account_email.assert_awaited_with(
        user, to_user=guards.target, password="Secret-pass-1", created=False, login_url=None
    )
    assert await routes.notify_admin_granted(payload, user, session, service) == (
        "send_admin_granted_email"
    )
    service.send_admin_granted_email.assert_awaited_once_with(
        user, to_user=guards.target, login_url=None
    )
    assert guards.permissions.require_global.await_count == 3
    guards.permissions.require_global.assert_awaited_with(user, GlobalPermission.manage_users)


async def test_space_access_notice_needs_the_space_admin(guards) -> None:
    user, session, service = Mock(), Mock(), _service()
    payload = SimpleNamespace(user_id=guards.target.id, space_key="ENG", added=True, login_url=None)

    assert await routes.notify_space_access(payload, user, session, service) == (
        "send_space_access_email"
    )
    guards.permissions.require.assert_awaited_once_with(guards.space, user, Permission.admin)
    service.send_space_access_email.assert_awaited_once_with(
        user, to_user=guards.target, space_name="Engineering", added=True, login_url=None
    )


async def test_a_notice_for_a_missing_user_is_not_found(guards) -> None:
    guards.users.get.return_value = None
    payload = SimpleNamespace(user_id=uuid.uuid4(), password="Secret-pass-1", login_url=None)

    with pytest.raises(NotFoundError):
        await routes.notify_account_created(payload, Mock(), Mock(), _service())
