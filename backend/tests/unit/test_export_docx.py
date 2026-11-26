"""HTML -> Word conversion: the pandoc subprocess invocation, the probed
theme flowing into pandoc's own skylighting theme, and the python-docx
post-pass that paints named styles with the page's real, probed colors."""

from __future__ import annotations

import asyncio
import io
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

import pytest
from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.oxml.ns import qn
from docx.oxml.parser import OxmlElement

from app.core.exceptions import ServiceUnavailableError
from app.modules.pages import export_docx
from app.modules.pages.export_docx import _build_highlight_theme, _parse_color, html_to_docx


def theme(**overrides: str) -> dict[str, str]:
    defaults = {
        "font_page": "Inter, sans-serif",
        "font_mono": "JetBrains Mono, monospace",
        "foreground": "rgb(23, 32, 51)",
        "primary": "rgb(33, 111, 192)",
        "border": "rgb(207, 215, 227)",
        "code_bg": "#282a3a",
        "code_fg": "#eaf2f1",
        "code_comment": "#9195ab",
        "code_keyword": "#ff657a",
        "code_string": "#ffd76d",
        "code_number": "#c39ac9",
        "code_function": "#9cd1bb",
        "code_type": "#ff657a",
        "code_variable": "#eaf2f1",
        "code_meta": "#ff9b5e",
        "callout_info_bg": "rgb(230, 240, 250)",
        "callout_info_border": "rgb(33, 111, 192)",
        "callout_warning_bg": "rgb(255, 244, 230)",
        "callout_warning_border": "rgb(230, 160, 40)",
        "callout_note_bg": "rgb(230, 250, 240)",
        "callout_note_border": "rgb(40, 170, 100)",
        "callout_panel_bg": "rgb(245, 245, 245)",
        "callout_panel_border": "rgb(207, 215, 227)",
        "table_header_bg": "rgb(240, 240, 240)",
    }
    defaults.update(overrides)
    return defaults


def mark_as_header_row(row: object) -> None:
    """Flag a row the same way pandoc's own docx writer flags a header row
    it produced from `<th>`/`<thead>` - `w:tblHeader` on `w:trPr`."""
    tr_pr = row._tr.get_or_add_trPr()  # type: ignore[attr-defined]
    header = OxmlElement("w:tblHeader")
    header.set(qn("w:val"), "on")
    tr_pr.append(header)


def fixture_docx_bytes(*, with_callout_style: bool = True) -> bytes:
    """A minimal docx standing in for what a real pandoc invocation would
    have written to the -o path - including the custom style pandoc's own
    writer auto-creates for a Lua-filter-assigned custom-style, when true."""
    document = Document()
    if with_callout_style:
        style = document.styles.add_style("WikiHub Callout Info", WD_STYLE_TYPE.PARAGRAPH)
        paragraph = document.add_paragraph("Heads up.")
        paragraph.style = style
    else:
        document.add_paragraph("Plain paragraph.")
    stream = io.BytesIO()
    document.save(stream)
    return stream.getvalue()


class FakeProcess:
    def __init__(self, returncode: int = 0, stderr: bytes = b"") -> None:
        self.returncode = returncode
        self.communicate = AsyncMock(return_value=(b"", stderr))


def patch_pandoc(*, output_bytes: bytes | None, returncode: int = 0, stderr: bytes = b""):
    """Patches asyncio.create_subprocess_exec so the call behaves like a real
    pandoc invocation: it "writes" output_bytes to the -o path it was given."""

    async def fake_create_subprocess_exec(*args: object, **_kwargs: object):
        if output_bytes is not None:
            idx = list(args).index("-o")
            Path(str(args[idx + 1])).write_bytes(output_bytes)  # noqa: ASYNC240 - test double
        return FakeProcess(returncode=returncode, stderr=stderr)

    return patch(
        "asyncio.create_subprocess_exec", side_effect=fake_create_subprocess_exec
    )


