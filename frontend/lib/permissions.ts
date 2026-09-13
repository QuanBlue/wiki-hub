import type { SpacePermissionAssignment } from "@/types/api";

/**
 * `GET /spaces/{key}/permissions` returns one row per (principal, permission)
 * database row - `permissions` is always a single-element array - because
 * that mirrors how `SpaceUserPermission`/`SpaceGroupPermission` are actually
 * stored (see `list_permissions` in the backend's `api/v1/spaces.py`). Every
 * consumer of this list edits and diffs permissions per *principal*, though
 * (one row per person/group with a combined `permissions` array, matching
 * the space-permission matrix's own shape), so this folds the raw rows
 * together before anything else sees them.
 *
 * Skipping this step doesn't just mis-render the table: `EditSpaceModal`'s
 * toggle handlers `.find()` the *first* raw row for a principal and rewrite
 * every row sharing that principal_id/type to match its (single-permission)
 * array - so toggling any one checkbox for someone with 2+ permissions wipes
 * every OTHER permission they had down to just that one.
 */
export function groupPermissionAssignments(
  rows: SpacePermissionAssignment[],
): SpacePermissionAssignment[] {
  const byKey = new Map<string, SpacePermissionAssignment>();
  for (const row of rows) {
    const key = `${row.principal_type}:${row.principal_id}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.permissions = Array.from(new Set([...existing.permissions, ...row.permissions]));
    } else {
      byKey.set(key, { ...row, permissions: [...row.permissions] });
    }
  }
  return Array.from(byKey.values());
}
