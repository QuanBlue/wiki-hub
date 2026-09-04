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
        assert "<h1>" in result.html and "<strong>Quarterly Report</strong>" in result.html
        assert "<p>Ordinary body text of the report.</p>" in result.html

    @pytest.mark.asyncio
    async def test_a_moderately_larger_line_becomes_h2(self, tmp_path):
        def build(document):
            page = document.new_page()
            page.insert_text((72, 90), "Section Two", fontsize=15, fontname=_BOLD)
            for offset in range(6):
                page.insert_text((72, 120 + offset * 14), "Body text line.", fontsize=10)

        result = await extract_pdf(_write_pdf(tmp_path, build))
        assert "<h2>" in result.html and "<strong>Section Two</strong>" in result.html

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
        assert "<h" in result.html and "<strong>Real Heading</strong>" in result.html

    @pytest.mark.asyncio
    async def test_a_heading_with_a_mid_title_hyphen_is_not_split_into_a_list(self, tmp_path):
        # A plain hyphen used as title punctuation ("Group Name - Telecom
        # Company") sits in the middle of one line, not at its start. The
        # bullet-marker fallback used to scan the *whole rendered heading* for
        # a stray hyphen and tear it into a leading paragraph plus a one-item
        # list.
        def build(document):
            page = document.new_page()
            page.insert_text((72, 90), "Group Name - Telecom Company", fontsize=18, fontname=_BOLD)
            for offset in range(6):
                page.insert_text((72, 130 + offset * 14), "Body text line.", fontsize=10)

        result = await extract_pdf(_write_pdf(tmp_path, build))
        assert "<h1><strong>Group Name - Telecom Company</strong></h1>" in result.html
        assert "<ul>" not in result.html

    @pytest.mark.asyncio
    async def test_a_heading_immediately_followed_by_its_own_list_keeps_its_level(self, tmp_path):
        # A numbered section heading with no blank line before its first
        # bullet lands in the same PDF block as the list. The heading must
        # not be demoted to plain body text just because the block's overall
        # bold ratio is diluted by the list's (non-bold) spans.
        def build(document):
            page = document.new_page()
            page.insert_text((72, 90), "2 Architecture", fontsize=15, fontname=_BOLD)
            page.insert_text((72, 104), "- First point", fontsize=10)
            page.insert_text((72, 118), "- Second point", fontsize=10)
            for offset in range(6):
                page.insert_text((72, 140 + offset * 14), "Body text line.", fontsize=10)

        result = await extract_pdf(_write_pdf(tmp_path, build))
        assert "<h2><strong>2 Architecture</strong></h2>" in result.html
        assert "<li>First point</li>" in result.html
        assert "<li>Second point</li>" in result.html

    @pytest.mark.asyncio
    async def test_a_drawn_underline_bar_becomes_a_u_tag(self, tmp_path):
        # A PDF underline is not a font attribute - PyMuPDF exposes no flag
        # for it - it is drawn as a thin filled bar sitting just under the
        # text's own bottom edge.
        def build(document):
            page = document.new_page()
            page.insert_text((72, 100), "Bat dau giao dich:", fontsize=13, fontname=_BOLD)
            page.draw_rect(pymupdf.Rect(72, 104.2, 184.7, 105.4), color=None, fill=(0, 0, 0))
            for offset in range(6):
                page.insert_text((72, 130 + offset * 14), "Body text line.", fontsize=10)

        result = await extract_pdf(_write_pdf(tmp_path, build))
        assert "<u>" in result.html
        assert "<u><strong>Bat dau giao dich:</strong></u>" in result.html or (
            "<strong><u>Bat dau giao dich:</u></strong>" in result.html
        )

    @pytest.mark.asyncio
    async def test_body_text_near_a_table_rule_is_not_mistaken_for_underlined(self, tmp_path):
        # A ruled table's own horizontal lines are the same shape a drawn
        # underline is - thin and wide - so a paragraph sitting just above or
        # below one must not come out underlined by coincidence.
        def build(document):
            page = document.new_page()
            page.insert_text((72, 90), "Plain paragraph text.", fontsize=10)
            left, top, width, height = 72, 110, 200, 60
            for x in (left, left + width):
                page.draw_line((x, top), (x, top + height))
            for y in (top, top + height):
                page.draw_line((left, y), (left + width, y))
            page.insert_text((80, 130), "Cell", fontsize=10)

        result = await extract_pdf(_write_pdf(tmp_path, build))
        assert "<u>" not in result.html

    def test_a_bolditalic_font_abbreviation_is_still_detected_as_italic(self):
        # A real export can spell the italic variant "...BoldItal" rather
        # than "...BoldItalic", and PyMuPDF's own italic bit is `1 << 1` -
        # `1 << 6`, checked before this fix, never matches any real span.
        style = convert._pdf_span_style(
            {"font": "TimesNewRomanPS-BoldItal", "flags": 22, "size": 13}, {}
        )
        assert style["bold"] is True
        assert style["italic"] is True

    @pytest.mark.asyncio
    async def test_consecutive_numbered_sentences_become_separate_paragraphs(self, tmp_path):
        # A numbered narrative ("(1) ... (2) ...") with no blank line between
        # its steps is one physical PDF block; flattening it to one <p> ran
        # every step into a single wall of text with no line breaks at all.
        def build(document):
            page = document.new_page()
            page.insert_text((72, 90), "(1) First step happens.", fontsize=10)
            page.insert_text((72, 104), "(2) Second step happens.", fontsize=10)
            page.insert_text((72, 118), "(3) Third step happens.", fontsize=10)

        result = await extract_pdf(_write_pdf(tmp_path, build))
        assert result.html == (
            "<p>(1) First step happens.</p>"
            "<p>(2) Second step happens.</p>"
            "<p>(3) Third step happens.</p>"
        )

    @pytest.mark.asyncio
    async def test_a_wrapped_numbered_sentence_stays_in_its_own_paragraph(self, tmp_path):
        # A step's own sentence can word-wrap onto a second physical line with
        # no "(N)" of its own - that continuation line must join the step
        # above it, not start a new, empty-looking paragraph.
        def build(document):
            page = document.new_page()
            page.insert_text((72, 90), "(1) First step continues", fontsize=10)
            page.insert_text((72, 104), "onto a second line.", fontsize=10)
            page.insert_text((72, 118), "(2) Second step happens.", fontsize=10)

        result = await extract_pdf(_write_pdf(tmp_path, build))
        assert result.html == (
            "<p>(1) First step continues onto a second line.</p>"
            "<p>(2) Second step happens.</p>"
        )

    @pytest.mark.asyncio
    async def test_a_lone_numbered_heading_is_not_treated_as_a_narrative(self, tmp_path):
        # A single "(1) ..." line is ordinary heading/paragraph text, not the
        # start of a numbered step-by-step narrative - only two or more such
        # lines in the same block are real evidence of one.
        def build(document):
            page = document.new_page()
            page.insert_text((72, 90), "(1) Appendix", fontsize=18, fontname=_BOLD)
            for offset in range(6):
                page.insert_text((72, 130 + offset * 14), "Body text line.", fontsize=10)

        result = await extract_pdf(_write_pdf(tmp_path, build))
        assert "<h1><strong>(1) Appendix</strong></h1>" in result.html


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


