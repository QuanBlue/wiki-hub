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
  allowed_attachment_types: string[] | null;
}

export interface EffectiveSettings {
  site_name: string;
  max_upload_size_mb: number;
  max_upload_size_bytes: number;
  allowed_attachment_types: string[];
}

export interface SiteSettings {
  overrides: SiteSettingsOverrides;
  effective: EffectiveSettings;
  updated_at: string | null;
  updated_by_username: string | null;
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
