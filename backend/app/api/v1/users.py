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

from fastapi import APIRouter, Depends, Query, Request, Response, UploadFile, status
from sqlalchemy import select

from app.api.deps import ActingAuthServiceDep, CurrentUser, DbSession
from app.core.config import settings
from app.core.exceptions import BadRequestError, PayloadTooLargeError, UnsupportedMediaTypeError
from app.models.permission import GlobalPermission, Group, GroupMember
from app.models.user import User
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
from app.services.storage import ObjectStorage, S3ObjectStorage

router = APIRouter(prefix="/users", tags=["users"])

AVATAR_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
AVATAR_EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
}
MAX_AVATAR_BYTES = 5 * 1024 * 1024


def get_storage() -> ObjectStorage:
    return S3ObjectStorage()


def avatar_endpoint(request: Request, user_id: uuid.UUID) -> str:
    return f"{str(request.base_url).rstrip('/')}{settings.api_v1_prefix}/users/{user_id}/avatar"


async def remove_avatar_object(user: User, storage: ObjectStorage) -> None:
    key = getattr(user, "avatar_object_key", None)
    if key:
        await storage.delete(key)
        user.avatar_object_key = None
        user.avatar_content_type = None


@router.patch("/me", response_model=UserRead, summary="Update your profile")
async def update_own_profile(
    payload: SelfProfileUpdate,
    user: CurrentUser,
    service: ActingAuthServiceDep,
) -> UserRead:
    updated = await service.update_own_profile(user.id, payload)
    return UserRead.model_validate(updated)


@router.post("/me/avatar", response_model=UserRead, summary="Upload your profile picture")
async def upload_own_avatar(
    request: Request,
    file: UploadFile,
    user: CurrentUser,
    session: DbSession,
    storage: ObjectStorage = Depends(get_storage),
) -> UserRead:
    content_type = (file.content_type or "").lower()
    if content_type not in AVATAR_TYPES:
        raise UnsupportedMediaTypeError("Avatar must be a JPEG, PNG, GIF, or WebP image.")
    data = await file.read(MAX_AVATAR_BYTES + 1)
    if len(data) > MAX_AVATAR_BYTES:
        raise PayloadTooLargeError("Profile pictures must be 5 MB or smaller.")
    if not data:
        raise BadRequestError("The profile picture is empty.")

    key = f"avatars/{user.id}/{uuid.uuid4()}.{AVATAR_EXTENSIONS[content_type]}"
    await storage.put(key, data, content_type=content_type)
    old_key = user.avatar_object_key
    user.avatar_object_key = key
    user.avatar_content_type = content_type
    user.avatar_url = avatar_endpoint(request, user.id)
    if old_key and old_key != key:
        await storage.delete(old_key)
    await session.flush()
    return UserRead.model_validate(user)


@router.delete("/me/avatar", response_model=UserRead, summary="Remove your profile picture")
async def delete_own_avatar(
    user: CurrentUser,
    session: DbSession,
    storage: ObjectStorage = Depends(get_storage),
) -> UserRead:
    await remove_avatar_object(user, storage)
    user.avatar_url = None
    await session.flush()
    return UserRead.model_validate(user)


@router.get("/{user_id}/avatar", summary="Read a user profile picture")
async def read_avatar(
    user_id: uuid.UUID,
    _viewer: CurrentUser,
    session: DbSession,
    storage: ObjectStorage = Depends(get_storage),
) -> Response:
    avatar_user = await session.get(User, user_id)
    if avatar_user is None or not avatar_user.avatar_object_key:
        return Response(status_code=status.HTTP_404_NOT_FOUND)
    return Response(
        content=await storage.get(avatar_user.avatar_object_key),
        media_type=avatar_user.avatar_content_type or "image/png",
        headers={"Cache-Control": "private, max-age=300"},
    )


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
