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
from sqlalchemy import delete, func, select

from app.api.deps import ActingAuthServiceDep, CurrentUser, DbSession
from app.core.config import settings
from app.core.exceptions import (
    BadRequestError,
    ConflictError,
    NotFoundError,
    PayloadTooLargeError,
    UnsupportedMediaTypeError,
)
from app.models.draft import PageDraft
from app.models.page import PageLike, UserPagePin, WikiPage
from app.models.user_page_label import UserPageLabel
from app.models.permission import GlobalPermission, Group, GroupMember, UserGlobalPermissionOverride
from app.models.space import Space, SpaceStatus
from app.models.user import User
from app.models.user_session import UserSession
from app.models.user_tag import UserTag
from app.modules.pages.service import PageService
from app.modules.permissions.service import PermissionService
from app.repositories.user import UserRepository
from app.schemas.pagination import Page
from app.schemas.user import (
    AdminAccountRead,
    GlobalPermissionOverride,
    PasswordChange,
    PasswordReset,
    PublicUserRead,
    SelfProfileUpdate,
    UserActivityPage,
    UserCreate,
    UserDraftItem,
    UserGroupMembership,
    UserPinnedPageItem,
    UserPageLabelItem,
    UserProfileStats,
    UserRead,
    UserTagCreate,
    UserTagRead,
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


async def get_public_member(username: str, session: DbSession) -> User:
    member = await UserRepository(session).get_by_username(username)
    if member is None or not member.is_active:
        raise NotFoundError("User not found.")
    return member


@router.get("/{username}/profile", response_model=PublicUserRead, summary="Read a member profile")
async def get_public_profile(
    username: str,
    _viewer: CurrentUser,
    session: DbSession,
) -> PublicUserRead:
    member = await get_public_member(username, session)
    last_active_at = await session.scalar(
        select(func.max(UserSession.last_seen_at)).where(UserSession.user_id == member.id)
    )
    return PublicUserRead.model_validate(member).model_copy(
        update={
            "last_active_at": last_active_at or member.last_login_at,
            "is_workspace_admin": await PermissionService(session).is_system_admin(member),
        }
    )


@router.get(
    "/{username}/activity",
    response_model=UserActivityPage,
    summary="List a member's page updates",
)
async def list_public_activity(
    username: str,
    viewer: CurrentUser,
    session: DbSession,
    limit: int = Query(default=20, ge=1, le=50),
    cursor: str | None = Query(default=None, max_length=1024),
) -> UserActivityPage:
    member = await get_public_member(username, session)
    items, next_cursor = await PageService(session).list_user_activity(
        viewer, member, limit=limit, cursor=cursor
    )
    return UserActivityPage(items=items, next_cursor=next_cursor)


@router.get(
    "/{username}/stats", response_model=UserProfileStats, summary="Read member activity totals"
)
async def get_profile_stats(
    username: str,
    _viewer: CurrentUser,
    session: DbSession,
) -> UserProfileStats:
    """Return aggregate-only totals, never rows from an inaccessible space."""
    member = await get_public_member(username, session)
    active_pages = WikiPage.space_id.in_(select(Space.id).where(Space.status == SpaceStatus.active))
    pages_updated = await session.scalar(
        select(func.count(WikiPage.id)).where(WikiPage.updated_by_id == member.id, active_pages)
    )
    pages_created = await session.scalar(
        select(func.count(WikiPage.id)).where(WikiPage.created_by_id == member.id, active_pages)
    )
    spaces_contributed = await session.scalar(
        select(func.count(func.distinct(WikiPage.space_id))).where(
            WikiPage.updated_by_id == member.id, active_pages
        )
    )
    return UserProfileStats(
        pages_updated=int(pages_updated or 0),
        pages_created=int(pages_created or 0),
        spaces_contributed=int(spaces_contributed or 0),
    )


@router.get(
    "/{username}/drafts", response_model=list[UserDraftItem], summary="List private member drafts"
)
async def list_member_drafts(
    username: str,
    viewer: CurrentUser,
    session: DbSession,
) -> list[UserDraftItem]:
    member = await get_public_member(username, session)
    if viewer.id != member.id and not await PermissionService(session).is_system_admin(viewer):
        raise NotFoundError("User not found.")
    rows = await session.execute(
        select(PageDraft, WikiPage, Space)
        .join(WikiPage, WikiPage.id == PageDraft.page_id)
        .join(Space, Space.id == WikiPage.space_id)
        .where(PageDraft.user_id == member.id, Space.status == SpaceStatus.active)
        .order_by(PageDraft.updated_at.desc())
        .limit(50)
    )
    return [
        UserDraftItem(
            id=draft.id,
            page_id=page.id,
            title=page.title,
            slug=page.slug,
            space_key=space.key,
            space_name=space.name,
            content=draft.content,
            updated_at=draft.updated_at,
        )
        for draft, page, space in rows
    ]


@router.get(
    "/me/pins", response_model=list[UserPinnedPageItem], summary="List your private pinned pages"
)
async def list_own_pins(user: CurrentUser, session: DbSession) -> list[UserPinnedPageItem]:
    rows = await session.execute(
        select(UserPagePin, WikiPage, Space)
        .join(WikiPage, WikiPage.id == UserPagePin.page_id)
        .join(Space, Space.id == WikiPage.space_id)
        .where(UserPagePin.user_id == user.id, Space.status == SpaceStatus.active)
        .order_by(UserPagePin.created_at.desc())
    )
    permissions = PermissionService(session)
    items: list[UserPinnedPageItem] = []
    for pin, page, space in rows:
        if await permissions.can_view_page(page, user):
            items.append(
                UserPinnedPageItem(
                    id=page.id,
                    title=page.title,
                    slug=page.slug,
                    space_key=space.key,
                    space_name=space.name,
                    pinned_at=pin.created_at,
                )
            )
    return items


@router.get("/me/likes", response_model=list[UserPinnedPageItem], summary="List pages you liked")
async def list_own_likes(user: CurrentUser, session: DbSession) -> list[UserPinnedPageItem]:
    rows = await session.execute(
        select(PageLike, WikiPage, Space)
        .join(WikiPage, WikiPage.id == PageLike.page_id)
        .join(Space, Space.id == WikiPage.space_id)
        .where(PageLike.user_id == user.id, Space.status == SpaceStatus.active)
        .order_by(WikiPage.updated_at.desc())
    )
    permissions = PermissionService(session)
    return [
        UserPinnedPageItem(id=page.id, title=page.title, slug=page.slug,
                           space_key=space.key, space_name=space.name,
                           pinned_at=page.updated_at)
        for _like, page, space in rows
        if await permissions.can_view_page(page, user)
    ]


@router.get("/me/page-labels", response_model=list[UserPageLabelItem], summary="List your private page labels")
async def list_own_page_labels(user: CurrentUser, session: DbSession) -> list[UserPageLabelItem]:
    rows = await session.execute(
        select(UserPageLabel, WikiPage, Space)
        .join(WikiPage, WikiPage.id == UserPageLabel.page_id)
        .join(Space, Space.id == WikiPage.space_id)
        .where(UserPageLabel.user_id == user.id, Space.status == SpaceStatus.active)
        .order_by(UserPageLabel.name, WikiPage.title)
    )
    permissions = PermissionService(session)
    return [
        UserPageLabelItem(id=label.id, name=label.name, page_id=page.id,
                          title=page.title, slug=page.slug,
                          space_key=space.key, space_name=space.name)
        for label, page, space in rows
        if await permissions.can_view_page(page, user)
    ]


@router.post("/me/pins/{page_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Pin a page")
async def pin_page(page_id: uuid.UUID, user: CurrentUser, session: DbSession) -> None:
    page = await session.get(WikiPage, page_id)
    if page is None or not await PermissionService(session).can_view_page(page, user):
        raise NotFoundError("Page not found.")
    existing = await session.get(UserPagePin, {"user_id": user.id, "page_id": page.id})
    if existing is None:
        session.add(UserPagePin(user_id=user.id, page_id=page.id))
        await session.flush()


@router.delete("/me/pins/{page_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Unpin a page")
async def unpin_page(page_id: uuid.UUID, user: CurrentUser, session: DbSession) -> None:
    await session.execute(
        delete(UserPagePin).where(UserPagePin.user_id == user.id, UserPagePin.page_id == page_id)
    )


@router.get("/me/tags", response_model=list[UserTagRead], summary="List your private profile tags")
async def list_own_tags(user: CurrentUser, session: DbSession) -> list[UserTag]:
    return list(
        await session.scalars(
            select(UserTag).where(UserTag.user_id == user.id).order_by(UserTag.created_at.desc())
        )
    )


@router.post(
    "/me/tags",
    response_model=UserTagRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a private profile tag",
)
async def create_own_tag(payload: UserTagCreate, user: CurrentUser, session: DbSession) -> UserTag:
    name = payload.name.strip()
    existing = await session.scalar(
        select(UserTag).where(UserTag.user_id == user.id, func.lower(UserTag.name) == name.lower())
    )
    if existing is not None:
        raise ConflictError("You already have a tag with that name.", code="user_tag_exists")
    tag = UserTag(user_id=user.id, name=name)
    session.add(tag)
    await session.flush()
    return tag


@router.delete(
    "/me/tags/{tag_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a private profile tag",
)
async def delete_own_tag(tag_id: uuid.UUID, user: CurrentUser, session: DbSession) -> None:
    await session.execute(delete(UserTag).where(UserTag.id == tag_id, UserTag.user_id == user.id))


async def _read_user(session: DbSession, target: User) -> UserRead:
    """Build a `UserRead` with `groups`/`group_memberships`/
    `global_permissions`/`global_permission_overrides`/
    `global_permissions_from_groups` actually populated.

    The plain ORM `User` row has none of those as attributes, so
    `UserRead.model_validate(target)` alone would silently leave every one of
    them at its empty default - fine for `list_users` (which never showed
    them and still fills `groups` in separately), but wrong for the single-
    user reads the Edit User modal's Global Access and Groups tabs depend
    on."""
    group_rows = (
        await session.execute(
            select(Group.id, Group.name)
            .join(GroupMember, GroupMember.group_id == Group.id)
            .where(GroupMember.user_id == target.id, Group.is_active.is_(True))
            .order_by(Group.name)
        )
    ).all()
    permissions = PermissionService(session)
    global_permissions = await permissions.global_permissions(target)
    global_permissions_from_groups = await permissions.group_derived_global_permissions(target)
    is_effective_admin = await permissions.is_system_admin(target)
    override_rows = (
        await session.execute(
            select(
                UserGlobalPermissionOverride.permission, UserGlobalPermissionOverride.enabled
            ).where(UserGlobalPermissionOverride.user_id == target.id)
        )
    ).all()
    return UserRead.model_validate(target).model_copy(
        update={
            "groups": [name for _group_id, name in group_rows],
            "group_memberships": [
                UserGroupMembership(id=group_id, name=name) for group_id, name in group_rows
            ],
            "global_permissions": global_permissions,
            "global_permission_overrides": [
                GlobalPermissionOverride(permission=permission, enabled=enabled)
                for permission, enabled in override_rows
            ],
            "global_permissions_from_groups": global_permissions_from_groups,
            "is_effective_admin": is_effective_admin,
        }
    )


@router.get(
    "/administrators",
    response_model=list[AdminAccountRead],
    summary="List every account that currently holds system_admin",
)
async def list_administrators(user: CurrentUser, session: DbSession) -> list[AdminAccountRead]:
    """Registered ahead of `GET /{user_id}` on purpose - `user_id` is typed as
    a UUID path param, and Starlette matches routes in registration order, so
    this literal path must come first or a request here would 422 trying to
    parse "administrators" as one instead of falling through to this route.
    """
    await PermissionService(session).require_global(user, GlobalPermission.manage_users)
    admins = await PermissionService(session).list_effective_system_admins()
    return [
        AdminAccountRead(
            **(await _read_user(session, account)).model_dump(),
            admin_source=source,
            granted_by=granted_by,
            granted_via_group=granted_via_group,
        )
        for account, source, granted_by, granted_via_group in admins
    ]


@router.get(
    "/permission-overrides",
    response_model=list[UserRead],
    summary="List every account with at least one Global Access override",
)
async def list_permission_override_users(user: CurrentUser, session: DbSession) -> list[UserRead]:
    """The People directory's own row data never carries per-user overrides
    (see `_read_user`'s docstring) - there was previously no way to see
    *which* accounts have one without opening each Edit dialog in turn and
    checking its Global Access tab. Registered ahead of `GET /{user_id}` on
    purpose, same reason as `/administrators` above: Starlette matches
    routes in registration order, and `user_id` is typed as a UUID path
    param, so this literal path must come first.
    """
    await PermissionService(session).require_global(user, GlobalPermission.manage_users)
    # One query for *which* accounts have any override at all, rather than
    # running `_read_user`'s own per-account override query against every
    # user in the workspace - only the (typically small) matching subset
    # ever pays for a full `_read_user`.
    user_ids = (
        await session.execute(select(UserGlobalPermissionOverride.user_id).distinct())
    ).scalars().all()
    if not user_ids:
        return []
    accounts = (
        await session.execute(
            select(User).where(User.id.in_(user_ids)).order_by(User.username)
        )
    ).scalars().all()
    return [await _read_user(session, account) for account in accounts]


@router.get("/{user_id}", response_model=UserRead, summary="Read a user")
async def get_user(user_id: uuid.UUID, user: CurrentUser, session: DbSession) -> UserRead:
    await PermissionService(session).require_global(user, GlobalPermission.manage_users)
    target = await session.get(User, user_id)
    if target is None:
        raise NotFoundError("User not found.")
    return await _read_user(session, target)


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
    # Also reachable with just `manage_groups`: the Groups admin page lists
    # users to populate its member picker, and someone trusted to manage
    # group membership has just as real a reason to browse this directory as
    # someone trusted to manage accounts outright - see `require_any_global`.
    await PermissionService(session).require_any_global(
        user, [GlobalPermission.manage_users, GlobalPermission.manage_groups]
    )
    users, total = await service.search_users(
        q=q, status=status_filter, role=role, limit=limit, offset=offset
    )
    group_names: dict[uuid.UUID, list[str]] = {item.id: [] for item in users}
    # One bulk query for *every* effective admin in the workspace, same as
    # the Administrators tab uses - reading `is_effective_admin` per row via
    # `PermissionService.is_system_admin(item)` instead would mean one extra
    # round-trip (group joins included) per user on the page. The set this
    # returns is typically tiny regardless of how many users are being
    # listed, so this stays a flat cost rather than growing with `limit`.
    admin_ids: set[uuid.UUID] = set()
    if users:
        rows = await session.execute(
            select(GroupMember.user_id, Group.name)
            .join(Group, Group.id == GroupMember.group_id)
            .where(GroupMember.user_id.in_(group_names), Group.is_active.is_(True))
            .order_by(Group.name)
        )
        for user_id, group_name in rows:
            group_names[user_id].append(group_name)
        admin_ids = {
            account.id
            for account, *_rest in await PermissionService(session).list_effective_system_admins()
        }
    result = [
        UserRead.model_validate(item).model_copy(
            update={
                "groups": group_names[item.id],
                "is_effective_admin": item.id in admin_ids,
            }
        )
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
    created = await service.create_user(payload)
    return await _read_user(session, created)


@router.patch("/{user_id}", response_model=UserRead, summary="Update a user")
async def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    user: CurrentUser,
    session: DbSession,
    service: ActingAuthServiceDep,
) -> UserRead:
    await PermissionService(session).require_global(user, GlobalPermission.manage_users)
    updated = await service.update_user(user_id, payload)
    return await _read_user(session, updated)


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
    return await _read_user(session, updated)


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
