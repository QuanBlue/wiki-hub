"""The document-import HTTP surface.

Endpoint functions are called directly with mocked services, the way
`test_api_backup_full.py` does it - what is under test is the request-level
gatekeeping (permission, file count, extension, size, magic bytes, concurrency)
that has to happen before anything is written or queued.
"""

from __future__ import annotations

import uuid
import zlib
from unittest.mock import AsyncMock, Mock

import pytest

from app.api.v1.document_imports import (
    _check_magic_bytes,
    _enqueue,
    _read_upload,
    cancel_document_import,
    create_document_import,
    get_document_import,
)
from app.core.exceptions import (
    BadRequestError,
    ConflictError,
    NotFoundError,
    PayloadTooLargeError,
    PermissionDeniedError,
    ServiceUnavailableError,
    UnsupportedMediaTypeError,
)
from app.schemas.document_import import MAX_DOCUMENT_IMPORT_FILES

MODULE = "app.api.v1.document_imports"

#: A minimal real PDF header, enough for `filetype` to recognise one.
PDF_BYTES = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n" + b"0" * 200


def _zip_bytes() -> bytes:
    """A tiny but structurally real zip, which is what a .docx is."""
    import io
    import zipfile

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", "<w:document/>")
    return buffer.getvalue()


def _upload(filename: str, data: bytes = b"content bytes", content_type: str = "") -> Mock:
    file = Mock()
    file.filename = filename
    file.content_type = content_type
    chunks = [data, b""]

    async def read(_size: int = -1) -> bytes:
        return chunks.pop(0) if chunks else b""

    file.read = read
    return file


def _stub_services(monkeypatch, *, can_edit: bool = True, parent=None, max_mb: int = 50) -> Mock:
    space = Mock()
    space.id = uuid.uuid4()
    space.key = "ENG"

    class _SpaceService:
        def __init__(self, _session):
            pass

        async def get_by_key(self, _key):
            return space

    class _PageService:
        def __init__(self, _session):
            pass

        async def require_editor(self, _space, _user):
            if not can_edit:
                raise PermissionDeniedError("You cannot add pages to this space.")

    class _Effective:
        max_upload_size_bytes = max_mb * 1024 * 1024
        max_upload_size_mb = max_mb

    class _SiteSettings:
        def __init__(self, _session):
            pass

        async def get_effective(self):
            return _Effective()

    monkeypatch.setattr(f"{MODULE}.SpaceService", _SpaceService)
    monkeypatch.setattr(f"{MODULE}.PageService", _PageService)
    monkeypatch.setattr(f"{MODULE}.SiteSettingsService", _SiteSettings)
    monkeypatch.setattr(f"{MODULE}.assert_no_active_wikihub_restore", AsyncMock())
    monkeypatch.setattr(f"{MODULE}.get_storage", lambda: AsyncMock())
    monkeypatch.setattr(f"{MODULE}._enqueue", AsyncMock())

    job = Mock()
    job.id = uuid.uuid4()
    monkeypatch.setattr(f"{MODULE}.create_document_import_job", AsyncMock(return_value=job))
    monkeypatch.setattr(f"{MODULE}.to_job_read", lambda j, *, space_key: {"id": j.id})
    return space


class TestEnqueue:
    @pytest.mark.asyncio
    async def test_a_broken_queue_is_reported_as_unavailable(self, monkeypatch):
        # The rows are already written at this point, so the user must be told
        # the import did not start rather than left watching a queued job.
        async def broken(*_args, **_kwargs):
            raise RuntimeError("redis is down")

        monkeypatch.setattr(f"{MODULE}.create_pool", broken)
        with pytest.raises(ServiceUnavailableError, match="worker queue is unavailable"):
            await _enqueue(uuid.uuid4())

    @pytest.mark.asyncio
    async def test_the_job_is_queued_under_its_registered_name(self, monkeypatch):
        pool = Mock()
        pool.enqueue_job = AsyncMock()
        pool.aclose = AsyncMock()

        async def create_pool(*_args, **_kwargs):
            return pool

        monkeypatch.setattr(f"{MODULE}.create_pool", create_pool)
        job_id = uuid.uuid4()
        await _enqueue(job_id)
        pool.enqueue_job.assert_awaited_once_with("run_document_import", str(job_id))
        pool.aclose.assert_awaited_once()


class TestUploadGuard:
    @pytest.mark.asyncio
    async def test_a_file_over_the_ceiling_is_refused_mid_stream(self):
        file = _upload("big.docx", b"x" * 5000)
        with pytest.raises(PayloadTooLargeError):
            await _read_upload(file, limit_bytes=1000, limit_mb=1)

    @pytest.mark.asyncio
    async def test_a_file_at_the_ceiling_is_accepted(self):
        file = _upload("ok.docx", b"x" * 1000)
        assert len(await _read_upload(file, limit_bytes=1000, limit_mb=1)) == 1000


