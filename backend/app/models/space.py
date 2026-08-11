"""Spaces: the top-level documentation areas.

A Space owns a tree of pages and carries the permission boundary that Phase 4
builds on. Membership is modelled explicitly (rather than as a column on the
user) so a user can hold a different role in every space, and so page-level
permissions can later hang off the same structure without a migration of the
existing rows.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.user import User


def _enum_column(enum_cls: type[StrEnum], name: str) -> SAEnum:
    """A VARCHAR-backed enum that round-trips to the Python member.

    A plain ``String`` column would load back as ``str``, so ``role is
    SpaceRole.admin`` would silently be False for every row and every
    permission check would fail closed. ``native_enum=False`` keeps this as a
    VARCHAR + CHECK constraint rather than a PostgreSQL ENUM type, which avoids
    the ALTER TYPE dance every time a member is added.
    """
    return SAEnum(
        enum_cls,
        name=name,
        native_enum=False,
        length=16,
        validate_strings=True,
        values_callable=lambda e: [member.value for member in e],
    )


class SpaceStatus(StrEnum):
    active = "active"
    archived = "archived"


class SpaceRole(StrEnum):
    """A member's capability inside one space.

    Ordered from least to most privileged; :func:`rank` makes comparisons
    explicit instead of scattering string checks through the service layer.
    """

    viewer = "viewer"
    editor = "editor"
    admin = "admin"

    @property
    def rank(self) -> int:
        return {"viewer": 0, "editor": 1, "admin": 2}[self.value]


class Space(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "spaces"

    #: Short uppercase handle used in URLs, e.g. "ENG". Unique instance-wide.
    key: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    #: A single emoji. Purely decorative; never rendered as HTML.
    icon: Mapped[str] = mapped_column(String(16), nullable=False, default="")

    status: Mapped[SpaceStatus] = mapped_column(
        _enum_column(SpaceStatus, "space_status"),
        nullable=False,
        default=SpaceStatus.active,
    )

    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        # Keep the space when its author is deleted: documentation outlives the
        # accounts that happened to create it.
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by: Mapped[User | None] = relationship(User, lazy="joined")

    members: Mapped[list[SpaceMember]] = relationship(
        back_populates="space",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Space {self.key}>"


class SpaceMember(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "space_members"
    __table_args__ = (UniqueConstraint("space_id", "user_id", name="uq_space_members_space_user"),)

    space_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("spaces.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[SpaceRole] = mapped_column(
        _enum_column(SpaceRole, "space_role"),
        nullable=False,
        default=SpaceRole.viewer,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    space: Mapped[Space] = relationship(back_populates="members")
    user: Mapped[User] = relationship(lazy="joined")


class SpaceFavorite(Base):
    """A user's starred spaces. Composite primary key - one row per pair."""

    __tablename__ = "space_favorites"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    space_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("spaces.id", ondelete="CASCADE"),
        primary_key=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
