"""Turning what someone typed into something the database can rank by.

Pure functions, no database: normalising text the same way the database does,
dropping filler words, recognising Vietnamese/English synonyms, and picking the
passage of a page worth showing under its title.
"""

from __future__ import annotations

import html
import re
import unicodedata
from dataclasses import dataclass, field

from app.modules.search.ddl import IP_MARKER
from app.modules.search.synonyms import MAX_WORDS, SYNONYMS

#: Characters the database also treats as word breaks (see ``wh_unaccent``), so
#: ``tessel_v2`` or ``monitoring.tessel.vn`` are found by "tessel".
_BREAKS = str.maketrans("_.-/:@", "      ")

#: Words that say nothing about *which* page is wanted. Without dropping them,
#: a natural question ("ip của Tessel Abbott là bao nhiêu?") would match
#: nearly every page through "của", "là" and "bao". Written folded.
STOPWORDS = frozenset(
    (  # noqa: SIM905
        "a an and are as at be by for from how in is it of on or that the this to was what when "
        "where which who why with "
        "la cua va hay the nao gi o dau khong co cho cac nhung mot nay do duoc de voi trong khi "
        "bao nhieu bi thi ma nhu den tu"
    ).split()
)

#: A query is cut to this many meaningful terms; more adds noise, not precision.
MAX_CONCEPTS = 8


def fold_char(char: str) -> str:
    """One character, lower-cased and without accents; always exactly one character."""
    if char in "đĐ":
        return "d"
    base = "".join(c for c in unicodedata.normalize("NFD", char) if not unicodedata.combining(c))
    return (base[:1] or char).lower()


def fold(value: str) -> str:
    """Lower-case, accent-free text with word breaks as spaces (mirrors the database)."""
    return "".join(fold_char(c) for c in value).translate(_BREAKS)


@dataclass(frozen=True)
class Concept:
    """One idea in the query: the words typed, or any synonym of them."""

    #: The user's own words, folded.
    words: tuple[str, ...]
    #: Other phrases meaning the same, each a tuple of folded words.
    synonyms: tuple[tuple[str, ...], ...] = field(default=())

    def _phrase(self, words: tuple[str, ...], *, prefix: bool) -> str:
        parts = [f"'{w}':*" if prefix and len(w) >= 3 else f"'{w}'" for w in words]
        return "(" + " <-> ".join(parts) + ")"

    def tsquery(self) -> str:
        """The ``to_tsquery('simple', ...)`` text matching any form of this idea.

        Only the user's own words may be a prefix ("nuti" finds "nutifood"); a
        synonym must match exactly, or "acc" would drag in everything.
        """
        forms = [self._phrase(self.words, prefix=True)]
        forms.extend(self._phrase(s, prefix=False) for s in self.synonyms)
        return " | ".join(forms)

    def terms(self) -> list[str]:
        """Every folded form, for highlighting and for locating a passage."""
        return [" ".join(self.words), *(" ".join(s) for s in self.synonyms)]


#: Filler that only its accents tell apart from a word worth keeping: "đang" ("is ...-ing")
#: says nothing about a page, but folded it is "dang" - the surname Đặng, and "đăng" in
#: "đăng nhập". So it is dropped as typed, before folding.
_ACCENTED_FILLER = re.compile(r"(?<!\w)đang(?!\w)", re.IGNORECASE)


def build_concepts(query: str) -> list[Concept]:
    """The meaningful ideas in ``query``, synonyms attached, filler removed."""
    words = re.findall(r"\w+", fold(_ACCENTED_FILLER.sub(" ", query)))
    concepts: list[Concept] = []
    seen: set[tuple[str, ...]] = set()
    i = 0
    while i < len(words) and len(concepts) < MAX_CONCEPTS:
        # The longest known phrase starting here wins ("co so du lieu" before "co").
        for size in range(min(MAX_WORDS, len(words) - i), 0, -1):
            phrase = tuple(words[i : i + size])
            others = SYNONYMS.get(" ".join(phrase))
            if others:
                if phrase not in seen:
                    seen.add(phrase)
                    concepts.append(
                        Concept(phrase, tuple(tuple(o.split()) for o in sorted(others)))
                    )
                i += size
                break
        else:
            word = words[i]
            i += 1
            if word in STOPWORDS or (len(word) < 2 and not word.isdigit()):
                continue
            if (word,) not in seen:
                seen.add((word,))
                concepts.append(Concept((word,)))
    return concepts


#: Words that say a question needs facts combined - counted, added up, compared, a rule
#: applied to a case - rather than one fact looked up. Folded, matched as whole words.
_REASONING_CUES = re.compile(
    r"(?<![a-z0-9])(bao nhieu|tong cong|tong so|tong|cong lai|tru di|nhieu hon|it hon|"
    r"lon nhat|nho nhat|cao nhat|thap nhat|nhieu nhat|it nhat|so sanh|khac nhau|giong nhau|"
    r"dung chung|liet ke|nhung (?:\w+ ){0,3}nao|cac (?:\w+ ){0,3}nao|duoc khong|co nen|nen chon|"
    r"co dat|dat muc|tuan thu|du khong|vi sao|tai sao|neu|how many|how much|total|sum|"
    r"more than|less than|fewer|largest|smallest|compare|comparison|difference|differ|"
    r"which|whether|can i|should i|enough|comply|complies|why|if)(?![a-z0-9])"
)


