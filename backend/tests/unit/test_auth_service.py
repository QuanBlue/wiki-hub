from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from pydantic import ValidationError

from app.core.exceptions import (
    AuthenticationError,
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
)
from app.modules.auth import service as auth_module
from app.modules.auth.service import AuthService
from app.schemas.user import (
    PasswordChange,
    PasswordReset,
    SelfProfileUpdate,
    UserCreate,
    UserUpdate,
)


def user(**overrides):
    values = {
        "id": uuid.uuid4(),
        "username": "alice",
        "email": "alice@example.com",
        "full_name": "Alice",
        "avatar_url": None,
        "password_hash": "hash",
        "is_active": True,
        "is_superuser": False,
        "is_protected": False,
        "last_login_at": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def service(actor=None, impersonator=None) -> AuthService:
    result = AuthService(Mock(), actor=actor, impersonator=impersonator)
    result.session.flush = AsyncMock()
    result.session.delete = AsyncMock()
    result.users = Mock()
    result.audit = Mock(record=AsyncMock())
    return result


def test_password_change_rules() -> None:
    valid = PasswordChange(current_password="current", new_password="Stronger8")
    assert valid.new_password == "Stronger8"

    with pytest.raises(ValidationError):
        PasswordChange(current_password="current", new_password="lowercase8")
    with pytest.raises(ValidationError):
        PasswordChange(current_password="current", new_password="NoNumbers")
    with pytest.raises(ValidationError):
        PasswordReset(new_password="123456a@")


def test_self_profile_email_validation() -> None:
    assert SelfProfileUpdate(email=None).email is None
    assert SelfProfileUpdate(email=" me@wikihub.local ").email == "me@wikihub.local"
    with pytest.raises(ValidationError, match="valid email address"):
        SelfProfileUpdate(email="not-an-email")


@pytest.mark.asyncio
async def test_authentication_and_user_lookup_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    svc = service()
    monkeypatch.setattr(
        auth_module, "verify_password", Mock(side_effect=[False, False, True, True])
    )
    monkeypatch.setattr(auth_module, "needs_rehash", Mock(return_value=False))
    active = user()
    svc.users.get_by_identifier = AsyncMock(side_effect=[None, active, active, active])

    with pytest.raises(AuthenticationError):
        await svc.authenticate("missing", "pw")
    with pytest.raises(AuthenticationError):
        await svc.authenticate("alice", "pw")
    active.is_active = False
    with pytest.raises(AuthenticationError) as inactive_error:
        await svc.authenticate("alice", "pw")
    assert inactive_error.value.code == "account_inactive"
    assert "deactivated" in inactive_error.value.message
    active.is_active = True
    assert await svc.authenticate("alice", "pw") is active
    assert active.last_login_at is not None

    svc.users.search = AsyncMock(return_value=([active], 1))
    assert await svc.search_users(q="a") == ([active], 1)
    svc.users.get = AsyncMock(side_effect=[active, None, user(is_active=False)])
    assert await svc.get_active_user(active.id) is active
    with pytest.raises(AuthenticationError):
        await svc.get_active_user(active.id)
    with pytest.raises(AuthenticationError):
        await svc.get_active_user(active.id)


@pytest.mark.asyncio
async def test_impersonation_guards_and_success() -> None:
    actor = user(is_superuser=True)
    target = user(username="bob")
    svc = service(actor=actor)
    svc.users.get = AsyncMock(return_value=target)
    with pytest.raises(ConflictError):
        await service(actor=actor, impersonator=user()).begin_impersonation(target.id)
    assert await svc.begin_impersonation(target.id) is target
    svc.audit.record.assert_awaited_once()

    for bad in [None, user(id=actor.id), user(is_protected=True), user(is_active=False)]:
        guarded = service(actor=actor)
        guarded.users.get = AsyncMock(return_value=bad)
        if bad is None:
            expected = NotFoundError
        elif bad.id == actor.id:
            expected = ConflictError
        elif bad.is_protected:
            expected = PermissionDeniedError
        else:
            expected = ConflictError
        with pytest.raises(expected):
            await guarded.begin_impersonation(target.id)

    with pytest.raises(PermissionDeniedError):
        await service(actor=user(is_superuser=False)).begin_impersonation(target.id)

    with pytest.raises(ConflictError):
        await service(actor=actor).end_impersonation()
    impersonating = service(actor=actor, impersonator=target)
    impersonating.users.get = AsyncMock(return_value=actor)
    assert await impersonating.end_impersonation() is actor


@pytest.mark.asyncio
async def test_create_update_profile_and_password_operations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth_module, "hash_password", lambda value: f"hashed:{value}")
    monkeypatch.setattr(auth_module, "verify_password", lambda value, hashed: value == "old")
    svc = service()
    monkeypatch.setattr(
        "app.modules.permissions.service.PermissionService",
        Mock(return_value=Mock(assert_user_can_be_removed=AsyncMock())),
    )
    svc.users.get_by_username = AsyncMock(return_value=None)
    svc.users.get_by_email = AsyncMock(return_value=None)
    svc.users.add = Mock()
    created = await svc.create_user(
        UserCreate(username="New", email="NEW@example.com", full_name=" Name ", password="password")
    )
    assert created.username == "New" and created.email == "new@example.com"

    target = user()
    svc.users.get = AsyncMock(return_value=target)
    updated = await svc.update_user(
        target.id, UserUpdate(email=" NEW@EXAMPLE.COM ", full_name=" New Name ", is_active=False)
    )
    assert updated.email == "new@example.com" and updated.full_name == "New Name"
    assert svc.audit.record.await_count >= 2

    svc.actor = target
    profile = await svc.update_own_profile(
        target.id,
        SelfProfileUpdate(
            email="profile@wikihub.local",
            full_name=" Profile",
            avatar_url="https://avatar.example",
            bio="Profile biography",
            pronouns="they/them",
            profile_url="https://example.com",
            social_links=["https://github.com/example", "https://example.org"],
            company="Product",
        ),
    )
    assert profile.email == "profile@wikihub.local"
    assert profile.full_name == "Profile" and str(profile.avatar_url) == "https://avatar.example/"
    assert profile.bio == "Profile biography" and profile.company == "Product"
    assert profile.social_links == ["https://github.com/example", "https://example.org/"]
    svc.users.get_by_email = AsyncMock(return_value=user(id=uuid.uuid4()))
    with pytest.raises(ConflictError, match="E-mail"):
        await svc.update_own_profile(target.id, SelfProfileUpdate(email="taken@example.com"))
    await svc.change_password(target.id, "old", "new")
    assert target.password_hash == "hashed:new"
    await svc.reset_password(target.id, "reset")
    assert target.password_hash == "hashed:reset"


