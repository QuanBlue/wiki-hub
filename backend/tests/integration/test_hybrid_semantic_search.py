"""Hybrid (keyword + trigram) and semantic page search against a real database.

The embedding gateway is replaced by a tiny deterministic "model" that maps a
few concepts to vector dimensions, so a query can match a page it shares no
words with - exactly what semantic search is for.
"""

from __future__ import annotations

import re
import uuid

import pytest
from sqlalchemy import event, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_connection import AiConnection
from app.models.ai_embedding_settings import AiEmbeddingSettings
from app.models.page import WikiPage
from app.models.restriction import PageRestrictionPermission
from app.models.space import SpaceRole
from app.models.user import User
from app.modules.admin_mail.crypto import encrypt_password
from app.modules.ai import embeddings as embeddings_module
from app.modules.ai.config import AIConfig, load_config
from app.modules.auth.service import AuthService
from app.modules.pages.service import PageService
from app.modules.permissions.service import PermissionService
from app.modules.search import indexer
from app.modules.search import service as search_module
from app.modules.search.ddl import (
    SEMANTIC_TABLE_STATEMENTS,
    STORED_VECTOR_STATEMENTS,
    functions_sql,
)
from app.modules.search.service import SearchService
from app.modules.spaces.service import SpaceService
from app.schemas.page import PageCreate
from app.schemas.space import SpaceCreate
from app.schemas.user import UserCreate

pytestmark = pytest.mark.integration

#: word -> dimension; words in one group mean the same thing to the fake model.
CONCEPTS = {
    "ip": 0,
    "address": 0,
    "network": 0,
    "payroll": 1,
    "salary": 1,
    "wages": 1,
    "holiday": 2,
    "vacation": 2,
}
DIMENSIONS = 4


def fake_vector(value: str) -> list[float]:
    vector = [0.0] * DIMENSIONS
    for word in re.findall(r"[a-z]+", value.lower()):
        if word in CONCEPTS:
            vector[CONCEPTS[word]] += 1.0
    vector[DIMENSIONS - 1] += 0.001  # never the zero vector
    return vector


class FakeRedis:
    def __init__(self) -> None:
        self.data: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self.data.get(key)

    async def set(self, key: str, value: str, **_: object) -> None:
        self.data[key] = value

    async def delete(self, key: str) -> None:
        self.data.pop(key, None)


