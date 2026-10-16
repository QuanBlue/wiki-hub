"""Embedding requests: batching, ordering and how each kind of failure is handled."""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from app.modules.ai import embeddings
from app.modules.ai.config import AIConfig
from app.modules.ai.embeddings import BATCH_SIZE, EmbeddingError, embed

READY = AIConfig(True, "http://gateway.test/v1/", "key", "chat", "embed-model")


def _response(status: int, payload: Any = None) -> httpx.Response:
    request = httpx.Request("POST", "http://gateway.test/v1/embeddings")
    return httpx.Response(status, json=payload, request=request)


def _ok(vectors: list[list[float]]) -> httpx.Response:
    return _response(
        200, {"data": [{"index": i, "embedding": v} for i, v in reversed(list(enumerate(vectors)))]}
    )


class _Script:
    """Plays a fixed list of outcomes, one per request, and remembers the bodies."""

    def __init__(self, outcomes: list[httpx.Response | Exception]) -> None:
        self.outcomes = list(outcomes)
        self.bodies: list[dict[str, Any]] = []
        self.headers: list[dict[str, str]] = []

    def client(self, **_: Any) -> _Script:
        return self

    async def __aenter__(self) -> _Script:
        return self

    async def __aexit__(self, *_: object) -> None:
        return None

    async def post(
        self, url: str, *, json: dict[str, Any], headers: dict[str, str]
    ) -> httpx.Response:
        assert url == "http://gateway.test/v1/embeddings"
        self.bodies.append(json)
        self.headers.append(headers)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


@pytest.fixture
def play(monkeypatch: pytest.MonkeyPatch):
    sleeps: list[float] = []

    async def no_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr(embeddings.asyncio, "sleep", no_sleep)

    def install(*outcomes: httpx.Response | Exception) -> _Script:
        script = _Script(list(outcomes))
        monkeypatch.setattr(embeddings.httpx, "AsyncClient", script.client)
        script.sleeps = sleeps  # type: ignore[attr-defined]
        return script

    return install


async def test_vectors_come_back_in_input_order(play) -> None:
    script = play(_ok([[1.0, 0.0], [0.0, 1.0]]))

    assert await embed(READY, ["a", "b"]) == [[1.0, 0.0], [0.0, 1.0]]
    assert script.bodies == [{"model": "embed-model", "input": ["a", "b"]}]
    assert script.headers == [{"Authorization": "Bearer key"}]


async def test_long_input_is_sent_in_batches(play) -> None:
    texts = [f"t{i}" for i in range(BATCH_SIZE + 1)]
    script = play(_ok([[1.0]] * BATCH_SIZE), _ok([[2.0]]))

    vectors = await embed(READY, texts)

    assert len(vectors) == BATCH_SIZE + 1
    assert [len(body["input"]) for body in script.bodies] == [BATCH_SIZE, 1]


async def test_nothing_to_embed_without_a_model() -> None:
    with pytest.raises(EmbeddingError, match="No embedding model"):
        await embed(AIConfig(True, "http://g", "k", "m"), ["a"])


async def test_an_empty_list_makes_no_request(play) -> None:
    script = play()

    assert await embed(READY, []) == []
    assert script.bodies == []


@pytest.mark.parametrize(
    "outcome",
    [_ok([[1.0]]), _ok([[]])],
    ids=["wrong count", "empty vector"],
)
async def test_an_unexpected_reply_is_not_retried(play, outcome: httpx.Response) -> None:
    script = play(outcome)

    with pytest.raises(EmbeddingError, match="unexpected number") as caught:
        await embed(READY, ["a", "b"])
    assert caught.value.permanent is False
    assert len(script.bodies) == 1


async def test_a_busy_gateway_is_retried_then_succeeds(play) -> None:
    script = play(_response(503), httpx.ConnectError("down"), _ok([[1.0]]))

    assert await embed(READY, ["a"]) == [[1.0]]
    assert len(script.bodies) == 3
    assert len(script.sleeps) == 2  # type: ignore[attr-defined]


async def test_gives_up_after_the_retries(play) -> None:
    attempts = len(embeddings._BACKOFF) + 1
    script = play(*[httpx.ReadTimeout("slow") for _ in range(attempts)])

    with pytest.raises(EmbeddingError, match="ReadTimeout") as caught:
        await embed(READY, ["a"])
    assert caught.value.permanent is False
    assert len(script.bodies) == attempts


async def test_a_rejected_input_is_permanent(play) -> None:
    script = play(_response(400))

    with pytest.raises(EmbeddingError, match="HTTP 400") as caught:
        await embed(READY, ["a"])
    assert caught.value.permanent is True
    assert len(script.bodies) == 1


@pytest.mark.parametrize("status", [401, 403])
async def test_a_refused_key_is_not_permanent(play, status: int) -> None:
    play(_response(status))

    with pytest.raises(EmbeddingError) as caught:
        await embed(READY, ["a"])
    assert caught.value.permanent is False


async def test_a_malformed_reply_fails_once(play) -> None:
    script = play(_response(200, {"unexpected": []}))

    with pytest.raises(EmbeddingError, match="KeyError"):
        await embed(READY, ["a"])
    assert len(script.bodies) == 1


async def test_a_batch_that_times_out_is_split_until_the_gateway_can_manage_it(play) -> None:
    """A slow CPU-bound gateway: 4 passages time out, 2 at a time succeed."""
    script = play(
        httpx.ReadTimeout("slow"),  # all 4
        _ok([[1.0], [2.0]]),  # the first half
        _ok([[3.0], [4.0]]),  # the second half
    )

    assert await embed(READY, ["a", "b", "c", "d"]) == [[1.0], [2.0], [3.0], [4.0]]
    assert [len(body["input"]) for body in script.bodies] == [4, 2, 2]


async def test_splitting_goes_down_to_single_passages_and_then_gives_up(play) -> None:
    attempts = len(embeddings._BACKOFF) + 1
    script = play(
        httpx.ReadTimeout("slow"),  # both
        *[httpx.ReadTimeout("slow") for _ in range(attempts)],  # "a" alone, retried
    )

    with pytest.raises(EmbeddingError) as caught:
        await embed(READY, ["a", "b"])

    assert caught.value.timed_out is True
    assert [len(body["input"]) for body in script.bodies][:2] == [2, 1]