class TestParseColor:
    def test_parses_a_hex_string(self) -> None:
        assert _parse_color("#eaf2f1") == "eaf2f1"

    def test_parses_short_hex_and_named_colors(self) -> None:
        assert _parse_color("#abc") == "aabbcc"
        assert _parse_color("white") == "ffffff"
        assert _parse_color("Black") == "000000"

    def test_parses_an_rgb_string(self) -> None:
        assert _parse_color("rgb(23, 32, 51)") == "172033"

    def test_parses_an_rgba_string_ignoring_alpha(self) -> None:
        assert _parse_color("rgba(23, 32, 51, 0.5)") == "172033"

    def test_parses_an_oklab_string_with_and_without_alpha(self) -> None:
        assert _parse_color("oklab(0.5 -0.04 -0.08 / 0.3)") is not None
        assert _parse_color("oklab(0.5 0.04 0.11 / 30%)") is not None
        assert _parse_color("oklab(0.0 0.0 0.0)") == "000000"

    def test_returns_none_for_an_unparseable_value(self) -> None:
        assert _parse_color("currentcolor") is None

    def test_returns_none_for_empty_or_missing(self) -> None:
        assert _parse_color("") is None
        assert _parse_color(None) is None


class TestBuildHighlightTheme:
    def test_maps_every_known_token_and_falls_back_sensibly(self) -> None:
        result = _build_highlight_theme(theme())
        assert result["text-styles"]["Keyword"]["text-color"] == "#ff657a"
        assert result["text-styles"]["String"]["text-color"] == "#ffd76d"
        assert result["text-styles"]["Comment"]["italic"] is True
        assert result["text-styles"]["Keyword"]["italic"] is False
        assert result["background-color"] == "#282a3a"

    def test_falls_back_to_a_default_when_the_code_palette_is_missing(self) -> None:
        result = _build_highlight_theme({})
        assert result["text-color"] == "#eaf2f1"
        assert result["background-color"] == "#282a3a"
        assert result["text-styles"]["Keyword"]["text-color"] is None


class TestTableHeaderFormatting:
    """Pandoc marks a header row it produced from `<th>`/`<thead>` with
    `w:tblHeader` (so Word can repeat it on every printed page), but its own
    default "Table" style paints it exactly like every other row - a reader
    who just saw a bold, shaded header on screen gets a plain one in Word.
    """

    def _table_with_header(self) -> tuple[object, object]:
        document = Document()
        table = document.add_table(rows=2, cols=2)
        mark_as_header_row(table.rows[0])
        table.rows[0].cells[0].paragraphs[0].add_run("Name")
        table.rows[0].cells[1].paragraphs[0].add_run("Value")
        table.rows[1].cells[0].paragraphs[0].add_run("a")
        table.rows[1].cells[1].paragraphs[0].add_run("1")
        return document, table

    def test_bolds_and_shades_only_the_header_row(self) -> None:
        document, table = self._table_with_header()

        export_docx._apply_table_header_formatting(
            document, theme(table_header_bg="#eeeeee")
        )

        for cell in table.rows[0].cells:
            assert cell.paragraphs[0].runs[0].font.bold is True
            shd = cell._tc.tcPr.find(qn("w:shd"))
            assert shd is not None
            assert shd.get(qn("w:fill")) == "eeeeee"

        for cell in table.rows[1].cells:
            assert cell.paragraphs[0].runs[0].font.bold is not True
            assert cell._tc.tcPr is None or cell._tc.tcPr.find(qn("w:shd")) is None

    def test_falls_back_to_a_neutral_shade_with_no_theme_color(self) -> None:
        document, table = self._table_with_header()

        export_docx._apply_table_header_formatting(document, theme(table_header_bg=""))

        shd = table.rows[0].cells[0]._tc.tcPr.find(qn("w:shd"))
        assert shd.get(qn("w:fill")) == "f0f0f0"

    def test_a_table_with_no_header_row_is_left_untouched(self) -> None:
        document = Document()
        table = document.add_table(rows=1, cols=1)
        table.rows[0].cells[0].paragraphs[0].add_run("Plain")

        export_docx._apply_table_header_formatting(document, theme())

        cell = table.rows[0].cells[0]
        assert cell.paragraphs[0].runs[0].font.bold is not True
        assert cell._tc.tcPr is None or cell._tc.tcPr.find(qn("w:shd")) is None

    @pytest.mark.asyncio
    async def test_html_to_docx_shades_a_header_row_pandoc_marked(self) -> None:
        document, _table = self._table_with_header()
        stream = io.BytesIO()
        document.save(stream)

        with patch_pandoc(output_bytes=stream.getvalue()):
            result = await html_to_docx(
                "<table><thead><tr><th>Name</th><th>Value</th></tr></thead>"
                "<tbody><tr><td>a</td><td>1</td></tr></tbody></table>",
                theme(table_header_bg="#dddddd"),
                title="T",
            )

        saved = Document(io.BytesIO(result))
        header_cell = saved.tables[0].rows[0].cells[0]
        assert header_cell.paragraphs[0].runs[0].font.bold is True
        shd = header_cell._tc.tcPr.find(qn("w:shd"))
        assert shd.get(qn("w:fill")) == "dddddd"


