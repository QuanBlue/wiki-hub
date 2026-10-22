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


async def test_a_pasted_test_searches_and_answers_every_question(
    installed: AsyncSession, model: Model
) -> None:
    from app.modules.ai.skills import SEVERAL_QUESTIONS_RULES

    owner, space, pages = await _setup(installed)
    await _page(pages, space, owner, "Billing servers", "billing-1 10.0.0.5, billing-2 10.0.0.6")
    await _page(pages, space, owner, "Backup schedule", "Nightly backups run at 02:00 to MinIO")
    pasted = (
        "Help me answer these. Question 1\nWhere is billing-1?\n"
        + "Question 1 Answer\n10.0.0.5\n\n10.0.0.9\n\n" * 20  # past the 300 characters searched
        + "Question 2\nWhen do the nightly backups run?\nQuestion 2 Answer\n02:00\n\n14:00"
    )
    model.script = [["**Question 1** - 10.0.0.5 [1]. **Question 2** - 02:00 [2]."]]

    turn = await ChatService(installed, owner).begin(conversation(pasted))
    assert turn.max_tokens == LONG_REPLY_TOKENS
    events = await run(installed, owner, conversation(pasted))

    result = events[-1]["result"]
    # Each question found its own page, the second as well as the first.
    assert {s["title"] for s in result["sources"]} == {"Billing servers", "Backup schedule"}
    system, *_, asked = model.streams[-1]
    assert SEVERAL_QUESTIONS_RULES in system["content"]
    # The model reads the whole message, not the first 300 characters.
    assert "When do the nightly backups run?" in asked["content"]
