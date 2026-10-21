# ruff: noqa: F811
"""Long answers: room for a whole list, a note when one is cut short, and "you only listed 22 of
33" answered from the previous question rather than searched on its own words."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.ai.chat import LONG_REPLY_TOKENS, ChatService
from app.modules.ai.client import CUT_OFF
from app.modules.ai.skills import CONTINUE_RULES, DETAIL_TOKENS
from tests.integration.test_ai_chat import (  # noqa: F401 - fixtures
    Model,
    _setup,
    conversation,
    installed,
    model,
    run,
)
from tests.integration.test_hybrid_semantic_search import _page

pytestmark = pytest.mark.integration


async def test_a_whole_list_gets_room_and_a_cut_answer_says_so(
    installed: AsyncSession, model: Model
) -> None:
    owner, space, pages = await _setup(installed)
    await _page(pages, space, owner, "Billing servers", "billing-1 10.0.0.5, billing-2 10.0.0.6")

    turn = await ChatService(installed, owner).begin(
        conversation("liệt kê đầy đủ các billing server")
    )
    assert turn.max_tokens == LONG_REPLY_TOKENS
    plain = await ChatService(installed, owner).begin(conversation("billing server address"))
    assert plain.max_tokens == DETAIL_TOKENS["normal"]

    # The model ran out of room mid-list: the answer says so and how to get the rest.
    model.script = [["Billing servers: billing-1 [1], ", "billing-2 [1], billing-", CUT_OFF]]
    events = await run(installed, owner, conversation("liệt kê đầy đủ các billing server"))
    answer = events[-1]["result"]["answer"]
    assert answer.startswith("Billing servers: billing-1")
    assert "tiếp tục" in answer
    assert any(e["type"] == "delta" and "tiếp tục" in e["text"] for e in events)


async def test_a_complaint_about_the_last_answer_searches_the_question_before_it(
    installed: AsyncSession, model: Model
) -> None:
    owner, space, pages = await _setup(installed)
    await _page(pages, space, owner, "Billing servers", "billing-1 10.0.0.5, billing-2 10.0.0.6")
    model.rewrite = "why only one"  # what the complaint's own words would search: nothing
    model.script = [["billing-2 is at 10.0.0.6 [1]; there are 2 in all."]]

    events = await run(
        installed,
        owner,
        conversation(
            "billing servers",
            "billing-1 is at 10.0.0.5.",
            "sao tôi thấy 2 server mà chỉ liệt kê mỗi 1 server",
        ),
    )

    result = events[-1]["result"]
    assert result["found"] is True
    assert [s["title"] for s in result["sources"]] == ["Billing servers"]
    system = model.streams[-1][0]["content"]
    assert CONTINUE_RULES in system
