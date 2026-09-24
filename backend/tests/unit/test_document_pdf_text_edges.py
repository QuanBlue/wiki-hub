"""Edge branches of the PDF block/text helpers in `document_import.convert`."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

pymupdf = pytest.importorskip("pymupdf")

from app.modules.document_import import convert  # noqa: E402
from app.modules.document_import.convert import extract_pdf  # noqa: E402

_BOLD = "hebo"


def _span(text, *, size=10.0, font="Helvetica", color=0, bbox=None):
    return {"text": text, "size": size, "font": font, "color": color, "bbox": bbox, "flags": 0}


def _line(*spans, bbox=(0, 0, 100, 10), direction=(1.0, 0.0)):
    return {"spans": list(spans), "bbox": bbox, "dir": direction}


def _write_pdf(tmp_path, build):
    document = pymupdf.open()
    build(document)
    path = tmp_path / "doc.pdf"
    document.save(str(path))
    document.close()
    return path


def _body(page, start=200):
    for offset in range(8):
        page.insert_text((72, start + offset * 14), "Body text line.", fontsize=10)


class TestPdfDocumentFlow:
    async def test_prose_before_a_list_stays_a_paragraph_above_it(self, tmp_path):
        def build(document):
            page = document.new_page()
            page.insert_text((72, 90), "Intro sentence.", fontsize=10)
            page.insert_text((72, 104), "- First point", fontsize=10)
            page.insert_text((72, 118), "- Second point", fontsize=10)
            _body(page)

        html = (await extract_pdf(_write_pdf(tmp_path, build))).html

        assert html.index("<p>Intro sentence.</p>") < html.index("<li>First point</li>")

    async def test_text_glued_under_a_list_ends_it_and_keeps_its_own_block(self, tmp_path):
        def build(document):
            page = document.new_page()
            page.insert_text((72, 90), "- First point", fontsize=10)
            page.insert_text((72, 104), "- Second point", fontsize=10)
            page.insert_text((72, 118), "Closing remark.", fontsize=10)
            _body(page)

        html = (await extract_pdf(_write_pdf(tmp_path, build))).html

        assert html.index("<li>Second point</li>") < html.index("<p>Closing remark.</p>")

    async def test_a_heading_glued_under_a_list_keeps_its_level(self, tmp_path):
        def build(document):
            page = document.new_page()
            page.insert_text((72, 90), "- First point", fontsize=10)
            page.insert_text((72, 104), "- Second point", fontsize=10)
            page.insert_text((72, 122), "3 Next Section", fontsize=15, fontname=_BOLD)
            _body(page)

        html = (await extract_pdf(_write_pdf(tmp_path, build))).html

        assert "<h2><strong>3 Next Section</strong></h2>" in html

    async def test_an_unmarked_block_right_after_a_list_item_continues_it(self, tmp_path):
        def build(document):
            page = document.new_page()
            page.insert_text((90, 100), "- First point spans", fontsize=10)
            page.insert_text((108, 122), "onto a wrapped line", fontsize=10)
            _body(page, start=260)

        html = (await extract_pdf(_write_pdf(tmp_path, build))).html

        assert "<li>First point spans onto a wrapped line</li>" in html

    async def test_a_block_wholly_inside_a_table_is_not_repeated_as_a_paragraph(
        self, tmp_path, monkeypatch
    ):
        # Whole-block matching is what normally claims table text; with it
        # disabled the per-line pass must still drop every cell's own block
        # rather than repeating the table's text as stray paragraphs.
        monkeypatch.setattr(convert, "_pdf_table_for_block", lambda block, tables: None)

        def build(document):
            page = document.new_page()
            left, top, width, height = 72, 100, 300, 90
            for x in (left, left + 150, left + width):
                page.draw_line((x, top), (x, top + height))
            for y in (top, top + 45, top + height):
                page.draw_line((left, y), (left + width, y))
            page.insert_text((80, 120), "Code", fontsize=10, fontname=_BOLD)
            page.insert_text((230, 120), "Name", fontsize=10, fontname=_BOLD)
            page.insert_text((80, 165), "DMS", fontsize=10)
            page.insert_text((230, 165), "Distribution", fontsize=10)
            _body(page, start=260)

        html = (await extract_pdf(_write_pdf(tmp_path, build))).html

        assert "Distribution" not in html  # dropped, not re-emitted as a paragraph
        assert "Body text line." in html


class TestPdfBlockHelpers:
    def test_identical_fills_make_one_region(self):
        drawing = {"rect": pymupdf.Rect(0, 0, 300, 40), "fill": (0.1, 0.1, 0.1)}
        page = SimpleNamespace(get_drawings=lambda: [drawing, dict(drawing)])

        regions = convert._pdf_special_regions(page)

        assert [region["kind"] for region in regions] == ["code"]

    def test_region_and_marker_lookups_need_a_bbox(self):
        assert convert._pdf_region_for_block({"type": 0}, []) is None
        page = SimpleNamespace(get_drawings=lambda: [])
        assert convert._pdf_list_marker_level(page, {"type": 0}) is None

    def test_only_round_bullets_count_as_list_markers(self):
        def drawing(rect, items):
            return {"rect": rect, "fill": (0, 0, 0), "items": items}

        rect = SimpleNamespace(x0=60, y0=100, x1=64, y1=104, width=4, height=4)
        page = SimpleNamespace(get_drawings=lambda: [drawing(rect, [("l",)])])
        block = {"type": 0, "bbox": (72, 98, 200, 110)}
        assert convert._pdf_list_marker_level(page, block) is None

        page = SimpleNamespace(get_drawings=lambda: [drawing(rect, [("c",)])])
        assert convert._pdf_list_marker_level(page, block) == 0

    def test_same_baseline_fragments_merge_into_one_visual_line(self):
        block = {
            "lines": [
                _line(_span("-"), bbox=(72, 100, 80, 110)),
                _line(_span("Design notes"), bbox=(90, 101, 200, 111)),
                _line(_span("next"), bbox=(72, 130, 100, 140)),
            ]
        }

        lines = convert._pdf_visual_lines(block)

        assert [convert._pdf_line_text(line) for line in lines] == ["-Design notes", "next"]
        assert lines[0]["bbox"] == (72.0, 100.0, 200.0, 111.0)

    def test_watermark_lines_are_stripped_but_body_lines_survive(self):
        diagonal = _line(_span("SIGNED"), bbox=(0, 0, 500, 500), direction=(0.7, 0.7))
        body = _line(_span("real"), bbox=(72, 100, 120, 110))
        blocks = [
            {"type": 1},
            {"type": 0, "lines": [diagonal], "bbox": (0, 0, 500, 500)},
            {"type": 0, "lines": [body, diagonal], "bbox": (0, 0, 500, 500)},
            {"type": 0, "lines": [body], "bbox": (72, 100, 120, 110)},
        ]

        cleaned = convert._pdf_strip_watermark_lines(blocks)

        assert len(cleaned) == 3
        assert cleaned[1]["lines"] == [body]
        assert cleaned[1]["bbox"] == (72, 100, 120, 110)

    def test_list_parts_skip_blank_lines_and_split_off_trailing_text(self):
        block = {
            "lines": [
                _line(_span("   "), bbox=(72, 90, 100, 100)),
                _line(_span("- one"), bbox=(72, 110, 100, 120)),
                _line(_span("Trailing"), bbox=(72, 130, 100, 140)),
            ]
        }

        pre, _pre_lines, items, post, post_lines = convert._pdf_block_list_parts(
            block, 10.0, {}, []
        )

        assert pre is None
        assert [text for _level, text in items] == ["<p>one</p>"]
        assert post == "Trailing" and len(post_lines) == 1

    def test_page_number_and_continuation_guards(self):
        page = SimpleNamespace(rect=SimpleNamespace(height=800))
        no_bbox = {"lines": [_line(_span("5"))]}
        assert convert._pdf_is_page_number(page, no_bbox) is False
        assert convert._pdf_is_list_continuation({"type": 0, "bbox": (90, 0, 1, 1)}, None) is False
        items: list[tuple[int, str]] = []
        convert._append_pdf_list_continuation(items, "<p>x</p>")
        assert items == []

    def test_a_code_region_with_only_line_numbers_renders_nothing(self):
        region = {"kind": "code", "rect": pymupdf.Rect(0, 0, 300, 100)}
        blocks = [
            {
                "type": 0,
                "bbox": (5, 30, 20, 40),
                "lines": [
                    _line(_span("   "), bbox=(30, 30, 60, 40)),
                    _line(_span("1"), bbox=(5, 30, 20, 40)),
                ],
            }
        ]
        assert convert._render_pdf_region(blocks, region) is None

    def test_code_regions_rebuild_indentation_from_positions(self):
        region = {"kind": "code", "rect": pymupdf.Rect(0, 0, 300, 100)}
        blocks = [
            {
                "type": 0,
                "bbox": (10, 30, 200, 60),
                "lines": [
                    _line(_span("def f():", size=10), bbox=(10, 30, 80, 40)),
                    _line(_span("return 1", size=10), bbox=(22, 44, 90, 54)),
                ],
            }
        ]
        rendered = convert._render_pdf_region(blocks, region)
        assert rendered == "<pre><code>def f():\n  return 1</code></pre>"


class TestPdfImageAndTextHelpers:
    def test_images_without_data_or_size_are_skipped(self):
        media: list = []
        assert convert._pdf_image_block({}, media, set(), 5, image_decoder=None) == (None, 5)
        tiny = {"image": b"x" * 2000, "bbox": (0, 0, 2, 2)}
        assert convert._pdf_image_block(tiny, media, set(), 5, image_decoder=None) == (None, 5)
        light = {"image": b"x" * 10, "bbox": (0, 0, 100, 100)}
        assert convert._pdf_image_block(light, media, set(), 5, image_decoder=None) == (None, 5)

    def test_decorative_cards_are_dropped(self, monkeypatch):
        monkeypatch.setattr(convert, "_pdf_is_decorative_card", lambda data, decoder: True)
        card = {"image": b"x" * 2000, "bbox": (0, 0, 100, 90), "ext": "png"}
        assert convert._pdf_image_block(card, [], set(), 0, image_decoder=None) == (None, 0)

    def test_unreadable_or_empty_pixmaps_are_not_decorative(self):
        class Broken:
            def Pixmap(self, _data):  # noqa: N802
                raise ValueError("bad image")

        class Empty:
            def Pixmap(self, _data):  # noqa: N802
                return SimpleNamespace(samples=b"", n=3)

        assert convert._pdf_is_decorative_card(b"x", Broken()) is False
        assert convert._pdf_is_decorative_card(b"x", Empty()) is False

    def test_a_block_with_no_text_renders_nothing(self):
        assert convert._pdf_text_block({"lines": [_line(_span(""))]}, 10.0) is None

    def test_inline_html_keeps_code_runs_colour_and_merged_marks(self):
        block = {
            "lines": [
                _line(
                    _span("a", font="Courier"),
                    _span(" "),
                    _span("b", font="Courier"),
                    _span(""),
                    _span("x", color=0xFF0000),
                    _span("y", color=0xFF0000),
                )
            ]
        }

        rendered = convert._pdf_inline_html(block, 10.0)

        assert "<code>a b</code>" in rendered
        assert (
            '<span style="color:#ff0000">x</span><span style="color:#ff0000">y</span>' in rendered
        )

    def test_hyphenated_line_breaks_are_rejoined_and_empty_lines_ignored(self):
        block = {
            "lines": [
                _line(_span("exam-")),
                _line(_span("")),
                _line(_span("ple text")),
            ]
        }
        text, _size, _bold = convert._join_block_lines(block)
        assert text == "example text"

    def test_heading_detection_guards(self):
        assert convert._heading_level(12.0, True, 0) is None
        assert convert._lines_heading_level([{"spans": []}], 10.0, None) is None

    def test_font_size_sampling_stops_after_the_sample_pages(self, monkeypatch):
        monkeypatch.setattr(convert, "_PDF_FONT_SAMPLE_PAGES", 1)

        def page(size):
            blocks = [{"type": 0, "lines": [_line(_span("text", size=size))]}]
            return SimpleNamespace(get_text=lambda _mode, blocks=blocks: {"blocks": blocks})

        assert convert._modal_font_size([page(10.0), page(30.0), page(30.0)]) == 10.0
