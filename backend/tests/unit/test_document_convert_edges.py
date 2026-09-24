"""Edge branches of `document_import.convert` that the main conversion tests
do not reach: malformed DOCX/HTML input, and defensive guards that keep an
optional fidelity pass from turning into a different import failure."""

from __future__ import annotations

import zipfile
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from bs4 import BeautifulSoup, NavigableString
from lxml import etree

from app.modules.document_import import convert

_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _xml(fragment: str):
    return etree.fromstring(f'<root xmlns:w="{_W}">{fragment}</root>')[0]


def _enrich(tmp_path: Path, document_xml: str, html: str) -> str:
    source = tmp_path / "styled.docx"
    with zipfile.ZipFile(source, "w") as archive:
        archive.writestr(
            "word/document.xml",
            f'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="{_W}">'
            f"<w:body>{document_xml}</w:body></w:document>",
        )
    return convert._enrich_docx_table_formatting(html, source)


class TestExtractDocumentDispatch:
    async def test_pdf_goes_to_the_pdf_extractor(self, monkeypatch, tmp_path):
        sentinel = object()
        extract_pdf = AsyncMock(return_value=sentinel)
        monkeypatch.setattr(convert, "extract_pdf", extract_pdf)
        source = tmp_path / "a.pdf"

        result = await convert.extract_document(source, filename="a.pdf", workdir=tmp_path)

        assert result is sentinel
        extract_pdf.assert_awaited_once_with(source)


class TestMediaTokens:
    def test_non_tag_nodes_from_the_soup_are_ignored(self, monkeypatch):
        real_find_all = BeautifulSoup.find_all

        def find_all(self, *args, **kwargs):
            return [NavigableString("stray"), *real_find_all(self, *args, **kwargs)]

        monkeypatch.setattr(BeautifulSoup, "find_all", find_all)
        token = convert.new_media_token()
        html = f'<p><img src="{token}"></p>'

        assert 'src="/a.png"' in convert.replace_media_tokens(html, {token: "/a.png"})


class TestDocxTableEdges:
    def test_single_paragraph_cell_carries_alignment_and_color_to_the_cell(self, tmp_path):
        document = (
            "<w:tbl><w:tblGrid><w:gridCol w:w='100'/></w:tblGrid><w:tr><w:tc>"
            "<w:p><w:pPr><w:jc w:val='right'/></w:pPr>"
            "<w:r><w:rPr><w:color w:val='FF0000'/></w:rPr><w:t>x</w:t></w:r></w:p>"
            "</w:tc></w:tr></w:tbl>"
        )

        result = _enrich(tmp_path, document, "<table><tr><td><p>x</p></td></tr></table>")

        cell = BeautifulSoup(result, "html.parser").td
        assert "text-align: right" in cell["style"]
        assert "color: #ff0000" in cell["style"]

    def test_non_numeric_grid_values_fall_back_to_safe_defaults(self):
        table = _xml("<w:tbl><w:tblGrid><w:gridCol w:w='wide'/><w:gridCol w:w='40'/></w:tblGrid></w:tbl>")
        assert convert._docx_table_column_widths(table) == [0, 40]

        cell = _xml("<w:tc><w:tcPr><w:gridSpan w:val='many'/></w:tcPr></w:tc>")
        assert convert._docx_cell_grid_span(cell) == 1

    def test_paragraph_color_needs_exactly_one_hex_color(self):
        mixed = _xml(
            "<w:p><w:r><w:rPr><w:color w:val='FF0000'/></w:rPr></w:r>"
            "<w:r><w:rPr><w:color w:val='00FF00'/></w:rPr></w:r></w:p>"
        )
        assert convert._docx_paragraph_color(mixed) is None

    def test_run_font_without_a_latin_face_is_unknown(self):
        run = _xml("<w:r><w:rPr><w:rFonts w:eastAsia='MS Mincho'/></w:rPr></w:r>")
        assert convert._docx_run_font(run) is None

    def test_rebuilding_a_paragraph_skips_runs_with_no_text(self):
        html_paragraph = BeautifulSoup("<p>old</p>", "html.parser").p
        docx_paragraph = _xml(
            "<w:p><w:r><w:rPr><w:b/></w:rPr></w:r><w:r><w:t>kept</w:t></w:r></w:p>"
        )

        convert._rebuild_paragraph_from_docx_runs(html_paragraph, docx_paragraph)

        assert [span.get_text() for span in html_paragraph.find_all("span")] == ["kept"]

    def test_an_empty_paragraph_is_not_wrapped_in_a_color_span(self):
        paragraph = BeautifulSoup("<p></p>", "html.parser").p
        convert._wrap_docx_paragraph_color(paragraph, "#ff0000")
        assert str(paragraph) == "<p></p>"


