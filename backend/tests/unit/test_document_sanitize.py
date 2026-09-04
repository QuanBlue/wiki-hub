"""The allowlist sanitizer applied to every imported document.

Two obligations, and both are load-bearing: nothing executable may survive
(imported content is stored in `page_revisions.content`, which the page-history
modal renders with `dangerouslySetInnerHTML`), and legitimate markup must come
through intact (an import that silently eats tables or code blocks is a broken
feature, not a safe one).
"""

from __future__ import annotations

import pytest

from app.modules.document_import.sanitize import sanitize_imported_html


class TestNothingExecutableSurvives:
    @pytest.mark.parametrize(
        ("label", "payload"),
        [
            ("script element", "<script>alert(1)</script>"),
            ("event handler", "<img src=x onerror=alert(1)>"),
            ("javascript href", '<a href="javascript:alert(1)">x</a>'),
            ("svg animate", "<svg><animate onbegin=alert(1) attributeName=x dur=1s></svg>"),
            ("iframe srcdoc", '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>'),
            ("meta refresh", '<meta http-equiv=refresh content="0;url=//evil">'),
            ("data url href", '<a href="data:text/html,&lt;script&gt;alert(1)">x</a>'),
            ("template smuggling", "<template><img src=x onerror=alert(1)></template>"),
            ("formaction", '<button formaction="javascript:alert(1)">go</button>'),
            ("object data", '<object data="javascript:alert(1)"></object>'),
            ("embed", '<embed src="javascript:alert(1)">'),
            ("base href", '<base href="https://evil.example/">'),
            ("form", '<form action="https://evil.example"><input name="p"></form>'),
            ("vbscript href", '<a href="vbscript:msgbox(1)">x</a>'),
            ("style element", "<style>body{background:url(https://evil.example)}</style>"),
            ("onload body", "<body onload=alert(1)>text</body>"),
            ("marquee onstart", "<marquee onstart=alert(1)>x</marquee>"),
            ("xlink href", '<math><maction xlink:href="javascript:alert(1)">x</maction></math>'),
        ],
    )
    def test_payload_is_neutralised(self, label, payload):
        result = sanitize_imported_html(payload)
        lowered = result.lower()
        assert "<script" not in lowered, label
        assert "javascript:" not in lowered, label
        assert "vbscript:" not in lowered, label
        assert "onerror" not in lowered, label
        assert "onbegin" not in lowered, label
        assert "onload" not in lowered, label
        assert "onstart" not in lowered, label
        assert "srcdoc" not in lowered, label
        assert "formaction" not in lowered, label
        assert "http-equiv" not in lowered, label
        assert "<iframe" not in lowered, label
        assert "<object" not in lowered, label
        assert "<embed" not in lowered, label
        assert "<base" not in lowered, label
        assert "<form" not in lowered, label

    def test_a_stripped_link_keeps_its_text(self):
        # The href goes; the words the author wrote stay. Dropping the text too
        # would silently delete content from an otherwise honest document.
        assert "click me" in sanitize_imported_html('<a href="javascript:alert(1)">click me</a>')

    def test_script_source_is_not_left_behind_as_text(self):
        assert sanitize_imported_html("<script>alert(1)</script><p>ok</p>") == "<p>ok</p>"

    def test_comments_are_stripped(self):
        assert sanitize_imported_html("<p>a<!-- secret -->b</p>") == "<p>ab</p>"


