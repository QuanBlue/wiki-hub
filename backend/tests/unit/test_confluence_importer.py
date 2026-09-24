import zipfile

from app.modules.import_export.confluence import ConfluencePermission, iter_attachments, scan_archive
from app.modules.import_export.service import (
    _build_attachments_table_html,
    _build_gallery_html,
    _is_invalid_import_username,
    _link_imported_attachments,
    _normalize_confluence_code_macros,
    _normalize_confluence_html,
    _slug,
    _space_has_public_view,
)


def test_invalid_confluence_user_ids_are_not_treated_as_usernames():
    assert _is_invalid_import_username("8a9e2ef3775bd448017765ec6a120000")
    assert _is_invalid_import_username(" 8A9E2EF3775BD448017765EC6A120000 ")
    assert not _is_invalid_import_username("jdoe")
    assert not _is_invalid_import_username("invalid_user")


def test_slug_normalizes_values_and_avoids_collisions():
    occupied = {"release-notes", "release-notes-2"}
    assert _slug("Release notes!", occupied) == "release-notes-3"
    assert _slug("!!!", occupied) == "page"


def test_link_imported_attachments_returns_unchanged_content_without_urls():
    content = "<p>No attachments</p>"
    assert _link_imported_attachments(content, "1", {}, {}) == content


def test_link_imported_attachments_keeps_unresolved_macros_and_supports_fallbacks():
    content = (
        "<ac:image><ri:attachment /></ac:image>"
        '<ac:link><ri:attachment ri:filename="encoded+name.txt" /></ac:link>'
        '<img src="/download/attachments/1/unmatched.txt?x=1" />'
    )
    result = _link_imported_attachments(
        content,
        "1",
        {
            ("other", "encoded name.txt"): "/files/name.txt",
            ("other", "unmatched.txt"): "/files/unmatched.txt",
        },
        {},
    )
    assert "ac:image" in result
    assert 'href="/files/name.txt"' in result
    assert 'src="/files/unmatched.txt"' in result


def test_normalize_confluence_code_macros_cdata():
    content = """
    <ac:structured-macro ac:name="code" ac:schema-version="1">
      <ac:parameter ac:name="language">python</ac:parameter>
      <ac:plain-text-body><![CDATA[def hello():
    print("Hello CDATA")]]></ac:plain-text-body>
    </ac:structured-macro>
    """
    normalized = _normalize_confluence_code_macros(content)
    assert '<pre><code class="language-python">def hello():\n    print("Hello CDATA")</code></pre>' in normalized or "def hello()" in normalized


def test_normalize_confluence_macros_handles_callouts_unknown_and_malformed_macros():
    content = (
        '<ac:structured-macro ac:name="info">'
        '<ac:parameter ac:name="title">A &amp; B</ac:parameter>'
        "<ac:rich-text-body><p>Body</p></ac:rich-text-body>"
        "</ac:structured-macro>"
        '<ac:structured-macro ac:name="expand">'
        "<ac:rich-text-body>Details</ac:rich-text-body>"
        "</ac:structured-macro>"
        '<ac:structured-macro ac:name="unknown"><p>Keep</p></ac:structured-macro>'
        "<ac:structured-macro><p>No name</p></ac:structured-macro>"
        '<ac:structured-macro ac:name="code"><p>No body</p></ac:structured-macro>'
    )
    normalized = _normalize_confluence_code_macros(content)
    assert 'data-callout-type="info"' in normalized
    assert 'data-callout-type="panel"' in normalized
    assert 'Keep' in normalized


