"""Turn what the model wrote for a new page into markup the Tiptap editor shows.

The model answers in Markdown (a format it writes reliably): a ``Title:`` line,
then the body. The body becomes HTML here, shaped the way WikiHub's own editor
produces it (see ``app/modules/pages/tiptap_html.py``), and goes through the
same sanitiser as imported documents, so nothing the model - or a prompt hidden
in the author's request - emits can reach a stored page as script or raw HTML.
A banner marking the page as AI-written is always put first.
"""

from __future__ import annotations

import html
import re

from bs4 import BeautifulSoup, Tag
from markdown_it import MarkdownIt

from app.modules.document_import.sanitize import sanitize_imported_html
from app.modules.pages.tiptap_html import new_task_item, new_task_list
from app.schemas.page import MAX_PAGE_CONTENT_CHARS

#: The notice at the top of a drafted page, by language code; English otherwise.
AI_NOTICE = {
    "en": "This page was drafted by AI. Please review it before relying on it.",
    "vi": "Nội dung trang này do AI tạo. Hãy kiểm tra lại trước khi sử dụng.",
}

_TITLE_LINE = re.compile(r"^\s*Title:\s*(.+?)\s*(?:\n|$)", re.I)
_TASK_MARK = re.compile(r"^\s*\[( |x|X)\]\s+")

# No raw HTML in; tables and strikethrough on.
_markdown = MarkdownIt("commonmark", {"html": False, "linkify": False}).enable(
    ["table", "strikethrough"]
)


def split_title(text: str, fallback: str = "") -> tuple[str, str]:
    """The model's ``Title:`` line and the rest; the fallback when it gave none."""
    text = text.strip()
    found = _TITLE_LINE.match(text)
    if not found:
        return fallback.strip(), text
    return found.group(1).strip().strip("#*` ")[:255] or fallback.strip(), text[found.end() :]


def ai_notice(lang: str | None) -> str:
    text = AI_NOTICE.get((lang or "").lower(), AI_NOTICE["en"])
    return (
        '<div data-type="callout" data-callout-type="info" class="callout callout-info">'
        f"<p>{html.escape(text)}</p></div>"
    )


def _task_lists(soup: BeautifulSoup) -> None:
    """``- [ ] item`` lists become the editor's task lists."""
    for ul in soup.find_all("ul"):
        items = ul.find_all("li", recursive=False)
        if not items or not all(_leading_mark(li) for li in items):
            continue
        task_list = new_task_list(soup)
        for li in items:
            mark = _leading_mark(li)
            assert mark is not None
            checked = mark.group(1) in "xX"
            _strip_mark(li)
            task_list.append(new_task_item(soup, body=li, checked=checked))
        ul.replace_with(task_list)


def _first_text(li: Tag):
    for node in li.descendants:
        if isinstance(node, str) and node.strip():
            return node
        if isinstance(node, Tag) and node.name in {"ul", "ol"}:
            return None
    return None


def _leading_mark(li: Tag) -> re.Match[str] | None:
    node = _first_text(li)
    return _TASK_MARK.match(str(node)) if node is not None else None


def _strip_mark(li: Tag) -> None:
    node = _first_text(li)
    if node is not None:
        node.replace_with(_TASK_MARK.sub("", str(node), count=1))


def draft_to_html(body: str, lang: str | None = None) -> str:
    """The sanitised page HTML: the AI banner, then the drafted body."""
    soup = BeautifulSoup(_markdown.render(body), "html.parser")
    # A leading level-one heading would only repeat the page title.
    first = soup.find(True)
    if isinstance(first, Tag) and first.name == "h1":
        first.decompose()
    _task_lists(soup)
    content = sanitize_imported_html(str(soup))
    return (ai_notice(lang) + content)[:MAX_PAGE_CONTENT_CHARS]
