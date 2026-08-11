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

from app.api.deps import ActingAuthServiceDep, CurrentSuperuser, CurrentUser
from app.schemas.pagination import Page
from app.schemas.user import (
    PasswordChange,
    PasswordReset,
    UserCreate,
    UserRead,
    UserUpdate,
)

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=Page[UserRead], summary="List users")
async def list_users(
    _admin: CurrentSuperuser,
    service: ActingAuthServiceDep,
    q: str | None = Query(
        default=None, max_length=128, description="Match username, e-mail or name"
    ),
    status_filter: Literal["active", "disabled"] | None = Query(default=None, alias="status"),
    role: Literal["admin", "member"] | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[UserRead]:
    users, total = await service.search_users(
        q=q, status=status_filter, role=role, limit=limit, offset=offset
    )
    return Page.of([UserRead.model_validate(u) for u in users], total, limit=limit, offset=offset)


@router.post(
    "",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a user",
)
async def create_user(
    payload: UserCreate,
    _admin: CurrentSuperuser,
    service: ActingAuthServiceDep,
) -> UserRead:
    user = await service.create_user(payload)
    return UserRead.model_validate(user)


@router.patch("/{user_id}", response_model=UserRead, summary="Update a user")
async def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    _admin: CurrentSuperuser,
    service: ActingAuthServiceDep,
) -> UserRead:
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
    _admin: CurrentSuperuser,
    service: ActingAuthServiceDep,
) -> UserRead:
    """Set a password without knowing the old one.

    Distinct path from ``/users/me/password`` on purpose: this is an
    administrative action, not a self-service one, and conflating them would
    make the audit trail ambiguous.
    """
    user = await service.reset_password(user_id, payload.new_password)
    return UserRead.model_validate(user)


@router.delete(
    "/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a user",
)
async def delete_user(
    user_id: uuid.UUID,
    _admin: CurrentSuperuser,
    service: ActingAuthServiceDep,
) -> None:
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
