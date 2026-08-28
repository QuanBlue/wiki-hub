from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.api.v1 import confluence_import as imports_api
from app.api.v1 import pages as pages_api
from app.api.v1 import spaces as spaces_api
from app.models.permission import Permission
from app.models.restriction import PageRestrictionPermission
from app.modules.import_export.service import STALE_IMPORT_AFTER
from app.modules.pages.export_service import ExportResult


def _services():
    user = SimpleNamespace(id=uuid.uuid4(), username="user")
    space = SimpleNamespace(id=uuid.uuid4(), key="ENG", visibility="open")
    page = SimpleNamespace(id=uuid.uuid4(), slug="home", title="Home")
    page_service = Mock()
    page_service.list_for_space = AsyncMock(return_value=[])
    page_service.create = AsyncMock(return_value=page)
    page_service.move = AsyncMock(return_value=page)
    page_service.get_by_slug = AsyncMock(return_value=page)
    page_service.to_read_for_user = AsyncMock(return_value=SimpleNamespace(id=page.id))
    page_service.require_page_view = AsyncMock()
    page_service.like_status = AsyncMock(return_value=SimpleNamespace(liked=False))
    page_service.set_like = AsyncMock(return_value=SimpleNamespace(liked=True))
    page_service.update = AsyncMock(return_value=page)
    page_service.delete = AsyncMock()
    page_service.list_recent_pages = AsyncMock(return_value=[])

    permissions = Mock()
    permissions.require = AsyncMock()
    permissions.list_page_restrictions = AsyncMock(return_value=[])
    permissions.require_page_restriction_admin = AsyncMock()
    permissions.set_page_restriction = AsyncMock()
    space_service = Mock()
    space_service.get_by_key = AsyncMock(return_value=space)
    space_service.require_view = AsyncMock()
    space_service.permissions = permissions
    return user, space, page, page_service, space_service


@pytest.mark.asyncio
async def test_page_route_wrappers_delegate_to_services(monkeypatch: pytest.MonkeyPatch) -> None:
    user, space, page, page_service, space_service = _services()
    assert pages_api.get_page_service(Mock()).__class__ is not None
    assert pages_api.get_space_service(Mock()).__class__ is not None
    assert pages_api.get_export_service().__class__ is not None

    assert await pages_api.list_pages("ENG", user, page_service, space_service) == []
    assert (
        await pages_api.create_page("ENG", None, user, page_service, space_service)
    ).id == page.id
    assert (
        await pages_api.move_page("ENG", "home", None, user, page_service, space_service)
    ).id == page.id
    assert (
        await pages_api.get_page("ENG", "home", user, page_service, space_service)
    ).id == page.id
    assert (
        await pages_api.get_page_like("ENG", "home", user, page_service, space_service)
    ).liked is False
    assert (
        await pages_api.like_page("ENG", "home", user, page_service, space_service)
    ).liked is True
    assert (
        await pages_api.unlike_page("ENG", "home", user, page_service, space_service)
    ).liked is True
    assert (
        await pages_api.update_page("ENG", "home", None, user, page_service, space_service)
    ).id == page.id
    assert await pages_api.delete_page("ENG", "home", user, page_service, space_service) is None

    export_service = Mock()
    export_service.export = AsyncMock(
        return_value=ExportResult(content=b"pdf", media_type="application/pdf", filename="home.pdf")
    )
    fake_session = Mock()
    response = await pages_api.export_page(
        "ENG",
        "home",
        pages_api.ExportFormat.pdf,
        user,
        page_service,
        space_service,
        export_service,
        fake_session,
    )
    assert response.media_type == "application/pdf"
    export_service.export.assert_awaited_once_with(
        page=page, space=space, user=user, fmt=pages_api.ExportFormat.pdf, session=fake_session
    )

    assert (
        await pages_api.list_page_restrictions("ENG", "home", user, page_service, space_service)
        == []
    )
    session = Mock()
    result = Mock()
    result.scalars.return_value.all.return_value = []
    session.execute = AsyncMock(return_value=result)
    assert (
        await pages_api.list_page_restriction_users(
            "ENG", "home", user, page_service, space_service, session
        )
        == []
    )
    assert (
        await pages_api.list_page_restriction_groups(
            "ENG", "home", user, page_service, space_service, session
        )
        == []
    )

    principal_id = uuid.uuid4()
    await pages_api.grant_user_page_restriction(
        "ENG",
        "home",
        principal_id,
        PageRestrictionPermission.view,
        user,
        page_service,
        space_service,
    )
    await pages_api.revoke_user_page_restriction(
        "ENG",
        "home",
        principal_id,
        PageRestrictionPermission.view,
        user,
        page_service,
        space_service,
    )
    await pages_api.grant_group_page_restriction(
        "ENG",
        "home",
        principal_id,
        PageRestrictionPermission.edit,
        user,
        page_service,
        space_service,
    )
    await pages_api.revoke_group_page_restriction(
        "ENG",
        "home",
        principal_id,
        PageRestrictionPermission.edit,
        user,
        page_service,
        space_service,
    )
    assert await pages_api.list_recent_pages_global(user, page_service) == []


