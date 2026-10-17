"""The translation step of the document-import worker, against a real PostgreSQL database.

What is under test is the bookkeeping around the translation - that it runs only when asked and
after the review, that the translated page is a revision of its own with the page as it was kept
in the history, that what it did is recorded on the item (live, while it runs) and counted on the
job, and that nothing it does can cost the import. The translating itself is covered by
``tests/unit/test_document_translate.py``.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.revision import PageRevision
from app.modules.ai.client import ChatReply, Usage
from app.modules.ai.config import AIConfig
from app.modules.document_import import jobs as jobs_module
from app.modules.document_import.convert import ExtractedDocument
from app.modules.document_import.jobs import run_document_import
from app.modules.document_import.review import Review
from app.modules.document_import.translate import Translation
from tests.integration.test_document_import_worker import (
    FakeStorage,
    _imported_pages,
    _make_job,
    _patch_extract,
)

pytestmark = pytest.mark.integration

CONVERTED = "<p>Báo cáo quý ba của công ty.</p>"
TRANSLATED = "<p>Third quarter report of the company.</p>"


def _ready() -> AIConfig:
    return AIConfig(True, "http://gateway.invalid/v1", "key", "model")


async def _run(session, monkeypatch, *, translate: str | None, translator, review=False, ai=True):
    storage = FakeStorage()
    job, space, user = await _make_job(session, storage, ["Report.docx"])
    job.translate_to = translate
    job.ai_review = review
    await session.commit()
    _patch_extract(monkeypatch, {"Report.docx": ExtractedDocument(html=CONVERTED)})
    monkeypatch.setattr(jobs_module, "translate_import", translator)

    async def config(_session):
        return _ready() if ai else AIConfig(False, "", "", "")

    monkeypatch.setattr(jobs_module, "load_config", config)
    await run_document_import(session, storage, job.id)
    await session.refresh(job)
    return job, space, user


class Translator:
    """Stands in for ``translate_import``: records what it was given, returns ``outcome``."""

    def __init__(self, outcome: Translation | Exception) -> None:
        self.outcome = outcome
        self.calls: list[dict] = []

    async def __call__(self, html, target, *, ask, report=None, deadline=None):
        self.calls.append({"html": html, "target": target, "ask": ask, "deadline": deadline})
        if report is not None:
            await report(Translation("running", target, log=["Reading the page."]))
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


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


async def test_a_page_is_not_translated_unless_the_person_asked(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    translator = Translator(Translation("done", "en", TRANSLATED))

    job, space, _ = await _run(session, monkeypatch, translate=None, translator=translator)

    assert translator.calls == []
    [page] = await _imported_pages(session, space)
    assert page.content == CONVERTED and job.items[0].translation is None
    assert job.counters["pages_translated"] == 0


async def test_a_translated_page_is_a_revision_of_its_own_and_recorded(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    outcome = Translation(
        "done", "en", TRANSLATED, units_total=1, units_done=1, ai_calls=2, log=["Done."]
    )
    translator = Translator(outcome)

    job, space, _ = await _run(session, monkeypatch, translate="en", translator=translator)

    [page] = await _imported_pages(session, space)
    assert page.content == TRANSLATED
    [call] = translator.calls
    assert call["html"] == CONVERTED and call["target"] == "en"
    assert call["ask"] is not None and call["deadline"] is not None
    revisions = await _revisions(session, page)
    assert [r.content for r in revisions] == [CONVERTED, TRANSLATED]
    assert revisions[1].change_summary == "Translated into English by AI from Report.docx"
    record = job.items[0].translation
    assert record["status"] == "done" and record["units_done"] == 1 and record["ai_calls"] == 2
    assert record["log"] == ["Done."]
    assert job.counters["pages_translated"] == 1
    assert job.items[0].status == "complete" and job.status == "complete"


async def test_the_translation_comes_after_the_review(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    mended = "<h1>Báo cáo quý ba của công ty.</h1>"
    seen: list[str] = []

    async def reviewer(html, source, source_format, *, ask=None, report=None):
        return Review("fixed", mended, fixes=1)

    monkeypatch.setattr(jobs_module, "review_import", reviewer)
    translator = Translator(Translation("done", "vi", "<h1>x</h1>"))

    async def spy(html, target, **kwargs):
        seen.append(html)
        return await translator(html, target, **kwargs)

    job, space, _ = await _run(
        session, monkeypatch, translate="vi", translator=spy, review=True
    )

    # It translated the page the review had mended, not the page as converted.
    assert seen == [mended]
    [page] = await _imported_pages(session, space)
    assert [r.content for r in await _revisions(session, page)] == [CONVERTED, mended, "<h1>x</h1>"]
    assert job.items[0].review["status"] == "fixed" and job.items[0].translation["status"] == "done"


async def test_a_partly_translated_page_is_kept_and_says_what_is_left(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    outcome = Translation(
        "partial", "en", TRANSLATED, units_total=4, units_done=3, units_left=1,
        notes=["1 of 4 pieces were left in the original language"],
    )  # fmt: skip

    job, space, _ = await _run(
        session, monkeypatch, translate="en", translator=Translator(outcome)
    )

    [page] = await _imported_pages(session, space)
    assert page.content == TRANSLATED
    assert job.items[0].translation["status"] == "partial"
    assert job.counters["pages_translated"] == 1


@pytest.mark.parametrize("status", ["skipped", "failed"])
async def test_a_page_that_was_not_translated_stays_as_it_was_with_no_new_revision(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch, status: str
) -> None:
    outcome = Translation(status, "en", "<p>should not be used</p>", notes=["why not"])

    job, space, _ = await _run(
        session, monkeypatch, translate="en", translator=Translator(outcome)
    )

    [page] = await _imported_pages(session, space)
    assert page.content == CONVERTED and len(await _revisions(session, page)) == 1
    assert job.items[0].translation["status"] == status
    assert job.counters["pages_translated"] == 0


async def test_without_the_ai_assistant_the_translator_is_told_so(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    translator = Translator(Translation("skipped", "en", notes=["not set up"]))

    await _run(session, monkeypatch, translate="en", translator=translator, ai=False)

    assert translator.calls[0]["ask"] is None


async def test_a_translation_that_blows_up_costs_nothing_of_the_import(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    job, space, _ = await _run(
        session, monkeypatch, translate="vi", translator=Translator(RuntimeError("boom"))
    )

    [page] = await _imported_pages(session, space)
    assert page.content == CONVERTED
    assert job.items[0].status == "complete" and job.status == "complete"
    record = job.items[0].translation
    assert record["status"] == "failed" and record["language"] == "vi"
    assert record["log"][0] == "Reading the page." and "could not finish" in record["log"][-1]


async def test_the_translation_has_its_own_allowance_and_room_for_long_replies(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    asked: list[dict] = []
    usage: list[dict] = []
    hits: list[tuple[str, str]] = []

    async def chat(config, messages, *, max_tokens: int = 2000, temperature: float = 0.2):
        asked.append({"max_tokens": max_tokens, "temperature": temperature})
        return ChatReply("[]", Usage(30, 4))

    async def record(**kwargs) -> None:
        usage.append(kwargs)

    async def enforce(key: str, rule: str) -> None:
        hits.append((key, rule))

    monkeypatch.setattr(jobs_module, "chat_with_usage", chat)
    monkeypatch.setattr(jobs_module, "record_ai_usage", record)
    monkeypatch.setattr(jobs_module.rate_limit, "enforce", enforce)

    class Person:
        id = "person-1"

    ask = jobs_module._asker(
        _ready(),
        Person(),  # type: ignore[arg-type]
        feature="import_translate",
        allowance="aitranslate",
        limit="1500/hour",
        max_tokens=6000,
    )
    await ask("rules", "units")

    assert asked[0] == {"max_tokens": 6000, "temperature": 0.0}
    assert usage[0]["feature"] == "import_translate"
    # Not the review's allowance, and not the chat's: translating is many small calls.
    assert hits == [("aitranslate:person-1", "1500/hour")]


async def test_steps_reported_at_the_same_moment_are_saved_one_at_a_time(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    import asyncio

    async def concurrent(html, target, *, ask, report=None, deadline=None):
        # Three calls to the model finishing together, each reporting: one session cannot
        # commit three times at once.
        await asyncio.gather(
            *(
                report(Translation("running", target, log=[f"Step {n} of 3."]))
                for n in range(1, 4)
            )
        )
        return Translation("done", target, TRANSLATED, units_total=3, units_done=3)

    job, space, _ = await _run(session, monkeypatch, translate="en", translator=concurrent)

    assert job.items[0].translation["status"] == "done"
    [page] = await _imported_pages(session, space)
    assert page.content == TRANSLATED
