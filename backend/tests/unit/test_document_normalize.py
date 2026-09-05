"""Reshaping converted HTML for the Tiptap editor.

The failure this guards against is quiet: ProseMirror drops an unknown node
*and its children*, so a wrapper the schema does not recognise takes the text
inside it along. Every "unwrap, don't delete" assertion below is that bug.
"""

from __future__ import annotations

import pytest

from app.modules.document_import.normalize import (
    TRUNCATION_NOTICE_CLASS,
    normalize_document_html,
)
from app.modules.document_import.sanitize import sanitize_imported_html
from app.schemas.page import MAX_PAGE_CONTENT_CHARS


def _html(source: str, **kwargs) -> str:
    kwargs.setdefault("filename", "doc.docx")
    return normalize_document_html(source, **kwargs)[0]


def _title(source: str, **kwargs) -> str:
    kwargs.setdefault("filename", "doc.docx")
    return normalize_document_html(source, **kwargs)[1]


def _warnings(source: str, **kwargs) -> list[str]:
    kwargs.setdefault("filename", "doc.docx")
    return normalize_document_html(source, **kwargs)[2]


class TestUnwrappingNeverLosesText:
    @pytest.mark.parametrize(
        "wrapper", ["div", "section", "article", "header", "footer", "main", "nav", "aside"]
    )
    def test_a_layout_wrapper_is_unwrapped_with_its_children_intact(self, wrapper):
        result = _html(f"<{wrapper}><p>keep <b>me</b></p></{wrapper}>")
        assert result == "<p>keep <b>me</b></p>"

    def test_nested_wrappers_all_unwrap(self):
        assert _html("<div><section><div><p>deep</p></div></section></div>") == "<p>deep</p>"

    def test_html_head_body_scaffolding_is_removed(self):
        result = _html("<html><head><title>T</title></head><body><p>text</p></body></html>")
        assert result == "<p>text</p>"

    def test_a_span_carrying_an_editor_attribute_survives(self):
        result = _html('<p><span data-type="mention">@ana</span></p>')
        assert 'data-type="mention"' in result

    def test_a_styled_span_is_kept(self):
        assert _html('<p><span style="color:red">red</span></p>') == (
            '<p><span style="color:red">red</span></p>'
        )

    def test_a_bare_span_is_unwrapped(self):
        assert _html("<p><span>plain</span></p>") == "<p>plain</p>"

    def test_style_and_meta_are_removed_entirely(self):
        result = _html("<style>p{color:red}</style><meta charset='utf-8'><p>body</p>")
        assert result == "<p>body</p>"

    def test_comments_are_removed(self):
        assert _html("<p>a</p><!-- note --><p>b</p>") == "<p>a</p><p>b</p>"


class TestFigures:
    def test_a_figure_becomes_an_image_followed_by_an_italic_caption(self):
        result = _html('<figure><img src="a.png"/><figcaption>A caption</figcaption></figure>')
        assert result == '<p><img src="a.png"/></p><p><em>A caption</em></p>'

    def test_a_figure_without_a_caption_still_yields_the_image(self):
        result = _html('<figure><img src="a.png"/></figure>')
        assert '<img src="a.png"/>' in result
        assert "<figure" not in result


class TestCodeBlocks:
    def test_pandoc_source_classes_become_a_language_class(self):
        result = _html('<pre class="sourceCode python"><code class="sourceCode python">x</code></pre>')
        assert result == '<pre><code class="language-python">x</code></pre>'

    def test_an_existing_language_class_is_preserved(self):
        result = _html('<pre><code class="language-rust">x</code></pre>')
        assert 'class="language-rust"' in result

    def test_a_bare_pre_gains_a_code_element(self):
        assert _html("<pre>plain</pre>") == "<pre><code>plain</code></pre>"

    def test_an_unlabelled_block_gets_no_language_class(self):
        assert "language-" not in _html("<pre><code>plain</code></pre>")


