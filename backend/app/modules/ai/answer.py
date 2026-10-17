"""Questions answered from the wiki, with the pages each answer was read from.

The model never sees the wiki, only a few passages that search picked *for the person
asking* - so a page they may not read cannot reach it. It must cite the passage behind
every statement as ``[n]``; an answer that cites nothing is not shown as an answer, and a
citation to a number that was never offered is dropped. Passwords, tokens and keys are
removed from the passages before the model reads them, and again from what it writes.
"""

from __future__ import annotations

import asyncio
import hashlib
import re
import time

from pydantic import ValidationError
from redis.exceptions import RedisError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import rate_limit
from app.core.config import settings
from app.core.exceptions import ServiceUnavailableError
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.models.user import User
from app.modules.ai.client import chat_with_usage
from app.modules.ai.config import load_config
from app.modules.ai.skills import answer_system_prompt
from app.modules.search.service import AnswerPassage, SearchService
from app.modules.stats.recorder import record_ai_usage
from app.schemas.ai import AnswerRequest, AnswerResult, AnswerSource

logger = get_logger(__name__)

#: A copy of an answer is kept this long, per person and per question, so asking the same
#: thing again costs no model call. It is dropped sooner when a page it used changes.
_ANSWER_TTL_SECONDS = 3600
_NOT_FOUND_TTL_SECONDS = 600
_MAX_TOKENS = 900
#: The longest a question may take from start to finish, however the gateway behaves: a busy
#: one can answer 504 after half a minute and then be retried, and the shared client allows
#: far longer than a person will wait with a box open. Waiting for a free slot counts too.
ANSWER_DEADLINE_SECONDS = 60.0
_EXCERPT_CHARS = 240

# ---------------------------------------------------------------- keeping secrets out

#: What stands where a secret was. Not asterisks: ``***`` reads as Markdown emphasis.
HIDDEN = "[hidden]"

_SENSITIVE_LABELS = (
    r"pass(?:word|wd)?|pwd|secret|token|api[ _-]?key|access[ _-]?key|private[ _-]?key|"
    r"m\u1eadt kh\u1ea9u|mat khau|mk"
)
#: ``password: hunter2``, ``token=abc``, ``api key is abc`` -> the value is hidden.
_SECRET_ASSIGNMENT = re.compile(
    rf"(?i)\b({_SENSITIVE_LABELS})\b(\s*(?::|=(?!=))\s*|\s+is\s+|\s+l\u00e0\s+)(?!\[hidden\])([^\s,;\"'<>]+)"
)
#: ``https://user:secret@host`` -> ``https://user:[hidden]@host``.
_URL_CREDENTIALS = re.compile(r"(?i)(\b[a-z][a-z0-9+.-]*://[^\s:/@]+:)([^\s@/]+)(@)")
#: ``admin/P@ssw0rd!``, ``tamdt25/tamdt25@123``: wiki pages list accounts as ``user/password``.
#: The right-hand side must hold a symbol, which a plain path or a host name does not. Not ``*``:
#: ``km/h**,`` is a unit before the end of Markdown bold, not a password.
_USER_SLASH_PASSWORD = re.compile(
    r"(?<![\w/:.@%-])([A-Za-z0-9_.-]{2,40}/)(?=[^\s/<>]*[!@#$%^&])[^\s/<>]{4,80}"
    r"(?=[\s,;)\]\"']|$)"
)
_BEARER = re.compile(r"(?i)\b(bearer\s+)[A-Za-z0-9._~+/=-]{12,}")
#: What an administrator sees as a secret on a wiki page: ``sk-...``, ``ghp_...``, ``AKIA...``.
_KEY_SHAPES = re.compile(
    r"\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b"
)


