"""Auth service rules against a real PostgreSQL database.

These exercise the invariants that protect the instance from being locked out:
the bootstrap administrator must survive every write path.

Requires the compose stack. Point ``WIKIHUB_TEST_DATABASE_URL`` at a database
that may be freely written to, e.g.::

    WIKIHUB_TEST_DATABASE_URL=postgresql+asyncpg://wikihub:pass@localhost:55432/wikihub \\
        pytest -m integration
"""

from __future__ import annotations

import json
import os
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    AuthenticationError,
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
)
from app.models.audit import AuditAction, AuditLog
from app.models.permission import GlobalPermission, Group, GroupMember
from app.models.user import User
from app.modules.auth.service import AuthService
from app.modules.permissions.service import PermissionService
from app.schemas.user import UserCreate, UserUpdate
from tests.integration.conftest import unique

pytestmark = pytest.mark.integration

TEST_DB_URL = os.environ.get("WIKIHUB_TEST_DATABASE_URL")


async def _make_protected_admin(service: AuthService) -> object:
    admin, created, _rotated, _changed = await service.ensure_bootstrap_admin(
        username=unique("admin"),
        password="admin123",
        email=f"{unique('admin')}@wikihub.local",
        full_name="WikiHub Administrator",
    )
    assert created is True
    return admin


class TestBootstrapAdmin:
    async def test_is_created_protected_and_superuser(self, session: AsyncSession) -> None:
        service = AuthService(session)
        admin = await _make_protected_admin(service)

        assert admin.is_protected is True
        assert admin.is_superuser is True
        assert admin.is_active is True
        # The password is stored only as a hash.
        assert admin.password_hash and "admin123" not in admin.password_hash

    async def test_reseeding_with_identical_values_is_a_true_no_op(
        self, session: AsyncSession
    ) -> None:
        service = AuthService(session)
        admin = await _make_protected_admin(service)
        original_hash = admin.password_hash

        again, created, rotated, changed = await service.ensure_bootstrap_admin(
            username=admin.username,
            password="admin123",
            email=admin.email,
            full_name=admin.full_name,
        )

        assert created is False
        assert rotated is False
        assert changed is False
        assert again.id == admin.id
        assert again.password_hash == original_hash

    async def test_reseeding_with_a_different_password_rotates_it(
        self, session: AsyncSession
    ) -> None:
        """Changing WIKIHUB_ADMIN_PASSWORD and restarting is the supported
        way to rotate this account's credential - it has no other write path
        (see TestProtectedAccountIsImmutable below)."""
        service = AuthService(session)
        admin = await _make_protected_admin(service)
        original_hash = admin.password_hash

        again, created, rotated, changed = await service.ensure_bootstrap_admin(
            username=admin.username,
            password="a-totally-different-password",
            email=admin.email,
            full_name=admin.full_name,
        )

        assert created is False
        assert rotated is True
        assert changed is False
        assert again.id == admin.id
        assert again.password_hash != original_hash
        assert again.username == admin.username

        assert (
            await service.authenticate(admin.username, "a-totally-different-password")
        ).id == admin.id
        with pytest.raises(AuthenticationError):
            await service.authenticate(admin.username, "admin123")

    async def test_reseeding_with_a_different_identity_resyncs_it(
        self, session: AsyncSession
    ) -> None:
        """Changing WIKIHUB_ADMIN_USERNAME/EMAIL/FULL_NAME and restarting is
        the supported way to change this account's identity too - it has no
        other write path (see TestProtectedAccountIsImmutable below)."""
        service = AuthService(session)
        admin = await _make_protected_admin(service)
        # `admin` and the object ensure_bootstrap_admin returns are the same
        # row, mutated in place - capture the old username before it changes.
        original_username = admin.username

        again, created, rotated, changed = await service.ensure_bootstrap_admin(
            username="renamed-admin",
            password="admin123",
            email="renamed-admin@wikihub.local",
            full_name="Renamed Admin",
        )

        assert created is False
        assert rotated is False
        assert changed is True
        assert again.id == admin.id
        assert again.username == "renamed-admin"
        assert again.email == "renamed-admin@wikihub.local"
        assert again.full_name == "Renamed Admin"

        # Sign-in follows the new username, not the old one.
        assert (await service.authenticate("renamed-admin", "admin123")).id == admin.id
        with pytest.raises(AuthenticationError):
            await service.authenticate(original_username, "admin123")

    async def test_reseeding_leaves_a_colliding_username_or_email_untouched(
        self, session: AsyncSession
    ) -> None:
        """A field that would collide with a *different* account must never
        block startup, and must never steal that account's identity - it is
        simply left as-is, with a warning logged."""
        service = AuthService(session)
        admin = await _make_protected_admin(service)
        original_username, original_email = admin.username, admin.email

        other = await service.create_user(
            UserCreate(
                username=unique("someone-else"),
                email=f"{unique('someone-else')}@example.com",
                full_name="Someone Else",
                password="someone-else-pass-1",
            )
        )

        again, created, rotated, changed = await service.ensure_bootstrap_admin(
            username=other.username,
            password="admin123",
            email=other.email,
            full_name="Attempted Rename",
        )

        assert created is False
        assert rotated is False
        # full_name still changed even though username/email were rejected.
        assert changed is True
        assert again.username == original_username
        assert again.email == original_email
        assert again.full_name == "Attempted Rename"
        # The other account is completely unaffected.
        assert other.username != original_username

    async def test_can_authenticate(self, session: AsyncSession) -> None:
        service = AuthService(session)
        admin = await _make_protected_admin(service)

        authenticated = await service.authenticate(admin.username, "admin123")
        assert authenticated.id == admin.id

    async def test_wrong_password_is_rejected(self, session: AsyncSession) -> None:
        service = AuthService(session)
        admin = await _make_protected_admin(service)

        with pytest.raises(AuthenticationError):
            await service.authenticate(admin.username, "not-the-password")


