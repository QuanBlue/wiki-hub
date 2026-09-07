import base64
import json
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest

from app.core.exceptions import BadRequestError
from app.modules.pages.service import PageService


def _activity_page(*, updated_at: datetime) -> SimpleNamespace:
    author = SimpleNamespace(username="alice", full_name="Alice")
    return SimpleNamespace(
        id=uuid4(),
        title="Title",
        slug="title",
        space=SimpleNamespace(key="ENG", name="Engineering"),
        created_at=updated_at,
        updated_at=updated_at,
        created_by=author,
        updated_by=author,
    )


def _activity_service() -> PageService:
    service = PageService(Mock())
    service.pages = Mock()
    service.spaces.permissions = Mock()
    return service


def test_user_activity_cursor_round_trips_and_is_bound_to_member() -> None:
    member_id = uuid4()
    page = SimpleNamespace(
        id=uuid4(),
        updated_at=datetime(2026, 8, 30, 12, 0, tzinfo=UTC),
    )

    cursor = PageService._encode_activity_cursor(page, member_id)

    assert PageService._decode_activity_cursor(cursor, member_id) == (
        page.updated_at,
        page.id,
    )
    with pytest.raises(BadRequestError):
        PageService._decode_activity_cursor(cursor, uuid4())


def test_user_activity_cursor_rejects_malformed_values() -> None:
    with pytest.raises(BadRequestError):
        PageService._decode_activity_cursor("not-a-valid-cursor", uuid4())


def test_user_activity_cursor_rejects_a_naive_timestamp() -> None:
    member_id = uuid4()
    # A hand-built payload with no UTC offset on updated_at - the encoder
    # never produces one (page.updated_at is always tz-aware), so this only
    # happens for a cursor forged or corrupted outside that path.
    payload = json.dumps(
        {
            "user_id": str(member_id),
            "updated_at": "2026-08-30T12:00:00",
            "page_id": str(uuid4()),
        },
        separators=(",", ":"),
    ).encode("utf-8")
    cursor = base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")

    with pytest.raises(BadRequestError):
        PageService._decode_activity_cursor(cursor, member_id)


@pytest.mark.asyncio
async def test_list_user_activity_stops_early_and_encodes_a_resume_cursor() -> None:
    service = _activity_service()
    member = SimpleNamespace(id=uuid4())
    viewer = SimpleNamespace(id=uuid4())
    pages = [
        _activity_page(updated_at=datetime(2026, 8, 30, 12, 0, 0, tzinfo=UTC)),
        _activity_page(updated_at=datetime(2026, 8, 30, 11, 0, 0, tzinfo=UTC)),
        _activity_page(updated_at=datetime(2026, 8, 30, 10, 0, 0, tzinfo=UTC)),
    ]
    service.pages.list_updated_by = AsyncMock(return_value=pages)
    service.spaces.permissions.can_view_page = AsyncMock(return_value=True)

    items, cursor = await service.list_user_activity(viewer, member, limit=2)

    assert [item.id for item in items] == [pages[0].id, pages[1].id]
    assert cursor is not None
    decoded = PageService._decode_activity_cursor(cursor, member.id)
    assert decoded == (pages[1].updated_at, pages[1].id)


@pytest.mark.asyncio
async def test_list_user_activity_returns_everything_when_fewer_than_a_full_batch() -> None:
    service = _activity_service()
    member = SimpleNamespace(id=uuid4())
    viewer = SimpleNamespace(id=uuid4())
    pages = [
        _activity_page(updated_at=datetime(2026, 8, 30, 12, 0, 0, tzinfo=UTC)),
        _activity_page(updated_at=datetime(2026, 8, 30, 11, 0, 0, tzinfo=UTC)),
    ]
    service.pages.list_updated_by = AsyncMock(return_value=pages)
    service.spaces.permissions.can_view_page = AsyncMock(return_value=True)

    items, cursor = await service.list_user_activity(viewer, member, limit=5)

    assert [item.id for item in items] == [pages[0].id, pages[1].id]
    assert cursor is None
    assert service.pages.list_updated_by.await_count == 1


@pytest.mark.asyncio
async def test_list_user_activity_advances_past_a_batch_with_nothing_visible() -> None:
    service = _activity_service()
    member = SimpleNamespace(id=uuid4())
    viewer = SimpleNamespace(id=uuid4())
    full_batch = [
        _activity_page(updated_at=datetime(2026, 8, 30, 12, 0, 0, tzinfo=UTC))
        for _ in range(50)
    ]
    service.pages.list_updated_by = AsyncMock(side_effect=[full_batch, []])
    service.spaces.permissions.can_view_page = AsyncMock(return_value=False)

    items, cursor = await service.list_user_activity(viewer, member, limit=1)

    assert items == []
    assert cursor is None
    assert service.pages.list_updated_by.await_count == 2