#: Words that ask for a whole list or every detail: an answer that can run long.
_FULL_LIST_CUES = re.compile(
    r"(?<![a-z0-9])(liet ke|day du|tat ca|toan bo|danh sach|chi tiet|cu the|tung (?:\w+ )?mot|"
    r"list all|list every|full list|complete list|all of|every|in detail|each of)(?![a-z0-9])"
)
#: Words that ask about the previous answer itself - it stopped short or left things out.
_FOLLOW_ON_CUES = re.compile(
    r"(?<![a-z0-9])(tiep tuc|tiep di|viet tiep|liet ke tiep|phan con lai|con lai|con thieu|"
    r"thieu (?:\w+ ){0,3}(?:server|muc|dong|cai|phan)|chi liet ke|chi co|sao (?:\w+ ){0,6}chi|"
    r"continue|go on|the rest|you only|only listed|only gave|missing ones|left out)(?![a-z0-9])"
)


def wants_full_list(question: str) -> bool:
    """Whether the answer is asked to list everything (and so may need a long reply)."""
    return bool(_FULL_LIST_CUES.search(fold(question)))


def asks_about_last_answer(question: str) -> bool:
    """Whether a follow-up is about the previous answer itself: "continue", "you only listed
    22 of 33". Searching its words finds nothing; the previous question is searched instead."""
    return bool(_FOLLOW_ON_CUES.search(fold(question)))


def needs_reasoning(question: str) -> bool:
    """Whether answering takes more than one fact: counting, adding up, comparing, applying a
    rule to a case. Such questions are given more of each page and more pages (a count needs
    the whole table) and are answered under the reasoning rules (``skills.REASONING_RULES``)."""
    return bool(_REASONING_CUES.search(fold(question)))


def query_tokens(query: str) -> list[str]:
    """The words of ``query`` worth searching for, folded and de-duplicated."""
    seen: dict[str, None] = {}
    for word in re.findall(r"\w+", fold(query)):
        if word not in STOPWORDS and (len(word) > 1 or word.isdigit()):
            seen.setdefault(word)
    return list(seen)[:10]


def plain_text(content: str) -> str:
    """Page markup as one line of plain text."""
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", content or "", flags=re.S | re.I)
    text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    return re.sub(r"\s+", " ", text).strip()


_IPV4 = re.compile(r"(?<![0-9.])[0-9]{1,3}(?:\.[0-9]{1,3}){3}(?![0-9.])")


def best_snippet(
    content: str, terms: list[tuple[str, float]], *, max_len: int = 140, lead: int = 40
) -> tuple[str, bool]:
    """The stretch of the page covering the most (and most telling) query terms.

    ``terms`` are folded phrases with a weight each - rarer words weigh more, so
    the passage shown is the one mentioning "nuti", not just "cloud". Matching
    ignores accents and capitals, and a term matches at the start of a word.

    Returns the snippet and whether any term was found in it (when none was, it
    is just the start of the page).
    """
    plain = plain_text(content)
    if not plain:
        return "", False

    def clip(start: int, end: int) -> str:
        snippet = plain[start:end]
        return ("..." if start > 0 else "") + snippet + ("..." if end < len(plain) else "")

    folded = fold(plain)
    found: list[tuple[int, int]] = []  # (position, index into terms)
    for index, (term, _) in enumerate(terms):
        if not term:
            continue
        if term == IP_MARKER:
            # The marker is not in the text: what it stands for is the addresses themselves.
            for count, match in enumerate(_IPV4.finditer(plain)):
                if count >= 200:
                    break
                found.append((match.start(), index))
            continue
        pattern = re.compile(r"(?<![0-9a-z])" + re.escape(term))
        for count, match in enumerate(pattern.finditer(folded)):
            if count >= 200:
                break
            found.append((match.start(), index))
    if not found:
        return clip(0, max_len), False

    best_start, best_score = 0, -1.0
    for position, _ in sorted(found):
        start = max(0, position - lead)
        end = start + max_len
        covered = {index for pos, index in found if start <= pos < end}
        score = sum(terms[index][1] for index in covered)
        if score > best_score:
            best_start, best_score = start, score
    start, end = best_start, min(len(plain), best_start + max_len)
    # Begin and end on a word, not mid-way through one.
    if start > 0 and (cut := plain.find(" ", start, start + 12)) != -1:
        start = cut + 1
    if end < len(plain) and (cut := plain.rfind(" ", end - 12, end)) != -1:
        end = cut
    return clip(start, end), True