def test_normalize_confluence_task_lists_and_layouts():
    content = """
    <ac:task-list>
      <ac:task>
        <ac:task-id>1</ac:task-id>
        <ac:task-status>incomplete</ac:task-status>
        <ac:task-body>Customize home page</ac:task-body>
      </ac:task>
    </ac:task-list>
    <ac:layout>
      <ac:layout-section ac:type="three_equal">
        <ac:layout-cell><p>Col 1</p></ac:layout-cell>
        <ac:layout-cell><p>Col 2</p></ac:layout-cell>
        <ac:layout-cell><p>Col 3</p></ac:layout-cell>
      </ac:layout-section>
    </ac:layout>
    <ac:structured-macro ac:name="livesearch">
      <ac:parameter ac:name="query">3DIAN</ac:parameter>
    </ac:structured-macro>
    """
    normalized = _normalize_confluence_html(content)
    assert 'class="task-list' in normalized
    assert 'type="checkbox"' in normalized
    assert 'Customize home page' in normalized
    assert 'grid-cols-3' in normalized
    assert 'Search this documentation' in normalized
    assert '3DIAN' not in normalized  # parameter leakage cleanly stripped


def test_normalize_confluence_macros_returns_plain_content_without_macros():
    assert _normalize_confluence_code_macros("<p>plain</p>") == "<p>plain</p>"


def test_normalize_confluence_code_macros_no_cdata():
    content = """
    <ac:structured-macro ac:name="code" ac:schema-version="1">
      <ac:parameter ac:name="language">javascript</ac:parameter>
      <ac:plain-text-body>console.log("Hello No CDATA");</ac:plain-text-body>
    </ac:structured-macro>
    """
    normalized = _normalize_confluence_code_macros(content)
    assert (
        '<pre><code class="language-javascript">console.log("Hello No CDATA");</code></pre>'
        in normalized
    )


def test_normalize_confluence_code_macros_no_language():
    content = """
    <ac:structured-macro ac:name="code" ac:schema-version="1">
      <ac:plain-text-body>plain text code</ac:plain-text-body>
    </ac:structured-macro>
    """
    normalized = _normalize_confluence_code_macros(content)
    assert "<pre><code>plain text code</code></pre>" in normalized


def test_normalize_confluence_code_macros_spaced_cdata():
    content = """
    <ac:structured-macro ac:name="code" ac:schema-version="1">
      <ac:parameter ac:name="language">python</ac:parameter>
      <ac:plain-text-body><![CDATA[def hello():
    print("Hello CDATA Spaced")
]] ></ac:plain-text-body>
    </ac:structured-macro>
    """
    normalized = _normalize_confluence_code_macros(content)
    assert (
        '<pre><code class="language-python">def hello():\n    print("Hello CDATA Spaced")</code></pre>'
        in normalized
    )

def test_normalize_confluence_macros_various():
    content = """
    <ac:structured-macro ac:name="popular-topics"></ac:structured-macro>
    <ac:structured-macro ac:name="content-by-label"></ac:structured-macro>
    <ac:structured-macro ac:name="recently-updated"></ac:structured-macro>
    <ac:structured-macro ac:name="status"><ac:parameter ac:name="title">WIP</ac:parameter></ac:structured-macro>
    <ac:structured-macro ac:name="toc"></ac:structured-macro>
    <ac:structured-macro ac:name="unknown">
        <ac:rich-text-body><p>Inner</p></ac:rich-text-body>
    </ac:structured-macro>
    <ac:structured-macro ac:name="unknown2">
        <ac:parameter ac:name="test">val</ac:parameter>
        Just text
    </ac:structured-macro>
    """
    normalized = _normalize_confluence_code_macros(content)
    assert "Popular Topics" in normalized
    assert "Featured Pages" in normalized
    assert "Recently Updated Pages" in normalized
    assert "WIP" in normalized
    assert "<p>Inner</p>" in normalized
    assert "Just text" in normalized
    assert "val" not in normalized


