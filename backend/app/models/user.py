"""User accounts.

Local (username + password) authentication is the first provider. The model
deliberately keeps identity-provider fields separate from the password hash so
an OIDC/Keycloak user can exist with no local credential at all.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "users"

    # Uniqueness is declared here, on the table, rather than per column: it must
    # be case-insensitive ("Admin" and "admin" are one account, otherwise login
    # is ambiguous), which a plain column constraint cannot express. Declaring
    # it in the model - not only in a migration - is what keeps Alembic
    # autogenerate from proposing to drop these on the next schema change.
    __table_args__ = (
        Index("uq_users_username_lower", text("lower(username)"), unique=True),
        Index("uq_users_email_lower", text("lower(email)"), unique=True),
        # Partial unique index: at most one protected bootstrap administrator
        # may exist, enforced by the database rather than by convention.
        Index(
            "uq_users_single_protected",
            "is_protected",
            unique=True,
            postgresql_where=text("is_protected"),
        ),
    )

    username: Mapped[str] = mapped_column(String(64), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    # server_default mirrors the migration so a row inserted outside the ORM
    # still gets a value, and so autogenerate does not propose dropping it.
    full_name: Mapped[str] = mapped_column(
        String(255), nullable=False, default="", server_default=""
    )
    #: Optional remote image chosen by the account owner. Avatar binary uploads
    #: will use object storage once the attachments domain lands.
    avatar_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    avatar_object_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    avatar_content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    bio: Mapped[str] = mapped_column(
        Text, nullable=False, default="", server_default=""
    )
    pronouns: Mapped[str] = mapped_column(
        String(64), nullable=False, default="", server_default=""
    )
    profile_url: Mapped[str] = mapped_column(
        String(2048), nullable=False, default="", server_default=""
    )
    social_links: Mapped[list[str]] = mapped_column(
        JSON, nullable=False, default=list, server_default="[]"
    )
    company: Mapped[str] = mapped_column(
        String(255), nullable=False, default="", server_default=""
    )

    #: Argon2id hash. NULL for users that authenticate only through an external
    #: identity provider - those accounts must never fall back to a password.
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    is_superuser: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    #: Marks the built-in bootstrap administrator. A protected account cannot be
    #: renamed, deactivated, deleted, or have its password changed through the
    #: API - it is the guaranteed way back into the instance. Enforced in
    #: :mod:`app.modules.auth.service` and by a partial unique index that keeps
    #: at most one protected account in the table.
    is_protected: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<User {self.username}>"