class TestSafeDocumentStylesSurvive:
    def test_resource_loading_background_is_dropped_but_safe_styles_survive(self):
        result = sanitize_imported_html(
            '<p style="background:url(https://evil.example/?c=1); color:#17365d; '
            'background-color:#d9eaf7; font-weight:700; text-align:center">t</p>'
        )
        assert "text-align" in result
        assert "color" in result
        assert "background-color" in result
        assert "font-weight" in result
        assert "evil.example" not in result
        assert "background:url" not in result

    def test_table_cell_alignment_is_preserved(self):
        result = sanitize_imported_html(
            '<table><tbody><tr><td style="text-align: right;">9</td></tr></tbody></table>'
        )
        assert "text-align" in result and "<td" in result

    def test_heading_alignment_is_preserved(self):
        assert "text-align" in sanitize_imported_html('<h2 style="text-align:center">T</h2>')

    def test_table_row_and_cell_colours_survive(self):
        result = sanitize_imported_html(
            '<table style="width:100%"><tr style="background-color:#2f5597">'
            '<th style="color:#fff; border-color:#1f1f1f">Header</th></tr></table>'
        )
        assert 'background-color:#2f5597' in result
        assert 'color:#fff' in result
        assert 'border-color:#1f1f1f' in result

    def test_styled_span_survives(self):
        result = sanitize_imported_html('<p><span style="color:#c00000">red</span></p>')
        assert '<span style="color:#c00000">red</span>' in result


class TestClassValuesAreConstrained:
    def test_a_language_class_survives_for_syntax_highlighting(self):
        result = sanitize_imported_html('<pre><code class="language-python">print(1)</code></pre>')
        assert 'class="language-python"' in result

    def test_an_arbitrary_value_class_is_dropped(self):
        # Tailwind-style arbitrary values can smuggle a URL into a class name.
        result = sanitize_imported_html('<p class="bg-[url(https://evil.example/x)]">t</p>')
        assert "evil.example" not in result
        assert result == "<p>t</p>"

    def test_a_long_class_list_is_capped(self):
        classes = " ".join(f"c{i}" for i in range(40))
        result = sanitize_imported_html(f'<p class="{classes}">t</p>')
        assert result.count("c") <= 40  # a bounded remainder, not the full list
        assert "c39" not in result


class TestLegitimateMarkupSurvives:
    def test_an_attachment_image_keeps_its_authenticated_src(self):
        html = '<p><img src="/api/v1/attachments/abc/content" alt="a"></p>'
        assert '/api/v1/attachments/abc/content' in sanitize_imported_html(html)

    def test_an_attachment_link_keeps_the_editor_data_attributes(self):
        html = (
            '<a href="/api/v1/attachments/1/content" data-attachment="f.pdf" '
            'data-display-mode="card">f.pdf</a>'
        )
        result = sanitize_imported_html(html)
        assert 'data-attachment="f.pdf"' in result
        assert 'data-display-mode="card"' in result

    def test_a_task_list_keeps_its_node_markers(self):
        html = (
            '<ul data-type="taskList"><li data-type="taskItem" data-checked="true">'
            "<p>done</p></li></ul>"
        )
        assert sanitize_imported_html(html) == html

    def test_a_table_of_contents_node_keeps_its_marker(self):
        html = '<div data-type="tableOfContents"></div>'
        assert sanitize_imported_html(html) == html

    def test_a_table_keeps_its_structure_and_spans(self):
        html = (
            "<table><thead><tr><th colspan=\"2\">H</th></tr></thead>"
            "<tbody><tr><td>a</td><td>b</td></tr></tbody></table>"
        )
        result = sanitize_imported_html(html)
        for fragment in ("<table>", "<thead>", "<tbody>", 'colspan="2"', "<td>a</td>"):
            assert fragment in result

    def test_inline_marks_and_headings_survive(self):
        html = "<h1>T</h1><p><strong>b</strong> <em>i</em> <s>x</s> <code>c</code></p>"
        assert sanitize_imported_html(html) == html

    def test_external_links_are_kept_but_get_noopener(self):
        result = sanitize_imported_html('<a href="https://ext.example/x">ext</a>')
        assert 'href="https://ext.example/x"' in result
        assert "noopener" in result

    def test_mailto_and_fragment_links_survive(self):
        assert "mailto:x@y.z" in sanitize_imported_html('<a href="mailto:x@y.z">m</a>')
        assert "#anchor" in sanitize_imported_html('<a href="#anchor">a</a>')

    def test_a_task_checkbox_keeps_only_decorative_attributes(self):
        result = sanitize_imported_html(
            '<input type="checkbox" checked disabled name="p" value="v">'
        )
        assert "checkbox" in result
        assert "name=" not in result and "value=" not in result


def test_empty_input_is_empty_output():
    assert sanitize_imported_html("") == ""
