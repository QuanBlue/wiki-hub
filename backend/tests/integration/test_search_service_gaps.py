"""The search service where it falls back: copies of a page, files read alone and in part,
neighbours that are weak, empty or too long, and a database that answers with an error."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.page import WikiPage
from app.modules.attachments import text as attachment_text
from app.modules.permissions.service import PermissionService
from app.modules.search import indexer
from app.modules.search import service as search_service
from app.modules.search.service import AnswerContext, AnswerPassage, SearchService
from app.schemas.page import PageCreate
from tests.integration import test_hybrid_semantic_search as semantic
from tests.integration.test_attachment_text import FakeStorage, _attach
from tests.integration.test_hybrid_semantic_search import _connect, _wiki

installed = semantic.installed

pytestmark = pytest.mark.integration


async def _page(session: AsyncSession, title: str) -> WikiPage:
    return (await session.execute(select(WikiPage).where(WikiPage.title == title))).scalars().one()


async def test_copies_of_one_page_use_one_place_and_the_pages_asked_for_are_not_exceeded(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    for title in ("Quarterly report", "Quarterly report (1)", "Quarterly report (2)"):
        await pages.create(
            space, PageCreate(title=title, content="<p>quarterly figures</p>"), owner
        )
    for n in range(4):
        await pages.create(
            space,
            PageCreate(title=f"Quarterly summary {n}", content="<p>quarterly figures</p>"),
            owner,
        )

    found = await SearchService(installed).answer_passages("quarterly figures", owner, max_pages=2)

    titles = [p.page.title for p in found]
    assert len(titles) == 2
    assert sum(t.startswith("Quarterly report") for t in titles) <= 1


async def test_a_page_found_only_by_the_words_of_its_file_names_that_file(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    page = await pages.create(space, PageCreate(title="Sales", content="<p>Deals</p>"), owner)
    storage = FakeStorage()
    attachment = await _attach(
        installed, storage, page, "prices.txt", b"The zircon licence costs 4200."
    )
    await attachment_text.extract_pending(installed, storage)  # type: ignore[arg-type]

    # No index at all: the file's own words are what is read, and it is named as read.
    found = await SearchService(installed).answer_passages("zircon licence", owner)

    assert [ref.id for ref in found[0].files] == [attachment.id]


async def test_a_file_that_is_not_there_cannot_be_asked_about(installed: AsyncSession) -> None:
    owner, _, _ = await _wiki(installed)
    with pytest.raises(NotFoundError):
        await SearchService(installed).file_context(uuid.uuid4(), "anything", owner)


LONG_FILE = (
    "Opening words about prices.\n\n"
    + "\n\n".join(f"Filler paragraph {n} about nothing in particular." for n in range(60))
    + "\n\nThe zircon licence costs 4200 per seat.\n\n"
    + "\n\n".join(f"More filler {n} that says little." for n in range(60))
)


async def test_a_long_file_gives_its_opening_and_the_stretch_asked_about(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    page = await pages.create(space, PageCreate(title="Sales", content="<p>Deals</p>"), owner)
    storage = FakeStorage()
    attachment = await _attach(installed, storage, page, "prices.txt", LONG_FILE.encode())
    await attachment_text.extract_pending(installed, storage)  # type: ignore[arg-type]

    context = await SearchService(installed).file_context(
        attachment.id, "zircon licence price", owner, total_chars=4000
    )

    text = context.passages[0].text
    assert "Opening words about prices" in text
    assert "4200 per seat" in text
    assert len(text) < 6000


async def test_a_long_file_is_also_read_by_meaning_when_it_is_indexed(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    config = await _connect(installed)
    page = await pages.create(space, PageCreate(title="Sales", content="<p>Deals</p>"), owner)
    storage = FakeStorage()
    attachment = await _attach(installed, storage, page, "prices.txt", LONG_FILE.encode())
    await attachment_text.extract_pending(installed, storage)  # type: ignore[arg-type]
    await indexer.index_pending(installed, config)
    search = SearchService(installed)

    context = await search.file_context(
        attachment.id, "zircon licence price", owner, total_chars=4000
    )
    # Its opening, and the passages of the index nearest to the question.
    assert "Opening words about prices" in context.passages[0].text
    assert await search._file_chunks("zircon licence price", attachment.id, config)

    # Nothing to compare with when the question is too short, or the database complains.
    assert await search._file_chunks("ab", attachment.id, config) == []

    real = installed.scalars

    async def refuse(*args, **kwargs):
        raise SQLAlchemyError("the index is being rebuilt")

    installed.scalars = refuse  # type: ignore[method-assign]
    try:
        assert await search._file_chunks("zircon licence price", attachment.id, config) == []
    finally:
        installed.scalars = real  # type: ignore[method-assign]


class _Neighbor:
    def __init__(self, page: WikiPage, score: float) -> None:
        self.page, self.score, self.via = page, score, ["link"]


async def _related_setup(installed: AsyncSession):
    owner, space, pages = await _wiki(installed)
    await _connect(installed)
    await pages.create(
        space, PageCreate(title="Leave policy", content="<p>Vacation rules</p>"), owner
    )
    await pages.create(
        space, PageCreate(title="Form", content="<p>Signed by your manager</p>"), owner
    )
    await pages.create(space, PageCreate(title="Blank", content=""), owner)
    await pages.create(space, PageCreate(title="Weak", content="<p>Barely related</p>"), owner)
    await pages.create(space, PageCreate(title="Extra", content="<p>Another neighbour</p>"), owner)
    search = SearchService(installed)
    found = await search.answer_passages("vacation rules", owner)
    return owner, search, found


async def _related(installed, owner, search, found, monkeypatch, neighbors, **kwargs):
    async def fake(session, seeds, *, limit):
        if isinstance(neighbors, Exception):
            raise neighbors
        return neighbors

    monkeypatch.setattr(search_service, "related_pages", fake)
    from app.modules.ai.config import load_config

    config = await load_config(installed)
    return await search._related_passages(
        "vacation rules",
        owner,
        PermissionService(installed),
        found,
        config,
        [("vacation", 1.0)],
        wanted=kwargs.get("wanted", 2),
        passage_chars=900,
        room=kwargs.get("room", 5000),
    )


async def test_neighbours_that_are_weak_empty_or_too_many_are_left_out(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, search, found = await _related_setup(installed)
    form = await _page(installed, "Form")
    blank = await _page(installed, "Blank")
    weak = await _page(installed, "Weak")
    extra = await _page(installed, "Extra")
    for page in (form, blank, weak, extra):
        await installed.refresh(page, ["space"])

    # A database that complains gives nothing.
    assert await _related(installed, owner, search, found, monkeypatch, SQLAlchemyError("x")) == []
    # Nothing strong enough, nothing but an empty page: nothing.
    assert (
        await _related(installed, owner, search, found, monkeypatch, [_Neighbor(weak, 0.1)]) == []
    )
    assert (
        await _related(installed, owner, search, found, monkeypatch, [_Neighbor(blank, 0.9)]) == []
    )
    # As many as were wanted, the strongest first.
    chosen = await _related(
        installed,
        owner,
        search,
        found,
        monkeypatch,
        [_Neighbor(form, 0.9), _Neighbor(extra, 0.8), _Neighbor(weak, 0.8)],
        wanted=1,
    )
    assert [p.page.title for p in chosen] == ["Form"]
    # A page that does not fit what room is left is skipped, not cut.
    assert (
        await _related(installed, owner, search, found, monkeypatch, [_Neighbor(form, 0.9)], room=3)
        == []
    )


async def test_two_questions_finding_one_page_give_it_one_source_with_both_stretches(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, space, pages = await _wiki(installed)
    await pages.create(space, PageCreate(title="Guide", content="<p>x</p>"), owner)
    guide = await _page(installed, "Guide")
    await installed.refresh(guide, ["space"])

    def passage(text: str, file: str | None) -> AnswerPassage:
        from app.modules.search.service import FileRef, SearchResultPage

        page = SearchResultPage(
            id=guide.id,
            title="Guide",
            slug=guide.slug,
            space_key=guide.space.key,
            space_name=guide.space.name,
            snippet="",
            updated_at=guide.updated_at,
        )
        files = [FileRef(uuid.UUID(int=1), file)] if file else []
        return AnswerPassage(page=page, text=text, files=files)

    answers = iter(
        [
            AnswerContext([passage("first stretch", None)], "low"),
            AnswerContext([passage("second stretch", "a.txt")], "high"),
            AnswerContext([passage("first stretch", None)], "low"),
        ]
    )

    async def fake(self, question, user, **limits):
        return next(answers)

    monkeypatch.setattr(SearchService, "answer_context", fake)

    context = await SearchService(installed).answer_context_each(["one", "two", "three"], owner)

    [only] = context.passages
    assert only.text == "first stretch\n\n...\n\nsecond stretch"
    assert [f.filename for f in only.files] == ["a.txt"]
    assert context.confidence == "high"


async def test_questions_that_name_no_word_or_meet_a_failing_database_find_nothing(
    installed: AsyncSession,
) -> None:
    await _wiki(installed)
    search = SearchService(installed)

    assert await search.unknown_terms("") == []
    assert await search._file_hits("", [], 5) == {}
    assert await search._named_space_pages("ab", [], 5) == []

    async def refuse(*args, **kwargs):
        raise SQLAlchemyError("down")

    real = search._idea_weights
    search._idea_weights = refuse  # type: ignore[method-assign]
    try:
        assert await search.unknown_terms("zircon licence") == []
    finally:
        search._idea_weights = real  # type: ignore[method-assign]


async def test_a_file_is_not_read_by_meaning_when_the_gateway_gives_no_vector(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, space, pages = await _wiki(installed)
    config = await _connect(installed)
    page = await pages.create(space, PageCreate(title="Sales", content="<p>Deals</p>"), owner)
    storage = FakeStorage()
    attachment = await _attach(installed, storage, page, "prices.txt", b"The words")

    async def none(config, query):
        return None

    monkeypatch.setattr(search_service, "_embed_query", none)

    assert await SearchService(installed)._file_chunks("any question", attachment.id, config) == []


async def test_a_named_space_that_cannot_be_searched_gives_no_pages(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, space, pages = await _wiki(installed)
    await pages.create(space, PageCreate(title="Guide", content="<p>alpha</p>"), owner)
    search = SearchService(installed)
    concepts = search_service.build_concepts("alpha")
    real = installed.execute
    calls = {"n": 0}

    async def second_fails(statement, *args, **kwargs):
        calls["n"] += 1
        if calls["n"] >= 2:
            raise SQLAlchemyError("down")
        return await real(statement, *args, **kwargs)

    monkeypatch.setattr(installed, "execute", second_fails)

    assert await search._named_space_pages(f"{space.key} alpha", concepts, 5) == []


async def test_a_failing_cache_never_fails_a_search(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.ai.embeddings import EmbeddingError

    config = await _connect(installed)

    async def refuse(config, texts):
        raise EmbeddingError("down")

    class BrokenRedis:
        async def get(self, key):
            return None

        async def set(self, *args, **kwargs):
            raise OSError("redis is down")

    monkeypatch.setattr(search_service, "embed", refuse)
    monkeypatch.setattr(search_service, "get_redis", lambda: BrokenRedis())

    assert await search_service._embed_query(config, "any question") is None
