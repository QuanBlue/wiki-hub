"""Edge branches of the PDF helpers in `document_import.convert`.

They are fed plain dicts and small stand-in objects shaped like PyMuPDF's own,
so every defensive branch (missing bbox, unreadable object, unusual span
layout) runs without needing a crafted PDF for each one."""

from __future__ import annotations

import sys
import types
from types import SimpleNamespace

from bs4 import BeautifulSoup

from app.modules.document_import import convert


def _rect(x0, y0, x1, y1):
    return SimpleNamespace(x0=x0, y0=y0, x1=x1, y1=y1, width=x1 - x0, height=y1 - y0)


def _span(text, *, size=10.0, font="Helvetica", color=0, bbox=None, flags=0):
    return {"text": text, "size": size, "font": font, "color": color, "bbox": bbox, "flags": flags}


def _line(*spans, bbox=(0, 0, 100, 10), direction=(1.0, 0.0)):
    return {"spans": list(spans), "bbox": bbox, "dir": direction}


class FakePage:
    def __init__(self, *, blocks=(), drawings=(), tables=None, rect=None, tables_error=None):
        self._blocks = list(blocks)
        self._drawings = list(drawings)
        self._tables = tables or []
        self._tables_error = tables_error
        self.rect = rect or _rect(0, 0, 600, 800)

    def get_text(self, _mode, clip=None):
        return {"blocks": self._blocks}

    def get_drawings(self):
        return self._drawings

    def find_tables(self, **_kwargs):
        if self._tables_error:
            raise self._tables_error
        return SimpleNamespace(tables=self._tables)


class TestPdfTables:
    def _table(self, *, rows, html, bbox=(0, 0, 100, 100), placements=None):
        return SimpleNamespace(
            extract=lambda: rows,
            to_html=lambda: html,
            bbox=bbox,
            rows=[SimpleNamespace(bbox=(0, 0, 100, 10))],
            placements=placements,
        )

    def test_a_failing_table_finder_yields_no_tables(self):
        assert convert._pdf_tables(FakePage(tables_error=RuntimeError("boom")), []) == []

    def test_empty_html_less_and_region_tables_are_discarded(self):
        good_html = "<table><tr><td>x</td></tr></table>"
        page = FakePage(
            tables=[
                self._table(rows=[], html=good_html),
                self._table(rows=[[" ", None]], html=good_html),
                self._table(rows=[["x"]], html="<div>nothing tabular</div>"),
                self._table(rows=[["x"]], html=good_html, bbox=(0, 0, 100, 100)),
                self._table(rows=[["kept"]], html=good_html, bbox=(300, 300, 400, 400)),
            ]
        )
        regions = [{"kind": "code", "rect": _rect(0, 0, 100, 100)}]

        tables = convert._pdf_tables(page, regions)

        assert [table["rect"] for table in tables] == [(300, 300, 400, 400)]

    def test_table_html_falls_back_to_the_stock_renderer(self, monkeypatch):
        page = FakePage()
        no_placements = self._table(rows=[["x"]], html="<table>stock</table>")
        assert convert._pdf_table_html(page, no_placements) == "<table>stock</table>"

        with_placements = self._table(
            rows=[["x"]], html="<table>stock</table>", placements=[[SimpleNamespace(bbox=None)]]
        )
        monkeypatch.setitem(sys.modules, "pymupdf.table", None)  # makes the import fail
        assert convert._pdf_table_html(page, with_placements) == "<table>stock</table>"

    def test_table_html_rereads_cell_text_and_skips_boxless_cells(self, monkeypatch):
        renderer = types.ModuleType("pymupdf.table")
        renderer.render_table_html = lambda placements, section_rows: "<table>rendered</table>"
        monkeypatch.setitem(sys.modules, "pymupdf.table", renderer)
        page = FakePage(blocks=[{"type": 1}, {"type": 0, "lines": [_line(_span("real"))]}])
        boxless = SimpleNamespace(bbox=None, text="original")
        boxed = SimpleNamespace(bbox=(0, 0, 10, 10), text="original")
        table = self._table(rows=[["x"]], html="", placements=[[boxless, boxed]])

        assert convert._pdf_table_html(page, table) == "<table>rendered</table>"
        assert boxless.text == "original"
        assert boxed.text == "real"

    def test_rect_overlap_with_regions(self):
        regions = [{"rect": _rect(0, 0, 50, 50)}]
        assert convert._pdf_rect_in_regions((0, 0, 50, 50), regions) is True
        assert convert._pdf_rect_in_regions((100, 100, 150, 150), regions) is False

    def test_header_paint_skips_unpainted_offpage_and_grey_fills(self):
        page = FakePage(
            drawings=[
                {"fill": None, "rect": _rect(0, 0, 100, 10)},
                {"fill": (1, 0, 0), "rect": _rect(0, 500, 100, 510)},  # below the header band
                {"fill": (0.5, 0.5, 0.5), "rect": _rect(0, 0, 100, 10)},  # grey: not a header
                {"fill": (1, 0, 0), "rect": _rect(0, 0, 100, 10)},
            ],
            blocks=[{"lines": [_line(_span("Head", color=0xFFFFFF, bbox=(5, 1, 50, 9)))]}],
        )

        background, text_color, header_bottom = convert._pdf_table_header_paint(
            page, (0, 0, 100, 100)
        )

        assert background == "background-color:#ff0000"
        assert text_color == "color:#ffffff"
        assert header_bottom == 10

    def test_no_painted_header_reports_the_top_edge(self):
        assert convert._pdf_table_header_paint(FakePage(), (0, 5, 100, 100)) == (None, None, 5)

    def test_band_text_colour_ignores_stray_spans(self):
        page = FakePage(
            blocks=[
                {
                    "lines": [
                        _line(
                            _span("   ", bbox=(0, 0, 5, 5)),
                            _span("nobox"),
                            _span("outside-y", bbox=(0, 90, 5, 99)),
                            _span("outside-x", bbox=(500, 0, 510, 9)),
                            _span("black", bbox=(1, 1, 20, 9)),
                        )
                    ]
                }
            ]
        )
        band = {"top": 0, "bottom": 10, "left": 0, "right": 100}
        assert convert._pdf_band_text_color(page, **band) is None  # plain black needs no override

        empty = FakePage(blocks=[{"lines": [_line(_span("x", bbox=(500, 500, 510, 509)))]}])
        assert convert._pdf_band_text_color(empty, **band) is None

        coloured = FakePage(
            blocks=[{"lines": [_line(_span("blue", color=0x0000FF, bbox=(1, 1, 20, 9)))]}]
        )
        assert convert._pdf_band_text_color(coloured, **band) == "color:#0000ff"

    def test_blocks_and_lines_outside_tables(self):
        image_block = {"type": 1}
        assert convert._pdf_block_outside_tables(image_block, []) is image_block
        assert convert._pdf_line_in_tables({"bbox": None}, [{"rect": (0, 0, 10, 10)}]) is False

    def test_rendering_and_measuring_html_without_a_table(self):
        assert (
            convert._render_pdf_table(
                "<p>x</p>",
                rows=[],
                background="background-color:#f00",
                text_color=None,
                header_bottom=0,
            )
            == "<p>x</p>"
        )
        assert convert._pdf_table_column_count("<p>x</p>") == 0
        assert convert._pdf_table_column_count("<table><tr><td colspan='x'>a</td></tr></table>") == 1
        assert convert._pdf_table_header_rows_html("<p>x</p>", [], 0) == []


