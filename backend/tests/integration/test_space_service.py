"""Space rules against a real PostgreSQL database.

Shares the throwaway-schema fixture strategy documented in
``test_auth_service``.
"""

from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, NotFoundError, PermissionDeniedError
from app.models.space import SpaceRole, SpaceStatus, SpaceVisibility
from app.models.user import User
from app.modules.auth.service import AuthService
from app.modules.spaces.service import SpaceService
from app.schemas.space import SpaceCreate, SpaceUpdate
from app.schemas.user import UserCreate

pytestmark = pytest.mark.integration

TEST_DB_URL = os.environ.get("WIKIHUB_TEST_DATABASE_URL")


def _uniq(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:8]}"


async def _make_user(session: AsyncSession, *, superuser: bool = False) -> User:
    return await AuthService(session).create_user(
        UserCreate(
            username=_uniq("u"),
            email=f"{_uniq('u')}@example.com",
            full_name="Test User",
            password="password-1234",
            is_superuser=superuser,
        )
    )


class TestCreateSpace:
    async def test_creator_becomes_space_admin(self, session: AsyncSession) -> None:
        service = SpaceService(session)
        creator = await _make_user(session)

        space = await service.create(SpaceCreate(key="ENG", name="Engineering"), creator)

        # A space must never exist without someone able to administer it.
        assert await service.role_of(space, creator) is SpaceRole.admin
        assert space.status is SpaceStatus.active

    async def test_key_is_normalised_to_upper_case(self, session: AsyncSession) -> None:
        service = SpaceService(session)
        creator = await _make_user(session)

        space = await service.create(SpaceCreate(key="dev-ops", name="DevOps"), creator)
        assert space.key == "DEV_OPS"

    async def test_duplicate_key_is_rejected(self, session: AsyncSession) -> None:
        service = SpaceService(session)
        creator = await _make_user(session)
        await service.create(SpaceCreate(key="ENG", name="Engineering"), creator)

        with pytest.raises(ConflictError):
            await service.create(SpaceCreate(key="eng", name="Duplicate"), creator)

    async def test_invalid_key_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="Key must start with a letter"):
            SpaceCreate(key="1bad!", name="Nope")

    async def test_name_starting_with_a_digit_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="Name must start with a letter"):
            SpaceCreate(key="ENG", name="123")

    async def test_name_starting_with_special_character_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="Name must start with a letter"):
            SpaceCreate(key="ENG", name="#Engineering")

    async def test_name_starting_with_accented_letter_is_accepted(
        self, session: AsyncSession
    ) -> None:
        service = SpaceService(session)
        creator = await _make_user(session)

        space = await service.create(
            SpaceCreate(key="ENG", name="Ứng dụng"), creator
        )
        assert space.name == "Ứng dụng"


class TestSpacePermissions:
    async def test_non_member_cannot_update(self, session: AsyncSession) -> None:
        service = SpaceService(session)
        owner = await _make_user(session)
        outsider = await _make_user(session)
        space = await service.create(SpaceCreate(key="ENG", name="Engineering"), owner)

        with pytest.raises(PermissionDeniedError):
            await service.update(space, SpaceUpdate(name="Hijacked"), outsider)

    async def test_viewer_cannot_update(self, session: AsyncSession) -> None:
        service = SpaceService(session)
        owner = await _make_user(session)
        viewer = await _make_user(session)
        space = await service.create(SpaceCreate(key="ENG", name="Engineering"), owner)
        await service.set_member(space, owner, viewer.id, SpaceRole.viewer)

        with pytest.raises(PermissionDeniedError):
            await service.update(space, SpaceUpdate(name="Nope"), viewer)

    async def test_space_admin_can_update(self, session: AsyncSession) -> None:
        service = SpaceService(session)
        owner = await _make_user(session)
        space = await service.create(SpaceCreate(key="ENG", name="Engineering"), owner)

        updated = await service.update(space, SpaceUpdate(name="Engineering Docs"), owner)
        assert updated.name == "Engineering Docs"

    async def test_rename_starting_with_a_digit_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="Name must start with a letter"):
            SpaceUpdate(name="2Engineering")

    async def test_superuser_can_update_any_space(self, session: AsyncSession) -> None:
        service = SpaceService(session)
        owner = await _make_user(session)
        root = await _make_user(session, superuser=True)
        space = await service.create(SpaceCreate(key="ENG", name="Engineering"), owner)

        updated = await service.update(space, SpaceUpdate(name="Renamed"), root)
        assert updated.name == "Renamed"

    async def test_space_admin_can_hard_delete(self, session: AsyncSession) -> None:
        service = SpaceService(session)
        owner = await _make_user(session)
        space = await service.create(SpaceCreate(key="ENG", name="Engineering"), owner)

        await service.delete(space, owner)
        assert await service.spaces.get_by_key("ENG") is None

    async def test_editor_cannot_hard_delete(self, session: AsyncSession) -> None:
        service = SpaceService(session)
        owner = await _make_user(session)
        editor = await _make_user(session)
        space = await service.create(SpaceCreate(key="ENG", name="Engineering"), owner)
        await service.set_member(space, owner, editor.id, SpaceRole.editor)

        with pytest.raises(PermissionDeniedError):
            await service.delete(space, editor)

    async def test_superuser_can_hard_delete(self, session: AsyncSession) -> None:
        service = SpaceService(session)
        owner = await _make_user(session)
        root = await _make_user(session, superuser=True)
        space = await service.create(SpaceCreate(key="ENG", name="Engineering"), owner)

        await service.delete(space, root)
        assert await service.spaces.get_by_key("ENG") is None


