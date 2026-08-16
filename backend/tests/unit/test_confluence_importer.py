import zipfile

from app.modules.import_export.confluence import iter_attachments, scan_archive
from app.modules.import_export.service import (
    _is_invalid_import_username,
    _link_imported_attachments,
    _normalize_confluence_code_macros,
    _slug,
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
        '<ac:image><ri:attachment /></ac:image>'
        '<ac:link><ri:attachment ri:filename="encoded+name.txt" /></ac:link>'
        '<img src="/download/attachments/1/unmatched.txt?x=1" />'
    )
    result = _link_imported_attachments(
        content,
        "1",
        {("other", "encoded name.txt"): "/files/name.txt", ("other", "unmatched.txt"): "/files/unmatched.txt"},
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
    assert '<pre><code class="language-python">def hello():\n    print(&quot;Hello CDATA&quot;)</code></pre>' in normalized


def test_normalize_confluence_macros_handles_callouts_unknown_and_malformed_macros():
    content = (
        '<ac:structured-macro ac:name="info">'
        '<ac:parameter ac:name="title">A &amp; B</ac:parameter>'
        '<ac:rich-text-body><p>Body</p></ac:rich-text-body>'
        '</ac:structured-macro>'
        '<ac:structured-macro ac:name="expand">'
        '<ac:rich-text-body>Details</ac:rich-text-body>'
        '</ac:structured-macro>'
        '<ac:structured-macro ac:name="unknown"><p>Keep</p></ac:structured-macro>'
        '<ac:structured-macro><p>No name</p></ac:structured-macro>'
        '<ac:structured-macro ac:name="code"><p>No body</p></ac:structured-macro>'
    )
    normalized = _normalize_confluence_code_macros(content)
    assert 'data-callout-type="info"' in normalized
    assert "<strong>A &amp;amp; B</strong>" in normalized
    assert 'data-callout-type="panel"' in normalized
    assert 'ac:name="unknown"' in normalized
    assert 'ac:name="code"' in normalized


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
    assert '<pre><code class="language-javascript">console.log(&quot;Hello No CDATA&quot;);</code></pre>' in normalized

def test_normalize_confluence_code_macros_no_language():
    content = """
    <ac:structured-macro ac:name="code" ac:schema-version="1">
      <ac:plain-text-body>plain text code</ac:plain-text-body>
    </ac:structured-macro>
    """
    normalized = _normalize_confluence_code_macros(content)
    assert '<pre><code>plain text code</code></pre>' in normalized

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
    assert '<pre><code class="language-python">def hello():\n    print(&quot;Hello CDATA Spaced&quot;)\n</code></pre>' in normalized


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
    assert '<a href="/attachments/123/doc.pdf">doc.pdf</a>' in result
    assert '<img alt="other.png" src="/attachments/456/other.png"/>' in result
    assert 'href="/attachments/123/raw.txt"' in result
    assert 'src="/attachments/123/my-image.png"' in result


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
