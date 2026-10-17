#!/usr/bin/env python3
"""Turn the in-app Help page into the text the AI assistant reads to answer "how do I...".

The Help page is JSX (frontend/components/help/help-content.{en,vi}.tsx). The assistant lives in
the backend, which has no access to it, so this script copies the *words* of each section into
backend/app/assets/help_{en,vi}.json: id, title, category, keywords and plain text.

Run it again whenever Help changes (``python scripts/build_help_knowledge.py``); ``--check``
exits 1 when the committed files are out of date, for CI or a pre-commit hook.
"""

from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = {
    "en": ROOT / "frontend/components/help/help-content.en.tsx",
    "vi": ROOT / "frontend/components/help/help-content.vi.tsx",
}
OUT = ROOT / "backend/app/assets"

_SECTION = re.compile(
    r'\n  \{\n    id: "(?P<id>[^"]+)",\n    title: (?P<title>"(?:[^"\\]|\\.)*"),\n'
    r'    category: "(?P<category>[^"]+)",',
)
_KEYWORDS = re.compile(r"keywords:\s*\[(.*?)\]", re.S)
_BODY = re.compile(r"body:\s*\(", re.S)
_BREAKS = re.compile(r"</?(?:p|li|ul|ol|h\d|tr|table|div|section|Callout|Quote|br)\b[^>]*>")
_CELL = re.compile(r"</(?:td|th)>")
_SCREENSHOT = re.compile(r"<Screenshot\b.*?/>", re.S)
_COMMENT = re.compile(r"\{/\*.*?\*/\}", re.S)
_EXPR_SPACE = re.compile(r'\{" "\}')
_EXPR_STRING = re.compile(r'\{"([^"{}]*)"\}')
_EXPR = re.compile(r"\{[^{}]*\}")
_TAG = re.compile(r"<[^>]+>")


def plain(jsx: str) -> str:
    """The readable words of a piece of JSX."""
    text = _SCREENSHOT.sub("", jsx)
    text = _COMMENT.sub("", text)
    text = _EXPR_SPACE.sub(" ", text)
    text = _EXPR_STRING.sub(r"\1", text)
    text = _BREAKS.sub("\n", text)
    text = _CELL.sub(" | ", text)
    text = _TAG.sub("", text)
    text = _EXPR.sub("", text)
    text = html.unescape(text)
    lines = (" ".join(line.split()) for line in text.splitlines())
    return "\n".join(line for line in lines if line)


def sections(source: str) -> list[dict[str, object]]:
    found = list(_SECTION.finditer(source))
    result = []
    for index, match in enumerate(found):
        end = found[index + 1].start() if index + 1 < len(found) else len(source)
        block = source[match.end() : end]
        body = _BODY.search(block)
        keywords = _KEYWORDS.search(block[: body.start()] if body else block)
        result.append(
            {
                "id": match.group("id"),
                "title": json.loads(match.group("title")),
                "category": match.group("category"),
                "keywords": re.findall(r'"([^"]+)"', keywords.group(1)) if keywords else [],
                "text": plain(block[body.end() :]) if body else "",
            }
        )
    return result


def build() -> dict[str, str]:
    files = {}
    for lang, path in SOURCES.items():
        data = sections(path.read_text(encoding="utf-8"))
        files[f"help_{lang}.json"] = json.dumps(data, ensure_ascii=False, indent=1) + "\n"
    return files


def main() -> int:
    files = build()
    if "--check" in sys.argv:
        stale = [
            name
            for name, text in files.items()
            if not (OUT / name).exists() or (OUT / name).read_text(encoding="utf-8") != text
        ]
        if stale:
            print(f"Out of date: {', '.join(stale)}. Run scripts/build_help_knowledge.py")
            return 1
        return 0
    for name, text in files.items():
        (OUT / name).write_text(text, encoding="utf-8", newline="\n")
        print(f"wrote {OUT / name} ({len(text) // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
