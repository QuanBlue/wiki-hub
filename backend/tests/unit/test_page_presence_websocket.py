"""Page presence WebSocket routing and cleanup without a network server."""

from __future__ import annotations

import asyncio
import json
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from starlette.websockets import WebSocketDisconnect

from app.api.v1 import pages


def socket(*, token: str | None = "token", messages: list[str | Exception] | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        cookies={"wikihub_access": token} if token else {},
        query_params={},
        close=AsyncMock(),
        accept=AsyncMock(),
        send_json=AsyncMock(),
        send_text=AsyncMock(),
        receive_text=AsyncMock(side_effect=messages or [WebSocketDisconnect()]),
    )


def dependencies(*, may_view: bool = True) -> tuple[SimpleNamespace, SimpleNamespace, SimpleNamespace, Mock]:
    session = Mock()
    user = SimpleNamespace(id=uuid.uuid4(), username="alice")
    page = SimpleNamespace(id=uuid.uuid4(), updated_at=datetime.now(UTC))
    space = SimpleNamespace(id=uuid.uuid4(), key="ENG")

    @asynccontextmanager
    async def session_context():
        yield session

    session_factory = Mock(return_value=session_context())
    return user, page, space, session_factory


@pytest.mark.asyncio
async def test_websocket_rejects_missing_token() -> None:
    websocket = socket(token=None)
    await pages.page_presence_websocket(websocket, "ENG", "runbook")
    websocket.close.assert_awaited_once_with(code=1008)
    websocket.accept.assert_not_awaited()


@pytest.mark.asyncio
async def test_websocket_handles_heartbeats_state_and_bad_messages() -> None:
    user, page, space, factory = dependencies()
    websocket = socket(messages=[
        json.dumps({"action": "heartbeat", "editing": True}),
        json.dumps({"action": "set_state", "state": "viewing"}),
        json.dumps({"action": "unknown"}),
        "not json",
        WebSocketDisconnect(),
    ])
    websocket.query_params = {"editing": "1"}
    identity = SimpleNamespace(subject=user.id, jti="jti")
    session_service = Mock(require_active=AsyncMock())
    auth_service = Mock(get_active_user=AsyncMock(return_value=user))
    space_service = Mock(get_by_key=AsyncMock(return_value=space))
    space_service.permissions.can_view_page = AsyncMock(return_value=True)
    page_service = Mock(get_by_slug=AsyncMock(return_value=page))
    with (
        patch.object(pages, "get_session_factory", return_value=factory),
        patch.object(pages, "decode_token_identity", return_value=identity),
        patch.object(pages, "SessionService", return_value=session_service),
        patch.object(pages, "AuthService", return_value=auth_service),
        patch.object(pages, "SpaceService", return_value=space_service),
        patch.object(pages, "PageService", return_value=page_service),
        patch.object(pages.PresenceService, "heartbeat", new_callable=AsyncMock, return_value=[]) as heartbeat,
        patch.object(pages.PresenceService, "leave", new_callable=AsyncMock) as leave,
    ):
        await pages.page_presence_websocket(websocket, "ENG", "runbook")
    websocket.accept.assert_awaited_once()
    assert heartbeat.await_count == 3
    assert [call.kwargs["editing"] for call in heartbeat.await_args_list] == [True, True, False]
    assert websocket.send_json.await_count == 3
    leave.assert_awaited_once_with(page.id, user.id)


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["permission", "authentication"])
async def test_websocket_denies_invalid_access(failure: str) -> None:
    user, page, space, factory = dependencies()
    websocket = socket()
    identity = SimpleNamespace(subject=user.id, jti="jti")
    session_service = Mock(require_active=AsyncMock(side_effect=RuntimeError("revoked") if failure == "authentication" else None))
    auth_service = Mock(get_active_user=AsyncMock(return_value=user))
    space_service = Mock(get_by_key=AsyncMock(return_value=space))
    space_service.permissions.can_view_page = AsyncMock(return_value=failure != "permission")
    page_service = Mock(get_by_slug=AsyncMock(return_value=page))
    with (
        patch.object(pages, "get_session_factory", return_value=factory),
        patch.object(pages, "decode_token_identity", return_value=identity),
        patch.object(pages, "SessionService", return_value=session_service),
        patch.object(pages, "AuthService", return_value=auth_service),
        patch.object(pages, "SpaceService", return_value=space_service),
        patch.object(pages, "PageService", return_value=page_service),
    ):
        await pages.page_presence_websocket(websocket, "ENG", "runbook")
    websocket.close.assert_awaited_once_with(code=1008)
    websocket.accept.assert_not_awaited()


