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
from app.models.user import User
from app.modules.auth.service import AuthService
from app.schemas.user import UserCreate, UserUpdate
from tests.integration.conftest import unique

pytestmark = pytest.mark.integration

TEST_DB_URL = os.environ.get("WIKIHUB_TEST_DATABASE_URL")


async def _make_protected_admin(service: AuthService) -> object:
    admin, created = await service.ensure_bootstrap_admin(
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

    async def test_seeding_twice_is_idempotent(self, session: AsyncSession) -> None:
        service = AuthService(session)
        admin = await _make_protected_admin(service)
        original_hash = admin.password_hash

        again, created = await service.ensure_bootstrap_admin(
            username="someone-else",
            password="a-totally-different-password",
            email="someone-else@wikihub.local",
            full_name="Someone Else",
        )

        assert created is False
        assert again.id == admin.id
        # Re-seeding must never rewrite the existing password.
        assert again.password_hash == original_hash

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
    """Every write path against the bootstrap admin must be refused."""

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
        target = await self._make_superuser(session)
        # A different actor, so the self-guards do not fire first.
        actor = await self._make_superuser(session)
        # Leave exactly one active administrator.
        await AuthService(session, actor=target).update_user(actor.id, UserUpdate(is_active=False))

        with pytest.raises(ConflictError, match="only active administrator"):
            await AuthService(session, actor=actor).update_user(
                target.id, UserUpdate(is_active=False)
            )

    async def test_can_deactivate_another_admin_while_one_remains(
        self, session: AsyncSession
    ) -> None:
        actor = await self._make_superuser(session)
        other = await self._make_superuser(session)

        updated = await AuthService(session, actor=actor).update_user(
            other.id, UserUpdate(is_active=False)
        )

        assert updated.is_active is False


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
        admin, _ = await service.ensure_bootstrap_admin(
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
