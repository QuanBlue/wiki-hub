"""Unit tests for public page share creation, listing, revoking, and public access."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.core.exceptions import AuthenticationError, NotFoundError, PermissionDeniedError
from app.core.security import hash_password
from app.models.page import WikiPage
from app.models.space import Space, SpaceStatus
from app.modules.shares.service import PublicShareService, ShareService
from app.schemas.share import PublicShareCreate, PublicShareUpdate


@pytest.fixture
def mock_session():
    session = AsyncMock()
    session.add = Mock()
    session.flush = AsyncMock()
    return session


@pytest.fixture
def mock_user():
    return SimpleNamespace(id=uuid.uuid4(), username="alice")


async def test_public_share_service_disabled_system_wide(mock_session):
    service = PublicShareService(mock_session)
    mock_effective = SimpleNamespace(public_shares_enabled=False)

    with patch("app.modules.shares.service.SiteSettingsService") as mock_settings:
        mock_settings.return_value.get_effective = AsyncMock(return_value=mock_effective)
        with pytest.raises(PermissionDeniedError, match="disabled on this system"):
            await service.get_share("token-123")


async def test_public_share_service_not_found_or_inactive(mock_session):
    service = PublicShareService(mock_session)
    mock_effective = SimpleNamespace(public_shares_enabled=True)

    with patch("app.modules.shares.service.SiteSettingsService") as mock_settings:
        mock_settings.return_value.get_effective = AsyncMock(return_value=mock_effective)
        mock_scalars = Mock()
        mock_scalars.first.return_value = None
        mock_session.scalars.return_value = mock_scalars

        with pytest.raises(NotFoundError, match="does not exist or has been revoked"):
            await service.get_share("non-existent-token")


async def test_public_share_service_expired(mock_session):
    service = PublicShareService(mock_session)
    mock_effective = SimpleNamespace(public_shares_enabled=True)
    expired_share = SimpleNamespace(
        id=uuid.uuid4(),
        token="exp-token",
        page_id=uuid.uuid4(),
        is_active=True,
        expires_at=datetime.now(UTC) - timedelta(days=1),
        password_hash=None,
        view_count=0,
    )

    with patch("app.modules.shares.service.SiteSettingsService") as mock_settings:
        mock_settings.return_value.get_effective = AsyncMock(return_value=mock_effective)
        mock_scalars = Mock()
        mock_scalars.first.return_value = expired_share
        mock_session.scalars.return_value = mock_scalars

        with pytest.raises(NotFoundError, match="has expired"):
            await service.get_share("exp-token")


async def test_public_share_service_page_deleted(mock_session):
    service = PublicShareService(mock_session)
    mock_effective = SimpleNamespace(public_shares_enabled=True)
    share = SimpleNamespace(
        id=uuid.uuid4(),
        token="valid-token",
        page_id=uuid.uuid4(),
        is_active=True,
        expires_at=None,
        password_hash=None,
        view_count=0,
    )

    with patch("app.modules.shares.service.SiteSettingsService") as mock_settings:
        mock_settings.return_value.get_effective = AsyncMock(return_value=mock_effective)
        mock_scalars = Mock()
        mock_scalars.first.return_value = share
        mock_session.scalars.return_value = mock_scalars

        # Page is in trash
        page = SimpleNamespace(id=share.page_id, space_id=uuid.uuid4(), deleted_at=datetime.now(UTC))
        mock_session.get.return_value = page

        with pytest.raises(NotFoundError, match="no longer available"):
            await service.get_share("valid-token")


async def test_public_share_service_archived_space(mock_session):
    service = PublicShareService(mock_session)
    share = SimpleNamespace(id=uuid.uuid4(), token="archived", page_id=uuid.uuid4(),
                            is_active=True, expires_at=None, password_hash=None, view_count=0)
    mock_session.scalars.return_value = Mock(first=Mock(return_value=share))
    page = SimpleNamespace(id=share.page_id, space_id=uuid.uuid4(), deleted_at=None)
    mock_session.get.side_effect = [page, SimpleNamespace(id=page.space_id, status=SpaceStatus.archived)]
    with patch("app.modules.shares.service.SiteSettingsService") as settings:
        settings.return_value.get_effective = AsyncMock(
            return_value=SimpleNamespace(public_shares_enabled=True)
        )
        with pytest.raises(NotFoundError, match="shared space is no longer available"):
            await service.get_share("archived")


async def test_public_share_service_password_protected_flow(mock_session):
    service = PublicShareService(mock_session)
    mock_effective = SimpleNamespace(public_shares_enabled=True)
    pw_hash = hash_password("secret123")
    share = SimpleNamespace(
        id=uuid.uuid4(),
        token="pw-token",
        page_id=uuid.uuid4(),
        is_active=True,
        expires_at=None,
        password_hash=pw_hash,
        view_count=5,
    )
    page = SimpleNamespace(
        id=share.page_id,
        space_id=uuid.uuid4(),
        title="Protected Doc",
        content="<p>Classified info</p>",
        deleted_at=None,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    space = SimpleNamespace(
        id=page.space_id,
        key="DOC",
        name="Documentation",
        status=SpaceStatus.active,
    )

    with patch("app.modules.shares.service.SiteSettingsService") as mock_settings:
        mock_settings.return_value.get_effective = AsyncMock(return_value=mock_effective)
        mock_scalars = Mock()
        mock_scalars.first.return_value = share
        mock_session.scalars.return_value = mock_scalars

        def mock_get(model, obj_id):
            if model == WikiPage:
                return page
            if model == Space:
                return space
            return None

        mock_session.get.side_effect = mock_get

        # 1. No password supplied -> returns metadata with empty content
        view = await service.get_share("pw-token", password=None)
        assert view.has_password is True
        assert view.is_password_verified is False
        assert view.content_html == ""
        assert view.title == "Protected Doc"
        assert share.view_count == 5  # Not incremented

        # 2. Wrong password -> raises AuthenticationError
        with pytest.raises(AuthenticationError, match="Incorrect password"):
            await service.get_share("pw-token", password="wrongpassword")

        # 3. Correct password -> increments view_count and returns content
        unlocked = await service.get_share("pw-token", password="secret123")
        assert unlocked.has_password is True
        assert unlocked.is_password_verified is True
        assert unlocked.content_html == "<p>Classified info</p>"
        assert share.view_count == 6
        mock_session.flush.assert_awaited()


async def test_public_share_service_no_password_access(mock_session):
    service = PublicShareService(mock_session)
    mock_effective = SimpleNamespace(public_shares_enabled=True)
    share = SimpleNamespace(
        id=uuid.uuid4(),
        token="open-token",
        page_id=uuid.uuid4(),
        is_active=True,
        expires_at=None,
        password_hash=None,
        view_count=10,
    )
    page = SimpleNamespace(
        id=share.page_id,
        space_id=uuid.uuid4(),
        title="Public Doc",
        content="<p>Public info</p>",
        deleted_at=None,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    space = SimpleNamespace(
        id=page.space_id,
        key="PUB",
        name="Public Space",
        status=SpaceStatus.active,
    )

    with patch("app.modules.shares.service.SiteSettingsService") as mock_settings:
        mock_settings.return_value.get_effective = AsyncMock(return_value=mock_effective)
        mock_scalars = Mock()
        mock_scalars.first.return_value = share
        mock_session.scalars.return_value = mock_scalars

        def mock_get(model, obj_id):
            if model == WikiPage:
                return page
            if model == Space:
                return space
            return None

        mock_session.get.side_effect = mock_get

        view = await service.get_share("open-token")
        assert view.has_password is False
        assert view.is_password_verified is True
        assert view.content_html == "<p>Public info</p>"
        assert share.view_count == 11


async def test_share_service_create_public_share_disabled(mock_session, mock_user):
    service = ShareService(mock_session, mock_user)
    service._resolve = AsyncMock(return_value=(Mock(), SimpleNamespace(id=uuid.uuid4())))
    mock_effective = SimpleNamespace(public_shares_enabled=False)

    with patch("app.modules.shares.service.SiteSettingsService") as mock_settings:
        mock_settings.return_value.get_effective = AsyncMock(return_value=mock_effective)
        with pytest.raises(PermissionDeniedError, match="disabled by system administrator"):
            await service.create_public_share("KEY", "page-slug", PublicShareCreate())


async def test_share_service_create_public_share_success(mock_session, mock_user):
    service = ShareService(mock_session, mock_user)
    page_id = uuid.uuid4()
    service._resolve = AsyncMock(return_value=(Mock(), SimpleNamespace(id=page_id)))
    mock_effective = SimpleNamespace(public_shares_enabled=True)

    with patch("app.modules.shares.service.SiteSettingsService") as mock_settings:
        mock_settings.return_value.get_effective = AsyncMock(return_value=mock_effective)

        result = await service.create_public_share(
            "KEY",
            "page-slug",
            PublicShareCreate(expires_in_days=7, password="pass"),
        )

        assert result.page_id == page_id
        assert result.has_password is True
        assert result.expires_at is not None
        assert result.share_url.startswith("/share/")
        mock_session.add.assert_called_once()
        mock_session.flush.assert_awaited_once()


async def test_share_service_revoke_public_share(mock_session, mock_user):
    service = ShareService(mock_session, mock_user)
    page_id = uuid.uuid4()
    share_id = uuid.uuid4()
    service._resolve = AsyncMock(return_value=(Mock(), SimpleNamespace(id=page_id)))

    share = SimpleNamespace(id=share_id, page_id=page_id, is_active=True)
    mock_scalars = Mock()
    mock_scalars.first.return_value = share
    mock_session.scalars.return_value = mock_scalars

    await service.revoke_public_share("KEY", "page-slug", share_id)
    assert share.is_active is False
    mock_session.flush.assert_awaited_once()


async def test_share_service_update_public_share_success(mock_session, mock_user):
    service = ShareService(mock_session, mock_user)
    page_id = uuid.uuid4()
    share_id = uuid.uuid4()
    service._resolve = AsyncMock(return_value=(Mock(), SimpleNamespace(id=page_id)))
    mock_effective = SimpleNamespace(public_shares_enabled=True)

    share = SimpleNamespace(
        id=share_id,
        token="tok-original-stays-same",
        page_id=page_id,
        created_at=datetime.now(UTC) - timedelta(days=2),
        expires_at=datetime.now(UTC) + timedelta(days=5),
        password_hash=None,
        view_count=3,
        is_active=True,
    )
    mock_scalars = Mock()
    mock_scalars.first.return_value = share
    mock_session.scalars.return_value = mock_scalars

    with patch("app.modules.shares.service.SiteSettingsService") as mock_settings:
        mock_settings.return_value.get_effective = AsyncMock(return_value=mock_effective)

        # Update expiration to 30 days and add password
        result = await service.update_public_share(
            "KEY",
            "page-slug",
            share_id,
            PublicShareUpdate(expires_in_days=30, password="new-secret-pw"),
        )

        assert result.id == share_id
        assert result.token == "tok-original-stays-same"
        assert result.has_password is True
        assert share.password_hash is not None
        assert share.expires_at > datetime.now(UTC) + timedelta(days=28)
        mock_session.flush.assert_awaited_once()


async def test_share_service_update_public_share_clear_options(mock_session, mock_user):
    service = ShareService(mock_session, mock_user)
    page_id = uuid.uuid4()
    share_id = uuid.uuid4()
    service._resolve = AsyncMock(return_value=(Mock(), SimpleNamespace(id=page_id)))
    mock_effective = SimpleNamespace(public_shares_enabled=True)

    share = SimpleNamespace(
        id=share_id,
        token="tok-original-stays-same",
        page_id=page_id,
        created_at=datetime.now(UTC) - timedelta(days=2),
        expires_at=datetime.now(UTC) + timedelta(days=5),
        password_hash="some-hash",
        view_count=3,
        is_active=True,
    )
    mock_scalars = Mock()
    mock_scalars.first.return_value = share
    mock_session.scalars.return_value = mock_scalars

    with patch("app.modules.shares.service.SiteSettingsService") as mock_settings:
        mock_settings.return_value.get_effective = AsyncMock(return_value=mock_effective)

        # Clear expiration (make it never expire) and remove password
        result = await service.update_public_share(
            "KEY",
            "page-slug",
            share_id,
            PublicShareUpdate(clear_expiration=True, clear_password=True),
        )

        assert result.id == share_id
        assert result.token == "tok-original-stays-same"
        assert result.has_password is False
        assert share.password_hash is None
        assert share.expires_at is None
        mock_session.flush.assert_awaited_once()


async def test_share_service_lists_active_links_and_expiration(mock_session, mock_user):
    service = ShareService(mock_session, mock_user)
    page_id = uuid.uuid4()
    service._resolve = AsyncMock(return_value=(Mock(), SimpleNamespace(id=page_id)))
    now = datetime.now(UTC)
    shares = [
        SimpleNamespace(id=uuid.uuid4(), token="expired", page_id=page_id,
                        created_at=now - timedelta(days=4), expires_at=now - timedelta(days=1),
                        password_hash="hash", view_count=2, is_active=True),
        SimpleNamespace(id=uuid.uuid4(), token="open", page_id=page_id,
                        created_at=now, expires_at=None, password_hash=None,
                        view_count=0, is_active=True),
    ]
    mock_session.scalars.return_value = Mock()
    mock_session.scalars.return_value.all.return_value = shares
    with patch("app.modules.shares.service.SiteSettingsService") as settings:
        settings.return_value.get_effective = AsyncMock(
            return_value=SimpleNamespace(public_shares_enabled=True)
        )
        result = await service.list_public_shares("KEY", "page-slug")
    assert result.enabled is True
    assert [item.token for item in result.shares] == ["expired", "open"]
    assert result.shares[0].is_expired is True
    assert result.shares[0].has_password is True
    assert result.shares[1].is_expired is False
    assert result.shares[1].share_url == "/share/open"


async def test_share_service_update_rejects_disabled_or_missing_link(mock_session, mock_user):
    service = ShareService(mock_session, mock_user)
    service._resolve = AsyncMock(return_value=(Mock(), SimpleNamespace(id=uuid.uuid4())))
    share_id = uuid.uuid4()
    with patch("app.modules.shares.service.SiteSettingsService") as settings:
        settings.return_value.get_effective = AsyncMock(
            return_value=SimpleNamespace(public_shares_enabled=False)
        )
        with pytest.raises(PermissionDeniedError):
            await service.update_public_share("KEY", "page-slug", share_id, PublicShareUpdate())

        settings.return_value.get_effective.return_value.public_shares_enabled = True
        mock_session.scalars.return_value = Mock()
        mock_session.scalars.return_value.first.return_value = None
        with pytest.raises(NotFoundError):
            await service.update_public_share("KEY", "page-slug", share_id, PublicShareUpdate())


async def test_share_service_revoke_missing_link(mock_session, mock_user):
    service = ShareService(mock_session, mock_user)
    service._resolve = AsyncMock(return_value=(Mock(), SimpleNamespace(id=uuid.uuid4())))
    mock_session.scalars.return_value = Mock()
    mock_session.scalars.return_value.first.return_value = None
    with pytest.raises(NotFoundError):
        await service.revoke_public_share("KEY", "page-slug", uuid.uuid4())
