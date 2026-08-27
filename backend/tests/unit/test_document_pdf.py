"""PDF extraction.

Fixtures are built with PyMuPDF itself rather than committed as binary blobs,
so what each test depends on - a font size, an image, a page count - is visible
in the test instead of hidden inside a file.
"""

from __future__ import annotations

import random
import struct
import zlib

import pytest

pymupdf = pytest.importorskip("pymupdf")

from app.core.exceptions import BadRequestError  # noqa: E402
from app.modules.document_import import convert  # noqa: E402
from app.modules.document_import.convert import (  # noqa: E402
    MEDIA_TOKEN_PREFIX,
    DocumentTooComplexError,
    extract_pdf,
)

#: PyMuPDF's built-in bold face; heading inference keys off boldness.
_BOLD = "hebo"


def _png(width: int, height: int, *, noisy: bool = True, seed: int = 7) -> bytes:
    """A real PNG. `noisy` controls whether it compresses down below the
    small-image floor, which is itself something worth testing."""
    random.seed(seed)
    rows = []
    for _ in range(height):
        row = b"\x00"
        for _ in range(width):
            if noisy:
                row += bytes(
                    (random.randrange(256), random.randrange(256), random.randrange(256))
                )
            else:
                row += b"\xc8\x1e\x1e"
        rows.append(row)

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(b"".join(rows)))
        + chunk(b"IEND", b"")
    )


def _write_pdf(tmp_path, build, *, name: str = "doc.pdf", metadata: dict | None = None):
    document = pymupdf.open()
    build(document)
    if metadata is not None:
        document.set_metadata(metadata)
    path = tmp_path / name
    document.save(str(path))
    document.close()
    return path


class TestHeadingInference:
    @pytest.mark.asyncio
    async def test_a_large_bold_line_becomes_h1_and_body_text_stays_a_paragraph(self, tmp_path):
        def build(document):
            page = document.new_page()
            page.insert_text((72, 90), "Quarterly Report", fontsize=24, fontname=_BOLD)
            page.insert_text((72, 130), "Ordinary body text of the report.", fontsize=10)

        result = await extract_pdf(_write_pdf(tmp_path, build))
        assert "<h1>Quarterly Report</h1>" in result.html
        assert "<p>Ordinary body text of the report.</p>" in result.html

    @pytest.mark.asyncio
    async def test_a_moderately_larger_line_becomes_h2(self, tmp_path):
        def build(document):
            page = document.new_page()
            page.insert_text((72, 90), "Section Two", fontsize=15, fontname=_BOLD)
            for offset in range(6):
                page.insert_text((72, 120 + offset * 14), "Body text line.", fontsize=10)

        result = await extract_pdf(_write_pdf(tmp_path, build))
        assert "<h2>Section Two</h2>" in result.html

    @pytest.mark.asyncio
    async def test_uniform_text_produces_no_headings_at_all(self, tmp_path):
        # Everything at the body size means nothing is a heading. Inventing one
        # would put a wrong title on the imported page.
        def build(document):
            page = document.new_page()
            for offset in range(8):
                page.insert_text((72, 90 + offset * 14), f"Line {offset}.", fontsize=11)

        result = await extract_pdf(_write_pdf(tmp_path, build))
        assert "<h1>" not in result.html and "<h2>" not in result.html
        # Consecutive lines at one size are one block, and so one paragraph -
        # that is what a paragraph *is* in a PDF, and re-splitting on the line
        # breaks would litter the imported page with one-line paragraphs.
        assert result.html.count("<p>") == 1
        for index in range(8):
            assert f"Line {index}." in result.html

    @pytest.mark.asyncio
    async def test_the_body_size_is_the_mode_not_the_mean(self, tmp_path):
        # A cover page set in 40pt must not drag the baseline up and leave the
        # real headings looking like body text.
        def build(document):
            cover = document.new_page()
            cover.insert_text((72, 200), "COVER", fontsize=40, fontname=_BOLD)
            page = document.new_page()
            page.insert_text((72, 90), "Real Heading", fontsize=18, fontname=_BOLD)
            for offset in range(20):
                page.insert_text((72, 120 + offset * 12), "Body copy line here.", fontsize=10)

        result = await extract_pdf(_write_pdf(tmp_path, build))
        assert "Real Heading" in result.html
        assert "<h" in result.html.split("Real Heading")[0][-8:]


