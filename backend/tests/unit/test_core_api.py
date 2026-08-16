from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import PlainTextResponse

from app.api import deps, errors, health
from app.core.exceptions import (
    AuthenticationError,
    PermissionDeniedError,
    ServiceUnavailableError,
    WikiHubError,
)
from app.core.middleware import RequestContextMiddleware, SecurityHeadersMiddleware


def _request(path: str = "/test", headers: list[tuple[bytes, bytes]] | None = None) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": path,
            "headers": headers or [],
            "client": ("127.0.0.1", 1234),
            "scheme": "http",
            "query_string": b"",
        }
    )


def test_error_response_and_registered_handlers() -> None:
    app = FastAPI()
    errors.register_exception_handlers(app)
    errors.request_id_ctx.set("req-1")

    response = errors.error_response(400, "bad_request", "Nope", {"x": 1})
    assert response.status_code == 400
    assert json.loads(response.body)["error"]["request_id"] == "req-1"

    domain = app.exception_handlers[WikiHubError]
    domain_response = asyncio.run(domain(_request(), AuthenticationError("bad")))
    assert domain_response.status_code == 401
    assert asyncio.run(domain(_request(), ServiceUnavailableError("down"))).status_code == 503

    validation = RequestValidationError(
        [{"loc": ("body", "name"), "msg": "required", "type": "missing"}]
    )
    validation_response = asyncio.run(
        app.exception_handlers[RequestValidationError](_request(), validation)
    )
    assert json.loads(validation_response.body)["error"]["details"]["fields"][0]["field"] == "name"

    http_response = asyncio.run(
        app.exception_handlers[StarletteHTTPException](
            _request(),
            StarletteHTTPException(418, detail={"ignored": True}, headers={"x-test": "1"}),
        )
    )
    assert http_response.status_code == 418
    assert http_response.headers["x-test"] == "1"

    unhandled = asyncio.run(app.exception_handlers[Exception](_request(), RuntimeError("secret")))
    assert unhandled.status_code == 500
    assert "secret" not in unhandled.body.decode()


@pytest.mark.asyncio
async def test_health_probes_and_readiness(monkeypatch: pytest.MonkeyPatch) -> None:
    assert await health._run("ok", lambda: _ok()) == ("ok", "ok")
    assert await health._run("error", lambda: _fail()) == ("error", "error")
    assert await health._run("timeout", lambda: _slow()) == ("timeout", "timeout")

    session = AsyncMock()
    session_factory = Mock(return_value=AsyncMock(__aenter__=AsyncMock(return_value=session)))
    monkeypatch.setattr(health, "get_session_factory", Mock(return_value=session_factory))
    monkeypatch.setattr(health, "get_redis", Mock(return_value=SimpleNamespace(ping=AsyncMock())))
    monkeypatch.setattr(
        health,
        "get_storage",
        Mock(return_value=SimpleNamespace(health=AsyncMock(return_value=True))),
    )
    assert await health._check_database() == "ok"
    assert await health._check_redis() == "ok"
    assert await health._check_storage() == "ok"

    response = Response()
    ready = await health.ready(response)
    assert ready.status == "ok"
    assert response.status_code == 200

    monkeypatch.setattr(health, "_check_redis", AsyncMock(side_effect=OSError("down")))
    response = Response()
    ready = await health.ready(response)
    assert ready.status == "degraded"
    assert response.status_code == 503


async def _ok() -> str:
    return "ok"


async def _fail() -> str:
    raise RuntimeError("down")


async def _slow() -> str:
    await asyncio.sleep(health._PROBE_TIMEOUT + 0.01)
    return "ok"


@pytest.mark.asyncio
async def test_request_and_security_middleware_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    middleware = RequestContextMiddleware(lambda *_args: None)
    response = await middleware.dispatch(
        _request(headers=[(b"x-request-id", b"incoming")]), _call_next
    )
    assert response.headers["x-request-id"] == "incoming"

    response = await middleware.dispatch(_request("/health"), _call_next)
    assert response.status_code == 200
    response = await middleware.dispatch(
        _request(headers=[(b"x-request-id", b"x" * 129)]), _call_next
    )
    assert response.headers["x-request-id"]

    sent: list[dict] = []

    async def app(scope, receive, send):
        await send(
            {
                "type": "http.response.start",
                "status": 200,
                "headers": [(b"x-frame-options", b"custom")],
            }
        )
        await send({"type": "http.response.body", "body": b"ok"})

    async def capture(message):
        sent.append(message)

    secured = SecurityHeadersMiddleware(app)
    scope = {"type": "http", "path": "/api"}
    await secured(scope, Mock(), capture)
    start = sent[0]
    headers = dict(start["headers"])
    assert headers[b"x-frame-options"] == b"custom"
    assert headers[b"x-content-type-options"] == b"nosniff"
    assert b"content-security-policy" in headers

    docs_sent: list[dict] = []

    async def capture_docs(message):
        docs_sent.append(message)

    await secured({"type": "http", "path": "/docs"}, Mock(), capture_docs)
    assert b"content-security-policy" not in dict(docs_sent[0]["headers"])

    non_http: list[dict] = []

    async def capture_non_http(message):
        non_http.append(message)

    await secured({"type": "lifespan"}, Mock(), capture_non_http)
    assert non_http


def _response() -> Response:
    return PlainTextResponse("ok")


async def _call_next(_request: Request) -> Response:
    return _response()


def test_dependency_token_and_client_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    request = _request(headers=[(b"authorization", b"Bearer token"), (b"user-agent", b"agent")])
    assert deps._extract_token(request) == "token"
    assert deps.get_client_info(request).ip == "127.0.0.1"

    cookie_request = _request(headers=[(b"cookie", b"wikihub_access=cookie")])
    assert deps._extract_token(cookie_request) == "cookie"
    assert deps._extract_token(_request()) is None

    service = Mock(get_active_user=AsyncMock(return_value="user"), session=Mock())
    monkeypatch.setattr(
        deps,
        "decode_token_identity",
        lambda _token: SimpleNamespace(subject="id", jti="session-id"),
    )
    monkeypatch.setattr(deps.SessionService, "require_active", AsyncMock())
    assert asyncio.run(deps.get_current_user(request, service)) == "user"
    assert asyncio.run(deps.get_optional_user(request, service)) == "user"

    bad_service = Mock(get_active_user=AsyncMock(side_effect=AuthenticationError("bad")))
    assert asyncio.run(deps.get_optional_user(request, bad_service)) is None
    with pytest.raises(AuthenticationError):
        asyncio.run(deps.get_current_user(_request(), service))


@pytest.mark.asyncio
async def test_dependency_session_and_permission_helpers() -> None:
    session = AsyncMock()
    session_factory = Mock(return_value=AsyncMock(__aenter__=AsyncMock(return_value=session)))
    original = deps.get_session_factory
    deps.get_session_factory = Mock(return_value=session_factory)
    try:
        generator = deps.get_db()
        assert await generator.__anext__() is session
        await generator.aclose()
    finally:
        deps.get_session_factory = original

    user = SimpleNamespace(id="u")
    permission_session = Mock()
    # The denied branch is covered without constructing a database-backed service.
    with pytest.raises(PermissionDeniedError):
        service = Mock(is_system_admin=AsyncMock(return_value=False))
        original_service = deps.PermissionService
        deps.PermissionService = Mock(return_value=service)
        try:
            await deps.get_current_superuser(user, permission_session)
        finally:
            deps.PermissionService = original_service
