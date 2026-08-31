from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.core.exceptions import BadRequestError
from app.modules.pages.service import PageService


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
