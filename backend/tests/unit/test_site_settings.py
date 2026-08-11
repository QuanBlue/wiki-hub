import pytest
from pydantic import ValidationError

from app.schemas.site_settings import SidebarPermissions


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
