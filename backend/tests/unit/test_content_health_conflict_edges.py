"""Conflict candidate ordering and filtering before the AI comparison."""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest

from app.modules.graph.health import ContentHealthService


def _page(space, title, content="text"):
    return SimpleNamespace(
        id=uuid4(), space_id=space.id, space=space,
        title=title, slug=title.lower().replace(" ", "-"), content=content,
        updated_at=datetime(2026, 11, 1, tzinfo=UTC),
    )


@pytest.mark.asyncio
async def test_conflicts_skip_empty_space_and_filter_candidate_pairs() -> None:
    space = SimpleNamespace(id=uuid4(), key="ENG", name="Engineering")
    session = Mock(execute=AsyncMock())
    service = ContentHealthService(session)
    service.permissions.can_view_page = AsyncMock(return_value=True)
    user = SimpleNamespace(id=uuid4())
    assert await service._conflicts(space, [], user) == []

    first = _page(space, "Policy")
    blank = _page(space, "Blank", " ")
    copy = _page(space, "Policy (2)")
    other = _page(space, "Guidance")
    rows = [
        (first.id, first.id, "link", None),
        (first.id, other.id, "similar", 0.80),
        (first.id, other.id, "mention", None),
        (first.id, other.id, "link", None),
        (first.id, other.id, "similar", 0.89),
        (first.id, other.id, "similar", 0.95),
        (first.id, blank.id, "link", None),
        (first.id, copy.id, "link", None),
    ]
    session.execute.return_value = rows
    assert await service._conflicts(space, [first, blank, copy, other], user) == []

    session.execute.return_value = [(first.id, other.id, "link", None)]
    service.permissions.can_view_page.return_value = False
    assert await service._conflicts(space, [first, other], user) == []

    service.permissions.can_view_page.return_value = True
    conflicts = await service._conflicts(space, [first, other], user)
    assert len(conflicts) == 1
    assert conflicts[0].relation == "link"

    external_space = SimpleNamespace(id=uuid4(), key="OPS", name="Operations")
    external = _page(external_space, "External rules")
    session.execute.return_value = [(first.id, external.id, "link", None)]
    cross_space = await service._conflicts(space, [first, external], user)
    assert len(cross_space) == 1
    assert cross_space[0].page_a.id == first.id
