"""Questions the wiki could not answer: kept, grouped and resolved for administrators.

The AI assistant notes a question here when the pages did not answer it - nothing matched,
the pages found did not say, the reply cited no page, or it came from the internet or the
model's own knowledge instead - and when the person marked an answer unhelpful. The same
question asked again (folded: case, accents and punctuation aside) is one entry, with a count
and who asked.

Who asked is kept so they can be told once a page answers it. Rows are removed after
``RETENTION_DAYS``; an administrator can turn the recording off in Administration > AI
assistant. Recording never fails a reply: it runs on a session of its own (on the request's
engine, so a reply being streamed is never in its way) and only logs errors.
"""

from __future__ import annotations

import hashlib
import re
import uuid
from collections import Counter
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.logging import get_logger
from app.models.ai_question import RETENTION_DAYS, AiQuestionGap
from app.models.page import WikiPage
from app.models.site_settings import SINGLETON_ID, SiteSettings
from app.models.user import User
from app.modules.notifications.service import notify
from app.modules.permissions.service import PermissionService
from app.modules.search.query import fold
from app.schemas.ai import AnswerResult, QuestionAsker, QuestionGroup, QuestionPage

logger = get_logger(__name__)

#: What a reply's ``reason`` / ``basis`` says about the wiki: these mean it did not answer.
_GAP_REASONS = ("no_match", "not_in_pages", "ungrounded", "web_failed")
_GAP_BASES = ("general", "web")
#: Characters of a question and of an unhelpful answer kept.
QUESTION_CHARS = 2000
ANSWER_CHARS = 1500
#: Close pages kept per question, and shown per entry.
NEAR_KEPT = 5
NEAR_SHOWN = 5
#: Entries listed at most.
GROUP_LIMIT = 300
_WORD = re.compile(r"\w+")


def group_key(question: str) -> str:
    """The same for one question however it is typed: case, accents and punctuation aside."""
    folded = " ".join(_WORD.findall(fold(question)))
    return hashlib.sha256(folded.encode()).hexdigest()[:32]


def gap_reason(result: AnswerResult) -> str | None:
    """Why ``result`` leaves the question unanswered by the wiki, or ``None`` if it does not."""
    if not result.found:
        return result.reason if result.reason in _GAP_REASONS else "no_match"
    if result.basis in _GAP_BASES and not result.sources:
        return result.basis
    return None


async def recording_on(session: AsyncSession) -> bool:
    row = await session.get(SiteSettings, SINGLETON_ID)
    return row is None or row.record_unanswered_questions is not False


async def _add(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    question: str,
    standalone: str | None,
    surface: str,
    reason: str,
    near: list[uuid.UUID],
    answer_excerpt: str | None = None,
) -> None:
    question = question.strip()[:QUESTION_CHARS]
    if not question:
        return
    standalone = (standalone or "").strip()[:QUESTION_CHARS] or None
    if standalone == question:
        standalone = None
    try:
        async with AsyncSession(bind=session.bind, expire_on_commit=False) as own:
            if not await recording_on(own):
                return
            # Never left waiting on a row another transaction holds: the note is not worth it.
            await own.execute(text("SET LOCAL lock_timeout = '3s'"))
            own.add(
                AiQuestionGap(
                    user_id=user_id,
                    question=question,
                    standalone=standalone,
                    group_key=group_key(standalone or question),
                    surface=surface,
                    reason=reason,
                    near_page_ids=list(dict.fromkeys(near))[:NEAR_KEPT],
                    answer_excerpt=answer_excerpt,
                )
            )
            await own.commit()
    except Exception as exc:  # noqa: BLE001 - noting a gap must not fail the reply
        logger.warning("ai_question_gap_failed", error=type(exc).__name__)


async def record(
    session: AsyncSession,
    user: User,
    *,
    question: str,
    standalone: str | None,
    surface: str,
    result: AnswerResult,
) -> None:
    """Note the question if ``result`` shows the wiki did not answer it."""
    reason = gap_reason(result)
    if reason is None:
        return
    near = [source.id for source in (*result.sources, *result.related)]
    await _add(
        session,
        user_id=user.id,
        question=question,
        standalone=standalone,
        surface=surface,
        reason=reason,
        near=near,
    )


async def record_feedback(
    session: AsyncSession,
    user: User,
    *,
    question: str,
    answer: str,
    surface: str,
    page_ids: list[uuid.UUID],
) -> None:
    """Note an answer the person marked unhelpful."""
    await _add(
        session,
        user_id=user.id,
        question=question,
        standalone=None,
        surface=surface,
        reason="disliked",
        near=page_ids,
        answer_excerpt=answer.strip()[:ANSWER_CHARS] or None,
    )


