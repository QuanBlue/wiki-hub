from __future__ import annotations

import contextlib
import io
import uuid
import zipfile
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.core.exceptions import BadRequestError, ConflictError, NotFoundError, PayloadTooLargeError
from app.models.import_job import ImportArchive
from app.models.permission import Group, GroupMember, Permission, SpaceGroupPermission
from app.models.restriction import PageGroupRestriction, PageRestrictionPermission, PageUserRestriction
from app.models.space import Space, SpaceVisibility
from app.modules.import_export import service as import_module
from app.modules.import_export.confluence import (
    ConfluenceAttachment,
    ConfluenceGroup,
    ConfluencePage,
    ConfluencePageRestriction,
    ConfluencePermission,
    ConfluenceSpace,
    ConfluenceSpaceList,
)
from app.modules.import_export.service import (
    ConfluenceImportService,
    ImportCancelled,
    SeekableS3File,
    _link_imported_attachments,
    _normalize_confluence_code_macros,
    _slug,
)


class _ScalarResult:
    def __init__(self, values):
        self.values = values

    def scalars(self):
        return self

    def first(self):
        return self.values[0] if self.values else None

    def __iter__(self):
        return iter(self.values)


class _EntityResult:
    """Minimal stand-in for a SQLAlchemy Result, wrapping a single scalar value."""

    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def scalars(self):
        return self

    def first(self):
        return self._value

    def __iter__(self):
        return iter([self._value] if self._value is not None else [])


def _entity_dispatch_execute(queues: dict[type, list]):
    """Build a session.execute side_effect that resolves results by queried model.

    Each entry in ``queues`` maps an ORM model class to an ordered list of
    canned return values (``None`` meaning "not found"). Successive queries
    against that model pop the next queued value; once a model's queue is
    exhausted (or it has none registered) queries return ``None``.
    """

    async def _execute(stmt):
        entity = None
        with contextlib.suppress(Exception):
            entity = stmt.column_descriptions[0]["entity"]
        queue = queues.get(entity)
        value = queue.pop(0) if queue else None
        return _EntityResult(value)

    return _execute


@pytest.mark.asyncio
async def test_resolve_users_reuses_cache_and_creates_missing_user() -> None:
    session = Mock()
    session.execute = AsyncMock(side_effect=[_ScalarResult([]), _ScalarResult([])])
    session.flush = AsyncMock()
    added = []
    session.add.side_effect = added.append

    async def assign_id() -> None:
        if added and getattr(added[-1], "id", None) is None:
            added[-1].id = uuid.uuid4()

    session.flush.side_effect = assign_id
    service = ConfluenceImportService(session, Mock())
    assert await service._resolve_or_create_user("  Alice ") is not None
    assert await service._resolve_or_create_user("Alice") == added[0].id
    assert await service._resolve_or_create_user("0123456789abcdef0123456789abcdef") is None

    existing = SimpleNamespace(id=uuid.uuid4())
    session.execute = AsyncMock(return_value=_ScalarResult([existing]))
    service = ConfluenceImportService(session, Mock())
    assert await service._resolve_or_create_user("Existing") == existing.id


@pytest.mark.asyncio
async def test_upload_lifecycle_and_archive_conflicts(monkeypatch: pytest.MonkeyPatch) -> None:
    session = Mock()
    session.execute = AsyncMock()
    session.flush = AsyncMock()
    storage = Mock()
    storage.exists = AsyncMock(return_value=False)
    storage.start_multipart_upload = AsyncMock(return_value="upload-1")
    storage.list_multipart_parts = AsyncMock(return_value=[(1, "etag")])
    storage.presigned_upload_part_url = AsyncMock(return_value="part-url")
    storage.complete_multipart_upload = AsyncMock()
    storage.abort_multipart_upload = AsyncMock()
    service = ConfluenceImportService(session, storage)

    with pytest.raises(BadRequestError):
        await service.start_upload(filename="archive.tar", size_bytes=1, actor_id=uuid.uuid4())

    monkeypatch.setattr(
        "app.services.site_settings.SiteSettingsService.get_effective",
        AsyncMock(return_value=SimpleNamespace(max_backup_import_size_bytes=10)),
    )
    with pytest.raises(PayloadTooLargeError):
        await service.start_upload(filename="archive.zip", size_bytes=11, actor_id=uuid.uuid4())

    archive = await service.start_upload(
        filename="archive.zip", size_bytes=1, actor_id=uuid.uuid4()
    )
    archive.status = "uploading"
    assert archive.status == "uploading"
    assert archive.multipart_upload_id == "upload-1"

    archive.spaces = [{"key": "ENG"}]
    session.execute.return_value = _ScalarResult([])
    session.get = AsyncMock(return_value=archive)
    assert await service.get_archive(archive.id) is archive
    archive.multipart_upload_id = None
    assert await service.uploaded_part_numbers(archive) == []
    archive.multipart_upload_id = "upload-1"
    assert await service.uploaded_part_numbers(archive) == [1]
    archive.status = "uploading"
    assert await service.upload_part_urls(archive, [1]) == {1: "part-url"}

    archive.size_bytes = service.upload_part_size_bytes
    await service.complete_upload(archive)
    assert archive.status == "uploaded"
    assert archive.multipart_upload_id is None

    archive.status = "uploading"
    archive.multipart_upload_id = "upload-2"
    storage.abort_multipart_upload.side_effect = NotFoundError("gone")
    await service.abort_upload(archive)
    assert archive.status == "cancelled"


