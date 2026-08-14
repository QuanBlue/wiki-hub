"""User administration endpoints.

Two classes of guard apply to every write here, both enforced in the service
layer so they hold for any future caller:

* The protected bootstrap administrator is rejected outright (403
  ``account_protected``).
* An administrator cannot lock themselves — or the whole instance — out
  (409 ``self_deactivation`` / ``self_demotion`` / ``self_deletion`` /
  ``last_superuser``).
"""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Query, status
from sqlalchemy import select

from app.api.deps import ActingAuthServiceDep, CurrentUser, DbSession
from app.models.permission import GlobalPermission, Group, GroupMember
from app.modules.permissions.service import PermissionService
from app.schemas.pagination import Page
from app.schemas.user import (
    PasswordChange,
    PasswordReset,
    SelfProfileUpdate,
    UserCreate,
    UserRead,
    UserUpdate,
)

router = APIRouter(prefix="/users", tags=["users"])


@router.patch("/me", response_model=UserRead, summary="Update your profile")
async def update_own_profile(
    payload: SelfProfileUpdate,
    user: CurrentUser,
    service: ActingAuthServiceDep,
) -> UserRead:
    updated = await service.update_own_profile(user.id, payload)
    return UserRead.model_validate(updated)


@router.get("", response_model=Page[UserRead], summary="List users")
async def list_users(
    user: CurrentUser,
    session: DbSession,
    service: ActingAuthServiceDep,
    q: str | None = Query(
        default=None, max_length=128, description="Match username, e-mail or name"
    ),
    status_filter: Literal["active", "disabled"] | None = Query(default=None, alias="status"),
    role: Literal["admin", "member"] | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[UserRead]:
    await PermissionService(session).require_global(user, GlobalPermission.manage_users)
    users, total = await service.search_users(
        q=q, status=status_filter, role=role, limit=limit, offset=offset
    )
    group_names: dict[uuid.UUID, list[str]] = {item.id: [] for item in users}
    if users:
        rows = await session.execute(
            select(GroupMember.user_id, Group.name)
            .join(Group, Group.id == GroupMember.group_id)
            .where(GroupMember.user_id.in_(group_names), Group.is_active.is_(True))
            .order_by(Group.name)
        )
        for user_id, group_name in rows:
            group_names[user_id].append(group_name)
    result = [
        UserRead.model_validate(item).model_copy(update={"groups": group_names[item.id]})
        for item in users
    ]
    return Page.of(result, total, limit=limit, offset=offset)


@router.post(
    "",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a user",
)
async def create_user(
    payload: UserCreate,
    user: CurrentUser,
    session: DbSession,
    service: ActingAuthServiceDep,
) -> UserRead:
    await PermissionService(session).require_global(user, GlobalPermission.manage_users)
    user = await service.create_user(payload)
    return UserRead.model_validate(user)


@router.patch("/{user_id}", response_model=UserRead, summary="Update a user")
async def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    user: CurrentUser,
    session: DbSession,
    service: ActingAuthServiceDep,
) -> UserRead:
    await PermissionService(session).require_global(user, GlobalPermission.manage_users)
    user = await service.update_user(user_id, payload)
    return UserRead.model_validate(user)


@router.post(
    "/{user_id}/password-reset",
    response_model=UserRead,
    summary="Set a user's password (administrator)",
)
async def reset_user_password(
    user_id: uuid.UUID,
    payload: PasswordReset,
    user: CurrentUser,
    session: DbSession,
    service: ActingAuthServiceDep,
) -> UserRead:
    """Set a password without knowing the old one.

    Distinct path from ``/users/me/password`` on purpose: this is an
    administrative action, not a self-service one, and conflating them would
    make the audit trail ambiguous.
    """
    await PermissionService(session).require_global(user, GlobalPermission.manage_users)
    updated = await service.reset_password(user_id, payload.new_password)
    return UserRead.model_validate(updated)


@router.delete(
    "/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a user",
)
async def delete_user(
    user_id: uuid.UUID,
    user: CurrentUser,
    session: DbSession,
    service: ActingAuthServiceDep,
) -> None:
    await PermissionService(session).require_global(user, GlobalPermission.manage_users)
    await service.delete_user(user_id)


@router.post(
    "/me/password",
    response_model=UserRead,
    summary="Change your own password",
)
async def change_own_password(
    payload: PasswordChange,
    user: CurrentUser,
    service: ActingAuthServiceDep,
) -> UserRead:
    updated = await service.change_password(user.id, payload.current_password, payload.new_password)
    return UserRead.model_validate(updated)
