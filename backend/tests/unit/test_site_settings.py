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
    assert permissions.settings == ["admin"]
    assert permissions.backups == ["admin"]


def test_sidebar_permissions_requires_a_role_for_knowledge_navigation() -> None:
    with pytest.raises(ValidationError, match="At least one role"):
        SidebarPermissions(recent=[])


def test_sidebar_permissions_does_not_expose_administration_to_members() -> None:
    with pytest.raises(ValidationError, match="administrators only"):
        SidebarPermissions(settings=["admin", "member"])


def test_site_settings_validators_normalise_and_validate_extensions() -> None:
    payload = SiteSettingsUpdate(
        site_name="  WikiHub  ", allowed_attachment_types=[".PNG", "png", "", "*"]
    )
    assert payload.site_name == "WikiHub"
    assert payload.allowed_attachment_types == ["png", "*"]
    assert SiteSettingsUpdate(site_name="   ").site_name is None
    with pytest.raises(ValidationError, match="valid file extension"):
        SiteSettingsUpdate(allowed_attachment_types=["not-valid!"])


def test_site_settings_effective_defaults_and_overrides() -> None:
    defaults = SiteSettingsService.env_defaults()
    assert defaults.max_upload_size_bytes > 0
    overridden = type(
        "Row",
        (),
        {
            "site_name": "Custom",
            "max_upload_size_mb": 2,
            "max_backup_import_size_mb": 3,
            "allowed_attachment_types": ["md"],
            "sidebar_permissions": None,
            "session_ttl_hours": 4,
        },
    )()
    effective = SiteSettingsService._effective(overridden)
    assert effective.site_name == "Custom"
    assert effective.max_upload_size_mb == 2
    assert effective.max_backup_import_size_mb == 3
    assert effective.allowed_attachment_types == ["md"]
    assert effective.session_ttl_hours == 4


@pytest.mark.asyncio
async def test_site_settings_read_and_update_audit_paths() -> None:
    row = SimpleNamespace(
        site_name="Old",
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
