"""Structured logging.

Emits JSON in production and a human-readable stream locally. Every log record
carries the current request's correlation id, and a redaction processor strips
anything that looks like a credential before it reaches an output stream.
"""

from __future__ import annotations

import logging
import re
import sys
from collections.abc import Mapping
from contextvars import ContextVar
from typing import Any

import structlog

from app.core.config import settings

request_id_ctx: ContextVar[str | None] = ContextVar("request_id", default=None)
user_id_ctx: ContextVar[str | None] = ContextVar("user_id", default=None)

#: Keys whose values must never reach the logs.
SENSITIVE_KEYS = re.compile(
    r"(password|passwd|secret|token|authorization|api[_-]?key|client[_-]?secret|"
    r"credential|cookie|session|private[_-]?key|access[_-]?key)",
    re.IGNORECASE,
)
REDACTED = "***redacted***"


def scrub_value(value: Any, depth: int = 0) -> Any:
    """Recursively replace values whose key looks like a credential.

    Shared by the log processor and the audit trail: both persist
    caller-supplied dictionaries, and both must be unable to leak a password.
    Keeping one implementation means a new pattern added to
    :data:`SENSITIVE_KEYS` protects both at once.
    """
    if depth > 6:
        return value
    if isinstance(value, dict):
        return {
            k: (REDACTED if SENSITIVE_KEYS.search(str(k)) else scrub_value(v, depth + 1))
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [scrub_value(v, depth + 1) for v in value]
    return value


def scrub_mapping(data: Mapping[str, Any]) -> dict[str, Any]:
    """Scrub a mapping, always returning a plain ``dict``."""
    result = scrub_value(dict(data))
    return result if isinstance(result, dict) else {}


def _redact(_logger: Any, _name: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    """Recursively replace sensitive values. Applied to every event."""
    return scrub_mapping(event_dict)


def _add_context(_logger: Any, _name: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    if (rid := request_id_ctx.get()) is not None:
        event_dict.setdefault("request_id", rid)
    if (uid := user_id_ctx.get()) is not None:
        event_dict.setdefault("user_id", uid)
    return event_dict


_configured = False


def configure_logging(force: bool = False) -> None:
    """Configure structlog and route stdlib logging through the same pipeline.

    Both structlog calls and third-party stdlib loggers (uvicorn, sqlalchemy,
    boto3, arq) end up rendered by one formatter, so the output is uniform.
    """
    global _configured
    if _configured and not force:
        return

    level = getattr(logging, settings.log_level.upper(), logging.INFO)

    # Processors applied to every event, regardless of origin.
    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        _add_context,
        _redact,
    ]

    renderer: Any = (
        structlog.processors.JSONRenderer()
        if settings.log_format == "json"
        else structlog.dev.ConsoleRenderer(colors=sys.stderr.isatty())
    )

    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        structlog.stdlib.ProcessorFormatter(
            foreign_pre_chain=shared_processors,
            processors=[
                structlog.stdlib.ProcessorFormatter.remove_processors_meta,
                structlog.processors.format_exc_info,
                renderer,
            ],
        )
    )
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)

    for noisy, noisy_level in (
        ("uvicorn.access", logging.WARNING),  # replaced by our own access log
        ("uvicorn.error", level),
        ("sqlalchemy.engine", logging.WARNING),
        ("botocore", logging.WARNING),
        ("boto3", logging.WARNING),
        ("aiobotocore", logging.WARNING),
        ("arq", level),
    ):
        logging.getLogger(noisy).setLevel(noisy_level)
        logging.getLogger(noisy).handlers = []
        logging.getLogger(noisy).propagate = True

    _configured = True


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)
