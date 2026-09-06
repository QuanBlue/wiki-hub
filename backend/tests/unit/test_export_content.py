"""Export content preparation: the inherited sanitizer, forcing toggles open,
and inlining attachments as data: URIs for the session-less headless render."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.config import settings
from app.modules.pages import export_content


def page(**overrides: object) -> SimpleNamespace:
    defaults = {
        "id": uuid.uuid4(),
        "content": "",
        "content_format": "html",
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def attachment(**overrides: object) -> SimpleNamespace:
    defaults = {
        "page_id": uuid.uuid4(),
        "object_key": "attachments/x/y.png",
        "content_type": "image/png",
        "size_bytes": 4,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def storage(data: bytes = b"data") -> AsyncMock:
    fake = AsyncMock()
    fake.get.return_value = data
    return fake


def session_returning(attachment_by_id: dict[uuid.UUID, object]) -> AsyncMock:
    fake = AsyncMock()

    async def _get(_model: object, attachment_id: uuid.UUID) -> object:
        return attachment_by_id.get(attachment_id)

    fake.get = AsyncMock(side_effect=_get)
    return fake


@pytest.mark.asyncio
async def test_markdown_content_is_rendered_before_sanitizing() -> None:
    p = page(content_format="markdown", content="# Heading\n\nSome *text*.")
    html = await export_content.prepare_export_html(
        p, storage=storage(), session=session_returning({})
    )
    assert "<h1>Heading</h1>" in html
    assert "<em>text</em>" in html


@pytest.mark.asyncio
async def test_html_content_is_used_as_is() -> None:
    p = page(content_format="html", content="<p>Already HTML</p>")
    html = await export_content.prepare_export_html(
        p, storage=storage(), session=session_returning({})
    )
    assert "<p>Already HTML</p>" in html


@pytest.mark.asyncio
async def test_sanitizer_strips_dangerous_tags_and_attributes() -> None:
    p = page(
        content_format="markdown",
        content=(
            "# Heading\n\n"
            '<script>alert(1)</script><iframe src="//evil"></iframe>'
            '<a href="javascript:bad()" onclick="bad()">link</a>'
        ),
    )
    html = await export_content.prepare_export_html(
        p, storage=storage(), session=session_returning({})
    )
    assert "<script" not in html
    assert "<iframe" not in html
    assert "javascript:" not in html
    assert "onclick" not in html


@pytest.mark.asyncio
async def test_toggles_are_forced_open() -> None:
    p = page(
        content_format="html",
        content='<div data-type="toggle" data-open="false"><div data-type="toggle-summary">S</div></div>',
    )
    html = await export_content.prepare_export_html(
        p, storage=storage(), session=session_returning({})
    )
    assert 'data-open="true"' in html
    assert 'data-open="false"' not in html


@pytest.mark.asyncio
async def test_an_already_open_toggle_stays_open() -> None:
    p = page(content_format="html", content='<div data-type="toggle" data-open="true">x</div>')
    html = await export_content.prepare_export_html(
        p, storage=storage(), session=session_returning({})
    )
    assert 'data-open="true"' in html


class TestBareHeaderRows:
    """A page's own table never wraps its header row in a <thead> - it is
    just an ordinary <tr> of <th> cells (see rich-text-editor.tsx's
    TableHeaderWithBackground). Pandoc's HTML reader only recognises a
    header row inside a real <thead>, so without this, Word export's own
    header-row styling never has anything to paint."""

    @pytest.mark.asyncio
    async def test_a_bare_th_row_gets_wrapped_in_a_thead(self) -> None:
        p = page(
            content_format="html",
            content="<table><tbody><tr><th>A</th><th>B</th></tr>"
            "<tr><td>1</td><td>2</td></tr></tbody></table>",
        )
        html = await export_content.prepare_export_html(
            p, storage=storage(), session=session_returning({})
        )
        assert html == (
            "<table><thead><tr><th>A</th><th>B</th></tr></thead>"
            "<tbody><tr><td>1</td><td>2</td></tr></tbody></table>"
        )

    @pytest.mark.asyncio
    async def test_a_table_already_wrapped_is_left_alone(self) -> None:
        p = page(
            content_format="html",
            content="<table><thead><tr><th>A</th></tr></thead>"
            "<tbody><tr><td>1</td></tr></tbody></table>",
        )
        html = await export_content.prepare_export_html(
            p, storage=storage(), session=session_returning({})
        )
        assert html.count("<thead>") == 1

    @pytest.mark.asyncio
    async def test_a_table_with_no_header_cells_is_left_alone(self) -> None:
        p = page(
            content_format="html",
            content="<table><tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
        )
        html = await export_content.prepare_export_html(
            p, storage=storage(), session=session_returning({})
        )
        assert "<thead>" not in html


class TestTableOfContents:
    """The live editor's `tableOfContents` node stores no content of its
    own - a React node view fills the placeholder in by scanning the *live*
    document's headings. A static export has no live document, so
    `prepare_export_html` has to do that scan itself.
    """

    @pytest.mark.asyncio
    async def test_the_placeholder_becomes_a_numbered_outline(self) -> None:
        p = page(
            content_format="html",
            content=(
                '<div data-type="tableOfContents"></div>'
                "<h1>Introduction</h1><h2>Scope</h2><h1>Setup</h1>"
            ),
        )
        html = await export_content.prepare_export_html(
            p, storage=storage(), session=session_returning({})
        )
        assert 'data-type="tableOfContents"' not in html
        assert "1. Introduction" in html
        assert "1.1. Scope" in html
        assert "2. Setup" in html
        # Nesting under its parent, not flush with the top level.
        assert html.index("1.1. Scope") > html.index("1. Introduction")

    @pytest.mark.asyncio
    async def test_a_heading_with_no_text_still_gets_an_entry(self) -> None:
        p = page(
            content_format="html",
            content='<div data-type="tableOfContents"></div><h1>   </h1>',
        )
        html = await export_content.prepare_export_html(
            p, storage=storage(), session=session_returning({})
        )
        assert "1. Untitled section" in html

    @pytest.mark.asyncio
    async def test_no_headings_removes_the_placeholder_rather_than_an_empty_list(
        self,
    ) -> None:
        p = page(
            content_format="html",
            content='<p>Before</p><div data-type="tableOfContents"></div><p>After</p>',
        )
        html = await export_content.prepare_export_html(
            p, storage=storage(), session=session_returning({})
        )
        assert "tableOfContents" not in html
        assert html == "<p>Before</p><p>After</p>"

    @pytest.mark.asyncio
    async def test_a_document_starting_at_a_nested_heading_still_reads_sensibly(
        self,
    ) -> None:
        # Mirrors the frontend's own numberTableOfContentsHeadings: a
        # document that opens with an <h2> should not render "0.1".
        p = page(
            content_format="html",
            content='<div data-type="tableOfContents"></div><h2>First</h2>',
        )
        html = await export_content.prepare_export_html(
            p, storage=storage(), session=session_returning({})
        )
        assert "1.1. First" in html

    @pytest.mark.asyncio
    async def test_each_entry_is_a_real_link_to_its_heading(self) -> None:
        p = page(
            content_format="html",
            content=(
                '<div data-type="tableOfContents"></div>'
                "<h1>Introduction</h1><h2>Scope</h2>"
            ),
        )
        html = await export_content.prepare_export_html(
            p, storage=storage(), session=session_returning({})
        )
        assert '<h1 id="introduction">Introduction</h1>' in html
        assert '<h2 id="scope">Scope</h2>' in html
        assert '<a href="#introduction">1. Introduction</a>' in html
        assert '<a href="#scope">1.1. Scope</a>' in html

    @pytest.mark.asyncio
    async def test_entries_are_not_an_ol_so_nothing_numbers_them_a_second_time(
        self,
    ) -> None:
        # A real <ol>/<li> gets reparsed straight back into the editor's own
        # schema for a PDF/HTML capture, which has no attribute for
        # `list-style`/`padding-left` and drops both - left with a bare
        # <ol>, the browser draws its own "1. 2. 3." on top of the "1./1.1."
        # index already in the text, and every level renders flush with no
        # indent. Plain <p> lines have nothing left for a list to number.
        p = page(
            content_format="html",
            content=(
                '<div data-type="tableOfContents"></div>'
                "<h1>Introduction</h1><h2>Scope</h2>"
            ),
        )
        html = await export_content.prepare_export_html(
            p, storage=storage(), session=session_returning({})
        )
        assert "<ol" not in html
        assert "<li" not in html

    @pytest.mark.asyncio
    async def test_a_nested_entry_is_indented_with_real_text_not_a_style(
        self,
    ) -> None:
        # A leading run of non-breaking spaces is plain text, so - unlike a
        # `padding-left` style - it survives being reparsed by the editor or
        # by Pandoc unchanged.
        p = page(
            content_format="html",
            content=(
                '<div data-type="tableOfContents"></div>'
                "<h1>Introduction</h1><h2>Scope</h2>"
            ),
        )
        html = await export_content.prepare_export_html(
            p, storage=storage(), session=session_returning({})
        )
        assert f'<p>\xa0\xa0\xa0\xa0<a href="#scope">1.1. Scope</a></p>' in html
        assert "style=" not in html.split("Table of contents")[1]


class TestNativeWordTableOfContents:
    """Word has its own real, updatable Table of Contents field - unlike
    PDF/HTML, which have no such mechanism and so get the custom-rendered
    outline above instead. `native_word_toc=True` (export_service.py's
    Word branch only) must leave a marker for export_docx.py to turn into
    that real field, not the PDF/HTML outline.
    """

    @pytest.mark.asyncio
    async def test_the_placeholder_becomes_a_marker_paragraph(self) -> None:
        p = page(
            content_format="html",
            content='<div data-type="tableOfContents"></div><h1>Introduction</h1>',
        )
        html = await export_content.prepare_export_html(
            p,
            storage=storage(),
            session=session_returning({}),
            native_word_toc=True,
        )
        assert 'data-type="tableOfContents"' not in html
        assert f"<p>{export_content.WORD_TOC_FIELD_MARKER}</p>" in html
        # None of the PDF/HTML outline's own rendering - no numbered entry,
        # no link, no heading id needlessly assigned for a feature Word
        # doesn't use this way.
        assert "1. Introduction" not in html
        assert "<a href" not in html
        assert "<h1 id=" not in html

    @pytest.mark.asyncio
    async def test_no_headings_still_gets_the_marker_not_a_removed_placeholder(
        self,
    ) -> None:
        # Unlike the PDF/HTML outline (which removes an empty placeholder
        # rather than render an empty list), Word's native field builds its
        # own outline whenever the document *later* gains headings - always
        # leave the field for Word to manage, never decide on its behalf.
        p = page(
            content_format="html",
            content='<div data-type="tableOfContents"></div>',
        )
        html = await export_content.prepare_export_html(
            p,
            storage=storage(),
            session=session_returning({}),
            native_word_toc=True,
        )
        assert f"<p>{export_content.WORD_TOC_FIELD_MARKER}</p>" in html


class TestImageCaptions:
    """Same shape of problem as the table of contents: the caption text
    lives only in a `data-caption` attribute, turned visible only by the
    image's own React node view."""

    @pytest.mark.asyncio
    async def test_a_captioned_image_gets_a_visible_figcaption(self) -> None:
        p = page(
            content_format="html",
            content='<p><img src="https://example.com/pic.png" data-caption="A diagram"/></p>',
        )
        html = await export_content.prepare_export_html(
            p, storage=storage(), session=session_returning({})
        )
        assert "<figure>" in html
        assert "<figcaption>A diagram</figcaption>" in html
        assert "data-caption" not in html

    @pytest.mark.asyncio
    async def test_a_blank_caption_is_dropped_without_an_empty_figcaption(self) -> None:
        p = page(
            content_format="html",
            content='<p><img src="https://example.com/pic.png" data-caption="   "/></p>',
        )
        html = await export_content.prepare_export_html(
            p, storage=storage(), session=session_returning({})
        )
        assert "figcaption" not in html
        assert "data-caption" not in html

    @pytest.mark.asyncio
    async def test_an_uncaptioned_image_is_left_alone(self) -> None:
        p = page(
            content_format="html",
            content='<p><img src="https://example.com/pic.png"/></p>',
        )
        html = await export_content.prepare_export_html(
            p, storage=storage(), session=session_returning({})
        )
        assert "<figure>" not in html


