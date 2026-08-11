"""WikiHub API application factory."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import register_exception_handlers
from app.api.health import router as health_router
from app.api.v1.router import api_router
from app.core.config import settings
from app.core.logging import configure_logging, get_logger
from app.core.middleware import RequestContextMiddleware, SecurityHeadersMiddleware
from app.core.redis import close_redis
from app.db.session import dispose_engine

logger = get_logger(__name__)

DESCRIPTION = """
**WikiHub** is a self-hosted internal documentation platform.

Organise knowledge into **Spaces**, build hierarchical **Pages** with a rich
editor, keep a complete **revision history**, attach files, search everything,
import existing Confluence exports and export back out to Markdown or HTML.
""".strip()

TAGS_METADATA = [
    {"name": "system", "description": "Health, readiness and instance metadata."},
    {"name": "auth", "description": "Authentication and session management."},
    {"name": "users", "description": "User accounts."},
    {"name": "groups", "description": "User groups."},
    {"name": "roles", "description": "Roles and permission assignments."},
    {"name": "spaces", "description": "Top-level documentation areas."},
    {"name": "pages", "description": "Hierarchical documentation pages."},
    {"name": "revisions", "description": "Immutable page version history."},
    {"name": "comments", "description": "Page comments."},
    {"name": "attachments", "description": "Binary files attached to pages."},
    {"name": "search", "description": "Full-text search."},
    {"name": "imports", "description": "Importing content from Confluence and other sources."},
    {"name": "exports", "description": "Exporting content to Markdown, HTML and archives."},
    {"name": "audit-logs", "description": "Audit trail of privileged operations."},
    {"name": "settings", "description": "Runtime-editable instance settings."},
    {"name": "backup", "description": "Whole-instance backup and restore."},
]


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    logger.info(
        "startup",
        environment=str(settings.env),
        version=settings.project_version,
        debug=settings.debug,
    )
    yield
    logger.info("shutdown")
    await dispose_engine()
    await close_redis()


def create_app() -> FastAPI:
    configure_logging()

    app = FastAPI(
        title=f"{settings.site_name} API",
        description=DESCRIPTION,
        version=settings.project_version,
        openapi_tags=TAGS_METADATA,
        openapi_url="/openapi.json",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
        # Our own envelope is used for every failure; see app.api.errors.
        responses={},
    )

    # Order matters: the outermost middleware is added last.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID", "X-CSRF-Token"],
        expose_headers=["X-Request-ID"],
        max_age=600,
    )
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestContextMiddleware)

    register_exception_handlers(app)

    app.include_router(health_router)
    app.include_router(api_router, prefix=settings.api_v1_prefix)

    return app


app = create_app()