class TestImageExtraction:
    @pytest.mark.asyncio
    async def test_images_and_text_keep_reading_order(self, tmp_path):
        def build(document):
            page = document.new_page()
            page.insert_text((72, 90), "Before the figure.", fontsize=10)
            page.insert_image(pymupdf.Rect(72, 120, 272, 320), stream=_png(60, 60))
            page.insert_text((72, 360), "After the figure.", fontsize=10)

        result = await extract_pdf(_write_pdf(tmp_path, build))
        assert len(result.media) == 1
        before = result.html.index("Before the figure")
        image = result.html.index(MEDIA_TOKEN_PREFIX)
        after = result.html.index("After the figure")
        assert before < image < after

    @pytest.mark.asyncio
    async def test_a_tiny_image_is_treated_as_decoration(self, tmp_path):
        def build(document):
            page = document.new_page()
            page.insert_text((72, 90), "Body.", fontsize=10)
            # 4x4 points on the page: a rule or a bullet, not content.
            page.insert_image(pymupdf.Rect(72, 120, 76, 124), stream=_png(40, 40))

        result = await extract_pdf(_write_pdf(tmp_path, build))
        assert result.media == []

    @pytest.mark.asyncio
    async def test_a_repeated_header_logo_is_emitted_once(self, tmp_path):
        logo = _png(50, 50, seed=3)

        def build(document):
            for _ in range(5):
                page = document.new_page()
                page.insert_image(pymupdf.Rect(72, 40, 172, 140), stream=logo)
                page.insert_text((72, 200), "Page body text.", fontsize=10)

        result = await extract_pdf(_write_pdf(tmp_path, build))
        assert len(result.media) == 1

    @pytest.mark.asyncio
    async def test_extracted_media_carries_a_usable_filename_and_type(self, tmp_path):
        def build(document):
            page = document.new_page()
            page.insert_image(pymupdf.Rect(72, 100, 272, 300), stream=_png(60, 60))
            page.insert_text((72, 340), "Body.", fontsize=10)

        result = await extract_pdf(_write_pdf(tmp_path, build))
        assert result.media[0].content_type.startswith("image/")
        assert result.media[0].filename.startswith("image-1.")
        assert result.media[0].data


class TestCeilingsAndDegradedInput:
    @pytest.mark.asyncio
    async def test_a_page_count_over_the_ceiling_is_refused(self, tmp_path, monkeypatch):
        monkeypatch.setattr(convert.settings, "document_import_max_pdf_pages", 3)

        def build(document):
            for index in range(5):
                document.new_page().insert_text((72, 90), f"Page {index}", fontsize=10)

        with pytest.raises(DocumentTooComplexError):
            await extract_pdf(_write_pdf(tmp_path, build))

    @pytest.mark.asyncio
    async def test_too_many_images_is_refused(self, tmp_path, monkeypatch):
        monkeypatch.setattr(convert.settings, "document_import_max_media_count", 2)

        def build(document):
            for index in range(4):
                page = document.new_page()
                page.insert_image(
                    pymupdf.Rect(72, 100, 272, 300), stream=_png(60, 60, seed=index)
                )

        with pytest.raises(DocumentTooComplexError):
            await extract_pdf(_write_pdf(tmp_path, build))

    @pytest.mark.asyncio
    async def test_oversized_images_are_refused(self, tmp_path, monkeypatch):
        monkeypatch.setattr(convert.settings, "document_import_max_media_bytes", 5_000)

        def build(document):
            for index in range(3):
                page = document.new_page()
                page.insert_image(
                    pymupdf.Rect(72, 100, 372, 400), stream=_png(90, 90, seed=index)
                )

        with pytest.raises(DocumentTooComplexError):
            await extract_pdf(_write_pdf(tmp_path, build))

    @pytest.mark.asyncio
    async def test_a_scanned_pdf_says_so_rather_than_failing(self, tmp_path):
        # No selectable text: the import is degraded, not broken, and the user
        # needs to be told why the page came out nearly empty.
        def build(document):
            page = document.new_page()
            page.insert_image(pymupdf.Rect(72, 72, 472, 472), stream=_png(80, 80))

        result = await extract_pdf(_write_pdf(tmp_path, build))
        assert result.warnings
        assert "scanned" in result.warnings[0].lower()

    @pytest.mark.asyncio
    async def test_a_file_that_is_not_a_pdf_is_a_bad_request(self, tmp_path):
        path = tmp_path / "not.pdf"
        path.write_bytes(b"this is plainly not a PDF")
        with pytest.raises(BadRequestError):
            await extract_pdf(path)

    @pytest.mark.asyncio
    async def test_an_encrypted_pdf_is_reported_as_password_protected(self, tmp_path):
        document = pymupdf.open()
        document.new_page().insert_text((72, 90), "secret", fontsize=10)
        path = tmp_path / "locked.pdf"
        document.save(
            str(path),
            encryption=pymupdf.PDF_ENCRYPT_AES_256,
            owner_pw="owner",
            user_pw="user",
        )
        document.close()
        with pytest.raises(BadRequestError):
            await extract_pdf(path)


class TestTextShaping:
    @pytest.mark.asyncio
    async def test_text_is_html_escaped(self, tmp_path):
        def build(document):
            page = document.new_page()
            page.insert_text((72, 90), "5 < 6 & 7 > 2", fontsize=10)

        result = await extract_pdf(_write_pdf(tmp_path, build))
        assert "&lt;" in result.html and "&amp;" in result.html
        assert "<p>5 < 6" not in result.html

    @pytest.mark.asyncio
    async def test_the_metadata_title_is_reported_when_present(self, tmp_path):
        def build(document):
            document.new_page().insert_text((72, 90), "Body.", fontsize=10)

        path = _write_pdf(tmp_path, build, metadata={"title": "Annual Review"})
        result = await extract_pdf(path)
        assert result.metadata_title == "Annual Review"

    @pytest.mark.asyncio
    async def test_a_blank_metadata_title_is_none_not_an_empty_string(self, tmp_path):
        def build(document):
            document.new_page().insert_text((72, 90), "Body.", fontsize=10)

        result = await extract_pdf(_write_pdf(tmp_path, build, metadata={"title": "   "}))
        assert result.metadata_title is None
