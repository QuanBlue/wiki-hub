"""Translating an imported page with the AI assistant, without touching its structure.

The page is taken apart into *units*: the runs of text and inline formatting inside a paragraph,
list item, table cell or heading. Each unit goes to the model as a small piece of HTML and comes
back the same shape in the other language; it is put back in place only if its skeleton is
unchanged (the same tags in the same order, the same link targets and image sources, the same
code). The tables, lists, images, colours and widths of the page are therefore exactly what they
were, whatever the model does, and a unit the model gets wrong is left in its own language and
counted rather than risked.

Code blocks and inline code are never translated.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from bs4 import BeautifulSoup, Comment, NavigableString, Tag

from app.core.logging import get_logger

logger = get_logger(__name__)

LANGUAGES = {"en": "English", "vi": "Vietnamese"}

#: Units per call, and the HTML characters a call may carry: small enough that a reply fits in
#: the model's output and that one wrong unit costs little to redo.
MAX_UNITS_PER_CALL = 30
MAX_CHARS_PER_CALL = 3500
#: More than this and the document is not translated: it would take the model for hours.
MAX_CHARS = 700_000
CONCURRENCY = 3
#: A reply that failed the checks is asked for again, one unit at a time, up to this many.
MAX_RETRIES_PER_CALL = 4
MAX_LOG_LINES = 40

_INLINE = {
    "a", "abbr", "b", "br", "code", "del", "em", "i", "img", "ins", "kbd", "mark", "s",
    "small", "span", "strong", "sub", "sup", "u",
}  # fmt: skip
_BLOCK = {
    "address", "blockquote", "details", "div", "figcaption", "figure", "h1", "h2", "h3", "h4",
    "h5", "h6", "hr", "li", "ol", "p", "pre", "section", "summary", "table", "tbody", "td",
    "tfoot", "th", "thead", "tr", "ul",
}  # fmt: skip
_NEVER = {"pre", "script", "style"}
_LETTER = re.compile(r"[^\W\d_]")
# Letters only Vietnamese has (French, Spanish share the plain accented vowels: not these).
_VIETNAMESE = re.compile(
    "[ăđơưạảãằắặẳẵầấậẩẫẹẻẽềếệểễỉĩịọỏõồốộổỗờớợởỡụủũừứựửữỳỵỷỹ]", re.IGNORECASE
)

#: ``ask(system, user, max_tokens)`` -> the model's text, or None when it cannot be asked.
Translate = Callable[[str, str], Awaitable[str | None]]
Report = Callable[["Translation"], Awaitable[None]]

RULES = """You are a professional translator of technical and business documents.
You are given a JSON array of units: {"id": number, "html": string}. Each html is a fragment of a
document page (text with inline tags such as <strong>, <em>, <a href>, <code>, <br>, <img>).
Translate every unit into {language}.

Rules:
- Reply with ONLY a JSON array of {"id": number, "html": string}, the same ids, the same count, in
  the same order. No commentary, no code fence.
- Translate the human text only. Keep every tag, attribute, URL and the order of the tags exactly
  as given; do not add, drop, merge or reorder tags. The words inside a tag are translated.
- Never translate the content of <code>, URLs, e-mail addresses, file names, paths, commands,
  identifiers, version numbers or numbers.
- Keep product, brand and company names, protocol and technology names (Kubernetes, PostgreSQL,
  SSO, API...) and established abbreviations as they are; translate what a reader of the
  translation would expect to see translated.
- Use the same translation for the same term throughout, and the register of a formal technical
  document. Keep list numbering, bullets and punctuation conventions of the target language.
