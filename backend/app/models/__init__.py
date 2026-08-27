"""SQLAlchemy models.

Every model must be imported here: Alembic's autogenerate walks
``Base.metadata``, and a model that is never imported is invisible to it.
"""

from __future__ import annotations

from app.models.attachment import PageAttachment
from app.models.audit import AuditAction, AuditLog
from app.models.backup_job import BackupArchive, BackupJob
from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.document_import import DocumentImportItem, DocumentImportJob
from app.models.draft import PageDraft
from app.models.import_job import ImportArchive, ImportJob, ImportLog
from app.models.page import PageLike, WikiPage
from app.models.permission import (
    GlobalPermission,
    Group,
    GroupGlobalPermission,
    GroupMember,
    Permission,
    SpaceGroupPermission,
    SpaceUserPermission,
)
from app.models.restriction import (
    PageGroupRestriction,
    PageRestrictionPermission,
    PageUserRestriction,
)
from app.models.revision import PageRevision
from app.models.site_settings import SINGLETON_ID, SiteSettings
from app.models.space import (
    Space,
    SpaceFavorite,
    SpaceMember,
    SpaceRole,
    SpaceStatus,
    SpaceVisibility,
    SpaceVisit,
)
from app.models.user import User
from app.models.user_session import UserSession

__all__ = [
    "SINGLETON_ID",
    "AuditAction",
    "AuditLog",
    "BackupArchive",
    "BackupJob",
    "Base",
    "DocumentImportItem",
    "DocumentImportJob",
    "GlobalPermission",
    "Group",
    "GroupGlobalPermission",
    "GroupMember",
    "ImportArchive",
    "ImportJob",
    "ImportLog",
    "PageAttachment",
    "PageDraft",
    "PageGroupRestriction",
    "PageLike",
    "PageRestrictionPermission",
    "PageRevision",
    "PageUserRestriction",
    "Permission",
    "SiteSettings",
    "Space",
    "SpaceFavorite",
    "SpaceGroupPermission",
    "SpaceMember",
    "SpaceRole",
    "SpaceStatus",
    "SpaceUserPermission",
    "SpaceVisibility",
    "SpaceVisit",
    "TimestampMixin",
    "UUIDPrimaryKeyMixin",
    "User",
    "UserSession",
    "WikiPage",
]
