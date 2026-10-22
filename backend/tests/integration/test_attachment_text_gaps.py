"""Reading attached files where it goes wrong: too big, not fetched, not saved, out of time,
and the many ways one file can be unreadable."""

from __future__ import annotations

import time
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestError
from app.modules.attachments import text as attachment_text
from app.modules.document_import.convert import DocumentTooComplexError
from app.schemas.page import PageCreate
from tests.integration import test_hybrid_semantic_search as semantic
from tests.integration.test_attachment_text import FakeStorage, _attach
from tests.integration.test_hybrid_semantic_search import _wiki

installed = semantic.installed

pytestmark = pytest.mark.integration


async def _page_with_files(
    installed: AsyncSession, storage: FakeStorage, *files: tuple[str, bytes]
):
    owner, space, pages = await _wiki(installed)
    page = await pages.create(space, PageCreate(title="Sales", content="<p>Deals</p>"), owner)
    attached = [await _attach(installed, storage, page, name, data) for name, data in files]
    return page, attached


async def test_a_pass_out_of_time_or_paused_reads_no_file(installed: AsyncSession) -> None:
    storage = FakeStorage()
    await _page_with_files(installed, storage, ("a.txt", b"words"))

    late = await attachment_text.extract_pending(
        installed,
        storage,  # type: ignore[arg-type]
        deadline=time.monotonic() - 1,
    )

    assert late == 0


async def test_a_file_too_big_or_missing_from_storage_is_marked_and_the_pass_goes_on(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    storage = FakeStorage()
    _, (big, gone, fine) = await _page_with_files(
        installed, storage, ("big.txt", b"x" * 50), ("gone.txt", b"y"), ("fine.txt", b"fine words")
    )
    monkeypatch.setattr(attachment_text, "MAX_FILE_BYTES", 40)
    del storage.files[gone.object_key]
    beats: list[int] = []

    async def beat() -> None:
        beats.append(1)

    done = await attachment_text.extract_pending(
        installed,
        storage,  # type: ignore[arg-type]
        heartbeat=beat,
    )

    assert done == 3 and len(beats) == 3
    del big, fine


async def test_a_file_that_cannot_be_saved_is_skipped(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    storage = FakeStorage()
    await _page_with_files(installed, storage, ("a.txt", b"words"))

    async def refuse(*args, **kwargs) -> None:
        raise SQLAlchemyError("the page was deleted")

    monkeypatch.setattr(attachment_text, "_save", refuse)

    assert await attachment_text.extract_pending(installed, storage) == 0  # type: ignore[arg-type]


async def test_the_passages_of_a_file_are_dropped_where_there_is_no_semantic_search(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    storage = FakeStorage()
    _, (attachment,) = await _page_with_files(installed, storage, ("a.txt", b"words"))
    real = installed.begin_nested

    def refuse():
        raise SQLAlchemyError("no page_chunks here")

    monkeypatch.setattr(installed, "begin_nested", refuse)
    try:
        await attachment_text._forget_passages(installed, [attachment.id])
    finally:
        monkeypatch.setattr(installed, "begin_nested", real)
    await attachment_text._forget_passages(installed, [])


# -- reading one file -----------------------------------------------------------------------


async def test_one_unreadable_file_is_only_a_reason(tmp_path: Path, monkeypatch) -> None:
    source = tmp_path / "f.docx"
    source.write_bytes(b"x")

    async def fails(error: Exception) -> None:
        async def extract(*args, **kwargs):
            raise error

        monkeypatch.setattr(attachment_text, "extract_document", extract)

    for error, status in (
        (DocumentTooComplexError("too many pages"), "too_large"),
        (BadRequestError("not a Word file"), "failed"),
        (TimeoutError(), "failed"),
        (ValueError("odd"), "failed"),
    ):
        await fails(error)
        reading = await attachment_text.read_file(source, "f.docx", tmp_path)
        assert reading.status == status and reading.detail


def test_headed_parts_are_kept_in_order_and_the_text_is_cut_to_what_is_indexed(monkeypatch) -> None:
    monkeypatch.setattr(attachment_text, "MAX_INDEXED_CHARS", 80)

    content, chars = attachment_text.to_markup(
        [("Sheet one", "<p>first words</p>"), ("Sheet two", "<p>" + "long " * 60 + "</p>")]
    )

    assert content.startswith("<h2>Sheet one</h2><p>first words</p><h2>Sheet two</h2>")
    assert len(content) <= 200 and chars > 100


async def test_a_file_with_no_words_is_empty(tmp_path: Path, monkeypatch) -> None:
    source = tmp_path / "f.txt"
    source.write_bytes(b"   ")
    monkeypatch.setattr(attachment_text, "extract_document", AsyncMock())

    assert (await attachment_text.read_file(source, "f.txt", tmp_path)).status == "empty"


async def test_the_details_of_a_file_say_whether_its_words_are_read(
    installed: AsyncSession,
) -> None:
    from app.api.v1.attachments import get_attachment_metadata

    owner, space, pages = await _wiki(installed)
    page = await pages.create(space, PageCreate(title="Sales", content="<p>Deals</p>"), owner)
    storage = FakeStorage()
    readable = await _attach(installed, storage, page, "prices.txt", b"The words")
    photo = await _attach(installed, storage, page, "photo.jpg", b"\xff\xd8\xff")

    before = await get_attachment_metadata(readable.id, owner, installed)
    assert before.text_status == "waiting"
    assert (await get_attachment_metadata(photo.id, owner, installed)).text_status is None

    await attachment_text.extract_pending(installed, storage)  # type: ignore[arg-type]

    assert (await get_attachment_metadata(readable.id, owner, installed)).text_status == "ok"
