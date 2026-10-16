"""AI route handlers: each hands its arguments to the service and returns the answer."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, Mock

import pytest

from app.api.v1 import ai


def _service(**methods: object) -> Mock:
    service = Mock()
    for name, result in methods.items():
        setattr(service, name, AsyncMock(return_value=result))
    return service


def test_the_ai_service_is_built_for_the_signed_in_user() -> None:
    session, user = Mock(), Mock()
    service = ai.get_ai_service(session, user)
    assert service.session is session and service.user is user


@pytest.mark.asyncio
async def test_summarize_page_forwards_refresh_and_language() -> None:
    service = _service(summarize_page="summary")
    assert await ai.summarize_page("ENG", "home", service, refresh=True, lang="vi") == "summary"
    service.summarize_page.assert_awaited_once_with("ENG", "home", refresh=True, lang="vi")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("handler", "method", "args"),
    [
        (ai.suggest_for_page, "suggest_for_page", ("ENG", "home")),
        (ai.assist_writing, "assist_writing", ("ENG", "payload")),
        (ai.explain_selection, "explain_selection", ("ENG", "home", "payload")),
        (ai.clarify_page, "clarify_page", ("ENG", "payload")),
        (ai.draft_page, "draft_page", ("ENG", "payload")),
    ],
)
async def test_page_handlers_hand_over_to_the_service(handler, method, args) -> None:
    service = _service(**{method: "answer"})
    assert await handler(*args, service) == "answer"
    getattr(service, method).assert_awaited_once_with(*args)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("handler", "method", "args"),
    [
        (ai.test_connection, "test", ("payload",)),
        (ai.check_connection, "check", (uuid.uuid4(),)),
        (ai.activate_connection, "activate", (uuid.uuid4(),)),
        (ai.deactivate_connection, "deactivate", (uuid.uuid4(),)),
        (ai.update_connection, "update", (uuid.uuid4(), "payload")),
    ],
)
async def test_connection_handlers_hand_over_to_the_service(handler, method, args) -> None:
    service = _service(**{method: "answer"})
    assert await handler(*args, service) == "answer"
    getattr(service, method).assert_awaited_once_with(*args)


def test_a_list_item_that_opens_with_a_nested_list_has_no_leading_text() -> None:
    from bs4 import BeautifulSoup

    from app.modules.ai.draft_html import _first_text, _leading_mark

    soup = BeautifulSoup("<li><ul><li>x</li></ul></li><li></li>", "html.parser")
    nested, empty = soup.find_all("li", recursive=False)
    assert _first_text(nested) is None
    assert _first_text(empty) is None
    assert _leading_mark(nested) is None
