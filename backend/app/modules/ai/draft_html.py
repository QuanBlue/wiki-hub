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

from bs4 import BeautifulSoup, NavigableString, Tag
from markdown_it import MarkdownIt

from app.modules.document_import.sanitize import sanitize_imported_html
from app.modules.pages.tiptap_html import new_table_of_contents, new_task_item, new_task_list
from app.schemas.page import MAX_PAGE_CONTENT_CHARS

#: The notice at the top of a drafted page, by language code; English otherwise.
AI_NOTICE = {
    "en": "This page was drafted by AI. Please review it before relying on it.",
    "vi": "Nội dung trang này do AI tạo. Hãy kiểm tra lại trước khi sử dụng.",
}

_TITLE_LINE = re.compile(r"^\s*Title:\s*(.+?)\s*(?:\n|$)", re.I)
_TASK_MARK = re.compile(r"^\s*\[( |x|X)\]\s+")
_FENCE_RE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")
_TOGGLE_OPEN_RE = re.compile(r"^\s{0,3}:::toggle(?:\[(open|closed)\])?(?:\s+(.*))?$", re.I)
_TOGGLE_CLOSE_RE = re.compile(r"^\s{0,3}:::\s*$")
_CALLOUT_PREFIX_RE = re.compile(
    r"^\s*\[!(INFO|WARNING|CAUTION|TIP|NOTE|IMPORTANT|PANEL)\](?:[ \t]+)?", re.I
)
_TOC_RE = re.compile(r"^(?:\[TOC\]|\[\[_TOC_\]\])$", re.I)
_BADGE_RE = re.compile(
    r"\[badge:(?:(neutral|blue|green|amber|red|purple)\|)?([^\]|\n]{1,32})\]", re.I
)

_CALLOUT_KINDS = {
    "info": "info",
    "warning": "warning",
    "caution": "warning",
    "important": "warning",
    "tip": "tip",
    "note": "note",
    "panel": "panel",
}

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


def _fence_transition(line: str, active_fence: tuple[str, int] | None) -> tuple[str, int] | None:
    """Track Markdown code fences so custom syntax inside code blocks is ignored."""
    match = _FENCE_RE.match(line)
    if not match:
        return active_fence
    token = match.group(1)
    char, length = token[0], len(token)
    if active_fence is None:
        return (char, length)
    if char == active_fence[0] and length >= active_fence[1] and line[match.end() :].strip() == "":
        return None
    return active_fence


def _extract_toggles(body: str) -> tuple[str, list[tuple[str, bool, str]]]:
    """Extract ``:::toggle ... :::`` blocks outside code fences into placeholders."""
    lines = body.splitlines()
    out_lines: list[str] = []
    toggles: list[tuple[str, bool, str]] = []
    outer_fence: tuple[str, int] | None = None
    in_toggle = False
    toggle_fence: tuple[str, int] | None = None
    toggle_open = False
    toggle_summary = ""
    toggle_lines: list[str] = []

    for line in lines:
        if not in_toggle:
            outer_fence = _fence_transition(line, outer_fence)
            if outer_fence is None:
                open_match = _TOGGLE_OPEN_RE.match(line)
                if open_match:
                    in_toggle = True
                    toggle_fence = None
                    toggle_open = (open_match.group(1) or "closed").lower() == "open"
                    toggle_summary = (open_match.group(2) or "").strip()
                    toggle_lines = []
                    continue
            out_lines.append(line)
            continue

        toggle_fence = _fence_transition(line, toggle_fence)
        if toggle_fence is None and _TOGGLE_CLOSE_RE.match(line):
            placeholder = f"WIKIHUBTOGGLEBLOCK{len(toggles)}END"
            toggles.append((toggle_summary, toggle_open, "\n".join(toggle_lines)))
            if out_lines and out_lines[-1].strip():
                out_lines.append("")
            out_lines.append(placeholder)
            out_lines.append("")
            in_toggle = False
            toggle_lines = []
            continue
        toggle_lines.append(line)

    if in_toggle:
        # Unclosed toggle block: preserve raw text rather than dropping content.
        header = ":::toggle" + ("[open]" if toggle_open else "")
        if toggle_summary:
            header += f" {toggle_summary}"
        out_lines.append(header)
        out_lines.extend(toggle_lines)

    return "\n".join(out_lines), toggles


