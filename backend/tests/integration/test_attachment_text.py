# ruff: noqa: F811
"""The words inside files attached to pages: read by the worker, found by search, quoted by
the assistant - and never shown to someone who may not read the page."""

from __future__ import annotations

import uuid

import anyio
import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestError, NotFoundError
from app.models.attachment import PageAttachment
from app.models.attachment_text import AttachmentText
from app.models.restriction import PageRestrictionPermission
from app.models.space import SpaceRole
from app.modules.attachments import text as attachment_text
from app.modules.permissions.service import PermissionService
from app.modules.search import indexer
from app.modules.search.service import SearchService
from app.modules.spaces.service import SpaceService
from app.schemas.page import PageCreate
from tests.integration.test_hybrid_semantic_search import (  # noqa: F401 - fixture
    _connect,
    _user,
    _wiki,
    installed,
)

pytestmark = pytest.mark.integration

PRICES = "Price list\n\nThe zircon licence costs 4200 per seat.\n\nSupport is billed yearly."


class FakeStorage:
    """Object storage holding a few files in memory."""

    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}

    async def download_to_file(self, key: str, path: str, **_: object) -> None:
        await anyio.Path(path).write_bytes(self.files[key])


async def _attach(
    session: AsyncSession,
    storage: FakeStorage,
    page: object,
    filename: str,
    data: bytes,
    *,
    link: bool = True,
) -> PageAttachment:
    attachment = PageAttachment(
        id=uuid.uuid4(),
        page_id=page.id,  # type: ignore[attr-defined]
        filename=filename,
        content_type="text/plain",
        object_key=f"pages/{uuid.uuid4().hex}",
        size_bytes=len(data),
    )
    session.add(attachment)
    storage.files[attachment.object_key] = data
    if link:
        page.content += (
            f'<p><a href="/api/v1/attachments/{attachment.id}/content">{filename}</a></p>'  # type: ignore[attr-defined]
        )
    await session.commit()
    return attachment


