"""Groups and additive global/space permissions."""

from __future__ import annotations

import uuid
from enum import StrEnum

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Permission(StrEnum):
    view = "view"
    add = "add"
    delete = "delete"
    delete_own = "delete_own"
    restrictions = "restrictions"
    export = "export"
    move = "move"
    admin = "admin"


class GlobalPermission(StrEnum):
    create_space = "create_space"
    manage_users = "manage_users"
    manage_groups = "manage_groups"
    system_admin = "system_admin"


def _enum_column(enum_cls: type[StrEnum], name: str) -> SAEnum:
    return SAEnum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        validate_strings=True,
        values_callable=lambda enum: [member.value for member in enum],
    )


class Group(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "groups"
    __table_args__ = (UniqueConstraint("name", name="uq_groups_name"),)

    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    owner_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(nullable=False, default=True, server_default="true")


class GroupMember(Base):
    __tablename__ = "group_members"
    __table_args__ = (UniqueConstraint("group_id", "user_id", name="uq_group_members_group_user"),)

    group_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )


class GroupOwner(Base):
    __tablename__ = "group_owners"
    __table_args__ = (UniqueConstraint("group_id", "user_id", name="uq_group_owners_group_user"),)

    group_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )


class GroupGlobalPermission(Base):
    __tablename__ = "group_global_permissions"

    group_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True
    )
    permission: Mapped[GlobalPermission] = mapped_column(
        _enum_column(GlobalPermission, "global_permission"), primary_key=True
    )


class SpaceUserPermission(Base):
    __tablename__ = "space_user_permissions"

    space_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("spaces.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    permission: Mapped[Permission] = mapped_column(
        _enum_column(Permission, "space_permission"), primary_key=True
    )


class SpaceGroupPermission(Base):
    __tablename__ = "space_group_permissions"

    space_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("spaces.id", ondelete="CASCADE"), primary_key=True
    )
    group_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True
    )
    permission: Mapped[Permission] = mapped_column(
        _enum_column(Permission, "space_group_permission"), primary_key=True
    )
