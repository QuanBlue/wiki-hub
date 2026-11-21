from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from pydantic import ValidationError

from app.core.exceptions import PermissionDeniedError
from app.models.permission import GlobalPermission
from app.modules.auth.service import AuthService
from app.schemas.user import PublicUserRead, SelfProfileUpdate, UserUpdate


def _make_user(**overrides):
    values = {
        "id": uuid.uuid4(),
        "username": "alice",
        "email": "alice@example.com",
        "full_name": "Alice",
        "avatar_url": None,
        "avatar_content_type": None,
        "avatar_crop": None,
        "avatar_updated_at": None,
        "cover_url": None,
        "cover_content_type": None,
        "cover_crop": None,
        "cover_updated_at": None,
        "bio": "",
        "pronouns": "",
        "profile_url": "",
        "social_links": [],
        "company": "",
        "status_emoji": "",
        "status_text": "",
        "status_expires_at": None,
        "welcome_effect": "",
        "welcome_message": "",
        "password_hash": "hash",
        "is_active": True,
        "is_superuser": False,
        "is_protected": False,
        "receive_admin_emails": False,
        "created_at": datetime(2026, 1, 1, tzinfo=UTC),
        "last_login_at": None,
        "privacy_accepted_at": datetime(2026, 1, 1, tzinfo=UTC),
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _make_service(actor) -> AuthService:
    svc = AuthService(Mock(), actor=actor)
    svc.session.flush = AsyncMock()
    svc.session.delete = AsyncMock()
    svc.users = Mock()
    svc.audit = Mock(record=AsyncMock())
    return svc


def test_welcome_effect_schema_validation() -> None:
    valid = SelfProfileUpdate(welcome_effect="phoenix", welcome_message="  Hello guests!  ")
    assert valid.welcome_effect == "phoenix"

    for preset in (
        "sakura",
        "fireworks",
        "ocean",
        "neon",
        "vice",
        "storm",
        "cosmos",
        "snow",
        "lantern",
        "arcade",
        "koi",
        "blockcraft",
        "platformer",
        "racing",
        "tet",
        "halloween",
        "christmas",
        "midautumn",
        "pirate",
        "ninja",
        "rocket",
        "jungle",
        "cyberpunk",
        "steampunk",
        "candy",
        "kawaii",
    ):
        assert SelfProfileUpdate(welcome_effect=preset).welcome_effect == preset
        assert UserUpdate(welcome_effect=preset).welcome_effect == preset

    with pytest.raises(ValidationError):
        SelfProfileUpdate(welcome_effect="dragon")  # type: ignore[arg-type]

    with pytest.raises(ValidationError):
        UserUpdate(welcome_effect="invalid")  # type: ignore[arg-type]


def test_public_user_read_exposes_welcome_effect() -> None:
    member = _make_user(welcome_effect="hacker", welcome_message="Access granted")
    public = PublicUserRead.model_validate(member)
    assert public.welcome_effect == "hacker"
    assert public.welcome_message == "Access granted"


@pytest.mark.asyncio
async def test_update_own_profile_welcome_effect_requires_permission() -> None:
    alice = _make_user()
    svc = _make_service(actor=alice)
    svc.users.get = AsyncMock(return_value=alice)

    with patch("app.modules.permissions.service.PermissionService.has_global", new=AsyncMock(return_value=False)):
        with pytest.raises(PermissionDeniedError) as exc:
            await svc.update_own_profile(
                alice.id, SelfProfileUpdate(welcome_effect="phoenix", welcome_message="Hi!")
            )
    assert exc.value.code == "welcome_effect_forbidden"
    assert alice.welcome_effect == ""


@pytest.mark.asyncio
async def test_update_own_profile_welcome_effect_succeeds_when_permitted() -> None:
    alice = _make_user()
    svc = _make_service(actor=alice)
    svc.users.get = AsyncMock(return_value=alice)

    mock_has_global = AsyncMock(return_value=True)
    with patch("app.modules.permissions.service.PermissionService.has_global", new=mock_has_global):
        updated = await svc.update_own_profile(
            alice.id,
            SelfProfileUpdate(welcome_effect="phoenix", welcome_message="  Rise up!  "),
        )

    mock_has_global.assert_awaited_once_with(alice, GlobalPermission.customize_profile_welcome)
    assert updated.welcome_effect == "phoenix"
    assert updated.welcome_message == "Rise up!"


@pytest.mark.asyncio
async def test_admin_can_update_another_users_welcome_effect() -> None:
    admin = _make_user(username="admin", is_superuser=True)
    member = _make_user(username="bob")
    svc = _make_service(actor=admin)
    svc.users.get = AsyncMock(return_value=member)

    updated = await svc.update_user(
        member.id, UserUpdate(welcome_effect="admin", welcome_message="VIP guest")
    )
    assert updated.welcome_effect == "admin"
    assert updated.welcome_message == "VIP guest"


@pytest.mark.asyncio
async def test_non_system_admin_cannot_update_another_users_welcome_effect() -> None:
    manager = _make_user(username="manager", is_superuser=False)
    member = _make_user(username="bob")
    svc = _make_service(actor=manager)
    svc.users.get = AsyncMock(return_value=member)

    with patch(
        "app.modules.permissions.service.PermissionService.is_system_admin",
        new=AsyncMock(return_value=False),
    ):
        with pytest.raises(PermissionDeniedError):
            await svc.update_user(member.id, UserUpdate(welcome_effect="hacker"))
