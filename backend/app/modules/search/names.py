"""Matching what someone typed against a short name: a space, a person.

A name is typed the way people remember it, not the way it is stored. The space
"dms1.0" is asked for as "dms1", "DMs1", "dms 1", "dms_1" or "DMS10"; the person
"Nguyễn Văn Quân" as "quân", "quan nguyen" or "nguyen q". Comparing the raw text
(``ILIKE '%dms 1%'``) finds none of those. Here both sides are folded (no accents,
no capitals) and compared three ways - squashed together without spaces or
punctuation, word by word, and loosely for a slip of the keyboard - and the
closest kind of match decides the score.

Pure functions, no database.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher

from app.modules.search.query import fold

_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_WORD = re.compile(r"[a-z0-9]+")

#: How sure a match is, best first. The kinds never overlap: a better kind always wins.
EXACT = 100.0
PREFIX = 85.0
WORD_PREFIX = 75.0
CONTAINS = 60.0
WORDS_INSIDE = 50.0
#: A loose match scores at most this, scaled by how alike the two are.
FUZZY = 40.0
#: How alike (0 to 1) a typed name must be to count as a slip of the keyboard.
_FUZZY_RATIO = 0.75
#: Shorter than this and every name is "alike": "ab" is one letter from half the wiki.
_FUZZY_MIN_CHARS = 4
#: A name matched at least this well is the one meant ("space:dms1" picks dms1.0, not every
#: space that merely shares a word with it).
STRONG = CONTAINS

#: What :func:`compact` takes out, for its SQL twin (see ``ddl.compact_key_sql``).
COMPACT_SQL_PATTERN = "[^a-z0-9]+"


def compact(value: str) -> str:
    """Folded, with everything but letters and digits taken out: "DMS 1.0" -> "dms10"."""
    return _NON_ALNUM.sub("", fold(value or ""))


def name_words(value: str) -> list[str]:
    """The folded words of ``value``: "Nguyễn Văn-Quân" -> ["nguyen", "van", "quan"]."""
    return _WORD.findall(fold(value or ""))


def _closeness(typed: str, name: str) -> float:
    """0 to 5: how much of the name was typed, so "dms1" ranks "dms1.0" above "dms1.0 archive"."""
    return 5.0 * len(typed) / max(len(name), 1)


def _fuzzy(typed: str, name: str, words: list[str]) -> float:
    """How alike a typed name is to the name, its start or one of its words (0 to 1)."""
    if len(typed) < _FUZZY_MIN_CHARS:
        return 0.0
    candidates = [name, name[: len(typed)], *(w for w in words if len(w) >= _FUZZY_MIN_CHARS)]
    return max(SequenceMatcher(None, typed, other).ratio() for other in candidates)


def name_score(query: str, name: str) -> float:
    """How well ``query`` names ``name``: 0 when it does not, up to :data:`EXACT` + 5.

    - :data:`EXACT`: the same once squashed ("dms_1.0" for "DMS 1.0").
    - :data:`PREFIX`: the start of it ("dms1", "dms 1" for "dms1.0").
    - :data:`WORD_PREFIX`: every typed word begins a word of it, in any order ("quan nguyen"
      for "Nguyễn Văn Quân").
    - :data:`CONTAINS`: inside it, squashed ("ops" for "DevOps").
    - :data:`WORDS_INSIDE`: every typed word is inside it somewhere.
    - up to :data:`FUZZY`: one or two letters off ("dsm1" for "dms1").
    """
    typed, whole = compact(query), compact(name)
    if not typed or not whole:
        return 0.0
    if typed == whole:
        return EXACT
    if len(typed) < 2:
        # One letter says nothing about which name is meant.
        return 0.0
    if whole.startswith(typed):
        return PREFIX + _closeness(typed, whole)
    typed_words, words = name_words(query), name_words(name)
    if typed_words and all(any(w.startswith(t) for w in words) for t in typed_words):
        return WORD_PREFIX + _closeness(typed, whole)
    if typed in whole:
        return CONTAINS + _closeness(typed, whole)
    if len(typed_words) > 1 and all(t in whole for t in typed_words):
        return WORDS_INSIDE + _closeness(typed, whole)
    ratio = _fuzzy(typed, whole, words)
    return FUZZY * ratio if ratio >= _FUZZY_RATIO else 0.0


def best_name_score(query: str, *names: str | None) -> float:
    """The best :func:`name_score` of ``query`` over several names of one thing."""
    return max((name_score(query, name) for name in names if name), default=0.0)


def mentions_all_words(query: str, text: str) -> bool:
    """Whether every typed word begins a word of ``text`` (a description, say)."""
    typed = name_words(query)
    if not typed or not text:
        return False
    words = name_words(text)
    return all(any(w.startswith(t) for w in words) for t in typed if len(t) >= 2) and any(
        len(t) >= 2 for t in typed
    )
