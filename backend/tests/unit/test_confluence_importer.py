import pytest

from app.modules.import_export.service import (
    _is_invalid_import_username,
    _link_imported_attachments,
    _normalize_confluence_code_macros,
)


def test_invalid_confluence_user_ids_are_not_treated_as_usernames():
    assert _is_invalid_import_username("8a9e2ef3775bd448017765ec6a120000")
    assert _is_invalid_import_username(" 8A9E2EF3775BD448017765EC6A120000 ")
    assert not _is_invalid_import_username("quannt39")
    assert not _is_invalid_import_username("invalid_user")

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
