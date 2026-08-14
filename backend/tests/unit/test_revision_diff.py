import difflib
import pytest
from app.schemas.revision import PageRevisionDiffChunk, PageRevisionDiffRead


def calculate_test_diff(
    from_version: int,
    from_title: str,
    from_content: str,
    to_version: int,
    to_title: str,
    to_content: str,
) -> PageRevisionDiffRead:
    title_changed = from_title != to_title
    from_lines = from_content.splitlines()
    to_lines = to_content.splitlines()

    matcher = difflib.SequenceMatcher(None, from_lines, to_lines)
    chunks: list[PageRevisionDiffChunk] = []
    added_count = 0
    deleted_count = 0

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            text = "\n".join(from_lines[i1:i2])
            if text:
                chunks.append(PageRevisionDiffChunk(operation="equal", text=text))
        elif tag == "replace":
            deleted_text = "\n".join(from_lines[i1:i2])
            added_text = "\n".join(to_lines[j1:j2])
            if deleted_text:
                deleted_count += (i2 - i1)
                chunks.append(PageRevisionDiffChunk(operation="delete", text=deleted_text))
            if added_text:
                added_count += (j2 - j1)
                chunks.append(PageRevisionDiffChunk(operation="add", text=added_text))
        elif tag == "delete":
            deleted_text = "\n".join(from_lines[i1:i2])
            if deleted_text:
                deleted_count += (i2 - i1)
                chunks.append(PageRevisionDiffChunk(operation="delete", text=deleted_text))
        elif tag == "insert":
            added_text = "\n".join(to_lines[j1:j2])
            if added_text:
                added_count += (j2 - j1)
                chunks.append(PageRevisionDiffChunk(operation="add", text=added_text))

    return PageRevisionDiffRead(
        from_version=from_version,
        to_version=to_version,
        title_changed=title_changed,
        from_title=from_title,
        to_title=to_title,
        chunks=chunks,
        added_count=added_count,
        deleted_count=deleted_count,
    )


def test_diff_calculation_additions_and_deletions() -> None:
    v1_content = "<p>Line 1</p>\n<p>Line 2</p>"
    v2_content = "<p>Line 1</p>\n<p>Line 2 Modified</p>\n<p>Line 3 Added</p>"

    diff = calculate_test_diff(1, "Title V1", v1_content, 2, "Title V2", v2_content)

    assert diff.from_version == 1
    assert diff.to_version == 2
    assert diff.title_changed is True
    assert diff.from_title == "Title V1"
    assert diff.to_title == "Title V2"
    assert len(diff.chunks) > 0

    operations = [c.operation for c in diff.chunks]
    assert "add" in operations
    assert "delete" in operations
    assert "equal" in operations
