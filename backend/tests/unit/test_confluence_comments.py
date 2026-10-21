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
