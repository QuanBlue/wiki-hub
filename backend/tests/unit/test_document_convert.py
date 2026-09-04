"""Document conversion: the pandoc argv, and the guards around what it writes.

The subprocess is patched the way `test_export_docx.py` patches it, so these
run offline and without pandoc installed. What they actually protect is the
argv (two flags whose presence would be SSRF, one whose absence would let raw
HTML through) and the media walk, which reads paths chosen by the document.
"""

from __future__ import annotations

import asyncio
import sys
import zipfile
from pathlib import Path
from unittest.mock import patch

import pytest
from bs4 import BeautifulSoup

from app.core.exceptions import BadRequestError, ServiceUnavailableError
from app.modules.document_import import convert
from app.modules.document_import.convert import (
    MEDIA_TOKEN_PREFIX,
    DocumentTooComplexError,
    build_pandoc_args,
    extract_document,
    extract_with_pandoc,
    format_for_filename,
    new_media_token,
    replace_media_tokens,
)
from app.modules.document_import.sanitize import sanitize_imported_html


class FakeProcess:
    """Stands in for the pandoc subprocess, writing whatever output we want."""

    def __init__(self, output_path: Path, html: str = "<p>ok</p>", returncode: int = 0):
        self._output_path = output_path
        self._html = html
        self.returncode = returncode

    async def communicate(self, _input: bytes | None = None) -> tuple[bytes, bytes]:
        if self.returncode == 0:
            self._output_path.parent.mkdir(parents=True, exist_ok=True)
            self._output_path.write_text(self._html, encoding="utf-8")
        return b"", b"pandoc said something" if self.returncode else b""


def _patch_pandoc(workdir: Path, *, html: str = "<p>ok</p>", returncode: int = 0):
    captured: dict[str, list[str]] = {}

    async def fake_exec(*args, **_kwargs):
        captured["argv"] = list(args)
        return FakeProcess(workdir / "converted.html", html=html, returncode=returncode)

    return patch.object(asyncio, "create_subprocess_exec", fake_exec), captured


class TestFormatDispatch:
    @pytest.mark.parametrize(
        ("filename", "expected"),
        [
            ("a.docx", "docx"),
            ("A.DOCX", "docx"),
            ("a.odt", "odt"),
            ("a.rtf", "rtf"),
            ("a.epub", "epub"),
            ("a.html", "html"),
            ("a.htm", "html"),
            ("a.md", "markdown"),
            ("a.markdown", "markdown"),
            ("a.pdf", "pdf"),
        ],
    )
    def test_known_extensions_map_to_a_format(self, filename, expected):
        assert format_for_filename(filename) == expected

    @pytest.mark.parametrize("filename", ["a.docm", "a.xlsm", "a.exe", "a.zip", "README"])
    def test_macro_and_unknown_containers_are_not_importable(self, filename):
        assert format_for_filename(filename) is None

    @pytest.mark.asyncio
    async def test_an_unsupported_file_is_rejected_before_any_subprocess(self, tmp_path):
        with pytest.raises(BadRequestError):
            await extract_document(tmp_path / "a.exe", filename="a.exe", workdir=tmp_path)


