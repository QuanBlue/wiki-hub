import inspect
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession
from app.core.exceptions import PermissionDeniedError
from app.models.page import WikiPage
from app.models.permission import (
    GlobalPermission,
    Group,
    GroupGlobalPermission,
    GroupMember,
    GroupOwner,
    SpaceGroupPermission,
)
from app.models.restriction import PageGroupRestriction
from app.models.space import Space
from app.models.user import User
from app.modules.permissions.service import PermissionService
from app.schemas.permission import (
    GroupCreate,
    GroupMemberRead,
    GroupMemberUpsert,
    GroupPagePermissionEntry,
    GroupPageUsage,
    GroupRead,
    GroupSpaceUsage,
    GroupUpdate,
    GroupUsageRead,
)

router = APIRouter(prefix="/groups", tags=["groups"])


def get_service(session: DbSession) -> PermissionService:
    return PermissionService(session)


ServiceDep = Annotated[PermissionService, Depends(get_service)]


async def _safe_refresh(session: Any, instance: Any) -> None:
    refresh = getattr(session, "refresh", None)
    if refresh is not None:
        try:
            res = refresh(instance)
            if inspect.isawaitable(res):
                await res
        except Exception:
            pass


def _is_uuid(val: Any) -> bool:
    if isinstance(val, UUID):
        return True
    if isinstance(val, str):
        try:
            UUID(val)
            return True
        except ValueError:
            return False
    return False


async def group_read(session: DbSession, group: Group) -> GroupRead:
    await _safe_refresh(session, group)
    owner = await session.get(User, group.owner_id)
    count = await session.scalar(
        select(func.count()).select_from(GroupMember).where(GroupMember.group_id == group.id)
    )
    global_permissions = list(
        await session.scalars(
            select(GroupGlobalPermission.permission).where(
                GroupGlobalPermission.group_id == group.id
            )
        )
    )
    raw_owner_ids = list(
        await session.scalars(
            select(GroupOwner.user_id).where(GroupOwner.group_id == group.id)
        )
    )
    owner_ids = [uid for uid in raw_owner_ids if _is_uuid(uid)]
    if not owner_ids and group.owner_id:
        owner_ids = [group.owner_id]

    space_count = await session.scalar(
        select(func.count(func.distinct(SpaceGroupPermission.space_id))).where(
            SpaceGroupPermission.group_id == group.id
        )
    )
    page_count = await session.scalar(
        select(func.count(func.distinct(PageGroupRestriction.page_id))).where(
            PageGroupRestriction.group_id == group.id
        )
    )

    return GroupRead(
        id=group.id,
        name=group.name,
        description=group.description,
        owner_id=group.owner_id,
        owner_username=owner.username if owner else None,
        owner_ids=owner_ids,
        is_active=group.is_active,
        member_count=int(count or 0),
        created_at=group.created_at,
        updated_at=group.updated_at,
        global_permissions=global_permissions,
        space_count=int(space_count or 0),
        page_count=int(page_count or 0),
    )


async def group_usage(session: DbSession, group: Group) -> GroupUsageRead:
    """Every Space/Page this group is granted access to right now - what
    `delete_group`'s `group_in_use` error refers to, spelled out so an
    operator does not have to guess or hunt through every Space's Access
    panel and every Page's Restrictions to find them."""
    space_rows = (
        await session.execute(
            select(Space.id, Space.key, Space.name, SpaceGroupPermission.permission)
            .join(SpaceGroupPermission, SpaceGroupPermission.space_id == Space.id)
            .where(SpaceGroupPermission.group_id == group.id)
            .order_by(Space.name)
        )
    ).all()
    spaces: dict[UUID, GroupSpaceUsage] = {}
    for space_id, key, name, permission in space_rows:
        usage = spaces.setdefault(
            space_id,
            GroupSpaceUsage(space_id=space_id, space_key=key, space_name=name, permissions=[]),
        )
        usage.permissions.append(permission)

    page_rows = (
        await session.execute(
            select(
                WikiPage.id,
                WikiPage.title,
                WikiPage.slug,
                Space.id,
                Space.key,
                Space.name,
                PageGroupRestriction.permission,
                PageGroupRestriction.denied,
            )
            .join(PageGroupRestriction, PageGroupRestriction.page_id == WikiPage.id)
            .join(Space, Space.id == WikiPage.space_id)
            .where(PageGroupRestriction.group_id == group.id)
            .order_by(Space.name, WikiPage.title)
        )
    ).all()
    pages: dict[UUID, GroupPageUsage] = {}
    for page_id, title, slug, space_id, space_key, space_name, permission, denied in page_rows:
        usage = pages.setdefault(
            page_id,
            GroupPageUsage(
                page_id=page_id,
                page_title=title,
                page_slug=slug,
                space_id=space_id,
                space_key=space_key,
                space_name=space_name,
                entries=[],
            ),
        )
        usage.entries.append(GroupPagePermissionEntry(permission=permission, denied=denied))

    return GroupUsageRead(spaces=list(spaces.values()), pages=list(pages.values()))