class TestTaskLists:
    SOURCE = (
        '<ul class="task-list">'
        '<li><input type="checkbox" disabled=""/><p>todo one</p></li>'
        '<li><input type="checkbox" checked="" disabled=""/><p>done two</p></li>'
        "</ul>"
    )

    def test_a_gfm_task_list_becomes_the_editor_node_shape(self):
        result = _html(self.SOURCE)
        assert 'data-type="taskList"' in result
        assert result.count('data-type="taskItem"') == 2
        assert 'data-checked="false"' in result
        assert 'data-checked="true"' in result

    def test_the_task_text_survives(self):
        result = _html(self.SOURCE)
        assert "todo one" in result and "done two" in result

    def test_the_checkbox_keeps_the_styling_the_editor_gives_it(self):
        # Attribute stripping runs before this pass for exactly this reason.
        assert "accent-primary" in _html(self.SOURCE)

    def test_the_result_survives_sanitizing_unchanged_in_substance(self):
        # The two passes are applied in sequence in the worker; if the sanitizer
        # ate these attributes the import would produce plain bullets.
        sanitized = sanitize_imported_html(_html(self.SOURCE))
        assert 'data-type="taskList"' in sanitized
        assert 'data-checked="true"' in sanitized
        assert "accent-primary" in sanitized

    def test_a_plain_bullet_list_is_left_alone(self):
        assert _html("<ul><li>one</li><li>two</li></ul>") == "<ul><li>one</li><li>two</li></ul>"

    def test_a_mixed_list_is_not_converted(self):
        # Half checkboxes is not a task list; converting it would drop the
        # non-task items' structure.
        source = '<ul><li><input type="checkbox"/>task</li><li>not a task</li></ul>'
        assert "taskList" not in _html(source)

    def test_a_checkbox_mid_sentence_does_not_make_a_task_list(self):
        source = "<ul><li>text before <input type=\"checkbox\"/> after</li></ul>"
        assert "taskList" not in _html(source)


class TestTableOfContents:
    def test_linked_word_or_html_contents_becomes_a_live_contents_node(self):
        source = (
            "<h1>MỤC LỤC</h1>"
            '<p><a href="#architecture">1 Architecture</a></p>'
            '<p><a href="#data-model">1.1 Data model</a></p>'
            "<h1>Architecture</h1><p>Page body</p>"
        )

        html, title, _ = normalize_document_html(source, filename="design.docx")

        assert html.startswith('<div data-type="tableOfContents"></div>')
        assert "1.1 Data model" not in html
        assert html.endswith("<p>Page body</p>")
        assert title == "design"

    def test_numbered_pdf_contents_becomes_a_live_contents_node(self):
        source = (
            "<h1>Mục lục</h1><p>1 Architecture 4</p><p>1.1 Data model 5</p>"
            "<h1>Architecture</h1><p>Page body</p>"
        )

        html, _, _ = normalize_document_html(source, filename="design.pdf")

        assert '<div data-type="tableOfContents"></div>' in html
        assert "Data model 5" not in html

    def test_pdf_contents_heading_can_share_a_line_with_its_first_entry(self):
        source = (
            "<h2>MỤC LỤC Architecture ................................ 4</h2>"
            "<p>Data model ................................ 5</p>"
            "<p>Operations ................................ 6</p><h2>Architecture</h2>"
        )

        html, _, _ = normalize_document_html(source, filename="design.pdf")

        assert html.startswith('<div data-type="tableOfContents"></div>')
        assert "Data model ................................ 5" not in html

    def test_pdf_contents_title_merged_into_a_plain_paragraph_still_becomes_toc(self):
        # PyMuPDF's block segmentation can glue a short bold contents title
        # onto the very next line when the two sit close together on the
        # page. The title is too small a fraction of that paragraph's spans
        # to read as a heading on its own, so it never becomes an <h*> tag -
        # unlike the case above, where the whole merged line was bold enough
        # to already be one.
        source = (
            "<p><strong>Mục lục</strong> 1 Architecture ................................ 4</p>"
            "<p>1.1 Data model ................................ 5</p>"
            "<h2>Architecture</h2><p>Page body</p>"
        )

        html, _, _ = normalize_document_html(source, filename="design.pdf")

        assert html.startswith('<div data-type="tableOfContents"></div>')
        assert "Data model ................................ 5" not in html
        assert html.endswith("<p>Page body</p>")

    def test_a_sentence_starting_with_contents_is_not_mistaken_for_a_toc(self):
        source = (
            "<p>Contents of this document are confidential and must not be "
            "shared outside the project.</p><p>Second paragraph.</p>"
        )

        assert _html(source, filename="doc.pdf") == source

    def test_a_contents_heading_without_entries_is_preserved(self):
        html, title, _ = normalize_document_html(
            "<h2>Contents</h2><p>Introduction</p>", filename="contents.html"
        )
        assert html == "<h2>Contents</h2><p>Introduction</p>"
        assert title == "contents"


