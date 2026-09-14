from __future__ import annotations

import io
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import Request, UploadFile
from starlette.datastructures import Headers

from app.api import deps, health
from app.api.v1 import (
    attachments,
    audit_logs,
    backup,
    confluence_import,
    groups,
    search,
    site_settings,
    spaces,
    storage_admin,
    users,
)
from app.core.exceptions import (
    AuthenticationError,
    BadRequestError,
    ConflictError,
    NotFoundError,
    PayloadTooLargeError,
    PermissionDeniedError,
    ServiceUnavailableError,
    UnsupportedMediaTypeError,
)
from app.core.security import create_access_token
from app.models.permission import GlobalPermission, Permission
from app.schemas.backup import BackupDocument, BackupMeta, ImportReport
from app.schemas.confluence_import import UploadInit, UploadPartUrlsRequest
from app.schemas.pagination import Page
from app.schemas.permission import GroupCreate, GroupMemberUpsert, GroupUpdate
from app.schemas.user import (
    PasswordChange,
    PasswordReset,
    SelfProfileUpdate,
    UserCreate,
    UserUpdate,
)
from app.services.storage import StoredObject


def _user() -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        id=uuid.uuid4(),
        username="alice",
        email="alice@example.com",
        full_name="Alice",
        avatar_url=None,
        bio="",
        pronouns="",
        profile_url="",
        social_links=[],
        company="",
        avatar_object_key=None,
        avatar_content_type=None,
        is_active=True,
        is_superuser=True,
        is_protected=False,
        last_login_at=None,
        created_at=now,
        groups=[],
        global_permissions=[],
    )


async def _body(payload: bytes):
    yield payload


def _request(range_header: str | None = None) -> SimpleNamespace:
    headers = {"range": range_header} if range_header else {}
    return SimpleNamespace(headers=headers)


@pytest.mark.asyncio
async def test_attachment_endpoint_errors_and_success(monkeypatch: pytest.MonkeyPatch) -> None:
    user = _user()
    session = Mock()
    storage = Mock(get_stream=AsyncMock(return_value=(4, _body(b"data"))))
    request = _request()
    with pytest.raises(NotFoundError):
        session.get = AsyncMock(return_value=None)
        await attachments.read_attachment(uuid.uuid4(), request, user, session, storage)

    attachment = SimpleNamespace(page_id=uuid.uuid4())
    session.get = AsyncMock(side_effect=[attachment, None])
    with pytest.raises(NotFoundError):
        await attachments.read_attachment(uuid.uuid4(), request, user, session, storage)
    page = SimpleNamespace(space_id=uuid.uuid4())
    session.get = AsyncMock(side_effect=[attachment, page, None])
    with pytest.raises(NotFoundError):
        await attachments.read_attachment(uuid.uuid4(), request, user, session, storage)

    attachment = SimpleNamespace(
        page_id=uuid.uuid4(),
        content_type="text/plain",
        filename='a\\"\n.txt',
        object_key="k",
        size_bytes=4,
    )
    page = SimpleNamespace(space_id=uuid.uuid4())
    space = SimpleNamespace(id=page.space_id)
    session.get = AsyncMock(side_effect=[attachment, page, space])

    class _SpaceService:
        def __init__(self, _session):
            self.permissions = SimpleNamespace(require=AsyncMock())

    class _PageService:
        def __init__(self, _session):
            pass

        require_page_view = AsyncMock()

    monkeypatch.setattr(attachments, "SpaceService", _SpaceService)
    monkeypatch.setattr(attachments, "PageService", _PageService)
    response = await attachments.read_attachment(uuid.uuid4(), request, user, session, storage)
    assert response.status_code == 200
    assert "attachment" in response.headers["content-disposition"]
    assert response.headers["accept-ranges"] == "bytes"