class TestSetRunFonts:
    """``font.name`` on python-docx's high-level API only ever writes
    ``w:rFonts/@w:ascii`` - anything outside Basic Latin resolves from
    ``@w:eastAsia``/``@w:cs`` instead, which is what `_set_run_fonts` fixes up.
    """

    def test_creates_the_rfonts_element_when_the_run_has_none_yet(self) -> None:
        rpr = OxmlElement("w:rPr")
        assert rpr.find(qn("w:rFonts")) is None

        export_docx._set_run_fonts(rpr, "Inter")

        rfonts = rpr.find(qn("w:rFonts"))
        assert rfonts is not None
        for attribute in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
            assert rfonts.get(qn(attribute)) == "Inter"

    def test_reuses_an_existing_rfonts_element(self) -> None:
        rpr = OxmlElement("w:rPr")
        rfonts = OxmlElement("w:rFonts")
        rfonts.set(qn("w:asciiTheme"), "majorHAnsi")
        rpr.append(rfonts)

        export_docx._set_run_fonts(rpr, "Roboto Mono")

        assert len(rpr.findall(qn("w:rFonts"))) == 1
        assert rfonts.get(qn("w:ascii")) == "Roboto Mono"
        assert rfonts.get(qn("w:asciiTheme")) is None


class TestMaterializeDataUris:
    def test_extracts_base64_images_to_files_and_strips_data_anchor_hrefs(
        self, tmp_path: Path
    ) -> None:
        html = (
            '<p><img src="data:image/jpeg;base64,aGVsbG8=" alt="ok"/>'
            '<img src="data:image/png;base64,abc" alt="bad"/>'
            '<a href="data:application/pdf;base64,aGVsbG8=" download="a.pdf">a.pdf</a></p>'
        )
        out = export_docx._materialize_data_uris_for_pandoc(html, tmp_path)
        expected_file = tmp_path / "inline_asset_1.jpg"
        assert expected_file.exists()
        assert expected_file.read_bytes() == b"hello"
        assert str(expected_file) in out
        assert "data:image/png;base64,abc" in out
        assert "data:application/pdf" not in out


