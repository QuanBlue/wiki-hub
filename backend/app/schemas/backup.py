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
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

from app.models.permission import GlobalPermission, Permission
from app.models.restriction import PageRestrictionPermission
from app.models.space import SpaceRole, SpaceStatus, SpaceVisibility

#: Only version this build can read.
# Version 3 adds private knowledge state (pins, drafts and labels/tags).
# Versions 1 and 2 remain accepted for restores.
BACKUP_VERSION: Literal[3] = 3
SUPPORTED_BACKUP_VERSIONS = frozenset({1, 2, 3})


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


class BackupArchiveSpaceRead(BaseModel):
    """One entry in the `/backup/inspect-zip` response - deliberately just
    enough to render a "select spaces to restore" picker, not a full
    `BackupSpace`."""

    key: str
    name: str
    page_count: int = 0
    #: True when a space with this key already exists here. Mirrors
    #: `ConfluenceSpaceCandidate.conflict` so both pickers can warn before the
    #: restore rather than reporting the skip afterwards.
    conflict: bool = False


class BackupSpaceMember(BaseModel):
    space_key: str
    username: str
    role: SpaceRole = SpaceRole.viewer


class BackupSpaceOwner(BaseModel):
    """One row of `SpaceOwner` - see that model's docstring. Optional (an
    archive from before this feature existed just parses with none), so a
    restored space with no matching rows here falls back to the same
    system-administrator default the live app already uses for a space that
    has never had one."""

    space_key: str
    username: str


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
    #: Additive - archives exported before this field existed still parse and
    #: just fall back to restore-time timestamps, same as `BackupSpace`.
    created_at: datetime | None = None
    updated_at: datetime | None = None


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
    # Defaulted (not required) so archives exported before this field existed
    # still parse - they just fall back to the old behaviour of minting a
    # fresh id, which orphans any `/api/v1/attachments/<id>` link already
    # baked into that page's stored content. Archives exported going forward
    # carry the real id, so restore can preserve it and keep those links
    # working.
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
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


class BackupPagePin(BaseModel):
    page_space_key: str
    page_slug: str
    username: str


class BackupPageDraft(BaseModel):
    page_space_key: str
    page_slug: str
    username: str
    content: str = ""
    content_format: str = "html"
    edit_mode: str = "normal"
    base_updated_at: datetime


class BackupUserTag(BaseModel):
    username: str
    name: str


class BackupUserPageLabel(BaseModel):
    page_space_key: str
    page_slug: str
    username: str
    name: str


class BackupSiteSettings(BaseModel):
    site_name: str | None = None
    max_upload_size_mb: int | None = None
    allowed_attachment_types: list[str] | None = None
    sidebar_permissions: dict[str, list[str]] | None = None


class BackupMeta(BaseModel):
    version: Literal[1, 2, 3] = BACKUP_VERSION
    exported_at: datetime
    app_version: str
    site_name: str
    includes_credentials: bool
    #: Space keys this export was scoped to; empty means every space. Additive
    #: field with a default, so older archives without it still restore fine.
    space_keys: list[str] = Field(default_factory=list)
    counts: dict[str, int] = Field(default_factory=dict)


class BackupDocument(BaseModel):
    wikihub_backup: BackupMeta
    users: list[BackupUser] = Field(default_factory=list)
    spaces: list[BackupSpace] = Field(default_factory=list)
    space_members: list[BackupSpaceMember] = Field(default_factory=list)
    space_owners: list[BackupSpaceOwner] = Field(default_factory=list)
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
    page_pins: list[BackupPagePin] = Field(default_factory=list)
    page_drafts: list[BackupPageDraft] = Field(default_factory=list)
    user_tags: list[BackupUserTag] = Field(default_factory=list)
    user_page_labels: list[BackupUserPageLabel] = Field(default_factory=list)
    attachments: list[BackupAttachment] = Field(default_factory=list)
    avatars: list[BackupAvatar] = Field(default_factory=list)
    site_settings: BackupSiteSettings | None = None




