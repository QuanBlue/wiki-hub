from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import Request, Response

from app.api.v1 import (
    attachments,
    audit_logs,
    auth,
    backup,
    groups,
    meta,
    site_settings,
    storage_admin,
    users,
)
from app.models.permission import GlobalPermission
from app.services.storage import StoredObject


def _user() -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        id=uuid.uuid4(),
        username="admin",
        email="admin@example.com",
        full_name="Admin",
        avatar_url=None,
        bio="",
        pronouns="",
        profile_url="",
        social_links=[],
        company="",
        is_active=True,
        is_superuser=True,
        is_protected=False,
        last_login_at=None,
        created_at=now,
    )


@pytest.mark.asyncio
async def test_auth_route_wrappers(monkeypatch: pytest.MonkeyPatch) -> None:
    user = _user()
    service = Mock(actor=user)
    service.authenticate = AsyncMock(return_value=user)
    service.begin_impersonation = AsyncMock(return_value=user)
    service.end_impersonation = AsyncMock(return_value=user)
    effective = SimpleNamespace(session_ttl_hours=2)
    monkeypatch.setattr(auth.rate_limit, "enforce", AsyncMock())
    monkeypatch.setattr(
        auth.SiteSettingsService, "get_effective", AsyncMock(return_value=effective)
    )
    monkeypatch.setattr(
        auth, "create_access_token", lambda *args, **kwargs: ("token", datetime.now(UTC))
    )
    monkeypatch.setattr(
        auth, "decode_token_identity", lambda _token: SimpleNamespace(jti="session-id")
    )
    request = Request(
        {
            "type": "http",
            "client": ("127.0.0.1", 1234),
            "headers": [],
            "method": "POST",
            "path": "/",
        }
    )
    response = Response()
    session = Mock(execute=AsyncMock(), flush=AsyncMock())
    client = SimpleNamespace(ip="127.0.0.1", user_agent=None)
    result = await auth.login(
        SimpleNamespace(username="Admin", password="password"),
        request,
        response,
        service,
        session,
        client,
    )
    assert result.access_token == "token"
    await auth.logout(response)
    await auth.renew(response, user, None, session, request, client)
    me = await auth.me(user, None, session)
    assert me.id == user.id
    impersonated = await auth.start_impersonation(
        SimpleNamespace(user_id=user.id), response, service, session, client
    )
    assert impersonated.user.id == user.id
    ended = await auth.stop_impersonation(response, request, service, session, client)
    assert ended.user.id == user.id


@pytest.mark.asyncio
async def test_auth_session_route_wrappers(monkeypatch: pytest.MonkeyPatch) -> None:
    user = _user()
    now = datetime.now(UTC)
    rows = [
        SimpleNamespace(
            id=uuid.uuid4(),
            created_at=now,
            last_seen_at=now,
            expires_at=now,
            ip_address="127.0.0.1",
            user_agent="browser",
            token_jti="current",
            impersonator_id=None,
        ),
        SimpleNamespace(
            id=uuid.uuid4(),
            created_at=now,
            last_seen_at=now,
            expires_at=now,
            ip_address="127.0.0.2",
            user_agent="admin browser",
            token_jti="admin",
            impersonator_id=uuid.uuid4(),
        ),
    ]
    tracker = Mock(
        list_for_user=AsyncMock(return_value=rows),
        revoke_others=AsyncMock(return_value=1),
    )
    monkeypatch.setattr(auth, "SessionService", lambda _session: tracker)
    monkeypatch.setattr(
        auth, "decode_token_identity", lambda _token: SimpleNamespace(jti="current")
    )
    request = Request(
        {
            "type": "http",
            "headers": [(b"cookie", b"wikihub_access=token")],
            "method": "GET",
            "path": "/",
        }
    )

    sessions = await auth.list_sessions(request, user, Mock())
    assert sessions[0].is_current and not sessions[0].is_admin_session
    assert not sessions[1].is_current and sessions[1].is_admin_session
    await auth.revoke_other_sessions(request, user, Mock())
    tracker.revoke_others.assert_awaited_once_with(user_id=user.id, current_jti="current")


