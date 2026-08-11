"""Domain exceptions.

Services raise these; the API layer translates them into the standard error
envelope (see :mod:`app.api.errors`). Nothing below imports FastAPI, so the
service layer stays framework-agnostic.
"""

from __future__ import annotations

from typing import Any


class WikiHubError(Exception):
    """Base class for every expected, translatable application error."""

    status_code: int = 500
    code: str = "internal_error"
    message: str = "An unexpected error occurred."

    def __init__(
        self,
        message: str | None = None,
        *,
        code: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.message = message or self.message
        self.code = code or self.code
        self.details = details or {}
        super().__init__(self.message)


class NotFoundError(WikiHubError):
    status_code = 404
    code = "not_found"
    message = "The requested resource was not found."


class ConflictError(WikiHubError):
    status_code = 409
    code = "conflict"
    message = "The request conflicts with the current state of the resource."


class ValidationError(WikiHubError):
    status_code = 422
    code = "validation_error"
    message = "The request payload is invalid."


class BadRequestError(WikiHubError):
    status_code = 400
    code = "bad_request"
    message = "The request is malformed."


class AuthenticationError(WikiHubError):
    status_code = 401
    code = "unauthenticated"
    message = "Authentication is required."


class PermissionDeniedError(WikiHubError):
    status_code = 403
    code = "permission_denied"
    message = "You do not have permission to perform this action."


class RateLimitedError(WikiHubError):
    status_code = 429
    code = "rate_limited"
    message = "Too many requests. Please try again later."


class PayloadTooLargeError(WikiHubError):
    status_code = 413
    code = "payload_too_large"
    message = "The uploaded payload exceeds the configured limit."


class UnsupportedMediaTypeError(WikiHubError):
    status_code = 415
    code = "unsupported_media_type"
    message = "The provided file type is not allowed."


class ServiceUnavailableError(WikiHubError):
    status_code = 503
    code = "service_unavailable"
    message = "A required dependency is unavailable."


class NotImplementedFeatureError(WikiHubError):
    """Raised by deliberately unimplemented extension points (e.g. the OIDC provider)."""

    status_code = 501
    code = "not_implemented"
    message = "This feature is not implemented in this build."