def _task_lists(soup: BeautifulSoup) -> None:
    """``- [ ] item`` lists become the editor's task lists."""
    for ul in list(soup.find_all("ul")):
        items = ul.find_all("li", recursive=False)
        if not items or not all(_leading_mark(li) for li in items):
            continue
        task_list = new_task_list(soup)
        for li in items:
            first_tag = next((child for child in li.contents if isinstance(child, Tag)), None)
            has_leading_text = any(
                isinstance(child, str) and child.strip()
                for child in li.contents[: li.contents.index(first_tag)]
            ) if first_tag is not None else False
            if first_tag is not None and first_tag.name == "p" and not has_leading_text:
                first_tag.unwrap()
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


def _split_first_line(p: Tag, soup: BeautifulSoup) -> tuple[Tag, Tag] | None:
    """Split a callout paragraph on its first newline into title and body paragraphs."""
    for idx, node in enumerate(list(p.contents)):
        if isinstance(node, Tag) and node.name == "br":
            title_p = soup.new_tag("p")
            body_p = soup.new_tag("p")
            for child in list(p.contents[:idx]):
                title_p.append(child.extract())
            node.decompose()
            for child in list(p.contents):
                body_p.append(child.extract())
            return title_p, body_p
        if isinstance(node, str) and "\n" in node:
            before, after = node.split("\n", 1)
            title_p = soup.new_tag("p")
            body_p = soup.new_tag("p")
            for child in list(p.contents[:idx]):
                title_p.append(child.extract())
            if before:
                title_p.append(NavigableString(before))
            node.extract()
            if after.lstrip("\n"):
                body_p.append(NavigableString(after.lstrip("\n")))
            for child in list(p.contents):
                body_p.append(child.extract())
            return title_p, body_p
    return None


def _wrap_strong(tag: Tag, soup: BeautifulSoup) -> None:
    """Bold a callout's standalone title line unless it is already bold."""
    children = [
        c for c in tag.contents if not (isinstance(c, str) and not c.strip())
    ]
    if len(children) == 1 and isinstance(children[0], Tag) and children[0].name in {"strong", "b"}:
        return
    strong = soup.new_tag("strong")
    for child in list(tag.contents):
        strong.append(child.extract())
    tag.append(strong)


def _callouts(soup: BeautifulSoup) -> None:
    """Convert ``> [!INFO|WARNING|TIP|NOTE|CAUTION|IMPORTANT|PANEL]`` blockquotes."""
    for bq in list(soup.find_all("blockquote")):
        first_block = next(
            (child for child in bq.contents if isinstance(child, Tag)),
            None,
        )
        if first_block is None or first_block.name != "p":
            continue
        first_str = next(
            (child for child in first_block.contents if isinstance(child, str) and child.strip()),
            None,
        )
        if first_str is None:
            continue
        # Only convert when the marker is at the very start of the paragraph.
        leading_siblings = first_block.contents[: first_block.contents.index(first_str)]
        if any(isinstance(c, Tag) for c in leading_siblings):
            continue
        match = _CALLOUT_PREFIX_RE.match(str(first_str))
        if not match:
            continue

        kind = _CALLOUT_KINDS[match.group(1).lower()]
        remainder = str(first_str)[match.end() :]
        if remainder:
            first_str.replace_with(NavigableString(remainder))
        else:
            first_str.extract()

        has_more_blocks = any(
            isinstance(child, Tag) and child is not first_block for child in bq.contents
        )
        split = _split_first_line(first_block, soup)
        if split is not None:
            title_p, body_p = split
            if title_p.get_text(strip=True):
                _wrap_strong(title_p, soup)
                first_block.insert_before(title_p)
            if body_p.get_text(strip=True) or body_p.find(True):
                first_block.replace_with(body_p)
            else:
                first_block.decompose()
        elif not first_block.get_text(strip=True) and not first_block.find(True):
            first_block.decompose()
        elif has_more_blocks:
            _wrap_strong(first_block, soup)

        callout = soup.new_tag(
            "div",
            attrs={
                "data-type": "callout",
                "data-callout-type": kind,
                "class": f"callout callout-{kind}",
            },
        )
        for child in list(bq.contents):
            callout.append(child.extract())
        if not callout.find(True):
            callout.append(soup.new_tag("p"))
        bq.replace_with(callout)


def _table_of_contents(soup: BeautifulSoup) -> None:
    """Convert standalone ``[TOC]`` paragraphs into live Table of Contents nodes."""
    for p in list(soup.find_all("p")):
        if p.find(True):
            continue
        if _TOC_RE.match(p.get_text().strip()):
            p.replace_with(new_table_of_contents(soup))