class TestAttachmentInlining:
    @pytest.mark.asyncio
    async def test_a_matching_image_is_inlined_as_a_data_uri(self) -> None:
        attachment_id = uuid.uuid4()
        p = page(content_format="html", content=f'<img src="/api/v1/attachments/{attachment_id}/content">')
        att = attachment(page_id=p.id, content_type="image/png")
        html = await export_content.prepare_export_html(
            p, storage=storage(b"\x89PNG"), session=session_returning({attachment_id: att})
        )
        assert "data:image/png;base64," in html
        assert "/api/v1/attachments/" not in html

    @pytest.mark.asyncio
    async def test_a_matching_attachment_link_is_inlined_and_downloadable(self) -> None:
        attachment_id = uuid.uuid4()
        p = page(
            content_format="html",
            content=(
                f'<a href="/api/v1/attachments/{attachment_id}/content" '
                f'data-attachment="report.pdf">Download</a>'
            ),
        )
        att = attachment(page_id=p.id, content_type="application/pdf")
        html = await export_content.prepare_export_html(
            p, storage=storage(b"%PDF-1.4"), session=session_returning({attachment_id: att})
        )
        assert "data:application/pdf;base64," in html
        assert 'download="report.pdf"' in html

    @pytest.mark.asyncio
    async def test_a_non_attachment_url_is_left_untouched(self) -> None:
        p = page(content_format="html", content='<img src="https://example.com/pic.png">')
        html = await export_content.prepare_export_html(
            p, storage=storage(), session=session_returning({})
        )
        assert html == '<img src="https://example.com/pic.png"/>'

    @pytest.mark.asyncio
    async def test_a_non_attachment_link_is_left_untouched(self) -> None:
        p = page(content_format="html", content='<a href="https://example.com">link</a>')
        html = await export_content.prepare_export_html(
            p, storage=storage(), session=session_returning({})
        )
        assert html == '<a href="https://example.com">link</a>'

    @pytest.mark.asyncio
    async def test_an_unresolvable_attachment_link_is_left_untouched(self) -> None:
        attachment_id = uuid.uuid4()
        p = page(
            content_format="html",
            content=f'<a href="/api/v1/attachments/{attachment_id}/content">Download</a>',
        )
        html = await export_content.prepare_export_html(
            p, storage=storage(), session=session_returning({})
        )
        assert f"/api/v1/attachments/{attachment_id}/content" in html
        assert "download=" not in html

    @pytest.mark.asyncio
    async def test_an_unknown_attachment_id_is_left_as_a_plain_link(self) -> None:
        attachment_id = uuid.uuid4()
        p = page(content_format="html", content=f'<img src="/api/v1/attachments/{attachment_id}/content">')
        html = await export_content.prepare_export_html(
            p, storage=storage(), session=session_returning({})
        )
        assert f"/api/v1/attachments/{attachment_id}/content" in html
        assert "data:" not in html

    @pytest.mark.asyncio
    async def test_an_attachment_belonging_to_another_page_is_not_dereferenced(self) -> None:
        attachment_id = uuid.uuid4()
        p = page(content_format="html", content=f'<img src="/api/v1/attachments/{attachment_id}/content">')
        att = attachment(page_id=uuid.uuid4())  # a different page
        html = await export_content.prepare_export_html(
            p, storage=storage(), session=session_returning({attachment_id: att})
        )
        assert "data:" not in html

    @pytest.mark.asyncio
    async def test_an_attachment_over_the_per_asset_cap_is_skipped(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "export_max_inline_asset_bytes", 10)
        attachment_id = uuid.uuid4()
        p = page(content_format="html", content=f'<img src="/api/v1/attachments/{attachment_id}/content">')
        att = attachment(page_id=p.id, size_bytes=11)
        html = await export_content.prepare_export_html(
            p, storage=storage(), session=session_returning({attachment_id: att})
        )
        assert "data:" not in html

    @pytest.mark.asyncio
    async def test_an_attachment_over_the_total_document_cap_is_skipped(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "export_max_inline_total_bytes", 10)
        first_id, second_id = uuid.uuid4(), uuid.uuid4()
        p = page(
            content_format="html",
            content=(
                f'<img src="/api/v1/attachments/{first_id}/content">'
                f'<img src="/api/v1/attachments/{second_id}/content">'
            ),
        )
        session = session_returning(
            {
                first_id: attachment(page_id=p.id, size_bytes=8),
                second_id: attachment(page_id=p.id, size_bytes=8),
            }
        )
        html = await export_content.prepare_export_html(
            p, storage=storage(b"12345678"), session=session
        )
        # The first fits under the 10-byte cap; the second would push the
        # running total over it and is left un-inlined instead.
        assert html.count("data:") == 1

    @pytest.mark.asyncio
    async def test_the_same_attachment_referenced_twice_is_fetched_once(self) -> None:
        attachment_id = uuid.uuid4()
        p = page(
            content_format="html",
            content=(
                f'<img src="/api/v1/attachments/{attachment_id}/content">'
                f'<img src="/api/v1/attachments/{attachment_id}/content">'
            ),
        )
        att = attachment(page_id=p.id)
        fake_storage = storage()
        await export_content.prepare_export_html(
            p, storage=fake_storage, session=session_returning({attachment_id: att})
        )
        fake_storage.get.assert_awaited_once()
