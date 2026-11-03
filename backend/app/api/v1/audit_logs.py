"""Audit log endpoints.

Read-only on purpose. There is deliberately **no** POST, PATCH or DELETE here:
an audit trail an administrator can edit is not an audit trail. Rows are
written only as a side effect of the operation they describe.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from app.api.deps import CurrentSuperuser, DbSession
from app.models.audit import AuditAction
from app.modules.audit.service import EXPORT_LIMIT, AuditQueryService
from app.schemas.audit import AuditLogRead
from app.schemas.pagination import Page

router = APIRouter(prefix="/audit-logs", tags=["audit-logs"])


def get_audit_query_service(session: DbSession) -> AuditQueryService:
    return AuditQueryService(session)


AuditQueryServiceDep = Annotated[AuditQueryService, Depends(get_audit_query_service)]


@router.get("", response_model=Page[AuditLogRead], summary="List audit log entries")
async def list_audit_logs(
    _admin: CurrentSuperuser,
    service: AuditQueryServiceDep,
    action: str | None = Query(default=None, max_length=64),
    entity_type: str | None = Query(default=None, max_length=32),
    actor_id: uuid.UUID | None = Query(default=None),
    actor_username: str | None = Query(default=None, max_length=64),
    entity_id: uuid.UUID | None = Query(default=None),
    since: datetime | None = Query(default=None),
    until: datetime | None = Query(default=None),
    q: str | None = Query(default=None, max_length=128, description="Match actor or entity"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[AuditLogRead]:
    return await service.search(
        action=action,
        entity_type=entity_type,
        actor_id=actor_id,
        actor_username=actor_username,
        entity_id=entity_id,
        since=since,
        until=until,
        q=q,
        limit=limit,
        offset=offset,
    )


@router.get("/actions", response_model=list[str], summary="Known audit actions")
async def list_actions(_admin: CurrentSuperuser) -> list[str]:
    """Populates the filter dropdown without hard-coding the list in the UI."""
    return [action.value for action in AuditAction]


@router.get("/actors", response_model=list[str], summary="Usernames present in the audit trail")
async def list_actors(
    _admin: CurrentSuperuser,
    service: AuditQueryServiceDep,
) -> list[str]:
    """Populates the actor filter dropdown, including deleted accounts and impersonators."""
    return await service.actors()


@router.get("/export", summary="Export filtered audit log entries as CSV or JSON")
async def export_audit_logs(
    _admin: CurrentSuperuser,
    service: AuditQueryServiceDep,
    format: Literal["csv", "json"] = Query(default="csv"),
    action: str | None = Query(default=None, max_length=64),
    entity_type: str | None = Query(default=None, max_length=32),
    actor_id: uuid.UUID | None = Query(default=None),
    actor_username: str | None = Query(default=None, max_length=64),
    entity_id: uuid.UUID | None = Query(default=None),
    since: datetime | None = Query(default=None),
    until: datetime | None = Query(default=None),
    q: str | None = Query(default=None, max_length=128, description="Match actor or entity"),
    limit: int = Query(default=EXPORT_LIMIT, ge=1, le=EXPORT_LIMIT),
) -> Response:
    entries = await service.export_entries(
        action=action,
        entity_type=entity_type,
        actor_id=actor_id,
        actor_username=actor_username,
        entity_id=entity_id,
        since=since,
        until=until,
        q=q,
        limit=limit,
    )
    if format == "json":
        body = service.to_json(entries)
        media_type = "application/json; charset=utf-8"
        filename = "audit-logs.json"
    else:
        body = service.to_csv(entries)
        media_type = "text/csv; charset=utf-8"
        filename = "audit-logs.csv"
    return Response(
        content=body,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
