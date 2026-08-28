/** Shapes mirrored from the backend Pydantic schemas. */

export interface InstanceFeatures {
  local_auth: boolean;
  oidc_auth: boolean;
  attachments: boolean;
  comments: boolean;
  search: boolean;
  imports: string[];
  exports: string[];
}

export interface SearchResultPage {
  id: string;
  title: string;
  slug: string;
  space_key: string;
  space_name: string;
  snippet: string;
  updated_at: string | null;
}

export interface SearchResultSpace {
  id: string;
  key: string;
  name: string;
  description: string;
}

export interface SearchResults {
  query: string;
  pages: SearchResultPage[];
  spaces: SearchResultSpace[];
}

export interface RecentPageItem {
  id: string;
  title: string;
  slug: string;
  space_key: string;
  space_name: string;
  created_at: string;
  updated_at: string;
  user_username: string;
  user_full_name: string;
}

export interface PageRevisionItem {
  id: string;
  page_id: string;
  version: number;
  title: string;
  content: string;
  content_format: "html" | "markdown";
  created_at: string;
  change_summary: string | null;
  created_by_username: string | null;
  created_by_full_name: string | null;
}

export interface PageRevisionDiffChunk {
  operation: "add" | "delete" | "equal";
  text: string;
}

export interface PageRevisionDiffSegment {
  operation: "add" | "delete" | "equal";
  text: string;
}

export interface PageRevisionDiffLine {
  operation: "add" | "delete" | "equal" | "replace";
  old_line_number: number | null;
  new_line_number: number | null;
  old_text: string | null;
  new_text: string | null;
  old_segments: PageRevisionDiffSegment[];
  new_segments: PageRevisionDiffSegment[];
}

export interface PageRevisionDiff {
  from_version: number;
  to_version: number;
  title_changed: boolean;
  from_title: string;
  to_title: string;
  chunks: PageRevisionDiffChunk[];
  added_count: number;
  deleted_count: number;
  lines: PageRevisionDiffLine[];
}

export interface PageDraft {
  id: string;
  page_id: string;
  content: string;
  content_format: "html" | "markdown";
  edit_mode: "normal" | "markdown" | "html";
  base_updated_at: string;
  updated_at: string;
  is_conflict: boolean;
}

export interface InstanceInfo {
  site_name: string;
  theme_color?: string;
  default_font?: string;
  logo_icon?: string;
  custom_logo_url?: string | null;
  version: string;
  environment: string;
  max_upload_size_bytes: number;
  features: InstanceFeatures;
}

export interface User {
  id: string;
  username: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  bio: string;
  pronouns: string;
  profile_url: string;
  social_links: string[];
  company: string;
  is_active: boolean;
  is_superuser: boolean;
  /** The built-in administrator: immutable and undeletable through the API. */
  is_protected: boolean;
  last_login_at: string | null;
  created_at: string;
  groups: string[];
  global_permissions: GlobalPermission[];
}

/**
 * `/auth/me` — the session, which is more than the account.
 *
 * `impersonator` comes from the signed token, so the "you are viewing as…"
 * banner cannot be dismissed by tampering with anything the client holds.
 */
export interface Me extends User {
  impersonator: User | null;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_at: string;
  user: User;
}

export interface AccountSession {
  id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  ip_address: string | null;
  user_agent: string | null;
  is_current: boolean;
  is_admin_session: boolean;
}

export type SpaceStatus = "active" | "archived";
export type SpaceRole = "viewer" | "editor" | "admin";
export type SpaceVisibility = "open" | "restricted";
export type SpacePermission =
  | "view"
  | "add"
  | "delete"
  | "delete_own"
  | "restrictions"
  | "export"
  | "admin";
export type GlobalPermission =
  "create_space" | "manage_users" | "manage_groups" | "system_admin";
export type PageContentFormat = "html" | "markdown";

export interface Space {
  id: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  font_family?: string | null;
  /** Attachment ceiling in MB, or null when the Space follows the workspace. */
  max_upload_size_mb?: number | null;
  status: SpaceStatus;
  visibility: SpaceVisibility;
  created_at: string;
  updated_at: string;
  created_by_username: string | null;
  member_count: number;
  /** Distinct groups holding a direct permission on this space. */
  group_permission_count: number;
  /** Distinct non-superuser users holding a direct permission on this space. */
  direct_user_permission_count: number;
  is_favorite: boolean;
  /** The current user's role in this space, or null if not a member. */
  my_role: SpaceRole | null;
  my_permissions?: string[];
}