class QuestionGapService:
    """What an administrator sees and does in Unanswered questions."""

    def __init__(self, session: AsyncSession, admin: User) -> None:
        self.session = session
        self.admin = admin
        self.permissions = PermissionService(session)

    async def groups(self, *, resolved: bool) -> list[QuestionGroup]:
        query = (
            select(AiQuestionGap)
            .where(
                AiQuestionGap.resolved_at.is_not(None)
                if resolved
                else AiQuestionGap.resolved_at.is_(None)
            )
            .order_by(AiQuestionGap.created_at.desc())
        )
        rows = (await self.session.execute(query)).scalars().all()
        by_key: dict[str, list[AiQuestionGap]] = {}
        for row in rows:
            by_key.setdefault(row.group_key, []).append(row)

        user_ids = {row.user_id for row in rows if row.user_id is not None}
        users = (
            {
                user.id: user
                for user in (
                    await self.session.execute(select(User).where(User.id.in_(user_ids)))
                ).scalars()
            }
            if user_ids
            else {}
        )
        page_ids = {page_id for row in rows for page_id in row.near_page_ids}
        page_ids.update(row.answer_page_id for row in rows if row.answer_page_id)
        pages = (
            {
                page.id: page
                for page in (
                    await self.session.execute(
                        select(WikiPage)
                        .options(selectinload(WikiPage.space))
                        .where(WikiPage.id.in_(page_ids))
                    )
                ).scalars()
            }
            if page_ids
            else {}
        )

        async def shown(page_id: uuid.UUID | None) -> QuestionPage | None:
            page = pages.get(page_id) if page_id else None
            if page is None or not await self.permissions.can_view_page(page, self.admin):
                return None
            return QuestionPage(
                id=page.id, title=page.title, slug=page.slug, space_key=page.space.key
            )

        out: list[QuestionGroup] = []
        for key, items in by_key.items():
            latest = items[0]
            near_counts: Counter[uuid.UUID] = Counter()
            for item in items:
                near_counts.update(item.near_page_ids)
            near: list[QuestionPage] = []
            for page_id, _ in near_counts.most_common():
                if (page := await shown(page_id)) is not None:
                    near.append(page)
                if len(near) >= NEAR_SHOWN:
                    break
            askers: dict[uuid.UUID, QuestionAsker] = {}
            for item in items:
                user = users.get(item.user_id) if item.user_id else None
                if user is not None and user.id not in askers:
                    askers[user.id] = QuestionAsker(
                        id=user.id,
                        username=user.username,
                        name=user.full_name.strip() or user.username,
                    )
            excerpts = [item.answer_excerpt for item in items if item.answer_excerpt]
            out.append(
                QuestionGroup(
                    key=key,
                    question=latest.question,
                    standalone=latest.standalone,
                    variants=list(dict.fromkeys(item.question for item in items))[:5],
                    count=len(items),
                    askers=list(askers.values()),
                    first_asked_at=items[-1].created_at,
                    last_asked_at=latest.created_at,
                    reasons=sorted({item.reason for item in items}),
                    surfaces=sorted({item.surface for item in items}),
                    near_pages=near,
                    answer_excerpt=excerpts[0] if excerpts else None,
                    resolution=latest.resolution,
                    resolved_at=latest.resolved_at,
                    answer_page=await shown(latest.answer_page_id),
                )
            )
        out.sort(key=lambda group: (-group.count, -group.last_asked_at.timestamp()))
        return out[:GROUP_LIMIT]

    async def resolve(self, key: str, resolution: str, page: WikiPage | None) -> int:
        """Close the open entry ``key``; with ``answered`` and a page, tell whoever asked."""
        rows = (
            (
                await self.session.execute(
                    select(AiQuestionGap).where(
                        AiQuestionGap.group_key == key, AiQuestionGap.resolved_at.is_(None)
                    )
                )
            )
            .scalars()
            .all()
        )
        if not rows:
            return 0
        now = datetime.now(UTC)
        await self.session.execute(
            update(AiQuestionGap)
            .where(AiQuestionGap.group_key == key, AiQuestionGap.resolved_at.is_(None))
            .values(
                resolved_at=now,
                resolved_by_id=self.admin.id,
                resolution=resolution,
                answer_page_id=page.id if page is not None else None,
            )
        )
        if resolution == "answered" and page is not None:
            question = rows[0].question
            link = f"/spaces/{page.space.key}/pages/{page.slug}"
            for user_id in dict.fromkeys(row.user_id for row in rows if row.user_id):
                asker = await self.session.get(User, user_id)
                # Only someone who may read the page is pointed at it.
                if asker is None or not await self.permissions.can_view_page(page, asker):
                    continue
                await notify(
                    self.session,
                    user_id,
                    "question_answered",
                    params={"question": question[:120], "title": page.title},
                    link=link,
                    actor=self.admin,
                )
        await self.session.commit()
        return len(rows)

    async def reopen(self, key: str) -> int:
        result = await self.session.execute(
            update(AiQuestionGap)
            .where(AiQuestionGap.group_key == key, AiQuestionGap.resolved_at.is_not(None))
            .values(resolved_at=None, resolved_by_id=None, resolution=None, answer_page_id=None)
        )
        await self.session.commit()
        return result.rowcount or 0

    async def delete(self, key: str) -> int:
        result = await self.session.execute(
            delete(AiQuestionGap).where(AiQuestionGap.group_key == key)
        )
        await self.session.commit()
        return result.rowcount or 0

    async def open_count(self) -> int:
        return int(
            await self.session.scalar(
                select(func.count(func.distinct(AiQuestionGap.group_key))).where(
                    AiQuestionGap.resolved_at.is_(None)
                )
            )
            or 0
        )


async def purge_expired(session: AsyncSession, *, now: datetime | None = None) -> int:
    """Remove every question older than ``RETENTION_DAYS``."""
    cutoff = (now or datetime.now(UTC)) - timedelta(days=RETENTION_DAYS)
    result = await session.execute(delete(AiQuestionGap).where(AiQuestionGap.created_at < cutoff))
    await session.commit()
    return result.rowcount or 0