class TestMsoLists:
    def test_paragraph_without_a_marker_yields_an_empty_marker(self):
        paragraph = BeautifulSoup("<p>plain</p>", "html.parser").p
        assert convert._extract_mso_list_marker(paragraph) == ""

    def test_the_emptied_wrapper_around_a_marker_is_removed_too(self):
        paragraph = BeautifulSoup(
            '<p><span class="wrap"><span style="mso-list:Ignore">1.</span></span>item</p>',
            "html.parser",
        ).p

        assert convert._extract_mso_list_marker(paragraph) == "1."
        assert paragraph.find("span") is None
        assert paragraph.get_text() == "item"

    def test_consecutive_list_paragraphs_become_one_nested_list(self):
        soup = BeautifulSoup(
            '<p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">•</span>a</p>\n'
            '<p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">1.</span>b</p>',
            "html.parser",
        )

        convert._reconstruct_mso_lists(soup)

        # Same level, different list kind: the first list closes and a second
        # one opens beside it instead of nesting the ordered list inside.
        assert [tag.name for tag in soup.find_all(["ul", "ol"])] == ["ul", "ol"]

    def test_html_source_preparation_falls_back_to_the_original_when_unreadable(self, tmp_path):
        missing = tmp_path / "missing.html"
        assert convert._prepare_html_source_for_pandoc(missing, tmp_path) == missing

    def test_table_style_preservation_tolerates_an_unreadable_source(self, tmp_path):
        assert (
            convert._preserve_html_table_formatting(tmp_path / "missing.html", "<p>kept</p>")
            == "<p>kept</p>"
        )


class TestExtractDocumentPandocPath:
    async def test_other_formats_go_to_pandoc(self, monkeypatch, tmp_path):
        sentinel = object()
        extract = AsyncMock(return_value=sentinel)
        monkeypatch.setattr(convert, "extract_with_pandoc", extract)
        source = tmp_path / "a.docx"

        result = await convert.extract_document(source, filename="a.docx", workdir=tmp_path)

        assert result is sentinel
        extract.assert_awaited_once_with(source, doc_format="docx", workdir=tmp_path)


class TestHtmlTableGrid:
    def _tables(self, source: str, target: str):
        return (
            BeautifulSoup(source, "html.parser").table,
            BeautifulSoup(target, "html.parser").table,
        )

    def test_single_column_tables_are_left_alone(self):
        source, target = self._tables(
            "<table><tr><td colspan='4'>a</td></tr></table>",
            "<table><tr><td colspan='4'>a</td></tr></table>",
        )
        convert._repair_html_table_grid(source, target)
        assert target.td["colspan"] == "4"

    def test_an_oversized_span_is_trimmed_to_the_widest_real_row(self):
        source, target = self._tables(
            "<table><tr><td colspan='3'>h</td></tr><tr><td>a</td><td>b</td></tr></table>",
            "<table><tr><td colspan='3'>h</td></tr><tr><td>x</td><td colspan='3'>y</td></tr>"
            "<tr><td>p</td><td>q</td><td>overflow</td></tr></table>",
        )

        convert._repair_html_table_grid(source, target)

        rows = target.find_all("tr")
        assert rows[0].td["colspan"] == "2"
        # A span squeezed down to one column loses the attribute entirely.
        assert "colspan" not in rows[1].find_all("td")[1].attrs
        # A cell beyond the canonical width is dropped.
        assert [cell.get_text() for cell in rows[2].find_all("td")] == ["p", "q"]

    def test_a_non_numeric_span_counts_as_one(self):
        cell = BeautifulSoup("<td colspan='wide'>x</td>", "html.parser").td
        assert convert._table_cell_span(cell, "colspan") == 1


class TestSafeHtmlStyles:
    def test_unusable_rules_are_skipped_and_inline_styles_win(self):
        soup = BeautifulSoup(
            "<style>"
            "@import url('https://example.com/x.css');"
            "@font-face { font-family: Custom }"
            "p:nope( { color: blue }"
            "div, { color: green }"
            "span { position: fixed }"
            "p { color: red }"
            "</style>"
            '<p style="font-weight: bold">text</p>',
            "html.parser",
        )

        convert._apply_safe_html_styles(soup)

        style = soup.p["style"]
        assert "color: red" in style
        assert "font-weight: bold" in style

    def test_text_marks_are_added_once_and_only_when_missing(self):
        cell = BeautifulSoup(
            "<td style='font-style: italic; text-decoration: underline'>x</td>", "html.parser"
        ).td
        convert._apply_html_text_marks(cell)
        assert cell.find("em") is not None and cell.find("u") is not None

        bold = BeautifulSoup("<td style='font-weight: bold'><strong>x</strong></td>", "html.parser").td
        convert._apply_html_text_marks(bold)
        assert len(bold.find_all("strong")) == 1


class TestPandocMedia:
    def test_blank_and_data_sources_are_dropped_and_reported(self, tmp_path):
        document = convert._collect_pandoc_media(
            '<p><img src="  "><img src="data:image/png;base64,AAAA"><img src="https://x/y.png"></p>',
            workdir=tmp_path,
            doc_format="html",
        )

        assert "not uploaded" in document.warnings[0]
        assert document.media == []
        assert document.html.count("<img") == 1  # the remote one is kept, never fetched

    def test_non_tag_nodes_are_ignored(self, monkeypatch, tmp_path):
        real_find_all = BeautifulSoup.find_all
        monkeypatch.setattr(
            BeautifulSoup,
            "find_all",
            lambda self, *a, **k: [NavigableString("stray"), *real_find_all(self, *a, **k)],
        )
        document = convert._collect_pandoc_media("<p>text</p>", workdir=tmp_path, doc_format="docx")
        assert document.media == []

    def test_a_path_the_filesystem_rejects_is_not_a_media_file(self, tmp_path):
        assert (
            convert._resolve_media_path("a%00b", workdir=tmp_path, media_root=tmp_path / "media")
            is None
        )

    def test_unknown_image_extensions_are_generic_binary(self):
        assert convert._guess_image_type("scan.unknownext") == "application/octet-stream"
        assert convert._guess_image_type("scan.png") == "image/png"