@router.get("", response_model=list[GroupRead])
async def list_groups(
    user: CurrentUser,
    session: DbSession,
    service: ServiceDep,
    q: str | None = Query(default=None),
) -> list[GroupRead]:
    await service.require_global(user, GlobalPermission.manage_groups)
    stmt = select(Group).order_by(Group.name)
    if q:
        stmt = stmt.where(func.lower(Group.name).contains(q.strip().lower()))
    groups = (await session.execute(stmt)).scalars().all()
    return [await group_read(session, group) for group in groups]


@router.post("", response_model=GroupRead, status_code=status.HTTP_201_CREATED)
async def create_group(
    payload: GroupCreate, user: CurrentUser, service: ServiceDep, session: DbSession
) -> GroupRead:
    group = await service.create_group(payload, user)
    return await group_read(session, group)


@router.get("/{group_id}", response_model=GroupRead)
async def get_group(
    group_id: UUID, user: CurrentUser, service: ServiceDep, session: DbSession
) -> GroupRead:
    group = await service.get_group(group_id)
    if not await service.can_manage_group(group, user):
        raise PermissionDeniedError("You cannot view this group.")
    return await group_read(session, group)


@router.patch("/{group_id}", response_model=GroupRead)
async def update_group(
    group_id: UUID,
    payload: GroupUpdate,
    user: CurrentUser,
    service: ServiceDep,
    session: DbSession,
) -> GroupRead:
    group = await service.update_group(await service.get_group(group_id), payload, user)
    return await group_read(session, group)


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(group_id: UUID, user: CurrentUser, service: ServiceDep) -> None:
    await service.delete_group(await service.get_group(group_id), user)


@router.get("/{group_id}/usage", response_model=GroupUsageRead)
async def get_group_usage(
    group_id: UUID, user: CurrentUser, service: ServiceDep, session: DbSession
) -> GroupUsageRead:
    group = await service.get_group(group_id)
    if not await service.can_manage_group(group, user):
        raise PermissionDeniedError("You cannot view this group.")
    return await group_usage(session, group)


@router.get("/{group_id}/members", response_model=list[GroupMemberRead])
async def list_group_members(
    group_id: UUID, user: CurrentUser, service: ServiceDep, session: DbSession
) -> list[GroupMemberRead]:
    group = await service.get_group(group_id)
    if not await service.can_manage_group(group, user):
        raise PermissionDeniedError("You cannot view this group's members.")
    rows = (
        (
            await session.execute(
                select(User)
                .join(GroupMember, GroupMember.user_id == User.id)
                .where(GroupMember.group_id == group.id)
                .order_by(User.username)
            )
        )
        .scalars()
        .all()
    )
    return [
        GroupMemberRead(user_id=row.id, username=row.username, full_name=row.full_name, email=row.email)
        for row in rows
    ]


@router.put("/{group_id}/members", status_code=status.HTTP_204_NO_CONTENT)
async def add_group_member(
    group_id: UUID, payload: GroupMemberUpsert, user: CurrentUser, service: ServiceDep
) -> None:
    await service.set_group_member(await service.get_group(group_id), payload.user_id, user, True)


@router.delete("/{group_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_group_member(
    group_id: UUID, user_id: UUID, user: CurrentUser, service: ServiceDep
) -> None:
    await service.set_group_member(await service.get_group(group_id), user_id, user, False)


@router.put("/{group_id}/global-permissions/{permission}", status_code=status.HTTP_204_NO_CONTENT)
async def add_global_permission(
    group_id: UUID, permission: GlobalPermission, admin: CurrentUser, service: ServiceDep
) -> None:
    await service.set_group_global_permission(
        await service.get_group(group_id), permission, admin, True
    )


@router.delete(
    "/{group_id}/global-permissions/{permission}", status_code=status.HTTP_204_NO_CONTENT
)
async def remove_global_permission(
    group_id: UUID, permission: GlobalPermission, admin: CurrentUser, service: ServiceDep
) -> None:
    await service.set_group_global_permission(
        await service.get_group(group_id), permission, admin, False
    )
