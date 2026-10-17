"""The review step of the document-import worker, against a real PostgreSQL database.

What is under test is the bookkeeping around the review - that it runs only when asked, that a
mended page becomes a revision of its own with the page as converted kept in the history, that
what it found is recorded on the item and counted on the job, and that nothing it does can cost
the import. The review itself is covered by ``tests/unit/test_document_review.py``.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import RateLimitedError, ServiceUnavailableError
from app.models.revision import PageRevision
from app.modules.ai.client import ChatReply, Usage
from app.modules.ai.config import AIConfig
from app.modules.document_import import jobs as jobs_module
from app.modules.document_import.convert import ExtractedDocument
from app.modules.document_import.jobs import run_document_import
from app.modules.document_import.review import Review
from tests.integration.test_document_import_worker import (
    FakeStorage,
    _imported_pages,
    _make_job,
    _patch_extract,
)

pytestmark = pytest.mark.integration

CONVERTED = "<p>Quarterly report</p><p>Revenue grew.</p>"
MENDED = "<h1>Quarterly report</h1><p>Revenue grew.</p>"


class Reviewer:
    """Stands in for ``review_import``: records what it was given, returns ``outcome``."""

    def __init__(self, outcome: Review | Exception) -> None:
        self.outcome = outcome
        self.calls: list[dict] = []

    async def __call__(self, html, source, source_format, *, ask=None, report=None):
        self.calls.append(
            {"html": html, "format": source_format, "ask": ask, "exists": source.exists()}
        )
        if report is not None:
            await report(["Looking at the page."])
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


def _ready() -> AIConfig:
    return AIConfig(True, "http://gateway.invalid/v1", "key", "model")


async def _run(session, monkeypatch, *, review: bool, outcome, ai: AIConfig | None = None):
    storage = FakeStorage()
    job, space, user = await _make_job(session, storage, ["Report.docx"])
    job.ai_review = review
    await session.commit()
    _patch_extract(monkeypatch, {"Report.docx": ExtractedDocument(html=CONVERTED)})
    reviewer = Reviewer(outcome)
    monkeypatch.setattr(jobs_module, "review_import", reviewer)

    async def config(_session):
        return ai or AIConfig(False, "", "", "")

    monkeypatch.setattr(jobs_module, "load_config", config)
    await run_document_import(session, storage, job.id)
    await session.refresh(job)
    return job, space, user, reviewer


async def _revisions(session: AsyncSession, page) -> list[PageRevision]:
    return list(
        (
            await session.execute(
                select(PageRevision)
                .where(PageRevision.page_id == page.id)
                .order_by(PageRevision.version)
            )
        )
        .scalars()
        .all()
    )


async def test_a_page_is_not_reviewed_unless_the_person_asked(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    job, space, _, reviewer = await _run(
        session, monkeypatch, review=False, outcome=Review("fixed", MENDED, 3, 0, 3)
    )

    assert reviewer.calls == []
    [page] = await _imported_pages(session, space)
    assert page.content == CONVERTED
    assert job.items[0].review is None and job.counters["pages_reviewed"] == 0


async def test_a_mended_page_is_saved_as_a_revision_of_its_own_and_recorded(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    outcome = Review(
        "fixed", MENDED, 3, 0, 2, 1, ["set 1 heading level", "restored 1 missing block"]
    )

    job, space, _, reviewer = await _run(
        session, monkeypatch, review=True, outcome=outcome, ai=_ready()
    )

    [page] = await _imported_pages(session, space)
    assert page.content == MENDED
    # The review was given the converted page, the file still on disk, and a model to ask.
    [call] = reviewer.calls
    assert call["html"] == CONVERTED and call["format"] == "docx"
    assert call["exists"] is True and call["ask"] is not None
    # The page as converted is the first revision; the mended one is another, with its reason.
    revisions = await _revisions(session, page)
    assert [r.content for r in revisions] == [CONVERTED, MENDED]
    assert revisions[0].change_summary == "Imported from Report.docx"
    assert revisions[1].change_summary == "Review of the import from Report.docx: 2 fixes"
    record = job.items[0].review
    assert record["status"] == "fixed" and record["fixes"] == 2 and record["ai_calls"] == 1
    assert job.counters["pages_reviewed"] == 1 and job.counters["review_fixes"] == 2
    assert job.items[0].status == "complete" and job.status == "complete"


async def test_a_page_the_review_left_alone_gets_no_new_revision(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    job, space, _, _ = await _run(
        session,
        monkeypatch,
        review=True,
        outcome=Review("clean", CONVERTED, notes=["the page matches"]),
    )

    [page] = await _imported_pages(session, space)
    assert len(await _revisions(session, page)) == 1
    assert job.items[0].review["status"] == "clean" and job.counters["pages_reviewed"] == 1


async def test_without_the_ai_assistant_the_review_still_runs_and_says_so(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    outcome = Review("partial", MENDED, 3, 1, 2, 0, ["1 difference left"])

    job, space, _, reviewer = await _run(session, monkeypatch, review=True, outcome=outcome)

    assert reviewer.calls[0]["ask"] is None
    [page] = await _imported_pages(session, space)
    assert page.content == MENDED
    notes = job.items[0].review["notes"]
    assert any("not set up" in note for note in notes)


async def test_a_review_that_blows_up_costs_nothing_of_the_import(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    job, space, _, _ = await _run(
        session, monkeypatch, review=True, outcome=RuntimeError("boom"), ai=_ready()
    )

    [page] = await _imported_pages(session, space)
    assert page.content == CONVERTED
    assert job.items[0].status == "complete" and job.status == "complete"
    assert job.items[0].review["status"] == "failed"
    assert job.counters["pages_reviewed"] == 0


async def test_a_review_that_runs_out_of_time_is_recorded_as_failed(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(jobs_module, "REVIEW_DEADLINE_SECONDS", 0.05)

    async def slow(html, source, source_format, *, ask=None, report=None):
        import asyncio

        await asyncio.sleep(5)
        return Review("fixed", MENDED)

    storage = FakeStorage()
    job, space, _ = await _make_job(session, storage, ["Report.docx"])
    job.ai_review = True
    await session.commit()
    _patch_extract(monkeypatch, {"Report.docx": ExtractedDocument(html=CONVERTED)})
    monkeypatch.setattr(jobs_module, "review_import", slow)

    async def config(_session):
        return AIConfig(False, "", "", "")

    monkeypatch.setattr(jobs_module, "load_config", config)
    await run_document_import(session, storage, job.id)

    [page] = await _imported_pages(session, space)
    assert page.content == CONVERTED
    await session.refresh(job)
    assert job.items[0].review["status"] == "failed" and job.status == "complete"


# ------------------------------------------------------------------ the model it is given


async def test_the_model_the_review_asks_is_counted_and_has_its_own_allowance(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    asked: list[dict] = []
    usage: list[dict] = []
    hits: list[str] = []

    async def chat(config, messages, *, max_tokens: int = 2000, temperature: float = 0.2):
        asked.append({"messages": messages, "max_tokens": max_tokens, "temperature": temperature})
        return ChatReply("[]", Usage(30, 4))

    async def record(**kwargs) -> None:
        usage.append(kwargs)

    async def enforce(key: str, rule: str) -> None:
        hits.append(key)

    monkeypatch.setattr(jobs_module, "chat_with_usage", chat)
    monkeypatch.setattr(jobs_module, "record_ai_usage", record)
    monkeypatch.setattr(jobs_module.rate_limit, "enforce", enforce)

    class Person:
        id = "person-1"

    ask = jobs_module._asker(_ready(), Person())  # type: ignore[arg-type]
    reply = await ask("system rules", "the question")

    assert reply == "[]"
    assert asked[0]["temperature"] == 0.0 and asked[0]["max_tokens"] == 3000
    assert [m["role"] for m in asked[0]["messages"]] == ["system", "user"]
    assert usage[0]["feature"] == "import_review" and usage[0]["prompt_tokens"] == 30
    # Its own allowance: chatting with the assistant does not use it up, and it does not use that.
    assert hits == ["aireview:person-1"]


async def test_a_model_that_is_busy_or_over_its_allowance_is_just_not_asked(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def down(*args, **kwargs):
        raise ServiceUnavailableError("down")

    class Person:
        id = "person-1"

    async def enforce(key: str, rule: str) -> None:
        return None

    monkeypatch.setattr(jobs_module.rate_limit, "enforce", enforce)
    monkeypatch.setattr(jobs_module, "chat_with_usage", down)
    assert await jobs_module._asker(_ready(), Person())("s", "u") is None  # type: ignore[arg-type]

    async def limited(key: str, rule: str) -> None:
        raise RateLimitedError("slow down")

    monkeypatch.setattr(jobs_module.rate_limit, "enforce", limited)
    assert await jobs_module._asker(_ready(), Person())("s", "u") is None  # type: ignore[arg-type]


async def test_the_steps_of_a_review_are_saved_as_they_happen(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    storage = FakeStorage()
    job, _, _ = await _make_job(session, storage, ["Report.docx"])
    job.ai_review = True
    await session.commit()
    _patch_extract(monkeypatch, {"Report.docx": ExtractedDocument(html=CONVERTED)})
    seen: list[dict] = []

    async def reviewer(html, source, source_format, *, ask=None, report=None):
        await report(["Reading the original file again."])
        await report(["Reading the original file again.", "Compared 8 blocks."])
        # What a person polling the job would see now: the review is running, with its log.
        seen.append(dict(job.items[0].review))
        return Review("clean", html, log=["Reading the original file again.", "Done."])

    async def config(_session):
        return AIConfig(False, "", "", "")

    monkeypatch.setattr(jobs_module, "review_import", reviewer)
    monkeypatch.setattr(jobs_module, "load_config", config)

    await run_document_import(session, storage, job.id)
    await session.refresh(job)

    assert seen[0]["status"] == "running"
    assert seen[0]["log"] == ["Reading the original file again.", "Compared 8 blocks."]
    # Then the finished record replaces it, with the whole log, and counts as reviewed.
    assert job.items[0].review["status"] == "clean"
    assert job.items[0].review["log"] == ["Reading the original file again.", "Done."]
    assert job.counters["pages_reviewed"] == 1