class TestNativeTocField:
    """Word has its own real, updatable Table of Contents field - the same
    one Word itself inserts via References > Table of Contents. Pandoc has
    no way to produce one from HTML input, so export_content.py leaves a
    plain-text marker paragraph instead, for this module to replace once
    Pandoc has produced the docx.
    """

    def test_replaces_the_marker_paragraph_with_a_toc_field(self) -> None:
        document = Document()
        document.add_paragraph(export_docx.WORD_TOC_FIELD_MARKER)

        assert export_docx._insert_native_toc_fields(document) is True

        paragraph = document.paragraphs[0]
        field_chars = [
            run._r.find(qn("w:fldChar"))
            for run in paragraph.runs
            if run._r.find(qn("w:fldChar")) is not None
        ]
        assert [fc.get(qn("w:fldCharType")) for fc in field_chars] == [
            "begin",
            "separate",
            "end",
        ]
        instr = paragraph._p.find(f".//{qn('w:instrText')}")
        assert instr is not None
        assert "TOC" in instr.text
        assert paragraph.text != export_docx.WORD_TOC_FIELD_MARKER

    def test_a_paragraph_that_only_contains_the_marker_as_part_of_more_text_is_left_alone(
        self,
    ) -> None:
        document = Document()
        document.add_paragraph(f"Not quite: {export_docx.WORD_TOC_FIELD_MARKER}")

        export_docx._insert_native_toc_fields(document)

        assert document.paragraphs[0].text == f"Not quite: {export_docx.WORD_TOC_FIELD_MARKER}"

    def test_a_document_with_no_marker_is_left_alone(self) -> None:
        document = Document()
        document.add_paragraph("Ordinary text.")

        # No TOC means no "update the fields?" prompt on open - see
        # `_auto_update_fields_on_open`, which html_to_docx only calls then.
        assert export_docx._insert_native_toc_fields(document) is False

        assert document.paragraphs[0].text == "Ordinary text."

    @pytest.mark.asyncio
    async def test_html_to_docx_turns_the_marker_into_a_real_field(self) -> None:
        fixture = Document()
        fixture.add_heading("Introduction", level=1)
        fixture.add_paragraph(export_docx.WORD_TOC_FIELD_MARKER)
        stream = io.BytesIO()
        fixture.save(stream)

        with patch_pandoc(output_bytes=stream.getvalue()):
            result = await html_to_docx(
                f"<h1>Introduction</h1><p>{export_docx.WORD_TOC_FIELD_MARKER}</p>",
                theme(),
                title="T",
            )

        saved = Document(io.BytesIO(result))
        toc_paragraph = next(
            p for p in saved.paragraphs if p._p.find(f".//{qn('w:fldChar')}") is not None
        )
        assert toc_paragraph.text != export_docx.WORD_TOC_FIELD_MARKER

    def test_sets_update_fields_on_open(self) -> None:
        document = Document()

        export_docx._auto_update_fields_on_open(document)

        update_fields = document.settings.element.find(qn("w:updateFields"))
        assert update_fields is not None
        assert update_fields.get(qn("w:val")) == "true"

    def test_is_idempotent(self) -> None:
        document = Document()

        export_docx._auto_update_fields_on_open(document)
        export_docx._auto_update_fields_on_open(document)

        assert len(document.settings.element.findall(qn("w:updateFields"))) == 1


@pytest.mark.asyncio
async def test_html_to_docx_invokes_pandoc_with_the_lua_filter_and_highlight_theme() -> None:
    captured_args: list[str] = []

    async def fake_create_subprocess_exec(*args: object, **_kwargs: object):
        captured_args.extend(str(a) for a in args)
        idx = captured_args.index("-o")
        Path(captured_args[idx + 1]).write_bytes(fixture_docx_bytes())  # noqa: ASYNC240
        return FakeProcess()

    with patch("asyncio.create_subprocess_exec", side_effect=fake_create_subprocess_exec):
        result = await html_to_docx("<p>Hello</p>", theme(), title="My Page")

    assert any(a.startswith("--lua-filter=") and a.endswith("wikihub.lua") for a in captured_args)
    assert any(a.startswith("--highlight-style=") for a in captured_args)
    assert "title=My Page" in captured_args
    assert result[:2] == b"PK"  # a .docx is a zip archive


@pytest.mark.asyncio
async def test_html_to_docx_paints_the_callout_style_pandoc_already_created() -> None:
    with patch_pandoc(output_bytes=fixture_docx_bytes(with_callout_style=True)):
        result = await html_to_docx("<div>ignored</div>", theme(), title="T")

    document = Document(io.BytesIO(result))
    paragraph = next(p for p in document.paragraphs if p.style.name == "WikiHub Callout Info")
    pPr = paragraph._p.get_or_add_pPr()
    shading = pPr.find("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}shd")
    assert shading is not None
    assert shading.get(
        "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}fill"
    ) == "e6f0fa"


@pytest.mark.asyncio
async def test_html_to_docx_creates_the_style_when_pandoc_did_not() -> None:
    with patch_pandoc(output_bytes=fixture_docx_bytes(with_callout_style=False)):
        result = await html_to_docx("<div>ignored</div>", theme(), title="T")

    document = Document(io.BytesIO(result))
    assert "WikiHub Callout Info" in [s.name for s in document.styles]
    assert "WikiHub Toggle Summary" in [s.name for s in document.styles]
    assert "WikiHub Toggle Body" in [s.name for s in document.styles]


@pytest.mark.asyncio
async def test_a_nonzero_pandoc_exit_raises_service_unavailable() -> None:
    with (
        patch_pandoc(output_bytes=None, returncode=1, stderr=b"pandoc: parse error"),
        pytest.raises(ServiceUnavailableError),
    ):
        await html_to_docx("<p>x</p>", theme(), title="T")