@pytest.mark.asyncio
async def test_attachment_endpoint_serves_a_requested_byte_range(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Media players scrub by asking for ranges; they must get 206 back."""
    user = _user()
    attachment = SimpleNamespace(
        page_id=uuid.uuid4(),
        content_type="video/mp4",
        filename="clip.mp4",
        object_key="k",
        size_bytes=1000,
    )
    page = SimpleNamespace(space_id=uuid.uuid4())
    space = SimpleNamespace(id=page.space_id)

    async def _chunks():
        yield b"partial"

    session = Mock(get=AsyncMock(side_effect=[attachment, page, space]))
    storage = Mock(get_range=AsyncMock(return_value=(1000, _chunks())))
    monkeypatch.setattr(
        attachments,
        "SpaceService",
        lambda _session: SimpleNamespace(permissions=SimpleNamespace(require=AsyncMock())),
    )
    monkeypatch.setattr(
        attachments,
        "PageService",
        lambda _session: SimpleNamespace(require_page_view=AsyncMock()),
    )

    response = await attachments.read_attachment(
        uuid.uuid4(), _request("bytes=100-199"), user, session, storage
    )

    assert response.status_code == 206
    assert response.headers["content-range"] == "bytes 100-199/1000"
    assert response.headers["content-length"] == "100"
    storage.get_range.assert_awaited_once_with("k", 100, 199)


@pytest.mark.asyncio
async def test_attachment_endpoint_rejects_a_range_past_the_end(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = _user()
    attachment = SimpleNamespace(
        page_id=uuid.uuid4(),
        content_type="video/mp4",
        filename="clip.mp4",
        object_key="k",
        size_bytes=1000,
    )
    page = SimpleNamespace(space_id=uuid.uuid4())
    space = SimpleNamespace(id=page.space_id)
    session = Mock(get=AsyncMock(side_effect=[attachment, page, space]))
    storage = Mock(
        get_stream=AsyncMock(return_value=(1000, _body(b"data"))), get_range=AsyncMock()
    )
    monkeypatch.setattr(
        attachments,
        "SpaceService",
        lambda _session: SimpleNamespace(permissions=SimpleNamespace(require=AsyncMock())),
    )
    monkeypatch.setattr(
        attachments,
        "PageService",
        lambda _session: SimpleNamespace(require_page_view=AsyncMock()),
    )

    response = await attachments.read_attachment(
        uuid.uuid4(), _request("bytes=4000-"), user, session, storage
    )

    assert response.status_code == 416
    assert response.headers["content-range"] == "bytes */1000"
    storage.get_range.assert_not_awaited()


@pytest.mark.asyncio
async def test_editor_attachment_upload_validates_and_stores_file(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = _user()
    page = SimpleNamespace(id=uuid.uuid4())
    session = Mock(add=Mock(), flush=AsyncMock())
    storage = Mock(put=AsyncMock())

    class _SpaceService:
        def __init__(self, _session):
            pass

        get_by_key = AsyncMock(return_value=SimpleNamespace(max_upload_size_mb=None))

    class _PageService:
        def __init__(self, _session):
            pass

        get_by_slug = AsyncMock(return_value=page)
        require_page_editor = AsyncMock()

    class _SettingsService:
        def __init__(self, _session):
            pass

        get_effective = AsyncMock(
            return_value=SimpleNamespace(
                allowed_attachment_types=["png", "pdf"],
                max_upload_size_bytes=10,
                max_upload_size_mb=1,
            )
        )

    monkeypatch.setattr(attachments, "SpaceService", _SpaceService)
    monkeypatch.setattr(attachments, "PageService", _PageService)
    monkeypatch.setattr(attachments, "SiteSettingsService", _SettingsService)
    image = UploadFile(
        filename="diagram.png",
        file=io.BytesIO(b"image"),
        headers=Headers({"content-type": "image/png"}),
    )
    uploaded = await attachments.upload_attachment("ENG", "guide", image, user, session, storage)
    assert uploaded.filename == "diagram.png"
    assert uploaded.content_url.endswith(f"/{uploaded.id}/content")
    storage.put.assert_awaited_once()

    disallowed = UploadFile(
        filename="unsafe.svg",
        file=io.BytesIO(b"<svg/ >"),
        headers=Headers({"content-type": "image/svg+xml"}),
    )
    with pytest.raises(UnsupportedMediaTypeError):
        await attachments.upload_attachment("ENG", "guide", disallowed, user, session, storage)


@pytest.mark.asyncio
async def test_simple_read_endpoints_and_backup_validation() -> None:
    service = Mock(search=AsyncMock(return_value=Page.of([], 0, limit=10, offset=0)))
    assert (await audit_logs.list_audit_logs(_user(), service, limit=10, offset=0)).total == 0
    assert await audit_logs.list_actions(_user())
    assert audit_logs.get_audit_query_service(Mock())

    search_service = Mock(
        search=AsyncMock(return_value=SimpleNamespace(query="wiki", pages=[], spaces=[]))
    )
    result = await search.search(_user(), search_service, q="wiki", limit=5)
    assert result.query == "wiki"
    assert search.get_search_service(Mock())
    assert attachments.get_storage()
    assert site_settings.get_site_settings_service(Mock())
    assert site_settings.get_acting_site_settings_service(Mock(), _user(), None, None)
    settings_service = Mock(
        read_sidebar_permissions=AsyncMock(return_value=SimpleNamespace(permissions={})),
        read=AsyncMock(return_value="read"),
        update=AsyncMock(return_value="updated"),
    )
    assert await site_settings.read_sidebar_permissions(_user(), settings_service)
    assert await site_settings.read_settings(_user(), settings_service) == "read"
    assert (
        await site_settings.update_settings(SimpleNamespace(), settings_service, _user())
        == "updated"
    )

    document = BackupDocument(
        wikihub_backup=BackupMeta(
            version=1,
            exported_at=datetime.now(UTC),
            app_version="x",
            site_name="WikiHub",
            includes_credentials=False,
        ),
    )
    backup_service = Mock(
        export_document=AsyncMock(return_value=document),
        import_document=AsyncMock(
            return_value=ImportReport(dry_run=True, version=1, includes_credentials=False)
        ),
    )
    assert backup.get_backup_service(Mock(), _user(), None, None)
    response = await backup.export_backup(backup_service, include_credentials=False)
    assert response.media_type == "application/json"
    assert "wikihub-backup-" in response.headers["content-disposition"]

    good_file = UploadFile(
        filename="backup.json", file=io.BytesIO(document.model_dump_json().encode())
    )
    report = await backup.import_backup(backup_service, good_file, True)
    assert report.dry_run is True
    with pytest.raises(BadRequestError):
        await backup.import_backup(
            backup_service, UploadFile(filename="x.json", file=io.BytesIO(b"nope")), True
        )
    with pytest.raises(BadRequestError):
        await backup.import_backup(
            backup_service, UploadFile(filename="x.json", file=io.BytesIO(b"{}")), True
        )
    original_limit = backup.MAX_BACKUP_UPLOAD_BYTES
    backup.MAX_BACKUP_UPLOAD_BYTES = 1
    try:
        with pytest.raises(PayloadTooLargeError):
            await backup.import_backup(
                backup_service, UploadFile(filename="x.json", file=io.BytesIO(b"{}")), True
            )
    finally:
        backup.MAX_BACKUP_UPLOAD_BYTES = original_limit
    with pytest.raises(BadRequestError, match=r"Choose a \.json"):
        await backup.import_backup(
            backup_service, UploadFile(filename="backup.txt", file=io.BytesIO(b"{}")), True
        )


@pytest.mark.asyncio
async def test_user_administration_endpoint_wrappers(monkeypatch: pytest.MonkeyPatch) -> None:
    actor = _user()
    # `scalars` backs `_read_user`'s own group-name lookup, and `execute`
    # backs both `list_users`'s group-name batch query and `_read_user`'s
    # permission-override lookup - reset to `[]` below once the group-batch
    # assertion is done with it, so the single-user calls after it don't try
    # to unpack "engineering" as a `(permission, enabled)` override row.
    session = Mock(execute=AsyncMock(return_value=[]), scalars=AsyncMock(return_value=[]))

    class _Permissions:
        def __init__(self, _session):
            pass

        require_global = AsyncMock()
        global_permissions = AsyncMock(return_value=[])

    monkeypatch.setattr(users, "PermissionService", _Permissions)
    target = _user()
    service = Mock(
        search_users=AsyncMock(return_value=([], 0)),
        create_user=AsyncMock(return_value=target),
        update_user=AsyncMock(return_value=target),
        reset_password=AsyncMock(return_value=target),
        delete_user=AsyncMock(),
        update_own_profile=AsyncMock(return_value=target),
        change_password=AsyncMock(return_value=target),
    )
    assert (await users.list_users(actor, session, service, limit=50, offset=0)).total == 0
    service.search_users = AsyncMock(return_value=([target], 1))
    session.execute = AsyncMock(return_value=[(target.id, "engineering")])
    page = await users.list_users(actor, session, service, limit=50, offset=0)
    assert page.items[0].groups == ["engineering"]
    # `_read_user`'s override lookup calls `.all()` on the `execute()`
    # result, unlike `list_users`'s own group-batch query above (which just
    # iterates it directly) - a plain list stands in for a real `Result` for
    # that, but needs this much to also support `.all()`.
    empty_rows = Mock(all=Mock(return_value=[]))
    session.execute = AsyncMock(return_value=empty_rows)
    assert await users.create_user(
        UserCreate(username="newuser", email="new@example.com", password="password1"),
        actor,
        session,
        service,
    )
    assert await users.update_user(target.id, UserUpdate(full_name="New"), actor, session, service)
    assert await users.reset_user_password(
        target.id, PasswordReset(new_password="Password1!"), actor, session, service
    )
    assert await users.update_own_profile(SelfProfileUpdate(full_name="Alice"), actor, service)
    assert await users.change_own_password(
        PasswordChange(current_password="old", new_password="Password1!"), actor, service
    )
    await users.delete_user(target.id, actor, session, service)


def test_users_get_storage_returns_the_s3_backed_implementation() -> None:
    # The DI wiring itself - every real request builds its own instance via
    # `Depends(get_storage)` rather than sharing one, so this is the only
    # place that ever calls the factory directly.
    from app.services.storage import S3ObjectStorage

    assert isinstance(users.get_storage(), S3ObjectStorage)


@pytest.mark.asyncio
async def test_avatar_endpoints_validate_replace_and_remove_avatar() -> None:
    user = _user()
    user.avatar_object_key = "avatars/old.png"
    user.avatar_content_type = "image/png"
    session = Mock(flush=AsyncMock(), get=AsyncMock(return_value=user))
    storage = Mock(put=AsyncMock(), delete=AsyncMock(), get=AsyncMock(return_value=b"avatar"))
    request = Request(
        {
            "type": "http",
            "scheme": "http",
            "server": ("testserver", 80),
            "headers": [(b"host", b"testserver")],
            "method": "POST",
            "path": "/api/v1/users/me/avatar",
        }
    )

    upload = UploadFile(
        file=io.BytesIO(b"image bytes"),
        filename="avatar.png",
        headers=Headers({"content-type": "image/png"}),
    )
    uploaded = await users.upload_own_avatar(request, upload, user, session, storage)
    assert uploaded.avatar_url.endswith(f"/users/{user.id}/avatar")
    assert user.avatar_object_key and user.avatar_object_key.startswith(f"avatars/{user.id}/")
    storage.put.assert_awaited_once()
    storage.delete.assert_awaited_once_with("avatars/old.png")

    invalid = UploadFile(
        file=io.BytesIO(b"<svg />"),
        filename="avatar.svg",
        headers=Headers({"content-type": "image/svg+xml"}),
    )
    with pytest.raises(UnsupportedMediaTypeError):
        await users.upload_own_avatar(request, invalid, user, session, storage)

    oversized = UploadFile(
        file=io.BytesIO(b"x" * (users.MAX_AVATAR_BYTES + 1)),
        filename="large.png",
        headers=Headers({"content-type": "image/png"}),
    )
    with pytest.raises(PayloadTooLargeError):
        await users.upload_own_avatar(request, oversized, user, session, storage)

    empty = UploadFile(
        file=io.BytesIO(b""),
        filename="empty.png",
        headers=Headers({"content-type": "image/png"}),
    )
    with pytest.raises(BadRequestError, match="empty"):
        await users.upload_own_avatar(request, empty, user, session, storage)

    response = await users.read_avatar(user.id, user, session, storage)
    assert response.status_code == 200 and response.body == b"avatar"
    removed = await users.delete_own_avatar(user, session, storage)
    assert removed.avatar_url is None
    assert user.avatar_object_key is None and user.avatar_content_type is None

    # No avatar to serve any more (just removed above) - and a user id that
    # does not exist at all takes the same 404, not a 500.
    session.get = AsyncMock(return_value=user)
    assert (await users.read_avatar(user.id, user, session, storage)).status_code == 404
    session.get = AsyncMock(return_value=None)
    assert (await users.read_avatar(uuid.uuid4(), user, session, storage)).status_code == 404


@pytest.mark.asyncio
async def test_storage_and_dependency_edges(monkeypatch: pytest.MonkeyPatch) -> None:
    user = _user()
    now = datetime.now(UTC)
    storage = Mock(
        list_objects=AsyncMock(return_value=[StoredObject("a/b.txt", 2, "text/plain", "e", now)]),
        presigned_url=AsyncMock(return_value="https://download"),
        exists=AsyncMock(return_value=True),
        delete=AsyncMock(),
    )
    assert storage_admin.get_storage()
    objects = await storage_admin.list_storage_objects(user, storage, prefix="a/")
    assert objects[0].key == "a/b.txt"
    assert (
        await storage_admin.presign_download(user, storage, key="a/b.txt", inline=False)
    ).url == "/api/v1/storage/object?key=a%2Fb.txt&download_as=b.txt"

    session = Mock(
        scalar=AsyncMock(side_effect=[None, None, None]), flush=AsyncMock(), delete=AsyncMock()
    )
    deleted = await storage_admin.delete_storage_object(user, storage, session, key="a/b.txt")
    assert deleted.archive_cleared is False
    storage.exists = AsyncMock(return_value=False)
    with pytest.raises(NotFoundError):
        await storage_admin.delete_storage_object(user, storage, session, key="missing")
    storage.exists = AsyncMock(return_value=True)
    archive = SimpleNamespace(sha256="hash", status="uploaded")
    attachment = SimpleNamespace()
    session.scalar = AsyncMock(side_effect=[archive, None, attachment])
    session.flush = AsyncMock()
    deleted = await storage_admin.delete_storage_object(user, storage, session, key="a/b.txt")
    assert deleted.archive_cleared and deleted.attachment_deleted

    session_factory = Mock(return_value=AsyncMock(__aenter__=AsyncMock(return_value=AsyncMock())))
    monkeypatch.setattr(deps, "get_session_factory", Mock(return_value=session_factory))
    generator = deps.get_db()
    await generator.__anext__()
    with pytest.raises(StopAsyncIteration):
        await generator.asend(None)
    assert deps.get_auth_service(Mock())
    assert (
        await deps.get_impersonator(
            SimpleNamespace(headers={}, cookies={}), Mock(get_active_user=AsyncMock())
        )
        is None
    )
    token, _ = create_access_token(str(user.id), impersonator=str(user.id))
    request = SimpleNamespace(headers={"Authorization": f"Bearer {token}"}, cookies={})
    assert (
        await deps.get_impersonator(request, Mock(get_active_user=AsyncMock(return_value=user)))
        is user
    )
    plain_token, _ = create_access_token(str(user.id))
    assert (
        await deps.get_impersonator(
            SimpleNamespace(headers={"Authorization": f"Bearer {plain_token}"}, cookies={}), Mock()
        )
        is None
    )
    with pytest.raises(AuthenticationError):
        await deps.get_impersonator(
            request, Mock(get_active_user=AsyncMock(side_effect=AuthenticationError("gone")))
        )

    class _AdminPermission:
        def __init__(self, _session):
            pass

        is_system_admin = AsyncMock(return_value=True)

    monkeypatch.setattr(deps, "PermissionService", _AdminPermission)
    assert await deps.get_current_superuser(user, Mock()) is user
    assert deps.get_acting_auth_service(Mock(), user, None, None)
    monkeypatch.setattr(deps.SessionService, "require_active", AsyncMock())
    invalid = Mock(get_active_user=AsyncMock(side_effect=AuthenticationError("bad")))
    assert await deps.get_optional_user(request, invalid) is None
    assert await deps.get_optional_user(SimpleNamespace(headers={}, cookies={}), invalid) is None
    commit_session = AsyncMock()
    factory = Mock(return_value=AsyncMock(__aenter__=AsyncMock(return_value=commit_session)))
    monkeypatch.setattr(deps, "get_session_factory", Mock(return_value=factory))
    generator = deps.get_db()
    await generator.__anext__()
    with pytest.raises(StopAsyncIteration):
        await generator.asend(None)
    assert commit_session.commit.await_count == 1
    error_session = AsyncMock()
    context = AsyncMock(__aenter__=AsyncMock(return_value=error_session))
    monkeypatch.setattr(deps, "get_session_factory", Mock(return_value=Mock(return_value=context)))
    generator = deps.get_db()
    await generator.__anext__()
    with pytest.raises(RuntimeError):
        await generator.athrow(RuntimeError("boom"))
    error_session.rollback.assert_awaited_once()
    assert (await health.health()).status == "ok"


@pytest.mark.asyncio
async def test_group_endpoint_wrappers(monkeypatch: pytest.MonkeyPatch) -> None:
    actor = _user()
    group = SimpleNamespace(
        id=uuid.uuid4(),
        name="Engineering",
        description="Docs",
        owner_id=actor.id,
        is_active=True,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    owner = SimpleNamespace(username="alice")
    session = Mock(
        get=AsyncMock(return_value=owner),
        scalar=AsyncMock(return_value=2),
        scalars=AsyncMock(return_value=[GlobalPermission.manage_groups]),
        execute=AsyncMock(),
        add=Mock(),
    )
    assert (await groups.group_read(session, group)).member_count == 2
    assert groups.get_service(session)

    class _Service:
        require_global = AsyncMock()
        create_group = AsyncMock(return_value=group)
        get_group = AsyncMock(return_value=group)
        can_manage_group = AsyncMock(return_value=True)
        update_group = AsyncMock(return_value=group)
        delete_group = AsyncMock()
        set_group_member = AsyncMock()
        set_group_global_permission = AsyncMock()

    service = _Service()
    scalar_result = Mock(scalars=Mock(return_value=Mock(all=Mock(return_value=[group]))))
    session.execute.return_value = scalar_result
    assert await groups.list_groups(actor, session, service, q="eng")
    assert await groups.create_group(
        GroupCreate(name="Engineering", owner_id=actor.id), actor, service, session
    )
    assert await groups.get_group(group.id, actor, service, session)
    service.can_manage_group = AsyncMock(return_value=False)
    with pytest.raises(PermissionDeniedError):
        await groups.get_group(group.id, actor, service, session)
    service.can_manage_group = AsyncMock(return_value=False)
    with pytest.raises(PermissionDeniedError):
        await groups.list_group_members(group.id, actor, service, session)
    service.can_manage_group = AsyncMock(return_value=True)
    await groups.update_group(group.id, GroupUpdate(name="New"), actor, service, session)
    await groups.delete_group(group.id, actor, service)
    member = SimpleNamespace(id=uuid.uuid4(), username="bob", full_name="Bob", email="bob@example.com")
    session.execute.return_value = Mock(
        scalars=Mock(return_value=Mock(all=Mock(return_value=[member])))
    )
    assert (await groups.list_group_members(group.id, actor, service, session))[0].username == "bob"
    await groups.add_group_member(group.id, GroupMemberUpsert(user_id=member.id), actor, service)
    await groups.remove_group_member(group.id, member.id, actor, service)
    await groups.add_global_permission(group.id, GlobalPermission.manage_groups, actor, service)
    await groups.remove_global_permission(group.id, GlobalPermission.manage_groups, actor, service)


@pytest.mark.asyncio
async def test_space_permission_endpoint_wrappers(monkeypatch: pytest.MonkeyPatch) -> None:
    actor = _user()
    space = SimpleNamespace(id=uuid.uuid4(), key="ENG", visibility="open")
    target = _user()
    group = SimpleNamespace(id=uuid.uuid4(), name="Engineering", is_active=True)

    class _SpaceService:
        def __init__(self, _session):
            pass

        get_by_key = AsyncMock(return_value=space)
        require_admin = AsyncMock()

    class _PermissionService:
        def __init__(self, _session):
            pass

        effective_permissions = AsyncMock(return_value={Permission.view})
        set_space_permission = AsyncMock()

    monkeypatch.setattr(spaces, "SpaceService", _SpaceService)
    monkeypatch.setattr(spaces, "PermissionService", _PermissionService)
    monkeypatch.setattr(spaces, "group_read", AsyncMock(return_value=group))
    session = Mock()
    direct_row = SimpleNamespace(permission=Permission.view)
    group_row = SimpleNamespace(permission=Permission.add)
    direct_principal = SimpleNamespace(id=uuid.uuid4(), username="alice")
    group_principal = SimpleNamespace(id=uuid.uuid4(), name="eng")
    session.execute = AsyncMock(
        side_effect=[
            Mock(all=Mock(return_value=[(direct_row, direct_principal)])),
            Mock(all=Mock(return_value=[(group_row, group_principal)])),
            Mock(scalars=Mock(return_value=Mock(all=Mock(return_value=[target])))),
            Mock(scalars=Mock(return_value=Mock(all=Mock(return_value=[group])))),
        ]
    )
    assert len(await spaces.list_permissions("ENG", actor, session)) == 2
    assert await spaces.list_permission_users("ENG", actor, session)
    assert await spaces.list_permission_groups("ENG", actor, session)
    session.get = AsyncMock(return_value=target)
    effective = await spaces.effective_permissions("ENG", target.id, actor, session)
    assert effective.permissions == [Permission.view]
    session.get = AsyncMock(return_value=None)
    with pytest.raises(NotFoundError):
        await spaces.effective_permissions("ENG", target.id, actor, session)
    await spaces.grant_user_permission("ENG", target.id, Permission.view, actor, session)
    await spaces.revoke_user_permission("ENG", target.id, Permission.view, actor, session)
    await spaces.grant_group_permission("ENG", group.id, Permission.add, actor, session)
    await spaces.revoke_group_permission("ENG", group.id, Permission.add, actor, session)
    assert spaces.get_space_service(session)


@pytest.mark.asyncio
async def test_confluence_import_endpoint_guards(monkeypatch: pytest.MonkeyPatch) -> None:
    actor = _user()
    archive = SimpleNamespace(
        id=uuid.uuid4(),
        filename="a.zip",
        size_bytes=10,
        sha256=None,
        status="scanned",
        error=None,
        spaces=[{"key": "ENG", "name": "Engineering", "page_count": 1, "attachment_count": 0}],
        object_key="imports/a.zip",
    )
    now = datetime.now(UTC)
    job = SimpleNamespace(
        id=uuid.uuid4(),
        archive_id=archive.id,
        import_all=False,
        space_keys=["ENG"],
        overwrite_existing=False,
        status="queued",
        phase="queued",
        counters={},
        cancel_requested=False,
        heartbeat_at=None,
        error=None,
        created_at=now,
        updated_at=now,
    )
    assert confluence_import.archive_read(archive).filename == "a.zip"
    assert confluence_import.job_read(job).id == job.id
    importer = Mock(
        session=Mock(),
        upload_part_size_bytes=8,
        start_upload=AsyncMock(return_value=archive),
        get_archive=AsyncMock(return_value=archive),
        uploaded_part_numbers=AsyncMock(return_value=[1]),
        upload_part_urls=AsyncMock(return_value={1: "url"}),
        complete_upload=AsyncMock(return_value=archive),
        abort_upload=AsyncMock(),
        create_job=AsyncMock(return_value=job),
    )
    monkeypatch.setattr(confluence_import, "get_storage", Mock(return_value=Mock()))
    assert confluence_import.service(Mock())
    monkeypatch.setattr(
        confluence_import,
        "SiteSettingsService",
        lambda _session: SimpleNamespace(
            get_effective=AsyncMock(return_value=SimpleNamespace(max_backup_import_size_bytes=100))
        ),
    )
    target = await confluence_import.start_upload(
        UploadInit(filename="a.zip", size_bytes=10), actor, importer
    )
    assert target.archive_id == archive.id
    assert await confluence_import.get_upload_progress(archive.id, actor, importer)
    assert await confluence_import.get_upload_part_urls(
        archive.id, UploadPartUrlsRequest(part_numbers=[1]), actor, importer
    )
    monkeypatch.setattr(
        confluence_import, "create_pool", AsyncMock(side_effect=RuntimeError("redis"))
    )
    with pytest.raises(ServiceUnavailableError):
        await confluence_import.enqueue(uuid.uuid4())
    pool = SimpleNamespace(enqueue_job=AsyncMock(), aclose=AsyncMock())
    monkeypatch.setattr(confluence_import, "create_pool", AsyncMock(return_value=pool))
    await confluence_import.enqueue(uuid.uuid4())

    session = Mock(get=AsyncMock(), add=Mock(), flush=AsyncMock(), refresh=AsyncMock())
    session.get.return_value = None
    with pytest.raises(NotFoundError):
        await confluence_import.get_job(uuid.uuid4(), actor, session)
    session.get = AsyncMock(return_value=job)
    assert (await confluence_import.get_job(job.id, actor, session)).id == job.id
    session.get = AsyncMock(return_value=None)
    with pytest.raises(NotFoundError):
        await confluence_import.cancel(uuid.uuid4(), actor, session)
    session.get = AsyncMock(return_value=SimpleNamespace(status="completed"))
    with pytest.raises(ConflictError):
        await confluence_import.cancel(uuid.uuid4(), actor, session)
    queued = SimpleNamespace(**job.__dict__)
    session.get = AsyncMock(return_value=queued)
    assert (await confluence_import.cancel(queued.id, actor, session)).status == "cancelled"
    running = SimpleNamespace(**job.__dict__)
    running.status = "running"
    # A beating heartbeat: a live worker is left to observe `cancel_requested`
    # and stop itself. Without one this row would read as abandoned and be
    # finalised here instead - see the reaper tests in tests/integration.
    running.heartbeat_at = datetime.now(UTC)
    session.get = AsyncMock(return_value=running)
    assert (await confluence_import.cancel(running.id, actor, session)).status == "running"
    session.get = AsyncMock(return_value=None)
    with pytest.raises(NotFoundError):
        await confluence_import.retry(uuid.uuid4(), actor, session)
    session.get = AsyncMock(
        return_value=SimpleNamespace(
            status="queued", archive_id=archive.id, import_all=False, space_keys=[], counters={}
        )
    )
    with pytest.raises(ConflictError):
        await confluence_import.retry(uuid.uuid4(), actor, session)
