from __future__ import annotations

import uuid
import zipfile
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.core.exceptions import BadRequestError, ConflictError, NotFoundError, PayloadTooLargeError
from app.models.import_job import ImportArchive
from app.modules.import_export import service as import_module
from app.modules.import_export.confluence import (
    ConfluenceAttachment,
    ConfluencePage,
    ConfluenceSpace,
)
from app.modules.import_export.service import (
    ConfluenceImportService,
    ImportCancelled,
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

    archive = await service.start_upload(filename="archive.zip", size_bytes=1, actor_id=uuid.uuid4())
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
    storage = Mock()
    storage.exists = AsyncMock(return_value=True)
    service = ConfluenceImportService(session, storage)
    archive = SimpleNamespace(object_key="key", status="uploaded", sha256="hash", size_bytes=3, multipart_upload_id=None)
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
        await service.create_job(scanned, import_all=False, space_keys=[], overwrite_existing=False, actor_id=uuid.uuid4())
    with pytest.raises(BadRequestError):
        await service.create_job(scanned, import_all=False, space_keys=["NOPE"], overwrite_existing=False, actor_id=uuid.uuid4())
    job = await service.create_job(scanned, import_all=True, space_keys=[], overwrite_existing=True, actor_id=uuid.uuid4())
    assert job.import_all is True
    assert job.counters["pages_total"] == 2

    storage.exists = AsyncMock(return_value=False)
    assert await service.find_reusable_archive(sha256="hash", size_bytes=3) is None
    service.find_reusable_archive = AsyncMock(return_value=archive)
    session.execute.return_value = Mock(scalar_one_or_none=Mock(return_value=None))
    assert await service.start_upload(
        filename="archive.zip", size_bytes=3, actor_id=uuid.uuid4(), sha256="hash"
    ) is archive

    broken = SimpleNamespace(
        object_key="key", status="uploading", multipart_upload_id="upload", size_bytes=10
    )
    storage.list_multipart_parts = AsyncMock(return_value=[])
    with pytest.raises(BadRequestError):
        await service.complete_upload(broken)
    await service.abort_upload(SimpleNamespace(object_key="key", multipart_upload_id=None, status="uploaded"))
    with pytest.raises(ConflictError):
        await service.create_job(
            SimpleNamespace(status="uploaded", spaces=[]), import_all=True,
            space_keys=[], overwrite_existing=False, actor_id=uuid.uuid4()
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
        '<ac:plain-text-body><![CDATA[print(1)]]></ac:plain-text-body></ac:structured-macro>'
    )
    assert "language-python" in _normalize_confluence_code_macros(code)
    assert "data-callout-type=\"panel\"" in _normalize_confluence_code_macros(
        '<ac:structured-macro ac:name="expand"><ac:parameter ac:name="title">More</ac:parameter>'
        '<ac:rich-text-body><p>Body</p></ac:rich-text-body></ac:structured-macro>'
    )
    assert _normalize_confluence_code_macros('<ac:structured-macro>raw</ac:structured-macro>')
    assert 'ac:name="unknown"' in _normalize_confluence_code_macros(
        '<ac:structured-macro ac:name="unknown"><p>keep</p></ac:structured-macro>'
    )
    assert 'ac:name="code"' in _normalize_confluence_code_macros(
        '<ac:structured-macro ac:name="code"><p>missing body</p></ac:structured-macro>'
    )
    unresolved = _link_imported_attachments(
        '<ac:image><ri:attachment /></ac:image><ac:link><ri:attachment /></ac:link>',
        "42", {("other", "x.txt"): "/x"}, {},
    )
    assert "ac:image" in unresolved and "ac:link" in unresolved
    fallback = _link_imported_attachments(
        '<ac:image><ri:attachment ri:filename="x.txt" /></ac:image>'
        '<ac:link><ri:attachment ri:filename="y.txt" /></ac:link>',
        "42", {("other", "x.txt"): "/x", ("other", "y.txt"): "/y"}, {},
    )
    assert 'src="/x"' in fallback and 'href="/y"' in fallback
    newline_code = (
        '<ac:structured-macro ac:name="code"><ac:plain-text-body>'
        '<![CDATA[hello\n]]></ac:plain-text-body></ac:structured-macro>'
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
        id=uuid.uuid4(), archive_id=uuid.uuid4(), status="queued", phase="queued",
        import_all=True, space_keys=[], overwrite_existing=False, created_by_id=uuid.uuid4(),
        cancel_requested=False, counters={"download_percent": 0, "spaces_completed": 0, "pages_processed": 0},
    )
    archive = SimpleNamespace(object_key="archive.zip", size_bytes=1)
    session.get.side_effect = [job, archive]
    session.execute = AsyncMock(return_value=Mock(scalar_one_or_none=Mock(return_value=None)))

    source_page = ConfluencePage(
        source_id="page-1", space_id="space-1", parent_id=None, title="ENG",
        status="current", created_at=None, updated_at=None,
    )
    source_space = ConfluenceSpace("space-1", "ENG", "Engineering", [source_page])

    async def download(_key, target, **_kwargs):
        with zipfile.ZipFile(target, "w") as source:
            source.writestr("attachments/att-1", b"data")

    storage = Mock()
    storage.download_to_file = AsyncMock(side_effect=download)
    monkeypatch.setattr(import_module, "scan_archive", lambda _path: [source_space])
    monkeypatch.setattr(
        import_module, "iter_page_bodies",
        lambda _path: [("page-1", '<p>body</p><ac:image><ri:attachment ri:filename="doc.txt" /></ac:image>')],
    )
    attachment = ConfluenceAttachment("att-1", "page-1", "doc.txt", "text/plain")
    monkeypatch.setattr(import_module, "iter_attachments", lambda _path: [(attachment, "attachments/att-1")])
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
        id=uuid.uuid4(), archive_id=uuid.uuid4(), status="queued", phase="queued",
        import_all=True, space_keys=[], overwrite_existing=False, created_by_id=uuid.uuid4(),
        cancel_requested=False, counters={"download_percent": 0, "spaces_completed": 0, "pages_processed": 0},
    )
    archive = SimpleNamespace(object_key="archive.zip", size_bytes=1)
    session.get = AsyncMock(side_effect=[job, archive])
    session.execute = AsyncMock(return_value=Mock(scalar_one_or_none=Mock(return_value=None)))

    async def download(_key, target, **_kwargs):
        with zipfile.ZipFile(target, "w") as source:
            source.writestr("unused", b"data")

    storage = Mock(download_to_file=AsyncMock(side_effect=download), put=AsyncMock())
    monkeypatch.setattr(import_module, "scan_archive", lambda _path: [source_space])
    monkeypatch.setattr(import_module, "iter_page_bodies", lambda _path: [])
    monkeypatch.setattr(
        import_module, "iter_attachments",
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
        id=uuid.uuid4(), archive_id=uuid.uuid4(), status="queued", phase="queued",
        import_all=True, space_keys=[], cancel_requested=True, counters={"download_percent": 0},
    )
    cancel_archive = SimpleNamespace(object_key="archive.zip", size_bytes=1)
    cancel_session.get = AsyncMock(side_effect=[cancelled_job, cancel_archive])
    cancel_storage = Mock(download_to_file=AsyncMock(side_effect=download))
    await import_module.run_import(cancel_session, cancel_storage, cancelled_job.id)
    assert cancelled_job.status == "cancelled"


@pytest.mark.asyncio
async def test_run_import_skips_existing_space_without_overwrite(monkeypatch: pytest.MonkeyPatch) -> None:
    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    session.refresh = AsyncMock()
    session.delete = AsyncMock()
    session.flush = AsyncMock()
    job = SimpleNamespace(
        id=uuid.uuid4(), archive_id=uuid.uuid4(), status="queued", phase="queued",
        import_all=True, space_keys=[], overwrite_existing=False, created_by_id=uuid.uuid4(),
        cancel_requested=False, counters={"download_percent": 0, "spaces_completed": 0},
    )
    archive = SimpleNamespace(object_key="archive.zip", size_bytes=1)
    session.get = AsyncMock(side_effect=[job, archive])
    session.execute = AsyncMock(return_value=Mock(scalar_one_or_none=Mock(return_value=object())))
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
            id=uuid.uuid4(), archive_id=uuid.uuid4(), status="queued", phase="queued",
            counters={"download_percent": 0}, cancel_requested=False,
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
        id=uuid.uuid4(), archive_id=uuid.uuid4(), status="queued", phase="queued",
        counters={"download_percent": 0}, cancel_requested=False,
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