@pytest.mark.asyncio
async def test_watch_and_presence_http_routes_delegate_after_page_lookup() -> None:
    user, page, space, _factory = dependencies()
    page_service = Mock(
        get_by_slug=AsyncMock(return_value=page),
        get_watch=AsyncMock(return_value="watch-status"),
        set_watch=AsyncMock(return_value="updated-watch"),
        require_page_view=AsyncMock(),
    )
    space_service = Mock(get_by_key=AsyncMock(return_value=space))
    payload = pages.PageWatchUpdate(watching=True)
    assert await pages.get_page_watch("ENG", "runbook", user, page_service, space_service) == "watch-status"
    assert await pages.update_page_watch("ENG", "runbook", payload, user, page_service, space_service) == "updated-watch"
    page_service.set_watch.assert_awaited_once_with(page, user, payload)

    with (
        patch.object(pages.PresenceService, "get_active_users", new_callable=AsyncMock, return_value=[]) as active,
        patch.object(pages.PresenceService, "heartbeat", new_callable=AsyncMock, return_value=[]) as heartbeat,
    ):
        assert await pages.get_page_presence("ENG", "runbook", user, page_service, space_service) == []
        result = await pages.page_presence_heartbeat(
            "ENG", "runbook", pages.PresenceHeartbeatRequest(editing=True),
            user, page_service, space_service,
        )
    assert result.users == []
    assert result.page_updated_at == page.updated_at
    active.assert_awaited_once_with(page.id)
    heartbeat.assert_awaited_once_with(page.id, user, editing=True)
    assert page_service.require_page_view.await_count == 2


@pytest.mark.asyncio
async def test_websocket_forwards_redis_events_and_closes_subscription() -> None:
    user, page, space, factory = dependencies()
    message_sent = asyncio.Event()

    async def receive_after_event() -> str:
        await asyncio.wait_for(message_sent.wait(), timeout=2)
        raise WebSocketDisconnect()

    async def send_event(_text: str) -> None:
        message_sent.set()

    websocket = socket()
    websocket.receive_text = AsyncMock(side_effect=receive_after_event)
    websocket.send_text = AsyncMock(side_effect=send_event)
    pubsub = Mock(
        subscribe=AsyncMock(),
        get_message=AsyncMock(return_value={"type": "message", "data": b'{"type":"page_saved"}'}),
        unsubscribe=AsyncMock(),
        aclose=AsyncMock(),
    )
    redis = Mock(pubsub=Mock(return_value=pubsub))
    space_service = Mock(get_by_key=AsyncMock(return_value=space))
    space_service.permissions.can_view_page = AsyncMock(return_value=True)
    with (
        patch.object(pages, "get_session_factory", return_value=factory),
        patch.object(pages, "decode_token_identity", return_value=SimpleNamespace(subject=user.id, jti="jti")),
        patch.object(pages, "SessionService", return_value=Mock(require_active=AsyncMock())),
        patch.object(pages, "AuthService", return_value=Mock(get_active_user=AsyncMock(return_value=user))),
        patch.object(pages, "SpaceService", return_value=space_service),
        patch.object(pages, "PageService", return_value=Mock(get_by_slug=AsyncMock(return_value=page))),
        patch.object(pages, "get_redis", return_value=redis),
        patch.object(pages.PresenceService, "heartbeat", new_callable=AsyncMock, return_value=[]),
        patch.object(pages.PresenceService, "leave", new_callable=AsyncMock),
    ):
        await pages.page_presence_websocket(websocket, "ENG", "runbook")
        await asyncio.sleep(0)
    websocket.send_text.assert_awaited_once_with('{"type":"page_saved"}')
    pubsub.subscribe.assert_awaited_once_with(f"wikihub:events:page:{page.id}")
    pubsub.unsubscribe.assert_awaited_once()
    pubsub.aclose.assert_awaited_once()


@pytest.mark.asyncio
async def test_websocket_keeps_client_alive_if_redis_subscription_fails() -> None:
    user, page, space, factory = dependencies()
    subscription_failed = asyncio.Event()

    async def fail_subscribe(_channel: str) -> None:
        subscription_failed.set()
        raise RuntimeError("redis offline")

    async def receive_after_failure() -> str:
        await asyncio.wait_for(subscription_failed.wait(), timeout=2)
        raise WebSocketDisconnect()

    websocket = socket()
    websocket.receive_text = AsyncMock(side_effect=receive_after_failure)
    pubsub = Mock(subscribe=AsyncMock(side_effect=fail_subscribe))
    space_service = Mock(get_by_key=AsyncMock(return_value=space))
    space_service.permissions.can_view_page = AsyncMock(return_value=True)
    with (
        patch.object(pages, "get_session_factory", return_value=factory),
        patch.object(pages, "decode_token_identity", return_value=SimpleNamespace(subject=user.id, jti="jti")),
        patch.object(pages, "SessionService", return_value=Mock(require_active=AsyncMock())),
        patch.object(pages, "AuthService", return_value=Mock(get_active_user=AsyncMock(return_value=user))),
        patch.object(pages, "SpaceService", return_value=space_service),
        patch.object(pages, "PageService", return_value=Mock(get_by_slug=AsyncMock(return_value=page))),
        patch.object(pages, "get_redis", return_value=Mock(pubsub=Mock(return_value=pubsub))),
        patch.object(pages.PresenceService, "heartbeat", new_callable=AsyncMock, return_value=[]),
        patch.object(pages.PresenceService, "leave", new_callable=AsyncMock),
    ):
        await pages.page_presence_websocket(websocket, "ENG", "runbook")
        await asyncio.sleep(0)
    websocket.accept.assert_awaited_once()
    websocket.send_text.assert_not_awaited()
