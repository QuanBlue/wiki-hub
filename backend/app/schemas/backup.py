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

from app.models.space import SpaceRole, SpaceStatus

#: Only version this build can read.
BACKUP_VERSION: Literal[1] = 1


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


class BackupSpace(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    key: str
    name: str
    description: str = ""
    icon: str = ""
    status: SpaceStatus = SpaceStatus.active
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


class BackupSiteSettings(BaseModel):
    site_name: str | None = None
    max_upload_size_mb: int | None = None
    allowed_attachment_types: list[str] | None = None


class BackupMeta(BaseModel):
    version: Literal[1] = BACKUP_VERSION
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
