"""Administrator mail: mailboxes, the inbox, and the public contact form.

Three audiences share this module, each behind its own guard:

* the public form (`POST /contact-admin`) - no sign-in, so it is throttled;
* accounts linked to an active mailbox - the inbox and the shell summary;
* system administrators - creating and editing mailboxes.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response, status

from app.api.deps import ClientInfoDep, CurrentSuperuser, CurrentUser, DbSession, Impersonator
from app.core import rate_limit
from app.core.config import settings
from app.core.exceptions import NotFoundError
from app.models.permission import GlobalPermission, Permission
from app.models.user import User
from app.modules.admin_mail.actions import RequestActionService
from app.modules.admin_mail.service import AdminMailService
from app.modules.permissions.service import PermissionService
from app.modules.spaces.service import SpaceService
from app.repositories.admin_mail import InboxStatus
from app.repositories.user import UserRepository
from app.schemas.admin_mail import (
    AccountEmailRequest,
    AccountEmailResult,
    AdminGrantedEmailRequest,
    AutoActionRequest,
    AutoActionResult,
    ContactAdminCreate,
    ContactAdminResult,
    InboxCounts,
    InboxItem,
    InboxUpdate,
    MailboxCreate,
    MailboxPasswordUpdate,
    MailboxRead,
    MailboxTestResult,
    MailboxUpdate,
    MailSummary,
    RequestActionPreview,
    RequestKindName,
    SpaceAccessEmailRequest,
)
from app.schemas.pagination import Page

router = APIRouter(prefix="/admin-mail", tags=["admin-mail"])
public_router = APIRouter(prefix="/contact-admin", tags=["admin-mail"])


def get_acting_admin_mail_service(
    session: DbSession,
    user: CurrentUser,
    client: ClientInfoDep,
    impersonator: Impersonator,
) -> AdminMailService:
    """Bound to the caller so every audited change names who made it."""
    return AdminMailService(session, actor=user, client=client, impersonator=impersonator)


AdminMailServiceDep = Annotated[AdminMailService, Depends(get_acting_admin_mail_service)]


# --- public -----------------------------------------------------------------


@public_router.post(
    "",
    response_model=ContactAdminResult,
    status_code=status.HTTP_201_CREATED,
    summary="Send a request to the administrators",
)
async def contact_admin(
    payload: ContactAdminCreate, request: Request, session: DbSession
) -> ContactAdminResult:
    """Open to anyone: this is how someone without a working account asks for
    one. Throttled per client and again overall, since each accepted request
    sends an email per administrator mailbox."""
    client_ip = request.client.host if request.client else None
    await rate_limit.enforce(f"contact-admin:ip:{client_ip}", settings.contact_admin_rate_limit)
    await rate_limit.enforce("contact-admin:all", settings.contact_admin_global_rate_limit)
    delivery = await AdminMailService(session).submit_request(payload, client_ip=client_ip)
    return ContactAdminResult(delivery=delivery)


# --- accounts with a mailbox --------------------------------------------------


@router.get("/summary", response_model=MailSummary, summary="Inbox and mailbox status")
async def read_summary(user: CurrentUser, service: AdminMailServiceDep) -> MailSummary:
    """Cheap and polled by every page. Never an error for an account without a
    mailbox: it just reports `has_mailbox: false`."""
    return await service.summary(user)


@router.get("/inbox", response_model=Page[InboxItem], summary="List requests")
async def list_inbox(
    user: CurrentUser,
    service: AdminMailServiceDep,
    status_filter: Annotated[InboxStatus, Query(alias="status")] = "all",
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    kind: RequestKindName | None = None,
) -> Page[InboxItem]:
    return await service.list_inbox(
        user, status=status_filter, limit=limit, offset=offset, kind=kind
    )


# Declared before `/inbox/{request_id}` so "counts" is not read as an id.
@router.get("/inbox/counts", response_model=InboxCounts, summary="Requests per Inbox tab")
async def inbox_counts(
    user: CurrentUser, service: AdminMailServiceDep, kind: RequestKindName | None = None
) -> InboxCounts:
    return await service.inbox_counts(user, kind=kind)


@router.post(
    "/inbox/read-all", status_code=status.HTTP_204_NO_CONTENT, summary="Mark every request read"
)
async def mark_all_read(user: CurrentUser, service: AdminMailServiceDep) -> Response:
    await service.mark_all_read(user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/inbox/{request_id}", response_model=InboxItem, summary="Read one request")
async def read_inbox_item(
    request_id: uuid.UUID, user: CurrentUser, service: AdminMailServiceDep
) -> InboxItem:
    return await service.get_inbox_item(user, request_id)


def get_request_action_service(
    session: DbSession,
    user: CurrentUser,
    client: ClientInfoDep,
    impersonator: Impersonator,
) -> RequestActionService:
    return RequestActionService(session, actor=user, client=client, impersonator=impersonator)


RequestActionServiceDep = Annotated[RequestActionService, Depends(get_request_action_service)]


@router.get(
    "/inbox/{request_id}/actions",
    response_model=RequestActionPreview,
    summary="What can be done automatically for a request",
)
async def preview_request_actions(
    request_id: uuid.UUID, service: RequestActionServiceDep
) -> RequestActionPreview:
    return await service.preview(request_id)


@router.post(
    "/inbox/{request_id}/create-account",
    response_model=AutoActionResult,
    summary="Create the requested account and email its sign-in details",
)
async def create_account_from_request(
    request_id: uuid.UUID, payload: AutoActionRequest, service: RequestActionServiceDep
) -> AutoActionResult:
    return await service.create_account(request_id, login_url=payload.login_url)


@router.post(
    "/inbox/{request_id}/reset-password",
    response_model=AutoActionResult,
    summary="Reset the requester's password and email the new one",
)
async def reset_password_from_request(
    request_id: uuid.UUID, payload: AutoActionRequest, service: RequestActionServiceDep
) -> AutoActionResult:
    return await service.reset_password(request_id, login_url=payload.login_url)


@router.patch("/inbox/{request_id}", response_model=InboxItem, summary="Mark read or resolved")
async def update_inbox_item(
    request_id: uuid.UUID,
    payload: InboxUpdate,
    user: CurrentUser,
    service: AdminMailServiceDep,
) -> InboxItem:
    return await service.update_inbox_item(user, request_id, payload)


@router.put(
    "/mailboxes/{mailbox_id}/password",
    response_model=MailboxRead,
    summary="Set a mailbox's new password",
)
async def set_mailbox_password(
    mailbox_id: uuid.UUID,
    payload: MailboxPasswordUpdate,
    service: AdminMailServiceDep,
) -> MailboxRead:
    """The mailbox's own account may do this as well as an administrator: it is
    the account shown the "password expired" banner."""
    return await service.set_password(mailbox_id, payload.password)


async def _account_email_target(session: DbSession, user_id: uuid.UUID) -> User:
    target = await UserRepository(session).get(user_id)
    if target is None:
        raise NotFoundError("User not found.")
    return target


@router.post(
    "/notify-account-created",
    response_model=AccountEmailResult,
    summary="Email a newly created account its sign-in details",
)
async def notify_account_created(
    payload: AccountEmailRequest,
    user: CurrentUser,
    session: DbSession,
    service: AdminMailServiceDep,
) -> AccountEmailResult:
    """Called right after `POST /users` succeeds, when the administrator asked
    to email the person too - a separate request rather than a flag on that
    one, so creating the account never fails just because the mail could not
    be sent."""
    await PermissionService(session).require_global(user, GlobalPermission.manage_users)
    target = await _account_email_target(session, payload.user_id)
    return await service.send_account_email(
        user,
        to_user=target,
        password=payload.password,
        created=True,
        login_url=payload.login_url,
    )


@router.post(
    "/notify-password-reset",
    response_model=AccountEmailResult,
    summary="Email someone that their password was just reset",
)
async def notify_password_reset(
    payload: AccountEmailRequest,
    user: CurrentUser,
    session: DbSession,
    service: AdminMailServiceDep,
) -> AccountEmailResult:
    """Called right after `POST /users/{id}/password-reset` succeeds, on the
    same "separate request" basis as account creation above."""
    await PermissionService(session).require_global(user, GlobalPermission.manage_users)
    target = await _account_email_target(session, payload.user_id)
    return await service.send_account_email(
        user,
        to_user=target,
        password=payload.password,
        created=False,
        login_url=payload.login_url,
    )


@router.post(
    "/notify-admin-granted",
    response_model=AccountEmailResult,
    summary="Email someone that their account was just made an administrator",
)
async def notify_admin_granted(
    payload: AdminGrantedEmailRequest,
    user: CurrentUser,
    session: DbSession,
    service: AdminMailServiceDep,
) -> AccountEmailResult:
    """Called right after `PATCH /users/{id}` turns Role into Administrator, on
    the same "separate request" basis as the two notices above."""
    await PermissionService(session).require_global(user, GlobalPermission.manage_users)
    target = await _account_email_target(session, payload.user_id)
    return await service.send_admin_granted_email(
        user, to_user=target, login_url=payload.login_url
    )


@router.post(
    "/notify-space-access",
    response_model=AccountEmailResult,
    summary="Email someone that they were added to, or removed from, a space",
)
async def notify_space_access(
    payload: SpaceAccessEmailRequest,
    user: CurrentUser,
    session: DbSession,
    service: AdminMailServiceDep,
) -> AccountEmailResult:
    """Called right after the Access tab's user permission matrix gives
    someone their first permission in a space, or takes their last one away -
    the same "always after, never a flag on the write itself" shape as the
    other notices here. Requires the space's own `admin` permission, the same
    as the permission-matrix writes it follows, not the global `manage_users`
    the other notices need: someone can be a space's Admin without being a
    WikiHub administrator at all."""
    space = await SpaceService(session).get_by_key(payload.space_key)
    await PermissionService(session).require(space, user, Permission.admin)
    target = await _account_email_target(session, payload.user_id)
    return await service.send_space_access_email(
        user,
        to_user=target,
        space_name=space.name,
        added=payload.added,
        login_url=payload.login_url,
    )


# --- administrators -----------------------------------------------------------


@router.get("/mailboxes", response_model=list[MailboxRead], summary="List mailboxes")
async def list_mailboxes(
    _admin: CurrentSuperuser, service: AdminMailServiceDep
) -> list[MailboxRead]:
    return await service.list_mailboxes()


@router.post(
    "/mailboxes",
    response_model=MailboxRead,
    status_code=status.HTTP_201_CREATED,
    summary="Add a mailbox",
)
async def create_mailbox(
    payload: MailboxCreate, _admin: CurrentSuperuser, service: AdminMailServiceDep
) -> MailboxRead:
    return await service.create_mailbox(payload)


@router.patch("/mailboxes/{mailbox_id}", response_model=MailboxRead, summary="Edit a mailbox")
async def update_mailbox(
    mailbox_id: uuid.UUID,
    payload: MailboxUpdate,
    _admin: CurrentSuperuser,
    service: AdminMailServiceDep,
) -> MailboxRead:
    return await service.update_mailbox(mailbox_id, payload)


@router.post(
    "/mailboxes/{mailbox_id}/test",
    response_model=MailboxTestResult,
    summary="Check that a mailbox can sign in",
)
async def test_mailbox(
    mailbox_id: uuid.UUID, _admin: CurrentSuperuser, service: AdminMailServiceDep
) -> MailboxTestResult:
    return await service.test_mailbox(mailbox_id)


@router.delete(
    "/mailboxes/{mailbox_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a mailbox",
)
async def delete_mailbox(
    mailbox_id: uuid.UUID, _admin: CurrentSuperuser, service: AdminMailServiceDep
) -> Response:
    await service.delete_mailbox(mailbox_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
