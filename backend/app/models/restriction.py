"""Page-level view/edit restrictions."""

from __future__ import annotations

import uuid
from enum import StrEnum

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class PageRestrictionPermission(StrEnum):
    view = "view"
    edit = "edit"


def _restriction_enum() -> SAEnum:
    return SAEnum(
        PageRestrictionPermission,
        name="page_restriction_permission",
        native_enum=False,
        validate_strings=True,
        values_callable=lambda enum: [member.value for member in enum],
    )


class PageUserRestriction(Base):
    __tablename__ = "page_user_restrictions"

    page_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("pages.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    permission: Mapped[PageRestrictionPermission] = mapped_column(
        _restriction_enum(), primary_key=True
    )


class PageGroupRestriction(Base):
    __tablename__ = "page_group_restrictions"

    page_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("pages.id", ondelete="CASCADE"), primary_key=True
    )
    group_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True
    )
    permission: Mapped[PageRestrictionPermission] = mapped_column(
        _restriction_enum(), primary_key=True
    )
