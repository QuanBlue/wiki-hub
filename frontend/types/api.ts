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

export interface InstanceInfo {
  site_name: string;
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
  is_active: boolean;
  is_superuser: boolean;
  /** The built-in administrator: immutable and undeletable through the API. */
  is_protected: boolean;
  last_login_at: string | null;
  created_at: string;
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

export type SpaceStatus = "active" | "archived";
export type SpaceRole = "viewer" | "editor" | "admin";
export type PageContentFormat = "html" | "markdown";

export interface Space {
  id: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  status: SpaceStatus;
  created_at: string;
  updated_at: string;
  created_by_username: string | null;
  member_count: number;
  is_favorite: boolean;
  /** The current user's role in this space, or null if not a member. */
  my_role: SpaceRole | null;
}

export interface SpaceMember {
  user_id: string;
  username: string;
  full_name: string;
  role: SpaceRole;
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

export interface AuditLogEntry {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_username: string;
  /** Set when the action was taken through impersonation. */
  impersonator_username: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string;
  details: Record<string, unknown>;
  ip_address: string | null;
}

export interface SiteSettingsOverrides {
  site_name: string | null;
  max_upload_size_mb: number | null;
  max_backup_import_size_mb: number | null;
  allowed_attachment_types: string[] | null;
  sidebar_permissions: SidebarPermissions | null;
}

export interface EffectiveSettings {
  site_name: string;
  max_upload_size_mb: number;
  max_upload_size_bytes: number;
  max_backup_import_size_mb: number;
  max_backup_import_size_bytes: number;
  allowed_attachment_types: string[];
  sidebar_permissions: SidebarPermissions;
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
}
export interface ConfluenceUploadProgress {
  archive_id: string;
  filename: string;
  size_bytes: number;
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
}
