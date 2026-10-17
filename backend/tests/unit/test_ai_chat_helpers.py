"""How a conversation is cleaned up before the model reads it, and how a reply is judged."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.core.exceptions import ServiceUnavailableError
from app.modules.ai import chat as chat_module
from app.modules.ai.chat import ChatService, _history, finish
from app.modules.ai.client import ChatReply
from app.modules.ai.config import AIConfig
from app.schemas.ai import AnswerSource, ChatMessage, WebSource


def turns(*pairs: tuple[str, str]) -> list[ChatMessage]:
    return [ChatMessage(role=role, content=content) for role, content in pairs]  # type: ignore[arg-type]


# ---------------------------------------------------------------- the earlier turns


def test_a_turn_that_is_nothing_once_cleaned_is_left_out() -> None:
    history = _history(turns(("user", "hello"), ("assistant", "[1]"), ("user", "and now?")))

    # The answer was only a citation mark: nothing of it remains, and the two questions join.
    assert history == [{"role": "user", "content": "hello\n\nand now?"}]


def test_two_turns_by_the_same_side_in_a_row_become_one() -> None:
    history = _history(turns(("user", "first"), ("user", "second"), ("assistant", "ok [1]")))

    assert history == [
        {"role": "user", "content": "first\n\nsecond"},
        {"role": "assistant", "content": "ok"},
    ]


def test_a_conversation_never_starts_with_an_answer() -> None:
    assert _history(turns(("assistant", "stray"), ("user", "question"))) == [
        {"role": "user", "content": "question"}
    ]


# ---------------------------------------------------------------- judging a reply

WIKI = [
    AnswerSource(
        n=1,
        id="00000000-0000-0000-0000-000000000001",
        title="Page",
        slug="page",
        space_key="OPS",
        space_name="Ops",
        excerpt="x",
    )
]
WEB = [WebSource(n=1, title="Doc", url="https://d.example", host="d.example", snippet="s")]


def test_a_general_answer_that_is_only_a_mark_is_not_an_answer() -> None:
    result = finish(" [1] ", "general", WIKI, [])

    assert result.found is False and result.reason == "ungrounded"


def test_a_reply_that_is_nothing_once_checked_is_not_an_answer() -> None:
    result = finish("   ", "answer", WIKI, WEB)

    assert result.found is False and result.reason == "ungrounded"


# ---------------------------------------------------------------- understanding a follow-up


async def test_a_rewrite_too_short_to_search_with_is_replaced_by_the_questions_as_asked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def reply(
        config: AIConfig,
        messages: list[dict[str, str]],
        *,
        max_tokens: int,
        temperature: float = 0.2,
    ):
        return ChatReply("x", None)

    monkeypatch.setattr(chat_module, "chat_with_usage", reply)
    service = ChatService(None, SimpleNamespace(id="u1"))  # type: ignore[arg-type]

    query = await service._standalone(
        AIConfig(True, "http://g/v1", "k", "m"),
        turns(("user", "what is billing"), ("assistant", "A server [1].")),
        "and its address?",
    )

    assert "billing" in query and "address" in query


async def test_a_rewrite_that_fails_is_replaced_by_the_questions_as_asked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def broken(
        config: AIConfig,
        messages: list[dict[str, str]],
        *,
        max_tokens: int,
        temperature: float = 0.2,
    ):
        raise ServiceUnavailableError("down")

    monkeypatch.setattr(chat_module, "chat_with_usage", broken)
    service = ChatService(None, SimpleNamespace(id="u1"))  # type: ignore[arg-type]

    query = await service._standalone(
        AIConfig(True, "http://g/v1", "k", "m"),
        turns(("user", "what is billing"), ("assistant", "A server [1].")),
        "and its address?",
    )

    assert "billing" in query


def test_a_unit_before_the_end_of_bold_text_is_not_taken_for_a_password() -> None:
    # Seen live: "gió **10.7 km/h**, lượng mưa" lost "h**," to [hidden] and left the bold open.
    from app.modules.ai.answer import scrub_secrets

    text = "gió **10.7 km/h**, lượng mưa 0.1 mm"
    assert scrub_secrets(text) == text
    # A real user/password pair, with a symbol in the password, is still hidden.
    assert "P@ssw0rd" not in scrub_secrets("account admin/P@ssw0rd! for the server")


def test_the_rewrite_is_told_to_write_abbreviations_out() -> None:
    from app.modules.ai.chat import _REWRITE_RULES
    from app.modules.ai.skills import CONVERSATION_RULES

    assert "tp Hcm" in _REWRITE_RULES and "abbreviations" in _REWRITE_RULES
    assert "tp Hcm" in CONVERSATION_RULES


def test_a_highlight_after_a_secret_looking_word_is_not_a_secret() -> None:
    from app.modules.ai.answer import scrub_secrets

    assert scrub_secrets("Mở ==Account > Password==.") == "Mở ==Account > Password==."
    assert "hunter2" not in scrub_secrets("password=hunter2 and token: abc123")
