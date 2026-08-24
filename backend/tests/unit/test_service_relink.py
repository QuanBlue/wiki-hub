"""Attachment-link repair on restore.

Preserving attachment ids keeps links working only while the archive is
internally consistent. Any archive exported from an instance that was once
restored by a build without id preservation carries content pointing at ids
its own attachment records no longer use - and reproduces that faithfully no
matter how correct the restore is. These cover rebuilding the linkage from
the filename each reference carries beside its URL.
"""

from uuid import uuid4

from app.modules.backup.service import _relink_attachment_references


def _link(attachment_id, filename="guide.pdf"):
    return (
        f'<a class="attachment-link" data-attachment="{filename}" '
        f'data-display-mode="link" href="/api/v1/attachments/{attachment_id}/content">'
        f"{filename}</a>"
    )


def test_repoints_a_broken_link_at_the_attachment_with_that_filename():
    new_id = uuid4()
    content = _link(uuid4())

    result = _relink_attachment_references(content, {"guide.pdf": new_id}, {new_id})

    assert f"/api/v1/attachments/{new_id}/content" in result


def test_leaves_a_link_that_already_resolves_untouched():
    """A consistent archive must restore byte-identical.

    The filename lookup is only ever consulted for a reference that does not
    already name one of the page's own attachments, so a correct archive
    never has its content rewritten.
    """
    good_id, other_id = uuid4(), uuid4()
    # The filename maps elsewhere, but the link already resolves - so the
    # map must not be applied.
    content = _link(good_id)

    result = _relink_attachment_references(content, {"guide.pdf": other_id}, {good_id, other_id})

    assert result == content


def test_leaves_a_reference_with_no_known_filename_alone():
    """A link dangling in the source instance stays dangling, never guessed at."""
    stale = uuid4()
    content = _link(stale, filename="never-uploaded.pdf")

    result = _relink_attachment_references(content, {"guide.pdf": uuid4()}, {uuid4()})

    assert str(stale) in result


def test_repairs_download_anchors_and_embedded_images():
    """The three attribute shapes real content uses, in precedence order."""
    doc_id, img_id = uuid4(), uuid4()
    content = (
        f'<a download="report.docx" href="/api/v1/attachments/{uuid4()}/content">Download</a>'
        f'<img alt="diagram.png" src="/api/v1/attachments/{uuid4()}/content"/>'
    )

    result = _relink_attachment_references(
        content,
        {"report.docx": doc_id, "diagram.png": img_id},
        {doc_id, img_id},
    )

    assert f"/api/v1/attachments/{doc_id}/content" in result
    assert f"/api/v1/attachments/{img_id}/content" in result


def test_data_attachment_wins_over_a_generic_alt():
    """An image can carry both; the explicit marker is the authoritative one."""
    right, wrong = uuid4(), uuid4()
    content = (
        f'<img data-attachment="chart.png" alt="A chart of results" '
        f'src="/api/v1/attachments/{uuid4()}/content"/>'
    )

    result = _relink_attachment_references(
        content,
        {"chart.png": right, "A chart of results": wrong},
        {right, wrong},
    )

    assert f"/api/v1/attachments/{right}/content" in result


def test_unescapes_html_entities_in_the_filename():
    """Attribute values are escaped; the stored filename is not."""
    new_id = uuid4()
    content = (
        '<a data-attachment="R&amp;D notes.pdf" '
        f'href="/api/v1/attachments/{uuid4()}/content">notes</a>'
    )

    result = _relink_attachment_references(content, {"R&D notes.pdf": new_id}, {new_id})

    assert f"/api/v1/attachments/{new_id}/content" in result


def test_rewrites_every_reference_within_one_tag():
    """The editor emits the same id twice on a card-mode attachment."""
    new_id = uuid4()
    stale = uuid4()
    content = (
        f'<a data-attachment="guide.pdf" href="/api/v1/attachments/{stale}/content" '
        f'title="/api/v1/attachments/{stale}/content">guide</a>'
    )

    result = _relink_attachment_references(content, {"guide.pdf": new_id}, {new_id})

    assert str(stale) not in result
    assert result.count(str(new_id)) == 2


def test_empty_content_and_empty_map_are_no_ops():
    assert _relink_attachment_references("", {"a": uuid4()}, set()) == ""
    assert _relink_attachment_references("<p>hi</p>", {}, set()) == "<p>hi</p>"


def test_leaves_unrelated_markup_untouched():
    new_id = uuid4()
    content = (
        "<h1>Title</h1><p>See <a href='https://example.com'>this</a></p>"
        + _link(uuid4())
        + "<p>and an <img src='/api/v1/pages/x.png'/></p>"
    )

    result = _relink_attachment_references(content, {"guide.pdf": new_id}, {new_id})

    assert "<h1>Title</h1>" in result
    assert "https://example.com" in result
    assert "/api/v1/pages/x.png" in result
    assert f"/api/v1/attachments/{new_id}/content" in result
