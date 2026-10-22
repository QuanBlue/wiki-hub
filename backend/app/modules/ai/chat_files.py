"""Files attached in the chat itself: read once, kept as words for a day, read with the wiki.

"Ask about this file" answers from one file attached to a page, and from nothing else. A file
attached in the chat is different: it comes from the person's computer, is never stored in the
wiki, and the answer reads it *together with* the pages - "does my draft follow the policy?".

Only the words are kept, in Redis under a random id and for one person only, and they expire a
day after the last question that used them. The file itself is read with the readers that read
files attached to pages (``attachments.text.read_file``) and thrown away.
"""

from __future__ import annotations

import json
import math
import re
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path

import anyio
from redis.exceptions import RedisError

from app.core.exceptions import BadRequestError, ServiceUnavailableError
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.models.user import User
from app.modules.attachments.text import read_file, readable
from app.modules.search.chunking import _blocks
from app.modules.search.query import build_concepts, fold, split_questions
from app.schemas.ai import ChatFileRead

logger = get_logger(__name__)

#: A larger file is refused before it is read: the chat is not a document store.
MAX_CHAT_FILE_BYTES = 20 * 1024 * 1024
#: How long the words of a file are kept after the question that last used them.
CHAT_FILE_TTL_SECONDS = 24 * 3600
#: What the files of one question may add to what the model reads, all of them together:
#: more than the wiki's pages get, as the person's own file comes first.
FILE_CHARS = 24000
#: The opening of a long file that is always read: it says what the file is.
_OPENING_CHARS = 1200
#: A longer line (one huge table row) is cut, so it cannot take the whole room alone.
_LINE_CHARS = 8000
_KEY = "aichatfile:{}"

#: Why a file gave no words, as the person is told.
_UNREADABLE = {
    "scanned": "This PDF is scanned images: it has no text to read.",
    "empty": "No text was found in this file.",
    "too_large": "This file is too large or complex to read.",
}


@dataclass(slots=True)
class ChatFileText:
    id: uuid.UUID
    filename: str
    text: str


def _plain(markup: str) -> str:
    """Markup read from a file as a model reads it best: a line per paragraph, headings marked."""
    return "\n".join(
        f"## {words}" if is_heading else words for is_heading, words in _blocks(markup)
    )


async def read_upload(user: User, filename: str, data: bytes) -> ChatFileRead:
    """Read the words of an uploaded file and keep them for ``user``; the file is not kept."""
    if not readable(filename):
        raise BadRequestError(
            "WikiHub cannot read text from this kind of file.", code="unsupported_chat_file"
        )
    with tempfile.TemporaryDirectory(prefix="wikihub-chat-file-") as folder:
        workdir = Path(folder)
        source = workdir / f"upload{Path(filename).suffix.lower()}"
        await anyio.Path(source).write_bytes(data)
        reading = await read_file(source, filename, workdir, rows=True)
    if reading.status != "ok":
        reason = _UNREADABLE.get(reading.status, "The words in this file could not be read.")
        raise BadRequestError(reason, code=f"chat_file_{reading.status}")
    text = _plain(reading.content)
    file_id = uuid.uuid4()
    record = {"user": str(user.id), "filename": filename, "text": text}
    try:
        await get_redis().set(_KEY.format(file_id), json.dumps(record), ex=CHAT_FILE_TTL_SECONDS)
    except (RedisError, OSError) as exc:
        raise ServiceUnavailableError("Attached files cannot be kept right now.") from exc
    logger.info("ai_chat_file_read", chars=len(text), suffix=Path(filename).suffix.lower())
    return ChatFileRead(id=file_id, filename=filename, chars=len(text))


async def load(user: User, ids: list[uuid.UUID]) -> list[ChatFileText]:
    """The words of the files ``user`` attached, in the order given; each is kept a day more.

    A file that expired, or that someone else attached, is refused the same way: whoever asks
    learns nothing about another person's files.
    """
    files: list[ChatFileText] = []
    redis = get_redis()
    for file_id in dict.fromkeys(ids):
        key = _KEY.format(file_id)
        try:
            kept = await redis.get(key)
        except (RedisError, OSError) as exc:
            raise ServiceUnavailableError("Attached files cannot be read right now.") from exc
        record = json.loads(kept) if kept else None
        if not record or record.get("user") != str(user.id):
            # Which one: the others of the conversation are still good to read.
            raise BadRequestError(
                "An attached file has expired: attach it again.",
                code="chat_file_expired",
                details={"file_id": str(file_id)},
            )
        try:
            await redis.expire(key, CHAT_FILE_TTL_SECONDS)
        except (RedisError, OSError):
            logger.debug("ai_chat_file_ttl_failed")
        files.append(ChatFileText(file_id, record["filename"], record["text"]))
    return files


