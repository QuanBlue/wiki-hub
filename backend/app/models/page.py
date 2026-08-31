"""Wiki pages that live inside spaces."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.space import Space
from app.models.user import User

# Sentinel stored in `created_by_label`/`updated_by_label` when a Confluence
# import couldn't resolve the original author to a real WikiHub account (the
# source only supplied Confluence's internal actor id). Never surface this
# raw value to end users - API responses must treat it as "unknown", not as
# a literal username.
INVALID_IMPORT_ACTOR_LABEL = "invalid_user"


class WikiPage(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "pages"
    __table_args__ = (
        UniqueConstraint("space_id", "slug", name="uq_pages_space_slug"),
        Index("ix_pages_space_id_title", "space_id", "title"),
    )

    space_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("spaces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("pages.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    content_format: Mapped[str] = mapped_column(
        String(16), nullable=False, default="html", server_default="html"
    )

    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    updated_by_label: Mapped[str | None] = mapped_column(String(255), nullable=True)

    space: Mapped[Space] = relationship()
    parent: Mapped[WikiPage | None] = relationship(
        remote_side="WikiPage.id",
        foreign_keys=[parent_id],
    )
    created_by: Mapped[User | None] = relationship(foreign_keys=[created_by_id], lazy="joined")
    updated_by: Mapped[User | None] = relationship(foreign_keys=[updated_by_id], lazy="joined")


class PageLike(Base):
    __tablename__ = "page_likes"
    __table_args__ = (Index("ix_page_likes_page_id", "page_id"),)

    page_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("pages.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )


class UserPagePin(Base):
    """A private, per-member shortcut to a page."""

    __tablename__ = "user_page_pins"
    __table_args__ = (Index("ix_user_page_pins_user_created", "user_id", "created_at"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    page_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("pages.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
