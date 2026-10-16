# ruff: noqa: F811
"""What the search indexer writes to the log, so a problem can be found and tuned.

The point of these logs is that an administrator can read *why* indexing stopped
and *how fast* it is going - and that nothing sensitive (the key, page text, what
people searched for) ever lands in them.
"""

from __future__ import annotations

import pytest

from app.modules.ai import embeddings
from app.modules.ai.embeddings import EmbeddingError, embed
from tests.unit.test_ai_embeddings import READY, _ok, _response, play  # noqa: F401 - fixture


class Recorder:
    """Stands in for a structlog logger and keeps ``(level, event, fields)``."""

    def __init__(self) -> None:
        self.events: list[tuple[str, str, dict]] = []

    def __getattr__(self, level: str):
        def record(event: str, **fields: object) -> None:
            self.events.append((level, event, fields))

        return record

    def named(self, event: str) -> list[tuple[str, dict]]:
        return [(level, fields) for level, name, fields in self.events if name == event]


@pytest.fixture
def log(monkeypatch: pytest.MonkeyPatch) -> Recorder:
    recorder = Recorder()
    monkeypatch.setattr(embeddings, "logger", recorder)
    return recorder


async def test_a_refused_request_logs_the_status_the_reply_and_the_gateway(
    play, log: Recorder
) -> None:
    play(_response(404, {"error": {"message": "no such route /embeddings"}}))

    with pytest.raises(EmbeddingError) as raised:
        await embed(READY, ["secret page text"])

    ((level, fields),) = log.named("ai_embedding_failed")
    assert level == "warning"
    assert fields["status"] == 404
    assert "no such route" in fields["detail"]
    assert fields["gateway"] == "gateway.test"
    assert fields["model"] == "embed-model"
    assert fields["will_retry"] is False
    assert fields["inputs"] == 1
    # The error carries the same facts for the indexer to log.
    assert raised.value.status == 404 and "no such route" in raised.value.detail
    # Neither the key nor the page text is ever written down.
    everything = repr(log.events)
    assert "secret page text" not in everything
    assert "Bearer" not in everything


async def test_a_busy_gateway_is_logged_as_will_retry_then_gives_up(play, log: Recorder) -> None:
    play(_response(503, {}), _response(503, {}), _response(503, {}))

    with pytest.raises(EmbeddingError):
        await embed(READY, ["a"])

    attempts = [(f["attempt"], f["will_retry"]) for _, f in log.named("ai_embedding_failed")]
    assert attempts == [(1, True), (2, True), (3, False)]


async def test_a_slow_request_is_a_warning_with_the_time_and_size(
    play, log: Recorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(embeddings, "SLOW_REQUEST_SECONDS", 0.0)
    play(_ok([[0.1, 0.2, 0.3]]))

    await embed(READY, ["a"])

    ((level, fields),) = log.named("ai_embedding_slow")
    assert level == "warning"
    assert fields["inputs"] == 1 and fields["dimensions"] == 3
    assert "seconds" in fields and fields["tokens"] is None


async def test_a_reply_with_the_wrong_number_of_vectors_is_logged(play, log: Recorder) -> None:
    play(_ok([[1.0]]))

    with pytest.raises(EmbeddingError):
        await embed(READY, ["a", "b"])

    ((_, fields),) = log.named("ai_embedding_bad_reply")
    assert (fields["asked"], fields["got"]) == (2, 1)


def test_the_gateway_is_logged_as_host_only() -> None:
    assert embeddings._host("https://user:pw@gw.example.com:8443/v1") == "gw.example.com:8443"
    assert embeddings._host("http://gateway.test/v1") == "gateway.test"
    assert embeddings._tokens({"usage": {"total_tokens": 12}}) == 12
    assert embeddings._tokens({"usage": {"total_tokens": True}}) is None
    assert embeddings._tokens([]) is None
