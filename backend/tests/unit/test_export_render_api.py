"""The export-render bundle endpoint: Bearer-only export-token auth, and live
re-verification of identity/permissions on every call."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import Response

from app.api.v1 import export_render
from app.api.v1.export_render import export_bundle, get_export_identity
from app.core.exceptions import AuthenticationError, NotFoundError, PermissionDeniedError
from app.core.security import create_export_token


def fake_request(authorization: str | None) -> SimpleNamespace:
    headers = {"Authorization": authorization} if authorization else {}
    return SimpleNamespace(headers=headers)


class TestGetExportIdentity:
    @pytest.mark.asyncio
    async def test_no_authorization_header_is_rejected(self) -> None:
        with pytest.raises(AuthenticationError, match="export token is required"):
            await get_export_identity(fake_request(None))

    @pytest.mark.asyncio
    async def test_a_non_bearer_scheme_is_rejected(self) -> None:
        with pytest.raises(AuthenticationError, match="export token is required"):
            await get_export_identity(fake_request("Basic abc123"))

    @pytest.mark.asyncio
    async def test_an_empty_bearer_value_is_rejected(self) -> None:
        with pytest.raises(AuthenticationError, match="export token is required"):
            await get_export_identity(fake_request("Bearer   "))

    @pytest.mark.asyncio
    async def test_a_valid_bearer_export_token_decodes(self) -> None:
        user_id, space_id, page_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        token, _ = create_export_token(
            user_id=user_id, space_id=space_id, page_id=page_id, fmt="html", ttl_seconds=60
        )
        identity = await get_export_identity(fake_request(f"Bearer {token}"))
        assert identity.subject == user_id
        assert identity.space_id == space_id
        assert identity.page_id == page_id


class TestExportBundle:
    def identity(self, **overrides: object) -> object:
        defaults = {
            "subject": uuid.uuid4(),
            "space_id": uuid.uuid4(),
            "page_id": uuid.uuid4(),
            "fmt": "pdf",
            "jti": "jti",
        }
        defaults.update(overrides)
        return SimpleNamespace(**defaults)

    def _patch_happy_path(self, monkeypatch: pytest.MonkeyPatch, *, space, page, user):
        auth_service = Mock()
        auth_service.get_active_user = AsyncMock(return_value=user)
        monkeypatch.setattr(export_render, "AuthService", Mock(return_value=auth_service))

        space_service = Mock()
        space_service.require_view = AsyncMock()
        space_service.permissions = Mock()
        space_service.permissions.require = AsyncMock()
        monkeypatch.setattr(export_render, "SpaceService", Mock(return_value=space_service))

        page_service = Mock()
        page_service.require_page_view = AsyncMock()
        monkeypatch.setattr(export_render, "PageService", Mock(return_value=page_service))

        monkeypatch.setattr(
            export_render, "prepare_export_html", AsyncMock(return_value="<p>content</p>")
        )
        site_settings_service = Mock()
        site_settings_service.get_effective = AsyncMock(
            return_value=SimpleNamespace(site_name="WikiHub", theme_color="blue", default_font="inter")
        )
        monkeypatch.setattr(
            export_render, "SiteSettingsService", Mock(return_value=site_settings_service)
        )
        monkeypatch.setattr(export_render, "get_storage", Mock(return_value=Mock()))
        return space_service, page_service

    @pytest.mark.asyncio
    async def test_happy_path_returns_the_bundle_and_sets_no_store(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        space = SimpleNamespace(id=uuid.uuid4(), key="ENG", name="Engineering", font_family="inter")
        page = SimpleNamespace(id=uuid.uuid4(), space_id=space.id, title="T", slug="t")
        user = SimpleNamespace(id=uuid.uuid4())
        self._patch_happy_path(monkeypatch, space=space, page=page, user=user)

        session = Mock()
        session.get = AsyncMock(side_effect=lambda model, _id: space if model.__name__ == "Space" else page)

        response = Response()
        bundle = await export_bundle(
            self.identity(subject=user.id, space_id=space.id, page_id=page.id), response, session
        )

        assert bundle.page.id == page.id
        assert bundle.space.key == "ENG"
        assert bundle.site.theme_color == "blue"
        assert response.headers["Cache-Control"] == "no-store"

    @pytest.mark.asyncio
    async def test_a_deactivated_or_missing_user_is_rejected(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        auth_service = Mock()
        auth_service.get_active_user = AsyncMock(
            side_effect=AuthenticationError("Your account is no longer active.")
        )
        monkeypatch.setattr(export_render, "AuthService", Mock(return_value=auth_service))

        with pytest.raises(AuthenticationError):
            await export_bundle(self.identity(), Response(), Mock())

    @pytest.mark.asyncio
    async def test_a_missing_space_is_a_404(self, monkeypatch: pytest.MonkeyPatch) -> None:
        auth_service = Mock()
        auth_service.get_active_user = AsyncMock(return_value=SimpleNamespace(id=uuid.uuid4()))
        monkeypatch.setattr(export_render, "AuthService", Mock(return_value=auth_service))

        session = Mock()
        session.get = AsyncMock(return_value=None)

        with pytest.raises(NotFoundError, match="Space not found"):
            await export_bundle(self.identity(), Response(), session)

    @pytest.mark.asyncio
    async def test_a_missing_page_is_a_404(self, monkeypatch: pytest.MonkeyPatch) -> None:
        space = SimpleNamespace(id=uuid.uuid4(), key="ENG", name="Engineering", font_family=None)
        auth_service = Mock()
        auth_service.get_active_user = AsyncMock(return_value=SimpleNamespace(id=uuid.uuid4()))
        monkeypatch.setattr(export_render, "AuthService", Mock(return_value=auth_service))

        session = Mock()
        session.get = AsyncMock(side_effect=lambda model, _id: space if model.__name__ == "Space" else None)

        with pytest.raises(NotFoundError, match="Page not found"):
            await export_bundle(self.identity(space_id=space.id), Response(), session)

    @pytest.mark.asyncio
    async def test_a_page_in_a_different_space_is_a_404(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        space = SimpleNamespace(id=uuid.uuid4(), key="ENG", name="Engineering", font_family=None)
        # The page exists, but belongs to some other space - never dereferenced
        # with this token's authority.
        page = SimpleNamespace(id=uuid.uuid4(), space_id=uuid.uuid4(), title="T", slug="t")
        auth_service = Mock()
        auth_service.get_active_user = AsyncMock(return_value=SimpleNamespace(id=uuid.uuid4()))
        monkeypatch.setattr(export_render, "AuthService", Mock(return_value=auth_service))

        session = Mock()
        session.get = AsyncMock(side_effect=lambda model, _id: space if model.__name__ == "Space" else page)

        with pytest.raises(NotFoundError, match="Page not found"):
            await export_bundle(
                self.identity(space_id=space.id, page_id=page.id), Response(), session
            )

    @pytest.mark.asyncio
    async def test_a_revoked_export_permission_is_rejected_even_within_the_token_ttl(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The token merely names a page; whether the user may still export it
        is decided fresh, every call - a permission revoked after minting must
        take effect immediately, not after the token expires."""
        space = SimpleNamespace(id=uuid.uuid4(), key="ENG", name="Engineering", font_family=None)
        page = SimpleNamespace(id=uuid.uuid4(), space_id=space.id, title="T", slug="t")
        user = SimpleNamespace(id=uuid.uuid4())
        space_service, _page_service = self._patch_happy_path(
            monkeypatch, space=space, page=page, user=user
        )
        space_service.permissions.require = AsyncMock(
            side_effect=PermissionDeniedError("Export permission is required.")
        )

        session = Mock()
        session.get = AsyncMock(side_effect=lambda model, _id: space if model.__name__ == "Space" else page)

        with pytest.raises(PermissionDeniedError):
            await export_bundle(
                self.identity(subject=user.id, space_id=space.id, page_id=page.id),
                Response(),
                session,
            )