class TestImagesLinksAndTables:
    def test_a_loose_image_is_wrapped_in_its_own_paragraph(self):
        assert _html('<img src="/api/v1/attachments/1/content"/>') == (
            '<p><img src="/api/v1/attachments/1/content"/></p>'
        )

    def test_an_image_already_inside_a_paragraph_is_not_double_wrapped(self):
        result = _html('<p><img src="a.png"/></p>')
        assert result.count("<p>") == 1

    def test_an_unsafe_link_is_unwrapped_but_keeps_its_text(self):
        result = _html('<p><a href="javascript:alert(1)">click me</a></p>')
        assert "click me" in result
        assert "javascript" not in result
        assert "<a " not in result

    @pytest.mark.parametrize(
        "href", ["https://ok.example", "http://ok.example", "mailto:a@b.c", "#anchor", "/local"]
    )
    def test_safe_link_schemes_survive(self, href):
        assert f'href="{href}"' in _html(f'<p><a href="{href}">x</a></p>')

    def test_a_span_of_one_is_dropped_as_noise(self):
        result = _html('<table><tr><td colspan="1">a</td><td colspan="3">b</td></tr></table>')
        assert 'colspan="1"' not in result
        assert 'colspan="3"' in result

    def test_colgroup_is_removed(self):
        result = _html("<table><colgroup><col/></colgroup><tr><td>a</td></tr></table>")
        assert "colgroup" not in result and "<col" not in result
        assert "<td>a</td>" in result

    def test_empty_paragraphs_are_collapsed(self):
        assert _html("<p>a</p><p></p><p>  </p><p>b</p>") == "<p>a</p><p>b</p>"

    def test_a_paragraph_holding_only_an_image_is_kept(self):
        assert "<img" in _html('<p><img src="a.png"/></p>')


class TestTitleDerivation:
    """Every imported page is titled after its source filename, extension
    stripped - never after a heading or a document's own metadata. A leading
    heading is therefore left in the body like any other content.
    """

    def test_the_title_is_the_filename_stem(self):
        html, title, _ = normalize_document_html(
            "<h1>Quarterly Report</h1><p>Body.</p>", filename="doc.docx"
        )
        assert title == "doc"
        # Not consumed: the heading is ordinary content once it no longer
        # doubles as the page title.
        assert html == "<h1>Quarterly Report</h1><p>Body.</p>"

    def test_the_filename_stem_is_used_even_with_a_leading_heading(self):
        assert _title(
            "<h1>Doc Title</h1><p>x</p>", filename="Meeting Notes 2026.docx"
        ) == "Meeting Notes 2026"

    def test_a_nameless_file_still_gets_a_title(self):
        assert _title("<p>body</p>", filename=".docx") == "Imported page"

    def test_the_title_is_truncated_to_the_column_width(self):
        assert len(_title("<p>b</p>", filename=f"{'y' * 400}.docx")) == 255


class TestTruncation:
    def test_the_shared_page_limit_allows_large_security_reports(self):
        # The source DMS4 report is about 1.42 MB after sanitizing. Keep the
        # central contract above that real-world size so imports, edits and
        # drafts agree on what can be stored.
        assert MAX_PAGE_CONTENT_CHARS >= 2_100_000

    def test_content_under_the_budget_is_untouched(self):
        source = "<p>short</p>"
        html, _, warnings = normalize_document_html(
            source, filename="d.docx", max_chars=1000
        )
        assert html == source
        assert warnings == []

    def test_over_budget_content_is_cut_at_a_block_boundary(self):
        source = "".join(f"<p>{'x' * 100}</p>" for _ in range(50))
        html, _, warnings = normalize_document_html(source, filename="d.docx", max_chars=900)
        assert len(html) <= 900
        assert warnings and "longer than WikiHub" in warnings[0]
        # Never mid-tag: every paragraph that survived is a whole one.
        body = html.split('<p class=')[0]
        assert body.count("<p>") == body.count("</p>")
        assert not body.endswith("<p")

    def test_the_reader_is_told_the_page_is_incomplete(self):
        source = "".join(f"<p>{'x' * 100}</p>" for _ in range(50))
        html, _, _ = normalize_document_html(source, filename="d.docx", max_chars=900)
        assert TRUNCATION_NOTICE_CLASS in html
        assert "truncated" in html

    def test_the_warning_reports_roughly_how_much_arrived(self):
        source = "".join(f"<p>{'x' * 100}</p>" for _ in range(50))
        warnings = _warnings(source, max_chars=2800)
        assert warnings
        percent = int(warnings[0].split("about ")[1].split("%")[0])
        assert 1 <= percent < 100

    def test_the_truncation_notice_survives_sanitizing(self):
        source = "".join(f"<p>{'x' * 100}</p>" for _ in range(50))
        html, _, _ = normalize_document_html(source, filename="d.docx", max_chars=900)
        assert TRUNCATION_NOTICE_CLASS in sanitize_imported_html(html)

    def test_a_styled_layout_wrapper_is_unwrapped_before_truncating(self):
        # Exported reports often have one large visual wrapper. A generic div
        # is not a Tiptap node, and treating it as a single truncation block
        # used to replace the whole document with just the warning notice.
        source = '<div style="width:100%">' + "".join(
            f"<p>{'x' * 100}</p>" for _ in range(50)
        ) + "</div>"
        html, _, warnings = normalize_document_html(
            source, filename="report.html", max_chars=900
        )

        assert warnings
        assert html.count("<p>") > 0
        assert not html.startswith('<div style="width:100%">')


def test_empty_input_produces_empty_content_and_a_filename_title():
    html, title, warnings = normalize_document_html("", filename="empty.docx")
    assert html == ""
    assert title == "empty"
    assert warnings == []
