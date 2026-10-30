from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.modules.notifications import service as notif_service
from app.modules.notifications.service import NotificationService, link_target_exists


@pytest.mark.asyncio
async def test_link_target_exists_branches() -> None:
    session = Mock()

    # 1. link is None / empty -> returns True (line 48)
    assert await link_target_exists(session, None) is True
    assert await link_target_exists(session, "") is True

    # 2. page link without comment -> page found, comment_id is None -> returns True (line 63)
    session.scalar = AsyncMock(return_value=uuid.uuid4())
    assert await link_target_exists(session, "/spaces/ENG/pages/welcome") is True

    # 3. page link with comment -> page found, comment not found -> returns False
    session.scalar = AsyncMock(side_effect=[uuid.uuid4(), None])
    comment_uuid = uuid.uuid4()
    assert (
        await link_target_exists(session, f"/spaces/ENG/pages/welcome#comment-{comment_uuid}")
        is False
    )

    # 4. page link -> page not found -> returns False
    session.scalar = AsyncMock(return_value=None)
    assert await link_target_exists(session, "/spaces/ENG/pages/deleted") is False

    # 5. space link
    session.scalar = AsyncMock(return_value=uuid.uuid4())
    assert await link_target_exists(session, "/spaces/ENG") is True

    # 6. arbitrary link -> assumed True
    assert await link_target_exists(session, "/help/overview") is True


@pytest.mark.asyncio
async def test_notification_service_list_prune_loop_exhaustion() -> None:
    session = Mock()
    user = SimpleNamespace(id=uuid.uuid4())

    notification = SimpleNamespace(
        id=uuid.uuid4(),
        user_id=user.id,
        kind="system",
        title="Notice",
        body="Body",
        link=None,
        read=False,
        created_at=None,
        actor=None,
    )
    result_mock = Mock(scalars=Mock(return_value=[notification]))
    count_mock = Mock(scalar_one=Mock(return_value=0))
    session.execute = AsyncMock(side_effect=[result_mock] * 5 + [count_mock])
    session.expire_all = Mock()

    svc = NotificationService(session, user)
    # Always returns True from _prune to simulate 5 consecutive prune steps
    svc._prune = AsyncMock(return_value=True)

    page = await svc.list(unread_only=False, limit=10, offset=0)
    assert page.items == []
    assert svc._prune.await_count == 5