def test_link_imported_attachments():
    content = """
    <p>Here is an image: <ac:image><ri:attachment ri:filename="test.png" /></ac:image></p>
    <p>Link to doc: <ac:link><ri:attachment ri:filename="doc.pdf" /></ac:link></p>
    <p>Referenced image: <ac:image><ri:page ri:content-title="Other Page" /><ri:attachment ri:filename="other.png" /></ac:image></p>
    <p>Raw link: <a href="/download/attachments/123/raw.txt?api=v2">Raw File</a></p>
    <p>Raw url-encoded: <img src="/download/attachments/123/My%20Image.png" /></p>
    """
    urls = {
        ("123", "test.png"): "/attachments/123/test.png",
        ("123", "doc.pdf"): "/attachments/123/doc.pdf",
        ("456", "other.png"): "/attachments/456/other.png",
        ("123", "raw.txt"): "/attachments/123/raw.txt",
        ("123", "My Image.png"): "/attachments/123/my-image.png",
    }
    title_to_page_id = {
        "Other Page": "456",
        "Current Page": "123",
    }

    result = _link_imported_attachments(content, "123", urls, title_to_page_id)

    # BeautifulSoup will output normalized tags
    assert '<img alt="test.png" src="/attachments/123/test.png"/>' in result
    assert 'href="/attachments/123/doc.pdf"' in result
    assert 'data-display-mode="link"' in result
    assert '<img alt="other.png" src="/attachments/456/other.png"/>' in result
    assert 'href="/attachments/123/raw.txt"' in result
    assert 'src="/attachments/123/my-image.png"' in result


def test_normalize_and_link_attachments_modes():
    raw = """
    <p>Inline Link: <ac:link><ri:attachment ri:filename="manual.pdf" /></ac:link></p>
    <p>Card Preview: <ac:structured-macro ac:name="view-file"><ac:parameter ac:name="name"><ri:attachment ri:filename="slides.pptx" /></ac:parameter></ac:structured-macro></p>
    <p>Embedded Image: <ac:image><ri:attachment ri:filename="photo.jpg" /></ac:image></p>
    <ac:structured-macro ac:name="attachments"></ac:structured-macro>
    """
    urls = {
        ("p1", "manual.pdf"): "/files/manual.pdf",
        ("p1", "slides.pptx"): "/files/slides.pptx",
        ("p1", "photo.jpg"): "/files/photo.jpg",
    }
    normalized = _normalize_confluence_html(raw)
    linked = _link_imported_attachments(normalized, "p1", urls, {})

    # 1. Inline Link must render as <a> with link display mode
    assert 'data-display-mode="link"' in linked
    assert 'class="attachment-link"' in linked
    assert '<a class="attachment-link" data-attachment="manual.pdf" data-display-mode="link" href="/files/manual.pdf">manual.pdf</a>' in linked
    # 2. View File Card must render as card attachment node
    assert 'data-display-mode="card"' in linked
    assert 'data-attachment="slides.pptx"' in linked
    assert '<a data-attachment="slides.pptx" data-display-mode="card" href="/files/slides.pptx" title="slides.pptx">slides.pptx</a>' in linked
    # 3. Embedded Image must render as <img>
    assert '<img alt="photo.jpg" src="/files/photo.jpg"/>' in linked
    # 4. Attachments Macro must render table
    assert '<table>' in linked
    assert '<th>File</th>' in linked

def test_normalize_legacy_view_file_fallbacks():
    raw = """
    <div class="confluence-macro confluence-macro-view-file"><a href="/content" download="slides.pptx">Download</a></div>
    <div class="confluence-macro confluence-macro-view-file"><a href="/content">Download</a><span title="File.pdf">File.pdf</span></div>
    <div class="confluence-macro confluence-macro-view-file"><a href="/content">Download</a><span>MyDoc.docx</span></div>
    <div class="confluence-macro confluence-macro-view-file"><a href="/content">Download</a><p>MyDoc</p><div class="opacity-15">DOCX</div></div>
    """
    normalized = _normalize_confluence_html(raw)
    assert '<a data-attachment="slides.pptx" data-display-mode="card" href="/content" title="slides.pptx">slides.pptx</a>' in normalized
    assert '<a data-attachment="File.pdf" data-display-mode="card" href="/content" title="File.pdf">File.pdf</a>' in normalized
    assert '<a data-attachment="MyDoc.docx" data-display-mode="card" href="/content" title="MyDoc.docx">MyDoc.docx</a>' in normalized
    assert '<a data-attachment="MyDoc.docx" data-display-mode="card" href="/content" title="MyDoc.docx">MyDoc.docx</a>' in normalized