class TestProtectedAccountIsImmutable:
    """Every write path against the bootstrap admin must be refused.

    The one deliberate exception is `ensure_bootstrap_admin` itself resyncing
    the username/email/full_name/password at seed time when WIKIHUB_ADMIN_*
    no longer matches - see TestBootstrapAdmin's
    test_reseeding_with_a_different_password_rotates_it and
    test_reseeding_with_a_different_identity_resyncs_it. That is not
    reachable through any API endpoint; it only runs from the seed script on
    startup.
    """

    async def test_password_cannot_be_changed(self, session: AsyncSession) -> None:
        service = AuthService(session)
        admin = await _make_protected_admin(service)

        with pytest.raises(PermissionDeniedError):
            await service.change_password(admin.id, "admin123", "a-new-password-123")

        # The original credential still works.
        assert (await service.authenticate(admin.username, "admin123")).id == admin.id

    async def test_cannot_be_deactivated(self, session: AsyncSession) -> None:
        service = AuthService(session)
        admin = await _make_protected_admin(service)

        with pytest.raises(PermissionDeniedError):
            await service.update_user(admin.id, UserUpdate(is_active=False))

        assert admin.is_active is True

    async def test_cannot_be_demoted(self, session: AsyncSession) -> None:
        service = AuthService(session)
        admin = await _make_protected_admin(service)

        with pytest.raises(PermissionDeniedError):
            await service.update_user(admin.id, UserUpdate(is_superuser=False))

        assert admin.is_superuser is True

    async def test_cannot_be_deleted(self, session: AsyncSession) -> None:
        service = AuthService(session)
        admin = await _make_protected_admin(service)

        with pytest.raises(PermissionDeniedError):
            await service.delete_user(admin.id)

        assert await service.users.get(admin.id) is not None