class TestTableExtraction:
    @pytest.mark.asyncio
    async def test_ruled_pdf_tables_remain_tables_with_a_header_row(self, tmp_path):
        def build(document):
            page = document.new_page()
            left, top, width, height = 72, 100, 300, 90
            for x in (left, left + 75, left + 180, left + width):
                page.draw_line((x, top), (x, top + height))
            for y in (top, top + 30, top + 60, top + height):
                page.draw_line((left, y), (left + width, y))
            for x, value in ((80, "Code"), (160, "Name"), (280, "Owner")):
                page.insert_text((x, 120), value, fontsize=10, fontname=_BOLD)
            for x, value in ((80, "DMS"), (160, "Distribution"), (280, "SPBL")):
                page.insert_text((x, 150), value, fontsize=10)

        result = await extract_pdf(_write_pdf(tmp_path, build))

        assert result.warnings == []
        assert "<table>" in result.html
        assert "<th>Code</th>" in result.html
        assert "<td>Distribution</td>" in result.html

    @pytest.mark.asyncio
    async def test_a_two_row_header_keeps_its_own_paint_and_real_text_color(self, tmp_path):
        # A numbered "DC"/"DR" sub-header painted the same color as the row
        # above it must be painted too, not treated as an ordinary data row -
        # and its text color must come from what the PDF actually painted
        # (here, black), never a hardcoded assumption of white-on-color.
        def build(document):
            page = document.new_page()
            left, top, width = 72, 100, 300
            page.draw_rect(
                pymupdf.Rect(left, top, left + width, top + 40), color=None, fill=(0.89, 0.94, 0.85)
            )
            for x in (left, left + 150, left + 225, left + width):
                page.draw_line((x, top), (x, top + 60))
            for y in (top, top + 20, top + 40, top + 60):
                page.draw_line((left, y), (left + width, y))
            page.insert_text((left + 5, top + 14), "STT", fontsize=10, fontname=_BOLD)
            page.insert_text((left + 155, top + 14), "Ten VM", fontsize=10, fontname=_BOLD)
            page.insert_text((left + 155, top + 34), "DC", fontsize=10, fontname=_BOLD)
            page.insert_text((left + 230, top + 34), "DR", fontsize=10, fontname=_BOLD)
            page.insert_text((left + 5, top + 54), "1", fontsize=10)
            page.insert_text((left + 155, top + 54), "srv-01", fontsize=10)

        result = await extract_pdf(_write_pdf(tmp_path, build))

        assert "color:#ffffff" not in result.html
        rows = result.html.split("<tr>")
        header_rows = [row for row in rows if "STT" in row or "DC" in row]
        assert len(header_rows) == 2
        assert all("background-color:#e3f0d9" in row for row in header_rows)
        data_row = next(row for row in rows if "srv-01" in row)
        assert "background-color" not in data_row

    @pytest.mark.asyncio
    async def test_a_table_split_by_a_page_break_merges_into_one_table(self, tmp_path):
        # PyMuPDF finds tables per page, so a table that runs off the bottom
        # of one page and picks back up at the top of the next comes back as
        # two separate tables - a repeated header row and a visible seam
        # between them - unless something stitches them into one.
        left, top, width = 72, 100, 240

        def draw_table(page, *, data_row):
            page.draw_rect(
                pymupdf.Rect(left, top, left + width, top + 20), color=None, fill=(0.89, 0.94, 0.85)
            )
            for x in (left, left + 80, left + 160, left + width):
                page.draw_line((x, top), (x, top + 40))
            for y in (top, top + 20, top + 40):
                page.draw_line((left, y), (left + width, y))
            for x, value in ((left + 5, "STT"), (left + 85, "Server"), (left + 165, "Note")):
                page.insert_text((x, top + 14), value, fontsize=10, fontname=_BOLD)
            for x, value in zip((left + 5, left + 85, left + 165), data_row):
                page.insert_text((x, top + 34), value, fontsize=10)

        def build(document):
            draw_table(document.new_page(), data_row=("1", "app-01", "First"))
            draw_table(document.new_page(), data_row=("2", "app-02", "Second"))

        result = await extract_pdf(_write_pdf(tmp_path, build))

        assert result.html.count("<table>") == 1
        assert result.html.count(">STT<") == 1
        assert "app-01" in result.html and "app-02" in result.html

    def test_a_header_cell_spanning_the_whole_page_extends_pendings_open_cell(self):
        # `to_html()` can give a leftmost column with no ruling inside one
        # page a rowspan covering every row it finds - header included, since
        # it is really a value carried over from the previous page's group.
        # Preferred fix: grow whichever cell in `pending_table` already
        # reaches its own last row in that column, so the merged table keeps
        # reading "6" all the way down instead of "6" then a blank gap.
        from bs4 import BeautifulSoup as _Soup

        pending_soup = _Soup(
            '<table><tr><td rowspan="2">6</td><td>Web</td></tr><tr><td>Mobile</td></tr></table>',
            "html.parser",
        )
        pending_table = pending_soup.find("table")
        new_soup = _Soup(
            "<table>"
            '<tr><th rowspan="4">STT</th><th>Server</th></tr>'
            "<tr><td>Nginx</td></tr>"
            "<tr><td>Auth</td></tr>"
            "</table>",
            "html.parser",
        )
        rows = new_soup.find("table").find_all("tr", recursive=False)
        dropped, kept = rows[:1], rows[1:]

        convert._pdf_table_carry_rowspans(pending_table, dropped, kept)

        # Nothing was inserted into the new rows - the carried span was
        # absorbed into pending's own open cell instead.
        assert len(kept[0].find_all(["th", "td"], recursive=False)) == 1
        assert kept[0].find_all(["th", "td"], recursive=False)[0].get_text(strip=True) == "Nginx"
        # The "6" cell (row 0, column 0) is the one whose rowspan already
        # reached pending's last row - it is the one that grows.
        open_cell = pending_table.find_all("tr", recursive=False)[0].find_all(
            ["th", "td"], recursive=False
        )[0]
        # 2 (pending's own span) + 3 (leftover past the dropped header rows).
        assert open_cell.get("rowspan") == "5"
        assert open_cell.get_text(strip=True) == "6"

    def test_a_header_cell_falls_back_to_a_blank_placeholder_with_no_open_cell(self):
        # A pending table with nothing open at all (it has no rows to check)
        # falls back to an empty placeholder of the right span, in the right
        # column - the previous, simpler behaviour.
        from bs4 import BeautifulSoup as _Soup

        pending_soup = _Soup("<table></table>", "html.parser")
        pending_table = pending_soup.find("table")
        new_soup = _Soup(
            "<table>"
            '<tr><th rowspan="4">STT</th><th>Server</th></tr>'
            "<tr><td>Nginx</td></tr>"
            "<tr><td>Auth</td></tr>"
            "</table>",
            "html.parser",
        )
        rows = new_soup.find("table").find_all("tr", recursive=False)
        dropped, kept = rows[:1], rows[1:]

        convert._pdf_table_carry_rowspans(pending_table, dropped, kept)

        first_kept_cells = kept[0].find_all(["th", "td"], recursive=False)
        assert len(first_kept_cells) == 2
        assert first_kept_cells[0].get("rowspan") == "3"
        assert first_kept_cells[0].get_text(strip=True) == ""
        assert first_kept_cells[1].get_text(strip=True) == "Nginx"
        # The row that needed nothing carried over is untouched.
        assert len(kept[1].find_all(["th", "td"], recursive=False)) == 1

    @pytest.mark.asyncio
    async def test_two_unrelated_same_width_tables_are_not_merged(self, tmp_path):
        # Sharing the page's body width is not proof of a continuation - most
        # tables in a plain, uncoloured report do that. Without a painted
        # header to compare, two genuinely different tables must stay separate
        # no matter how well their margins line up.
        left, top, width = 72, 100, 240

        def draw_table(page, *, header, data):
            for x in (left, left + 80, left + 160, left + width):
                page.draw_line((x, top), (x, top + 40))
            for y in (top, top + 20, top + 40):
                page.draw_line((left, y), (left + width, y))
            for x, value in zip((left + 5, left + 85, left + 165), header):
                page.insert_text((x, top + 14), value, fontsize=10, fontname=_BOLD)
            for x, value in zip((left + 5, left + 85, left + 165), data):
                page.insert_text((x, top + 34), value, fontsize=10)

        def build(document):
            draw_table(
                document.new_page(),
                header=("STT", "Server", "Note"),
                data=("1", "app-01", "First"),
            )
            draw_table(
                document.new_page(),
                header=("Code", "City", "Rank"),
                data=("A1", "Hanoi", "1"),
            )

        result = await extract_pdf(_write_pdf(tmp_path, build))

        assert result.html.count("<table>") == 2

    @pytest.mark.asyncio
    async def test_a_table_is_not_merged_with_the_next_page_once_other_content_follows_it(
        self, tmp_path
    ):
        # Only a table still sitting at the very end of its page is a
        # candidate to continue on the next one - one already followed by a
        # caption or a footnote has already ended, whatever the next page
        # happens to contain.
        left, top, width = 72, 100, 240

        def draw_table(page, *, data_row):
            page.draw_rect(
                pymupdf.Rect(left, top, left + width, top + 20), color=None, fill=(0.89, 0.94, 0.85)
            )
            for x in (left, left + 80, left + 160, left + width):
                page.draw_line((x, top), (x, top + 40))
            for y in (top, top + 20, top + 40):
                page.draw_line((left, y), (left + width, y))
            for x, value in ((left + 5, "STT"), (left + 85, "Server"), (left + 165, "Note")):
                page.insert_text((x, top + 14), value, fontsize=10, fontname=_BOLD)
            for x, value in zip((left + 5, left + 85, left + 165), data_row):
                page.insert_text((x, top + 34), value, fontsize=10)

        def build(document):
            page1 = document.new_page()
            draw_table(page1, data_row=("1", "app-01", "First"))
            page1.insert_text((left, top + 60), "Note: see appendix.", fontsize=10)
            draw_table(document.new_page(), data_row=("2", "app-02", "Second"))

        result = await extract_pdf(_write_pdf(tmp_path, build))

        assert result.html.count("<table>") == 2

    @pytest.mark.asyncio
    async def test_a_code_macros_own_border_is_not_mistaken_for_a_table(self, tmp_path):
        # A Confluence-exported code macro draws its own outer border plus a
        # divider under its language label - to `find_tables` that looks
        # exactly like a two-row, one-column table, and table detection runs
        # before the language's own code renderer gets a chance at the block.
        left, top, width, height = 72, 100, 300, 120

        def build(document):
            page = document.new_page()
            page.draw_rect(
                pymupdf.Rect(left, top, left + width, top + height),
                color=None,
                fill=(0.16, 0.16, 0.23),
            )
            for x in (left, left + width):
                page.draw_line((x, top), (x, top + height))
            for y in (top, top + 24, top + height):
                page.draw_line((left, y), (left + width, y))
            page.insert_text((left + width - 40, top + 16), "yml", fontsize=9, color=(1, 1, 1))
            page.insert_text((left + 10, top + 40), "1", fontsize=9, color=(0.5, 0.5, 0.5))
            page.insert_text((left + 40, top + 40), "FROM alpine", fontsize=9, color=(1, 1, 1))
            page.insert_text((left + 10, top + 56), "2", fontsize=9, color=(0.5, 0.5, 0.5))
            page.insert_text((left + 40, top + 56), "WORKDIR /app", fontsize=9, color=(1, 1, 1))

        result = await extract_pdf(_write_pdf(tmp_path, build))

        assert "<table>" not in result.html
        assert "<pre><code" in result.html
        assert "FROM alpine" in result.html
        assert "WORKDIR /app" in result.html
        # The line-number gutter is stripped, not kept as code content.
        assert ">1<" not in result.html and ">2<" not in result.html

    @pytest.mark.asyncio
    async def test_a_per_line_striped_code_block_is_still_one_code_region(self, tmp_path):
        # Some exporters paint one thin background bar per line - the same
        # look as an editor's line highlighting - rather than one rectangle
        # behind the whole snippet. Each bar alone is far too short to pass
        # the region-size floor; only merged together do they read as one
        # code block. The colour itself is a plain, hue-neutral dark gray,
        # not the specific navy `_pdf_special_regions` used to key off of.
        left, width, line_height = 72, 300, 14

        def build(document):
            page = document.new_page()
            top = 100.0
            for text in ("pipeline {", "    agent {", "        label 'x'", "    }", "}"):
                page.draw_rect(
                    pymupdf.Rect(left, top, left + width, top + line_height),
                    color=None,
                    fill=(0.118, 0.118, 0.118),
                )
                page.insert_text((left + 4, top + 10), text, fontsize=9, color=(1, 1, 1))
                top += line_height

        result = await extract_pdf(_write_pdf(tmp_path, build))

        assert "<table>" not in result.html
        assert result.html.count("<pre>") == 1
        assert "pipeline {" in result.html
        assert "agent {" in result.html

    @pytest.mark.asyncio
    async def test_a_code_blocks_indentation_survives_import(self, tmp_path):
        # A PDF has no literal indentation characters - a nested line is
        # simply text placed further right on the page. Flattening every
        # line to its bare text (as ordinary paragraph joining does, and as
        # the code renderer itself used to do) throws that position away and
        # every line comes out flush-left.
        left, top, width, height = 72, 100, 300, 60

        def build(document):
            page = document.new_page()
            page.draw_rect(
                pymupdf.Rect(left, top, left + width, top + height),
                color=None,
                fill=(0.1, 0.1, 0.1),
            )
            page.insert_text((left + 4, top + 12), "pipeline {", fontsize=9, color=(1, 1, 1))
            page.insert_text((left + 16, top + 26), "agent {", fontsize=9, color=(1, 1, 1))
            page.insert_text((left + 28, top + 40), "label 'x'", fontsize=9, color=(1, 1, 1))
            page.insert_text((left + 4, top + 54), "}", fontsize=9, color=(1, 1, 1))

        result = await extract_pdf(_write_pdf(tmp_path, build))

        code_start = result.html.index("<code>") + len("<code>")
        code_end = result.html.index("</code>")
        lines = result.html[code_start:code_end].split("\n")
        assert lines[0] == "pipeline {"
        assert lines[1].startswith("  ") and lines[1].strip() == "agent {"
        assert lines[2].startswith("   ") and len(lines[2]) - len(lines[2].lstrip()) > (
            len(lines[1]) - len(lines[1].lstrip())
        )
        assert lines[3] == "}"

    @pytest.mark.asyncio
    async def test_a_diagonal_watermark_does_not_blank_out_a_table_cell(self, tmp_path):
        # A faint, rotated "signed by .../tracking id" stamp some document
        # systems overlay across every page shares no bbox logic with
        # `find_tables()`'s own per-character cell-text pass - it can
        # interleave the watermark's characters into a cell's real text, or
        # crowd the real text out of the cell it crosses entirely.
        def build(document):
            page = document.new_page()
            left, top, width, height = 72, 100, 300, 90
            for x in (left, left + 75, left + 180, left + width):
                page.draw_line((x, top), (x, top + height))
            for y in (top, top + 30, top + 60, top + height):
                page.draw_line((left, y), (left + width, y))
            for x, value in ((80, "Code"), (160, "Name"), (280, "Owner")):
                page.insert_text((x, 120), value, fontsize=10, fontname=_BOLD)
            for x, value in ((80, "DMS"), (160, "Distribution"), (280, "SPBL")):
                page.insert_text((x, 150), value, fontsize=10)
            page.insert_text(
                (60, 200),
                "459973_Nguyen Thanh Quan_08:54 23/01/2026",
                fontsize=20,
                color=(0, 0, 0),
                fill_opacity=0.2,
                morph=(pymupdf.Point(60, 200), pymupdf.Matrix(35)),
            )

        result = await extract_pdf(_write_pdf(tmp_path, build))

        assert "<th>Code</th>" in result.html
        assert "<td>Distribution</td>" in result.html
        assert "459973" not in result.html

    @pytest.mark.asyncio
    async def test_a_diagonal_watermark_is_not_rendered_as_its_own_block(self, tmp_path):
        # Left in, a rotated watermark line's own bbox - the axis-aligned box
        # around a long diagonal string - sprawls across most of the page and
        # reads as a bogus, oversized paragraph of its own.
        def build(document):
            page = document.new_page()
            page.insert_text((72, 90), "Ordinary body text of the report.", fontsize=10)
            page.insert_text(
                (60, 400),
                "Pho Tong giam doc Nguyen Dat da ky",
                fontsize=20,
                color=(0, 0, 0),
                fill_opacity=0.2,
                morph=(pymupdf.Point(60, 400), pymupdf.Matrix(35)),
            )

        result = await extract_pdf(_write_pdf(tmp_path, build))

        assert result.html == "<p>Ordinary body text of the report.</p>"