@pytest.mark.asyncio
async def test_storage_attachment_backup_and_settings_wrappers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = _user()
    storage = Mock()
    storage.list_objects = AsyncMock(return_value=[StoredObject("a/b.txt", 4, "etag", None)])
    storage.presigned_url = AsyncMock(return_value="https://download")
    storage.exists = AsyncMock(return_value=True)
    storage.delete = AsyncMock()
    session = Mock()
    session.scalar = AsyncMock(side_effect=[None, None])
    session.flush = AsyncMock()
    assert (await storage_admin.list_storage_objects(user, storage))[0].key == "a/b.txt"
    assert (
        await storage_admin.presign_download(user, storage, key="a%20b.txt", inline=False)
    ).url == "/api/v1/storage/object?key=a%2520b.txt&download_as=a%20b.txt"
    deleted = await storage_admin.delete_storage_object(user, storage, session, key="a/b.txt")
    assert not deleted.archive_cleared and not deleted.attachment_deleted

    attachment = SimpleNamespace(
        page_id=uuid.uuid4(), content_type="text/plain", filename='a\\"\n.txt', object_key="k"
    )
    page = SimpleNamespace(space_id=uuid.uuid4())
    space = SimpleNamespace()
    session.get = AsyncMock(side_effect=[attachment, page, space])
    storage.get = AsyncMock(return_value=b"hello")
    monkeypatch.setattr(
        attachments,
        "SpaceService",
        lambda _session: SimpleNamespace(permissions=SimpleNamespace(require=AsyncMock())),
    )
    monkeypatch.setattr(
        attachments, "PageService", lambda _session: SimpleNamespace(require_page_view=AsyncMock())
    )
    response = await attachments.read_attachment(uuid.uuid4(), user, session, storage)
    assert (
        response.media_type == "text/plain"
        and "attachment" in response.headers["content-disposition"]
    )

    document = SimpleNamespace(model_dump_json=lambda indent=2: "{}")
    backup_service = Mock()
    backup_service.export_document = AsyncMock(return_value=document)
    response = await backup.export_backup(backup_service)
    assert response.media_type == "application/json"
    backup_service.import_document = AsyncMock(return_value=SimpleNamespace())
    upload = SimpleNamespace(filename="backup.json", read=AsyncMock(return_value=b"{}"))
    monkeypatch.setattr(backup.BackupDocument, "model_validate", Mock(return_value=document))
    assert await backup.import_backup(backup_service, upload, True) is not None

    settings_service = Mock()
    settings_service.read_sidebar_permissions = AsyncMock(return_value=SimpleNamespace())
    settings_service.read = AsyncMock(return_value=SimpleNamespace())
    settings_service.update = AsyncMock(return_value=SimpleNamespace())
    assert await site_settings.read_sidebar_permissions(user, settings_service)
    assert await site_settings.read_settings(user, settings_service)
    assert await site_settings.update_settings(SimpleNamespace(), settings_service, user)


@pytest.mark.asyncio
async def test_group_user_audit_and_meta_wrappers(monkeypatch: pytest.MonkeyPatch) -> None:
    user = _user()
    group = SimpleNamespace(id=uuid.uuid4(), owner_id=user.id)
    service = Mock()
    service.require_global = AsyncMock()
    service.get_group = AsyncMock(return_value=group)
    service.can_manage_group = AsyncMock(return_value=True)
    service.create_group = AsyncMock(return_value=group)
    service.update_group = AsyncMock(return_value=group)
    service.delete_group = AsyncMock()
    service.set_group_member = AsyncMock()
    service.set_group_global_permission = AsyncMock()
    monkeypatch.setattr(groups, "group_read", AsyncMock(return_value=SimpleNamespace(id=group.id)))
    result = Mock()
    result.scalars.return_value.all.return_value = [group]
    session = Mock()
    session.execute = AsyncMock(return_value=result)
    session.get = AsyncMock(return_value=user)
    session.scalar = AsyncMock(return_value=0)
    session.scalars = AsyncMock(return_value=[])
    assert await groups.list_groups(user, session, service, q=None) == [
        SimpleNamespace(id=group.id)
    ]
    assert await groups.create_group(SimpleNamespace(), user, service, session)
    assert await groups.get_group(group.id, user, service, session)
    assert await groups.update_group(group.id, SimpleNamespace(), user, service, session)
    await groups.delete_group(group.id, user, service)
    await groups.add_group_member(group.id, SimpleNamespace(user_id=user.id), user, service)
    await groups.remove_group_member(group.id, user.id, user, service)
    await groups.add_global_permission(group.id, GlobalPermission.manage_groups, user, service)
    await groups.remove_global_permission(group.id, GlobalPermission.manage_groups, user, service)
    audit_service = Mock(search=AsyncMock(return_value=SimpleNamespace()))
    assert await audit_logs.list_audit_logs(user, audit_service)
    assert await audit_logs.list_actions(user)
    monkeypatch.setattr(
        meta.SiteSettingsService,
        "env_defaults",
        classmethod(
            lambda cls: SimpleNamespace(
                site_name="WikiHub",
                theme_color="#216fc0",
                logo_icon="BookOpen",
                custom_logo_url=None,
                max_upload_size_bytes=1,
                allowed_attachment_types=[],
            )
        ),
    )
    meta_service = Mock(get_effective=AsyncMock(side_effect=OSError()))
    info = await meta.instance_info(meta_service)
    assert info.site_name == "WikiHub"
    user_service = Mock()
    user_service.update_own_profile = AsyncMock(return_value=user)
    user_service.change_password = AsyncMock(return_value=user)
    assert (await users.update_own_profile(SimpleNamespace(), user, user_service)).id == user.id
    assert (
        await users.change_own_password(
            SimpleNamespace(current_password="x", new_password="password"), user, user_service
        )
    ).id == user.id
