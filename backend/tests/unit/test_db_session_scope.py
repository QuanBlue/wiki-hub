"""The request's transaction must be committed *before* its response is sent.

FastAPI runs the exit half of a ``yield`` dependency after the response has been
sent unless it is declared ``scope="function"``. ``get_db`` commits there, so an
endpoint that created a row (``POST /confluence-imports/uploads``) answered 201
while its transaction was still committing, and the client's very next request
(``.../upload-parts``) could arrive first and get a 404 for a row it had just
been told about. On a slow disk that is most requests.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI

from app.api import deps


class _RecordingSession:
    def __init__(self, events: list[str]) -> None:
        self._events = events

    async def __aenter__(self) -> _RecordingSession:
        return self

    async def __aexit__(self, *_exc: object) -> None:
        self._events.append("close")

    async def commit(self) -> None:
        self._events.append("commit")

    async def rollback(self) -> None:
        self._events.append("rollback")


async def _call(app: FastAPI, events: list[str]) -> None:
    """Drive one request through the ASGI app, noting when the response starts."""
    scope: dict[str, Any] = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "path": "/create",
        "raw_path": b"/create",
        "query_string": b"",
        "headers": [],
        "server": ("test", 80),
        "client": ("test", 1),
        "scheme": "http",
    }

    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: dict[str, Any]) -> None:
        if message["type"] == "http.response.start":
            events.append("response-start")

    await app(scope, receive, send)


def _app_with_db_endpoint(monkeypatch: pytest.MonkeyPatch, events: list[str]) -> FastAPI:
    monkeypatch.setattr(deps, "get_session_factory", lambda: lambda: _RecordingSession(events))
    app = FastAPI()

    @app.post("/create")
    async def create(_session: deps.DbSession) -> dict[str, bool]:
        events.append("handler")
        return {"ok": True}

    return app


async def test_transaction_is_committed_before_the_response_is_sent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    await _call(_app_with_db_endpoint(monkeypatch, events), events)

    assert "commit" in events and "response-start" in events
    assert events.index("handler") < events.index("commit") < events.index("response-start"), events


async def test_a_failing_handler_still_rolls_back_and_never_commits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    monkeypatch.setattr(deps, "get_session_factory", lambda: lambda: _RecordingSession(events))
    app = FastAPI()

    @app.post("/create")
    async def create(_session: deps.DbSession) -> None:
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError):
        await _call(app, events)

    assert "rollback" in events
    assert "commit" not in events
