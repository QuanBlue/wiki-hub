"""Sign-in page showcase panel: schema rules, effective settings, image endpoints."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from pydantic import ValidationError

from app.api.v1.meta import read_login_image
from app.api.v1.site_settings import (
    MAX_LOGIN_IMAGE_BYTES,
    delete_login_image,
    get_login_image_storage,
    upload_login_image,
)
from app.core.exceptions import BadRequestError, PayloadTooLargeError, UnsupportedMediaTypeError
from app.schemas.site_settings import (
    LoginPanel,
    LoginPanelCopy,
    LoginPanelFeature,
    SiteSettingsUpdate,
)
from app.services.site_settings import SiteSettingsService


class _Result:
    def __init__(self, row):
        self.row = row

    def scalar_one_or_none(self):
        return self.row


def _row(**overrides):
    values = {
        "site_name": None,
        "theme_color": None,
        "default_font": None,
        "logo_icon": None,
        "custom_logo_url": None,
        "max_upload_size_mb": None,
        "max_backup_import_size_mb": None,
        "allowed_attachment_types": None,
        "sidebar_permissions": None,
        "announcement": None,
        "login_panel": None,
        "login_image_object_key": None,
        "login_image_content_type": None,
        "login_image_updated_at": None,
        "session_ttl_hours": None,
        "updated_by_id": None,
        "updated_at": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _service(row) -> SiteSettingsService:
    session = Mock()
    session.execute = AsyncMock(return_value=_Result(row))
    session.get = AsyncMock(return_value=None)
    session.flush = AsyncMock()
    session.refresh = AsyncMock()
    session.add = Mock()
    service = SiteSettingsService(session, actor=SimpleNamespace(id="actor-id"))
    service.audit.record = AsyncMock()
    return service


def test_blank_text_means_use_the_default() -> None:
    copy = LoginPanelCopy(tagline="  ", headline=" Hello ", footer="")
    assert copy.tagline is None
    assert copy.headline == "Hello"
    assert copy.footer is None
    assert LoginPanelFeature(title="   ", description=" x ").title is None


def test_panel_has_exactly_three_features_and_at_least_one_enabled() -> None:
    assert len(LoginPanel().en.features) == 3
    with pytest.raises(ValidationError, match="exactly three"):
        LoginPanelCopy(features=[LoginPanelFeature()])
    off = [LoginPanelFeature(enabled=False) for _ in range(3)]
    with pytest.raises(ValidationError, match="at least one"):
        LoginPanel(vi=LoginPanelCopy(features=off))


def test_length_limits_are_enforced() -> None:
    with pytest.raises(ValidationError):
        LoginPanelCopy(headline="x" * 161)
    with pytest.raises(ValidationError):
        LoginPanelFeature(description="x" * 241)


@pytest.mark.asyncio
async def test_effective_defaults_then_overrides_and_image_url() -> None:
    assert (await _service(None).get_effective()).login_panel == LoginPanel()
    assert (await _service(None).get_effective()).login_image_url is None

    stored = LoginPanel(en=LoginPanelCopy(headline="Ours")).model_dump(mode="json")
    updated = datetime(2026, 11, 4, tzinfo=UTC)
    row = _row(
        login_panel=stored,
        login_image_object_key="site/login/a.png",
        login_image_updated_at=updated,
    )
    effective = await _service(row).get_effective()
    assert effective.login_panel.en.headline == "Ours"
    assert effective.login_image_url == f"/api/v1/meta/login-image?v={int(updated.timestamp())}"
    # An object key without a timestamp is not served.
    assert (await _service(_row(login_image_object_key="k")).get_effective()).login_image_url is None


@pytest.mark.asyncio
async def test_update_stores_and_audits_login_panel() -> None:
    row = _row()
    service = _service(row)
    panel = LoginPanel(en=LoginPanelCopy(tagline="Hi"), hide_image=True)
    await service.update(SiteSettingsUpdate(login_panel=panel))
    assert row.login_panel["en"]["tagline"] == "Hi"
    assert row.login_panel["hide_image"] is True
    service.audit.record.assert_awaited_once()

    await service.update(SiteSettingsUpdate(login_panel=None))
    assert row.login_panel is None


@pytest.mark.asyncio
async def test_set_and_clear_login_image_manage_storage() -> None:
    row = _row(login_image_object_key="site/login/old.png", login_image_content_type="image/png")
    service = _service(row)
    storage = AsyncMock()

    await service.set_login_image(storage, data=b"img", content_type="image/webp", extension="webp")
    storage.put.assert_awaited_once()
    new_key = storage.put.await_args.args[0]
    assert new_key.startswith("site/login/") and new_key.endswith(".webp")
    storage.delete.assert_awaited_once_with("site/login/old.png")
    assert row.login_image_object_key == new_key
    assert row.login_image_updated_at is not None

    storage.reset_mock()
    await service.clear_login_image(storage)
    storage.delete.assert_awaited_once_with(new_key)
    assert row.login_image_object_key is None
    assert row.login_image_updated_at is None

    # Clearing when there is nothing to clear touches nothing.
    storage.reset_mock()
    await service.clear_login_image(storage)
    storage.delete.assert_not_awaited()


@pytest.mark.asyncio
async def test_set_login_image_creates_the_row_when_missing() -> None:
    service = _service(None)
    storage = AsyncMock()
    await service.set_login_image(storage, data=b"i", content_type="image/png", extension="png")
    service.session.add.assert_called_once()
    storage.delete.assert_not_awaited()


@pytest.mark.asyncio
async def test_read_login_image_returns_bytes_or_none() -> None:
    storage = AsyncMock()
    storage.get.return_value = b"bytes"
    assert await _service(None).read_login_image(storage) is None
    assert await _service(_row()).read_login_image(storage) is None
    found = await _service(
        _row(login_image_object_key="k", login_image_content_type="image/jpeg")
    ).read_login_image(storage)
    assert found == (b"bytes", "image/jpeg")
    default_type = await _service(_row(login_image_object_key="k")).read_login_image(storage)
    assert default_type == (b"bytes", "image/png")


def _upload(content_type: str, data: bytes):
    file = AsyncMock()
    file.content_type = content_type
    file.read.return_value = data
    return file


@pytest.mark.asyncio
async def test_upload_endpoint_validates_the_file() -> None:
    service = Mock()
    service.set_login_image = AsyncMock(return_value="ok")
    storage = AsyncMock()
    admin = Mock()

    with pytest.raises(UnsupportedMediaTypeError):
        await upload_login_image(_upload("image/gif", b"x"), service, admin, storage)
    with pytest.raises(PayloadTooLargeError):
        await upload_login_image(
            _upload("image/png", b"x" * (MAX_LOGIN_IMAGE_BYTES + 1)), service, admin, storage
        )
    with pytest.raises(BadRequestError):
        await upload_login_image(_upload("image/png", b""), service, admin, storage)

    assert await upload_login_image(_upload("IMAGE/PNG", b"png"), service, admin, storage) == "ok"
    service.set_login_image.assert_awaited_once_with(
        storage, data=b"png", content_type="image/png", extension="png"
    )


@pytest.mark.asyncio
async def test_delete_endpoint_and_public_read_endpoint() -> None:
    service = Mock()
    service.clear_login_image = AsyncMock(return_value="cleared")
    storage = AsyncMock()
    assert await delete_login_image(service, Mock(), storage) == "cleared"

    service.read_login_image = AsyncMock(return_value=None)
    assert (await read_login_image(service, storage)).status_code == 404

    service.read_login_image = AsyncMock(return_value=(b"img", "image/webp"))
    response = await read_login_image(service, storage)
    assert response.body == b"img"
    assert response.media_type == "image/webp"
    assert "public" in response.headers["cache-control"]


def test_login_image_storage_dependency_builds_a_storage() -> None:
    assert get_login_image_storage() is not None