@pytest.mark.asyncio
async def test_pandoc_not_being_installed_raises_service_unavailable() -> None:
    with (
        patch("asyncio.create_subprocess_exec", side_effect=FileNotFoundError("no pandoc")),
        pytest.raises(ServiceUnavailableError),
    ):
        await html_to_docx("<p>x</p>", theme(), title="T")


@pytest.mark.asyncio
async def test_a_pandoc_timeout_raises_service_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(export_docx.settings, "export_render_timeout_seconds", 0)

    async def never_returns(*_args: object, **_kwargs: object) -> None:
        await asyncio.Event().wait()

    fake_process = Mock()
    fake_process.communicate = never_returns
    fake_process.returncode = 0

    async def fake_create_subprocess_exec(*_args: object, **_kwargs: object):
        return fake_process

    with (
        patch("asyncio.create_subprocess_exec", side_effect=fake_create_subprocess_exec),
        pytest.raises(ServiceUnavailableError),
    ):
        await html_to_docx("<p>x</p>", theme(), title="T")


class TestPageSetupAndProseHierarchy:
    def test_configure_page_setup_sets_a4_and_margins(self) -> None:
        document = Document()
        export_docx._configure_page_setup(document)
        section = document.sections[0]
        assert round(section.page_width.cm, 1) == 21.0
        assert round(section.page_height.cm, 1) == 29.7
        assert round(section.left_margin.cm, 1) == 2.0
        assert round(section.right_margin.cm, 1) == 2.0

    def test_style_prose_hierarchy_styles_title_headings_and_body(self) -> None:
        document = Document()
        document.styles["Heading 6"].delete()
        # First call replaces default pBdr; second call exercises replacement cleanly
        export_docx._style_prose_hierarchy(document, theme())
        export_docx._style_prose_hierarchy(document, theme())

        assert document.styles["Title"].font.bold is True
        assert document.styles["Heading 1"].font.bold is True
        assert document.styles["Heading 1"].paragraph_format.keep_with_next is True
        assert document.styles["Normal"].paragraph_format.line_spacing == 1.15


class TestInlineStyles:
    def test_annotates_aligned_paragraphs_and_colored_spans(self) -> None:
        html = (
            '<p style="text-align: center">Centered</p>'
            '<table><tr><td><p style="text-align: center">In cell</p></td></tr></table>'
            '<p><span style="color: #ff0000; background-color: #ffff00">Red</span>'
            "<mark>Marked</mark>"
            '<span style="font-weight: bold">Plain</span></p>'
        )
        out = export_docx._annotate_inline_styles_for_pandoc(html)
        assert 'custom-style="WH Align Center"' in out
        assert 'custom-style="WH Inline c=ff0000 b=ffff00"' in out
        assert 'custom-style="WH Inline b=fef08a"' in out
        # Paragraph inside <td> is not wrapped in WH Align div
        assert out.count('custom-style="WH Align Center"') == 1

    def test_apply_inline_custom_styles_paints_alignment_and_char_styles(self) -> None:
        document = Document()
        align_style = document.styles.add_style("WH Align Center", WD_STYLE_TYPE.PARAGRAPH)
        inline_style = document.styles.add_style(
            "WH Inline c=ff0000 b=ffff00", WD_STYLE_TYPE.CHARACTER
        )
        export_docx._apply_inline_custom_styles(document)

        assert align_style.paragraph_format.alignment == export_docx.WD_ALIGN_PARAGRAPH.CENTER
        assert str(inline_style.font.color.rgb) == "FF0000"
        shd = inline_style.element.rPr.find(qn("w:shd"))
        assert shd is not None
        assert shd.get(qn("w:fill")) == "ffff00"


