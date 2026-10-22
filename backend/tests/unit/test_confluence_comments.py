"""Comments and likes read from a Confluence export, and comment bodies as Markdown."""

from __future__ import annotations

import zipfile
from pathlib import Path

from app.modules.import_export.comment_markdown import storage_to_markdown
from app.modules.import_export.confluence import read_comments_and_likes

USER = (
    '<property name="{name}" class="ConfluenceUserImpl" package="com.atlassian.confluence.user">'
    '<id name="key">{key}</id></property>'
)
REF = (
    '<property name="{name}" class="ContentEntityObject" package="com.atlassian.confluence.core">'
    '<id name="id">{id}</id></property>'
)


def _comment(
    id_: str, page: str, *, parent: str = "", status: str = "current", old: str = ""
) -> str:
    return (
        f'<object class="Comment" package="com.atlassian.confluence.pages"><id name="id">{id_}</id>'
        '<property name="creationDate">2021-03-10 14:22:19.000</property>'
        '<property name="lastModificationDate">2021-03-11 09:00:00.000</property>'
        f'<property name="contentStatus">{status}</property>'
        + USER.format(name="creator", key="k-alice")
        + REF.format(name="containerContent", id=page)
        + (REF.format(name="parent", id=parent) if parent else "")
        + (REF.format(name="originalVersion", id=old) if old else "")
        + "</object>"
    )


def _like(content: str, key: str) -> str:
    return (
        '<object class="LikeEntity" package="com.atlassian.confluence.like"><id name="id">9</id>'
        '<property name="creationDate">2021-03-23 10:33:42.000</property>'
        + REF.format(name="content", id=content)
        + USER.format(name="user", key=key)
        + "</object>"
    )


def test_live_comments_replies_and_likes_are_read(tmp_path: Path) -> None:
    entities = (
        '<hibernate-generic datetime="2026-04-16">'
        + _comment("c1", "p1")
        + _comment("c2", "p1", parent="c1")
        + _comment("c0", "p1", old="c1")  # an earlier version of c1
        + _comment("c3", "p1", status="deleted")
        + _like("p1", "k-bob")
        + _like("c1", "k-alice")
        + "</hibernate-generic>"
    )
    path = tmp_path / "export.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("entities.xml", entities)

    comments, likes = read_comments_and_likes(path)

    assert [(c.source_id, c.page_id, c.parent_id) for c in comments] == [
        ("c1", "p1", None),
        ("c2", "p1", "c1"),
    ]
    assert comments[0].creator == "k-alice"
    assert comments[0].created_at is not None and comments[0].updated_at > comments[0].created_at
    assert [(like.content_id, like.user) for like in likes] == [("p1", "k-bob"), ("c1", "k-alice")]


def _md(markup: str):
    return storage_to_markdown(
        markup,
        username={"k-alice": "alice"}.get,
        attachment_id={"shot.png": "11111111-1111-1111-1111-111111111111"}.get,
    )


def test_a_comment_body_keeps_its_words_lists_code_and_links() -> None:
    converted = _md(
        '<p>Hi <ac:link><ri:user ri:userkey="k-alice" /></ac:link>, see '
        "<strong>this</strong> and <em>that</em>:</p>"
        "<ul><li>one <code>x != y</code><ul><li>nested</li></ul></li><li>two</li></ul>"
        '<p><a href="https://example.com/a">docs</a> <a href="https://example.com/b">'
        "https://example.com/b</a><br />next line</p>"
        '<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[echo hi]]>'
        "</ac:plain-text-body></ac:structured-macro>"
        '<p><ac:image ac:height="150"><ri:attachment ri:filename="shot.png" /></ac:image></p>'
        '<p style="color: red">&lt;script&gt; stays text</p>'
    )
    assert converted.body == (
        "Hi @alice, see **this** and _that_:\n\n"
        "- one `x != y`\n  - nested\n- two\n\n"
        "[docs](https://example.com/a) https://example.com/b\nnext line\n\n"
        "```\necho hi\n```\n\n"
        "[shot.png](attachment:11111111-1111-1111-1111-111111111111)\n\n"
        "<script> stays text"
    )
    assert converted.mentions == ["alice"]


def test_marks_around_a_link_are_dropped_so_the_link_works() -> None:
    converted = _md('<h1><strong><a href="https://so.com/q">Ant error</a></strong></h1>')
    assert converted.body == "[Ant error](https://so.com/q)"


def test_a_file_that_was_not_imported_is_named_and_a_long_comment_cut() -> None:
    assert _md('<p><ac:link><ri:attachment ri:filename="gone.xml" /></ac:link></p>').body == (
        "gone.xml"
    )
    long = _md("<p>" + "x" * 6000 + "</p>").body
    assert len(long) == 5000 and long.endswith("…")


def test_file_cards_code_pasted_word_by_word_and_nested_marks() -> None:
    converted = _md(
        '<p><ac:structured-macro ac:name="view-file"><ac:parameter ac:name="name">'
        '<ri:attachment ri:filename="shot.png" /></ac:parameter></ac:structured-macro></p>'
        "<p><code>select</code> <code>count</code><code>(</code><code>id)</code></p>"
        "<p>From <em><strong>8.5</strong></em></p>"
    )
    assert converted.body == (
        "[shot.png](attachment:11111111-1111-1111-1111-111111111111)\n\n"
        "`select count(id)`\n\n"
        "From **8.5**"
    )


