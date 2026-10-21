"""How long a search waits for the question's vector, and when it does not wait at all."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from app.modules.search import service


class FakeRedis:
    def __init__(self, keys: dict[str, str] | None = None) -> None:
        self.data: dict[str, str] = dict(keys or {})

    async def get(self, key: str) -> str | None:
        return self.data.get(key)

    async def set(self, key: str, value: str, **_: object) -> None:
        self.data[key] = value

    async def exists(self, key: str) -> int:
        return int(key in self.data)


def config(source: str = "ollama") -> SimpleNamespace:
    return SimpleNamespace(
        embedding_model="bge-m3",
        embedding_source=source,
        tuning=SimpleNamespace(query_timeout_seconds=4.0),
    )


@pytest.fixture
def waits(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    """The timeouts searches were given; the model never answers in time."""
    seen: list[float] = []

    async def wait_for(awaitable, timeout: float):  # type: ignore[no-untyped-def]  # noqa: ASYNC109 - stands in for asyncio.wait_for
        seen.append(timeout)
        awaitable.close()
        raise TimeoutError

    monkeypatch.setattr(service.asyncio, "wait_for", wait_for)

    async def embed(cfg, texts):  # type: ignore[no-untyped-def]
        await asyncio.sleep(0)
        return [[0.1]]

    monkeypatch.setattr(service, "embed", embed)
    return seen


async def test_an_idle_self_hosted_model_is_given_time_to_load(
    monkeypatch: pytest.MonkeyPatch, waits: list[float]
) -> None:
    redis = FakeRedis()
    monkeypatch.setattr(service, "get_redis", lambda: redis)

    assert await service._embed_query(config(), "devops") is None

    assert waits == [service._OLLAMA_COLD_START_SECONDS]


async def test_while_pages_are_indexed_the_busy_model_gets_the_short_wait(
    monkeypatch: pytest.MonkeyPatch, waits: list[float]
) -> None:
    redis = FakeRedis({service.SEARCH_INDEX_LOCK: "token"})
    monkeypatch.setattr(service, "get_redis", lambda: redis)

    assert await service._embed_query(config(), "devops") is None

    assert waits == [4.0]


async def test_after_a_timeout_the_next_searches_do_not_wait_at_all(
    monkeypatch: pytest.MonkeyPatch, waits: list[float]
) -> None:
    redis = FakeRedis()
    monkeypatch.setattr(service, "get_redis", lambda: redis)

    await service._embed_query(config(), "devops")
    assert service._EMBED_BACKOFF_KEY in redis.data
    await service._embed_query(config(), "grafana")
    await service._embed_query(config(), "k3s")

    # Only the first search waited; the others went straight to keywords.
    assert len(waits) == 1


async def test_a_vector_already_worked_out_is_used_even_while_backing_off(
    monkeypatch: pytest.MonkeyPatch, waits: list[float]
) -> None:
    redis = FakeRedis({service._EMBED_BACKOFF_KEY: "1"})
    monkeypatch.setattr(service, "get_redis", lambda: redis)
    digest = __import__("hashlib").sha256(b"bge-m3\ndevops").hexdigest()
    redis.data[f"search:qvec:{digest}"] = "[0.5, 0.5]"

    assert await service._embed_query(config(), "devops") == [0.5, 0.5]
    assert waits == []