class TestPandocArgv:
    def test_docx_extracts_media(self, tmp_path):
        argv = build_pandoc_args(tmp_path / "a.docx", doc_format="docx", workdir=tmp_path)
        assert "--from=docx" in argv
        assert "--to=html" in argv
        assert "--wrap=none" in argv
        assert "--no-highlight" in argv
        assert f"--extract-media={tmp_path / 'media'}" in argv

    @pytest.mark.parametrize(
        ("doc_format", "reader"),
        [("html", "--from=html-raw_html"), ("markdown", "--from=markdown-raw_html")],
    )
    def test_text_formats_disable_raw_html_at_the_reader(self, tmp_path, doc_format, reader):
        # `markdown`, not `gfm`: verified against pandoc 3.5, `gfm-raw_html`
        # still emits `<script>` verbatim while `markdown-raw_html` escapes it.
        argv = build_pandoc_args(tmp_path / "a.in", doc_format=doc_format, workdir=tmp_path)
        assert reader in argv

    @pytest.mark.parametrize("doc_format", ["html", "markdown"])
    def test_text_formats_do_not_extract_media(self, tmp_path, doc_format):
        argv = build_pandoc_args(tmp_path / "a.in", doc_format=doc_format, workdir=tmp_path)
        assert not any(a.startswith("--extract-media") for a in argv)

    @pytest.mark.parametrize("doc_format", ["docx", "odt", "rtf", "epub", "html", "markdown"])
    def test_never_passes_a_flag_that_fetches_remote_resources(self, tmp_path, doc_format):
        # Both flags make pandoc resolve remote URLs, which turns an uploaded
        # .html file into server-side request forgery.
        argv = build_pandoc_args(tmp_path / "a.in", doc_format=doc_format, workdir=tmp_path)
        assert "--standalone" not in argv
        assert "-s" not in argv
        assert "--embed-resources" not in argv
        assert "--self-contained" not in argv

    def test_the_source_path_is_the_last_argument(self, tmp_path):
        source = tmp_path / "report.docx"
        argv = build_pandoc_args(source, doc_format="docx", workdir=tmp_path)
        assert argv[-1] == str(source)
        assert argv[-3] == "-o"


class TestDocxTableFormatting:
    def test_nested_tables_do_not_leak_rows_into_the_parent(self):
        soup = BeautifulSoup(
            "<table><tbody><tr><td>Outer<table><tr><td>Inner</td></tr></table>"
            "</td></tr></tbody></table>",
            "html.parser",
        )

        rows = convert._direct_html_table_rows(soup.table)

        assert len(rows) == 1
        assert "Outer" in rows[0].find("td", recursive=False).get_text(strip=True)

    def test_word_cell_shading_alignment_and_borders_are_carried_to_html(self, tmp_path):
        source = tmp_path / "styled.docx"
        document = """<?xml version="1.0" encoding="UTF-8"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body><w:tbl><w:tblGrid><w:gridCol w:w="4795"/><w:gridCol w:w="3961"/></w:tblGrid><w:tr><w:tc>
            <w:tcPr><w:shd w:fill="2F5496"/><w:vAlign w:val="center"/>
              <w:tcBorders><w:top w:color="000000"/></w:tcBorders></w:tcPr>
            <w:p><w:pPr><w:jc w:val="center"/></w:pPr>
              <w:r><w:rPr><w:color w:val="E7E6E6"/></w:rPr><w:t>Header</w:t></w:r>
            </w:p>
          </w:tc></w:tr></w:tbl></w:body>
        </w:document>"""
        with zipfile.ZipFile(source, "w") as archive:
            archive.writestr("word/document.xml", document)

        result = convert._enrich_docx_table_formatting(
            "<table><tr><td>Header</td></tr></table>", source
        )

        assert 'style="width: 100%"' in result
        assert 'width: 54.7624%' in result
        assert 'background-color: #2f5496' in result
        assert 'vertical-align: middle' in result
        assert 'border: 1px solid #000000' in result
        assert 'text-align: center' in result
        assert 'color: #e7e6e6' in result


