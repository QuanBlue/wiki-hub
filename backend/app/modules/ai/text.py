"""Plain text from page markup."""

from __future__ import annotations

import html
import re


def page_plain_text(content: str, limit: int) -> str:
    """Strip markup and collapse whitespace; cut to ``limit`` characters."""
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", content or "", flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()[:limit]