@pytest.mark.asyncio
async def test_upload_reuse_and_job_validation() -> None:
    session = Mock()
    session.execute = AsyncMock(return_value=_ScalarResult([]))
    session.flush = AsyncMock()
    session.commit = AsyncMock()
    storage = Mock()
    storage.exists = AsyncMock(return_value=True)
    service = ConfluenceImportService(session, storage)
    archive = SimpleNamespace(
        object_key="key", status="uploaded", sha256="hash", size_bytes=3, multipart_upload_id=None
    )
    session.execute.return_value = _ScalarResult([archive])
    assert await service.find_reusable_archive(sha256="hash", size_bytes=3) is archive

    scanned = ImportArchive(
        object_key="key",
        filename="archive.zip",
        size_bytes=10,
        status="scanned",
        spaces=[{"key": "ENG", "page_count": 2}],
        created_by_id=uuid.uuid4(),
    )
    with pytest.raises(BadRequestError):
        await service.create_job(
            scanned,
            import_all=False,
            space_keys=[],
            overwrite_existing=False,
            actor_id=uuid.uuid4(),
        )
    with pytest.raises(BadRequestError):
        await service.create_job(
            scanned,
            import_all=False,
            space_keys=["NOPE"],
            overwrite_existing=False,
            actor_id=uuid.uuid4(),
        )
    job = await service.create_job(
        scanned, import_all=True, space_keys=[], overwrite_existing=True, actor_id=uuid.uuid4()
    )
    assert job.import_all is True
    assert job.counters["pages_total"] == 2

    storage.exists = AsyncMock(return_value=False)
    assert await service.find_reusable_archive(sha256="hash", size_bytes=3) is None
    service.find_reusable_archive = AsyncMock(return_value=archive)
    session.execute.return_value = _EntityResult(None)
    assert (
        await service.start_upload(
            filename="archive.zip", size_bytes=3, actor_id=uuid.uuid4(), sha256="hash"
        )
        is archive
    )

    broken = SimpleNamespace(
        object_key="key", status="uploading", multipart_upload_id="upload", size_bytes=10
    )
    storage.list_multipart_parts = AsyncMock(return_value=[])
    with pytest.raises(BadRequestError):
        await service.complete_upload(broken)
    await service.abort_upload(
        SimpleNamespace(object_key="key", multipart_upload_id=None, status="uploaded")
    )
    with pytest.raises(ConflictError):
        await service.create_job(
            SimpleNamespace(status="uploaded", spaces=[]),
            import_all=True,
            space_keys=[],
            overwrite_existing=False,
            actor_id=uuid.uuid4(),
        )


