"""Consistent error envelope for the whole API.

Every failure — domain error, validation error, or unhandled exception — is
serialised as::

    {
      "error": {
        "code": "not_found",
        "message": "Page not found.",
        "details": {...},
        "request_id": "01J..."
      }
    }
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.exceptions import WikiHubError
from app.core.logging import get_logger, request_id_ctx

logger = get_logger(__name__)


def error_response(
    status_code: int,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    body: dict[str, Any] = {
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
            "request_id": request_id_ctx.get(),
        }
    }
    return JSONResponse(status_code=status_code, content=body, headers=headers)


#: Maps raw HTTP status codes to stable machine-readable error codes.
#: Written as literals rather than ``starlette.status`` constants because several
#: of those names have been renamed across releases.
_HTTP_CODES = {
    400: "bad_request",
    401: "unauthenticated",
    403: "permission_denied",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    415: "unsupported_media_type",
    422: "validation_error",
    429: "rate_limited",
    500: "internal_error",
    501: "not_implemented",
    503: "service_unavailable",
}


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(WikiHubError)
    async def _domain_error(_request: Request, exc: WikiHubError) -> JSONResponse:
        if exc.status_code >= 500:
            logger.error("domain_error", code=exc.code, message=exc.message, exc_info=exc)
        else:
            logger.info("domain_error", code=exc.code, message=exc.message)
        return error_response(exc.status_code, exc.code, exc.message, exc.details)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        fields = [
            {
                "field": ".".join(str(p) for p in err["loc"][1:]) or str(err["loc"][0]),
                "message": err["msg"],
                "type": err["type"],
            }
            for err in exc.errors()
        ]
        return error_response(
            422,
            "validation_error",
            "The request payload is invalid.",
            {"fields": fields},
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _HTTP_CODES.get(exc.status_code, "http_error")
        detail = exc.detail if isinstance(exc.detail, str) else "Request failed."
        headers = dict(exc.headers) if exc.headers else None
        return error_response(exc.status_code, code, detail, headers=headers)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        logger.error(
            "unhandled_exception",
            path=request.url.path,
            method=request.method,
            exc_info=exc,
        )
        # Never leak internals to the client.
        return error_response(500, "internal_error", "An unexpected error occurred.")
