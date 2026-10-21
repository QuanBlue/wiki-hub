"""Finding the other pages a page points at, from its text alone.

Pure functions, no database. Two kinds of pointer:

* a **link** the author inserted - ``/spaces/{key}/pages/{slug}``, the form the
  editor's "link to a page" writes;
* a **mention** - the page names another page by its exact title ("…fill in the
  Leave request form…" when a page is called "Leave request form"). Nobody has to
  link anything for it to count, which matters: people rarely do.

Titles are compared folded (lower case, no accents, ``_.-/:@`` as spaces) and on
word boundaries, the same way search folds text.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from urllib.parse import unquote

from app.modules.search.query import STOPWORDS, fold, plain_text

#: A link to a page, absolute or relative, in HTML (``href="..."``) or Markdown
#: (``](...)``); group 1 is the space key, group 2 the slug (percent-encoded as the
#: editor writes it).
_PAGE_HREF = re.compile(
    r"""(?:href\s*=\s*["']|\]\()(?:https?://[^/"'()\s]+)?"""
    r"""/spaces/([^/"'?#()\s]+)/pages/([^/"'?#()\s]+)""",
    re.I,
)
_WORD = re.compile(r"\w+")

#: Titles that name a kind of page, not one page: matching them would tie every
#: page that says "overview" to whichever page happens to be called that. Folded.
GENERIC_TITLES = frozenset(
    {
        "about",
        "agenda",
        "changelog",
        "contact",
        "contacts",
        "draft",
        "faq",
        "faqs",
        "gioi thieu",
        "glossary",
        "guide",
        "help",
        "home",
        "huong dan",
        "index",
        "introduction",
        "meeting notes",
        "misc",
        "notes",
        "overview",
        "readme",
        "summary",
        "tai lieu",
        "test",
        "todo",
        "tong quan",
        "untitled",
        "ghi chu",
        "bien ban hop",
        "trang chu",
    }
)

#: A one-word title shorter than this is too likely to be a common word or an
#: acronym that means something else elsewhere ("AM", "PMO", "API").
MIN_SINGLE_WORD_CHARS = 6
#: Longer titles are left out of mention matching: nobody repeats them verbatim.
MAX_TITLE_WORDS = 12
#: More mentions than this from one page are noise (a list of every page).
MAX_MENTIONS_PER_PAGE = 30


def title_words(title: str) -> tuple[str, ...]:
    """The folded words of a title, as matched against text."""
    return tuple(_WORD.findall(fold(title)))


#: The " (2)" a page gets when it is a copy of another with the same title.
_COPY_SUFFIX = re.compile(r"\s*\(\d+\)\s*$")


def copy_key(title: str) -> tuple[str, ...]:
    """What copies of one page have in common: their title without a "(2)"."""
    return title_words(_COPY_SUFFIX.sub("", title))


def is_matchable_title(words: tuple[str, ...]) -> bool:
    """Whether a title is specific enough that naming it means that page."""
    if not words or len(words) > MAX_TITLE_WORDS:
        return False
    if " ".join(words) in GENERIC_TITLES:
        return False
    if all(word in STOPWORDS or word.isdigit() for word in words):
        return False
    return not (len(words) == 1 and len(words[0]) < MIN_SINGLE_WORD_CHARS)


def internal_links(content: str) -> list[tuple[str, str]]:
    """``(space key, slug)`` of every page the markup links to, in order, once each."""
    seen: dict[tuple[str, str], None] = {}
    for match in _PAGE_HREF.finditer(content or ""):
        seen.setdefault((unquote(match.group(1)), unquote(match.group(2))))
    return list(seen)


@dataclass(frozen=True)
class TitledPage:
    id: uuid.UUID
    space_id: uuid.UUID
    title: str


class TitleIndex:
    """Every matchable title, ready to be found in a page's text."""

    def __init__(self, pages: Iterable[TitledPage]) -> None:
        self._by_words: dict[tuple[str, ...], list[TitledPage]] = {}
        for page in pages:
            words = title_words(page.title)
            if is_matchable_title(words):
                self._by_words.setdefault(words, []).append(page)
        self._longest = max((len(words) for words in self._by_words), default=0)

    def __len__(self) -> int:
        return len(self._by_words)

    def resolve(self, words: tuple[str, ...], space_id: uuid.UUID) -> TitledPage | None:
        """The one page these words name, seen from a page in ``space_id``.

        A title shared by several pages names the one in the same space; if that
        is still more than one (copies of a page), it names none of them.
        """
        candidates = self._by_words.get(words)
        if not candidates:
            return None
        if len(candidates) > 1:
            candidates = [page for page in candidates if page.space_id == space_id]
        return candidates[0] if len(candidates) == 1 else None

    def mentions(
        self, title: str, content: str, *, page_id: uuid.UUID, space_id: uuid.UUID
    ) -> list[uuid.UUID]:
        """Pages whose title the page's text names, in order of first mention.

        At each word the longest title starting there wins, so "leave request form"
        is one mention, not also one of "leave request". The page's own title (and
        so its copies' titles) never counts.
        """
        if not self._by_words:
            return []
        own = title_words(title)
        words = _WORD.findall(fold(plain_text(content)))
        found: dict[uuid.UUID, None] = {}
        i = 0
        while i < len(words) and len(found) < MAX_MENTIONS_PER_PAGE:
            for size in range(min(self._longest, len(words) - i), 0, -1):
                phrase = tuple(words[i : i + size])
                if phrase not in self._by_words:
                    continue
                if phrase != own:
                    target = self.resolve(phrase, space_id)
                    if target is not None and target.id != page_id:
                        found.setdefault(target.id)
                i += size
                break
            else:
                i += 1
        return list(found)