def scrub_secrets(text: str) -> str:
    """The text with the values of passwords, tokens and keys replaced by ``[hidden]``."""
    text = _URL_CREDENTIALS.sub(lambda m: m.group(1) + HIDDEN + m.group(3), text)
    text = _USER_SLASH_PASSWORD.sub(lambda m: m.group(1) + HIDDEN, text)
    text = _BEARER.sub(lambda m: m.group(1) + HIDDEN, text)
    text = _KEY_SHAPES.sub(HIDDEN, text)
    return _SECRET_ASSIGNMENT.sub(lambda m: m.group(1) + m.group(2) + HIDDEN, text)


# ---------------------------------------------------------------- what the model reads

#: The tags that frame the question and the sources: text from a page must not be able to
#: close them and open its own.
_FRAMING_TAGS = re.compile(r"</?\s*(?:web_sources?|sources?|question)\b[^>]*>", re.IGNORECASE)
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def prompt_text(text: str) -> str:
    """Passage text as it goes into the prompt: no secrets, and nothing that looks like our tags."""
    return _FRAMING_TAGS.sub(" ", _CONTROL.sub("", scrub_secrets(text))).strip()


def answer_messages(query: str, sources: list[tuple[int, str, str]]) -> list[dict[str, str]]:
    """The chat messages for one question: ``sources`` are ``(number, page title, passage)``."""
    blocks = []
    for number, title, passage in sources:
        safe_title = _FRAMING_TAGS.sub(" ", title).replace('"', "'")
        blocks.append(
            f'<source n="{number}" title="{safe_title}">\n{prompt_text(passage)}\n</source>'
        )
    body = "\n".join(
        [
            "<question>",
            _FRAMING_TAGS.sub(" ", query),
            "</question>",
            "<sources>",
            *blocks,
            "</sources>",
        ]
    )
    return [
        {"role": "system", "content": answer_system_prompt()},
        {"role": "user", "content": body},
    ]


# ---------------------------------------------------------------- what the model wrote

#: ``[2]``, ``[1, 3]``, ``[1;2]`` - one or several numbers in square brackets.
_CITATION = re.compile(r"\[(\d{1,2}(?:\s*[,;]\s*\d{1,2})*)\]")
_NOT_FOUND = re.compile(r"\bNOT[_ ]FOUND\b", re.IGNORECASE)


def normalise_citations(text: str, offered: set[int]) -> tuple[str, list[int]]:
    """Make every citation ``[n]`` and drop those to a source that was never offered.

    Returns the cleaned text and the numbers cited, in order of first appearance.
    """
    cited: list[int] = []
    removed = chr(0xE000)  # a character that cannot occur in a reply

    def fix(match: re.Match[str]) -> str:
        numbers = [int(part) for part in re.split(r"[,;]", match.group(1))]
        kept = [n for n in dict.fromkeys(numbers) if n in offered]
        for n in kept:
            if n not in cited:
                cited.append(n)
        return "".join(f"[{n}]" for n in kept) or removed

    cleaned = _CITATION.sub(fix, text.replace(removed, ""))
    # Where a marker was dropped, close the gap: no stray space before a full stop, and one
    # space, not two, between the words either side of it.
    cleaned = re.sub(rf"[ ]*{removed}[ ]*([.,;:!?]?)", lambda m: m.group(1) or " ", cleaned)
    return cleaned, cited


def interpret(reply: str, sources: list[AnswerSource]) -> AnswerResult:
    """Turn the model's reply into a result - an answer only when it points at a page."""
    text = reply.strip()
    if _NOT_FOUND.search(text):
        return AnswerResult(found=False, reason="not_in_pages", related=sources)
    cleaned, cited = normalise_citations(text, {source.n for source in sources})
    cleaned = scrub_secrets(cleaned).strip()
    if not cited or not cleaned:
        # Nothing ties the words to a page: that is a guess, not an answer from the wiki.
        return AnswerResult(found=False, reason="ungrounded", related=sources)
    by_number = {source.n: source for source in sources}
    return AnswerResult(
        found=True,
        answer=cleaned,
        sources=[by_number[n] for n in cited],
        related=[source for source in sources if source.n not in cited],
    )


