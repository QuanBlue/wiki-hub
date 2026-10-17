"""The in-app Help page, as something the assistant can look things up in.

``scripts/build_help_knowledge.py`` copies the words of every Help section into
``app/assets/help_{en,vi}.json``. Here they are cut into short passages and searched for the
words of a question (in either language: a Vietnamese question finds the Vietnamese passage, an
English one the English), so "can the app back up on a schedule?" is answered from what the
Help page actually says about automatic backups, not from a summary someone wrote of it.

Sections of the Administration category are marked as such, so the assistant can tell someone
who is not an administrator that a thing exists and who does it.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from functools import lru_cache
from itertools import pairwise
from pathlib import Path

from app.modules.ai.assistant_context import fold

_ASSETS = Path(__file__).resolve().parent.parent.parent / "assets"
_CHUNK_CHARS = 1000
#: How many passages go to the model, and how many of them may come from one section.
MAX_PASSAGES = 5
MAX_PER_SECTION = 3
#: Below this a match is a coincidence of common words, not an answer.
MIN_SCORE = 6.0

_WORD = re.compile(r"[a-z0-9]+")
_STOP = frozenset(
    [
        "a",
        "an",
        "the",
        "of",
        "to",
        "in",
        "on",
        "at",
        "for",
        "is",
        "are",
        "be",
        "do",
        "does",
        "can",
        "how",
        "what",
        "why",
        "when",
        "where",
        "which",
        "who",
        "i",
        "my",
        "me",
        "we",
        "you",
        "it",
        "this",
        "that",
        "and",
        "or",
        "not",
        "with",
        "from",
        "by",
        "as",
        "if",
        "so",
        "no",
        "yes",
        "any",
        "app",
        "wikihub",
        "la",
        "va",
        "cua",
        "co",
        "the",
        "khong",
        "nao",
        "gi",
        "sao",
        "nhu",
        "nay",
        "do",
        "cho",
        "toi",
        "minh",
        "ban",
        "duoc",
        "de",
        "trong",
        "mot",
        "cac",
        "nhung",
        "thi",
        "hay",
        "hoac",
        "voi",
        "tu",
        "den",
        "khi",
        "ma",
        "dang",
        "se",
        "da",
        "bi",
        "ung",
        "dung",
    ]
)


def _root(word: str) -> str:
    # Vietnamese is typed with i or y (ki / ky) and English plurals vary: match the root.
    word = word.replace("y", "i")
    return word[:-1] if len(word) > 3 and word.endswith("s") else word


def _tokens(text: str) -> set[str]:
    """The words of a text and its pairs of neighbouring words.

    Vietnamese words are made of short syllables (``sao luu`` is "back up", ``mat khau`` is
    "password"), each of which means little alone, so pairs carry the meaning.
    """
    words = [_root(word) for word in _WORD.findall(fold(text))]
    found = {word for word in words if len(word) >= 2 and word not in _STOP}
    found.update(f"{a} {b}" for a, b in pairwise(words) if len(a + b) >= 5)
    return found


@dataclass(frozen=True)
class Passage:
    section_id: str
    title: str
    category: str
    text: str
    tokens: frozenset[str]
    #: Words in the section's title and keywords: a hit there counts for more.
    heading: frozenset[str]

    @property
    def admin_only(self) -> bool:
        return self.category == "Administration"


def _chunks(text: str) -> list[str]:
    """Whole lines, grouped up to about ``_CHUNK_CHARS`` characters."""
    out: list[str] = []
    current = ""
    for line in text.splitlines():
        if line.strip() in ("<>", "</>"):
            continue
        if current and len(current) + len(line) > _CHUNK_CHARS:
            out.append(current)
            current = ""
        current += ("\n" if current else "") + line
    if current:
        out.append(current)
    return out


@lru_cache(maxsize=1)
def _index() -> tuple[list[Passage], dict[str, float]]:
    passages: list[Passage] = []
    for lang in ("en", "vi"):
        path = _ASSETS / f"help_{lang}.json"
        if not path.exists():
            continue
        for section in json.loads(path.read_text(encoding="utf-8")):
            heading = _tokens(section["title"] + " " + " ".join(section.get("keywords", [])))
            for chunk in _chunks(section["text"]):
                passages.append(
                    Passage(
                        section_id=section["id"],
                        title=section["title"],
                        category=section["category"],
                        text=chunk,
                        tokens=frozenset(_tokens(chunk) | heading),
                        heading=frozenset(heading),
                    )
                )
    document_frequency: dict[str, int] = {}
    for passage in passages:
        for token in passage.tokens:
            document_frequency[token] = document_frequency.get(token, 0) + 1
    total = max(len(passages), 1)
    idf = {t: math.log(1 + total / n) for t, n in document_frequency.items()}
    return passages, idf


@lru_cache(maxsize=2)
def section_titles(lang: str) -> dict[str, tuple[str, str]]:
    """Section id -> (title, category) in one language, for naming a guide to the reader."""
    path = _ASSETS / f"help_{lang}.json"
    if not path.exists():  # pragma: no cover - both files are shipped and checked by a test
        return {}
    return {
        section["id"]: (section["title"], section["category"])
        for section in json.loads(path.read_text(encoding="utf-8"))
    }


def search(
    question: str, *, prefer: frozenset[str] | set[str] = frozenset(), limit: int = MAX_PASSAGES
) -> list[Passage]:
    """The passages of Help that best match the words of ``question``; none when none really do.

    ``prefer`` names sections the question is known to be about: their passages count for more
    and need less of a match, since the topic has already told us where to look.
    """
    passages, idf = _index()
    wanted = _tokens(question)
    if not wanted or not passages:
        return []
    scored: list[tuple[float, int, Passage]] = []
    for order, passage in enumerate(passages):
        hits = wanted & passage.tokens
        if not hits:
            continue
        score = sum(idf[t] * (2.0 if t in passage.heading else 1.0) for t in hits)
        if passage.section_id in prefer:
            score *= 2.0
        scored.append((score, -order, passage))
    scored.sort(key=lambda item: item[:2], reverse=True)
    if not scored or scored[0][0] < (MIN_SCORE / 2 if prefer else MIN_SCORE):
        return []
    best = scored[0][0]
    chosen: list[Passage] = []
    per_section: dict[str, int] = {}
    seen: set[str] = set()
    for score, _, passage in scored:
        if score < best * 0.45 or len(chosen) >= limit:
            break
        # Both languages say the same thing: one passage per section is enough of each.
        if per_section.get(passage.section_id, 0) >= MAX_PER_SECTION or passage.text in seen:
            continue
        per_section[passage.section_id] = per_section.get(passage.section_id, 0) + 1
        seen.add(passage.text)
        chosen.append(passage)
    return chosen


def help_block(passages: list[Passage], *, is_admin: bool) -> str:
    """The passages as the model reads them."""
    parts = ["<help>"]
    for passage in passages:
        audience = "administrators" if passage.admin_only else "everyone"
        title = passage.title.replace('"', "'")
        parts.append(f'<section title="{title}" audience="{audience}">\n{passage.text}\n</section>')
    parts.append("</help>")
    if not is_admin and any(p.admin_only for p in passages):
        parts.append(
            "(This person is NOT an administrator: for sections whose audience is administrators, "
            "say that the feature exists and that an administrator sets it up, and do not send "
            "them to administration pages.)"
        )
    return "\n".join(parts)