- A unit that is already in {language}, or is only a name or number, is returned unchanged.
- Be faithful: translate all of the meaning, add nothing, leave nothing out."""


# ----------------------------------------------------------------------------- language


def detect_language(text: str) -> str:
    """``vi``, ``en`` or ``other``: a quick guess from the letters, enough to skip a no-op.

    Vietnamese is told by its own letters and tone marks; English by there being almost nothing
    but plain ASCII letters. Anything else (French, Chinese...) is "other" and gets translated.
    """
    letters = _LETTER.findall(text)
    if len(letters) < 20:
        return "other"
    vietnamese = sum(1 for ch in letters if _VIETNAMESE.fullmatch(ch))
    if vietnamese / len(letters) >= 0.02:
        return "vi"
    ascii_letters = sum(1 for ch in letters if ch.isascii())
    return "en" if ascii_letters / len(letters) >= 0.99 else "other"


# ------------------------------------------------------------------------------- units


@dataclass
class Unit:
    nodes: list[Any]
    html: str
    #: The words in it that are to be translated: its text without any inline code.
    text: str


def _is_inline(node: Any) -> bool:
    if isinstance(node, Comment):
        return False
    if isinstance(node, NavigableString):
        return True
    return isinstance(node, Tag) and node.name in _INLINE and node.find(_BLOCK) is None


def _prose(nodes: list[Any]) -> str:
    fragment = BeautifulSoup("".join(str(n) for n in nodes), "html.parser")
    for code in fragment.find_all("code"):
        code.decompose()
    return fragment.get_text(" ")


def _runs(container: Any) -> list[list[Any]]:
    """The maximal runs of text and inline tags among one element's children."""
    runs: list[list[Any]] = []
    run: list[Any] = []
    for child in list(container.children):
        if _is_inline(child):
            run.append(child)
        elif run:
            runs.append(run)
            run = []
    if run:
        runs.append(run)
    return runs


def collect_units(soup: BeautifulSoup) -> list[Unit]:
    """The runs of text and inline tags, in document order, that hold something to translate."""
    units: list[Unit] = []
    for container in [soup, *soup.find_all(True)]:
        if isinstance(container, Tag) and (
            container.name in _NEVER
            or container.find_parent(_NEVER) is not None
            # Inline code is never translated, and the words of another inline tag
            # belong to the sentence it sits in.
            or container.name == "code"
            or container.find_parent("code") is not None
            or (container.name in _INLINE and _is_inline(container))
        ):
            continue
        for run in _runs(container):
            prose = _prose(run)
            if _LETTER.search(prose):
                units.append(Unit(run, "".join(str(n) for n in run).strip(), prose))
    return units


def _skeleton(html: str) -> tuple[list[tuple[str, str]], list[str]]:
    """What a translation must keep: its tags (with targets), and the text of its code."""
    soup = BeautifulSoup(html, "html.parser")
    tags = [
        (tag.name, tag.get("href") or tag.get("src") or "")
        for tag in soup.find_all(True)
    ]
    code = [tag.get_text() for tag in soup.find_all("code")]
    return tags, code


def _batches(units: list[Unit]) -> list[list[int]]:
    batches: list[list[int]] = []
    current: list[int] = []
    size = 0
    for index, unit in enumerate(units):
        if current and (
            len(current) >= MAX_UNITS_PER_CALL or size + len(unit.html) > MAX_CHARS_PER_CALL
        ):
            batches.append(current)
            current, size = [], 0
        current.append(index)
        size += len(unit.html)
    if current:
        batches.append(current)
    return batches


