"""Impersonation rules against a real PostgreSQL database.

Impersonation hands one account the full authority of another, so these tests
are about the refusals more than the happy path. Each one corresponds to a way
the feature could be turned into a privilege-escalation or accountability hole.
"""

from __future__ import annotations

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
from app.schemas.user import UserCreate
from tests.integration.conftest import unique

pytestmark = pytest.mark.integration


async def _user(session: AsyncSession, *, superuser: bool = False, active: bool = True) -> User:
    name = unique("u")
    user = await AuthService(session).create_user(
        UserCreate(
            username=name,
            email=f"{name}@example.com",
            password="a-good-password",
            is_superuser=superuser,
        )
    )
    if not active:
        user.is_active = False
        await session.flush()
    return user


class TestBeginImpersonation:
    async def test_admin_can_impersonate_a_member(self, session: AsyncSession) -> None:
        admin = await _user(session, superuser=True)
        member = await _user(session)

        service = AuthService(session, actor=admin)
        target = await service.begin_impersonation(member.id)

        assert target.id == member.id

    async def test_non_superuser_is_refused(self, session: AsyncSession) -> None:
        member = await _user(session)
        other = await _user(session)

        service = AuthService(session, actor=member)
        with pytest.raises(PermissionDeniedError):
            await service.begin_impersonation(other.id)

    async def test_anonymous_service_is_refused(self, session: AsyncSession) -> None:
        target = await _user(session)

        with pytest.raises(PermissionDeniedError):
            await AuthService(session).begin_impersonation(target.id)

    async def test_protected_account_cannot_be_impersonated(self, session: AsyncSession) -> None:
        """Otherwise this is a way around "the built-in admin is immutable"."""
        admin = await _user(session, superuser=True)
        protected, _ = await AuthService(session).ensure_bootstrap_admin(
            username=unique("root"),
            password="admin123",
            email=f"{unique('root')}@wikihub.local",
            full_name="WikiHub Administrator",
        )

        service = AuthService(session, actor=admin)
        with pytest.raises(PermissionDeniedError):
            await service.begin_impersonation(protected.id)

    async def test_inactive_account_cannot_be_impersonated(self, session: AsyncSession) -> None:
        """Deactivation has to mean the account cannot be used - by anyone."""
        admin = await _user(session, superuser=True)
        disabled = await _user(session, active=False)

        service = AuthService(session, actor=admin)
        with pytest.raises(ConflictError):
            await service.begin_impersonation(disabled.id)

    async def test_self_is_refused(self, session: AsyncSession) -> None:
        admin = await _user(session, superuser=True)

        service = AuthService(session, actor=admin)
        with pytest.raises(ConflictError):
            await service.begin_impersonation(admin.id)

    async def test_unknown_user_is_not_found(self, session: AsyncSession) -> None:
        admin = await _user(session, superuser=True)

        service = AuthService(session, actor=admin)
        with pytest.raises(NotFoundError):
            await service.begin_impersonation(uuid.uuid4())

    async def test_nesting_is_refused(self, session: AsyncSession) -> None:
        """A token carries one actor, so a nested hop would strand the session.

        ``first`` is a superuser on purpose: impersonating a *member* is already
        stopped by the privilege check, so only impersonating another admin can
        reach the nesting guard at all.
        """
        admin = await _user(session, superuser=True)
        first = await _user(session, superuser=True)
        second = await _user(session)

        service = AuthService(session, actor=first, impersonator=admin)
        with pytest.raises(ConflictError):
            await service.begin_impersonation(second.id)


class TestEndImpersonation:
    async def test_returns_the_administrator(self, session: AsyncSession) -> None:
        admin = await _user(session, superuser=True)
        member = await _user(session)

        service = AuthService(session, actor=member, impersonator=admin)
        back = await service.end_impersonation()

        assert back.id == admin.id

    async def test_refused_when_not_impersonating(self, session: AsyncSession) -> None:
        member = await _user(session)

        service = AuthService(session, actor=member)
        with pytest.raises(ConflictError):
            await service.end_impersonation()

    async def test_deactivated_administrator_cannot_return(self, session: AsyncSession) -> None:
        """The way back is re-checked, not taken on the token's word."""
        admin = await _user(session, superuser=True)
        member = await _user(session)

        admin.is_active = False
        await session.flush()

        service = AuthService(session, actor=member, impersonator=admin)
        with pytest.raises(AuthenticationError):
            await service.end_impersonation()


class TestAuditTrail:
    async def test_both_ends_are_recorded(self, session: AsyncSession) -> None:
        admin = await _user(session, superuser=True)
        member = await _user(session)

        await AuthService(session, actor=admin).begin_impersonation(member.id)
        await AuthService(session, actor=member, impersonator=admin).end_impersonation()

        actions = (
            (
                await session.execute(
                    select(AuditLog.action).where(
                        AuditLog.action.in_(
                            [
                                AuditAction.impersonation_started,
                                AuditAction.impersonation_stopped,
                            ]
                        )
                    )
                )
            )
            .scalars()
            .all()
        )

        assert AuditAction.impersonation_started in actions
        assert AuditAction.impersonation_stopped in actions

    async def test_impersonated_action_names_the_real_human(self, session: AsyncSession) -> None:
        """The whole point of the extra column.

        Without it the trail would read "member created a user" with no trace of
        the administrator who actually did it.
        """
        admin = await _user(session, superuser=True)
        member = await _user(session, superuser=True)

        service = AuthService(session, actor=member, impersonator=admin)
        created = await service.create_user(
            UserCreate(
                username=unique("victim"),
                email=f"{unique('victim')}@example.com",
                password="a-good-password",
            )
        )

        row = (
            await session.execute(
                select(AuditLog).where(
                    AuditLog.action == AuditAction.user_created,
                    AuditLog.entity_id == created.id,
                )
            )
        ).scalar_one()

        assert row.actor_username == member.username
        assert row.impersonator_username == admin.username

    async def test_normal_action_has_no_impersonator(self, session: AsyncSession) -> None:
        admin = await _user(session, superuser=True)

        created = await AuthService(session, actor=admin).create_user(
            UserCreate(
                username=unique("plain"),
                email=f"{unique('plain')}@example.com",
                password="a-good-password",
            )
        )

        row = (
            await session.execute(
                select(AuditLog).where(
                    AuditLog.action == AuditAction.user_created,
                    AuditLog.entity_id == created.id,
                )
            )
        ).scalar_one()

        assert row.impersonator_username is None
        assert row.impersonator_id is None
