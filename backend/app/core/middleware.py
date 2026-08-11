"""HTTP middleware: correlation ids, access logging and security headers."""

from __future__ import annotations

import time
import uuid
from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import settings
from app.core.logging import get_logger, request_id_ctx

logger = get_logger("app.access")

REQUEST_ID_HEADER = "X-Request-ID"

#: Paths excluded from access logging to keep probe noise out of the logs.
_QUIET_PATHS = frozenset({"/health", "/ready", "/metrics"})


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Assign/propagate a correlation id and emit one structured access log line."""

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        incoming = request.headers.get(REQUEST_ID_HEADER)
        # Only trust an inbound id if it looks like one; otherwise mint our own.
        request_id = incoming if incoming and len(incoming) <= 128 else uuid.uuid4().hex
        token = request_id_ctx.set(request_id)
        request.state.request_id = request_id

        started = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            response.headers[REQUEST_ID_HEADER] = request_id
            return response
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            if request.url.path not in _QUIET_PATHS:
                logger.info(
                    "http_request",
                    method=request.method,
                    path=request.url.path,
                    status_code=status_code,
                    duration_ms=duration_ms,
                    client=request.client.host if request.client else None,
                )
            request_id_ctx.reset(token)


class SecurityHeadersMiddleware:
    """Attach conservative security headers to every response.

    Implemented as raw ASGI middleware so it also covers streaming responses
    (attachment downloads, export packages) without buffering them.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self._headers: list[tuple[bytes, bytes]] = [
            (b"x-content-type-options", b"nosniff"),
            (b"x-frame-options", b"DENY"),
            (b"referrer-policy", b"strict-origin-when-cross-origin"),
            (b"cross-origin-opener-policy", b"same-origin"),
            (b"permissions-policy", b"camera=(), microphone=(), geolocation=(), payment=()"),
            # The API serves JSON and file downloads only - no inline scripting at all.
            (
                b"content-security-policy",
                b"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; "
                b"img-src 'self' data:; style-src 'unsafe-inline'; script-src 'none'",
            ),
        ]
        if settings.is_production:
            self._headers.append(
                (b"strict-transport-security", b"max-age=31536000; includeSubDomains")
            )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # FastAPI's own docs pages need scripts/styles; skip the strict CSP there.
        path: str = scope.get("path", "")
        strict = not path.startswith(("/docs", "/redoc", "/openapi.json"))

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers: list[tuple[bytes, bytes]] = message.setdefault("headers", [])
                existing = {name.lower() for name, _ in headers}
                for name, value in self._headers:
                    if name == b"content-security-policy" and not strict:
                        continue
                    if name not in existing:
                        headers.append((name, value))
            await send(message)

        await self.app(scope, receive, send_wrapper)