class TestArchiving:
    async def test_archive_hides_from_the_default_listing(self, session: AsyncSession) -> None:
        service = SpaceService(session)
        owner = await _make_user(session)
        space = await service.create(SpaceCreate(key="OPS", name="DevOps"), owner)

        await service.archive(space, owner)

        assert [s.key for s in await service.spaces.list_spaces()] == []
        archived = await service.spaces.list_spaces(include_archived=True)
        assert [s.key for s in archived] == ["OPS"]

    async def test_archived_space_is_still_retrievable(self, session: AsyncSession) -> None:
        # Archive is a soft delete: the content must survive.
        service = SpaceService(session)
        owner = await _make_user(session)
        space = await service.create(SpaceCreate(key="OPS", name="DevOps"), owner)
        await service.archive(space, owner)

        found = await service.get_by_key("OPS")
        assert found.status is SpaceStatus.archived

    async def test_unarchive_restores_a_space_to_the_default_listing(
        self, session: AsyncSession
    ) -> None:
        service = SpaceService(session)
        owner = await _make_user(session)
        space = await service.create(SpaceCreate(key="OPS", name="DevOps"), owner)
        await service.archive(space, owner)

        restored = await service.unarchive(space, owner)

        assert restored.status is SpaceStatus.active
        assert [item.key for item in await service.spaces.list_spaces()] == ["OPS"]


class TestMembership:
    async def test_add_and_change_a_member_role(self, session: AsyncSession) -> None:
        # Restricted, not the SpaceCreate default of Open - an Open space
        # now hands every member View *and* Add/Edit regardless of their own
        # role (see OPEN_SPACE_PERMISSIONS), so a role change would not be
        # observable on `role_of` there.
        service = SpaceService(session)
        owner = await _make_user(session)
        other = await _make_user(session)
        space = await service.create(
            SpaceCreate(key="ENG", name="Engineering", visibility=SpaceVisibility.restricted),
            owner,
        )

        await service.set_member(space, owner, other.id, SpaceRole.viewer)
        assert await service.role_of(space, other) is SpaceRole.viewer

        await service.set_member(space, owner, other.id, SpaceRole.editor)
        assert await service.role_of(space, other) is SpaceRole.editor

    async def test_removing_the_creators_membership_leaves_them_owning_the_space(
        self, session: AsyncSession
    ) -> None:
        # The "last admin" protection this used to hit is superseded by the
        # Owner guarantee: the creator is always the space's first Owner
        # (see SpaceOwner), so stripping their admin membership/permission
        # row is harmless - `effective_permissions` still grants them
        # everything unconditionally, so the space is never left
        # unmanageable even though this particular call now succeeds
        # instead of raising.
        service = SpaceService(session)
        owner = await _make_user(session)
        space = await service.create(SpaceCreate(key="ENG", name="Engineering"), owner)

        await service.remove_member(space, owner, owner.id)
        assert await service.role_of(space, owner) is SpaceRole.admin

    async def test_can_remove_an_admin_once_another_exists(self, session: AsyncSession) -> None:
        service = SpaceService(session)
        owner = await _make_user(session)
        second = await _make_user(session)
        space = await service.create(SpaceCreate(key="ENG", name="Engineering"), owner)
        await service.set_member(space, owner, second.id, SpaceRole.admin)

        await service.remove_member(space, owner, owner.id)
        # The creator keeps full access as the space's Owner even after
        # their own membership row and admin permission grant are both gone.
        assert await service.role_of(space, owner) is SpaceRole.admin

    async def test_adding_an_unknown_user_is_rejected(self, session: AsyncSession) -> None:
        service = SpaceService(session)
        owner = await _make_user(session)
        space = await service.create(SpaceCreate(key="ENG", name="Engineering"), owner)

        with pytest.raises(NotFoundError):
            await service.set_member(space, owner, uuid.uuid4(), SpaceRole.viewer)


class TestFavorites:
    async def test_toggle_favorite(self, session: AsyncSession) -> None:
        service = SpaceService(session)
        user = await _make_user(session)
        space = await service.create(SpaceCreate(key="ENG", name="Engineering"), user)

        await service.set_favorite(space, user, True)
        assert [s.key for s in await service.spaces.list_favorites(user.id)] == ["ENG"]

        await service.set_favorite(space, user, False)
        assert await service.spaces.list_favorites(user.id) == []

    async def test_favoriting_twice_is_idempotent(self, session: AsyncSession) -> None:
        service = SpaceService(session)
        user = await _make_user(session)
        space = await service.create(SpaceCreate(key="ENG", name="Engineering"), user)

        await service.set_favorite(space, user, True)
        await service.set_favorite(space, user, True)

        assert len(await service.spaces.list_favorites(user.id)) == 1

    async def test_favorites_are_per_user(self, session: AsyncSession) -> None:
        service = SpaceService(session)
        one = await _make_user(session)
        two = await _make_user(session)
        space = await service.create(SpaceCreate(key="ENG", name="Engineering"), one)

        await service.set_favorite(space, one, True)

        assert len(await service.spaces.list_favorites(one.id)) == 1
        assert await service.spaces.list_favorites(two.id) == []
