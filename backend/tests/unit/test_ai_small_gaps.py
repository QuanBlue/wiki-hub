"""Small branches of the AI modules: limits that cannot be read, plans with odd steps, an
account with an archived space, a key that every try is taken."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from sqlalchemy.exc import SQLAlchemyError

from app.modules.ai import actions, assistant_context, limits

# -- limits -----------------------------------------------------------------------------


async def test_an_unmigrated_database_gives_the_default_limits() -> None:
    session = Mock()
    session.execute = AsyncMock(side_effect=SQLAlchemyError("no such column"))
    session.rollback = AsyncMock()

    assert await limits.read(session) == limits.Limits(None, None)
    session.rollback.assert_awaited_once()


async def test_limits_that_cannot_be_read_never_stop_a_question(monkeypatch) -> None:
    async def broken() -> limits.Limits:
        raise RuntimeError("the database is down")

    monkeypatch.setattr(limits, "current", broken)

    assert await limits.ai_rate_limit() == limits.settings.ai_rate_limit
    assert await limits.ai_translate_rate_limit() == limits.settings.ai_translate_rate_limit


# -- the account the assistant reads -----------------------------------------------------


def _space(name: str, *, status: str = "active", owner: bool = False):
    return SimpleNamespace(
        name=name,
        key=name.upper(),
        description="",
        visibility=SimpleNamespace(value="open"),
        status=SimpleNamespace(value=status),
        is_owner=owner,
        my_role=None,
    )


def test_an_archived_space_is_said_to_be_and_a_full_list_says_there_may_be_more() -> None:
    user = SimpleNamespace(full_name="Ann", username="ann", is_superuser=False)
    viewer = assistant_context.Viewer(user, frozenset())  # type: ignore[arg-type]
    spaces = [_space("Old", status="archived")] + [
        _space(f"Space {n}") for n in range(assistant_context.MAX_SPACES - 1)
    ]

    block = assistant_context.account_block(viewer, spaces)  # type: ignore[arg-type]

    assert "archived" in block
    assert f"only the first {assistant_context.MAX_SPACES} are listed" in block


# -- a space key every try is taken ------------------------------------------------------


async def test_a_key_that_is_taken_thirty_times_gets_a_random_ending(monkeypatch) -> None:
    taken = SimpleNamespace(spaces=SimpleNamespace(get_by_key=AsyncMock(return_value=object())))
    monkeypatch.setattr(actions, "SpaceService", Mock(return_value=taken))

    key = await actions._free_key(Mock(), "BILLING")

    assert key.startswith("BILLING_") and len(key) == len("BILLING_") + 6


def test_text_with_broken_json_is_no_plan() -> None:
    assert actions._json_of("say {not json} now") is None
    assert actions._json_of("no braces at all") is None
    assert actions._json_of('{"a": 1}') == {"a": 1}
    assert actions._json_of("[1, 2]") is None


# -- the decision of where a question goes ------------------------------------------------


async def test_a_redis_that_is_down_or_a_decision_kept_in_a_broken_form_is_asked_afresh(
    monkeypatch,
) -> None:
    import uuid

    from redis.exceptions import RedisError

    from app.modules.ai import reviewer
    from app.modules.ai.client import ChatReply

    async def decide(config, messages, **kwargs):
        return ChatReply("SEARCH: haproxy reload", None)

    monkeypatch.setattr(reviewer, "chat_with_usage", decide)
    ask = {
        "config": Mock(),
        "user_id": uuid.uuid4(),
        "question": "q",
        "standalone": "q",
        "titles": [],
    }

    down = Mock()
    down.get = AsyncMock(side_effect=RedisError("down"))
    down.set = AsyncMock(side_effect=RedisError("down"))
    monkeypatch.setattr(reviewer, "get_redis", lambda: down)
    verdict, asked = await reviewer.route(**ask)
    assert asked and verdict.kind == "search"

    broken = Mock()
    broken.get = AsyncMock(return_value='{"text": "no kind"}')
    broken.set = AsyncMock()
    monkeypatch.setattr(reviewer, "get_redis", lambda: broken)
    verdict, asked = await reviewer.route(**ask)
    assert asked and verdict.kind == "search"


# -- the Help the assistant reads ---------------------------------------------------------


def test_a_help_copy_that_is_missing_is_left_out(monkeypatch, tmp_path) -> None:
    from app.modules.ai import help_knowledge

    help_knowledge._index.cache_clear()
    monkeypatch.setattr(help_knowledge, "_ASSETS", tmp_path)
    try:
        assert help_knowledge._index() == ([], {})
    finally:
        help_knowledge._index.cache_clear()