@pytest.fixture
async def installed(session: AsyncSession, monkeypatch: pytest.MonkeyPatch) -> AsyncSession:
    """The search objects the migration creates, built in this test's schema."""
    schema = await session.scalar(text("SELECT current_schema()"))
    try:
        for extension in ("unaccent", "pg_trgm", "vector"):
            await session.execute(text(f"CREATE EXTENSION IF NOT EXISTS {extension}"))
    except SQLAlchemyError:
        await session.rollback()
        pytest.skip("the unaccent, pg_trgm and vector extensions are not available")
    extension_schema = await session.scalar(
        text(
            "SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace "
            "WHERE e.extname = 'unaccent'"
        )
    )
    # The extensions' types and operators live in another schema. Every new
    # connection (a commit hands the connection back) must see them too.
    path = f'SET search_path TO "{schema}", "{extension_schema}"'

    @event.listens_for(session.bind.sync_engine, "connect")
    def _extend_search_path(dbapi_connection, _record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute(path)
        cursor.close()

    await session.execute(text(path))
    for statement in functions_sql(extension_schema):
        await session.execute(text(statement))
    for statement in STORED_VECTOR_STATEMENTS:
        await session.execute(text(statement))
    for statement in SEMANTIC_TABLE_STATEMENTS:
        await session.execute(text(statement))

    async def fake_embed(config: AIConfig, texts: list[str]) -> list[list[float]]:
        return [fake_vector(t) for t in texts]

    redis = FakeRedis()
    monkeypatch.setattr(search_module, "embed", fake_embed)
    monkeypatch.setattr(indexer, "embed", fake_embed)
    monkeypatch.setattr(search_module, "get_redis", lambda: redis)
    monkeypatch.setattr(indexer, "get_redis", lambda: redis)
    return session


async def _user(session: AsyncSession, prefix: str) -> User:
    name = f"{prefix}{uuid.uuid4().hex[:8]}"
    return await AuthService(session).create_user(
        UserCreate(
            username=name,
            email=f"{name}@example.com",
            full_name=prefix,
            password="password-1234",
        )
    )


async def _connect(session: AsyncSession, embedding_model: str = "fake-embed") -> AIConfig:
    """An active AI connection, with semantic search using it (blank model = off)."""
    await session.execute(text("DELETE FROM ai_connections"))
    await session.execute(text("DELETE FROM ai_embedding_settings"))
    session.add(
        AiConnection(
            name="test",
            base_url="http://gateway.invalid/v1",
            model="chat-model",
            api_key_encrypted=encrypt_password("secret-key"),
            api_key_preview="****",
            is_active=True,
        )
    )
    session.add(AiEmbeddingSettings(id=1, source="provider", model=embedding_model))
    await session.flush()
    return await load_config(session)


async def _wiki(session: AsyncSession) -> tuple[User, object, PageService]:
    owner = await _user(session, "owner")
    space = await SpaceService(session).create(
        SpaceCreate(key=f"S{uuid.uuid4().hex[:7]}", name="Search space"), owner
    )
    return owner, space, PageService(session)


async def test_natural_question_ranks_the_matching_page_first(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    target = await pages.create(
        space,
        PageCreate(title="Tessel Abbott", content="<p>Workstation IP: 10.0.0.5</p>"),
        owner,
    )
    await pages.create(
        space, PageCreate(title="Holiday policy", content="<p>Of the year</p>"), owner
    )
    await pages.create(
        space, PageCreate(title="Onboarding", content="<p>Where is the kitchen</p>"), owner
    )

    result = await SearchService(installed).search("ip của Tessel Abbott là bao nhiêu?", owner)

    assert result.pages[0].id == target.id
    assert all(page.title != "Onboarding" for page in result.pages)


async def test_title_search_ignores_accents_and_tolerates_typos(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    page = await pages.create(space, PageCreate(title="Đặng Văn Hùng", content=""), owner)

    for query in ("dang van hung", "Đặng Văn", "Dang Van Hunq"):
        result = await SearchService(installed).search(query, owner)
        assert page.id in [hit.id for hit in result.pages], query


async def test_substring_matches_still_found_when_ranked_search_misses(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    page = await pages.create(
        space, PageCreate(title="Runbook", content="<p>token abc-def_ghi123</p>"), owner
    )
    result = await SearchService(installed).search("def_ghi", owner)
    assert [hit.id for hit in result.pages] == [page.id]


async def test_search_still_works_without_the_search_functions(session: AsyncSession) -> None:
    """A database that never ran the migration falls back to substring search."""
    owner, space, pages = await _wiki(session)
    page = await pages.create(space, PageCreate(title="Plain", content="<p>needle</p>"), owner)
    result = await SearchService(session).search("needle", owner)
    assert [hit.id for hit in result.pages] == [page.id]


async def test_semantic_search_finds_pages_by_meaning(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    config = await _connect(installed)
    salary = await pages.create(
        space,
        PageCreate(title="Compensation", content="<p>Monthly payroll runs on the 25th.</p>"),
        owner,
    )
    await pages.create(
        space, PageCreate(title="Time off", content="<p>Vacation requests</p>"), owner
    )

    total = (await indexer.index_status(installed, config)).total  # includes the space's home page
    assert await indexer.index_pending(installed, config) == total

    # "salary" appears nowhere in any page; it only means the same as "payroll".
    result = await SearchService(installed).search("salary", owner)
    assert [hit.id for hit in result.pages] == [salary.id]
    assert "payroll" in result.pages[0].snippet.lower()

    status = await indexer.index_status(installed, config)
    assert (status.available, status.total, status.indexed) == (True, total, total)


async def test_semantic_results_respect_page_restrictions(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    outsider = await _user(installed, "outsider")
    await SpaceService(installed).set_member(space, owner, outsider.id, SpaceRole.editor)
    config = await _connect(installed)
    secret = await pages.create(
        space, PageCreate(title="Board pay", content="<p>payroll for directors</p>"), owner
    )
    await PermissionService(installed).set_page_restriction(
        secret, owner.id, PageRestrictionPermission.view, owner, group=False, present=True
    )
    await indexer.index_pending(installed, config)

    assert (await SearchService(installed).search("wages", owner)).pages != []
    assert (await SearchService(installed).search("wages", outsider)).pages == []


async def test_edited_pages_are_reindexed_and_deleted_ones_forgotten(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    config = await _connect(installed)
    page = await pages.create(space, PageCreate(title="Doc", content="<p>vacation days</p>"), owner)
    total = (await indexer.index_status(installed, config)).total
    assert await indexer.index_pending(installed, config) == total
    assert await indexer.index_pending(installed, config) == 0  # nothing changed

    row = await installed.get(WikiPage, page.id)
    row.content = "<p>payroll cut-off</p>"
    await installed.flush()
    await installed.execute(
        text("UPDATE pages SET updated_at = now() + interval '1 minute' WHERE id = :id"),
        {"id": page.id},
    )
    assert await indexer.index_pending(installed, config) == 1
    assert [hit.id for hit in (await SearchService(installed).search("wages", owner)).pages] == [
        page.id
    ]

    await installed.execute(text("DELETE FROM pages WHERE id = :id"), {"id": page.id})
    remaining = await installed.scalar(
        text("SELECT count(*) FROM page_chunks WHERE page_id = :id"), {"id": page.id}
    )
    assert remaining == 0


async def test_changing_the_embedding_model_rebuilds_the_index(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    config = await _connect(installed, "model-a")
    await pages.create(space, PageCreate(title="Doc", content="<p>payroll</p>"), owner)
    await indexer.index_pending(installed, config)

    config_b = await _connect(installed, "model-b")
    status = await indexer.index_status(installed, config_b)
    assert status.indexed == 0  # vectors from model-a do not count
    assert await indexer.index_pending(installed, config_b) == status.total
    models = (await installed.scalars(text("SELECT DISTINCT model FROM page_search_state"))).all()
    assert list(models) == ["model-b"]


async def test_semantic_search_is_off_without_an_embedding_model(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    config = await _connect(installed, "")
    await pages.create(space, PageCreate(title="Doc", content="<p>payroll</p>"), owner)
    assert await indexer.index_pending(installed, config) == 0
    assert (await SearchService(installed).search("salary", owner)).pages == []


async def _page(pages: PageService, space: object, owner: User, title: str, body: str) -> WikiPage:
    return await pages.create(space, PageCreate(title=title, content=f"<p>{body}</p>"), owner)


async def test_rarer_words_decide_and_weakly_related_pages_are_left_out(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    target = await _page(pages, space, owner, "Account ViettelCloud", "login nutifood vts secret")
    await _page(pages, space, owner, "Account Dev", "login dev secret")
    await _page(pages, space, owner, "Hosting", "cloud hosting plans")
    await _page(pages, space, owner, "Cloud guide", "cloud cloud cloud setup")
    await _page(pages, space, owner, "Cloud costs", "cloud pricing")

    result = await SearchService(installed).search("tài khoản cloud của nuti", owner)

    # "nuti" is mentioned on one page, "cloud" on four: the rare word decides,
    # and pages that only share "cloud" are not listed at all.
    assert [hit.id for hit in result.pages] == [target.id]
    assert {"account", "tai khoan", "cloud", "nuti"} <= set(result.terms)
    # The passage shown is the one with the telling word, not the first "cloud".
    assert "nutifood" in result.pages[0].snippet.lower()


async def test_a_vietnamese_query_finds_the_english_page_and_the_reverse(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    english = await _page(pages, space, owner, "Account list", "nothing here")
    vietnamese = await _page(pages, space, owner, "Hướng dẫn cài đặt", "các bước")
    await _page(pages, space, owner, "Unrelated", "kitchen")

    by_vietnamese = await SearchService(installed).search("tài khoản", owner)
    assert [hit.id for hit in by_vietnamese.pages] == [english.id]

    by_english = await SearchService(installed).search("install guide", owner)
    assert [hit.id for hit in by_english.pages] == [vietnamese.id]


async def test_asking_about_ip_finds_the_pages_that_list_addresses_and_shows_them(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    with_ip = await _page(
        pages, space, owner, "DMS SaaS", "Grafana for dms at http://117.1.29.44:8801 (login below)"
    )
    # Same system, but nothing that is an address (a version number is not one).
    await _page(pages, space, owner, "DMS accounts", "dms login and password, release 1.2.3")
    await _page(pages, space, owner, "Holiday", "ip is not mentioned, nor is any system")

    result = await SearchService(installed).search("ip hệ thống dms", owner)

    assert result.pages[0].id == with_ip.id
    # What is shown is the address itself, and it is what gets marked.
    assert "117.1.29.44" in result.pages[0].snippet
    assert "ipaddr" in result.terms


async def test_a_title_that_only_shares_a_generic_word_is_not_an_answer(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    target = await _page(pages, space, owner, "DMS servers", "dms ip 10.1.1.1")
    await _page(pages, space, owner, "Tài khoản hệ thống", "nothing relevant here")

    result = await SearchService(installed).search("ip hệ thống dms", owner)

    assert [hit.id for hit in result.pages] == [target.id]


async def test_a_page_must_cover_half_of_what_was_asked(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    both = await _page(pages, space, owner, "Network notes", "alpha bravo")
    await _page(pages, space, owner, "One word", "alpha only")
    await _page(pages, space, owner, "Another", "charlie")

    result = await SearchService(installed).search("alpha bravo", owner)

    assert result.pages[0].id == both.id
    # "alpha" alone is one of two equally common-ish ideas: still half, so listed
    # after the page with both - but a page with neither never is.
    assert all(hit.title != "Another" for hit in result.pages)


async def test_indexing_marks_nothing_done_when_the_model_cannot_embed(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.ai.embeddings import EmbeddingError

    owner, space, pages = await _wiki(installed)
    await _page(pages, space, owner, "One", "payroll")
    await _page(pages, space, owner, "Two", "vacation")
    config = await _connect(installed, "chat-model")

    async def refusing(config: AIConfig, texts: list[str]) -> list[list[float]]:
        raise EmbeddingError("Could not create embeddings (HTTP 404).", permanent=True)

    monkeypatch.setattr(indexer, "embed", refusing)
    assert await indexer.index_pending(installed, config) == 0

    status = await indexer.index_status(installed, config)
    # Nothing is pretended: no page counts as indexed, and the reason is reported.
    assert status.indexed == 0 and status.total > 0
    assert status.error == "Could not create embeddings (HTTP 404)."
    count = await installed.scalar(text("SELECT count(*) FROM page_search_state"))
    assert count == 0

    # Once the gateway works, everything is picked up and the error goes away.
    async def working(config: AIConfig, texts: list[str]) -> list[list[float]]:
        return [fake_vector(t) for t in texts]

    monkeypatch.setattr(indexer, "embed", working)
    assert await indexer.index_pending(installed, config) == status.total
    assert (await indexer.index_status(installed, config)).error is None


async def test_a_page_the_gateway_alone_refuses_is_skipped_not_retried_forever(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.ai.embeddings import EmbeddingError

    owner, space, pages = await _wiki(installed)
    await _page(pages, space, owner, "Fine", "payroll")
    await _page(pages, space, owner, "Poison", "forbidden words")
    config = await _connect(installed)
    calls: list[str] = []

    async def picky(config: AIConfig, texts: list[str]) -> list[list[float]]:
        calls.extend(texts)
        if any("forbidden" in t for t in texts):
            raise EmbeddingError("rejected (HTTP 422).", permanent=True)
        return [fake_vector(t) for t in texts]

    monkeypatch.setattr(indexer, "embed", picky)
    total = (await indexer.index_status(installed, config)).total
    # Everything but the poison page is embedded; the poison one is handled.
    assert await indexer.index_pending(installed, config) == total - 1
    status = await indexer.index_status(installed, config)
    # The skipped page counts as handled, so the bar can reach 100%.
    assert status.indexed == total and status.error is None
    assert (
        await installed.scalar(
            text("SELECT chunk_count FROM page_search_state WHERE chunk_count = -1")
        )
        == -1
    )

    before = len(calls)
    assert await indexer.index_pending(installed, config) == 0
    assert len(calls) == before  # not asked again until the page is edited


class _LogRecorder:
    def __init__(self) -> None:
        self.events: list[tuple[str, str, dict]] = []

    def __getattr__(self, level: str):
        def record(event: str, **fields: object) -> None:
            self.events.append((level, event, fields))

        return record

    def named(self, event: str) -> list[tuple[str, dict]]:
        return [(lv, f) for lv, name, f in self.events if name == event]


async def test_every_indexing_pass_ends_with_one_summary_line(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    log = _LogRecorder()
    monkeypatch.setattr(indexer, "logger", log)
    owner, space, pages = await _wiki(installed)
    await _page(pages, space, owner, "One", "payroll runs monthly")
    await _page(pages, space, owner, "Two", "vacation days")
    config = await _connect(installed)
    total = (await indexer.index_status(installed, config)).total

    await indexer.index_pending(installed, config)

    ((level, summary),) = log.named("search_index_pass")
    assert level == "info"
    assert summary["pages_indexed"] == total and summary["pages_skipped"] == 0
    assert summary["chunks"] >= total and summary["embed_requests"] >= total
    assert summary["backlog_remaining"] == 0
    assert summary["stopped"] == "batch_done"
    assert summary["model"] == "fake-embed"
    for key in ("embed_seconds", "seconds_per_page", "total_seconds"):
        assert key in summary
    # No page text or title in the summary line.
    assert "payroll" not in repr(log.events)

    # A pass with nothing to do says nothing at info level.
    log.events.clear()
    await indexer.index_pending(installed, config)
    assert log.named("search_index_pass") == []


async def test_a_pass_that_hits_its_time_budget_says_what_is_left(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    log = _LogRecorder()
    monkeypatch.setattr(indexer, "logger", log)
    owner, space, pages = await _wiki(installed)
    await _page(pages, space, owner, "One", "payroll")
    config = await _connect(installed)

    # A deadline already in the past: stop before the first page.
    await indexer.index_pending(installed, config, deadline=0.0)

    ((_, summary),) = log.named("search_index_pass")
    assert summary["stopped"] == "time_budget"
    assert summary["pages_indexed"] == 0 and summary["backlog_remaining"] >= 1


async def test_a_model_that_cannot_embed_is_logged_with_the_gateways_reply_and_a_hint(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.ai.embeddings import EmbeddingError

    log = _LogRecorder()
    monkeypatch.setattr(indexer, "logger", log)
    owner, space, pages = await _wiki(installed)
    await _page(pages, space, owner, "One", "payroll")
    config = await _connect(installed, "chat-model")

    async def refusing(config: AIConfig, texts: list[str]) -> list[list[float]]:
        raise EmbeddingError(
            "Could not create embeddings (HTTP 404).",
            permanent=True,
            status=404,
            detail='{"detail":"Not Found"}',
        )

    monkeypatch.setattr(indexer, "embed", refusing)
    await indexer.index_pending(installed, config)

    ((level, paused),) = log.named("search_index_paused")
    assert level == "warning"
    assert paused["reason"] == "model_cannot_embed"
    assert paused["status"] == 404 and "Not Found" in paused["detail"]
    assert paused["model"] == "chat-model" and "chat model" in paused["hint"]
    assert log.named("search_index_page_refused")  # each refusal is logged too
    ((_, summary),) = log.named("search_index_pass")
    assert summary["pages_indexed"] == 0 and summary["stopped"] != "batch_done"


async def test_a_slow_search_is_a_warning_that_says_where_the_time_went_but_not_what_was_asked(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    log = _LogRecorder()
    monkeypatch.setattr(search_module, "logger", log)
    monkeypatch.setattr(search_module, "_SLOW_SEARCH_SECONDS", 0.0)
    owner, space, pages = await _wiki(installed)
    await _page(pages, space, owner, "Runbook", "needle")

    await SearchService(installed).search("needle", owner)

    ((level, fields),) = log.named("search_slow")
    assert level == "warning"
    assert fields["results"] == 1 and fields["keyword_hits"] >= 1
    assert {"keyword_seconds", "semantic_seconds", "total_seconds"} <= set(fields)
    assert fields["ranked_search_degraded"] is False
    assert "needle" not in repr(log.events)  # only the length of the query is logged
    assert fields["query_chars"] == len("needle")


async def test_the_heartbeat_is_called_after_every_indexed_page(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    await _page(pages, space, owner, "One", "payroll")
    await _page(pages, space, owner, "Two", "vacation")
    config = await _connect(installed)
    beats: list[int] = []

    async def beat() -> None:
        beats.append(1)

    indexed = await indexer.index_pending(installed, config, heartbeat=beat)

    # A caller holding a lock renews it per page: one page can take minutes.
    assert indexed >= 2 and len(beats) == indexed


async def test_semantic_hits_must_be_close_to_the_best_not_merely_above_a_floor(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Models score unrelated pages high (bge-m3: 0.5+), so "above 0.3" keeps everything.
    What separates the right page from the rest is being close to the top hit."""
    owner, space, pages = await _wiki(installed)
    config = await _connect(installed)
    close = await _page(pages, space, owner, "Close", "alpha")
    far = await _page(pages, space, owner, "Far", "beta")
    await indexer.index_pending(installed, config)
    # Make the stored vectors known angles from the query vector [1, 0, 0, 0].
    for page, vector in ((close, "[0.95,0.3122,0,0]"), (far, "[0.7,0.7141,0,0]")):
        await installed.execute(
            text("UPDATE page_chunks SET embedding = CAST(:v AS vector) WHERE page_id = :p"),
            {"v": vector, "p": page.id},
        )

    async def query_vector(config: AIConfig, texts: list[str]) -> list[list[float]]:
        return [[1.0, 0.0, 0.0, 0.0]]

    monkeypatch.setattr(search_module, "embed", query_vector)

    async def found(margin: float) -> list[str]:
        # The margin is a setting saved in the admin UI, not an environment value.
        row = await installed.get(AiEmbeddingSettings, 1)
        row.min_similarity, row.margin = 0.3, margin
        await installed.flush()
        result = await SearchService(installed).search("zzzz", owner)  # no keyword hit
        return [hit.title for hit in result.pages]

    # 0.95 and 0.70 against the query: a 0.10 margin keeps only the close one.
    assert await found(0.10) == ["Close"]
    # A wider margin lets the weaker one in, below the better one.
    assert await found(0.30) == ["Close", "Far"]


async def test_pages_per_pass_follows_the_saved_setting(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    for number in range(4):
        await _page(pages, space, owner, f"Page {number}", "payroll")
    config = await _connect(installed)
    row = await installed.get(AiEmbeddingSettings, 1)
    row.index_batch = 2
    await installed.flush()
    config = await load_config(installed)

    assert await indexer.index_pending(installed, config) == 2  # not the default 20
    assert await indexer.index_pending(installed, config) == 2
    assert await indexer.index_pending(installed, config) >= 1  # the rest (+ the space home)


async def test_passages_per_page_and_per_request_follow_the_saved_settings(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, space, pages = await _wiki(installed)
    body = "".join(f"<p>{'word ' * 150}number {n}</p>" for n in range(12))  # many passages
    await pages.create(space, PageCreate(title="Long", content=body), owner)
    await _connect(installed)
    row = await installed.get(AiEmbeddingSettings, 1)
    row.max_chunks_per_page, row.embed_batch_size = 3, 2
    await installed.flush()
    config = await load_config(installed)
    sizes: list[int] = []

    async def spy(cfg: AIConfig, inputs: list[str]) -> list[list[float]]:
        sizes.append(len(inputs))
        return [fake_vector(t) for t in inputs]

    # The fixture fakes ``embed`` itself; use the real one, spying on the HTTP call.
    monkeypatch.setattr(embeddings_module, "_post", spy)
    monkeypatch.setattr(indexer, "embed", embeddings_module.embed)

    await indexer.index_pending(installed, config)

    chunks = await installed.scalar(
        text(
            "SELECT max(chunk_count) FROM page_search_state s JOIN pages p ON p.id = s.page_id "
            "WHERE p.title = 'Long'"
        )
    )
    assert chunks == 3  # cut at the saved maximum, not 60
    assert sizes and max(sizes) <= 2  # requests of at most the saved size