def _parse_reply(reply: str, wanted: list[int]) -> dict[int, str]:
    """The replied units by id; anything that is not what was asked is simply absent."""
    text = reply.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-z]*\s*|\s*```$", "", text, flags=re.IGNORECASE)
    start, end = text.find("["), text.rfind("]")
    if start < 0 or end <= start:
        return {}
    try:
        data = json.loads(text[start : end + 1])
    except ValueError:
        return {}
    found: dict[int, str] = {}
    if not isinstance(data, list):  # pragma: no cover - the slice above is a [...] literal
        return {}
    for position, entry in enumerate(data):
        if isinstance(entry, dict) and isinstance(entry.get("html"), str):
            ident = entry.get("id")
            if isinstance(ident, int) and ident in wanted:
                found[ident] = entry["html"]
        elif isinstance(entry, str) and len(data) == len(wanted):
            found[wanted[position]] = entry
    return found


# ----------------------------------------------------------------------------- the run


@dataclass
class Translation:
    #: running | done | partial | skipped | failed
    status: str
    language: str
    html: str = ""
    units_total: int = 0
    units_done: int = 0
    units_left: int = 0
    ai_calls: int = 0
    notes: list[str] = field(default_factory=list)
    log: list[str] = field(default_factory=list)

    def as_record(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "language": self.language,
            "units_total": self.units_total,
            "units_done": self.units_done,
            "units_left": self.units_left,
            "ai_calls": self.ai_calls,
            "notes": self.notes[:8],
            "log": self.log[-MAX_LOG_LINES:],
        }


async def translate_import(
    html: str,
    target: str,
    *,
    ask: Translate | None,
    report: Report | None = None,
    deadline: float | None = None,
) -> Translation:
    """Translate a page into ``target`` (``en`` or ``vi``). Never raises for a bad reply.

    ``deadline`` is a ``time.monotonic()`` instant after which no new call is started; what
    was translated by then is kept and the rest counted as left.
    """
    language = LANGUAGES.get(target, target)
    result = Translation("running", target, html)

    async def say(text: str) -> None:
        result.log.append(text)
        if report is not None:
            await report(result)

    async def stop(status: str, note: str) -> Translation:
        result.status = status
        result.notes.append(note)
        await say(note[0].upper() + note[1:] + ".")
        return result

    if target not in LANGUAGES:
        return await stop("skipped", "that language is not available")
    if ask is None:
        return await stop("skipped", "the AI assistant is not set up, so nothing was translated")

    soup = BeautifulSoup(html, "html.parser")
    units = collect_units(soup)
    result.units_total = len(units)
    if not units:
        return await stop("skipped", "there is no text to translate")
    text = " ".join(unit.text for unit in units)
    if len(text) > MAX_CHARS:
        return await stop("skipped", "the document is too large to translate")
    detected = detect_language(text)
    await say(
        f"Found {len(units)} pieces of text, which look like {detected} (target: {language})."
    )
    if detected == target:
        return await stop("skipped", f"the document is already in {language}")

    batches = _batches(units)
    await say(f"Translating into {language} in {len(batches)} step(s)...")
    semaphore = asyncio.Semaphore(CONCURRENCY)
    state = {"unavailable": False, "late": False}

    async def call(wanted: list[int]) -> dict[int, str] | None:
        payload = json.dumps(
            [{"id": i, "html": units[i].html} for i in wanted], ensure_ascii=False
        )
        reply = await ask(RULES.replace("{language}", language), payload)
        if reply is None:
            state["unavailable"] = True
            return None
        result.ai_calls += 1
        return _parse_reply(reply, wanted)

    def accept(index: int, translated: str) -> bool:
        unit = units[index]
        if not translated.strip() or _skeleton(translated) != _skeleton(unit.html):
            return False
        replacement = BeautifulSoup(translated, "html.parser")
        first = unit.nodes[0]
        for node in list(replacement.contents):
            first.insert_before(node.extract())
        for node in unit.nodes:
            node.extract()
        return True

    async def do_batch(number: int, wanted: list[int]) -> None:
        async with semaphore:
            if deadline is not None and time.monotonic() > deadline:
                state["late"] = True
            if state["unavailable"] or state["late"]:
                return
            replies = await call(wanted)
            if replies is None:
                return
            failed = [i for i in wanted if i not in replies or not accept(i, replies[i])]
            for index in failed[:MAX_RETRIES_PER_CALL]:
                if state["unavailable"]:
                    break
                again = await call([index])
                if again and index in again and accept(index, again[index]):
                    failed.remove(index)
            result.units_done += len(wanted) - len(failed)
            result.units_left += len(failed)
        await say(
            f"Step {number} of {len(batches)}: {len(wanted) - len(failed)} of {len(wanted)} "
            f"pieces translated{f', {len(failed)} left as they were' if failed else ''}."
        )

    await asyncio.gather(*(do_batch(n, b) for n, b in enumerate(batches, 1)))

    result.html = str(soup)
    result.units_left = result.units_total - result.units_done
    if result.units_done == 0:
        reason = (
            "the AI assistant was not available"
            if state["unavailable"]
            else "it ran out of time"
            if state["late"]
            else "the replies could not be used"
        )
        return await stop("failed", f"nothing could be translated: {reason}")
    if result.units_left:
        result.status = "partial"
        note = (
            f"{result.units_left} of {result.units_total} pieces were left in the original "
            "language"
        )
        result.notes.append(note)
        await say(f"Done: {result.units_done} translated; {note}.")
    else:
        result.status = "done"
        await say(f"Done: all {result.units_total} pieces were translated into {language}.")
    return result