@pytest.mark.asyncio
async def test_space_route_wrappers_delegate_to_services(monkeypatch: pytest.MonkeyPatch) -> None:
    user, space, _page, _page_service, service = _services()
    service.list_spaces = AsyncMock(return_value=[])
    service.list_recent = AsyncMock(return_value=[])
    service.list_favorites = AsyncMock(return_value=[])
    service.list_top_visited = AsyncMock(return_value=[])
    service.record_visit = AsyncMock()
    service.to_read = AsyncMock(return_value=SimpleNamespace(key=space.key))
    service.create = AsyncMock(return_value=space)
    service.update = AsyncMock(return_value=space)
    service.archive = AsyncMock(return_value=space)
    service.unarchive = AsyncMock(return_value=space)
    service.delete = AsyncMock()
    service.set_favorite = AsyncMock()
    service.list_members = AsyncMock(return_value=[])
    service.set_member = AsyncMock(return_value=SimpleNamespace(user_id=user.id))
    service.remove_member = AsyncMock()

    assert await spaces_api.list_spaces(user, service) == []
    assert await spaces_api.list_recent(user, service) == []
    assert await spaces_api.list_favorites(user, service) == []
    assert await spaces_api.list_top_visited(user, service) == []
    user.is_superuser = True
    await spaces_api.create_space(None, user, service)
    assert (await spaces_api.get_space("ENG", user, service)).key == "ENG"
    service.record_visit.assert_awaited_once_with(space, user)
    assert (await spaces_api.update_space("ENG", None, user, service)).key == "ENG"
    assert (await spaces_api.archive_space("ENG", user, service)).key == "ENG"
    assert (await spaces_api.unarchive_space("ENG", user, service)).key == "ENG"
    await spaces_api.delete_space("ENG", user, service)
    await spaces_api.add_favorite("ENG", user, service)
    await spaces_api.remove_favorite("ENG", user, service)
    assert await spaces_api.list_members("ENG", user, service) == []
    await spaces_api.upsert_member(
        "ENG", SimpleNamespace(user_id=user.id, role="viewer"), user, service
    )
    await spaces_api.remove_member("ENG", user.id, user, service)

    service.require_admin = AsyncMock()
    service.permissions.effective_permissions = AsyncMock(return_value={Permission.view})
    service.permissions.set_space_permission = AsyncMock()
    monkeypatch.setattr(spaces_api, "SpaceService", lambda _session: service)
    monkeypatch.setattr(spaces_api, "PermissionService", lambda _session: service.permissions)
    session = Mock()
    session.execute = AsyncMock(
        return_value=Mock(
            all=Mock(return_value=[]), scalars=Mock(return_value=Mock(all=Mock(return_value=[])))
        )
    )
    session.get = AsyncMock(return_value=user)
    await spaces_api.effective_permissions("ENG", user.id, user, session)
    await spaces_api.grant_user_permission("ENG", user.id, Permission.view, user, session)
    await spaces_api.revoke_user_permission("ENG", user.id, Permission.view, user, session)
    await spaces_api.grant_group_permission("ENG", user.id, Permission.view, user, session)
    await spaces_api.revoke_group_permission("ENG", user.id, Permission.view, user, session)