def test_confluence_scan_resolves_referenced_users_and_attachment_fallbacks(tmp_path):
    entities = """
    <root>
      <object class="Space"><id>s1</id><property name="key">ENG</property><property name="name">Engineering</property></object>
      <object class="ConfluenceUserImpl"><id>u1</id><property name="name">alice</property></object>
      <object class="Page"><id>p1</id><property name="title">Home</property><property name="space"><id>s1</id></property><property name="contentStatus">current</property><property name="creator"><id>u1</id></property><property name="lastModifier"><id>u1</id></property></object>
      <object class="Attachment"><id>a1</id><property name="title">doc.txt</property><property name="containerContent"><id>p1</id></property></object>
      <object class="Attachment"><id>a2</id><property name="title">img.png</property><property name="containerContent"><id>p1</id></property></object>
    </root>
    """
    path = tmp_path / "export.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("entities.xml", entities)
        archive.writestr("nested/doc.txt", b"doc")
        archive.writestr("x/a2/a", b"new")

    spaces = scan_archive(path)
    assert spaces[0].pages[0].creator == "alice"
    assert spaces[0].attachment_count == 2
    attachments = list(iter_attachments(path))
    assert {entry for _item, entry in attachments} == {"nested/doc.txt", "x/a2/a"}


def test_build_attachments_table_and_gallery_return_empty_for_no_files():
    assert _build_attachments_table_html([]) == ""
    assert _build_gallery_html([]) == ""


def test_link_imported_attachments_decomposes_empty_attachment_and_gallery_macros():
    content = '<div data-macro="attachments"></div><div data-macro="gallery"></div>'
    # urls only reference a different page, so this page has no files/images to render
    result = _link_imported_attachments(content, "this-page", {("other-page", "f.txt"): "/f"}, {})
    assert 'data-macro="attachments"' not in result
    assert 'data-macro="gallery"' not in result


def test_link_imported_attachments_renders_gallery_macro_with_images():
    content = '<div data-macro="gallery"></div>'
    urls = {("p1", "photo.png"): "/files/photo.png"}
    result = _link_imported_attachments(content, "p1", urls, {})
    assert '<img src="/files/photo.png" alt="photo.png"/>' in result or 'src="/files/photo.png"' in result


def test_link_imported_attachments_view_file_filename_fallbacks():
    # 1. <span data-filename> fallback when no ri:attachment is present
    content_span = '<div data-macro="view-file"><span data-filename="span-file.txt"></span></div>'
    result = _link_imported_attachments(
        content_span, "p1", {("p1", "span-file.txt"): "/files/span-file.txt"}, {}
    )
    assert 'data-attachment="span-file.txt"' in result

    # 2. <ac:parameter> fallback when no attachment tag or span is present
    content_param = (
        '<ac:structured-macro ac:name="view-file">'
        '<ac:parameter ac:name="name">param-file.txt</ac:parameter>'
        "</ac:structured-macro>"
    )
    result2 = _link_imported_attachments(
        content_param, "p1", {("p1", "param-file.txt"): "/files/param-file.txt"}, {}
    )
    assert 'data-attachment="param-file.txt"' in result2

    # 3. No filename resolvable at all -> macro is dropped
    content_none = '<div data-macro="view-file"></div>'
    result3 = _link_imported_attachments(content_none, "p1", {("p1", "x"): "/x"}, {})
    assert "view-file" not in result3


def test_link_imported_attachments_view_file_url_resolution_fallbacks():
    content = (
        '<div data-macro="view-file"><span data-filename="a+b.txt"></span></div>'
        '<div data-macro="view-file"><span data-filename="only-elsewhere.txt"></span></div>'
        '<div data-macro="view-file"><span data-filename="missing.txt"></span></div>'
    )
    urls = {
        ("p1", "a b.txt"): "/files/a-b.txt",
        ("other", "only-elsewhere.txt"): "/files/elsewhere.txt",
    }
    result = _link_imported_attachments(content, "p1", urls, {})
    assert 'href="/files/a-b.txt"' in result
    assert 'href="/files/elsewhere.txt"' in result
    assert 'href="#attachment-missing.txt"' in result