class ImportEntry(BaseModel):
    """One decision the importer made, for the report."""

    kind: str  # user | space | space_member | space_owner | space_favorite | site_settings
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
    #: Space keys skipped because a space with that key already exists.
    #: Unlike `entries`, never truncated - the caller needs the exact set to
    #: offer a follow-up "replace these spaces" restore with
    #: `overwrite_space_keys`.
    conflicting_space_keys: list[str] = Field(default_factory=list)


class BackupExportCreate(BaseModel):
    """Request one of the two explicitly separated export artifacts."""

    kind: Literal["full_export", "confluence_export"]
    include_credentials: bool = False
    confluence_profile: Literal["dc-8", "dc-9"] | None = None
    space_keys: list[str] = Field(default_factory=list, max_length=5000)


def _normalize_time_of_day(value: object) -> object:
    """Recover a 12-hour time some browsers hand back instead of "HH:MM".

    A native ``<input type="time">`` is specified to always report strict
    24-hour "HH:MM", but some browsers (Safari has shipped versions of this
    bug) hand back a localised 12-hour string like "3:00 PM" instead. Only
    formats carrying an explicit AM/PM designator are recognised here -
    anything else (including a merely malformed 24-hour string, e.g. a
    missing leading zero) is passed through unchanged for the strict pattern
    below to reject, so this cannot loosen that check.
    """
    if not isinstance(value, str):
        return value
    text = value.strip()
    for fmt in ("%I:%M %p", "%I:%M%p", "%I:%M:%S %p"):
        try:
            return datetime.strptime(text, fmt).strftime("%H:%M")
        except ValueError:
            continue
    return text  # let the pattern constraint below reject it with a clear message


class AutomatedBackupSettingsUpdate(BaseModel):
    enabled: bool
    interval_unit: Literal["hours", "days"] = "days"
    interval_value: int = Field(default=1, ge=1, le=720)
    time_of_day: Annotated[str, BeforeValidator(_normalize_time_of_day)] = Field(
        default="02:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$"
    )
    timezone: str = Field(default="UTC", min_length=1, max_length=64)
    retention_count: int = Field(default=30, ge=1, le=1000)
    #: A path relative to the mounted backup root, e.g. "team-a" for
    #: `<root>/team-a`. `None`/empty writes straight into the root. Validated
    #: server-side against the actual filesystem before it is ever saved -
    #: see `automated.validate_subdirectory`.
    subdirectory: str | None = Field(default=None, max_length=255)


class AutomatedBackupSettingsRead(AutomatedBackupSettingsUpdate):
    directory_configured: bool
    #: The root backup volume as mounted into the container - fixed at
    #: deploy time, shown for context, never itself editable here.
    base_directory: str | None = None
    #: `base_directory` narrowed by `subdirectory`, i.e. where a backup
    #: actually lands right now. `None` whenever `directory_configured` is
    #: false - nothing valid to show.
    directory: str | None = None
    last_run_at: datetime | None = None
    next_run_at: datetime | None = None
    last_status: str | None = None
    last_error: str | None = None


class BackupJobLogRead(BaseModel):
    """One narration line from a backup job.

    Same fields as `ImportLogRead` on purpose: the admin panel renders both
    job kinds in the same list, and a difference here would show up as two
    inconsistent accounts of the same kind of work.
    """

    id: uuid.UUID
    created_at: datetime
    level: str
    phase: str
    entity_type: str | None
    entity_label: str | None
    message: str


class BackupJobLogPage(BaseModel):
    items: list[BackupJobLogRead]
    next_offset: int | None