@pytest.mark.asyncio
async def test_confluence_import_route_wrappers(monkeypatch: pytest.MonkeyPatch) -> None:
    from datetime import UTC, datetime

    user = SimpleNamespace(id=uuid.uuid4())
    archive = SimpleNamespace(
        id=uuid.uuid4(),
        object_key="imports/a.zip",
        filename="a.zip",
        size_bytes=10,
        sha256="a" * 64,
        status="scanned",
        error=None,
        spaces=[{"key": "ENG", "name": "Eng", "page_count": 1, "attachment_count": 0}],
        multipart_upload_id="upload",
        created_by_id=user.id,
    )
    job = SimpleNamespace(
        id=uuid.uuid4(),
        archive_id=archive.id,
        import_all=True,
        space_keys=[],
        overwrite_existing=False,
        status="queued",
        phase="queued",
        counters={},
        cancel_requested=False,
        error=None,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    assert imports_api.archive_read(archive).filename == "a.zip"
    assert imports_api.job_read(job).archive_id == archive.id
    importer = Mock()
    importer.session = Mock()
    importer.upload_part_size_bytes = 8
    importer.start_upload = AsyncMock(return_value=archive)
    importer.get_archive = AsyncMock(return_value=archive)
    importer.uploaded_part_numbers = AsyncMock(return_value=[1])
    importer.upload_part_urls = AsyncMock(return_value={1: "url"})
    importer.complete_upload = AsyncMock(return_value=archive)
    importer.abort_upload = AsyncMock()
    importer.scan = AsyncMock(return_value=archive)
    importer.create_job = AsyncMock(return_value=job)

    monkeypatch.setattr(
        imports_api.SiteSettingsService,
        "get_effective",
        AsyncMock(return_value=SimpleNamespace(max_backup_import_size_bytes=100)),
    )
    target = await imports_api.start_upload(
        SimpleNamespace(filename="a.zip", size_bytes=10, sha256=None), user, importer
    )
    assert target.archive_id == archive.id

    empty_result = Mock()
    empty_result.scalars.return_value = Mock()
    empty_result.scalars.return_value.all.return_value = []
    session = Mock()
    session.execute = AsyncMock(return_value=empty_result)
    assert await imports_api.list_active_uploads(user, session, importer) == []
    progress = await imports_api.get_upload_progress(archive.id, user, importer)
    assert progress.uploaded_parts == [1]
    assert (
        await imports_api.get_upload_part_urls(
            archive.id, SimpleNamespace(part_numbers=[1]), user, importer
        )
    ).urls == {1: "url"}
    
    # Test uploading status direct urls
    archive.status = "uploading"
    res = await imports_api.get_upload_part_urls(
        archive.id, SimpleNamespace(part_numbers=[1]), user, importer
    )
    assert res.urls == {1: "/api/v1/storage/object?key=imports%2Fa.zip&upload_id=upload&part_number=1"}
    archive.status = "scanned"
    
    with pytest.raises(imports_api.NotFoundError):
        await imports_api.get_upload_part_urls(
            archive.id, SimpleNamespace(part_numbers=[3]), user, importer
        )
    assert (await imports_api.complete_upload(archive.id, user, importer)).filename == "a.zip"
    await imports_api.cancel_upload(archive.id, user, importer)
    assert (await imports_api.scan_archive(archive.id, user, importer)).filename == "a.zip"
    assert (await imports_api.get_archive(archive.id, user, importer)).filename == "a.zip"

    monkeypatch.setattr(imports_api, "enqueue", AsyncMock())
    monkeypatch.setattr(imports_api, "job_read", lambda item: item)
    # Cross-flow guard is covered by its own tests; stub it so this wrapper
    # test does not trip over the AsyncMock session it hands the importer.
    monkeypatch.setattr(imports_api, "assert_no_active_wikihub_restore", AsyncMock())
    assert (
        await imports_api.create_job(
            archive.id,
            SimpleNamespace(import_all=True, space_keys=[], overwrite_existing=False),
            user,
            importer,
        )
        is job
    )

    class ScalarItems(list):
        def all(self):
            return self

    empty_result.scalars.return_value = ScalarItems()
    assert await imports_api.list_jobs(user, session) == []
    session.get = AsyncMock(return_value=None)
    with pytest.raises(imports_api.NotFoundError):
        await imports_api.get_job(job.id, user, session)
    assert (await imports_api.get_logs(job.id, user, session, offset=0, limit=100)).items == []

    cancel_item = SimpleNamespace(
        id=job.id,
        status="queued",
        phase="queued",
        heartbeat_at=None,
        cancel_requested=False,
        archive_id=archive.id,
        import_all=True,
        space_keys=[],
        overwrite_existing=False,
        counters={},
        error=None,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    session.get = AsyncMock(return_value=cancel_item)
    session.flush = AsyncMock()
    session.refresh = AsyncMock()
    assert (await imports_api.cancel(job.id, user, session)).status == "cancelled"

    retry_item = SimpleNamespace(
        id=job.id,
        status="failed",
        archive_id=archive.id,
        import_all=True,
        space_keys=[],
        counters={},
    )
    session.get = AsyncMock(return_value=retry_item)
    assert await imports_api.retry(job.id, user, session) is not None


def _running_import(**overrides) -> SimpleNamespace:
    defaults = {
        "id": uuid.uuid4(),
        "status": "running",
        "phase": "downloading",
        "heartbeat_at": datetime.now(UTC),
        "cancel_requested": False,
        "archive_id": uuid.uuid4(),
        "import_all": True,
        "space_keys": [],
        "overwrite_existing": False,
        "counters": {},
        "error": None,
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
    }
    return SimpleNamespace(**{**defaults, **overrides})


@pytest.mark.asyncio
async def test_cancel_import_finalises_when_the_worker_is_gone():
    """Cancel must not defer to a worker that no longer exists.

    Cancelling a *running* import works by setting `cancel_requested` for the
    worker loop to observe. When that worker died - a crash, a container
    restart, a deploy - the row stayed "running" forever: the progress bar
    never moved again and Cancel only wrote "the current import step will stop
    shortly" about a step that was not running at all.
    """
    session = AsyncMock()
    item = _running_import(heartbeat_at=datetime.now(UTC) - STALE_IMPORT_AFTER * 2)
    session.get = AsyncMock(return_value=item)

    result = await imports_api.cancel(item.id, Mock(), session)

    assert (result.status, result.phase) == ("cancelled", "cancelled")
    assert item.cancel_requested is True
    logged = [c.args[0] for c in session.add.call_args_list]
    assert any("no longer running" in entry.message for entry in logged)


@pytest.mark.asyncio
async def test_cancel_import_leaves_a_live_worker_to_stop_itself():
    """The other half: a beating heartbeat means someone is still working.

    Finalising here would race the worker - it would go on downloading against
    a row already marked cancelled, and its own closing write would land on
    top. The flag is enough; it observes it at the next progress tick.
    """
    session = AsyncMock()
    item = _running_import(heartbeat_at=datetime.now(UTC))
    session.get = AsyncMock(return_value=item)

    result = await imports_api.cancel(item.id, Mock(), session)

    assert (result.status, result.phase) == ("running", "downloading")
    assert item.cancel_requested is True
    logged = [c.args[0] for c in session.add.call_args_list]
    assert any("stop shortly" in entry.message for entry in logged)