@pytest.mark.asyncio
async def test_mutation_guards_delete_and_bootstrap(monkeypatch: pytest.MonkeyPatch) -> None:
    protected = user(is_protected=True)
    svc = service(actor=protected)
    with pytest.raises(PermissionDeniedError):
        svc.assert_mutable(protected)

    svc.users.get = AsyncMock(return_value=None)
    with pytest.raises(NotFoundError):
        await svc.update_user(uuid.uuid4(), UserUpdate(full_name="x"))
    with pytest.raises(NotFoundError):
        await svc.delete_user(uuid.uuid4())
    with pytest.raises(NotFoundError):
        await svc.change_password(uuid.uuid4(), "old", "new")

    # An existing protected admin whose configured identity and password
    # already match is returned completely untouched - no rehash, no rename.
    monkeypatch.setattr(auth_module, "verify_password", lambda *_args: True)
    existing = user(is_protected=True, username="admin", email="a@b.com", full_name="Admin")
    svc.users.get_protected = AsyncMock(return_value=existing)
    assert await svc.ensure_bootstrap_admin("admin", "pw", "a@b.com", "Admin") == (
        existing,
        False,
        False,
        False,
    )

    svc.users.get_protected = AsyncMock(return_value=None)
    clash = user(username="admin")
    svc.users.get_by_username = AsyncMock(return_value=clash)
    promoted, created, rotated, changed = await svc.ensure_bootstrap_admin(
        "admin", "pw", "a@b.com", "Admin"
    )
    assert promoted is clash and created is False and rotated is False and clash.is_protected
    assert changed is False

    svc.users.get_by_username = AsyncMock(return_value=None)
    svc.users.add = Mock()
    promoted, created, rotated, changed = await svc.ensure_bootstrap_admin(
        " admin ", "pw", "A@B.com", " Admin "
    )
    assert promoted.is_protected and created is True and rotated is False and changed is False


