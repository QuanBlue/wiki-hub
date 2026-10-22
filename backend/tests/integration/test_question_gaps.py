# ruff: noqa: F811
"""Questions the wiki could not answer: noted from the chat and the search box, grouped, resolved
(telling whoever asked), and forgotten after 90 days."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_question import AiQuestionGap
from app.models.notification import Notification
from app.models.site_settings import SINGLETON_ID, SiteSettings
from app.models.space import SpaceRole, SpaceVisibility
from app.modules.ai import answer as answer_module
from app.modules.ai import question_gaps
from app.modules.ai.answer import AnswerService
from app.modules.ai.client import ChatReply, Usage
from app.modules.ai.question_gaps import QuestionGapService, gap_reason, group_key
from app.modules.spaces.service import SpaceService
from app.schemas.ai import AnswerRequest, AnswerResult, AnswerSource
from app.schemas.page import PageCreate
from app.schemas.space import SpaceCreate
from tests.integration.test_ai_chat import Model, conversation, model, run  # noqa: F401
from tests.integration.test_hybrid_semantic_search import (  # noqa: F401 - fixtures
    _connect,
    _user,
    _wiki,
    installed,
)

pytestmark = pytest.mark.integration


async def _gaps(session: AsyncSession) -> list[AiQuestionGap]:
    return list(
        (await session.execute(select(AiQuestionGap).order_by(AiQuestionGap.created_at)))
        .scalars()
        .all()
    )


async def _setup(session: AsyncSession):
    owner, space, pages = await _wiki(session)
    await _connect(session, "")
    await session.commit()
    return owner, space, pages


async def _page(pages, space, owner, title: str, body: str):
    page = await pages.create(space, PageCreate(title=title, content=f"<p>{body}</p>"), owner)
    await pages.session.commit()
    return page


# -- what counts -------------------------------------------------------------------------


def _source(n: int = 1) -> AnswerSource:
    import uuid

    return AnswerSource(
        n=n, id=uuid.uuid4(), title="T", slug="t", space_key="S", space_name="S", excerpt=""
    )


def test_what_counts_as_unanswered() -> None:
    assert gap_reason(AnswerResult(found=False, reason="no_match")) == "no_match"
    assert gap_reason(AnswerResult(found=False, reason="not_in_pages")) == "not_in_pages"
    assert gap_reason(AnswerResult(found=False, reason="ungrounded")) == "ungrounded"
    assert gap_reason(AnswerResult(found=False, reason="web_failed")) == "web_failed"
    # An unexpected reason is still a question the wiki did not answer.
    assert gap_reason(AnswerResult(found=False, reason="")) == "no_match"
    assert gap_reason(AnswerResult(found=True, answer="x", basis="general")) == "general"
    assert gap_reason(AnswerResult(found=True, answer="x", basis="web")) == "web"
    # The internet and a wiki page together: the wiki did answer.
    assert (
        gap_reason(AnswerResult(found=True, answer="x", basis="web", sources=[_source()])) is None
    )
    for basis in ("wiki", "app", "clarify", "plan"):
        assert gap_reason(AnswerResult(found=True, answer="x", basis=basis)) is None


def test_the_same_question_folds_to_one_key() -> None:
    assert group_key("Nghỉ phép  năm là bao nhiêu ngày?") == group_key(
        "nghi PHEP nam la bao nhieu ngay?"
    )
    assert group_key("How many leave days?") == group_key("how many leave days")
    assert group_key("VPN") != group_key("Wi-Fi")


# -- noted from the chat -----------------------------------------------------------------


async def test_a_chat_question_nothing_matches_is_noted_with_who_asked(
    installed: AsyncSession, model: Model
) -> None:
    owner, _, _ = await _setup(installed)

    events = await run(installed, owner, conversation("qqqqxyzzy wwwwplugh"))

    assert events[-1]["result"]["reason"] == "no_match"
    [gap] = await _gaps(installed)
    assert (gap.question, gap.surface, gap.reason, gap.user_id) == (
        "qqqqxyzzy wwwwplugh",
        "chat",
        "no_match",
        owner.id,
    )
    assert gap.standalone is None and gap.near_page_ids == []


async def test_pages_that_came_close_are_kept_with_a_not_found_reply(
    installed: AsyncSession, model: Model
) -> None:
    owner, space, pages = await _setup(installed)
    billing = await _page(pages, space, owner, "Billing server", "The billing server is 10.0.0.5")
    model.pieces = ["NOT_FOUND - the pages do not say."]

    await run(installed, owner, conversation("address of the billing server"))

    [gap] = await _gaps(installed)
    assert gap.reason == "not_in_pages"
    assert gap.near_page_ids == [billing.id]


async def test_an_answer_citing_a_page_is_not_noted(installed: AsyncSession, model: Model) -> None:
    owner, space, pages = await _setup(installed)
    await _page(pages, space, owner, "Billing server", "The billing server is 10.0.0.5")

    events = await run(installed, owner, conversation("address of the billing server"))

    assert events[-1]["result"]["found"] is True
    assert await _gaps(installed) == []


async def test_an_answer_from_memory_is_noted(installed: AsyncSession, model: Model) -> None:
    owner, space, pages = await _setup(installed)
    await _page(pages, space, owner, "Billing server", "The billing server is 10.0.0.5")
    # The model answers from what it knows, not the pages (only when the web is allowed it
    # says GENERAL:; without it, an uncited answer is "ungrounded").
    model.pieces = ["The billing server is usually on port 443."]

    events = await run(installed, owner, conversation("address of the billing server"))

    assert events[-1]["result"]["found"] is False
    assert [gap.reason for gap in await _gaps(installed)] == ["ungrounded"]


async def test_a_question_about_the_application_is_not_noted(
    installed: AsyncSession, model: Model
) -> None:
    owner, _, _ = await _setup(installed)
    model.pieces = ["APP: Bạn có quyền ", "**admin** trong space này."]

    events = await run(installed, owner, conversation("tôi có quyền truy cập những space nào"))

    assert events[-1]["result"]["basis"] == "app"
    assert await _gaps(installed) == []


async def test_a_follow_up_is_kept_as_it_stands_alone(
    installed: AsyncSession, model: Model
) -> None:
    owner, _, _ = await _setup(installed)
    model.rewrite = "qqqqxyzzy wwwwplugh retention"

    await run(installed, owner, conversation("qqqqxyzzy", "No idea.", "and how long?"))

    [gap] = await _gaps(installed)
    assert gap.question == "and how long?"
    assert gap.standalone == "qqqqxyzzy wwwwplugh retention"
    assert gap.group_key == group_key("qqqqxyzzy wwwwplugh retention")


async def test_a_question_about_one_attached_file_is_not_noted(
    installed: AsyncSession, model: Model
) -> None:
    from app.modules.ai.chat import ChatService

    owner, _, _ = await _setup(installed)
    turn = await ChatService(installed, owner).begin(conversation("qqqqxyzzy wwwwplugh"))
    turn.scoped = True

    [event async for event in turn.events()]

    assert await _gaps(installed) == []


async def test_nothing_is_noted_once_recording_is_turned_off(
    installed: AsyncSession, model: Model
) -> None:
    owner, _, _ = await _setup(installed)
    installed.add(SiteSettings(id=SINGLETON_ID, record_unanswered_questions=False))
    await installed.commit()

    await run(installed, owner, conversation("qqqqxyzzy wwwwplugh"))

    assert await _gaps(installed) == []


# -- noted from the search box -----------------------------------------------------------


async def test_a_search_box_question_nothing_answers_is_noted(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, _, _ = await _setup(installed)

    result = await AnswerService(installed, owner).answer(AnswerRequest(query="qqqqxyzzy plugh"))

    assert result.reason == "no_match"
    [gap] = await _gaps(installed)
    assert (gap.surface, gap.reason) == ("search", "no_match")


async def test_a_search_box_answer_from_the_pages_is_not_noted(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    from tests.integration.test_hybrid_semantic_search import FakeRedis

    owner, space, pages = await _setup(installed)
    await _page(pages, space, owner, "Billing server", "The billing server is 10.0.0.5")

    async def reply(config, messages, *, max_tokens=2000):
        return ChatReply("It is 10.0.0.5 [1].", Usage(10, 5))

    async def free(*_: object, **__: object) -> None:
        return None

    redis = FakeRedis()
    monkeypatch.setattr(answer_module, "chat_with_usage", reply)
    monkeypatch.setattr(answer_module, "record_ai_usage", free)
    monkeypatch.setattr(answer_module, "get_redis", lambda: redis)
    monkeypatch.setattr(answer_module.rate_limit, "enforce", free)

    result = await AnswerService(installed, owner).answer(
        AnswerRequest(query="address of the billing server")
    )

    assert result.found is True
    assert await _gaps(installed) == []


# -- feedback ----------------------------------------------------------------------------


async def test_an_answer_marked_unhelpful_is_noted_with_its_words(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _setup(installed)
    page = await _page(pages, space, owner, "VPN", "vpn1")

    await question_gaps.record_feedback(
        installed,
        owner,
        question="Which VPN server?",
        answer="Use vpn1. " * 400,
        surface="chat",
        page_ids=[page.id],
    )

    [gap] = await _gaps(installed)
    assert gap.reason == "disliked" and gap.near_page_ids == [page.id]
    assert gap.answer_excerpt is not None and len(gap.answer_excerpt) <= 1500


# -- what an administrator sees and does -------------------------------------------------


async def _noted(session, user, question: str, reason: str = "no_match", near=()) -> None:
    await question_gaps.record(
        session,
        user,
        question=question,
        standalone=None,
        surface="chat",
        result=AnswerResult(
            found=False,
            reason=reason,
            related=[
                AnswerSource(
                    n=i + 1,
                    id=page.id,
                    title=page.title,
                    slug=page.slug,
                    space_key="X",
                    space_name="X",
                    excerpt="",
                )
                for i, page in enumerate(near)
            ],
        ),
    )


async def test_the_same_question_asked_by_several_people_is_one_entry(
    installed: AsyncSession,
) -> None:
    owner, _, pages = await _setup(installed)
    admin = await _user(installed, "admin")
    other = await _user(installed, "other")
    private = await SpaceService(installed).create(
        SpaceCreate(key="QHR", name="HR", visibility=SpaceVisibility.restricted), owner
    )
    await installed.commit()
    close = await _page(pages, private, owner, "Leave policy", "Annual leave")
    await _noted(installed, owner, "Nghỉ phép năm bao nhiêu ngày?", near=[close])
    await _noted(installed, other, "nghi phep nam bao nhieu ngay?", "not_in_pages", near=[close])
    await _noted(installed, other, "Nghỉ phép năm bao nhiêu ngày?")
    await _noted(installed, owner, "Where is the Wi-Fi password?")

    groups = await QuestionGapService(installed, admin).groups(resolved=False)

    assert [group.count for group in groups] == [3, 1]
    leave = groups[0]
    assert leave.question == "Nghỉ phép năm bao nhiêu ngày?"
    assert set(leave.variants) == {"Nghỉ phép năm bao nhiêu ngày?", "nghi phep nam bao nhieu ngay?"}
    assert {asker.id for asker in leave.askers} == {owner.id, other.id}
    assert leave.reasons == ["no_match", "not_in_pages"]
    assert leave.first_asked_at <= leave.last_asked_at
    # The admin cannot open the HR space: the close page is not shown to them.
    assert leave.near_pages == []
    assert [
        p.title
        for p in (await QuestionGapService(installed, owner).groups(resolved=False))[0].near_pages
    ] == ["Leave policy"]


async def test_answering_a_question_tells_whoever_asked_and_may_read_the_page(
    installed: AsyncSession,
) -> None:
    owner, _, pages = await _setup(installed)
    reader = await _user(installed, "reader")
    outsider = await _user(installed, "outsider")
    private = await SpaceService(installed).create(
        SpaceCreate(key="QPRIV", name="Private", visibility=SpaceVisibility.restricted), owner
    )
    await SpaceService(installed).set_member(private, owner, reader.id, SpaceRole.viewer)
    await installed.commit()
    answer_page = await _page(pages, private, owner, "Leave days", "25 days")
    await _noted(installed, reader, "How many leave days?")
    await _noted(installed, outsider, "how many leave days")
    await _noted(installed, owner, "How many leave days?")
    [group] = await QuestionGapService(installed, owner).groups(resolved=False)

    closed = await QuestionGapService(installed, owner).resolve(group.key, "answered", answer_page)

    assert closed == 3
    notes = (
        (
            await installed.execute(
                select(Notification).where(Notification.kind == "question_answered")
            )
        )
        .scalars()
        .all()
    )
    # The reader is told; the outsider cannot open the page; the owner did it themselves.
    assert [note.user_id for note in notes] == [reader.id]
    assert notes[0].link == f"/spaces/QPRIV/pages/{answer_page.slug}"
    assert notes[0].params["title"] == "Leave days"
    assert await QuestionGapService(installed, owner).groups(resolved=False) == []
    [done] = await QuestionGapService(installed, owner).groups(resolved=True)
    assert done.resolution == "answered" and done.answer_page.title == "Leave days"

    # Asked again later: a new open entry, the answered one stays answered.
    await _noted(installed, outsider, "How many leave days?")
    assert [g.count for g in await QuestionGapService(installed, owner).groups(resolved=False)] == [
        1
    ]


async def test_dismiss_reopen_and_delete(installed: AsyncSession) -> None:
    owner, _, _ = await _setup(installed)
    await _noted(installed, owner, "What is the lunch menu?")
    service = QuestionGapService(installed, owner)
    [group] = await service.groups(resolved=False)

    assert await service.resolve(group.key, "dismissed", None) == 1
    assert await service.resolve(group.key, "dismissed", None) == 0
    assert (await service.groups(resolved=True))[0].resolution == "dismissed"
    assert await service.open_count() == 0

    assert await service.reopen(group.key) == 1
    assert await service.open_count() == 1

    assert await service.delete(group.key) == 1
    assert await _gaps(installed) == []


async def test_questions_are_forgotten_after_90_days(installed: AsyncSession) -> None:
    owner, _, _ = await _setup(installed)
    await _noted(installed, owner, "Old question")
    await _noted(installed, owner, "New question")
    await installed.execute(
        update(AiQuestionGap)
        .where(AiQuestionGap.question == "Old question")
        .values(created_at=datetime.now(UTC) - timedelta(days=91))
    )
    await installed.commit()

    assert await question_gaps.purge_expired(installed) == 1
    assert [gap.question for gap in await _gaps(installed)] == ["New question"]


async def test_a_deleted_asker_leaves_the_question(installed: AsyncSession) -> None:
    owner, _, _ = await _setup(installed)
    gone = await _user(installed, "gone")
    await installed.commit()
    await _noted(installed, gone, "Who runs payroll?")
    await installed.execute(text("DELETE FROM users WHERE id = :id"), {"id": gone.id})
    await installed.commit()

    [group] = await QuestionGapService(installed, owner).groups(resolved=False)

    assert group.question == "Who runs payroll?" and group.askers == []


async def test_an_empty_question_is_not_kept_and_a_standalone_like_it_is_dropped(
    installed: AsyncSession,
) -> None:
    owner, _, _ = await _setup(installed)
    nothing = AnswerResult(found=False, reason="no_match")

    await question_gaps.record(
        installed, owner, question="   ", standalone=None, surface="chat", result=nothing
    )
    await question_gaps.record(
        installed,
        owner,
        question="Same words",
        standalone="Same words",
        surface="chat",
        result=nothing,
    )

    [gap] = await _gaps(installed)
    assert gap.question == "Same words" and gap.standalone is None


async def test_an_entry_shows_the_five_pages_that_came_closest(installed: AsyncSession) -> None:
    owner, space, pages = await _setup(installed)
    close = [await _page(pages, space, owner, f"Close {i}", "x") for i in range(7)]
    await _noted(installed, owner, "Where is it?", near=close[:5])
    await _noted(installed, owner, "Where is it?", near=close[2:])

    [entry] = await QuestionGapService(installed, owner).groups(resolved=False)

    assert len(entry.near_pages) == 5
    # Named by both askings first.
    assert {p.title for p in entry.near_pages[:3]} == {"Close 2", "Close 3", "Close 4"}


async def test_the_switch_and_the_limits_are_saved_even_before_any_setting_was(
    installed: AsyncSession,
) -> None:
    from app.api.v1.ai import put_ai_limits, put_question_recording, reopen_question
    from app.core.exceptions import NotFoundError
    from app.schemas.ai import AiLimitsUpdate, QuestionRecording

    owner, _, _ = await _setup(installed)
    await installed.execute(text("DELETE FROM site_settings"))
    await installed.commit()

    saved = await put_question_recording(QuestionRecording(enabled=False), installed, owner)
    assert saved.enabled is False
    assert await question_gaps.recording_on(installed) is False

    await installed.execute(text("DELETE FROM site_settings"))
    await installed.commit()
    limits = await put_ai_limits(AiLimitsUpdate(requests_per_hour=7), installed, owner)
    assert limits.requests_per_hour == 7

    with pytest.raises(NotFoundError):
        await reopen_question("c" * 32, installed, owner)


async def test_a_note_that_cannot_be_written_never_fails_the_reply() -> None:
    import types
    import uuid

    # No database behind it at all: the reply still goes out, the failure is only logged.
    nowhere = types.SimpleNamespace(bind=None)
    person = types.SimpleNamespace(id=uuid.uuid4())

    await question_gaps.record(
        nowhere,
        person,
        question="Anything?",
        standalone=None,
        surface="chat",
        result=AnswerResult(found=False, reason="no_match"),
    )