class TestMagicBytes:
    def test_a_pdf_that_is_really_a_pdf_passes(self):
        _check_magic_bytes("a.pdf", "pdf", PDF_BYTES)

    def test_a_docx_that_is_really_a_pdf_is_rejected(self):
        with pytest.raises(UnsupportedMediaTypeError, match="does not look like"):
            _check_magic_bytes("fake.docx", "docx", PDF_BYTES)

    def test_a_pdf_that_is_really_a_zip_is_rejected(self):
        with pytest.raises(UnsupportedMediaTypeError):
            _check_magic_bytes("fake.pdf", "pdf", _zip_bytes())

    def test_a_real_docx_zip_container_passes(self):
        _check_magic_bytes("real.docx", "docx", _zip_bytes())

    def test_an_unrecognised_signature_is_allowed_through(self):
        # `filetype` knows a bounded set of signatures; refusing everything it
        # has not heard of would reject legitimate documents.
        _check_magic_bytes("odd.rtf", "rtf", b"\x00\x01\x02\x03" + zlib.compress(b"x" * 50))

    def test_text_formats_are_not_sniffed(self):
        # HTML and Markdown have no signature to check against.
        _check_magic_bytes("page.html", "html", b"<p>hello</p>")
        _check_magic_bytes("notes.md", "markdown", b"# hello")


class TestCreateEndpoint:
    @pytest.mark.asyncio
    async def test_a_valid_batch_is_accepted(self, monkeypatch):
        _stub_services(monkeypatch)
        session = AsyncMock()
        result = await create_document_import(
            "ENG", Mock(), session, [_upload("a.docx", _zip_bytes())], None
        )
        assert "id" in result

    @pytest.mark.asyncio
    async def test_no_files_is_a_bad_request(self, monkeypatch):
        _stub_services(monkeypatch)
        with pytest.raises(BadRequestError, match="at least one document"):
            await create_document_import("ENG", Mock(), AsyncMock(), [], None)

    @pytest.mark.asyncio
    async def test_only_empty_filenames_is_a_bad_request(self, monkeypatch):
        _stub_services(monkeypatch)
        with pytest.raises(BadRequestError):
            await create_document_import("ENG", Mock(), AsyncMock(), [_upload("")], None)

    @pytest.mark.asyncio
    async def test_too_many_files_is_a_bad_request(self, monkeypatch):
        _stub_services(monkeypatch)
        files = [_upload(f"f{i}.docx") for i in range(MAX_DOCUMENT_IMPORT_FILES + 1)]
        with pytest.raises(BadRequestError, match="at most"):
            await create_document_import("ENG", Mock(), AsyncMock(), files, None)

    @pytest.mark.asyncio
    async def test_an_unsupported_extension_is_refused(self, monkeypatch):
        _stub_services(monkeypatch)
        with pytest.raises(UnsupportedMediaTypeError):
            await create_document_import(
                "ENG", Mock(), AsyncMock(), [_upload("payload.exe")], None
            )

    @pytest.mark.asyncio
    async def test_a_macro_enabled_document_is_refused(self, monkeypatch):
        _stub_services(monkeypatch)
        with pytest.raises(UnsupportedMediaTypeError):
            await create_document_import(
                "ENG", Mock(), AsyncMock(), [_upload("macros.docm")], None
            )

    @pytest.mark.asyncio
    async def test_an_empty_file_is_refused(self, monkeypatch):
        _stub_services(monkeypatch)
        with pytest.raises(BadRequestError, match="empty"):
            await create_document_import(
                "ENG", Mock(), AsyncMock(), [_upload("blank.docx", b"")], None
            )

    @pytest.mark.asyncio
    async def test_an_oversized_file_is_refused(self, monkeypatch):
        _stub_services(monkeypatch, max_mb=0)
        with pytest.raises(PayloadTooLargeError):
            await create_document_import(
                "ENG", Mock(), AsyncMock(), [_upload("big.docx", b"x" * 10)], None
            )

    @pytest.mark.asyncio
    async def test_a_user_without_add_permission_is_refused(self, monkeypatch):
        _stub_services(monkeypatch, can_edit=False)
        with pytest.raises(PermissionDeniedError):
            await create_document_import(
                "ENG", Mock(), AsyncMock(), [_upload("a.docx", _zip_bytes())], None
            )

    @pytest.mark.asyncio
    async def test_permission_is_checked_before_anything_is_read(self, monkeypatch):
        # A user who cannot add pages should not be able to make the server
        # buffer 20 x 50 MB first.
        _stub_services(monkeypatch, can_edit=False)
        file = _upload("a.docx", _zip_bytes())
        reads = {"n": 0}
        original = file.read

        async def counting_read(size: int = -1):
            reads["n"] += 1
            return await original(size)

        file.read = counting_read
        with pytest.raises(PermissionDeniedError):
            await create_document_import("ENG", Mock(), AsyncMock(), [file], None)
        assert reads["n"] == 0

    @pytest.mark.asyncio
    async def test_an_active_restore_blocks_the_import(self, monkeypatch):
        # An overwrite restore deletes a space's pages; a page created
        # mid-restore would simply vanish.
        _stub_services(monkeypatch)
        blocked = AsyncMock(side_effect=ConflictError("restore running", code="restore_already_running"))
        monkeypatch.setattr(f"{MODULE}.assert_no_active_wikihub_restore", blocked)
        with pytest.raises(ConflictError):
            await create_document_import(
                "ENG", Mock(), AsyncMock(), [_upload("a.docx", _zip_bytes())], None
            )

    @pytest.mark.asyncio
    async def test_a_malformed_parent_id_is_a_bad_request(self, monkeypatch):
        _stub_services(monkeypatch)
        with pytest.raises(BadRequestError, match="parent page id"):
            await create_document_import(
                "ENG", Mock(), AsyncMock(), [_upload("a.docx", _zip_bytes())], "not-a-uuid"
            )

    @pytest.mark.asyncio
    async def test_a_parent_from_another_space_is_not_found(self, monkeypatch):
        _stub_services(monkeypatch)
        session = AsyncMock()
        foreign_parent = Mock()
        foreign_parent.space_id = uuid.uuid4()  # not this space
        session.get = AsyncMock(return_value=foreign_parent)
        with pytest.raises(NotFoundError, match="Parent page"):
            await create_document_import(
                "ENG", Mock(), session, [_upload("a.docx", _zip_bytes())], str(uuid.uuid4())
            )

    @pytest.mark.asyncio
    async def test_a_missing_parent_is_not_found(self, monkeypatch):
        _stub_services(monkeypatch)
        session = AsyncMock()
        session.get = AsyncMock(return_value=None)
        with pytest.raises(NotFoundError):
            await create_document_import(
                "ENG", Mock(), session, [_upload("a.docx", _zip_bytes())], str(uuid.uuid4())
            )