class TestHtmlTableStyles:
    def test_extract_html_col_widths_handles_pct_px_colwidth_and_edge_cases(self) -> None:
        from bs4 import BeautifulSoup

        empty_tbl = BeautifulSoup("<table></table>", "html.parser").find("table")
        assert empty_tbl is not None
        assert export_docx._extract_html_col_widths(empty_tbl, 0) is None
        assert export_docx._extract_html_col_widths(empty_tbl, 2) is None

        pct_html = (
            "<table>"
            '<tr><th style="width: 20%">A</th><th style="width: 80%">B</th></tr>'
            '<tr><td><table><tr><td style="width: 50%">nested</td></tr></table></td>'
            "<td>x</td><td>overflow</td></tr>"
            "</table>"
        )
        pct_tbl = BeautifulSoup(pct_html, "html.parser").find("table")
        assert pct_tbl is not None
        pct_widths = export_docx._extract_html_col_widths(pct_tbl, 2)
        assert pct_widths is not None
        assert sum(pct_widths) == export_docx._CONTENT_WIDTH_TWIPS
        assert pct_widths[1] > pct_widths[0] * 3

        px_html = (
            "<table>"
            '<tr><td style="width: 100px">A</td><td colwidth="300">B</td></tr>'
            "</table>"
        )
        px_tbl = BeautifulSoup(px_html, "html.parser").find("table")
        assert px_tbl is not None
        px_widths = export_docx._extract_html_col_widths(px_tbl, 2)
        assert px_widths is not None
        assert sum(px_widths) == export_docx._CONTENT_WIDTH_TWIPS
        assert px_widths[1] > px_widths[0] * 2

    def test_apply_html_table_styles_preserves_colors_widths_padding_and_alignment(self) -> None:
        document = Document()
        table = document.add_table(rows=3, cols=2)
        table.rows[0].cells[0].paragraphs[0].add_run("Col A")
        table.rows[0].cells[1].paragraphs[0].add_run("Col B")
        table.rows[1].cells[0].paragraphs[0].add_run("Row 1A")
        table.rows[1].cells[1].paragraphs[0].add_run("Row 1B")
        table.rows[2].cells[0].paragraphs[0].add_run("Row 2A")
        table.rows[2].cells[1].paragraphs[0].add_run("Row 2B")

        # Mark row 2 col 0 as a vertical-merge continuation cell
        tc_pr = table.rows[2].cells[0]._tc.get_or_add_tcPr()
        tc_pr.append(OxmlElement("w:vMerge"))
        # Pre-seed existing jc, shd, vAlign, tblLayout, tblCellMar, tcW to cover replacement branches
        table.rows[0].cells[0].paragraphs[0]._p.get_or_add_pPr().append(OxmlElement("w:jc"))
        export_docx._set_tc_shading(table.rows[0].cells[0]._tc, "111111")
        export_docx._set_tc_valign(table.rows[0].cells[0]._tc, "top")
        export_docx._set_table_cell_margins(table)
        tbl_layout = OxmlElement("w:tblLayout")
        tbl_layout.set(qn("w:type"), "autofit")
        table._tbl.tblPr.append(tbl_layout)
        export_docx._set_tc_width(table.rows[0].cells[0]._tc, 1000)

        html = (
            "<table>"
            "<tr>"
            '<th style="width: 30%; background-color: #2f5496; color: #e7e6e6; '
            'text-align: center; vertical-align: middle">Col A</th>'
            '<th style="width: 70%">Col B</th>'
            "</tr>"
            '<tr><td rowspan="2">Row 1A</td><td style="text-align: right">Row 1B</td></tr>'
            '<tr><td style="background-color: #f9fafb">Row 2B</td></tr>'
            "</table>"
        )
        export_docx._apply_html_table_styles(document, html, theme(table_header_bg="#eeeeee"))

        # Custom header color wins over default header_bg
        shd0 = table.rows[0].cells[0]._tc.tcPr.find(qn("w:shd"))
        assert shd0.get(qn("w:fill")) == "2f5496"
        # Header without custom bg falls back to theme table_header_bg
        shd1 = table.rows[0].cells[1]._tc.tcPr.find(qn("w:shd"))
        assert shd1.get(qn("w:fill")) == "eeeeee"
        # Header text color preserved
        color_el = table.rows[0].cells[0].paragraphs[0].runs[0]._r.rPr.find(qn("w:color"))
        assert color_el.get(qn("w:val")) == "e7e6e6"
        # Row 2 col 1 got its custom bg despite row 2 col 0 being a vMerge continuation
        shd21 = table.rows[2].cells[1]._tc.tcPr.find(qn("w:shd"))
        assert shd21.get(qn("w:fill")) == "f9fafb"
        # Cell margins present
        assert table._tbl.tblPr.find(qn("w:tblCellMar")) is not None
        # _apply_table_header_formatting preserves existing custom shading
        mark_as_header_row(table.rows[0])
        export_docx._apply_table_header_formatting(document, theme(table_header_bg="#cccccc"))
        assert table.rows[0].cells[0]._tc.tcPr.find(qn("w:shd")).get(qn("w:fill")) == "2f5496"

    def test_is_vmerge_continuation_when_tcpr_is_none(self) -> None:
        tc = OxmlElement("w:tc")
        assert export_docx._is_vmerge_continuation(tc) is False

    def test_nested_tables_do_not_shift_top_level_table_styling_and_wide_cover_tables(self) -> None:
        document = Document()
        # Table 0: cover table (2 cols, row 0 spans both cols without bg, row 1 has blue bg + border)
        cover_tbl = document.add_table(rows=2, cols=2)
        cover_tbl.rows[0].cells[0].paragraphs[0].add_run("Cover Banner")
        cover_tbl.rows[1].cells[0].paragraphs[0].add_run("STT")
        cover_tbl.rows[1].cells[1].paragraphs[0].add_run("Desc")
        # Pre-seed tcBorders and spacing to cover replacement branches
        export_docx._set_tc_borders(cover_tbl.rows[1].cells[0]._tc, "111111")
        cover_tbl.rows[1].cells[0].paragraphs[0]._p.get_or_add_pPr().append(
            OxmlElement("w:spacing")
        )

        # Table 1: wide 7-column table with rowspan
        wide_tbl = document.add_table(rows=2, cols=7)
        for col_i in range(7):
            wide_tbl.rows[0].cells[col_i].paragraphs[0].add_run(f"H{col_i}")
            wide_tbl.rows[1].cells[col_i].paragraphs[0].add_run(f"V{col_i}")

        html = (
            "<table>"
            '<tr><th colspan="2"><table><tr><td>Nested</td></tr></table>Cover Banner</th></tr>'
            '<tr><td style="width: 20%; background-color: #2f5496; border: 1px solid #000000">STT</td>'
            '<td style="width: 80%; background-color: #2f5496; border: 1px solid invalid">Desc</td></tr>'
            "</table>"
            "<table>"
            "<tr>"
            '<th rowspan="2" style="width: 5%; background-color: #2f5496">H0</th>'
            '<th style="width: 15%; background-color: #2f5496">H1</th>'
            '<th style="width: 15%; background-color: #2f5496">H2</th>'
            '<th style="width: 15%; background-color: #2f5496">H3</th>'
            '<th style="width: 15%; background-color: #2f5496">H4</th>'
            '<th style="width: 15%; background-color: #2f5496">H5</th>'
            '<th style="width: 20%; background-color: #2f5496">H6</th>'
            "</tr>"
            "<tr>"
            '<td style="width: 15%">V1</td><td>V2</td><td>V3</td><td>V4</td><td>V5</td><td>V6</td>'
            "</tr>"
            "</table>"
        )
        export_docx._apply_html_table_styles(document, html, theme(table_header_bg="#eeeeee"))

        # Cover banner stays white (ffffff) instead of grey header_bg
        assert cover_tbl.rows[0].cells[0]._tc.tcPr.find(qn("w:shd")).get(qn("w:fill")) == "ffffff"
        mark_as_header_row(cover_tbl.rows[0])
        export_docx._apply_table_header_formatting(document, theme(table_header_bg="#cccccc"))
        assert cover_tbl.rows[0].cells[0].paragraphs[0].runs[0].font.bold is not True

        # Explicit cell border applied
        tc_bdr = cover_tbl.rows[1].cells[0]._tc.tcPr.find(qn("w:tcBorders"))
        assert tc_bdr is not None
        assert tc_bdr.find(qn("w:top")).get(qn("w:color")) == "000000"

        # Table 1 was NOT shifted by the nested table inside Table 0: all 7 headers get #2f5496
        for col_i in range(7):
            shd = wide_tbl.rows[0].cells[col_i]._tc.tcPr.find(qn("w:shd"))
            assert shd is not None and shd.get(qn("w:fill")) == "2f5496"
        # Wide table runs get 9pt (18 half-points)
        sz_el = wide_tbl.rows[0].cells[0].paragraphs[0].runs[0]._r.rPr.find(qn("w:sz"))
        assert sz_el is not None and sz_el.get(qn("w:val")) == "18"
        # Header cells without explicit vertical-align default to center
        va_el = wide_tbl.rows[0].cells[0]._tc.tcPr.find(qn("w:vAlign"))
        assert va_el is not None and va_el.get(qn("w:val")) == "center"

    def test_clean_pandoc_table_style_strips_first_row_border_and_valign(self) -> None:
        document = Document()
        tbl_style = document.styles.add_style("Table", WD_STYLE_TYPE.TABLE)
        first_row_pr = OxmlElement("w:tblStylePr")
        first_row_pr.set(qn("w:type"), "firstRow")
        tbl_style.element.append(first_row_pr)
        last_row_pr = OxmlElement("w:tblStylePr")
        last_row_pr.set(qn("w:type"), "lastRow")
        tbl_style.element.append(last_row_pr)

        export_docx._clean_pandoc_table_style(document)

        remaining = [
            el.get(qn("w:type")) for el in tbl_style.element.findall(qn("w:tblStylePr"))
        ]
        assert remaining == ["lastRow"]

    def test_applies_diverse_per_side_and_diagonal_borders_for_word(self) -> None:
        document = Document()
        tbl = document.add_table(rows=1, cols=2)
        tbl.rows[0].cells[0].text = "Styled"
        tbl.rows[0].cells[1].text = "Borderless"

        html = (
            "<table><tbody><tr>"
            '<td style="border-top: 3px double #216fc0; border-bottom: 2px dashed var(--danger); '
            'border-left: 0px solid transparent; border-right: 3px groove #334155" '
            'data-diagonal-down="2px solid #000000" data-diagonal-up="1px dotted #216fc0">Styled</td>'
            '<td style="border: 0px solid transparent">Borderless</td>'
            "</tr></tbody></table>"
        )
        export_docx._apply_html_table_styles(document, html, theme())

        styled_bdr = tbl.rows[0].cells[0]._tc.tcPr.find(qn("w:tcBorders"))
        assert styled_bdr is not None
        assert styled_bdr.find(qn("w:top")).get(qn("w:val")) == "double"
        assert styled_bdr.find(qn("w:top")).get(qn("w:sz")) == "18"
        assert styled_bdr.find(qn("w:top")).get(qn("w:color")) == "216fc0"
        assert styled_bdr.find(qn("w:bottom")).get(qn("w:val")) == "dashed"
        assert styled_bdr.find(qn("w:bottom")).get(qn("w:sz")) == "12"
        assert styled_bdr.find(qn("w:bottom")).get(qn("w:color")) == "dc2626"
        assert styled_bdr.find(qn("w:left")).get(qn("w:val")) == "nil"
        assert styled_bdr.find(qn("w:right")).get(qn("w:val")) == "threeDEngrave"
        assert styled_bdr.find(qn("w:tl2br")).get(qn("w:val")) == "single"
        assert styled_bdr.find(qn("w:tl2br")).get(qn("w:color")) == "000000"
        assert styled_bdr.find(qn("w:tr2bl")).get(qn("w:val")) == "dotted"
        assert styled_bdr.find(qn("w:tr2bl")).get(qn("w:color")) == "216fc0"

        none_bdr = tbl.rows[0].cells[1]._tc.tcPr.find(qn("w:tcBorders"))
        assert none_bdr is not None
        for edge in ("top", "left", "bottom", "right"):
            assert none_bdr.find(qn(f"w:{edge}")).get(qn("w:val")) == "nil"


class TestConstrainImageWidths:
    def test_scales_oversized_width_and_height_preserving_aspect_ratio(self) -> None:
        class FakeShape:
            def __init__(self, width: int, height: int) -> None:
                self.width = width
                self.height = height

        class FakeDoc:
            def __init__(self, shapes: list[FakeShape]) -> None:
                self.inline_shapes = shapes

        wide = FakeShape(int(export_docx.Cm(33.0)), int(export_docx.Cm(10.0)))
        tall = FakeShape(int(export_docx.Cm(10.0)), int(export_docx.Cm(46.0)))
        export_docx._constrain_image_widths(FakeDoc([wide, tall]))

        assert wide.width == int(export_docx.Cm(export_docx._MAX_IMAGE_WIDTH_CM))
        assert abs(wide.height - int(export_docx.Cm(5.0))) <= 5
        assert tall.height == int(export_docx.Cm(export_docx._MAX_IMAGE_HEIGHT_CM))
        assert abs(tall.width - int(export_docx.Cm(5.0))) <= 5