@pytest.mark.asyncio
async def test_scan_paths_and_log(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    session = Mock()
    session.execute = AsyncMock(return_value=_ScalarResult([]))
    session.flush = AsyncMock()
    storage = Mock()
    storage.exists = AsyncMock(return_value=False)
    service = ConfluenceImportService(session, storage)
    archive = ImportArchive(
        object_key="key",
        filename="archive.zip",
        size_bytes=1,
        status="uploading",
        spaces=[],
        created_by_id=uuid.uuid4(),
    )
    with pytest.raises(BadRequestError):
        await service.scan(archive)

    archive.status = "scanned"
    archive.spaces = [{"key": "ENG"}]
    session.execute.return_value = _ScalarResult([])
    await service.scan(archive)
    assert archive.error is None

    archive.status = "uploaded"
    storage.exists = AsyncMock(return_value=True)

    async def download(_key, target):
        with zipfile.ZipFile(target, "w"):
            pass

    storage.download_to_file = AsyncMock(side_effect=download)
    monkeypatch.setattr(import_module, "scan_archive", lambda _path: [])
    await service.scan(archive)
    assert archive.status == "scanned"

    job = SimpleNamespace(id=uuid.uuid4())
    entry = await import_module.log(session, job, "info", "scan", "done", entity_type="space")
    assert entry.message == "done"


def test_confluence_permission_mapping() -> None:
    from app.modules.import_export.confluence import ConfluencePermission, ConfluenceSpace
    space = ConfluenceSpace(
        source_id="1",
        key="PRIV",
        name="Private Space",
        permissions=[
            ConfluencePermission(perm_type="VIEWSPACE", user_name="alice"),
            ConfluencePermission(perm_type="EDITSPACE", user_name="bob"),
            ConfluencePermission(perm_type="SETSPACEPERMISSIONS", user_name="charlie"),
        ],
    )
    assert len(space.permissions) == 3
    assert space.permissions[0].user_name == "alice"
    assert space.permissions[1].perm_type == "EDITSPACE"


def test_import_markup_helpers_cover_macros_and_fallbacks() -> None:
    assert _link_imported_attachments("plain", "42", {}, {}) == "plain"
    occupied = {"page", "page-2"}
    assert _slug("Page", occupied) == "page-3"
    assert _slug("!!!", occupied) == "page-4"
    content = (
        '<ac:image ac:width="20"><ri:attachment ri:filename="pic+one.png" />'
        '<ri:page ri:content-title="Other" /></ac:image>'
        '<ac:link><ri:attachment ri:filename="doc.txt" /></ac:link>'
        '<img src="/download/attachments/42/pic%2Bone.png?download=true">'
    )
    result = _link_imported_attachments(
        content,
        "42",
        {("42", "pic one.png"): "/attachments/pic", ("42", "doc.txt"): "/attachments/doc"},
        {"Other": "42"},
    )
    assert 'src="/attachments/pic"' in result
    assert 'href="/attachments/doc"' in result

    code = (
        '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">Python!</ac:parameter>'
        "<ac:plain-text-body><![CDATA[print(1)]]></ac:plain-text-body></ac:structured-macro>"
    )
    assert "language-python" in _normalize_confluence_code_macros(code)
    assert 'data-callout-type="panel"' in _normalize_confluence_code_macros(
        '<ac:structured-macro ac:name="expand"><ac:parameter ac:name="title">More</ac:parameter>'
        "<ac:rich-text-body><p>Body</p></ac:rich-text-body></ac:structured-macro>"
    )
    assert _normalize_confluence_code_macros("<ac:structured-macro>raw</ac:structured-macro>")
    assert 'keep' in _normalize_confluence_code_macros(
        '<ac:structured-macro ac:name="unknown"><p>keep</p></ac:structured-macro>'
    )
    assert 'missing body' in _normalize_confluence_code_macros(
        '<ac:structured-macro ac:name="code"><p>missing body</p></ac:structured-macro>'
    )
    unresolved = _link_imported_attachments(
        "<ac:image><ri:attachment /></ac:image><ac:link><ri:attachment /></ac:link>",
        "42",
        {("other", "x.txt"): "/x"},
        {},
    )
    assert "ac:image" in unresolved and "ac:link" in unresolved
    fallback = _link_imported_attachments(
        '<ac:image><ri:attachment ri:filename="x.txt" /></ac:image>'
        '<ac:link><ri:attachment ri:filename="y.txt" /></ac:link>',
        "42",
        {("other", "x.txt"): "/x", ("other", "y.txt"): "/y"},
        {},
    )
    assert 'src="/x"' in fallback and 'href="/y"' in fallback
    newline_code = (
        '<ac:structured-macro ac:name="code"><ac:plain-text-body>'
        "<![CDATA[hello\n]]></ac:plain-text-body></ac:structured-macro>"
    )
    assert _normalize_confluence_code_macros(newline_code).endswith("</code></pre>")


@pytest.mark.asyncio
async def test_upload_error_branches_and_run_import_guards() -> None:
    session = Mock()
    session.execute = AsyncMock(return_value=_ScalarResult([]))
    session.flush = AsyncMock()
    storage = Mock()
    storage.list_multipart_parts = AsyncMock(return_value=[])
    service = ConfluenceImportService(session, storage)
    archive = SimpleNamespace(
        object_key="key", status="uploaded", multipart_upload_id=None, size_bytes=1
    )
    with pytest.raises(ConflictError):
        await service.upload_part_urls(archive, [1])
    with pytest.raises(ConflictError):
        await service.complete_upload(archive)
    with pytest.raises(NotFoundError):
        session.get = AsyncMock(return_value=None)
        await service.get_archive(uuid.uuid4())

    session.get = AsyncMock(return_value=SimpleNamespace(status="done"))
    await import_module.run_import(session, storage, uuid.uuid4())


@pytest.mark.asyncio
async def test_run_import_empty_archive_completes(monkeypatch: pytest.MonkeyPatch) -> None:
    session = Mock()
    session.get = AsyncMock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    session.refresh = AsyncMock()
    session.add = Mock()
    job = SimpleNamespace(
        id=uuid.uuid4(),
        archive_id=uuid.uuid4(),
        status="queued",
        phase="queued",
        import_all=True,
        space_keys=[],
        overwrite_existing=False,
        created_by_id=uuid.uuid4(),
        cancel_requested=False,
        counters={"download_percent": 0},
    )
    archive = SimpleNamespace(object_key="archive.zip", size_bytes=1)
    session.get.side_effect = [job, archive]

    async def download(_key, target, **kwargs):
        await kwargs["on_progress"](1)
        await kwargs["on_progress"](1)
        with zipfile.ZipFile(target, "w") as source:
            source.writestr("attachments/att-1", b"data")

    storage = Mock()
    storage.download_to_file = AsyncMock(side_effect=download)
    monkeypatch.setattr(import_module, "scan_archive", lambda _path: [])
    monkeypatch.setattr(import_module, "iter_attachments", lambda _path: [])
    monkeypatch.setattr(import_module, "iter_page_bodies", lambda _path: [])

    await import_module.run_import(session, storage, job.id)
    assert job.status == "completed"
    assert job.phase == "completed"


@pytest.mark.asyncio
async def test_run_import_creates_space_pages_and_bodies(monkeypatch: pytest.MonkeyPatch) -> None:
    session = Mock()
    session.get = AsyncMock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    session.refresh = AsyncMock()
    session.add = Mock()
    added = []
    session.add.side_effect = added.append

    async def flush() -> None:
        for item in added:
            if getattr(item, "id", None) is None:
                item.id = uuid.uuid4()

    session.flush = AsyncMock(side_effect=flush)
    job = SimpleNamespace(
        id=uuid.uuid4(),
        archive_id=uuid.uuid4(),
        status="queued",
        phase="queued",
        import_all=True,
        space_keys=[],
        overwrite_existing=False,
        created_by_id=uuid.uuid4(),
        cancel_requested=False,
        counters={"download_percent": 0, "spaces_completed": 0, "pages_processed": 0},
    )
    archive = SimpleNamespace(object_key="archive.zip", size_bytes=1)
    session.get.side_effect = [job, archive]
    session.execute = AsyncMock(return_value=_EntityResult(None))

    source_page = ConfluencePage(
        source_id="page-1",
        space_id="space-1",
        parent_id=None,
        title="ENG",
        status="current",
        created_at=None,
        updated_at=None,
    )
    source_space = ConfluenceSpace("space-1", "ENG", "Engineering", [source_page])

    async def download(_key, target, **_kwargs):
        with zipfile.ZipFile(target, "w") as source:
            source.writestr("attachments/att-1", b"data")

    storage = Mock()
    storage.download_to_file = AsyncMock(side_effect=download)
    monkeypatch.setattr(import_module, "scan_archive", lambda _path: [source_space])
    monkeypatch.setattr(
        import_module,
        "iter_page_bodies",
        lambda _path: [
            ("page-1", '<p>body</p><ac:image><ri:attachment ri:filename="doc.txt" /></ac:image>')
        ],
    )
    attachment = ConfluenceAttachment("att-1", "page-1", "doc.txt", "text/plain")
    monkeypatch.setattr(
        import_module, "iter_attachments", lambda _path: [(attachment, "attachments/att-1")]
    )
    storage.put = AsyncMock()

    await import_module.run_import(session, storage, job.id)
    assert job.status == "completed"
    assert any(getattr(item, "key", None) == "ENG" for item in added)
    assert any("/api/v1/attachments/" in (getattr(item, "content", "") or "") for item in added)
    storage.put.assert_awaited_once()
    session.get = AsyncMock(
        side_effect=[
            SimpleNamespace(id=uuid.uuid4(), status="queued", archive_id=uuid.uuid4()),
            None,
        ]
    )
    await import_module.run_import(session, storage, uuid.uuid4())


@pytest.mark.asyncio
async def test_run_import_handles_home_creation_parenting_timestamps_and_cancel(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    session.refresh = AsyncMock()
    session.add = Mock()
    added = []
    session.add.side_effect = added.append

    async def flush() -> None:
        for item in added:
            if getattr(item, "id", None) is None:
                item.id = uuid.uuid4()

    session.flush = AsyncMock(side_effect=flush)
    created = datetime(2024, 1, 1, tzinfo=UTC)
    updated = datetime(2024, 1, 2, tzinfo=UTC)
    root = ConfluencePage("root", "space", None, "Root", "current", created, None)
    child = ConfluencePage("child", "space", "root", "Child", "current", created, updated)
    source_space = ConfluenceSpace("space", "ENG", "Engineering", [root, child])
    job = SimpleNamespace(
        id=uuid.uuid4(),
        archive_id=uuid.uuid4(),
        status="queued",
        phase="queued",
        import_all=True,
        space_keys=[],
        overwrite_existing=False,
        created_by_id=uuid.uuid4(),
        cancel_requested=False,
        counters={"download_percent": 0, "spaces_completed": 0, "pages_processed": 0},
    )
    archive = SimpleNamespace(object_key="archive.zip", size_bytes=1)
    session.get = AsyncMock(side_effect=[job, archive])
    session.execute = AsyncMock(return_value=_EntityResult(None))

    async def download(_key, target, **_kwargs):
        with zipfile.ZipFile(target, "w") as source:
            source.writestr("unused", b"data")

    storage = Mock(download_to_file=AsyncMock(side_effect=download), put=AsyncMock())
    monkeypatch.setattr(import_module, "scan_archive", lambda _path: [source_space])
    monkeypatch.setattr(import_module, "iter_page_bodies", lambda _path: [])
    monkeypatch.setattr(
        import_module,
        "iter_attachments",
        lambda _path: [(ConfluenceAttachment("unknown", "missing", "x", "text/plain"), "unused")],
    )
    await import_module.run_import(session, storage, job.id)
    home = next(item for item in added if getattr(item, "title", None) == "ENG")
    imported_child = next(item for item in added if getattr(item, "title", None) == "Child")
    assert imported_child.parent_id is not None
    assert home.created_by_id == job.created_by_id

    cancel_session = Mock()
    cancel_session.commit = AsyncMock()
    cancel_session.rollback = AsyncMock()
    cancel_session.refresh = AsyncMock()
    cancelled_job = SimpleNamespace(
        id=uuid.uuid4(),
        archive_id=uuid.uuid4(),
        status="queued",
        phase="queued",
        import_all=True,
        space_keys=[],
        cancel_requested=True,
        counters={"download_percent": 0},
    )
    cancel_archive = SimpleNamespace(object_key="archive.zip", size_bytes=1)
    cancel_session.get = AsyncMock(side_effect=[cancelled_job, cancel_archive])
    cancel_storage = Mock(download_to_file=AsyncMock(side_effect=download))
    await import_module.run_import(cancel_session, cancel_storage, cancelled_job.id)
    assert cancelled_job.status == "cancelled"


@pytest.mark.asyncio
async def test_run_import_skips_existing_space_without_overwrite(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    session.refresh = AsyncMock()
    session.delete = AsyncMock()
    session.flush = AsyncMock()
    job = SimpleNamespace(
        id=uuid.uuid4(),
        archive_id=uuid.uuid4(),
        status="queued",
        phase="queued",
        import_all=True,
        space_keys=[],
        overwrite_existing=False,
        created_by_id=uuid.uuid4(),
        cancel_requested=False,
        counters={"download_percent": 0, "spaces_completed": 0},
    )
    archive = SimpleNamespace(object_key="archive.zip", size_bytes=1)
    session.get = AsyncMock(side_effect=[job, archive])
    session.execute = AsyncMock(return_value=_EntityResult(object()))
    source = ConfluenceSpace("space", "ENG", "Engineering", [])

    async def download(_key, target, **_kwargs):
        with zipfile.ZipFile(target, "w"):
            pass

    storage = Mock(download_to_file=AsyncMock(side_effect=download))
    monkeypatch.setattr(import_module, "scan_archive", lambda _path: [source])
    monkeypatch.setattr(import_module, "iter_page_bodies", lambda _path: [])
    monkeypatch.setattr(import_module, "iter_attachments", lambda _path: [])
    await import_module.run_import(session, storage, job.id)
    assert job.counters["spaces_completed"] == 1
    session.delete.assert_not_awaited()

    job.status, job.phase, job.overwrite_existing = "queued", "queued", True
    job.counters = {"download_percent": 0, "spaces_completed": 0}
    session.get = AsyncMock(side_effect=[job, archive])
    await import_module.run_import(session, storage, job.id)
    session.delete.assert_awaited_once()

    job.status, job.phase, job.import_all = "queued", "queued", False
    job.space_keys = []
    session.get = AsyncMock(side_effect=[job, archive])
    await import_module.run_import(session, storage, job.id)


@pytest.mark.asyncio
async def test_run_import_persists_cancelled_and_failed_states() -> None:
    async def exercise(error: Exception, expected: str) -> SimpleNamespace:
        session = Mock()
        session.commit = AsyncMock()
        session.rollback = AsyncMock()
        session.refresh = AsyncMock()
        job = SimpleNamespace(
            id=uuid.uuid4(),
            archive_id=uuid.uuid4(),
            status="queued",
            phase="queued",
            counters={"download_percent": 0},
            cancel_requested=False,
        )
        archive = SimpleNamespace(object_key="archive.zip", size_bytes=1)
        final_job = SimpleNamespace(id=job.id, status="queued", phase="queued")
        session.get = AsyncMock(side_effect=[job, archive, final_job])
        storage = Mock()
        storage.download_to_file = AsyncMock(side_effect=error)
        await import_module.run_import(session, storage, job.id)
        assert final_job.status == expected
        return final_job

    await exercise(ImportCancelled("cancelled"), "cancelled")
    failed = await exercise(ValueError("broken"), "failed")
    assert failed.error == "broken"

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    progress_job = SimpleNamespace(
        id=uuid.uuid4(),
        archive_id=uuid.uuid4(),
        status="queued",
        phase="queued",
        counters={"download_percent": 0},
        cancel_requested=False,
    )
    archive = SimpleNamespace(object_key="archive.zip", size_bytes=1)
    final_job = SimpleNamespace(id=progress_job.id, status="queued", phase="queued")
    session.get = AsyncMock(side_effect=[progress_job, archive, final_job])
    session.refresh = AsyncMock(side_effect=lambda item: setattr(item, "cancel_requested", True))

    async def cancelled_download(_key, _target, **kwargs):
        await kwargs["on_progress"](1)

    storage = Mock(download_to_file=AsyncMock(side_effect=cancelled_download))
    await import_module.run_import(session, storage, progress_job.id)
    assert final_job.status == "cancelled"


def test_seekable_s3_file_read_seek_and_metadata() -> None:
    client = Mock()
    client.get_object = Mock(return_value={"Body": Mock(read=Mock(return_value=b"hello"))})
    f = SeekableS3File(client, "bucket", "key", 100)

    assert f.readable() is True
    assert f.seekable() is True
    assert f.tell() == 0

    assert f.seek(10, io.SEEK_SET) == 10
    assert f.seek(5, io.SEEK_CUR) == 15
    assert f.seek(-10, io.SEEK_END) == 90
    # Clamped to the file bounds on both ends.
    assert f.seek(10_000, io.SEEK_SET) == 100
    assert f.seek(-10_000, io.SEEK_SET) == 0

    f.seek(0)
    data = f.read(5)
    assert data == b"hello"
    client.get_object.assert_called_with(Bucket="bucket", Key="key", Range="bytes=0-4")

    # Reading with a negative size reads through to the end of the file.
    f.seek(0)
    f.read(-1)
    client.get_object.assert_called_with(Bucket="bucket", Key="key", Range="bytes=0-99")

    # Positioned at (or past) EOF returns no data without calling S3.
    client.get_object.reset_mock()
    eof = SeekableS3File(client, "bucket", "key", 0)
    assert eof.read(10) == b""
    client.get_object.assert_not_called()

    # A zero-byte request collapses the computed range and short-circuits.
    zero = SeekableS3File(client, "bucket", "key", 10)
    assert zero.read(0) == b""


@pytest.mark.asyncio
async def test_scan_archive_sync_falls_back_to_local_download_on_stream_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = Mock()
    session.flush = AsyncMock()
    storage = Mock()
    storage.exists = AsyncMock(return_value=True)
    service = ConfluenceImportService(session, storage)
    archive = ImportArchive(
        object_key="key",
        filename="archive.zip",
        size_bytes=5,
        status="uploaded",
        spaces=[],
        created_by_id=uuid.uuid4(),
    )
    session.execute = AsyncMock(return_value=_ScalarResult([]))

    def fake_scan_archive(path_or_file):
        if isinstance(path_or_file, SeekableS3File):
            raise RuntimeError("range-scan boom")
        return []

    monkeypatch.setattr(import_module, "scan_archive", fake_scan_archive)
    # storage is a Mock(), so getattr(storage, "_client"/"bucket", None) yields
    # truthy Mocks, driving _scan_archive_sync down the S3 streaming path first.
    await service.scan(archive)
    assert archive.status == "scanned"
    # The local fallback re-used the same S3 client to download the file.
    storage._client.download_file.assert_called_once()
    call_args = storage._client.download_file.call_args[0]
    assert call_args[0] == storage.bucket
    assert call_args[1] == archive.object_key


@pytest.mark.asyncio
async def test_scan_archive_sync_does_not_download_when_the_archive_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A BadRequestError from the ranged reader is a verdict on the contents,
    not a failure to read them, so the local-download fallback must not run.

    Reported case: a WikiHub backup uploaded to the Confluence card. The
    streaming scan decided in about a second; falling back downloaded the whole
    multi-GB archive to reach the same answer 125 seconds later, by which time
    the frontend proxy had dropped the request and the user saw a bare 500
    instead of the message naming the mistake.
    """
    session = Mock()
    session.flush = AsyncMock()
    storage = Mock()
    storage.exists = AsyncMock(return_value=True)
    service = ConfluenceImportService(session, storage)
    archive = ImportArchive(
        object_key="key",
        filename="wikihub-full-backup.zip",
        size_bytes=5,
        status="uploaded",
        spaces=[],
        created_by_id=uuid.uuid4(),
    )
    session.execute = AsyncMock(return_value=_ScalarResult([]))

    def fake_scan_archive(path_or_file):
        if isinstance(path_or_file, SeekableS3File):
            raise BadRequestError(
                'This looks like a WikiHub backup, not a Confluence export.',
                code="wrong_archive_format",
            )
        raise AssertionError("the local fallback must not run for a rejected archive")

    monkeypatch.setattr(import_module, "scan_archive", fake_scan_archive)

    with pytest.raises(BadRequestError) as excinfo:
        await service.scan(archive)
    assert excinfo.value.code == "wrong_archive_format"
    storage._client.download_file.assert_not_called()


@pytest.mark.asyncio
async def test_scan_archive_sync_without_s3_client_uses_storage_download(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = Mock()
    session.flush = AsyncMock()
    session.execute = AsyncMock(return_value=_ScalarResult([]))
    storage = SimpleNamespace(
        exists=AsyncMock(return_value=True),
        download_to_file=AsyncMock(return_value=None),
    )
    service = ConfluenceImportService(session, storage)
    archive = ImportArchive(
        object_key="key",
        filename="archive.zip",
        size_bytes=5,
        status="uploaded",
        spaces=[],
        created_by_id=uuid.uuid4(),
    )
    monkeypatch.setattr(import_module, "scan_archive", lambda _path: [])
    await service.scan(archive)
    assert archive.status == "scanned"
    storage.download_to_file.assert_awaited_once()


@pytest.mark.asyncio
async def test_scan_reraises_bad_request_error_from_scan_sync(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = Mock()
    session.flush = AsyncMock()
    session.execute = AsyncMock(return_value=_ScalarResult([]))
    storage = Mock()
    storage.exists = AsyncMock(return_value=True)
    service = ConfluenceImportService(session, storage)
    archive = ImportArchive(
        object_key="key",
        filename="archive.zip",
        size_bytes=5,
        status="uploaded",
        spaces=[],
        created_by_id=uuid.uuid4(),
    )

    def fake_scan_archive(_path_or_file):
        raise BadRequestError("not a real archive")

    monkeypatch.setattr(import_module, "scan_archive", fake_scan_archive)
    with pytest.raises(BadRequestError, match="not a real archive"):
        await service.scan(archive)
    assert archive.error is None


@pytest.mark.asyncio
async def test_scan_wraps_generic_scan_sync_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    session = Mock()
    session.flush = AsyncMock()
    session.execute = AsyncMock(return_value=_ScalarResult([]))
    storage = Mock()
    storage.exists = AsyncMock(return_value=True)
    service = ConfluenceImportService(session, storage)
    archive = ImportArchive(
        object_key="key",
        filename="archive.zip",
        size_bytes=5,
        status="uploaded",
        spaces=[],
        created_by_id=uuid.uuid4(),
    )

    def fake_scan_archive(_path_or_file):
        raise RuntimeError("totally broken")

    monkeypatch.setattr(import_module, "scan_archive", fake_scan_archive)
    with pytest.raises(BadRequestError, match="Could not scan Confluence archive"):
        await service.scan(archive)
    assert archive.error == "totally broken"


@pytest.mark.asyncio
async def test_run_import_groups_space_permissions_and_page_restrictions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Exercise Confluence group import, space permission mapping (roles and
    SpaceGroupPermission grants) and page restriction import together, since
    they all live on the same archive scan result."""

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    session.refresh = AsyncMock()
    session.delete = AsyncMock()
    added: list = []
    session.add = Mock(side_effect=added.append)

    async def flush() -> None:
        for item in added:
            if getattr(item, "id", None) is None:
                item.id = uuid.uuid4()

    session.flush = AsyncMock(side_effect=flush)

    existing_group = SimpleNamespace(id=uuid.uuid4(), name="Existing Team")
    session.execute = AsyncMock(
        side_effect=_entity_dispatch_execute({Group: [existing_group]})
    )

    job = SimpleNamespace(
        id=uuid.uuid4(),
        archive_id=uuid.uuid4(),
        status="queued",
        phase="queued",
        import_all=True,
        space_keys=[],
        overwrite_existing=False,
        created_by_id=uuid.uuid4(),
        cancel_requested=False,
        counters={"download_percent": 0, "spaces_completed": 0, "pages_processed": 0},
    )
    archive = SimpleNamespace(object_key="archive.zip", size_bytes=1)
    session.get = AsyncMock(side_effect=[job, archive])

    groups = [
        ConfluenceGroup(name="", members=["ignored"]),
        ConfluenceGroup(name="8a9e2ef3775bd448017765ec6a120000", members=["ignored2"]),
        ConfluenceGroup(name="Inactive Team", members=[]),
        ConfluenceGroup(name="Existing Team", members=["carol", "dave"]),
        ConfluenceGroup(name="New Team", members=["erin"]),
        ConfluenceGroup(name="Perm Only", members=[]),
        ConfluenceGroup(name="Restr Only", members=[]),
    ]

    permissions = [
        ConfluencePermission(perm_type="VIEWSPACE", user_name="alice"),
        ConfluencePermission(perm_type="EDITSPACE", user_name="bob"),
        ConfluencePermission(perm_type="SETSPACEPERMISSIONS", user_name="charlie"),
        ConfluencePermission(perm_type="VIEWSPACE", user_name="8a9e2ef3775bd448017765ec6a120000"),
        ConfluencePermission(perm_type="EDITSPACE", group_name="Perm Only"),
        ConfluencePermission(perm_type="SETSPACEPERMISSIONS", group_name="Existing Team"),
        ConfluencePermission(perm_type="VIEWSPACE", group_name="Existing Team"),
    ]

    page1 = ConfluencePage(
        source_id="page-1",
        space_id="space-1",
        parent_id=None,
        title="Page One",
        status="current",
        created_at=None,
        updated_at=None,
    )
    page2 = ConfluencePage(
        source_id="page-2",
        space_id="space-1",
        parent_id=None,
        title="Page Two",
        status="current",
        created_at=None,
        updated_at=None,
    )

    restrictions = [
        # Refers to a page that was never imported -> must be skipped.
        ConfluencePageRestriction(page_id="page-missing", restriction_type="view", user_name="ghost"),
        ConfluencePageRestriction(page_id="page-1", restriction_type="view", user_name="frank"),
        ConfluencePageRestriction(
            page_id="page-1", restriction_type="edit", group_name="Existing Team"
        ),
        ConfluencePageRestriction(
            page_id="page-2", restriction_type="view", group_name="Restr Only"
        ),
    ]

    source_space = ConfluenceSpace(
        "space-1",
        "ENG",
        "Engineering",
        [page1, page2],
        permissions=permissions,
        restrictions=restrictions,
    )
    scanned = ConfluenceSpaceList([source_space], groups)

    async def download(_key, target, **_kwargs):
        with zipfile.ZipFile(target, "w") as source:
            source.writestr("unused", b"data")

    storage = Mock(download_to_file=AsyncMock(side_effect=download), put=AsyncMock())
    monkeypatch.setattr(import_module, "scan_archive", lambda _path: scanned)
    monkeypatch.setattr(import_module, "iter_page_bodies", lambda _path: [])
    monkeypatch.setattr(import_module, "iter_attachments", lambda _path: [])

    await import_module.run_import(session, storage, job.id)

    assert job.status == "completed"

    created_groups = [item for item in added if isinstance(item, Group)]
    # "Existing Team" was resolved from the DB, not re-created.
    assert all(g.name != "Existing Team" for g in created_groups)
    assert {"New Team", "Perm Only", "Restr Only"} <= {g.name for g in created_groups}

    group_members = [item for item in added if isinstance(item, GroupMember)]
    assert len(group_members) == 3  # carol, dave (Existing Team) + erin (New Team)

    sgp_permissions = {item.permission for item in added if isinstance(item, SpaceGroupPermission)}
    assert sgp_permissions == {Permission.admin, Permission.add, Permission.view}

    user_restrictions = [item for item in added if isinstance(item, PageUserRestriction)]
    assert any(r.permission == PageRestrictionPermission.view for r in user_restrictions)

    group_restrictions = [item for item in added if isinstance(item, PageGroupRestriction)]
    assert {r.permission for r in group_restrictions} == {
        PageRestrictionPermission.edit,
        PageRestrictionPermission.view,
    }

    space = next(item for item in added if isinstance(item, Space))
    assert space.key == "ENG"


@pytest.mark.asyncio
async def test_run_import_attachment_size_defaults_to_zero_on_missing_zip_entry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    session.refresh = AsyncMock()
    session.delete = AsyncMock()
    added: list = []
    session.add = Mock(side_effect=added.append)

    async def flush() -> None:
        for item in added:
            if getattr(item, "id", None) is None:
                item.id = uuid.uuid4()

    session.flush = AsyncMock(side_effect=flush)
    session.execute = AsyncMock(return_value=_EntityResult(None))

    job = SimpleNamespace(
        id=uuid.uuid4(),
        archive_id=uuid.uuid4(),
        status="queued",
        phase="queued",
        import_all=True,
        space_keys=[],
        overwrite_existing=False,
        created_by_id=uuid.uuid4(),
        cancel_requested=False,
        counters={"download_percent": 0, "spaces_completed": 0, "pages_processed": 0},
    )
    archive = SimpleNamespace(object_key="archive.zip", size_bytes=1)
    session.get = AsyncMock(side_effect=[job, archive, job])

    source_page = ConfluencePage(
        source_id="page-1",
        space_id="space-1",
        parent_id=None,
        title="ENG",
        status="current",
        created_at=None,
        updated_at=None,
    )
    source_space = ConfluenceSpace("space-1", "ENG", "Engineering", [source_page])

    async def download(_key, target, **_kwargs):
        with zipfile.ZipFile(target, "w") as source:
            # The member is genuinely present so `.open()` still succeeds;
            # only `.getinfo()` is made to fail below, to reach the
            # defensive except branch around the file-size lookup.
            source.writestr("attachments/att-1", b"binary-data")

    storage = Mock(download_to_file=AsyncMock(side_effect=download), put=AsyncMock())
    monkeypatch.setattr(import_module, "scan_archive", lambda _path: [source_space])
    monkeypatch.setattr(
        import_module, "iter_page_bodies", lambda _path: [("page-1", "<p>body</p>")]
    )
    attachment = ConfluenceAttachment("att-1", "page-1", "doc.txt", "text/plain")
    monkeypatch.setattr(
        import_module, "iter_attachments", lambda _path: [(attachment, "attachments/att-1")]
    )

    # `ZipFile.open()` also calls `getinfo()` internally, so only the first
    # (explicit, service.py-issued) call is made to fail; the later call
    # made by `.open()` must still succeed so the attachment body can be read.
    original_getinfo = zipfile.ZipFile.getinfo
    call_count = {"n": 0}

    def flaky_getinfo(self, name, *args, **kwargs):
        call_count["n"] += 1
        if name == "attachments/att-1" and call_count["n"] == 1:
            raise KeyError(name)
        return original_getinfo(self, name, *args, **kwargs)

    monkeypatch.setattr(zipfile.ZipFile, "getinfo", flaky_getinfo)

    await import_module.run_import(session, storage, job.id)

    assert job.status == "completed", getattr(job, "error", None)
    created_attachment = next(item for item in added if getattr(item, "filename", None) == "doc.txt")
    assert created_attachment.size_bytes == 0


@pytest.mark.asyncio
async def test_run_import_marks_space_restricted_without_public_view_permission(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """None of the space's permissions are a public VIEWSPACE/SPACEADMIN-style
    grant, but an EDITSPACE grant still produces a user role, so the space
    must be imported as restricted rather than open."""

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    session.refresh = AsyncMock()
    session.delete = AsyncMock()
    added: list = []
    session.add = Mock(side_effect=added.append)

    async def flush() -> None:
        for item in added:
            if getattr(item, "id", None) is None:
                item.id = uuid.uuid4()

    session.flush = AsyncMock(side_effect=flush)
    session.execute = AsyncMock(return_value=_EntityResult(None))

    job = SimpleNamespace(
        id=uuid.uuid4(),
        archive_id=uuid.uuid4(),
        status="queued",
        phase="queued",
        import_all=True,
        space_keys=[],
        overwrite_existing=False,
        created_by_id=uuid.uuid4(),
        cancel_requested=False,
        counters={"download_percent": 0, "spaces_completed": 0, "pages_processed": 0},
    )
    archive = SimpleNamespace(object_key="archive.zip", size_bytes=1)
    session.get = AsyncMock(side_effect=[job, archive])

    permissions = [ConfluencePermission(perm_type="EDITSPACE", user_name="bob")]
    source_space = ConfluenceSpace("space-1", "ENG", "Engineering", [], permissions=permissions)

    async def download(_key, target, **_kwargs):
        with zipfile.ZipFile(target, "w"):
            pass

    storage = Mock(download_to_file=AsyncMock(side_effect=download), put=AsyncMock())
    monkeypatch.setattr(import_module, "scan_archive", lambda _path: [source_space])
    monkeypatch.setattr(import_module, "iter_page_bodies", lambda _path: [])
    monkeypatch.setattr(import_module, "iter_attachments", lambda _path: [])

    await import_module.run_import(session, storage, job.id)

    assert job.status == "completed", getattr(job, "error", None)
    space = next(item for item in added if isinstance(item, Space))
    assert space.visibility == SpaceVisibility.restricted
