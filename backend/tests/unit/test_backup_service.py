from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest

from app.core.exceptions import BadRequestError
from app.models.space import SpaceRole
from app.modules.backup.service import BackupService, _ReportBuilder
from app.schemas.backup import (
    BackupDocument,
    BackupMeta,
    BackupSiteSettings,
    BackupSpace,
    BackupSpaceFavorite,
    BackupSpaceMember,
    BackupUser,
)
from app.schemas.site_settings import SiteSettingsOverrides


def document(version: int = 1) -> BackupDocument:
    return BackupDocument(
        wikihub_backup=BackupMeta(
            version=1,
            exported_at=datetime.now(UTC),
            app_version="test",
            site_name="WikiHub",
            includes_credentials=False,
        ),
        site_settings=BackupSiteSettings(),
    )


def service() -> BackupService:
    result = BackupService(Mock())
    result.audit = Mock(record=AsyncMock())
    result.site_settings = Mock(
        read=AsyncMock(return_value=SimpleNamespace(overrides=SiteSettingsOverrides())),
        get_effective=AsyncMock(return_value=SimpleNamespace(site_name="WikiHub")),
    )
    return result


def test_report_builder_counts_and_truncation(monkeypatch: pytest.MonkeyPatch) -> None:
    builder = _ReportBuilder()
    builder.add("user", "alice", "created")
    builder.add("user", "bob", "skipped", "exists")
    builder.add("user", "bad", "error", "invalid")
    assert builder.created == {"user": 1}
    assert builder.skipped == {"user": 1}
    assert builder.errors == {"user": 1}
    monkeypatch.setattr("app.modules.backup.service.MAX_REPORT_ENTRIES", 0)
    builder.add("space", "ENG", "created")
    assert builder.truncated is True and len(builder.entries) == 3


@pytest.mark.asyncio
async def test_export_document_without_credentials() -> None:
    svc = service()
    empty = Mock(scalars=Mock(return_value=[]))
    svc.session.execute = AsyncMock(side_effect=[empty] * 16)
    result = await svc.export_document()
    assert result.wikihub_backup.includes_credentials is False
    assert result.wikihub_backup.counts == {
        "users": 0,
        "spaces": 0,
        "space_members": 0,
        "space_favorites": 0,
        "groups": 0,
        "pages": 0,
        "page_revisions": 0,
        "page_likes": 0,
        "page_restrictions": 0,
    }
    svc.audit.record.assert_awaited_once()


@pytest.mark.asyncio
async def test_export_document_serializes_relations_and_credentials() -> None:
    svc = service()
    user_id, space_id = uuid4(), uuid4()
    user = SimpleNamespace(
        id=user_id,
        username="alice",
        email="alice@example.com",
        full_name="Alice",
        is_active=True,
        is_superuser=False,
        is_protected=False,
        last_login_at=None,
        created_at=None,
        password_hash="hash",
        bio="",
        pronouns="",
        profile_url="",
        social_links=[],
        company="",
        avatar_url=None,
        avatar_object_key=None,
    )
    space = SimpleNamespace(
        id=space_id,
        key="ENG",
        name="Engineering",
        description="Docs",
        icon="book",
        status="active",
        visibility="open",
        created_at=None,
        updated_at=None,
        created_by_id=user_id,
    )
    member = SimpleNamespace(space_id=space_id, user_id=user_id, role=SpaceRole.viewer)
    favorite = SimpleNamespace(space_id=space_id, user_id=user_id)
    results = [
        Mock(scalars=Mock(return_value=[user])),
        Mock(scalars=Mock(return_value=[space])),
        Mock(scalars=Mock(return_value=[member])),
        Mock(scalars=Mock(return_value=[favorite])),
    ] + [Mock(scalars=Mock(return_value=[]))] * 12
    svc.session.execute = AsyncMock(side_effect=results)
    result = await svc.export_document(include_credentials=True)
    assert result.users[0].password_hash == "hash"
    assert result.space_members[0].username == "alice"
    assert result.space_favorites[0].space_key == "ENG"


@pytest.mark.asyncio
async def test_import_document_validates_savepoint_and_audits() -> None:
    svc = service()
    savepoint = Mock(is_active=True, rollback=AsyncMock(), commit=AsyncMock())
    svc.session.begin_nested = AsyncMock(return_value=savepoint)
    svc._apply = AsyncMock()

    dry = await svc.import_document(document(), dry_run=True)
    assert dry.dry_run is True
    savepoint.rollback.assert_awaited_once()

    savepoint.rollback.reset_mock()
    await svc.import_document(document(), dry_run=False)
    savepoint.commit.assert_awaited_once()
    assert svc.audit.record.await_count == 2

    bad = SimpleNamespace(wikihub_backup=SimpleNamespace(version=99))
    with pytest.raises(BadRequestError, match="Unsupported backup version"):
        await svc.import_document(bad)


