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

    def test_a_bare_span_is_unwrapped(self):
        assert _html('<p><span style="color:red">red</span></p>') == "<p>red</p>"

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
    def test_the_first_heading_becomes_the_title_and_leaves_the_body(self):
        html, title, _ = normalize_document_html(
            "<h1>Quarterly Report</h1><p>Body.</p>", filename="doc.docx"
        )
        assert title == "Quarterly Report"
        # Otherwise the page shows its title twice: once as the page title,
        # once as the first line of content.
        assert "Quarterly Report" not in html
        assert html == "<p>Body.</p>"

    @pytest.mark.parametrize("tag", ["h1", "h2", "h3"])
    def test_any_of_the_first_three_levels_can_be_the_title(self, tag):
        assert _title(f"<{tag}>Doc Title</{tag}><p>x</p>") == "Doc Title"

    def test_a_short_lead_in_before_the_heading_is_tolerated(self):
        # Word documents routinely put a date, a document number or a
        # confidentiality line above the title. That is still a title.
        html, title, _ = normalize_document_html(
            "<p>12 March 2026</p><h1>Quarterly Report</h1><p>Body.</p>",
            filename="my-report.docx",
        )
        assert title == "Quarterly Report"
        assert "Quarterly Report" not in html
        assert "12 March 2026" in html

    def test_a_heading_buried_after_real_prose_is_a_section_heading(self):
        # Consuming it would delete a heading the author wrote, and title the
        # page after section two.
        prose = "<p>" + ("This is a long introductory paragraph. " * 12) + "</p>"
        html, title, _ = normalize_document_html(
            f"{prose}<h1>Later Heading</h1>", filename="my-report.docx"
        )
        assert title == "my-report"
        assert "<h1>Later Heading</h1>" in html

    def test_an_over_long_heading_falls_through_to_the_filename(self):
        html, title, _ = normalize_document_html(
            f"<h1>{'x' * 300}</h1><p>body</p>", filename="fallback-name.docx"
        )
        assert title == "fallback-name"
        assert "<h1>" in html  # not consumed, so not lost

    def test_the_metadata_title_is_used_when_there_is_no_heading(self):
        assert _title("<p>body</p>", metadata_title="Annual Review") == "Annual Review"

    @pytest.mark.parametrize(
        "metadata", ["Microsoft Word - report.doc", "report.docx", "scan.pdf"]
    )
    def test_a_metadata_title_that_is_really_a_filename_is_rejected(self, metadata):
        assert _title("<p>b</p>", metadata_title=metadata, filename="good-name.docx") == (
            "good-name"
        )

    def test_the_filename_stem_is_the_last_resort(self):
        assert _title("<p>body</p>", filename="Meeting Notes 2026.docx") == "Meeting Notes 2026"

    def test_a_nameless_file_still_gets_a_title(self):
        assert _title("<p>body</p>", filename=".docx") == "Imported page"

    def test_the_title_is_truncated_to_the_column_width(self):
        assert len(_title("<p>b</p>", metadata_title="y" * 400)) == 255


class TestTruncation:
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


def test_empty_input_produces_empty_content_and_a_filename_title():
    html, title, warnings = normalize_document_html("", filename="empty.docx")
    assert html == ""
    assert title == "empty"
    assert warnings == []