def test_link_imported_attachments_view_file_matches_despite_case_and_whitespace():
    # A real-world miss: the macro's filename differs from the stored
    # attachment's only by case and incidental whitespace (both common when a
    # Confluence export re-encodes an <ac:parameter> text node) - this must
    # still resolve to the real attachment instead of falling back to a dead
    # `#attachment-...` anchor.
    content = '<div data-macro="view-file"><span data-filename=" Khung Quan Ly.PPTX "></span></div>'
    urls = {("p1", "Khung Quan Ly.pptx"): "/files/khung-quan-ly.pptx"}
    result = _link_imported_attachments(content, "p1", urls, {})
    assert 'href="/files/khung-quan-ly.pptx"' in result
    assert "#attachment-" not in result


def test_link_imported_attachments_appends_unlinked_docs_table():
    content = "<p>No explicit attachment reference here.</p>"
    urls = {("p1", "unlinked.pdf"): "/files/unlinked.pdf"}
    result = _link_imported_attachments(content, "p1", urls, {})
    assert "<table>" in result
    assert 'href="/files/unlinked.pdf"' in result


def test_normalize_confluence_html_empty_content_returns_unchanged():
    assert _normalize_confluence_html("") == ""


def test_normalize_confluence_task_list_missing_body_falls_back_to_text():
    content = """
    <ac:task-list>
      <ac:task>
        <ac:task-id>2</ac:task-id>
        <ac:task-status>complete</ac:task-status>
        Just plain fallback text
      </ac:task>
    </ac:task-list>
    """
    normalized = _normalize_confluence_html(content)
    assert "Just plain fallback text" in normalized
    assert 'data-checked="true"' in normalized
    assert 'checked="checked"' in normalized


def test_normalize_confluence_layout_section_types():
    content = """
    <ac:layout>
      <ac:layout-section ac:type="two_equal"><ac:layout-cell><p>A</p></ac:layout-cell></ac:layout-section>
      <ac:layout-section ac:type="two_left_sidebar"><ac:layout-cell><p>B</p></ac:layout-cell></ac:layout-section>
      <ac:layout-section ac:type="two_right_sidebar"><ac:layout-cell><p>C</p></ac:layout-cell></ac:layout-section>
      <ac:layout-section ac:type="three_with_sidebars"><ac:layout-cell><p>D</p></ac:layout-cell></ac:layout-section>
    </ac:layout>
    """
    normalized = _normalize_confluence_html(content)
    assert "md:grid-cols-2" in normalized
    assert "md:grid-cols-[1fr_2fr]" in normalized
    assert "md:grid-cols-[2fr_1fr]" in normalized
    assert "md:grid-cols-[1fr_2fr_1fr]" in normalized


def test_normalize_confluence_code_macro_handles_entity_encoded_cdata():
    # The outer CDATA-escaping pass only rewrites literal "<![CDATA[" markers
    # in the raw content; entity-encoded markers survive until the macro's
    # own text is extracted, exercising the macro-local CDATA stripping path.
    content = (
        '<ac:structured-macro ac:name="code">'
        '<ac:parameter ac:name="language">python</ac:parameter>'
        "<ac:plain-text-body>&lt;![CDATA[print(1)]]&gt;</ac:plain-text-body>"
        "</ac:structured-macro>"
    )
    normalized = _normalize_confluence_html(content)
    assert "print(1)" in normalized
    assert "CDATA" not in normalized


def test_normalize_confluence_gallery_structured_macro():
    content = '<ac:structured-macro ac:name="gallery"></ac:structured-macro>'
    normalized = _normalize_confluence_html(content)
    assert 'data-macro="gallery"' in normalized


def test_normalize_confluence_view_file_macro_without_attachment_uses_parameter():
    content = (
        '<ac:structured-macro ac:name="view-file">'
        '<ac:parameter ac:name="filename">report.docx</ac:parameter>'
        "</ac:structured-macro>"
    )
    normalized = _normalize_confluence_html(content)
    assert 'data-macro="view-file"' in normalized
    assert 'data-filename="report.docx"' in normalized