@pytest.mark.asyncio
async def test_import_document_rolls_back_a_partial_restore_on_error() -> None:
    svc = service()
    savepoint = Mock(is_active=True, rollback=AsyncMock(), commit=AsyncMock())
    svc.session.begin_nested = AsyncMock(return_value=savepoint)
    svc._apply = AsyncMock(side_effect=RuntimeError("late database failure"))

    with pytest.raises(RuntimeError, match="late database failure"):
        await svc.import_document(document(), dry_run=False)

    savepoint.rollback.assert_awaited_once()
    savepoint.commit.assert_not_awaited()
    svc.audit.record.assert_not_awaited()


@pytest.mark.asyncio
async def test_apply_covers_conflicts_memberships_favourites_and_settings() -> None:
    svc = service()
    protected = SimpleNamespace(username="root", email="root@example.com")
    creator = SimpleNamespace(id="creator-id", username="creator")
    member_user = SimpleNamespace(id="member-id", username="member")
    member_space = SimpleNamespace(id="space-id")
    svc.users.get_protected = AsyncMock(return_value=protected)

    async def by_username(name):
        return {"existing": creator, "creator": creator, "member": member_user}.get(name)

    async def by_email(email):
        return creator if email == "existing@example.com" else None

    svc.users.get_by_username = AsyncMock(side_effect=by_username)
    svc.users.get_by_email = AsyncMock(side_effect=by_email)
    svc.users.get = AsyncMock(return_value=None)
    svc.spaces.get_by_key = AsyncMock(
        side_effect=lambda key: member_space if key.strip().upper() in {"ENG", "EXISTING"} else None
    )
    svc.spaces.get = AsyncMock(return_value=None)
    svc.spaces.get_member = AsyncMock(side_effect=[SimpleNamespace(), None])
    svc.spaces.is_favorite = AsyncMock(side_effect=[True, False])
    svc.session.add = Mock()
    svc.session.flush = AsyncMock()
    svc.site_settings.read = AsyncMock(
        return_value=SimpleNamespace(overrides=SiteSettingsOverrides(site_name="Configured"))
    )

    incoming = document()
    incoming.users = [
        BackupUser(
            id="00000000-0000-0000-0000-000000000001", username="root", email="x@example.com"
        ),
        BackupUser(
            id="00000000-0000-0000-0000-000000000002", username="existing", email="x@example.com"
        ),
        BackupUser(
            id="00000000-0000-0000-0000-000000000003", username="new", email="new@example.com"
        ),
        BackupUser(
            id="00000000-0000-0000-0000-000000000004",
            username="email",
            email="existing@example.com",
        ),
    ]
    incoming.spaces = [
        BackupSpace(id="00000000-0000-0000-0000-000000000010", key="existing", name="Exists"),
        BackupSpace(
            id="00000000-0000-0000-0000-000000000011",
            key="eng",
            name="Engineering",
            created_by_username="creator",
        ),
    ]
    incoming.space_members = [
        BackupSpaceMember(space_key="missing", username="member", role=SpaceRole.viewer),
        BackupSpaceMember(space_key="eng", username="missing", role=SpaceRole.viewer),
        BackupSpaceMember(space_key="eng", username="member", role=SpaceRole.viewer),
        BackupSpaceMember(space_key="eng", username="member", role=SpaceRole.viewer),
    ]
    incoming.space_favorites = [
        BackupSpaceFavorite(space_key="missing", username="member"),
        BackupSpaceFavorite(space_key="eng", username="member"),
        BackupSpaceFavorite(space_key="eng", username="member"),
    ]
    report = __import__("app.modules.backup.service", fromlist=["_ReportBuilder"])._ReportBuilder()
    no_password: list[str] = []
    await svc._apply(incoming, report, no_password)
    assert report.skipped["user"] == 3
    assert report.created["user"] == 1
    assert report.skipped["space_member"] == 3
    assert report.skipped["space_favorite"] == 2
    assert report.skipped["site_settings"] == 1
    assert "new" in no_password


@pytest.mark.asyncio
async def test_apply_creates_space_and_new_site_settings() -> None:
    svc = service()
    creator = SimpleNamespace(id="creator-id", username="creator")
    svc.users.get_protected = AsyncMock(return_value=None)
    svc.users.get_by_username = AsyncMock(return_value=creator)
    svc.users.get_by_email = AsyncMock(return_value=None)
    svc.users.get = AsyncMock(return_value=None)
    svc.spaces.get_by_key = AsyncMock(return_value=None)
    svc.spaces.get = AsyncMock(return_value=None)
    svc.session.add = Mock()
    svc.session.flush = AsyncMock()
    svc.site_settings.read = AsyncMock(
        return_value=SimpleNamespace(overrides=SiteSettingsOverrides())
    )
    svc.site_settings.update = AsyncMock()
    incoming = document()
    incoming.spaces = [
        BackupSpace(
            id="00000000-0000-0000-0000-000000000012",
            key=" eng ",
            name=" Engineering ",
            created_by_username="creator",
        )
    ]
    incoming.site_settings = BackupSiteSettings(site_name="Imported")
    report = _ReportBuilder()
    await svc._apply(incoming, report, [])
    assert report.created == {"space": 1, "site_settings": 1}
    svc.site_settings.update.assert_awaited_once()
