"""SQLAlchemy models.

Every model must be imported here: Alembic's autogenerate walks
``Base.metadata``, and a model that is never imported is invisible to it.
"""

from __future__ import annotations

from app.models.audit import AuditAction, AuditLog
from app.models.attachment import PageAttachment
from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.page import PageLike, WikiPage
from app.models.import_job import ImportArchive, ImportJob, ImportLog
from app.models.site_settings import SINGLETON_ID, SiteSettings
from app.models.space import Space, SpaceFavorite, SpaceMember, SpaceRole, SpaceStatus
from app.models.user import User

__all__ = [
    "SINGLETON_ID",
    "AuditAction",
    "AuditLog",
    "Base",
    "SiteSettings",
    "Space",
    "SpaceFavorite",
    "SpaceMember",
    "SpaceRole",
    "SpaceStatus",
    "TimestampMixin",
    "UUIDPrimaryKeyMixin",
    "User",
    "WikiPage",
    "PageLike",
    "PageAttachment",
    "ImportArchive",
    "ImportJob",
    "ImportLog",
]
