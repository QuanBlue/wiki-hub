import pytest
from pydantic import ValidationError

from app.schemas.site_settings import SidebarPermissions, SiteSettingsUpdate
from app.services.site_settings import SiteSettingsService


def test_sidebar_permissions_default_keeps_knowledge_navigation_open() -> None:
    permissions = SidebarPermissions()

    assert permissions.home == ["admin", "member"]
    assert permissions.spaces == ["admin", "member"]
    assert permissions.settings == ["admin"]
    assert permissions.backups == ["admin"]


def test_sidebar_permissions_requires_a_role_for_knowledge_navigation() -> None:
    with pytest.raises(ValidationError, match="At least one role"):
        SidebarPermissions(recent=[])


def test_sidebar_permissions_does_not_expose_administration_to_members() -> None:
    with pytest.raises(ValidationError, match="administrators only"):
        SidebarPermissions(settings=["admin", "member"])


def test_site_settings_validators_normalise_and_validate_extensions() -> None:
    payload = SiteSettingsUpdate(site_name="  WikiHub  ", allowed_attachment_types=[".PNG", "png", "", "*"])
    assert payload.site_name == "WikiHub"
    assert payload.allowed_attachment_types == ["png", "*"]
    assert SiteSettingsUpdate(site_name="   ").site_name is None
    with pytest.raises(ValidationError, match="valid file extension"):
        SiteSettingsUpdate(allowed_attachment_types=["not-valid!"])


def test_site_settings_effective_defaults_and_overrides() -> None:
    defaults = SiteSettingsService.env_defaults()
    assert defaults.max_upload_size_bytes > 0
    overridden = type("Row", (), {
        "site_name": "Custom",
        "max_upload_size_mb": 2,
        "max_backup_import_size_mb": 3,
        "allowed_attachment_types": ["md"],
        "sidebar_permissions": None,
        "session_ttl_hours": 4,
    })()
    effective = SiteSettingsService._effective(overridden)
    assert effective.site_name == "Custom"
    assert effective.max_upload_size_mb == 2
    assert effective.max_backup_import_size_mb == 3
    assert effective.allowed_attachment_types == ["md"]
    assert effective.session_ttl_hours == 4
