"""Aggregates every versioned API router under ``/api/v1``.

Feature modules register themselves here as they land; keeping the wiring in one
file makes the public surface of the monolith easy to audit.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import (
    attachments,
    audit_logs,
    auth,
    backup,
    confluence_import,
    export_render,
    groups,
    meta,
    pages,
    revisions,
    search,
    site_settings,
    spaces,
    storage_admin,
    users,
)

api_router = APIRouter()

api_router.include_router(meta.router)
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(groups.router)
api_router.include_router(spaces.router)
api_router.include_router(pages.router)
api_router.include_router(pages.standalone_router)
api_router.include_router(revisions.router)
api_router.include_router(search.router)
api_router.include_router(attachments.router)
api_router.include_router(attachments.upload_router)
api_router.include_router(site_settings.router)
api_router.include_router(audit_logs.router)
api_router.include_router(backup.router)
api_router.include_router(confluence_import.router)
api_router.include_router(storage_admin.router)
api_router.include_router(export_render.router)

# Registered in later phases:
#   groups, roles, revisions,
#   comments, attachments, search, imports, exports
