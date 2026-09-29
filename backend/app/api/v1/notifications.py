"""The signed-in person's own notifications (the bell)."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Response, status
from pydantic import BaseModel

from app.api.deps import CurrentUser, DbSession
from app.modules.notifications.service import NotificationService
from app.schemas.notification import NotificationRead, NotificationSummary
from app.schemas.pagination import Page

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationUpdate(BaseModel):
    read: bool = True


@router.get("/summary", response_model=NotificationSummary, summary="Unread count")
async def read_summary(user: CurrentUser, session: DbSession) -> NotificationSummary:
    """Cheap and polled by every page."""
    return await NotificationService(session, user).summary()


@router.get("", response_model=Page[NotificationRead], summary="List notifications")
async def list_notifications(
    user: CurrentUser,
    session: DbSession,
    unread: bool = False,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[NotificationRead]:
    return await NotificationService(session, user).list(
        unread_only=unread, limit=limit, offset=offset
    )


@router.post(
    "/read-all", status_code=status.HTTP_204_NO_CONTENT, summary="Mark every notification read"
)
async def mark_all_read(user: CurrentUser, session: DbSession) -> Response:
    await NotificationService(session, user).mark_all_read()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{notification_id}", response_model=NotificationRead, summary="Mark read or unread")
async def update_notification(
    notification_id: uuid.UUID,
    payload: NotificationUpdate,
    user: CurrentUser,
    session: DbSession,
) -> NotificationRead:
    return await NotificationService(session, user).mark_read(notification_id, read=payload.read)
