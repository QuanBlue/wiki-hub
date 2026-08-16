"""Instance backup document and import report.

The document is versioned from day one (``version: 1``). Retrofitting a version
field onto files already in the wild is impossible, and it is what will let the
format move to NDJSON once page content makes a single JSON object impractical.

Join rows reference **natural keys** (``username``, ``space_key``) rather than
UUIDs. That keeps the file readable and auditable, and it removes the need for
an identity-remapping table during import when a UUID happens to be taken.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.permission import GlobalPermission, Permission
from app.models.restriction import PageRestrictionPermission
from app.models.space import SpaceRole, SpaceStatus, SpaceVisibility

#: Only version this build can read.
# Version 2 adds the knowledge and access-control data that make a workspace
# backup useful in practice.  Version 1 remains accepted for restores.
BACKUP_VERSION: Literal[2] = 2
SUPPORTED_BACKUP_VERSIONS = frozenset({1, 2})


class BackupUser(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    email: str
    full_name: str = ""
    is_active: bool = True
    is_superuser: bool = False
    #: Present in exports for completeness, but the importer NEVER honours it -
    #: see BackupService. A backup can therefore not smuggle in a second
    #: protected account.
    is_protected: bool = False
    last_login_at: datetime | None = None
    created_at: datetime | None = None
    #: Argon2 hash. Only populated when the export explicitly opted in.
    password_hash: str | None = None
    bio: str = ""
    pronouns: str = ""
    profile_url: str = ""
    social_links: list[str] = Field(default_factory=list)
    company: str = ""
    # Object-storage avatar bytes are deliberately not represented as a URL:
    # an internal avatar URL points at the source instance and would be broken
    # after restore. External URLs remain safe to preserve.
    avatar_url: str | None = None


class BackupSpace(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    key: str
    name: str
    description: str = ""
    icon: str = ""
    status: SpaceStatus = SpaceStatus.active
    visibility: SpaceVisibility = SpaceVisibility.open
    created_at: datetime | None = None
    updated_at: datetime | None = None
    created_by_username: str | None = None


class BackupSpaceMember(BaseModel):
    space_key: str
    username: str
    role: SpaceRole = SpaceRole.viewer


class BackupSpaceFavorite(BaseModel):
    username: str
    space_key: str


class BackupGroup(BaseModel):
    id: uuid.UUID
    name: str
    description: str = ""
    owner_username: str
    is_active: bool = True


class BackupGroupMember(BaseModel):
    group_name: str
    username: str


class BackupGroupGlobalPermission(BaseModel):
    group_name: str
    permission: GlobalPermission


class BackupSpaceUserPermission(BaseModel):
    space_key: str
    username: str
    permission: Permission


class BackupSpaceGroupPermission(BaseModel):
    space_key: str
    group_name: str
    permission: Permission


class BackupPage(BaseModel):
    id: uuid.UUID
    space_key: str
    slug: str
    title: str
    content: str = ""
    content_format: str = "html"
    parent_slug: str | None = None
    created_by_username: str | None = None
    updated_by_username: str | None = None
    created_by_label: str | None = None
    updated_by_label: str | None = None


class BackupPageRevision(BaseModel):
    page_space_key: str
    page_slug: str
    version: int
    title: str
    content: str = ""
    content_format: str = "html"
    created_by_username: str | None = None
    change_summary: str | None = None


class BackupPageLike(BaseModel):
    page_space_key: str
    page_slug: str
    username: str


class BackupPageUserRestriction(BaseModel):
    page_space_key: str
    page_slug: str
    username: str
    permission: PageRestrictionPermission


class BackupPageGroupRestriction(BaseModel):
    page_space_key: str
    page_slug: str
    group_name: str
    permission: PageRestrictionPermission


class BackupAttachment(BaseModel):
    page_space_key: str
    page_slug: str
    filename: str
    content_type: str
    object_path: str
    sha256: str
    size_bytes: int


class BackupAvatar(BaseModel):
    username: str
    content_type: str
    object_path: str
    sha256: str
    size_bytes: int


class BackupSiteSettings(BaseModel):
    site_name: str | None = None
    max_upload_size_mb: int | None = None
    allowed_attachment_types: list[str] | None = None
    sidebar_permissions: dict[str, list[str]] | None = None


class BackupMeta(BaseModel):
    version: Literal[1, 2] = BACKUP_VERSION
    exported_at: datetime
    app_version: str
    site_name: str
    includes_credentials: bool
    counts: dict[str, int] = Field(default_factory=dict)


class BackupDocument(BaseModel):
    wikihub_backup: BackupMeta
    users: list[BackupUser] = Field(default_factory=list)
    spaces: list[BackupSpace] = Field(default_factory=list)
    space_members: list[BackupSpaceMember] = Field(default_factory=list)
    space_favorites: list[BackupSpaceFavorite] = Field(default_factory=list)
    groups: list[BackupGroup] = Field(default_factory=list)
    group_members: list[BackupGroupMember] = Field(default_factory=list)
    group_global_permissions: list[BackupGroupGlobalPermission] = Field(default_factory=list)
    space_user_permissions: list[BackupSpaceUserPermission] = Field(default_factory=list)
    space_group_permissions: list[BackupSpaceGroupPermission] = Field(default_factory=list)
    pages: list[BackupPage] = Field(default_factory=list)
    page_revisions: list[BackupPageRevision] = Field(default_factory=list)
    page_likes: list[BackupPageLike] = Field(default_factory=list)
    page_user_restrictions: list[BackupPageUserRestriction] = Field(default_factory=list)
    page_group_restrictions: list[BackupPageGroupRestriction] = Field(default_factory=list)
    attachments: list[BackupAttachment] = Field(default_factory=list)
    avatars: list[BackupAvatar] = Field(default_factory=list)
    site_settings: BackupSiteSettings | None = None


class ImportEntry(BaseModel):
    """One decision the importer made, for the report."""

    kind: str  # user | space | space_member | space_favorite | site_settings
    label: str
    outcome: Literal["created", "skipped", "error"]
    reason: str = ""


#: Cap on how many per-item entries a report carries. A 10k-row import must not
#: return a multi-megabyte JSON blob; the counts stay exact regardless.
MAX_REPORT_ENTRIES = 500


class ImportReport(BaseModel):
    dry_run: bool
    version: int
    includes_credentials: bool
    created: dict[str, int] = Field(default_factory=dict)
    skipped: dict[str, int] = Field(default_factory=dict)
    errors: dict[str, int] = Field(default_factory=dict)
    #: Restored accounts with no password hash. They cannot sign in until an
    #: administrator sets a password, so the UI must surface this prominently.
    users_without_password: list[str] = Field(default_factory=list)
    entries: list[ImportEntry] = Field(default_factory=list)
    entries_truncated: bool = False


class BackupExportCreate(BaseModel):
    """Request one of the two explicitly separated export artifacts."""

    kind: Literal["full_export", "confluence_export"]
    include_credentials: bool = False
    confluence_profile: Literal["dc-8", "dc-9"] | None = None
    space_keys: list[str] = Field(default_factory=list, max_length=5000)


class BackupJobRead(BaseModel):
    id: uuid.UUID
    kind: str
    status: str
    phase: str
    counters: dict[str, int] = Field(default_factory=dict)
    include_credentials: bool = False
    confluence_profile: str | None = None
    output_filename: str | None = None
    download_url: str | None = None
    error: str | None = None
    created_at: datetime
    updated_at: datetime
