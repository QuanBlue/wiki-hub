"""Reading the words out of attached files, whatever their type - or saying why not."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from app.modules.attachments import text as attachment_text


async def _read(tmp_path: Path, filename: str, data: bytes) -> attachment_text.Reading:
    source = tmp_path / ("source" + Path(filename).suffix)
    source.write_bytes(data)
    return await attachment_text.read_file(source, filename, tmp_path)


def test_only_documents_are_read() -> None:
    for name in ("a.docx", "b.XLSX", "c.pdf", "d.html", "e.csv", "f.txt", "g.md"):
        assert attachment_text.readable(name), name
    for name in ("photo.png", "clip.mp4", "macro.docm", "archive.zip"):
        assert not attachment_text.readable(name), name


def test_markup_keeps_only_the_words_in_order() -> None:
    markup, chars = attachment_text.to_markup(
        [("", "<h1>Plan</h1><p>Step <b>one</b></p><script>alert(1)</script><p>a &lt; b</p>")]
    )
    assert markup == "<h2>Plan</h2><p>Step one</p><p>a &lt; b</p>"
    assert chars == len("Plan") + len("Step one") + len("a < b")


async def test_a_text_file_is_read_by_paragraph(tmp_path: Path) -> None:
    reading = await _read(tmp_path, "notes.txt", "Hello <world>\n\nSecond".encode())
    assert reading.status == "ok"
    assert reading.content == "<p>Hello &lt;world&gt;</p><p>Second</p>"


async def test_a_spreadsheet_is_read_row_by_row(tmp_path: Path) -> None:
    reading = await _read(tmp_path, "seats.csv", b"product,price\nzircon,4200\n")
    assert reading.status == "ok"
    assert "zircon" in reading.content and "4200" in reading.content


@pytest.mark.skipif(shutil.which("pandoc") is None, reason="pandoc is not installed")
async def test_an_html_file_is_read(tmp_path: Path) -> None:
    reading = await _read(
        tmp_path, "page.html", b"<html><body><h2>Prices</h2><p>zircon 4200</p></body></html>"
    )
    assert reading.status == "ok"
    assert "<h2>Prices</h2>" in reading.content and "zircon 4200" in reading.content


async def test_pdfs_with_text_are_read_and_scanned_ones_marked(tmp_path: Path) -> None:
    pymupdf = pytest.importorskip("pymupdf")
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), "The zircon licence costs 4200.")
    reading = await _read(tmp_path, "prices.pdf", document.tobytes())
    assert reading.status == "ok" and "4200" in reading.content

    scan = pymupdf.open()
    page = scan.new_page()
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 40), False)
    pixmap.clear_with(200)
    page.insert_image(page.rect, pixmap=pixmap)
    reading = await _read(tmp_path, "scan.pdf", scan.tobytes())
    assert reading.status == "scanned" and reading.content == ""


async def test_a_broken_file_says_why(tmp_path: Path) -> None:
    reading = await _read(tmp_path, "broken.pdf", b"not a pdf")
    assert reading.status == "failed" and reading.detail
