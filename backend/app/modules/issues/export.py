"""Issue to Word export: one self-contained ``.docx`` to hand to whoever fixes it.

Reuses the page export's pandoc pipeline (``html_to_docx``); the HTML built
here tags each piece of the report with a ``custom-style`` that
``export_style.py`` then paints in WikiHub's own palette - a header with the
issue's status and labels as coloured pills, a details card, the
description, screenshots and shared notes as tinted cards.

The description and notes are Markdown; they are rendered with raw HTML *and*
Markdown images disabled, so nothing a reporter typed can inject markup or
make pandoc fetch a remote URL while building the file. Screenshots are
embedded from storage as ``data:`` URIs, so the document still shows them
once it leaves WikiHub.

Internal (manager-only) notes are left out on purpose: the file is meant to
be sent to someone else, and those notes were never written for them.
"""

from __future__ import annotations

import base64
from datetime import UTC, datetime
from functools import partial
from html import escape
from typing import Final, Literal

from markdown_it import MarkdownIt

from app.core.config import settings
from app.core.logging import get_logger
from app.modules.issues.export_style import (
    DOCX_THEME,
    LABEL_COLORS,
    STATUS_COLORS,
    label_style,
    status_style,
    style_issue_report,
)
from app.modules.pages.export_docx import html_to_docx
from app.modules.pages.export_service import _export_filename_stem
from app.schemas.issue import IssueRead
from app.services.storage import ObjectStorage

logger = get_logger(__name__)

ExportLanguage = Literal["en", "vi"]

#: Non-breaking spaces padding a pill's text inside its shaded run.
_PAD: Final = " "

_TEXT: Final[dict[str, dict[str, str]]] = {
    "en": {
        "eyebrow": "WikiHub · Issue report",
        "chapter": "Issue {number} of {count}",
        "details": "Details",
        "status": "Status",
        "labels": "Labels",
        "reporter": "Reported by",
        "reported_line": "Reported by {name} on {date}",
        "assignee": "Assignee",
        "created": "Reported",
        "updated": "Last updated",
        "resolved": "Resolved",
        "page": "Page",
        "id": "Issue ID",
        "description": "Description",
        "no_description": "No description was given.",
        "screenshots": "Screenshots",
        "notes": "Notes",
        "unassigned": "Unassigned",
        "none": "None",
        "many_title": "Issues ({count})",
        "many_byline": "{count} issues · exported {date}",
        "summary": "Summary",
        "title": "Title",
        "footer": "WikiHub issue report",
        "open": "Open",
        "in_progress": "In progress",
        "done": "Done",
        "bug": "Bug",
        "documentation": "Documentation",
        "enhancement": "Enhancement",
        "good-first-issue": "Good first issue",
        "help-wanted": "Help wanted",
        "question": "Question",
    },
    "vi": {
        "eyebrow": "WikiHub · Báo cáo issue",
        "chapter": "Issue {number}/{count}",
        "details": "Thông tin",
        "status": "Trạng thái",
        "labels": "Nhãn",
        "reporter": "Người báo",
        "reported_line": "Báo bởi {name} lúc {date}",
        "assignee": "Người xử lý",
        "created": "Ngày báo",
        "updated": "Cập nhật lần cuối",
        "resolved": "Ngày hoàn tất",
        "page": "Trang",
        "id": "Mã issue",
        "description": "Mô tả",
        "no_description": "Không có mô tả.",
        "screenshots": "Ảnh chụp màn hình",
        "notes": "Ghi chú",
        "unassigned": "Chưa giao",
        "none": "Không có",
        "many_title": "Danh sách issue ({count})",
        "many_byline": "{count} issue · xuất lúc {date}",
        "summary": "Tổng quan",
        "title": "Tiêu đề",
        "footer": "Báo cáo issue WikiHub",
        "open": "Mở",
        "in_progress": "Đang xử lý",
        "done": "Hoàn tất",
        "bug": "Lỗi",
        "documentation": "Tài liệu",
        "enhancement": "Cải tiến",
        "good-first-issue": "Dễ bắt đầu",
        "help-wanted": "Cần hỗ trợ",
        "question": "Câu hỏi",
    },
}


def _markdown() -> MarkdownIt:
    # `html: False` shows typed tags as text; `image` is disabled so a
    # `![](http://...)` never becomes something pandoc would download.
    return MarkdownIt("commonmark", {"html": False, "breaks": True}).enable("table").disable(
        "image"
    )