class TestHtmlTableFormatting:
    @pytest.mark.asyncio
    async def test_large_html_reports_skip_style_enrichment_to_keep_content_storable(
        self, tmp_path
    ):
        source = tmp_path / "large-report.html"
        source.write_text(
            "x" * (convert.MAX_HTML_STYLE_ENRICHMENT_BYTES + 1),
            encoding="utf-8",
        )
        converted = "<table><tr><td>Report contents</td></tr></table>"
        patcher, _ = _patch_pandoc(tmp_path, html=converted)

        with patcher:
            result = await extract_with_pandoc(
                source, doc_format="html", workdir=tmp_path
            )

        assert result.html == converted

    @pytest.mark.asyncio
    async def test_css_selectors_are_inlined_before_the_html_is_stored(self, tmp_path):
        source = tmp_path / "report.html"
        source.write_text(
            """<style>
            table, th, td { border: 1px solid black; padding: .3em; }
            .severity-MEDIUM { background-color: #e9c60060; }
            .severity { background-color: #e9c600; color: #fafafa; font-weight: bold; }
            </style>
            <table><tr class="severity-MEDIUM"><th>Type</th><th class="severity">MEDIUM</th></tr>
            <tr><td>body</td><td>value</td></tr></table>""",
            encoding="utf-8",
        )
        patcher, _ = _patch_pandoc(
            tmp_path,
            html=(
                "<table><tr class=\"severity-MEDIUM\"><th>Type</th>"
                "<th class=\"severity\">MEDIUM</th></tr>"
                "<tr><td>body</td><td>value</td></tr></table>"
            ),
        )

        with patcher:
            result = await extract_with_pandoc(
                source, doc_format="html", workdir=tmp_path
            )

        assert "background-color: #e9c60060" in result.html
        assert "background-color: #e9c600" in result.html
        assert "color: #fafafa" in result.html
        assert "border: 1px solid black" in result.html
        assert result.html.count("background-color: #e9c60060") >= 2
        assert "<strong>MEDIUM</strong>" in result.html

    @pytest.mark.asyncio
    async def test_a_malformed_report_colspan_does_not_create_a_blank_column(self, tmp_path):
        source = tmp_path / "netshot.html"
        source.write_text(
            """<style>
            .group-header th { font-size: 200%; }
            .sub-header th { font-size: 150%; }
            </style><table>
            <tr class="group-header"><th colspan="6">kubernetes</th></tr>
            <tr class="sub-header"><th colspan="6">No vulnerabilities found</th></tr>
            <tr><th>Type</th><th>Misconf ID</th><th>Check</th><th>Severity</th><th>Message</th></tr>
            <tr><td>Check</td><td>KSV-0001</td><td>Detail</td><td>LOW</td><td>Message</td></tr>
            </table>""",
            encoding="utf-8",
        )
        # Pandoc materialises the phantom sixth slot as an empty cell. This is
        # the shape that previously reached Tiptap and rendered a blank column.
        patcher, _ = _patch_pandoc(
            tmp_path,
            html=(
                '<table><tr class="group-header"><th colspan="6">kubernetes</th></tr>'
                '<tr class="sub-header"><th colspan="6">No vulnerabilities found</th></tr>'
                '<tr><th>Type</th><th>Misconf ID</th><th>Check</th><th>Severity</th><th>Message</th><th></th></tr>'
                '<tr><td>Check</td><td>KSV-0001</td><td>Detail</td><td>LOW</td><td>Message</td><td></td></tr></table>'
            ),
        )

        with patcher:
            result = await extract_with_pandoc(
                source, doc_format="html", workdir=tmp_path
            )

        table = BeautifulSoup(result.html, "html.parser").table
        rows = convert._direct_html_table_rows(table)
        assert rows[0].th["colspan"] == "5"
        assert "font-size: 200%" in rows[0].th["style"]
        assert rows[1].th["colspan"] == "5"
        assert "font-size: 150%" in rows[1].th["style"]
        assert [
            len(row.find_all(["th", "td"], recursive=False)) for row in rows
        ] == [1, 1, 5, 5]

    @pytest.mark.asyncio
    async def test_html_block_and_list_formatting_is_preserved(self, tmp_path):
        source = tmp_path / "formatted.html"
        source.write_text(
            """<style>
            .summary { text-align: center; font-size: 125%; color: #123456; }
            .aligned-list { text-align: right; font-size: 90%; }
            </style>
            <p class="summary">Overview</p>
            <ol class="aligned-list"><li>First</li><li>Second</li></ol>""",
            encoding="utf-8",
        )
        patcher, _ = _patch_pandoc(
            tmp_path,
            html="<p>Overview</p><ol><li>First</li><li>Second</li></ol>",
        )

        with patcher:
            result = await extract_with_pandoc(
                source, doc_format="html", workdir=tmp_path
            )

        soup = BeautifulSoup(result.html, "html.parser")
        assert "text-align: center" in soup.p["style"]
        assert soup.p.span["style"] == "color: #123456; font-size: 125%"
        items = soup.ol.find_all("li", recursive=False)
        assert len(items) == 2
        assert all("text-align: right" in item["style"] for item in items)
        assert all(item.span["style"] == "font-size: 90%" for item in items)

        sanitized = BeautifulSoup(sanitize_imported_html(result.html), "html.parser")
        assert all(
            "text-align" in item["style"] and "right" in item["style"]
            for item in sanitized.ol.find_all("li", recursive=False)
        )

    @pytest.mark.asyncio
    async def test_google_font_import_without_a_semicolon_is_ignored(self, tmp_path):
        source = tmp_path / "dms4.html"
        source.write_text(
            """<style>
            @import url("https://fonts.googleapis.com/css?family=Open+Sans:300,400,700")
            p { text-align: center; }
            </style><p>DMS4 report</p>""",
            encoding="utf-8",
        )
        patcher, _ = _patch_pandoc(tmp_path, html="<p>DMS4 report</p>")

        with patcher:
            result = await extract_with_pandoc(
                source, doc_format="html", workdir=tmp_path
            )

        assert "DMS4 report" in result.html
        assert "text-align: center" in result.html