export interface SpaceMember {
  user_id: string;
  username: string;
  full_name: string;
  role: SpaceRole;
}

export interface Group {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  owner_username: string | null;
  owner_ids?: string[];
  is_active: boolean;
  member_count: number;
  created_at: string;
  updated_at: string;
  global_permissions: GlobalPermission[];
}

export interface GroupMember {
  user_id: string;
  username: string;
  full_name: string;
  email: string;
}

export interface SpacePermissionAssignment {
  space_id: string;
  principal_id: string;
  principal_type: "user" | "group";
  principal_name: string;
  permissions: SpacePermission[];
}

export interface EffectiveSpacePermissions {
  space_id: string;
  permissions: SpacePermission[];
  visibility: SpaceVisibility;
}

export interface WikiPage {
  id: string;
  space_id: string;
  parent_id: string | null;
  title: string;
  slug: string;
  content: string;
  content_format: PageContentFormat;
  created_at: string;
  updated_at: string;
  created_by_username: string | null;
  updated_by_username: string | null;
  can_edit?: boolean;
  can_export?: boolean;
  /** A view restriction on this page or an ancestor narrows who may read it. */
  is_restricted?: boolean;
}

export type DependencyStatus = "ok" | "error" | "timeout";

export interface ReadinessResponse {
  status: "ok" | "degraded";
  checks: Record<string, DependencyStatus>;
}

/** Paginated collection envelope returned by every new list endpoint. */
export interface Page<T> {
  items: T[];
  /** Total matching rows after filtering, not the size of the table. */
  total: number;
  limit: number;
  offset: number;
}

export interface SiteSettingsOverrides {
  site_name: string | null;
  theme_color: string | null;
  default_font: string | null;
  logo_icon: string | null;
  custom_logo_url: string | null;
  max_upload_size_mb: number | null;
  max_backup_import_size_mb: number | null;
  allowed_attachment_types: string[] | null;
  sidebar_permissions: SidebarPermissions | null;
  session_ttl_hours: number | null;
}

export interface EffectiveSettings {
  site_name: string;
  theme_color: string;
  default_font: string;
  logo_icon: string;
  custom_logo_url: string | null;
  max_upload_size_mb: number;
  max_upload_size_bytes: number;
  max_backup_import_size_mb: number;
  max_backup_import_size_bytes: number;
  allowed_attachment_types: string[];
  sidebar_permissions: SidebarPermissions;
  session_ttl_hours: number;
}

export type AppRole = "admin" | "member";

export interface SidebarPermissions {
  home: AppRole[];
  spaces: AppRole[];
  recent: AppRole[];
  favorites: AppRole[];
  settings: AppRole[];
  backups: AppRole[];
}

export interface SiteSettings {
  overrides: SiteSettingsOverrides;
  effective: EffectiveSettings;
  updated_at: string | null;
  updated_by_username: string | null;
}

//: A WikiHub `.zip` backup archive uploaded (and, once scanned, its
//: contained spaces listed) via `/api/v1/backup/archives/*` - the restore
//: counterpart of `ConfluenceArchive` below. Carries the same per-space
//: fields, so both space pickers can show page counts and warn about keys
//: that already exist.
export interface BackupArchiveSpace {
  key: string;
  name: string;
  page_count: number;
  /** A space with this key already exists here and would be skipped. */
  conflict: boolean;
}
export interface BackupArchive {
  id: string;
  filename: string;
  size_bytes: number;
  sha256: string | null;
  status: string;
  error: string | null;
  spaces: BackupArchiveSpace[];
}

//: One in-flight or ready-to-restore backup archive, from
//: `GET /api/v1/backup/archives/uploads/active`. Lets the restore card rebuild
//: itself from the server after a remount, instead of losing an upload or a
//: finished scan the moment the user navigates away.
export interface BackupArchiveUploadProgress {
  archive_id: string;
  filename: string;
  size_bytes: number;
  sha256: string | null;
  status: string;
  part_size_bytes: number;
  uploaded_parts: number[];
}