#: Words that point at an attached file: "the questions in the file", "bảng đính kèm". Folded.
_ABOUT_FILES = re.compile(
    r"(?<![a-z0-9])(file|tep|dinh kem|attach\w*|tai lieu nay|bang nay|sheet|excel|"
    r"document|this table|the table)(?![a-z0-9])"
)


def mentions_files(question: str) -> bool:
    """Whether a question is about the attached files themselves, not only read beside them."""
    return bool(_ABOUT_FILES.search(fold(question)))


def queries(files: list[ChatFileText], chars: int, limit: int = 8) -> list[str]:
    """What to search the wiki for, for these files: the numbered questions a file holds (a
    test to answer from the wiki), or else its opening words, which say what it is about.

    "Answer the questions in the attached file" names none of them itself: searched alone,
    it finds nothing the file is about.
    """
    found: list[str] = []
    for file in files:
        asked = split_questions(file.text, limit=limit)
        found.extend(asked or [" ".join(file.text.split())[:chars]])
    return [q for q in dict.fromkeys(found) if q][:limit]


def passages(
    files: list[ChatFileText], questions: list[str], total_chars: int = FILE_CHARS
) -> list[tuple[str, str]]:
    """``(filename, text)`` for each file: what of it the model reads for these questions.

    A short file is read whole. A long one gives its opening, which says what it is (a title,
    a table's header row), and then its lines - a paragraph, or a table row - that hold the
    words asked for, the rarest words weighing most, one question of a test at a time so each
    gets its share. Kept in the file's order, with "..." where lines were left out. A question
    about none of its words ("summarise it") reads as much of its start as fits.
    """
    if not files:
        return []
    share = total_chars // len(files)
    asked = [q for q in questions if q.strip()]
    out: list[tuple[str, str]] = []
    for file in files:
        if len(file.text) <= share:
            out.append((file.filename, file.text))
            continue
        lines = [line[:_LINE_CHARS] for line in file.text.split("\n")]
        folded = [fold(line) for line in lines]
        chosen: set[int] = set()
        used = 0
        for index, line in enumerate(lines):
            if index and used + len(line) > _OPENING_CHARS:
                break
            chosen.add(index)
            used += len(line)
        opening = len(chosen)
        rankings = [_ranked(folded, question) for question in asked]
        for depth in range(max((len(ranking) for ranking in rankings), default=0)):
            for ranking in rankings:
                if depth >= len(ranking) or ranking[depth] in chosen:
                    continue
                size = len(lines[ranking[depth]])
                if used + size <= share:
                    chosen.add(ranking[depth])
                    used += size
        if len(chosen) == opening:
            out.append((file.filename, file.text[:share]))
            continue
        parts: list[str] = []
        last = -1
        for index in sorted(chosen):
            if last >= 0 and index > last + 1:
                parts.append("...")
            parts.append(lines[index])
            last = index
        out.append((file.filename, "\n".join(parts)))
    return out


def _ranked(lines: list[str], question: str) -> list[int]:
    """The lines (folded) holding the words of ``question``, best first.

    A word on few lines tells more than one on every line ("integration" against "tham so" in
    a table of parameters), and a word said several times on a line counts a little more.
    """
    terms = list(dict.fromkeys(term for c in build_concepts(question) for term in c.terms()))
    patterns = [re.compile(rf"(?<![a-z0-9]){re.escape(term)}") for term in terms]
    counts = [[len(p.findall(line)) for p in patterns] for line in lines]
    holding = [sum(1 for row in counts if row[t]) for t in range(len(terms))]
    scored: list[tuple[float, int]] = []
    for index, row in enumerate(counts):
        score = sum(
            math.log(1 + len(lines) / holding[t]) * (1 + math.log(row[t]))
            for t in range(len(terms))
            if row[t]
        )
        if score:
            scored.append((-score, index))
    return [index for _, index in sorted(scored)]