def _excerpt(passage: str) -> str:
    plain = " ".join(prompt_text(passage).split())
    return plain[:_EXCERPT_CHARS] + ("..." if len(plain) > _EXCERPT_CHARS else "")


def sources_of(passages: list[AnswerPassage]) -> list[AnswerSource]:
    return [
        AnswerSource(
            n=number,
            id=passage.page.id,
            title=passage.page.title,
            slug=passage.page.slug,
            space_key=passage.page.space_key,
            space_name=passage.page.space_name,
            excerpt=_excerpt(passage.text),
        )
        for number, passage in enumerate(passages, start=1)
    ]


# ---------------------------------------------------------------- the service


class AnswerService:
    def __init__(self, session: AsyncSession, user: User) -> None:
        self.session = session
        self.user = user

    def _cache_key(self, query: str, model: str, passages: list[AnswerPassage]) -> str:
        """Same person, same question, same model and the same text of the same pages."""
        digest = hashlib.sha256()
        digest.update(f"{self.user.id}\n{model}\n{query.lower()}\n".encode())
        for passage in passages:
            digest.update(f"{passage.page.id}|{passage.page.updated_at}|".encode())
            digest.update(hashlib.sha256(passage.text.encode()).digest())
        return f"ai:answer:{digest.hexdigest()}"

    async def answer(self, request: AnswerRequest) -> AnswerResult:
        started = time.perf_counter()
        config = await load_config(self.session)
        if not config.ready:
            raise ServiceUnavailableError("The AI assistant is not enabled.")
        query = request.query
        passages = await SearchService(self.session).answer_passages(query, self.user)
        retrieval = time.perf_counter() - started
        if not passages:
            self._log("no_match", query, 0, retrieval, started)
            return AnswerResult(found=False, reason="no_match")

        sources = sources_of(passages)
        key = self._cache_key(query, config.model, passages)
        try:
            kept = await get_redis().get(key)
        except (RedisError, OSError):
            kept = None
        if kept:
            try:
                result = AnswerResult.model_validate_json(kept)
            except ValidationError:
                result = None
            if result is not None:
                result.cached = True
                self._log("cached", query, len(sources), retrieval, started)
                return result

        # Only a question that reaches the model counts against the person's quota.
        await rate_limit.enforce(f"ai:{self.user.id}", settings.ai_rate_limit)
        messages = answer_messages(
            query,
            [
                (source.n, source.title, passage.text)
                for source, passage in zip(sources, passages, strict=True)
            ],
        )
        try:
            reply = await asyncio.wait_for(
                chat_with_usage(config, messages, max_tokens=_MAX_TOKENS),
                timeout=ANSWER_DEADLINE_SECONDS,
            )
        except TimeoutError:
            self._log("timeout", query, len(sources), retrieval, started)
            raise ServiceUnavailableError(
                "The AI assistant took too long to answer. Please try again."
            ) from None
        if reply.usage is not None:
            await record_ai_usage(
                user_id=self.user.id,
                feature="answer",
                model=config.model,
                prompt_tokens=reply.usage.prompt_tokens,
                completion_tokens=reply.usage.completion_tokens,
            )
        result = interpret(reply.text, sources)
        try:
            await get_redis().set(
                key,
                result.model_dump_json(),
                ex=_ANSWER_TTL_SECONDS if result.found else _NOT_FOUND_TTL_SECONDS,
            )
        except (RedisError, OSError):
            logger.debug("ai_answer_cache_write_failed")
        self._log(result.reason or "answered", query, len(sources), retrieval, started, result)
        return result

    @staticmethod
    def _log(
        outcome: str,
        query: str,
        pages: int,
        retrieval: float,
        started: float,
        result: AnswerResult | None = None,
    ) -> None:
        """How it went, never what was asked or answered."""
        logger.info(
            "ai_answer",
            outcome=outcome,
            query_chars=len(query),
            pages=pages,
            cited=len(result.sources) if result else 0,
            retrieval_seconds=round(retrieval, 3),
            total_seconds=round(time.perf_counter() - started, 3),
        )