async def test_a_linked_file_is_read_once_and_again_when_it_changes(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    page = await pages.create(space, PageCreate(title="Sales", content="<p>Deals</p>"), owner)
    storage = FakeStorage()
    linked = await _attach(installed, storage, page, "prices.txt", PRICES.encode())
    await _attach(installed, storage, page, "draft.txt", b"zircon draft", link=False)
    await _attach(installed, storage, page, "photo.png", b"\x89PNG")

    assert await attachment_text.pending_count(installed) == 1
    assert await attachment_text.extract_pending(installed, storage) == 1  # type: ignore[arg-type]
    row = await installed.get(AttachmentText, linked.id)
    assert row is not None and row.status == "ok"
    assert "4200 per seat" in row.content and row.filename == "prices.txt"
    # Nothing new: nothing read.
    assert await attachment_text.extract_pending(installed, storage) == 0  # type: ignore[arg-type]

    # Edited in the office editor: read again.
    linked.office_revision += 1
    storage.files[linked.object_key] = b"The zircon licence now costs 5000."
    await installed.commit()
    assert await attachment_text.extract_pending(installed, storage) == 1  # type: ignore[arg-type]
    await installed.refresh(row)
    assert "5000" in row.content


async def test_a_file_taken_off_the_page_is_forgotten(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    page = await pages.create(space, PageCreate(title="Sales", content="<p>Deals</p>"), owner)
    storage = FakeStorage()
    attachment = await _attach(installed, storage, page, "prices.txt", PRICES.encode())
    await attachment_text.extract_pending(installed, storage)  # type: ignore[arg-type]

    page.content = "<p>Deals</p>"
    await installed.commit()
    await attachment_text.extract_pending(installed, storage)  # type: ignore[arg-type]

    assert await installed.get(AttachmentText, attachment.id) is None


async def test_reading_stops_when_indexing_is_paused(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    page = await pages.create(space, PageCreate(title="Sales", content="<p>Deals</p>"), owner)
    storage = FakeStorage()
    await _attach(installed, storage, page, "prices.txt", PRICES.encode())

    async def paused() -> bool:
        return True

    assert await attachment_text.extract_pending(installed, storage, stop=paused) == 0  # type: ignore[arg-type]
    assert await attachment_text.pending_count(installed) == 1


async def test_search_finds_a_page_by_the_words_in_its_file_but_not_for_outsiders(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    outsider = await _user(installed, "outsider")
    await SpaceService(installed).set_member(space, owner, outsider.id, SpaceRole.editor)
    page = await pages.create(space, PageCreate(title="Sales", content="<p>Deals</p>"), owner)
    storage = FakeStorage()
    attachment = await _attach(installed, storage, page, "prices.txt", PRICES.encode())
    await attachment_text.extract_pending(installed, storage)  # type: ignore[arg-type]

    found = (await SearchService(installed).search("zircon licence", owner)).pages
    assert [hit.title for hit in found] == ["Sales"]
    assert found[0].file_name == "prices.txt" and found[0].file_id == attachment.id
    assert "zircon" in found[0].snippet.lower()

    await PermissionService(installed).set_page_restriction(
        page, owner.id, PageRestrictionPermission.view, owner, group=False, present=True
    )
    assert (await SearchService(installed).search("zircon licence", outsider)).pages == []
    with pytest.raises(NotFoundError):
        await SearchService(installed).file_context(attachment.id, "price?", outsider)


async def test_answers_quote_the_file_and_say_which_one(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    config = await _connect(installed)
    page = await pages.create(space, PageCreate(title="Sales", content="<p>Deals</p>"), owner)
    storage = FakeStorage()
    attachment = await _attach(installed, storage, page, "prices.txt", PRICES.encode())
    await attachment_text.extract_pending(installed, storage)  # type: ignore[arg-type]
    await indexer.index_pending(installed, config)

    # The file's passages are embedded with the page, marked with the file.
    files = (
        await installed.scalars(
            text("SELECT DISTINCT attachment_id FROM page_chunks WHERE page_id = :page"),
            {"page": page.id},
        )
    ).all()
    assert attachment.id in files

    passages = await SearchService(installed).answer_passages("zircon licence price", owner)
    assert passages and passages[0].page.title == "Sales"
    assert "4200" in passages[0].text
    assert [ref.filename for ref in passages[0].files] == ["prices.txt"]


async def test_asking_about_one_file_reads_only_that_file(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    page = await pages.create(space, PageCreate(title="Sales", content="<p>Deals</p>"), owner)
    storage = FakeStorage()
    attachment = await _attach(installed, storage, page, "prices.txt", PRICES.encode())
    await _attach(installed, storage, page, "other.txt", b"Unrelated garnet notes")
    await attachment_text.extract_pending(installed, storage)  # type: ignore[arg-type]

    context = await SearchService(installed).file_context(attachment.id, "summarise", owner)

    assert context.confidence == "high" and len(context.passages) == 1
    assert "4200 per seat" in context.passages[0].text
    assert "garnet" not in context.passages[0].text
    assert context.passages[0].files[0].id == attachment.id


async def test_a_file_whose_words_could_not_be_read_cannot_be_asked_about(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    page = await pages.create(space, PageCreate(title="Sales", content="<p>Deals</p>"), owner)
    storage = FakeStorage()
    attachment = await _attach(installed, storage, page, "scan.pdf", b"not really a pdf")
    await attachment_text.extract_pending(installed, storage)  # type: ignore[arg-type]

    row = await installed.scalar(
        select(AttachmentText).where(AttachmentText.attachment_id == attachment.id)
    )
    assert row is not None and row.status == "failed" and row.detail
    with pytest.raises(BadRequestError):
        await SearchService(installed).file_context(attachment.id, "what is it?", owner)


async def test_a_file_linked_from_another_page_answers_for_the_page_that_links_it(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    outsider = await _user(installed, "outsider")
    await SpaceService(installed).set_member(space, owner, outsider.id, SpaceRole.editor)
    holder = await pages.create(space, PageCreate(title="SOC files", content="<p>Files</p>"), owner)
    linker = await pages.create(
        space, PageCreate(title="Cloud setup", content="<p>Open the zircon ports</p>"), owner
    )
    storage = FakeStorage()
    attachment = await _attach(installed, storage, holder, "policy.txt", PRICES.encode())
    linker.content += f'<p><a href="/api/v1/attachments/{attachment.id}/content">policy</a></p>'
    await installed.commit()
    await attachment_text.extract_pending(installed, storage)  # type: ignore[arg-type]

    service = SearchService(installed)
    contents = {linker.id: linker.content}
    from app.modules.permissions.service import PermissionService as Permissions

    linked = await service._linked_files(contents, owner, Permissions(installed))
    assert [hit.filename for hit in linked[linker.id]] == ["policy.txt"]

    # Not for someone who may not read the page the file is attached to.
    await PermissionService(installed).set_page_restriction(
        holder, owner.id, PageRestrictionPermission.view, owner, group=False, present=True
    )
    assert await service._linked_files(contents, outsider, Permissions(installed)) == {
        linker.id: []
    }


async def test_only_names_the_wiki_never_mentions_are_unknown(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    await pages.create(space, PageCreate(title="Omnichannel", content="<p>travel desk</p>"), owner)

    service = SearchService(installed)
    assert await service.unknown_terms("hướng dẫn sử dụng 9router") == ["9router"]
    assert await service.unknown_terms("How do I use OpenClaw with omni") == ["OpenClaw"]
    # Ordinary words, and names a page mentions, are not.
    assert await service.unknown_terms("how does a request travel") == []