def _when(value: datetime | None, lang: ExportLanguage = "en") -> str:
    if value is None:
        return ""
    if lang == "vi":
        return value.strftime("%d/%m/%Y %H:%M UTC")
    return value.strftime("%b %d, %Y %H:%M UTC").replace(" 0", " ", 1)


def _person(person: object | None, fallback: str) -> str:
    if person is None:
        return fallback
    full_name = (getattr(person, "full_name", "") or "").strip()
    username = getattr(person, "username", "")
    return f"{full_name} (@{username})" if full_name else f"@{username}"


def _absolute(url: str) -> str:
    if url.startswith("/") and settings.public_url:
        return settings.public_url.rstrip("/") + url
    return url


def _block(style: str, inner_html: str) -> str:
    return f'<div custom-style="{escape(style)}">{inner_html}</div>'


def _para(style: str, inner_html: str) -> str:
    return _block(style, f"<p>{inner_html}</p>")


def _pill(style: str, text: str) -> str:
    return f'<span custom-style="{escape(style)}">{_PAD}{escape(text)}{_PAD}</span>'


def _status_pill(status: str, text: dict[str, str]) -> str:
    style = status_style(status if status in STATUS_COLORS else "open")
    return _pill(style, text.get(status, status))


def _badges(issue: IssueRead, text: dict[str, str]) -> str:
    pills = [_status_pill(issue.status, text)]
    for slug in issue.labels:
        if slug in LABEL_COLORS:
            pills.append(_pill(label_style(slug), text.get(slug, slug)))
        else:
            pills.append(escape(slug))
    return _para("WH Badges", " ".join(pills))


def build_issue_html(
    issue: IssueRead,
    images: list[tuple[str, str, bytes]],
    *,
    lang: ExportLanguage = "en",
    eyebrow: str | None = None,
) -> str:
    """The issue as simple, ``custom-style``-tagged HTML for pandoc.
    ``images`` holds ``(filename, content_type, data)`` for each screenshot,
    in order. ``eyebrow`` replaces the small caption over the title (the
    issue's number in a multi-issue report)."""
    text = _TEXT[lang]
    md = _markdown()
    parts: list[str] = [
        _para("WH Issue Eyebrow", escape(eyebrow or text["eyebrow"])),
        f"<h1>{escape(issue.title)}</h1>",
        _badges(issue, text),
        _para(
            "WH Byline",
            escape(
                text["reported_line"].format(
                    name=_person(issue.reporter, ""), date=_when(issue.created_at, lang)
                )
            ),
        ),
    ]

    rows = [
        (text["assignee"], escape(_person(issue.assignee, text["unassigned"]))),
        (text["updated"], escape(_when(issue.updated_at, lang))),
    ]
    if issue.resolved_at:
        rows.append((text["resolved"], escape(_when(issue.resolved_at, lang))))
    if issue.page_url:
        href = _absolute(issue.page_url)
        if href.startswith(("http://", "https://")):
            rows.append((text["page"], f'<a href="{escape(href)}">{escape(href)}</a>'))
        else:
            rows.append((text["page"], escape(href)))
    rows.append((text["id"], escape(str(issue.id))))

    parts += [f"<h2>{escape(text['details'])}</h2>", "<table>", "<tbody>"]
    for label, value in rows:
        parts.append(
            f"<tr><td>{_para('WH Meta Label', escape(label))}</td>"
            f"<td>{_para('WH Meta Value', value)}</td></tr>"
        )
    parts += ["</tbody>", "</table>"]

    parts.append(f"<h2>{escape(text['description'])}</h2>")
    description = issue.description.strip()
    parts.append(
        md.render(description) if description else _para("WH Empty", escape(text["no_description"]))
    )

    if images:
        parts.append(f"<h2>{escape(text['screenshots'])}</h2>")
        for filename, content_type, data in images:
            encoded = base64.b64encode(data).decode("ascii")
            parts.append(
                _para(
                    "WH Figure",
                    f'<img src="data:{escape(content_type)};base64,{encoded}" '
                    f'alt="{escape(filename)}" />',
                )
            )
            parts.append(_para("WH Caption", escape(filename)))

    public_notes = [note for note in issue.notes if note.public]
    if public_notes:
        parts.append(f"<h2>{escape(text['notes'])}</h2>")
        for index, note in enumerate(public_notes):
            if index:
                parts.append(_para("WH Gap", " "))
            heading = " · ".join(
                filter(None, [_person(note.author, ""), _when(note.created_at, lang)])
            )
            parts.append(_para("WH Note Meta", escape(heading)))
            # Plain text with its line breaks kept, exactly as the issue
            # screens show a note (`whitespace-pre-wrap`) - not Markdown.
            body = "<br />".join(escape(line) for line in note.body.strip().splitlines())
            parts.append(_para("WH Note", body))

    return "\n".join(parts)