class TestReadAndCancel:
    @pytest.mark.asyncio
    async def test_an_unknown_job_is_not_found(self, monkeypatch):
        monkeypatch.setattr(f"{MODULE}.get_job_for_user", AsyncMock(return_value=None))
        with pytest.raises(NotFoundError):
            await get_document_import(uuid.uuid4(), Mock(), AsyncMock())

    @pytest.mark.asyncio
    async def test_another_users_job_is_not_found_rather_than_forbidden(self, monkeypatch):
        # `get_job_for_user` returns None for a job that is not yours; the
        # endpoint must not leak that the id exists.
        monkeypatch.setattr(f"{MODULE}.get_job_for_user", AsyncMock(return_value=None))
        with pytest.raises(NotFoundError):
            await cancel_document_import(uuid.uuid4(), Mock(), AsyncMock())

    @pytest.mark.asyncio
    async def test_cancelling_a_finished_job_is_a_conflict(self, monkeypatch):
        job = Mock()
        job.status = "complete"
        monkeypatch.setattr(f"{MODULE}.get_job_for_user", AsyncMock(return_value=job))
        with pytest.raises(ConflictError, match="already finished"):
            await cancel_document_import(uuid.uuid4(), Mock(), AsyncMock())

    @pytest.mark.asyncio
    async def test_cancelling_a_queued_job_finalises_it_immediately(self, monkeypatch):
        # Nothing has picked it up, so nothing would ever observe the flag.
        item = Mock()
        item.status = "queued"
        job = Mock()
        job.status, job.phase = "queued", "queued"
        job.items = [item]
        job.space_id = uuid.uuid4()
        monkeypatch.setattr(f"{MODULE}.get_job_for_user", AsyncMock(return_value=job))
        monkeypatch.setattr(f"{MODULE}.to_job_read", lambda j, *, space_key: {"ok": True})

        await cancel_document_import(uuid.uuid4(), Mock(), AsyncMock())

        assert job.cancel_requested is True
        assert job.status == "cancelled"
        assert item.status == "cancelled"

    @pytest.mark.asyncio
    async def test_cancelling_a_live_job_only_raises_the_flag(self, monkeypatch):
        # A live worker finalises the job itself, after it has actually stopped.
        job = Mock()
        job.status, job.phase = "running", "converting"
        job.items = []
        job.space_id = uuid.uuid4()
        monkeypatch.setattr(f"{MODULE}.get_job_for_user", AsyncMock(return_value=job))
        monkeypatch.setattr(f"{MODULE}.worker_is_gone", lambda _job: False)
        monkeypatch.setattr(f"{MODULE}.to_job_read", lambda j, *, space_key: {"ok": True})

        await cancel_document_import(uuid.uuid4(), Mock(), AsyncMock())

        assert job.cancel_requested is True
        assert job.status == "running"

    @pytest.mark.asyncio
    async def test_cancelling_an_orphaned_job_finalises_it(self, monkeypatch):
        # A stale heartbeat means the worker is gone; a Cancel click must not
        # be a no-op just because the row still says "running".
        job = Mock()
        job.status, job.phase = "running", "converting"
        job.items = []
        job.space_id = uuid.uuid4()
        monkeypatch.setattr(f"{MODULE}.get_job_for_user", AsyncMock(return_value=job))
        monkeypatch.setattr(f"{MODULE}.worker_is_gone", lambda _job: True)
        monkeypatch.setattr(f"{MODULE}.to_job_read", lambda j, *, space_key: {"ok": True})

        await cancel_document_import(uuid.uuid4(), Mock(), AsyncMock())

        assert job.status == "cancelled"
