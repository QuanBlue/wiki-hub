"""Read the words inside files attached to pages, so search and the AI assistant can use them.

People attach a Word, Excel, HTML or PDF file to a page instead of importing it, and still
ask about what it says. The worker reads each such file with the same readers as document
import (``document_import.convert``) into plain markup in ``attachment_texts``; the indexer
then embeds it with the page (``search.indexer``) and search ranks it (``search.service``).

Only files the page still links to are read: a file removed from the page's content says
nothing about the page any more, so what was read from it is forgotten. Nothing here calls
a model, and a scanned PDF is not OCR'd - it is marked ``scanned`` so people know why.
"""

from __future__ import annotations

import asyncio
import html
import tempfile
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

import anyio
import sqlalchemy as sa
from bs4 import BeautifulSoup, Tag
from sqlalchemy import delete, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import BadRequestError
from app.core.logging import get_logger
from app.models.attachment import PageAttachment
from app.models.attachment_text import AttachmentText
from app.models.page import WikiPage
from app.models.space import Space, SpaceStatus
from app.modules.document_import.convert import (
    DocumentTooComplexError,
    extract_document,
    format_for_filename,
)
from app.modules.search.chunking import _blocks
from app.modules.search.ddl import MAX_INDEXED_CHARS
from app.services.storage import ObjectStorage

logger = get_logger(__name__)

#: Plain-text files are read as they are; everything else goes through the import readers.
_PLAIN_TEXT = frozenset({"txt", "text", "log"})
#: Files read per pass: each one is a download and a conversion.
BATCH = 20
#: Past this, a file is not read at all (a 2 GB video is not a document).
MAX_FILE_BYTES = 50 * 1024 * 1024
_MAX_DETAIL = 500


def readable(filename: str) -> bool:
    """Whether WikiHub can read text out of a file with this name."""
    suffix = Path(filename).suffix.lower().lstrip(".")
    return suffix in _PLAIN_TEXT or format_for_filename(filename) is not None


def signature(filename: str, size_bytes: int, office_revision: int) -> str:
    """What a reading is valid for: a renamed, replaced or re-edited file is read again."""
    return f"{size_bytes}|{office_revision}|{filename}"[:320]


def _signature_sql() -> sa.ColumnElement[str]:
    return sa.func.left(
        sa.cast(PageAttachment.size_bytes, sa.Text)
        + "|"
        + sa.cast(PageAttachment.office_revision, sa.Text)
        + "|"
        + PageAttachment.filename,
        320,
    )


def _suffix_pattern() -> str:
    from app.modules.document_import.convert import FORMAT_BY_EXTENSION

    suffixes = sorted({*FORMAT_BY_EXTENSION, *_PLAIN_TEXT})
    return r"\.(" + "|".join(suffixes) + r")$"


def _linked() -> sa.ColumnElement[bool]:
    """The page's content still links to the file."""
    return sa.func.strpos(WikiPage.content, sa.cast(PageAttachment.id, sa.Text)) > 0


@dataclass(slots=True)
class Reading:
    status: str
    content: str = ""
    detail: str = ""
    chars: int = 0


def to_markup(sections: list[tuple[str, str]]) -> tuple[str, int]:
    """``(heading, html)`` parts as ``<h2>``/``<p>`` markup, cut to what search indexes.

    Only the words are kept - no links, images, scripts or styles - so the result is safe
    to search, embed and quote, and it reads in order like the file does.
    """
    out: list[str] = []
    size = chars = 0
    for title, markup in sections:
        blocks = _blocks(markup)
        if title:
            blocks.insert(0, (True, title))
        for is_heading, words in blocks:
            chars += len(words)
            piece = (
                f"<h2>{html.escape(words)}</h2>" if is_heading else f"<p>{html.escape(words)}</p>"
            )
            if size + len(piece) > MAX_INDEXED_CHARS:
                continue
            out.append(piece)
            size += len(piece)
    return "".join(out), chars


def _span(cell: Tag, attribute: str) -> int:
    """How many rows or columns a cell covers: 1 unless it says a whole number above that."""
    value = str(cell.get(attribute) or "1").strip()
    return max(int(value), 1) if value.isdigit() else 1


def _cell_text(cell: Tag) -> str:
    """A cell's words on one line: its own lines (a list in one cell) joined by "; "."""
    for br in cell.find_all("br"):
        br.replace_with("\n")
    lines = (" ".join(line.split()) for line in cell.get_text("\n").split("\n"))
    return "; ".join(line for line in lines if line)


def table_rows(markup: str) -> str:
    """``markup`` with each table row as one paragraph, its cells joined by " | ".

    Read cell by cell, a table loses its rows: "integration-configmap" and the parameters
    beside it end up lines apart, and a service named once in a merged cell owns none of
    them. Here a cell merged down several rows (``rowspan``) is repeated on each of them, so
    every row says whose it is, and a row can be found and read on its own.
    """
    soup = BeautifulSoup(markup, "html.parser")
    for table in soup.find_all("table"):
        lines = [
            f"<p>{html.escape(' | '.join(text for text in cells if text))}</p>"
            for cells in _grid(table)
        ]
        table.replace_with(BeautifulSoup("".join(lines), "html.parser"))
    return str(soup)