def build_issues_html(
    issues: list[tuple[IssueRead, list[tuple[str, str, bytes]]]],
    *,
    lang: ExportLanguage = "en",
    exported_at: datetime | None = None,
) -> str:
    """Several issues in one document: a cover with a summary table, then
    each issue in turn in its own header band, its title as Heading 1, so Word's
    navigation pane lists every issue."""
    text = _TEXT[lang]
    count = len(issues)
    parts: list[str] = [
        _para("WH Eyebrow", escape(text["eyebrow"])),
        _para("WH Report Title", escape(text["many_title"].format(count=count))),
        _para(
            "WH Cover Byline",
            escape(
                text["many_byline"].format(
                    count=count, date=_when(exported_at or datetime.now(UTC), lang)
                )
            ),
        ),
        f"<h2>{escape(text['summary'])}</h2>",
        "<table>",
        "<thead><tr>"
        + "".join(
            f"<th>{_para('WH Table Head', escape(label))}</th>"
            for label in ("#", text["title"], text["status"], text["assignee"], text["created"])
        )
        + "</tr></thead>",
        "<tbody>",
    ]
    for number, (issue, _images) in enumerate(issues, start=1):
        cells = (
            escape(str(number)),
            escape(issue.title),
            _status_pill(issue.status, text),
            escape(_person(issue.assignee, text["unassigned"])),
            escape(_when(issue.created_at, lang)),
        )
        parts.append(
            "<tr>" + "".join(f"<td>{_para('WH Table Cell', cell)}</td>" for cell in cells) + "</tr>"
        )
    parts += ["</tbody>", "</table>"]
    for number, (issue, images) in enumerate(issues, start=1):
        parts.append(
            build_issue_html(
                issue,
                images,
                lang=lang,
                eyebrow=text["chapter"].format(number=number, count=count),
            )
        )
    return "\n".join(parts)


async def issue_to_docx(
    issue: IssueRead,
    images: list[tuple[str, str, bytes]],
    *,
    lang: ExportLanguage = "en",
) -> tuple[bytes, str]:
    """Returns the ``.docx`` bytes and a download filename."""
    html = build_issue_html(issue, images, lang=lang)
    content = await html_to_docx(
        html,
        DOCX_THEME,
        title=issue.title,
        post_process=partial(style_issue_report, multi=False, footer_text=_TEXT[lang]["footer"]),
    )
    filename = f"issue-{_export_filename_stem(issue.title, fallback='issue')}.docx"
    logger.info("issue_exported", issue_id=str(issue.id), bytes=len(content))
    return content, filename


async def issues_to_docx(
    issues: list[tuple[IssueRead, list[tuple[str, str, bytes]]]],
    *,
    lang: ExportLanguage = "en",
) -> tuple[bytes, str]:
    """Several issues as one ``.docx``; a single issue keeps the one-issue
    layout."""
    if len(issues) == 1:
        issue, images = issues[0]
        return await issue_to_docx(issue, images, lang=lang)
    title = _TEXT[lang]["many_title"].format(count=len(issues))
    content = await html_to_docx(
        build_issues_html(issues, lang=lang),
        DOCX_THEME,
        title=title,
        post_process=partial(style_issue_report, multi=True, footer_text=_TEXT[lang]["footer"]),
    )
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M")
    logger.info("issues_exported", count=len(issues), bytes=len(content))
    return content, f"issues-{len(issues)}-{stamp}.docx"


async def load_issue_images(
    storage: ObjectStorage, attachments: list[tuple[str, str, str]]
) -> list[tuple[str, str, bytes]]:
    """Fetch each ``(filename, content_type, object_key)`` screenshot. One
    that can no longer be read is skipped rather than failing the export."""
    images: list[tuple[str, str, bytes]] = []
    for filename, content_type, object_key in attachments:
        try:
            images.append((filename, content_type, await storage.get(object_key)))
        except Exception:
            logger.warning("issue_export_image_missing", object_key=object_key)
    return images
