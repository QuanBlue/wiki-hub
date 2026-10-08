"""The HTML an issue's Word export is built from."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from app.modules.issues.export import build_issue_html, build_issues_html
from app.schemas.issue import IssueNoteRead, IssuePerson, IssueRead


def _issue(**overrides: object) -> IssueRead:
    reporter = IssuePerson(id=uuid.uuid4(), username="alice", full_name="Alice Nguyen")
    values: dict[str, object] = {
        "id": uuid.uuid4(),
        "title": "Save fails",
        "description": "Steps:\n1. Open **page**\n<script>alert(1)</script>\n![x](http://evil.test/a.png)",
        "status": "in_progress",
        "page_url": "/spaces/ENG/pages/home",
        "labels": ["bug"],
        "reporter": reporter,
        "assignee": None,
        "notes": [
            IssueNoteRead(
                id=uuid.uuid4(),
                author=reporter,
                body="Public closing note",
                public=True,
                created_at=datetime(2026, 1, 2, tzinfo=UTC),
            ),
            IssueNoteRead(
                id=uuid.uuid4(),
                author=reporter,
                body="Internal triage note",
                public=False,
                created_at=datetime(2026, 1, 2, tzinfo=UTC),
            ),
        ],
        "created_at": datetime(2026, 1, 1, 9, 30, tzinfo=UTC),
        "updated_at": datetime(2026, 1, 2, tzinfo=UTC),
    }
    values.update(overrides)
    return IssueRead(**values)  # type: ignore[arg-type]


def test_issue_html_renders_markdown_safely_and_skips_internal_notes() -> None:
    html = build_issue_html(_issue(), [("shot.png", "image/png", b"\x89PNG")], lang="en")

    assert "<strong>page</strong>" in html
    assert "<script>" not in html
    assert "&lt;script&gt;" in html
    # A Markdown image would make pandoc download the URL - never rendered.
    assert '<img src="http' not in html
    assert "data:image/png;base64," in html
    assert "Public closing note" in html
    assert "Internal triage note" not in html
    assert "Alice Nguyen (@alice)" in html
    assert "In progress" in html and "Bug" in html
    assert "Unassigned" in html
    assert "Jan 1, 2026 09:30 UTC" in html
    assert 'custom-style="WH Status in_progress"' in html
    assert 'custom-style="WH Label bug"' in html


def test_issue_html_uses_vietnamese_labels() -> None:
    html = build_issue_html(_issue(description=""), [], lang="vi")

    assert "Mô tả" in html
    assert "Không có mô tả." in html
    assert "Đang xử lý" in html
    assert "Chưa giao" in html


def test_many_issues_get_a_summary_and_one_chapter_each() -> None:
    first = _issue(title="First problem")
    second = _issue(title="Second <problem>", status="done")
    html = build_issues_html([(first, []), (second, [])], lang="en")

    assert html.index("<h2>Summary</h2>") < html.index("<h1>First problem</h1>")
    assert html.index("<h1>First problem</h1>") < html.index("<h1>Second &lt;problem&gt;</h1>")
    # Each issue opens with its number, sections one level down.
    assert html.count('custom-style="WH Issue Eyebrow"') == 2
    assert "Issue 2 of 2" in html
    assert html.count("<h2>Details</h2>") == 2
    assert 'custom-style="WH Status done"' in html