def table_row_cells(markup: str) -> list[list[str]]:
    """The rows of every table in ``markup``, each as its cells' words (see ``table_rows``)."""
    soup = BeautifulSoup(markup, "html.parser")
    return [cells for table in soup.find_all("table") for cells in _grid(table)]


def _grid(table: Tag) -> list[list[str]]:
    """A table's rows as cell words, a cell merged down repeated on every row it covers, and a
    row that says nothing new (only cells merged down from the one above) left out."""
    # Cells still to repeat below, by column: (text, rows left).
    carried: dict[int, tuple[str, int]] = {}
    rows: list[list[str]] = []
    for row in table.find_all("tr"):
        cells: list[str] = []
        column = 0
        own = iter(row.find_all(["td", "th"], recursive=False))
        while True:
            if column in carried:
                text, left = carried[column]
                cells.append(text)
                if left > 1:
                    carried[column] = (text, left - 1)
                else:
                    del carried[column]
                column += 1
                continue
            cell = next(own, None)
            if cell is None:
                break
            text = _cell_text(cell)
            down = _span(cell, "rowspan")
            if down > 1:
                carried[column] = (text, down - 1)
            cells.append(text)
            column += _span(cell, "colspan")
        if any(cells) and (not rows or rows[-1] != cells):
            rows.append(cells)
    return rows


async def read_file(path: Path, filename: str, workdir: Path, *, rows: bool = False) -> Reading:
    """Read one downloaded file. Never raises for a bad file: the reason is the status.

    ``rows``: tables as one paragraph per row and plain text as one per line (``table_rows``),
    for reading a file whole rather than indexing it.
    """
    suffix = Path(filename).suffix.lower().lstrip(".")
    try:
        if suffix in _PLAIN_TEXT:
            raw = (await anyio.Path(path).read_bytes())[: MAX_INDEXED_CHARS * 4].decode(
                "utf-8", errors="replace"
            )
            paragraphs = "".join(
                f"<p>{html.escape(p)}</p>" for p in raw.split("\n" if rows else "\n\n")
            )
            sections = [("", paragraphs)]
        else:
            extracted = await asyncio.wait_for(
                extract_document(path, filename=filename, workdir=workdir),
                timeout=settings.document_import_convert_timeout_seconds,
            )
            if any("appears to be scanned" in warning for warning in extracted.warnings):
                return Reading("scanned", detail="No selectable text: the PDF is scanned images.")
            sections = [("", extracted.html), *extracted.sections]
            if rows:
                sections = [(title, table_rows(markup)) for title, markup in sections]
    except DocumentTooComplexError as exc:
        return Reading("too_large", detail=str(exc)[:_MAX_DETAIL])
    except BadRequestError as exc:
        return Reading("failed", detail=str(exc)[:_MAX_DETAIL])
    except TimeoutError:
        return Reading("failed", detail="Reading the file took too long.")
    except Exception as exc:  # noqa: BLE001 - one unreadable file must not stop the others
        return Reading("failed", detail=f"{type(exc).__name__}: {exc}"[:_MAX_DETAIL])
    content, chars = to_markup(sections)
    if not content:
        return Reading("empty")
    return Reading("ok", content=content, chars=chars)


async def forget_unlinked(session: AsyncSession) -> int:
    """Drop what was read from files their page no longer links to (and their passages)."""
    gone = (
        await session.scalars(
            select(AttachmentText.attachment_id)
            .join(PageAttachment, PageAttachment.id == AttachmentText.attachment_id)
            .join(WikiPage, WikiPage.id == AttachmentText.page_id)
            .where(~_linked())
        )
    ).all()
    if not gone:
        return 0
    await _forget_passages(session, list(gone))
    await session.execute(delete(AttachmentText).where(AttachmentText.attachment_id.in_(gone)))
    await session.commit()
    return len(gone)


async def _forget_passages(session: AsyncSession, attachment_ids: list[uuid.UUID]) -> None:
    """Remove a file's indexed passages. Its page is indexed again (with the file's new text,
    if there is one) because its search state goes with them."""
    if not attachment_ids:
        return
    try:
        async with session.begin_nested():
            pages = (
                await session.scalars(
                    text(
                        "DELETE FROM page_chunks WHERE attachment_id = ANY(:ids) RETURNING page_id"
                    ),
                    {"ids": attachment_ids},
                )
            ).all()
            page_ids = {
                *pages,
                *(
                    await session.scalars(
                        select(AttachmentText.page_id).where(
                            AttachmentText.attachment_id.in_(attachment_ids)
                        )
                    )
                ).all(),
            }
            if page_ids:
                await session.execute(
                    text("DELETE FROM page_search_state WHERE page_id = ANY(:pages)"),
                    {"pages": list(page_ids)},
                )
    except SQLAlchemyError:
        # No semantic search here (no page_chunks / no attachment_id column): nothing to drop.
        logger.debug("attachment_passages_not_dropped", exc_info=True)


