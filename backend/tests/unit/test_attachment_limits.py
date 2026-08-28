"""Unit coverage for a space's own attachment size ceiling."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.modules.attachments.limits import limits_for_space
from app.schemas.site_settings import EffectiveSettings, SidebarPermissions


@pytest.fixture
def workspace() -> EffectiveSettings:
    return EffectiveSettings(
        site_name="WikiHub",
        theme_color="blue",
        default_font="inter",
        logo_icon="default",
        custom_logo_url=None,
        max_upload_size_mb=50,
        max_upload_size_bytes=50 * 1024 * 1024,
        max_backup_import_size_mb=1024,
        max_backup_import_size_bytes=1024 * 1024 * 1024,
        allowed_attachment_types=["pdf"],
        sidebar_permissions=SidebarPermissions(),
        session_ttl_hours=12,
    )


def _space(limit: int | None) -> SimpleNamespace:
    return SimpleNamespace(max_upload_size_mb=limit)


def test_a_space_can_raise_the_ceiling(workspace: EffectiveSettings) -> None:
    scoped = limits_for_space(workspace, _space(500))

    assert scoped.max_upload_size_mb == 500
    assert scoped.max_upload_size_bytes == 500 * 1024 * 1024


def test_a_space_can_lower_the_ceiling(workspace: EffectiveSettings) -> None:
    scoped = limits_for_space(workspace, _space(5))

    assert scoped.max_upload_size_mb == 5
    assert scoped.max_upload_size_bytes == 5 * 1024 * 1024


def test_everything_else_is_carried_over_untouched(workspace: EffectiveSettings) -> None:
    scoped = limits_for_space(workspace, _space(500))

    assert scoped.allowed_attachment_types == workspace.allowed_attachment_types
    assert scoped.max_backup_import_size_bytes == workspace.max_backup_import_size_bytes
    assert scoped.site_name == workspace.site_name


@pytest.mark.parametrize("limit", [None, 0, 50])
def test_a_space_without_its_own_limit_follows_the_workspace(
    workspace: EffectiveSettings, limit: int | None
) -> None:
    assert limits_for_space(workspace, _space(limit)) is workspace


def test_no_space_follows_the_workspace(workspace: EffectiveSettings) -> None:
    assert limits_for_space(workspace, None) is workspace