class TestOrdinaryUsers:
    """The same operations must still work for a normal account."""

    async def _make_user(self, service: AuthService) -> object:
        return await service.create_user(
            UserCreate(
                username=unique("user"),
                email=f"{unique('user')}@example.com",
                full_name="Regular User",
                password="user-password-123",
            )
        )

    async def test_password_can_be_changed(self, session: AsyncSession) -> None:
        service = AuthService(session)
        user = await self._make_user(service)

        await service.change_password(user.id, "user-password-123", "brand-new-password")
        assert (await service.authenticate(user.username, "brand-new-password")).id == user.id

    async def test_can_be_deactivated_and_then_cannot_log_in(self, session: AsyncSession) -> None:
        service = AuthService(session)
        user = await self._make_user(service)

        await service.update_user(user.id, UserUpdate(is_active=False))

        with pytest.raises(AuthenticationError):
            await service.authenticate(user.username, "user-password-123")

    async def test_can_be_deleted(self, session: AsyncSession) -> None:
        service = AuthService(session)
        user = await self._make_user(service)

        await service.delete_user(user.id)
        assert await service.users.get(user.id) is None

    async def test_login_accepts_email_as_well_as_username(self, session: AsyncSession) -> None:
        service = AuthService(session)
        user = await self._make_user(service)

        assert (await service.authenticate(user.email, "user-password-123")).id == user.id

    async def test_username_lookup_is_case_insensitive(self, session: AsyncSession) -> None:
        service = AuthService(session)
        user = await self._make_user(service)

        found = await service.authenticate(user.username.upper(), "user-password-123")
        assert found.id == user.id


class TestSelfLockoutGuards:
    """An administrator must not be able to lock themselves — or everyone — out.

    These need a *non-protected* superuser: the bootstrap admin is rejected by
    `assert_mutable` first, so it can never exercise these paths.
    """

    async def _make_superuser(self, session: AsyncSession) -> User:
        return await AuthService(session).create_user(
            UserCreate(
                username=unique("root"),
                email=f"{unique('root')}@example.com",
                full_name="Root",
                password="root-password-1",
                is_superuser=True,
            )
        )

    async def test_cannot_deactivate_self(self, session: AsyncSession) -> None:
        actor = await self._make_superuser(session)
        service = AuthService(session, actor=actor)

        with pytest.raises(ConflictError, match="own account"):
            await service.update_user(actor.id, UserUpdate(is_active=False))

        assert actor.is_active is True

    async def test_cannot_demote_self(self, session: AsyncSession) -> None:
        actor = await self._make_superuser(session)
        service = AuthService(session, actor=actor)

        with pytest.raises(ConflictError, match="administrator role"):
            await service.update_user(actor.id, UserUpdate(is_superuser=False))

        assert actor.is_superuser is True

    async def test_cannot_delete_self(self, session: AsyncSession) -> None:
        actor = await self._make_superuser(session)
        service = AuthService(session, actor=actor)

        with pytest.raises(ConflictError, match="own account"):
            await service.delete_user(actor.id)

        assert await service.users.get(actor.id) is not None

    async def test_cannot_remove_the_last_active_administrator(self, session: AsyncSession) -> None:
        """`_assert_superuser_remains`'s own floor-of-one invariant, exercised
        directly rather than through `update_user`: an ordinary administrator
        acting on a peer one is no longer a reachable path at all now that
        `assert_peer_admin_editable` blocks that pairing outright (see
        `TestPeerAdminProtection` below) - in a normally seeded instance the
        protected account always keeps the count above the floor, exactly as
        its own docstring already says. This still matters for whichever
        caller *can* reach another administrator (the protected account)."""
        target = await self._make_superuser(session)
        service = AuthService(session, actor=target)

        with pytest.raises(ConflictError, match="only active administrator"):
            await service._assert_superuser_remains(target)

    async def test_can_deactivate_another_admin_while_one_remains(
        self, session: AsyncSession
    ) -> None:
        protected = await _make_protected_admin(AuthService(session))
        other = await self._make_superuser(session)

        updated = await AuthService(session, actor=protected).update_user(
            other.id, UserUpdate(is_active=False)
        )

        assert updated.is_active is False