class TestPandocFailureModes:
    @pytest.mark.asyncio
    async def test_a_timeout_becomes_service_unavailable(self, tmp_path):
        async def hang(*_args, **_kwargs):
            raise TimeoutError

        patcher = patch.object(asyncio, "create_subprocess_exec", hang)
        with patcher, pytest.raises(ServiceUnavailableError):
            await extract_with_pandoc(tmp_path / "a.docx", doc_format="docx", workdir=tmp_path)

    @pytest.mark.asyncio
    async def test_a_missing_binary_becomes_service_unavailable(self, tmp_path):
        async def missing(*_args, **_kwargs):
            raise OSError("pandoc not found")

        patcher = patch.object(asyncio, "create_subprocess_exec", missing)
        with patcher, pytest.raises(ServiceUnavailableError):
            await extract_with_pandoc(tmp_path / "a.docx", doc_format="docx", workdir=tmp_path)

    @pytest.mark.asyncio
    async def test_a_nonzero_exit_blames_the_document_not_the_server(self, tmp_path):
        # A corrupt upload is the user's problem to fix, so it must not present
        # as a 503 that suggests retrying will help.
        patcher, _ = _patch_pandoc(tmp_path, returncode=1)
        with patcher, pytest.raises(BadRequestError):
            await extract_with_pandoc(
                tmp_path / "a.docx", doc_format="docx", workdir=tmp_path
            )


class TestMediaTraversalGuard:
    """`--extract-media` writes paths the document chose. None may escape."""

    @pytest.fixture
    def media_root(self, tmp_path):
        root = tmp_path / "media"
        root.mkdir()
        (root / "real.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"x" * 600)
        return root

    async def _convert(self, tmp_path, html):
        patcher, _ = _patch_pandoc(tmp_path, html=html)
        with patcher:
            return await extract_with_pandoc(
                tmp_path / "a.docx", doc_format="docx", workdir=tmp_path
            )

    @pytest.mark.asyncio
    async def test_a_legitimate_extracted_image_is_collected(self, tmp_path, media_root):
        result = await self._convert(tmp_path, '<p><img src="media/real.png"/></p>')
        assert len(result.media) == 1
        assert result.media[0].filename == "real.png"
        assert result.media[0].content_type == "image/png"
        assert MEDIA_TOKEN_PREFIX in result.html
        assert "media/real.png" not in result.html

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "src",
        [
            "../../../etc/passwd",
            "media/../../secret.txt",
            "/etc/passwd",
            "media/does-not-exist.png",
            "media%2F..%2F..%2Fsecret.txt",
        ],
    )
    async def test_a_path_outside_the_media_root_is_dropped(self, tmp_path, media_root, src):
        (tmp_path.parent / "secret.txt").write_bytes(b"secret")
        result = await self._convert(tmp_path, f'<p><img src="{src}"/></p>')
        assert result.media == []
        assert "<img" not in result.html

    @pytest.mark.asyncio
    @pytest.mark.skipif(sys.platform == "win32", reason="symlink creation needs privileges")
    async def test_a_symlink_inside_the_media_root_is_dropped(self, tmp_path, media_root):
        # The check must happen before resolve(): resolve() follows the link and
        # would report a path that genuinely is under the media root.
        outside = tmp_path.parent / "outside.png"
        outside.write_bytes(b"\x89PNG" + b"y" * 600)
        (media_root / "link.png").symlink_to(outside)
        result = await self._convert(tmp_path, '<p><img src="media/link.png"/></p>')
        assert result.media == []

    @pytest.mark.asyncio
    async def test_a_remote_image_is_kept_but_never_fetched(self, tmp_path, media_root):
        result = await self._convert(
            tmp_path, '<p><img src="https://example.com/x.png"/></p>'
        )
        assert result.media == []
        assert "https://example.com/x.png" in result.html

    @pytest.mark.asyncio
    async def test_a_data_uri_image_is_dropped(self, tmp_path, media_root):
        result = await self._convert(tmp_path, '<p><img src="data:image/png;base64,AAAA"/></p>')
        assert result.media == []
        assert "data:" not in result.html