export interface ConfluenceSpaceCandidate {
  key: string;
  name: string;
  page_count: number;
  attachment_count: number;
  conflict: boolean;
}
export interface ConfluenceArchive {
  id: string;
  filename: string;
  size_bytes: number;
  sha256: string | null;
  status: string;
  error: string | null;
  spaces: ConfluenceSpaceCandidate[];
}
export interface ConfluenceUploadTarget {
  archive_id: string;
  object_key: string;
  max_size_bytes: number;
  part_size_bytes: number;
  uploaded_parts: number[];
  status: string;
  sha256: string | null;
  reused: boolean;
}
export interface ConfluenceUploadProgress {
  archive_id: string;
  filename: string;
  size_bytes: number;
  sha256: string | null;
  status: string;
  part_size_bytes: number;
  uploaded_parts: number[];
}
export interface ConfluenceImportJob {
  id: string;
  archive_id: string;
  import_all: boolean;
  space_keys: string[];
  overwrite_existing: boolean;
  status: string;
  phase: string;
  counters: Record<string, number>;
  cancel_requested: boolean;
  error: string | null;
  created_at: string;
  updated_at: string;
}
export interface ConfluenceImportLog {
  id: string;
  created_at: string;
  level: string;
  phase: string;
  entity_type: string | null;
  entity_label: string | null;
  message: string;
}

//: One narration line from a backup job (`GET /api/v1/backup/jobs/:id/logs`).
//: Same shape as `ConfluenceImportLog` on purpose - the admin panel renders
//: both kinds of job in the same list, so they must read the same way.
export interface BackupJobLog {
  id: string;
  created_at: string;
  level: string;
  phase: string;
  entity_type: string | null;
  entity_label: string | null;
  message: string;
}

export interface SidebarPermissionsRead {
  permissions: SidebarPermissions;
}

export interface ImportEntry {
  kind: string;
  label: string;
  outcome: "created" | "skipped" | "error";
  reason: string;
}

export interface ImportReport {
  dry_run: boolean;
  version: number;
  includes_credentials: boolean;
  created: Record<string, number>;
  skipped: Record<string, number>;
  errors: Record<string, number>;
  /** Restored accounts that cannot sign in until an admin sets a password. */
  users_without_password: string[];
  entries: ImportEntry[];
  entries_truncated: boolean;
  /** Space keys skipped because a space with that key already exists -
   * exact and never truncated, unlike `entries`. Offer these back as
   * `overwrite_space_keys` on a follow-up restore to replace them. */
  conflicting_space_keys: string[];
}

// ---------------------------------------------------------------------------
// Storage management
// ---------------------------------------------------------------------------

export interface StorageObject {
  key: string;
  size: number;
  etag: string | null;
  last_modified: string | null;
  kind:
    | "page_attachment"
    | "avatar"
    | "import_archive"
    | "document_import"
    | "backup_archive"
    | "backup_export"
    | "other";
  space_id: string | null;
  space_name: string | null;
  page_id: string | null;
  page_title: string | null;
}

export interface StoragePresignedUrl {
  url: string;
  key: string;
}

export interface PageAttachmentUpload {
  id: string;
  filename: string;
  content_type: string;
  content_url: string;
}

export interface StorageDeleteResult {
  key: string;
  archive_cleared: boolean;
  attachment_deleted: boolean;
}

/** The chrome-less /print route's payload - see backend `ExportBundle`. */
export interface ExportBundle {
  page: {
    id: string;
    title: string;
    slug: string;
    /** Sanitized, toggle-forced-open, attachment-inlined HTML, ready to render. */
    content: string;
  };
  space: {
    key: string;
    name: string;
    font_family: string | null;
  };
  site: {
    site_name: string;
    theme_color: string;
    default_font: string;
  };
  theme: "light" | "dark";
}

/** One file in a document import, and what became of it. */
export interface DocumentImportItem {
  id: string;
  position: number;
  filename: string;
  size_bytes: number;
  source_format: string;
  status: "queued" | "running" | "complete" | "failed" | "cancelled";
  error: string | null;
  /** Non-fatal notes: images dropped, a scanned PDF, content truncated. */
  warnings: string[];
  /** Null until the page exists, and null again if it is later deleted -
   *  `page_title` and `page_slug` keep the record readable either way. */
  page_id: string | null;
  page_title: string | null;
  page_slug: string | null;
  attachments_created: number;
}

/** A batch of documents being turned into pages. */
export interface DocumentImportJob {
  id: string;
  space_key: string;
  parent_id: string | null;
  status: "queued" | "running" | "complete" | "failed" | "cancelled";
  phase: string;
  counters: Record<string, number>;
  cancel_requested: boolean;
  error: string | null;
  /** Null while there is not yet enough data to estimate; show an
   *  indeterminate bar rather than a number the server made up. */
  percent: number | null;
  eta_seconds: number | null;
  started_at: string | null;
  heartbeat_at: string | null;
  created_at: string;
  updated_at: string;
  items: DocumentImportItem[];
}