class TestPdfTableContinuation:
    def _row(self, html):
        return BeautifulSoup(f"<table>{html}</table>", "html.parser").tr

    def test_header_rows_need_matching_cells(self):
        empty = self._row("<tr></tr>")
        assert convert._pdf_header_row_matches(empty, self._row("<tr></tr>")) is False
        assert convert._pdf_header_row_matches(
            self._row("<tr><th>Name</th></tr>"), self._row("<tr><th>Name (cont.)</th></tr>")
        )

    def test_a_mismatched_header_stops_the_merge(self):
        pending = [self._row("<tr><th>A</th></tr>")]
        merged = convert._merge_pdf_table_continuation(
            "<table><tr><th>A</th></tr></table>",
            "<table><tr><th>Z</th></tr><tr><td>1</td></tr></table>",
            pending,
            [SimpleNamespace(bbox=(0, 0, 10, 10)), SimpleNamespace(bbox=(0, 20, 10, 30))],
            15,
            strict_margins=False,
        )
        assert merged is None

    def test_a_pending_html_without_a_table_cannot_absorb_a_continuation(self):
        pending = [self._row("<tr><th>A</th></tr>")]
        merged = convert._merge_pdf_table_continuation(
            "<p>no table here</p>",
            "<table><tr><th>A</th></tr><tr><td>1</td></tr></table>",
            pending,
            [SimpleNamespace(bbox=(0, 0, 10, 10)), SimpleNamespace(bbox=(0, 20, 10, 30))],
            15,
            strict_margins=False,
        )
        assert merged is None

    def test_carried_rowspans_are_extended_or_replaced_by_placeholders(self):
        soup = BeautifulSoup(
            "<table>"
            "<tr><th rowspan='3'>STT</th><th>A</th><th rowspan='3'>Z</th></tr>"
            "<tr><td>B</td></tr>"
            "</table>"
            "<table><tr><td>x</td></tr></table>"
            "<table><tr></tr></table>",
            "html.parser",
        )
        dropped_table, pending, kept_table = soup.find_all("table")
        dropped = dropped_table.find_all("tr")
        kept = kept_table.find_all("tr")

        convert._pdf_table_carry_rowspans(pending, dropped, kept)

        # Column 0 extends the pending table's own last-row cell; column 2 has
        # no such cell, so the first kept row gets a placeholder for it.
        assert pending.find("td")["rowspan"] == "2"
        assert len(kept[0].find_all("td")) == 1
        assert convert._pdf_table_carry_rowspans(pending, [], kept) is None

    def test_font_styles_read_type3_descriptors_and_skip_unreadable_objects(self):
        objects = {
            1: RuntimeError("unreadable"),
            2: "<< /Type /Page >>",
            3: "<< /Type /Font /FontDescriptor 4 0 R >>",
            4: "<< /FontWeight 700 /ItalicAngle -12 /FontName /Foo-Italic /FontFamily (Mono) >>",
            5: "<< /Type /Font /FontDescriptor 9 0 R >>",
            6: "<< /Type /Font >>",
        }

        def xref_object(xref, compressed=False):
            value = objects.get(xref)
            if isinstance(value, Exception):
                raise value
            if value is None:
                raise ValueError("missing")
            return value

        document = SimpleNamespace(xref_length=lambda: 7, xref_object=xref_object)

        assert convert._pdf_font_styles(document) == {
            "Type3 (3 0 R)": {"bold": True, "italic": True, "code": True}
        }