def test_every_kind_of_content_a_comment_can_hold_is_turned_into_markdown() -> None:
    converted = _md(
        # An unknown user is only the label; the same person twice is named once.
        '<p><ac:link><ri:user ri:userkey="nobody" /><ac:plain-text-link-body>'
        "<![CDATA[Bob]]></ac:plain-text-link-body></ac:link> and "
        '<ac:link><ri:user ri:userkey="nobody" /></ac:link> and '
        '<ac:link><ri:user ri:userkey="k-alice" /></ac:link> '
        '<ac:link><ri:user ri:userkey="k-alice" /></ac:link></p>'
        # A file, a page and a bare link, by label or by name.
        '<p><ac:link><ri:attachment ri:filename="shot.png" /><ac:plain-text-link-body>'
        "<![CDATA[the shot]]></ac:plain-text-link-body></ac:link> "
        '<ac:link><ri:page ri:content-title="Runbook" /></ac:link> '
        '<ac:link><ri:page ri:content-title="Runbook" /><ac:plain-text-link-body>'
        "<![CDATA[see this]]></ac:plain-text-link-body></ac:link> "
        "<ac:link><ac:link-body>just words</ac:link-body></ac:link></p>"
        # Links that are not web addresses are only their words.
        '<p><a href="javascript:x()">click</a> <a href="">empty</a></p>'
        # Images: by URL, by an unsafe URL, and with nothing to show.
        '<p><ac:image><ri:url ri:value="https://example.com/p.png" /></ac:image>'
        '<ac:image><ri:url ri:value="ftp://example.com/p.png" /></ac:image>'
        "<ac:image /></p>"
        '<p>Nice <ac:emoticon ac:name="smile" /><ac:emoticon ac:name="unknown" /></p>'
        # Task lists, ordered lists and a list item holding paragraphs and nested lists.
        "<ac:task-list><ac:task><ac:task-status>complete</ac:task-status>"
        "<ac:task-body>done</ac:task-body></ac:task><ac:task><ac:task-status>incomplete"
        "</ac:task-status></ac:task></ac:task-list>"
        "<ol><li><p>first</p><ol><li>inner</li></ol></li><li>second</li></ol>"
        "<pre>line one\nline two</pre>"
        "<blockquote><p>quoted</p><p>twice</p></blockquote>"
        "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr><tr><td></td></tr></table>"
        "<h2>Title</h2><h3></h3>"
        # Macros: code with nothing in it, with text, a panel with a body, a file card with none.
        '<ac:structured-macro ac:name="noformat"><ac:plain-text-body /></ac:structured-macro>'
        '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>careful</p>'
        "</ac:rich-text-body></ac:structured-macro>"
        '<ac:structured-macro ac:name="viewpdf"></ac:structured-macro>'
        '<ac:structured-macro ac:name="toc"><ac:parameter ac:name="x">1</ac:parameter>'
        "</ac:structured-macro>"
        "<div>plain <span>spans</span> text</div>"
        # Placeholders say nothing; a block inside a run of words stays on its line.
        "<p>hint<ac:placeholder>type here</ac:placeholder> <span>in<div>a block</div></span></p>"
    )

    body = converted.body
    assert "Bob" in body and "nobody" not in body
    assert body.count("@alice") == 2
    assert "[the shot](attachment:11111111-1111-1111-1111-111111111111)" in body
    assert "Runbook" in body and "see this" in body and "just words" in body
    assert "click" in body and "javascript" not in body
    assert "https://example.com/p.png" in body and "ftp://" not in body
    assert "🙂" in body
    assert "- [x] done" in body and "- [ ]" in body
    assert "1. first" in body and "2. second" in body and "  1. inner" in body
    assert "```\nline one\nline two\n```" in body
    assert "> quoted" in body and ">\n> twice" in body
    assert "A | B" in body and "1 | 2" in body
    assert "**Title**" in body
    assert "careful" in body and "plain spans text" in body
    assert "type here" not in body and "in a block" in body
    assert converted.mentions == ["alice"]


def test_a_confluence_person_is_found_by_key_by_lowercase_key_or_left_as_given() -> None:
    from app.modules.import_export.confluence import ConfluenceSpaceList

    spaces = ConfluenceSpaceList([], [], [], user_keys={"k-alice": "alice", "bob": "bobby"})

    assert spaces.username(None) is None and spaces.username("") is None
    assert spaces.username("k-alice") == "alice"
    assert spaces.username("BOB") == "bobby"
    assert spaces.username("someone-else") == "someone-else"


def test_a_person_in_a_property_is_a_reference_or_a_plain_name() -> None:
    import xml.etree.ElementTree as ET

    from app.modules.import_export.confluence import _user_ref

    def props(**parts: str) -> dict[str, ET.Element]:
        out = {}
        for name, value in parts.items():
            element = ET.Element("property", name=name)
            if value.startswith("id:"):
                ET.SubElement(element, "id").text = value[3:]
            else:
                element.text = value
            out[name] = element
        return out

    assert _user_ref(props(creator="id:k-1"), "creator") == "k-1"
    assert _user_ref(props(creator="plain-name"), "creator") == "plain-name"
    assert _user_ref(props(creator="  "), "creator", "other") is None
    assert _user_ref(props(other="fallback"), "creator", "other") == "fallback"