class BackupJobRead(BaseModel):
    id: uuid.UUID
    kind: str
    status: str
    phase: str
    #: Warning / error lines this job logged - see `ImportJobRead`.
    warning_count: int = 0
    error_count: int = 0
    counters: dict[str, int] = Field(default_factory=dict)
    cancel_requested: bool = False
    include_credentials: bool = False
    confluence_profile: str | None = None
    space_keys: list[str] = Field(default_factory=list)
    #: Restore jobs only (`kind="full_import"`): the `BackupArchive` this job
    #: applies, and the conflicting spaces it is allowed to replace.
    archive_id: uuid.UUID | None = None
    overwrite_space_keys: list[str] = Field(default_factory=list)
    output_filename: str | None = None
    download_url: str | None = None
    error: str | None = None
    #: Set once a restore (`kind="full_import"`) job reaches "complete" - the
    #: `ImportReport` the old synchronous `/backup/import-zip` endpoint used
    #: to return directly in its HTTP response. `None` for export jobs and
    #: for a restore job that has not finished yet.
    result: ImportReport | None = None
    #: Set once the worker actually starts the export (not while still
    #: queued). Used together with `counters` to derive `percent`/`eta_seconds`.
    started_at: datetime | None = None
    #: Last time the worker proved it was still on this job. A running job
    #: whose heartbeat has gone stale has been abandoned and gets reaped.
    heartbeat_at: datetime | None = None
    #: 0-99 while running with known totals, 100 once complete, otherwise
    #: `None` (queued, or running without enough data yet) - the frontend
    #: falls back to an indeterminate spinner in that case.
    percent: int | None = None
    eta_seconds: int | None = None
    #: True for a scheduled/automated run - lets the admin panel keep an
    #: automated export's progress inside the "Automatic backups" card (its
    #: own history table) rather than surfacing it in the manual Export &
    #: Backup Workspace Data card too, which otherwise reattaches to *any*
    #: in-flight job on reload regardless of who queued it.
    automated: bool = False
    created_at: datetime
    updated_at: datetime


class AutomatedBackupJobPage(BaseModel):
    """A page of the automated-backup history table.

    Carries `total` (not just a `next_offset` cursor, unlike
    `BackupJobLogPage`) so the admin panel can render "Page X of Y" and a
    Previous/Next pager rather than just an open-ended "load more" - the
    history list is short and bounded by retention, so counting it exactly is
    cheap.
    """

    items: list[BackupJobRead]
    total: int


class AutomatedBackupBulkDelete(BaseModel):
    """Request to delete several automated-backup jobs (and their files) at
    once - the history table's bulk "tick rows, then Delete" action."""

    job_ids: list[uuid.UUID] = Field(min_length=1, max_length=200)


class BackupArchiveUploadInit(BaseModel):
    """Request a direct-to-storage upload slot for a full WikiHub backup ZIP.

    Mirrors `app.schemas.confluence_import.UploadInit` - the chunked-upload
    machinery that lets a large Confluence archive bypass Starlette's
    unbounded multipart-file-part spool, reused here for the same reason.
    """

    filename: str = Field(min_length=1, max_length=255)
    size_bytes: int = Field(gt=0)
    sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")


class BackupArchiveUploadTarget(BaseModel):
    archive_id: uuid.UUID
    object_key: str
    max_size_bytes: int
    part_size_bytes: int
    uploaded_parts: list[int] = Field(default_factory=list)
    status: str = "uploading"
    sha256: str | None = None
    reused: bool = False


class BackupArchiveUploadPartUrlsRequest(BaseModel):
    part_numbers: list[int] = Field(min_length=1, max_length=32)


class BackupArchiveUploadPartUrlsRead(BaseModel):
    urls: dict[int, str]


class BackupArchiveUploadProgressRead(BaseModel):
    archive_id: uuid.UUID
    filename: str
    size_bytes: int
    sha256: str | None = None
    status: str
    part_size_bytes: int
    uploaded_parts: list[int] = Field(default_factory=list)


class BackupArchiveRead(BaseModel):
    id: uuid.UUID
    filename: str
    size_bytes: int
    sha256: str | None = None
    status: str
    error: str | None = None
    spaces: list[BackupArchiveSpaceRead] = Field(default_factory=list)


class BackupImportCreate(BaseModel):
    """Request a restore job against an already-uploaded, scanned archive."""

    overwrite_space_keys: list[str] = Field(default_factory=list, max_length=5000)
    space_keys: list[str] = Field(default_factory=list, max_length=5000)
