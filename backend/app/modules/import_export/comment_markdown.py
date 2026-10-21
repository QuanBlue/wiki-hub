"""Confluence comment bodies (storage-format XHTML) as the Markdown WikiHub comments are written in.

A WikiHub comment is Markdown (see the frontend's ``IssueMarkdown``): paragraphs, **bold**,
_italic_, `code`, fenced code, links, quotes and lists. A Confluence comment is the same
storage format as a page, so this keeps what those can say and turns Confluence's own
elements into their nearest equivalent: a user link becomes an ``@username`` mention, an
attached file or image a ``[name](attachment:<id>)`` link that opens it, a code macro a
fenced block. Styling (colours, margins) is dropped.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field

from bs4 import BeautifulSoup, NavigableString, Tag

#: The longest comment WikiHub keeps (``schemas.comment.MAX_COMMENT_LENGTH``).
MAX_CHARS = 5000

_BLOCKS = frozenset(
    {"p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "pre", "blockquote", "table"}
)
_EMOTICONS = {
    "smile": "🙂",
    "sad": "🙁",
    "cheeky": "😛",
    "laugh": "😄",
    "wink": "😉",
    "thumbs-up": "👍",
    "thumbs-down": "👎",
    "information": "2139Fe0f",
    "tick": "✅",
    "cross": "❌",
    "warning": "⚠️",
    "plus": "2795",
    "minus": "2796",
    "question": "❓",
    "light-on": "💡",
    "yellow-star": "⭐",
    "heart": "❤️",
}


@dataclass(slots=True)
class CommentMarkdown:
    body: str
    #: Usernames the comment links to (``@name``), for the comment's mentions.
    mentions: list[str] = field(default_factory=list)


def _wrap(text: str, mark: str) -> str:
    """``text`` in bold or italic marks - unless it holds a link or marks of its own, which
    the comment renderer cannot nest: then plain, so the link still works."""
    core = text.strip()
    if not core or "](" in core or "**" in core or "_" in core or "`" in core:
        return text
    lead, tail = text[: len(text) - len(text.lstrip())], text[len(text.rstrip()) :]
    return f"{lead}{mark}{core}{mark}{tail}"


def _join_code_runs(body: str) -> str:
    """One code span where Confluence wrote one per word: code pasted from a highlighter
    arrives as ``<code>select</code> <code>count</code><code>(</code>...``."""
    out: list[str] = []
    fenced = False
    for line in body.split("\n"):
        if line.startswith("```"):
            fenced = not fenced
        elif not fenced and "`" in line:
            line = line.replace("``", "").replace("` `", " ")
        out.append(line)
    return "\n".join(out)


def storage_to_markdown(
    markup: str,
    *,
    username: Callable[[str], str | None],
    attachment_id: Callable[[str], str | None],
) -> CommentMarkdown:
    """``markup`` as Markdown. ``username`` turns a Confluence user key or name into a
    WikiHub username; ``attachment_id`` an attached file's name into its id (or ``None``)."""
    soup = BeautifulSoup(markup or "", "html.parser")
    mentions: list[str] = []

    def inline(node: Tag | NavigableString) -> str:
        if isinstance(node, NavigableString):
            return re.sub(r"\s+", " ", str(node).replace("\xa0", " "))
        name = node.name or ""
        inner = "".join(inline(child) for child in node.children)
        if name == "br":
            return "\n"
        if name in {"strong", "b"}:
            return _wrap(inner, "**")
        if name in {"em", "i"}:
            return _wrap(inner, "_")
        if name == "code":
            return f"`{inner.strip()}`" if inner.strip() else ""
        if name == "a":
            href = (node.get("href") or "").strip()
            text = inner.strip() or href
            if re.match(r"^https?://", href):
                return href if text == href else f"[{text}]({href})"
            return text
        if name == "ac:link":
            return _ac_link(node, inner)
        if name == "ac:image":
            return _ac_image(node)
        if name == "ac:emoticon":
            return _EMOTICONS.get(node.get("ac:name", ""), "")
        if name in {"ac:parameter", "ac:placeholder"}:
            return ""
        if name in _BLOCKS or name in {"li", "ac:structured-macro", "ac:task-list"}:
            return " " + block(node).replace("\n", " ") + " "
        return inner

    def _ac_link(node: Tag, inner: str) -> str:
        label_node = node.find(["ac:plain-text-link-body", "ac:link-body"])
        label = label_node.get_text(" ", strip=True) if label_node else ""
        user = node.find("ri:user")
        if user is not None:
            ref = user.get("ri:userkey") or user.get("ri:username") or user.get("ri:account-id")
            name = username(ref) if ref else None
            if name:
                if name not in mentions:
                    mentions.append(name)
                return f"@{name}"
            return label or ""
        attachment = node.find("ri:attachment")
        if attachment is not None:
            filename = attachment.get("ri:filename", "")
            return _file_link(label or filename, filename)
        page = node.find("ri:page")
        if page is not None:
            return label or page.get("ri:content-title", "")
        return label or inner.strip()

    def _ac_image(node: Tag) -> str:
        attachment = node.find("ri:attachment")
        if attachment is not None:
            filename = attachment.get("ri:filename", "")
            return _file_link(filename, filename)
        url = node.find("ri:url")
        if url is not None and re.match(r"^https?://", url.get("ri:value", "")):
            return url["ri:value"]
        return ""

    def _file_link(label: str, filename: str) -> str:
        found = attachment_id(filename) if filename else None
        label = label.replace("[", "(").replace("]", ")")
        return f"[{label}](attachment:{found})" if found else label

    def block(node: Tag, depth: int = 0) -> str:
        """A block element (or the whole body) as Markdown lines."""
        name = node.name or ""
        if name in {"ul", "ol", "ac:task-list"}:
            lines = []
            for number, item in enumerate(
                node.find_all(["li", "ac:task"], recursive=False), start=1
            ):
                lines.append(list_item(item, name, number, depth))
            return "\n".join(line for line in lines if line.strip())
        if name == "pre":
            return f"```\n{node.get_text().strip(chr(10))}\n```"
        if name == "ac:structured-macro":
            macro = node.get("ac:name", "")
            if macro in {"code", "noformat"}:
                body = node.find("ac:plain-text-body")
                text = body.get_text() if body else ""
                return f"```\n{text.strip(chr(10))}\n```" if text.strip() else ""
            rich = node.find("ac:rich-text-body")
            if rich is not None:
                return block(rich, depth)
            # A file card ("view-file", "viewpdf", "viewdoc"...): a link that opens the file.
            files = [
                attachment.get("ri:filename", "") for attachment in node.find_all("ri:attachment")
            ]
            return "\n".join(_file_link(name, name) for name in files if name)
        if name == "blockquote":
            inner = block_children(node, depth)
            return "\n".join(f"> {line}" if line else ">" for line in inner.splitlines())
        if name == "table":
            rows = []
            for row in node.find_all("tr"):
                cells = [inline(cell).strip() for cell in row.find_all(["td", "th"])]
                if any(cells):
                    rows.append(" | ".join(cells))
            return "\n".join(rows)
        if name in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            text = "".join(inline(child) for child in node.children).strip()
            return _wrap(text.strip("*"), "**") if text else ""
        return block_children(node, depth)

    def block_children(node: Tag, depth: int) -> str:
        """Children of a container: blocks on their own, runs of inline content as paragraphs."""
        parts: list[str] = []
        run: list[str] = []

        def flush() -> None:
            text = "".join(run)
            text = "\n".join(line.strip() for line in text.split("\n")).strip()
            if text:
                parts.append(text)
            run.clear()

        for child in node.children:
            if isinstance(child, Tag) and (
                child.name in _BLOCKS
                or child.name in {"ac:structured-macro", "ac:task-list", "ac:rich-text-body"}
            ):
                flush()
                rendered = block(child, depth)
                if rendered.strip():
                    parts.append(rendered)
            else:
                run.append(inline(child))
        flush()
        return "\n\n".join(parts)

    def list_item(item: Tag, kind: str, number: int, depth: int) -> str:
        indent = "  " * depth
        if kind == "ac:task-list":
            done = (item.find("ac:task-status") or Tag(name="x")).get_text().strip() == "complete"
            body = item.find("ac:task-body")
            text = "".join(inline(child) for child in body.children).strip() if body else ""
            return f"{indent}- [{'x' if done else ' '}] {text}"
        marker = f"{number}." if kind == "ol" else "-"
        text_parts: list[str] = []
        nested: list[str] = []
        for child in item.children:
            if isinstance(child, Tag) and child.name in {"ul", "ol"}:
                nested.append(block(child, depth + 1))
            elif isinstance(child, Tag) and child.name == "p":
                text_parts.append("".join(inline(c) for c in child.children) + " ")
            else:
                text_parts.append(inline(child))
        text = re.sub(r"[ \t]+", " ", "".join(text_parts)).strip()
        lines = [f"{indent}{marker} {text}"] if text else []
        lines.extend(n for n in nested if n.strip())
        return "\n".join(lines)

    body = _join_code_runs(block_children(soup, 0))
    body = re.sub(r"[ \t]+\n", "\n", body)
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    if len(body) > MAX_CHARS:
        body = body[: MAX_CHARS - 1].rstrip() + "…"
    return CommentMarkdown(body, mentions)
