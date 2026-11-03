"""The signed-in person's own notifications (the bell)."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Response, status
from pydantic import BaseModel

from app.api.deps import CurrentUser, DbSession, Impersonator
from app.core.exceptions import NotFoundError
from app.models.user import User
from app.modules.notifications.service import NotificationService
from app.schemas.notification import NotificationRead, NotificationSummary
from app.schemas.pagination import Page

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationUpdate(BaseModel):
    read: bool = True


def _service(session: DbSession, user: User, impersonator: User | None) -> NotificationService:
    return NotificationService(session, user, impersonated=impersonator is not None)


@router.get("/summary", response_model=NotificationSummary, summary="Unread count")
async def read_summary(
    user: CurrentUser, session: DbSession, impersonator: Impersonator
) -> NotificationSummary:
    """Cheap and polled by every page."""
    return await _service(session, user, impersonator).summary()


@router.get("", response_model=Page[NotificationRead], summary="List notifications")
async def list_notifications(
    user: CurrentUser,
    session: DbSession,
    impersonator: Impersonator,
    unread: bool = False,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[NotificationRead]:
    return await _service(session, user, impersonator).list(
        unread_only=unread, limit=limit, offset=offset
    )


@router.post(
    "/read-all", status_code=status.HTTP_204_NO_CONTENT, summary="Mark every notification read"
)
async def mark_all_read(
    user: CurrentUser, session: DbSession, impersonator: Impersonator
) -> Response:
    await _service(session, user, impersonator).mark_all_read()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{notification_id}/open",
    response_model=NotificationRead,
    summary="Open a notification: mark it read, or report that its target is gone",
)
async def open_notification(
    notification_id: uuid.UUID,
    user: CurrentUser,
    session: DbSession,
    impersonator: Impersonator,
) -> NotificationRead:
    """404 ``notification_target_gone`` (and the notification is removed) when the
    comment, page, space or request it points at no longer exists."""
    try:
        return await _service(session, user, impersonator).open(notification_id)
    except NotFoundError:
        # The request's transaction is rolled back on an error; keep the removal.
        await session.commit()
        raise


@router.patch("/{notification_id}", response_model=NotificationRead, summary="Mark read or unread")
async def update_notification(
    notification_id: uuid.UUID,
    payload: NotificationUpdate,
    user: CurrentUser,
    session: DbSession,
    impersonator: Impersonator,
) -> NotificationRead:
    return await _service(session, user, impersonator).mark_read(notification_id, read=payload.read)
