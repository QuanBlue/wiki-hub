"""Questions the wiki could not answer, kept so an administrator can see what is missing.

A row is written when the AI assistant (the chat or the search box) found nothing in the
pages to answer with, answered from outside the wiki (the internet, its own knowledge),
or when the person marked the answer as unhelpful. Rows with the same question folded the
same way (``group_key``) are one entry in Administration > AI assistant > Unanswered
questions.

Who asked is kept, so the askers can be told once a page answers it; every row is removed
after ``RETENTION_DAYS`` (see ``modules.ai.question_gaps``). Not part of backups: it is
telemetry, not wiki content.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPrimaryKeyMixin

#: Days a question is kept, answered or not.
RETENTION_DAYS = 90

#: Why a question counts as unanswered. ``no_match`` / ``not_in_pages`` / ``ungrounded`` /
#: ``web_failed`` mirror ``AnswerResult.reason``; ``general`` and ``web`` were answered from
#: the model's own knowledge or the internet; ``disliked`` was marked unhelpful.
REASONS = (
    "no_match",
    "not_in_pages",
    "ungrounded",
    "web_failed",
    "general",
    "web",
    "disliked",
)


class AiQuestionGap(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "ai_question_gaps"
    __table_args__ = (
        Index("ix_ai_question_gaps_group_key", "group_key", "resolved_at"),
        Index("ix_ai_question_gaps_created_at", "created_at"),
    )

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    #: The question as the person typed it.
    question: Mapped[str] = mapped_column(Text, nullable=False)
    #: A follow-up rewritten to stand alone ("and how long?" -> "how long is annual leave?").
    standalone: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: A hash of the question folded (lower case, no accents, spaces collapsed): the entry.
    group_key: Mapped[str] = mapped_column(String(32), nullable=False)
    #: ``chat`` or ``search``.
    surface: Mapped[str] = mapped_column(String(8), nullable=False)
    reason: Mapped[str] = mapped_column(String(16), nullable=False)
    #: Pages the search found that came close, best first.
    near_page_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(PgUUID(as_uuid=True)), nullable=False, default=list, server_default="{}"
    )
    #: The start of the answer that was marked unhelpful.
    answer_excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    #: ``answered`` (a page answers it now) or ``dismissed``.
    resolution: Mapped[str | None] = mapped_column(String(16), nullable=True)
    answer_page_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("pages.id", ondelete="SET NULL"), nullable=True
    )
