"""The shared attachment gates.

These run for the interactive editor upload and for every image the document
importer pulls out of a Word or PDF file, so a hole here is a hole in both.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, Mock

import pytest

from app.core.exceptions import (
    BadRequestError,
    PayloadTooLargeError,
    UnsupportedMediaTypeError,
)
from app.modules.attachments.store import (
    attachment_content_url,
    attachment_extension_allowed,
    build_object_key,
    prepare_attachment,
    reject_svg,
    safe_attachment_filename,
    store_attachment,
)


def _effective(*, allowed: list[str] | None = None, max_bytes: int = 1000) -> Mock:
    effective = Mock()
    effective.allowed_attachment_types = ["*"] if allowed is None else allowed
    effective.max_upload_size_bytes = max_bytes
    effective.max_upload_size_mb = max(1, max_bytes // (1024 * 1024))
    return effective


def _page() -> Mock:
    page = Mock()
    page.id = uuid.uuid4()
    return page


class TestSafeAttachmentFilename:
    def test_keeps_a_plain_name(self):
        assert safe_attachment_filename("report.docx") == "report.docx"

    @pytest.mark.parametrize("value", ["", "   ", ".", "..", None])
    def test_rejects_names_that_are_not_names(self, value):
        with pytest.raises(BadRequestError):
            safe_attachment_filename(value)

    @pytest.mark.parametrize(
        "value",
        ["../../etc/passwd", "..\\..\\windows\\evil.png", "/absolute/evil.png"],
    )
    def test_strips_every_path_component(self, value):
        result = safe_attachment_filename(value)
        assert "/" not in result and "\\" not in result
        assert result in {"passwd", "evil.png"}

    def test_truncates_to_the_column_width(self):
        assert len(safe_attachment_filename("a" * 400 + ".png")) == 255


class TestExtensionAllowlist:
    def test_wildcard_allows_anything(self):
        assert attachment_extension_allowed("thing.xyz", ["*"])

    def test_matches_case_insensitively(self):
        assert attachment_extension_allowed("Photo.PNG", ["png"])

    def test_rejects_an_unlisted_extension(self):
        assert not attachment_extension_allowed("evil.exe", ["png", "pdf"])

    def test_rejects_a_file_with_no_extension(self):
        assert not attachment_extension_allowed("README", ["png"])


class TestSvgRejection:
    def test_rejects_by_content_type(self):
        with pytest.raises(UnsupportedMediaTypeError):
            reject_svg("logo.png", "image/svg+xml")

    def test_rejects_by_extension(self):
        with pytest.raises(UnsupportedMediaTypeError):
            reject_svg("logo.SVG", "image/png")

    def test_outranks_the_workspace_allowlist(self):
        # An operator who allows svg still must not get inline script execution.
        with pytest.raises(UnsupportedMediaTypeError):
            prepare_attachment(
                page=_page(),
                filename="logo.svg",
                data=b"<svg/>",
                content_type="image/svg+xml",
                effective=_effective(allowed=["svg"]),
            )


class TestPrepareAttachment:
    def test_builds_the_page_scoped_object_key(self):
        page = _page()
        attachment = prepare_attachment(
            page=page,
            filename="photo.png",
            data=b"x" * 10,
            content_type="image/PNG",
            effective=_effective(),
        )
        assert attachment.object_key == f"attachments/{page.id}/{attachment.id}/photo.png"
        assert attachment.page_id == page.id
        assert attachment.size_bytes == 10
        assert attachment.content_type == "image/png"

    def test_a_traversal_filename_cannot_escape_the_page_prefix(self):
        page = _page()
        attachment = prepare_attachment(
            page=page,
            filename="../../evil.png",
            data=b"x",
            content_type="image/png",
            effective=_effective(),
        )
        assert attachment.filename == "evil.png"
        assert attachment.object_key.startswith(f"attachments/{page.id}/")
        assert ".." not in attachment.object_key

    def test_rejects_an_empty_file(self):
        with pytest.raises(BadRequestError):
            prepare_attachment(
                page=_page(),
                filename="empty.png",
                data=b"",
                content_type="image/png",
                effective=_effective(),
            )

    def test_rejects_a_file_over_the_ceiling(self):
        with pytest.raises(PayloadTooLargeError):
            prepare_attachment(
                page=_page(),
                filename="big.png",
                data=b"x" * 1001,
                content_type="image/png",
                effective=_effective(max_bytes=1000),
            )

    def test_accepts_a_file_exactly_at_the_ceiling(self):
        attachment = prepare_attachment(
            page=_page(),
            filename="exact.png",
            data=b"x" * 1000,
            content_type="image/png",
            effective=_effective(max_bytes=1000),
        )
        assert attachment.size_bytes == 1000

    def test_rejects_a_type_outside_the_workspace_allowlist(self):
        with pytest.raises(UnsupportedMediaTypeError):
            prepare_attachment(
                page=_page(),
                filename="macro.exe",
                data=b"x",
                content_type="application/x-msdownload",
                effective=_effective(allowed=["png", "pdf"]),
            )

    def test_defaults_a_missing_content_type(self):
        attachment = prepare_attachment(
            page=_page(),
            filename="thing.bin",
            data=b"x",
            content_type="",
            effective=_effective(),
        )
        assert attachment.content_type == "application/octet-stream"


class TestStoreAttachment:
    @pytest.mark.asyncio
    async def test_persists_the_row_and_writes_the_blob(self):
        session, storage, page = AsyncMock(), AsyncMock(), _page()
        session.add = Mock()  # SQLAlchemy's add is synchronous
        attachment = await store_attachment(
            session,
            storage,
            page=page,
            filename="photo.png",
            data=b"bytes",
            content_type="image/png",
            effective=_effective(),
        )
        session.add.assert_called_once_with(attachment)
        storage.put.assert_awaited_once_with(
            attachment.object_key, b"bytes", content_type="image/png"
        )
        session.flush.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_a_rejected_file_never_reaches_storage(self):
        session, storage = AsyncMock(), AsyncMock()
        session.add = Mock()
        with pytest.raises(UnsupportedMediaTypeError):
            await store_attachment(
                session,
                storage,
                page=_page(),
                filename="evil.svg",
                data=b"<svg/>",
                content_type="image/svg+xml",
                effective=_effective(),
            )
        storage.put.assert_not_awaited()
        session.add.assert_not_called()


def test_content_url_is_the_authenticated_read_endpoint():
    attachment = Mock()
    attachment.id = uuid.UUID("11111111-2222-3333-4444-555555555555")
    assert attachment_content_url(attachment) == (
        "/api/v1/attachments/11111111-2222-3333-4444-555555555555/content"
    )


def test_object_key_shape_is_stable():
    page_id, attachment_id = uuid.uuid4(), uuid.uuid4()
    assert build_object_key(page_id, attachment_id, "a.png") == (
        f"attachments/{page_id}/{attachment_id}/a.png"
    )
