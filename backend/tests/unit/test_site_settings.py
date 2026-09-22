from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from pydantic import ValidationError

from app.schemas.site_settings import SidebarPermissions, SiteSettingsUpdate
from app.services.site_settings import SiteSettingsService


class _Result:
    def __init__(self, row):
        self.row = row

    def scalar_one_or_none(self):
        return self.row


def test_sidebar_permissions_default_keeps_knowledge_navigation_open() -> None:
    permissions = SidebarPermissions()

    assert permissions.home == ["admin", "member"]
    assert permissions.spaces == ["admin", "member"]
    assert permissions.favorites == ["admin", "member"]
    assert permissions.pinned == ["admin", "member"]
    assert permissions.settings == ["admin"]
    assert permissions.backups == ["admin"]


def test_sidebar_permissions_allows_hiding_knowledge_navigation_from_everyone() -> None:
    permissions = SidebarPermissions(recent=[])
    assert permissions.recent == []


def test_sidebar_permissions_dedupes_an_explicit_role_list() -> None:
    permissions = SidebarPermissions(recent=["admin", "admin", "member"])
    assert permissions.recent == ["admin", "member"]


def test_sidebar_permissions_does_not_expose_administration_to_members() -> None:
    with pytest.raises(ValidationError, match="administrators only"):
        SidebarPermissions(settings=["admin", "member"])


def test_sidebar_permissions_coerces_home_back_to_visible_for_everyone() -> None:
    """Coerced, not rejected: this model also parses whatever is already
    stored on the settings row, including a legacy value saved before Home
    became fixed. Rejecting it would crash every effective-settings read."""
    assert SidebarPermissions(home=["admin"]).home == ["admin", "member"]
    assert SidebarPermissions(home=[]).home == ["admin", "member"]


def test_site_settings_validators_normalise_and_validate_extensions() -> None:
    payload = SiteSettingsUpdate(
        site_name="  WikiHub  ", allowed_attachment_types=[".PNG", "png", "", "*"]
    )
    assert payload.site_name == "WikiHub"
    assert payload.allowed_attachment_types == ["png", "*"]
    assert SiteSettingsUpdate(site_name="   ").site_name is None
    with pytest.raises(ValidationError, match="valid file extension"):
        SiteSettingsUpdate(allowed_attachment_types=["not-valid!"])


def test_site_settings_string_fields_normalise_blanks_to_none() -> None:
    blank = SiteSettingsUpdate(
        theme_color="   ", default_font="   ", logo_icon="   ", custom_logo_url="   "
    )
    assert blank.theme_color is None
    assert blank.default_font is None
    assert blank.logo_icon is None
    assert blank.custom_logo_url is None

    trimmed = SiteSettingsUpdate(
        theme_color="  Emerald  ",
        default_font="  Inter  ",
        logo_icon="  Book  ",
        custom_logo_url="  /logo.png  ",
    )
    assert trimmed.theme_color == "Emerald"
    assert trimmed.default_font == "inter"
    assert trimmed.logo_icon == "book"
    assert trimmed.custom_logo_url == "/logo.png"

    unset = SiteSettingsUpdate()
    assert unset.theme_color is None
    assert unset.default_font is None
    assert unset.logo_icon is None
    assert unset.custom_logo_url is None

    explicit_none = SiteSettingsUpdate(
        site_name=None,
        theme_color=None,
        default_font=None,
        logo_icon=None,
        custom_logo_url=None,
        allowed_attachment_types=None,
    )
    assert explicit_none.theme_color is None
    assert explicit_none.default_font is None
    assert explicit_none.logo_icon is None
    assert explicit_none.custom_logo_url is None
    assert explicit_none.allowed_attachment_types is None


def test_site_settings_effective_defaults_and_overrides() -> None:
    defaults = SiteSettingsService.env_defaults()
    assert defaults.max_upload_size_bytes > 0
    assert defaults.theme_color == "blue"
    assert defaults.logo_icon == "default"
    assert defaults.custom_logo_url is None
    overridden = type(
        "Row",
        (),
        {
            "site_name": "Custom",
            "theme_color": "emerald",
            "logo_icon": "sparkles",
            "custom_logo_url": "https://example.com/logo.svg",
            "max_upload_size_mb": 2,
            "max_backup_import_size_mb": 3,
            "allowed_attachment_types": ["md"],
            "sidebar_permissions": None,
            "session_ttl_hours": 4,
        },
    )()
    effective = SiteSettingsService._effective(overridden)
    assert effective.site_name == "Custom"
    assert effective.theme_color == "emerald"
    assert effective.logo_icon == "sparkles"
    assert effective.custom_logo_url == "https://example.com/logo.svg"
    assert effective.max_upload_size_mb == 2
    assert effective.max_backup_import_size_mb == 3
    assert effective.allowed_attachment_types == ["md"]
    assert effective.session_ttl_hours == 4


@pytest.mark.asyncio
async def test_site_settings_read_and_update_audit_paths() -> None:
    row = SimpleNamespace(
        site_name="Old",
        theme_color=None,
        logo_icon=None,
        custom_logo_url=None,
        max_upload_size_mb=None,
        max_backup_import_size_mb=None,
        allowed_attachment_types=None,
        sidebar_permissions=None,
        session_ttl_hours=None,
        updated_by_id="user-id",
        updated_at=None,
    )
    session = Mock()
    session.execute = AsyncMock(return_value=_Result(row))
    session.get = AsyncMock(return_value=SimpleNamespace(username="admin"))
    session.flush = AsyncMock()
    session.refresh = AsyncMock()
    service = SiteSettingsService(session, actor=SimpleNamespace(id="actor-id"))
    service.audit.record = AsyncMock()

    read = await service.read()
    assert read.updated_by_username == "admin"
    effective = await service.get_effective()
    assert effective.site_name == "Old"
    assert (await service.read_sidebar_permissions()).permissions.home == ["admin", "member"]

    await service.update(SiteSettingsUpdate(site_name="New"))
    assert row.site_name == "New"
    assert row.updated_by_id == "actor-id"
    service.audit.record.assert_awaited_once()


@pytest.mark.asyncio
async def test_site_settings_update_creates_row_and_skips_empty_audit() -> None:
    session = Mock()
    session.execute = AsyncMock(return_value=_Result(None))
    session.flush = AsyncMock()
    session.refresh = AsyncMock()
    service = SiteSettingsService(session)
    service.audit.record = AsyncMock()
    result = await service.update(SiteSettingsUpdate())
    assert result.overrides.site_name is None
    service.audit.record.assert_not_awaited()