class TestPeerAdminProtection:
    """An ordinary Administrator (`is_superuser`, not `is_protected`) can
    manage every Member, but not a peer Administrator - only the protected
    account may touch those. See `AuthService.assert_peer_admin_editable`."""

    async def _make_superuser(self, session: AsyncSession) -> User:
        return await AuthService(session).create_user(
            UserCreate(
                username=unique("root"),
                email=f"{unique('root')}@example.com",
                full_name="Root",
                password="root-password-1",
                is_superuser=True,
            )
        )

    async def _make_member(self, session: AsyncSession) -> User:
        return await AuthService(session).create_user(
            UserCreate(
                username=unique("member"),
                email=f"{unique('member')}@example.com",
                full_name="Member",
                password="member-password-1",
            )
        )

    async def test_ordinary_admin_cannot_update_a_peer_admin(self, session: AsyncSession) -> None:
        actor = await self._make_superuser(session)
        target = await self._make_superuser(session)

        with pytest.raises(PermissionDeniedError, match="super administrator"):
            await AuthService(session, actor=actor).update_user(
                target.id, UserUpdate(full_name="Renamed")
            )

    async def test_ordinary_admin_cannot_reset_a_peer_admins_password(
        self, session: AsyncSession
    ) -> None:
        actor = await self._make_superuser(session)
        target = await self._make_superuser(session)

        with pytest.raises(PermissionDeniedError, match="super administrator"):
            await AuthService(session, actor=actor).reset_password(target.id, "new-password-123")

    async def test_ordinary_admin_cannot_delete_a_peer_admin(self, session: AsyncSession) -> None:
        actor = await self._make_superuser(session)
        target = await self._make_superuser(session)

        with pytest.raises(PermissionDeniedError, match="super administrator"):
            await AuthService(session, actor=actor).delete_user(target.id)

        assert await AuthService(session).users.get(target.id) is not None

    async def test_ordinary_admin_can_still_manage_an_ordinary_member(
        self, session: AsyncSession
    ) -> None:
        actor = await self._make_superuser(session)
        member = await self._make_member(session)

        updated = await AuthService(session, actor=actor).update_user(
            member.id, UserUpdate(is_active=False)
        )

        assert updated.is_active is False

    async def test_protected_admin_can_edit_a_peer_admin(self, session: AsyncSession) -> None:
        protected = await _make_protected_admin(AuthService(session))
        target = await self._make_superuser(session)

        updated = await AuthService(session, actor=protected).update_user(
            target.id, UserUpdate(full_name="Renamed by the super administrator")
        )

        assert updated.full_name == "Renamed by the super administrator"

    async def test_promoting_an_ordinary_member_to_admin_is_unaffected(
        self, session: AsyncSession
    ) -> None:
        """The guard only fires for a target that is *already* an
        Administrator - promoting a Member to one is an ordinary
        `manage_users` action, not "editing a peer admin"."""
        actor = await self._make_superuser(session)
        member = await self._make_member(session)

        updated = await AuthService(session, actor=actor).update_user(
            member.id, UserUpdate(is_superuser=True)
        )

        assert updated.is_superuser is True


