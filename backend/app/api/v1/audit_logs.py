"""Audit log endpoints.

Read-only on purpose. There is deliberately **no** POST, PATCH or DELETE here:
an audit trail an administrator can edit is not an audit trail. Rows are
written only as a side effect of the operation they describe.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import CurrentSuperuser, DbSession
from app.models.audit import AuditAction
from app.modules.audit.service import AuditQueryService
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