@pytest.mark.asyncio
async def test_bootstrap_admin_rotates_password_when_it_no_longer_matches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """WIKIHUB_ADMIN_PASSWORD changing in .env must rotate the stored hash on
    the next seed - that is the point of it being editable at all for a
    protected account no other write path can change the password of."""
    monkeypatch.setattr(auth_module, "verify_password", lambda *_args: False)
    monkeypatch.setattr(auth_module, "hash_password", lambda value: f"hashed:{value}")

    existing = user(
        is_protected=True,
        username="admin",
        email="a@b.com",
        full_name="Admin",
        password_hash="stale-hash",
    )
    svc = service()
    svc.users.get_protected = AsyncMock(return_value=existing)

    admin, created, rotated, changed = await svc.ensure_bootstrap_admin(
        "admin", "new-password", "a@b.com", "Admin"
    )

    assert admin is existing
    assert created is False
    assert rotated is True
    assert changed is False
    assert existing.password_hash == "hashed:new-password"
    svc.audit.record.assert_awaited_once()


@pytest.mark.asyncio
async def test_bootstrap_admin_resyncs_identity_fields_when_they_differ(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """WIKIHUB_ADMIN_USERNAME/EMAIL/FULL_NAME changing in .env must resync
    the account the same way a changed password does."""
    monkeypatch.setattr(auth_module, "verify_password", lambda *_args: True)

    existing = user(
        is_protected=True, username="old-name", email="old@example.com", full_name="Old Name"
    )
    svc = service()
    svc.users.get_protected = AsyncMock(return_value=existing)
    svc.users.get_by_username = AsyncMock(return_value=None)
    svc.users.get_by_email = AsyncMock(return_value=None)

    admin, created, rotated, changed = await svc.ensure_bootstrap_admin(
        "new-name", "pw", "new@example.com", "New Name"
    )

    assert admin is existing
    assert created is False
    assert rotated is False
    assert changed is True
    assert existing.username == "new-name"
    assert existing.email == "new@example.com"
    assert existing.full_name == "New Name"
    svc.audit.record.assert_awaited_once()


@pytest.mark.asyncio
async def test_bootstrap_admin_skips_a_colliding_username_or_email(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A field that would steal a *different* account's identity must never
    block startup and must never be applied - it is left as-is."""
    monkeypatch.setattr(auth_module, "verify_password", lambda *_args: True)

    existing = user(
        is_protected=True, username="old-name", email="old@example.com", full_name="Old Name"
    )
    other = user(username="new-name", email="new@example.com")
    svc = service()
    svc.users.get_protected = AsyncMock(return_value=existing)
    svc.users.get_by_username = AsyncMock(return_value=other)
    svc.users.get_by_email = AsyncMock(return_value=other)

    admin, created, rotated, changed = await svc.ensure_bootstrap_admin(
        "new-name", "pw", "new@example.com", "Old Name"
    )

    assert admin is existing
    assert created is False
    assert rotated is False
    # Nothing collided, and full_name was identical, so nothing changed at all.
    assert changed is False
    assert existing.username == "old-name"
    assert existing.email == "old@example.com"
    svc.audit.record.assert_not_awaited()


@pytest.mark.asyncio
async def test_auth_conflict_and_failure_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    svc = service()
    target = user()
    svc.users.count_active_superusers = AsyncMock(return_value=1)
    with pytest.raises(ConflictError, match="only active administrator"):
        await svc._assert_superuser_remains(user(is_superuser=True))
    await svc._assert_superuser_remains(user(is_active=False, is_superuser=True))

    active = user()
    svc.users.get_by_identifier = AsyncMock(return_value=active)
    monkeypatch.setattr(auth_module, "verify_password", lambda *_args: True)
    monkeypatch.setattr(auth_module, "needs_rehash", lambda *_args: True)
    monkeypatch.setattr(auth_module, "hash_password", lambda value: f"new:{value}")
    await svc.authenticate("alice", "pw")
    assert active.password_hash == "new:pw"

    inactive_admin = service(actor=user(is_superuser=True), impersonator=user())
    inactive_admin.users.get = AsyncMock(return_value=user(is_active=False))
    with pytest.raises(AuthenticationError):
        await inactive_admin.end_impersonation()

    svc.users.get_by_username = AsyncMock(return_value=target)
    with pytest.raises(ConflictError, match="Username"):
        await svc.create_user(
            UserCreate(username="New", email="new@example.com", full_name="N", password="password")
        )
    svc.users.get_by_username = AsyncMock(return_value=None)
    svc.users.get_by_email = AsyncMock(return_value=target)
    with pytest.raises(ConflictError, match="E-mail"):
        await svc.create_user(
            UserCreate(username="New", email="new@example.com", full_name="N", password="password")
        )

    svc.users.get = AsyncMock(return_value=target)
    svc.actor = target
    with pytest.raises(ConflictError, match="deactivate"):
        await svc.update_user(target.id, UserUpdate(is_active=False))
    with pytest.raises(ConflictError, match="administrator"):
        await svc.update_user(target.id, UserUpdate(is_superuser=False))
    svc.actor = None
    svc.users.get_by_email = AsyncMock(return_value=user(id=uuid.uuid4()))
    with pytest.raises(ConflictError, match="E-mail"):
        await svc.update_user(target.id, UserUpdate(email="other@example.com"))

    svc.users.get_by_email = AsyncMock(return_value=None)
    svc.users.count_active_superusers = AsyncMock(return_value=2)
    await svc.update_user(target.id, UserUpdate(is_superuser=True))
    assert target.is_superuser is True
    await svc.update_user(target.id, UserUpdate(is_superuser=False))
    assert target.is_superuser is False

    svc.actor = None
    with pytest.raises(PermissionDeniedError):
        await svc.update_own_profile(target.id, SelfProfileUpdate(full_name="x"))
    svc.users.get = AsyncMock(return_value=None)
    with pytest.raises(NotFoundError):
        await svc.update_own_profile(target.id, SelfProfileUpdate(full_name="x"))

    svc.users.get = AsyncMock(return_value=target)
    monkeypatch.setattr(auth_module, "verify_password", lambda *_args: False)
    with pytest.raises(AuthenticationError):
        await svc.change_password(target.id, "wrong", "newpassword")
    target.is_protected = True
    svc.actor = None
    with pytest.raises(PermissionDeniedError):
        await svc.change_password(target.id, "old", "newpassword")
    with pytest.raises(PermissionDeniedError):
        await svc.reset_password(target.id, "newpassword")
    svc.users.get = AsyncMock(return_value=None)
    with pytest.raises(NotFoundError):
        await svc.reset_password(target.id, "newpassword")

    svc.users.get = AsyncMock(return_value=target)
    target.is_protected = False
    svc.users.count_active_superusers = AsyncMock(return_value=2)
    monkeypatch.setattr(
        "app.modules.permissions.service.PermissionService",
        Mock(return_value=Mock(assert_user_can_be_removed=AsyncMock())),
    )
    await svc.delete_user(target.id)
    svc.session.delete.assert_awaited_once_with(target)
