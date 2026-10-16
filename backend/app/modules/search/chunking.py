"""Split a page into passages small enough to embed meaningfully.

One vector per whole page blurs everything on it together; a question such as
"what is Tessel Abbott's IP?" matches a single paragraph or table row. So a page
becomes several passages, each led by the page title and its nearest heading so
it still makes sense on its own.
"""

from __future__ import annotations

import html
import re

#: Aim for passages around this long; a paragraph is never split mid-sentence
#: unless it alone exceeds ``HARD_LIMIT``.
TARGET_CHARS = 900
HARD_LIMIT = 1800

_HEADING = re.compile(r"<h[1-6][^>]*>(.*?)</h[1-6]>", re.S | re.I)
_BLOCK_END = re.compile(r"</(?:p|li|tr|div|blockquote|pre|h[1-6]|table|ul|ol)>|<br\s*/?>", re.I)
_TAG = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")
_SENTENCE_END = re.compile(r"(?<=[.!?。])\s+")


def _clean(fragment: str) -> str:
    return _SPACE.sub(" ", html.unescape(_TAG.sub(" ", fragment))).strip()


def _blocks(markup: str) -> list[tuple[bool, str]]:
    """``(is_heading, text)`` for each block of the page, in order."""
    markup = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", markup or "", flags=re.S | re.I)
    out: list[tuple[bool, str]] = []
    position = 0
    for match in _HEADING.finditer(markup):
        out.extend((False, text) for text in _plain_blocks(markup[position : match.start()]))
        heading = _clean(match.group(1))
        if heading:
            out.append((True, heading))
        position = match.end()
    out.extend((False, text) for text in _plain_blocks(markup[position:]))
    return out


def _plain_blocks(markup: str) -> list[str]:
    texts = (_clean(part) for part in _BLOCK_END.split(markup) if part)
    return [text for text in texts if text]


def _split_long(text: str) -> list[str]:
    """Break one oversized block on sentence ends, then by length as a last resort."""
    if len(text) <= HARD_LIMIT:
        return [text]
    pieces: list[str] = []
    current = ""
    for sentence in _SENTENCE_END.split(text):
        while len(sentence) > HARD_LIMIT:
            if current:
                pieces.append(current)
                current = ""
            pieces.append(sentence[:HARD_LIMIT])
            sentence = sentence[HARD_LIMIT:]
        if current and len(current) + len(sentence) + 1 > TARGET_CHARS:
            pieces.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        pieces.append(current)
    return pieces


def chunk_page(title: str, markup: str, *, max_chunks: int) -> list[str]:
    """Passages of the page, each prefixed with its title and heading.

    A page with no body still yields one passage (its title) so it can be found
    by name. At most ``max_chunks`` passages are returned.
    """
    title = _clean(title)
    passages: list[tuple[str, str]] = []  # (heading, text)
    heading = ""
    buffer = ""
    buffer_heading = ""

    def flush() -> None:
        nonlocal buffer
        if buffer:
            passages.append((buffer_heading, buffer))
            buffer = ""

    for is_heading, text in _blocks(markup):
        if is_heading:
            flush()
            heading = text
            continue
        for piece in _split_long(text):
            if buffer and len(buffer) + len(piece) + 1 > TARGET_CHARS:
                flush()
            if not buffer:
                buffer_heading = heading
            buffer = f"{buffer}\n{piece}".strip()
    flush()

    if not passages:
        return [title] if title else []

    chunks = []
    for passage_heading, text in passages[:max_chunks]:
        lead = (
            title
            if not passage_heading or passage_heading == title
            else (f"{title} - {passage_heading}")
        )
        chunks.append(f"{lead}\n{text}")
    return chunks