def _pending(limit: int) -> sa.Select:
    current = (
        sa.exists()
        .where(
            AttachmentText.attachment_id == PageAttachment.id,
            AttachmentText.signature == _signature_sql(),
        )
        .correlate(PageAttachment)
    )
    return (
        select(
            PageAttachment.id,
            PageAttachment.page_id,
            PageAttachment.filename,
            PageAttachment.object_key,
            PageAttachment.size_bytes,
            PageAttachment.office_revision,
        )
        .join(WikiPage, WikiPage.id == PageAttachment.page_id)
        .join(Space, Space.id == WikiPage.space_id)
        .where(
            Space.status == SpaceStatus.active,
            PageAttachment.filename.op("~*")(_suffix_pattern()),
            _linked(),
            ~current,
        )
        .order_by(PageAttachment.created_at.desc())
        .limit(limit)
    )


async def pending_count(session: AsyncSession) -> int:
    query = _pending(1_000_000).with_only_columns(PageAttachment.id).order_by(None)
    return int(await session.scalar(select(sa.func.count()).select_from(query.subquery())) or 0)


async def _save(
    session: AsyncSession,
    *,
    attachment_id: uuid.UUID,
    page_id: uuid.UUID,
    filename: str,
    sign: str,
    reading: Reading,
) -> None:
    await _forget_passages(session, [attachment_id])
    row = await session.get(AttachmentText, attachment_id)
    if row is None:
        row = AttachmentText(
            attachment_id=attachment_id, page_id=page_id, signature=sign, status=""
        )
        session.add(row)
    row.page_id, row.filename, row.signature = page_id, filename[:255], sign
    row.status, row.content, row.detail, row.chars = (
        reading.status,
        reading.content,
        reading.detail,
        reading.chars,
    )
    row.extracted_at = sa.func.now()
    await session.commit()


async def extract_pending(
    session: AsyncSession,
    storage: ObjectStorage,
    *,
    limit: int = BATCH,
    deadline: float | None = None,
    stop: Callable[[], Awaitable[bool]] | None = None,
    heartbeat: Callable[[], Awaitable[None]] | None = None,
) -> int:
    """Read files attached to pages that are new or changed since they were last read.

    Returns how many files were read (whatever came of it). ``deadline`` is a
    ``time.monotonic`` value; ``stop`` is asked before each file (indexing was paused).
    """
    started = time.monotonic()
    forgotten = await forget_unlinked(session)
    rows = (await session.execute(_pending(limit))).all()
    done = 0
    statuses: dict[str, int] = {}
    stopped = "batch_done"
    for attachment_id, page_id, filename, object_key, size_bytes, revision in rows:
        if deadline is not None and time.monotonic() >= deadline:
            stopped = "time_budget"
            break
        if stop is not None and await stop():
            stopped = "paused"
            break
        if size_bytes > MAX_FILE_BYTES:
            reading = Reading(
                "too_large", detail=f"Files over {MAX_FILE_BYTES // 2**20} MB are not read."
            )
        else:
            with tempfile.TemporaryDirectory(prefix="wikihub-attachment-text-") as workdir:
                source = Path(workdir) / ("source" + Path(filename).suffix.lower())
                try:
                    await storage.download_to_file(object_key, str(source))
                except Exception as exc:  # noqa: BLE001 - a missing blob is this file's problem
                    reading = Reading(
                        "failed", detail=f"Could not fetch the file: {exc}"[:_MAX_DETAIL]
                    )
                else:
                    reading = await read_file(source, filename, Path(workdir))
        try:
            await _save(
                session,
                attachment_id=attachment_id,
                page_id=page_id,
                filename=filename,
                sign=signature(filename, size_bytes, revision),
                reading=reading,
            )
        except SQLAlchemyError:
            # The file or its page was deleted meanwhile.
            await session.rollback()
            logger.warning("attachment_text_store_failed", attachment_id=str(attachment_id))
            continue
        done += 1
        statuses[reading.status] = statuses.get(reading.status, 0) + 1
        if heartbeat is not None:
            await heartbeat()
    if done or forgotten:
        logger.info(
            "attachment_text_pass",
            files=done,
            statuses=statuses,
            forgotten=forgotten,
            seconds=round(time.monotonic() - started, 2),
            stopped=stopped,
        )
    return done


async def files_read(session: AsyncSession) -> int:
    """Files whose words search and the assistant can use now."""
    return int(
        await session.scalar(
            select(sa.func.count())
            .select_from(AttachmentText)
            .join(WikiPage, WikiPage.id == AttachmentText.page_id)
            .join(Space, Space.id == WikiPage.space_id)
            .where(Space.status == SpaceStatus.active, AttachmentText.status == "ok")
        )
        or 0
    )