class TestManageUsersCannotGrantAdminPower:
    """`manage_users` lets someone create, edit, deactivate, reset the
    password of and delete an ordinary Member - but never hand out (or take
    away) power they do not themselves hold. A Role change and a Global
    Access override both stay system-administrator-only, whether that power
    comes from `is_superuser` or a group's `system_admin` grant. See
    `AuthService.assert_actor_is_system_admin`."""

    async def _make_member(self, session: AsyncSession) -> User:
        return await AuthService(session).create_user(
            UserCreate(
                username=unique("member"),
                email=f"{unique('member')}@example.com",
                full_name="Member",
                password="member-password-1",
            )
        )

    async def test_a_non_admin_actor_cannot_promote_a_member_to_administrator(
        self, session: AsyncSession
    ) -> None:
        actor = await self._make_member(session)
        target = await self._make_member(session)

        with pytest.raises(PermissionDeniedError, match="System Administrator"):
            await AuthService(session, actor=actor).update_user(
                target.id, UserUpdate(is_superuser=True)
            )

        assert (await AuthService(session).users.get(target.id)).is_superuser is False

    async def test_a_non_admin_actor_cannot_set_a_global_access_override(
        self, session: AsyncSession
    ) -> None:
        """Not even a lesser-looking override, since any of them could
        include `system_admin` - the exact side door this whole guard exists
        to close."""
        actor = await self._make_member(session)
        target = await self._make_member(session)

        with pytest.raises(PermissionDeniedError, match="System Administrator"):
            await AuthService(session, actor=actor).update_user(
                target.id,
                UserUpdate(
                    global_permission_overrides={GlobalPermission.system_admin: True}
                ),
            )

    async def test_a_non_admin_actor_cannot_create_a_new_administrator(
        self, session: AsyncSession
    ) -> None:
        actor = await self._make_member(session)

        with pytest.raises(PermissionDeniedError, match="System Administrator"):
            await AuthService(session, actor=actor).create_user(
                UserCreate(
                    username=unique("newadmin"),
                    email=f"{unique('newadmin')}@example.com",
                    full_name="New Admin",
                    password="password-1234",
                    is_superuser=True,
                )
            )

    async def test_a_non_admin_actor_can_still_manage_an_ordinary_member(
        self, session: AsyncSession
    ) -> None:
        actor = await self._make_member(session)
        target = await self._make_member(session)

        updated = await AuthService(session, actor=actor).update_user(
            target.id, UserUpdate(full_name="Renamed", is_active=False)
        )

        assert updated.full_name == "Renamed"
        assert updated.is_active is False

    async def test_a_system_admin_group_permission_is_enough_without_is_superuser(
        self, session: AsyncSession
    ) -> None:
        """The check is against real effective capability
        (`PermissionService.is_system_admin`), not just the `is_superuser`
        column - a Member whose *group* carries `system_admin` can promote
        others too, the same as an actual superuser could."""
        actor = await self._make_member(session)
        target = await self._make_member(session)
        root = await AuthService(session).create_user(
            UserCreate(
                username=unique("root"),
                email=f"{unique('root')}@example.com",
                full_name="Root",
                password="root-password-1",
                is_superuser=True,
            )
        )
        group = Group(name=unique("group"), description="", owner_id=actor.id)
        session.add(group)
        await session.flush()
        session.add(GroupMember(group_id=group.id, user_id=actor.id))
        await session.flush()
        await PermissionService(session).set_group_global_permission(
            group, GlobalPermission.system_admin, root, True
        )

        updated = await AuthService(session, actor=actor).update_user(
            target.id, UserUpdate(is_superuser=True)
        )

        assert updated.is_superuser is True


class TestAdminPasswordReset:
    async def test_sets_a_password_without_the_old_one(self, session: AsyncSession) -> None:
        service = AuthService(session)
        user = await service.create_user(
            UserCreate(
                username=unique("u"),
                email=f"{unique('u')}@example.com",
                full_name="User",
                password="original-password-1",
            )
        )

        await service.reset_password(user.id, "replacement-password-2")

        assert (await service.authenticate(user.username, "replacement-password-2")).id == user.id
        with pytest.raises(AuthenticationError):
            await service.authenticate(user.username, "original-password-1")

    async def test_missing_user_is_not_found(self, session: AsyncSession) -> None:
        with pytest.raises(NotFoundError):
            await AuthService(session).reset_password(uuid.uuid4(), "whatever-password-1")

    async def test_protected_admin_cannot_be_reset(self, session: AsyncSession) -> None:
        """The invariant the new endpoint must not break."""
        service = AuthService(session)
        admin, _created, _rotated, _changed = await service.ensure_bootstrap_admin(
            username=unique("admin"),
            password="admin123",
            email=f"{unique('admin')}@wikihub.local",
            full_name="Admin",
        )

        with pytest.raises(PermissionDeniedError):
            await service.reset_password(admin.id, "attempted-new-password")

        # The original credential still works.
        assert (await service.authenticate(admin.username, "admin123")).id == admin.id

    async def test_password_never_reaches_the_audit_trail(self, session: AsyncSession) -> None:
        actor = await AuthService(session).create_user(
            UserCreate(
                username=unique("root"),
                email=f"{unique('root')}@example.com",
                full_name="Root",
                password="root-password-1",
                is_superuser=True,
            )
        )
        service = AuthService(session, actor=actor)
        target = await service.create_user(
            UserCreate(
                username=unique("u"),
                email=f"{unique('u')}@example.com",
                full_name="User",
                password="original-password-1",
            )
        )

        secret = "super-secret-replacement-9"
        await service.reset_password(target.id, secret)

        rows = (await session.execute(select(AuditLog))).scalars().all()
        assert any(r.action == AuditAction.user_password_reset for r in rows)
        assert secret not in json.dumps([r.details for r in rows])