def _status_badges(soup: BeautifulSoup) -> None:
    """Convert inline ``[badge:color|LABEL]`` tokens outside code/diagrams."""
    nodes = [node for node in list(soup.descendants) if isinstance(node, NavigableString)]
    for node in nodes:
        text = str(node)
        if "[badge:" not in text.lower():
            continue
        if any(
            isinstance(parent, Tag)
            and (
                parent.name in {"code", "pre"}
                or (parent.name == "div" and parent.get("data-type") == "diagram")
            )
            for parent in node.parents
        ):
            continue
        matches = list(_BADGE_RE.finditer(text))
        if not matches:
            continue
        parts: list[NavigableString | Tag] = []
        cursor = 0
        for match in matches:
            if match.start() > cursor:
                parts.append(NavigableString(text[cursor : match.start()]))
            color = (match.group(1) or "blue").lower()
            label = match.group(2).strip()[:32]
            if label:
                badge = soup.new_tag(
                    "span",
                    attrs={
                        "data-type": "statusBadge",
                        "data-label": label,
                        "data-color": color,
                    },
                )
                badge.string = label
                parts.append(badge)
            else:
                parts.append(NavigableString(match.group(0)))
            cursor = match.end()
        if cursor < len(text):
            parts.append(NavigableString(text[cursor:]))
        first_part = parts[0]
        node.replace_with(first_part)
        anchor = first_part
        for extra in parts[1:]:
            anchor.insert_after(extra)
            anchor = extra


def _diagram_blocks(soup: BeautifulSoup) -> None:
    """Convert ```mermaid code blocks into rich Diagram nodes."""
    for code_tag in list(soup.find_all("code", class_=re.compile(r"\blanguage-mermaid\b"))):
        pre_tag = code_tag.parent
        if pre_tag and pre_tag.name == "pre":
            code_text = code_tag.get_text().strip()
            diag = soup.new_tag(
                "div",
                attrs={
                    "data-type": "diagram",
                    "data-engine": "mermaid",
                    "data-look": "classic",
                    "data-code": code_text,
                },
            )
            pre_tag.replace_with(diag)


def _render_markdown_fragment(body: str) -> BeautifulSoup:
    """Render Markdown body (without toggles) into TipTap-compatible HTML soup."""
    soup = BeautifulSoup(_markdown.render(body), "html.parser")
    _task_lists(soup)
    _callouts(soup)
    _table_of_contents(soup)
    _diagram_blocks(soup)
    _status_badges(soup)
    return soup


def _inject_toggles(soup: BeautifulSoup, toggles: list[tuple[str, bool, str]]) -> None:
    """Replace toggle placeholders with ``div[data-type='toggle']`` structures."""
    if not toggles:
        return
    for index, (summary, is_open, inner_body) in enumerate(toggles):
        token = f"WIKIHUBTOGGLEBLOCK{index}END"
        target = next(
            (p for p in soup.find_all("p") if not p.find(True) and p.get_text().strip() == token),
            None,
        )
        if target is None:
            continue
        toggle = soup.new_tag(
            "div",
            attrs={
                "data-type": "toggle",
                "data-open": "true" if is_open else "false",
            },
        )
        summary_div = soup.new_tag("div", attrs={"data-type": "toggle-summary"})
        summary_html = _markdown.renderInline(summary.strip() or "Details")
        for child in list(BeautifulSoup(summary_html, "html.parser").contents):
            summary_div.append(child)

        content_div = soup.new_tag("div", attrs={"data-type": "toggle-content"})
        inner_soup = _render_markdown_fragment(inner_body)
        for child in list(inner_soup.contents):
            content_div.append(child)
        if not content_div.find(True):
            content_div.append(soup.new_tag("p"))

        toggle.append(summary_div)
        toggle.append(content_div)
        target.replace_with(toggle)


def draft_to_html(
    body: str, lang: str | None = None, *, notice: bool = True, keep_h1: bool = False
) -> str:
    """The sanitised page HTML: the AI banner, then the drafted body."""
    stripped_body, toggles = _extract_toggles(body)
    soup = _render_markdown_fragment(stripped_body)
    _inject_toggles(soup, toggles)
    # A leading level-one heading would only repeat the page title.
    first = soup.find(True)
    if not keep_h1 and isinstance(first, Tag) and first.name == "h1":
        first.decompose()
    content = sanitize_imported_html(str(soup))
    return ((ai_notice(lang) if notice else "") + content)[:MAX_PAGE_CONTENT_CHARS]
