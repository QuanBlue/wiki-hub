"""Threaded page comments and their likes."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.user import User


class PageComment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One comment on a page; ``parent_id`` makes replies a tree.

    Deleting a comment deletes its whole branch (replies and likes) through the
    foreign-key cascades, and deleting the page takes every comment with it. A
    removed author leaves the comment behind (``author_id`` is nulled).
    """

    __tablename__ = "page_comments"
    __table_args__ = (
        Index("ix_page_comments_page_created", "page_id", "created_at"),
        Index("ix_page_comments_parent_id", "parent_id"),
    )

    page_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("pages.id", ondelete="CASCADE"), nullable=False
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("page_comments.id", ondelete="CASCADE"), nullable=True
    )
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: Usernames of the people ``@mentioned`` in ``body`` who may view the page,
    #: resolved when the comment is written so rendering never has to guess.
    mentions: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )

    author: Mapped[User | None] = relationship(foreign_keys=[author_id], lazy="joined")


class CommentLike(Base):
    __tablename__ = "comment_likes"
    __table_args__ = (Index("ix_comment_likes_comment_id", "comment_id"),)

    comment_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("page_comments.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
