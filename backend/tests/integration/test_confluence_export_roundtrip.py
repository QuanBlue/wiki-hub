"""Confluence DC export -> Confluence import, exercised end to end.

Regression coverage for a real bug the user hit testing against real
Confluence: `write_confluence_dc_export` used to carry no permission or
authorship data at all, so importing the archive back gave a space with
nobody on it but the importing administrator - every other user
"disappeared", including ones with real space/page-level access. See
`confluence_export.py`'s own module docstring for the shape of the fix.

This drives the actual export writer and the actual `run_import` worker
together, rather than asserting on either one's internals in isolation -
the same two features the user chained together manually.
"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_job import ImportArchive, ImportJob
from app.models.page import WikiPage
from app.models.permission import (
    Group,
    GroupMember,
    Permission,
    SpaceGroupPermission,
    SpaceUserPermission,
)
from app.models.restriction import PageRestrictionPermission, PageUserRestriction
from app.models.space import Space, SpaceOwner, SpaceVisibility
from app.models.user import User
from app.modules.auth.service import AuthService
from app.modules.backup.confluence_export import write_confluence_dc_export
from app.modules.import_export.service import run_import
from app.modules.permissions.service import PermissionService
from app.modules.spaces.service import SpaceService
from app.schemas.space import SpaceCreate
from app.schemas.user import UserCreate

pytestmark = pytest.mark.integration


def _name(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:8]}"


async def _user(session: AsyncSession, prefix: str) -> User:
    return await AuthService(session).create_user(
        UserCreate(
            username=_name(prefix),
            email=f"{_name(prefix)}@example.com",
            full_name=prefix,
            password="password-1234",
        )
    )


class _FileStorage:
    """Feeds `run_import` the exact bytes `write_confluence_dc_export`
    produced, the same way a real download from object storage would."""

    def __init__(self, path: str) -> None:
        self._path = path

    async def download_to_file(self, _key: str, destination: str, on_progress=None) -> None:
        shutil.copyfile(self._path, destination)
        if on_progress:
            await on_progress(1)


async def test_confluence_dc_export_round_trip_preserves_members_authors_and_restrictions(
    session: AsyncSession, tmp_path: Path
) -> None:
    importer = await _user(session, "importer")
    owner_only = await _user(session, "owneronly")
    admin_user = await _user(session, "spaceadmin")
    editor_user = await _user(session, "editor")
    viewer_user = await _user(session, "viewer")
    group_member = await _user(session, "groupmember")

    spaces = SpaceService(session)
    space = await spaces.create(
        SpaceCreate(key=_name("ENG").upper()[:10], name="Engineering", visibility=SpaceVisibility.restricted),
        importer,
    )

    # Replace the creator's automatic Owner row with a distinct Owner-only
    # principal, to prove SpaceOwner (not just SpaceUserPermission) survives.
    await session.execute(delete(SpaceOwner).where(SpaceOwner.space_id == space.id))
    session.add(SpaceOwner(space_id=space.id, user_id=owner_only.id))

    session.add_all(
        [
            SpaceUserPermission(space_id=space.id, user_id=admin_user.id, permission=Permission.admin),
            SpaceUserPermission(space_id=space.id, user_id=editor_user.id, permission=Permission.add),
            SpaceUserPermission(space_id=space.id, user_id=viewer_user.id, permission=Permission.view),
        ]
    )

    group = Group(name=_name("eng-team"), description="", owner_id=importer.id)
    session.add(group)
    await session.flush()
    session.add(GroupMember(group_id=group.id, user_id=group_member.id))
    session.add(SpaceGroupPermission(space_id=space.id, group_id=group.id, permission=Permission.view))

    parent = WikiPage(
        space_id=space.id, title="Parent", slug="parent", content="<p>parent</p>",
        content_format="html", created_by_id=editor_user.id, updated_by_id=editor_user.id,
    )
    session.add(parent)
    await session.flush()
    child = WikiPage(
        space_id=space.id, parent_id=parent.id, title="Child", slug="child", content="<p>child</p>",
        content_format="html", created_by_id=viewer_user.id, updated_by_id=viewer_user.id,
        view_restricted=True,
    )
    session.add(child)
    await session.flush()
    session.add(
        PageUserRestriction(
            page_id=child.id, user_id=viewer_user.id, permission=PageRestrictionPermission.view
        )
    )
    await session.flush()

    # Exactly the raw rows jobs.py gathers for a real confluence_export job.
    all_pages = list(
        (await session.execute(select(WikiPage).where(WikiPage.space_id == space.id))).scalars()
    )
    all_users = list((await session.execute(select(User))).scalars())
    all_groups = list((await session.execute(select(Group))).scalars())
    all_group_members = list((await session.execute(select(GroupMember))).scalars())
    all_space_owners = list((await session.execute(select(SpaceOwner))).scalars())
    all_space_user_permissions = list(
        (await session.execute(select(SpaceUserPermission))).scalars()
    )
    all_space_group_permissions = list(
        (await session.execute(select(SpaceGroupPermission))).scalars()
    )
    all_page_user_restrictions = list(
        (await session.execute(select(PageUserRestriction))).scalars()
    )

    export_path = str(tmp_path / "export.zip")
    await write_confluence_dc_export(
        export_path,
        AsyncMock(),
        profile="dc-8",
        spaces=[space],
        pages=all_pages,
        attachments=[],
        users=all_users,
        groups=all_groups,
        group_members=all_group_members,
        space_owners=all_space_owners,
        space_user_permissions=all_space_user_permissions,
        space_group_permissions=all_space_group_permissions,
        page_user_restrictions=all_page_user_restrictions,
        page_group_restrictions=[],
    )

    original_key = space.key
    # Simulate importing into a clean instance: the source space (and every
    # row FK-cascaded off it) is gone by the time the archive comes back.
    # The Users/Group rows are left standing - `run_import` is expected to
    # resolve permissions/authorship against them by username, not recreate
    # them from scratch (the export deliberately never carries full accounts).
    await session.execute(delete(Space).where(Space.id == space.id))
    await session.flush()

    archive = ImportArchive(
        object_key="test/export.zip",
        filename="export.zip",
        size_bytes=Path(export_path).stat().st_size,
        sha256="a" * 64,
        status="scanned",
        created_by_id=importer.id,
        spaces=[{"key": original_key, "name": "Engineering", "page_count": len(all_pages)}],
    )
    session.add(archive)
    await session.flush()
    job = ImportJob(
        archive_id=archive.id,
        created_by_id=importer.id,
        import_all=True,
        space_keys=[],
        overwrite_existing=False,
        status="queued",
        phase="queued",
        counters={},
    )
    session.add(job)
    await session.flush()

    await run_import(session, _FileStorage(export_path), job.id)
    await session.refresh(job)
    assert job.status == "completed", job.counters

    permissions = PermissionService(session)
    restored_space = await spaces.get_by_key(original_key)
    assert restored_space is not None
    assert restored_space.visibility == SpaceVisibility.restricted

    # Confluence's own permission model has no concept distinct from "space
    # admin" - WikiHub's Owner tier sits on top of it and cannot survive a
    # Confluence-shaped round trip as anything other than Admin. That is an
    # inherent limit of the export *format*, not a bug: the destination
    # import path (import_export/service.py) is explicitly out of scope here
    # per the user's own instruction, so an Owner coming back as a regular
    # Admin - full access, just not the one-of-a-kind "cannot be revoked to
    # zero" guarantee - is the correct, best-achievable outcome, not a defect
    # to chase. What matters is that they don't vanish, which this asserts.
    for user, expected in (
        (owner_only, Permission.admin),
        (admin_user, Permission.admin),
        (editor_user, Permission.add),
        (viewer_user, Permission.view),
    ):
        effective = await permissions.effective_permissions(restored_space, user)
        assert expected in effective, (user.username, effective)

    restored_group_permission = (
        await session.execute(
            select(SpaceGroupPermission).where(
                SpaceGroupPermission.space_id == restored_space.id,
                SpaceGroupPermission.group_id == group.id,
            )
        )
    ).scalar_one_or_none()
    assert restored_group_permission is not None
    assert restored_group_permission.permission == Permission.view

    restored_child = (
        await session.execute(
            select(WikiPage).where(WikiPage.space_id == restored_space.id, WikiPage.title == "Child")
        )
    ).scalar_one_or_none()
    assert restored_child is not None
    assert restored_child.created_by_id == viewer_user.id

    restored_restriction = (
        await session.execute(
            select(PageUserRestriction).where(
                PageUserRestriction.page_id == restored_child.id,
                PageUserRestriction.user_id == viewer_user.id,
            )
        )
    ).scalar_one_or_none()
    assert restored_restriction is not None
    assert restored_restriction.permission == PageRestrictionPermission.view