class TestResourceCeilings:
    @pytest.mark.asyncio
    async def test_too_many_images_aborts_the_file(self, tmp_path, monkeypatch):
        monkeypatch.setattr(convert.settings, "document_import_max_media_count", 2)
        root = tmp_path / "media"
        root.mkdir()
        imgs = []
        for i in range(4):
            (root / f"i{i}.png").write_bytes(b"\x89PNG" + b"x" * 600)
            imgs.append(f'<p><img src="media/i{i}.png"/></p>')
        patcher, _ = _patch_pandoc(tmp_path, html="".join(imgs))
        with patcher, pytest.raises(DocumentTooComplexError):
            await extract_with_pandoc(
                tmp_path / "a.docx", doc_format="docx", workdir=tmp_path
            )

    @pytest.mark.asyncio
    async def test_oversized_media_aborts_the_file(self, tmp_path, monkeypatch):
        monkeypatch.setattr(convert.settings, "document_import_max_media_bytes", 1000)
        root = tmp_path / "media"
        root.mkdir()
        (root / "big.png").write_bytes(b"\x89PNG" + b"x" * 5000)
        patcher, _ = _patch_pandoc(tmp_path, html='<p><img src="media/big.png"/></p>')
        with patcher, pytest.raises(DocumentTooComplexError):
            await extract_with_pandoc(
                tmp_path / "a.docx", doc_format="docx", workdir=tmp_path
            )

    @pytest.mark.asyncio
    async def test_enormous_converted_html_is_refused_before_it_is_read(
        self, tmp_path, monkeypatch
    ):
        # A zip bomb converts to gigantic HTML; read_text() on it is the thing
        # that would take the worker down.
        monkeypatch.setattr(convert.settings, "document_import_max_media_bytes", 100)
        patcher, _ = _patch_pandoc(tmp_path, html="<p>" + "x" * 5000 + "</p>")
        with patcher, pytest.raises(DocumentTooComplexError):
            await extract_with_pandoc(
                tmp_path / "a.docx", doc_format="docx", workdir=tmp_path
            )


class TestMediaTokenReplacement:
    def test_a_token_becomes_its_attachment_url(self):
        token = new_media_token()
        html = f'<p><img src="{token}" alt="a"/></p>'
        result = replace_media_tokens(html, {token: "/api/v1/attachments/9/content"})
        assert '/api/v1/attachments/9/content' in result
        assert MEDIA_TOKEN_PREFIX not in result

    def test_an_unresolved_token_drops_the_image_and_its_empty_paragraph(self):
        token = new_media_token()
        result = replace_media_tokens(f'<p><img src="{token}"/></p><p>text</p>', {})
        assert "<img" not in result
        assert result == "<p>text</p>"

    def test_a_paragraph_with_other_content_survives_a_dropped_image(self):
        token = new_media_token()
        result = replace_media_tokens(f'<p>caption <img src="{token}"/></p>', {})
        assert "caption" in result

    def test_no_token_survives_anywhere_in_the_output(self):
        token = new_media_token()
        html = f'<p><img src="{token}"/></p><p>stray {token} in text</p>'
        result = replace_media_tokens(html, {token: "/api/v1/attachments/1/content"})
        assert MEDIA_TOKEN_PREFIX not in result

    def test_real_image_sources_are_untouched(self):
        html = '<p><img src="https://example.com/a.png"/></p>'
        assert replace_media_tokens(html, {}) == html

    def test_empty_input_is_returned_unchanged(self):
        assert replace_media_tokens("", {}) == ""
