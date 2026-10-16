# ruff: noqa: F811
"""Asking the wiki a question when the cache misbehaves: it is only a convenience."""

from __future__ import annotations

import pytest
from redis.exceptions import RedisError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.ai import answer as answer_module
from tests.integration.test_ai_answer import (  # noqa: F401 - fixtures and helpers
    Gateway,
    _page,
    _setup,
    ask,
    gateway,
)
from tests.integration.test_hybrid_semantic_search import installed  # noqa: F401

pytestmark = pytest.mark.integration


class BrokenCache:
    """Reads fail; writes fail."""

    async def get(self, key: str) -> str:
        raise RedisError("down")

    async def set(self, *args: object, **kwargs: object) -> None:
        raise RedisError("down")


class PoisonedCache:
    """Holds something that is not an answer."""

    async def get(self, key: str) -> str:
        return "this is not json"

    async def set(self, *args: object, **kwargs: object) -> None:
        return None


async def test_a_cache_that_is_down_costs_a_model_call_but_never_the_answer(
    installed: AsyncSession, gateway: Gateway, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, space, pages = await _setup(installed)
    await _page(pages, space, owner, "Billing server", "The address of billing is 10.0.0.5")
    monkeypatch.setattr(answer_module, "get_redis", lambda: BrokenCache())

    first = await ask(installed, owner, "address of the billing server")
    second = await ask(installed, owner, "address of the billing server")

    assert first.found and second.found and not second.cached
    assert len(gateway.calls) == 2


async def test_a_saved_answer_that_cannot_be_read_is_asked_again(
    installed: AsyncSession, gateway: Gateway, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, space, pages = await _setup(installed)
    await _page(pages, space, owner, "Billing server", "The address of billing is 10.0.0.5")
    monkeypatch.setattr(answer_module, "get_redis", lambda: PoisonedCache())

    result = await ask(installed, owner, "address of the billing server")

    assert result.found and result.cached is False and len(gateway.calls) == 1