def test_normalize_confluence_legacy_view_file_without_link_is_removed():
    content = '<div class="confluence-macro confluence-macro-view-file"><p>No link here</p></div>'
    normalized = _normalize_confluence_html(content)
    assert "confluence-macro-view-file" not in normalized
    assert "No link here" not in normalized


def test_normalize_confluence_strips_stray_parameter_and_placeholder_tags():
    content = '<p>Keep</p><ac:parameter ac:name="stray">value</ac:parameter><ac:placeholder>hint</ac:placeholder>'
    normalized = _normalize_confluence_html(content)
    assert "Keep" in normalized
    assert "value" not in normalized
    assert "hint" not in normalized


def test_space_has_public_view_true_for_named_public_group():
    perms = [ConfluencePermission(perm_type="VIEWSPACE", group_name="confluence-users")]
    assert _space_has_public_view(perms) is True


def test_space_has_public_view_true_for_true_anonymous_entry():
    perms = [ConfluencePermission(perm_type="VIEWSPACE", user_name=None, group_name=None)]
    assert _space_has_public_view(perms) is True


def test_space_has_public_view_false_for_named_user_grant_without_group():
    # Regression: (None or "") used to collapse to the same "" this code
    # treated as "public", so a permission naming a specific user (not a
    # group) made the whole space look open to everyone.
    perms = [ConfluencePermission(perm_type="VIEWSPACE", user_name="admin", group_name=None)]
    assert _space_has_public_view(perms) is False


def test_space_has_public_view_false_for_restricted_named_group():
    perms = [ConfluencePermission(perm_type="VIEWSPACE", group_name="finance-team")]
    assert _space_has_public_view(perms) is False


def test_space_has_public_view_ignores_unrelated_permission_types():
    perms = [ConfluencePermission(perm_type="COMMENT", user_name=None, group_name=None)]
    assert _space_has_public_view(perms) is False


def test_property_text_falls_back_to_element_text_and_unknown_children():
    from xml.etree import ElementTree as ET

    from app.modules.import_export.confluence import _property_text

    assert _property_text(None) == ""
    assert _property_text(ET.fromstring("<property>plain</property>")) == "plain"
    # No date/value child and no own text: the first other child with text wins,
    # and <id>/<ref> children are never mistaken for the value.
    assert (
        _property_text(ET.fromstring("<property><id>7</id><ref>r</ref><stamp>2022-01-01</stamp></property>"))
        == "2022-01-01"
    )
    assert _property_text(ET.fromstring("<property><id>7</id><ref>r</ref></property>")) == ""


def test_iter_attachments_ignores_directory_entries_and_matches_by_basename(tmp_path):
    entities = """
    <root>
      <object class="Attachment"><id>a1</id><property name="title">report.pdf</property><property name="containerContent"><id>p1</id></property></object>
      <object class="Attachment"><id>a2</id><property name="title">scan.png</property><property name="containerContent"><id>p1</id></property></object>
      <object class="Attachment"><id>a3</id><property name="title">absent.bin</property><property name="containerContent"><id>p1</id></property></object>
    </root>
    """
    path = tmp_path / "export.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("entities.xml", entities)
        archive.writestr("attachments/", b"")
        archive.writestr("attachments/p1/a1/report.pdf", b"pdf")
        # Only the id directory is known: newest numeric version wins.
        archive.writestr("attachments/p1/a2/1", b"old")
        archive.writestr("attachments/p1/a2/2", b"new")

    found = {item.source_id: entry for item, entry in iter_attachments(path)}
    assert found == {
        "a1": "attachments/p1/a1/report.pdf",
        "a2": "attachments/p1/a2/2",
        "a3": None,
    }


def test_link_imported_attachments_view_file_matches_another_page_case_insensitively():
    # Neither the target page nor an exact-name cross-page lookup finds it; the
    # last resort is the same filename on another page, ignoring case.
    content = '<div data-macro="view-file"><span data-filename="report.pdf"></span></div>'
    urls = {("other-page", "REPORT.PDF"): "/files/report-upper.pdf"}
    result = _link_imported_attachments(content, "p1", urls, {})
    assert 'href="/files/report-upper.pdf"' in result
    assert "#attachment-" not in result