class TestPdfBlocksAgainstTables:
    def test_a_line_fully_inside_a_table_is_dropped_from_its_stray_block(self):
        # A block that fails the whole-block 0.95 overlap test can still have
        # some of its *lines* sitting inside a table: PyMuPDF groups text into
        # one physical block by proximity, not by semantics, so a table's last
        # row - especially one missing the ruling line `find_tables` needs to
        # include it - routinely ends up fused with the caption or footnote
        # sitting right underneath it.
        tables = [{"rect": (60.0, 100.0, 300.0, 200.0)}]
        block = {
            "type": 0,
            "bbox": (60.0, 190.0, 300.0, 230.0),
            "lines": [
                {"bbox": (65.0, 190.0, 250.0, 200.0), "spans": [{"text": "duplicated row", "size": 10, "font": "Helvetica", "flags": 0, "color": 0}]},
                {"bbox": (60.0, 210.0, 280.0, 222.0), "spans": [{"text": "Note: see appendix.", "size": 10, "font": "Helvetica", "flags": 0, "color": 0}]},
            ],
        }

        trimmed = convert._pdf_block_outside_tables(block, tables)

        assert trimmed is not None
        assert len(trimmed["lines"]) == 1
        assert trimmed["lines"][0]["spans"][0]["text"] == "Note: see appendix."

    def test_a_block_entirely_inside_a_table_is_dropped_completely(self):
        tables = [{"rect": (60.0, 100.0, 300.0, 200.0)}]
        block = {
            "type": 0,
            "bbox": (65.0, 110.0, 250.0, 130.0),
            "lines": [
                {"bbox": (65.0, 110.0, 250.0, 130.0), "spans": [{"text": "already in the table", "size": 10, "font": "Helvetica", "flags": 0, "color": 0}]},
            ],
        }

        assert convert._pdf_block_outside_tables(block, tables) is None

    def test_a_block_untouched_by_any_table_passes_through_unchanged(self):
        block = {
            "type": 0,
            "bbox": (60.0, 300.0, 280.0, 312.0),
            "lines": [
                {"bbox": (60.0, 300.0, 280.0, 312.0), "spans": [{"text": "Ordinary paragraph.", "size": 10, "font": "Helvetica", "flags": 0, "color": 0}]},
            ],
        }

        assert convert._pdf_block_outside_tables(block, [{"rect": (60.0, 400.0, 300.0, 500.0)}]) is block


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
    def test_text_bullets_are_sibling_list_items(self):
        _leading, items = convert._pdf_text_list_parts(
            "<p>\u2022 First item \u2022 Second item</p>"
        )

        assert items == [(0, "<p>First item</p>"), (0, "<p>Second item</p>")]

    def test_pdf_lines_keep_bullet_boundaries_and_wrapped_continuations(self):
        block = {
            "lines": [
                {"bbox": (64, 100, 300, 112), "spans": [{"text": "Intro:", "size": 10, "font": "Helvetica", "flags": 0, "color": 0}]},
                {"bbox": (64, 116, 300, 128), "spans": [{"text": "\u2022 First item", "size": 10, "font": "Helvetica", "flags": 0, "color": 0}]},
                {"bbox": (80, 130, 300, 142), "spans": [{"text": "continued", "size": 10, "font": "Helvetica", "flags": 0, "color": 0}]},
                {"bbox": (64, 146, 300, 158), "spans": [{"text": "o Second item", "size": 10, "font": "Helvetica", "flags": 0, "color": 0}]},
            ]
        }

        pre, _pre_lines, items, post, _post_lines = convert._pdf_block_list_parts(
            block, 10, {}, []
        )

        assert pre == "Intro:"
        assert post is None
        assert items == [
            (0, "<p>First item continued</p>"),
            (0, "<p>Second item</p>"),
        ]

    def test_a_bold_bullet_line_keeps_its_bold_body(self):
        # The body used to be lifted from the plain regex match instead of
        # re-rendered from the line's own spans, so a bold or italic bullet
        # ("- **Section overview:**") lost its formatting entirely the moment
        # the marker was stripped off the front of it.
        block = {
            "lines": [
                {
                    "bbox": (64, 100, 300, 112),
                    "spans": [
                        {"text": "- ", "size": 10, "font": "Helvetica", "flags": 0, "color": 0},
                        {"text": "Section overview", "size": 10, "font": "Helvetica-Bold", "flags": 1 << 4, "color": 0},
                    ],
                },
            ]
        }

        _pre, _pre_lines, items, _post, _post_lines = convert._pdf_block_list_parts(
            block, 10, {}, []
        )

        assert items == [(0, "<p><strong>Section overview</strong></p>")]

    def test_pdf_list_renderer_never_skips_a_nesting_level(self):
        html = convert._render_pdf_list(
            [(0, "<p>Outer</p>"), (2, "<p>Nested</p>"), (0, "<p>Next</p>")]
        )

        assert html == "<ul><li>Outer<ul><li>Nested</li></ul></li><li>Next</li></ul>"

    @pytest.mark.asyncio
    async def test_a_nested_item_keeps_its_level_across_a_page_break(self, tmp_path):
        # A list's indentation state and its still-open items used to reset
        # every page, so a nested item continuing at the top of the next page
        # came out as a *sibling* of the item above it instead of its child -
        # exactly what a page break falling in the middle of a list does not
        # change about the list's own structure.
        def build(document):
            page1 = document.new_page()
            page1.insert_text((90, 100), "- Top level item", fontsize=10)
            page2 = document.new_page()
            page2.insert_text((126, 90), "o Nested item", fontsize=10)

        result = await extract_pdf(_write_pdf(tmp_path, build))
        assert result.html == "<ul><li>Top level item<ul><li>Nested item</li></ul></li></ul>"

    def test_indent_levels_agree_across_separate_pdf_blocks(self):
        # A dash-level item and its "o"-level children routinely land in
        # *different* PDF blocks - one per group of same-margin lines - even
        # though they are one logical list. Judging each block's indentation
        # in isolation would restart the nesting count from zero every call,
        # flattening "-" and "o" onto the same level.
        indent_positions: list[float] = []
        dash_block = {
            "lines": [
                {"bbox": (90, 100, 300, 112), "spans": [{"text": "- Design:", "size": 10, "font": "Helvetica", "flags": 0, "color": 0}]},
            ]
        }
        o_block = {
            "lines": [
                {"bbox": (126, 116, 300, 128), "spans": [{"text": "o Redundant", "size": 10, "font": "Helvetica", "flags": 0, "color": 0}]},
                {"bbox": (126, 130, 300, 142), "spans": [{"text": "o Scalable", "size": 10, "font": "Helvetica", "flags": 0, "color": 0}]},
            ]
        }

        _pre, _pre_lines, dash_items, _post, _post_lines = convert._pdf_block_list_parts(
            dash_block, 10, {}, indent_positions
        )
        _pre, _pre_lines, o_items, _post, _post_lines = convert._pdf_block_list_parts(
            o_block, 10, {}, indent_positions
        )

        assert dash_items == [(0, "<p>Design:</p>")]
        assert o_items == [(1, "<p>Redundant</p>"), (1, "<p>Scalable</p>")]

    @pytest.mark.asyncio
    async def test_a_wrapped_list_item_reunites_with_its_sentence_across_a_block_split(
        self, tmp_path
    ):
        # A list item's wrapped continuation line, and the next couple of
        # bullets, can land in a PDF block of their own - separate from the
        # item the continuation belongs to. It must still rejoin that item
        # instead of standing alone as a leading paragraph in front of the
        # bullets that follow it.
        def build(document):
            page = document.new_page()
            page.insert_text((72, 90), "2 Architecture", fontsize=15, fontname=_BOLD)
            page.insert_text((90, 104), "- First point spans", fontsize=10)
            page.insert_text((108, 118), "onto a wrapped line", fontsize=10)
            page.insert_text((90, 132), "- Second point", fontsize=10)
            page.insert_text((90, 146), "- Third point", fontsize=10)
            for offset in range(6):
                page.insert_text((72, 170 + offset * 14), "Body text line.", fontsize=10)

        result = await extract_pdf(_write_pdf(tmp_path, build))
        assert "<li>First point spans onto a wrapped line</li>" in result.html
        assert "<li>Second point</li>" in result.html
        assert "<li>Third point</li>" in result.html

    @pytest.mark.asyncio
    async def test_footer_page_numbers_are_not_imported(self, tmp_path):
        def build(document):
            page = document.new_page()
            page.insert_text((72, 120), "Section 9", fontsize=11)
            page.insert_text((450, 800), "9", fontsize=9)

        result = await extract_pdf(_write_pdf(tmp_path, build))

        assert "Section 9" in result.html
        assert ">9</p>" not in result.html

    @pytest.mark.asyncio
    async def test_exported_code_blocks_and_callouts_keep_their_structure(self, tmp_path):
        def build(document):
            page = document.new_page()
            page.draw_rect(
                pymupdf.Rect(72, 120, 500, 260), color=None, fill=(0.16, 0.16, 0.23)
            )
            page.insert_text((440, 140), "yml", fontsize=8)
            page.insert_text((82, 170), "1", fontsize=8)
            page.insert_text((110, 170), "name: wikihub", fontsize=8, fontname="cour")
            page.draw_rect(
                pymupdf.Rect(72, 300, 500, 350), color=None, fill=(0.99, 0.60, 0.0)
            )
            page.insert_text((100, 330), "Important note", fontsize=10)

        result = await extract_pdf(_write_pdf(tmp_path, build))

        assert '<pre><code class="language-yml">name: wikihub</code></pre>' in result.html
        assert 'data-type="callout"' in result.html

    @pytest.mark.asyncio
    async def test_text_is_html_escaped(self, tmp_path):
        def build(document):
            page = document.new_page()
            page.insert_text((72, 90), "5 < 6 & 7 > 2", fontsize=10)

        result = await extract_pdf(_write_pdf(tmp_path, build))
        assert "&lt;" in result.html and "&amp;" in result.html
        assert "<p>5 < 6" not in result.html

    @pytest.mark.asyncio
    async def test_small_monospace_text_is_preserved_as_inline_code(self, tmp_path):
        def build(document):
            page = document.new_page()
            page.insert_text((72, 90), "Run", fontsize=10)
            page.insert_text((100, 90), "java -jar app.jar", fontsize=8, fontname="cour")

        result = await extract_pdf(_write_pdf(tmp_path, build))

        assert "<code>java -jar app.jar</code>" in result.html

    @pytest.mark.asyncio
    async def test_bold_text_and_drawn_bullets_are_preserved(self, tmp_path):
        def build(document):
            page = document.new_page()
            page.insert_text((72, 90), "Bold", fontsize=10, fontname=_BOLD)
            page.insert_text((72, 108), "Italic", fontsize=10, fontname="heit")
            page.draw_circle((73, 130), 2, color=None, fill=(0, 0, 0))
            page.insert_text((82, 134), "First item", fontsize=10)
            page.draw_circle((73, 150), 2, color=None, fill=(0, 0, 0))
            page.insert_text((82, 154), "Second item", fontsize=10)

        result = await extract_pdf(_write_pdf(tmp_path, build))

        assert "<strong>Bold</strong>" in result.html
        assert "<em>Italic</em>" in result.html
        assert "<ul><li>First item</li><li>Second item</li></ul>" in result.html

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
