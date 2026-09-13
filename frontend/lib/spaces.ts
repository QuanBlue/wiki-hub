/**
 * Server-side Space fetchers.
 *
 * These run in React Server Components, which means the session cookie has to
 * be forwarded explicitly — see the note in `lib/auth.ts`.
 */

import { cookies } from "next/headers";

import { api } from "@/lib/api-client";
import { ACCESS_COOKIE_NAME } from "@/lib/auth";
import type { Group, Space, SpaceMember, SpacePermissionAssignment, User } from "@/types/api";

async function authHeaders(): Promise<Record<string, string>> {
  const token = (await cookies()).get(ACCESS_COOKIE_NAME)?.value;
  return token ? { Cookie: `${ACCESS_COOKIE_NAME}=${token}` } : {};
}

async function get<T>(path: string): Promise<T> {
  return api.get<T>(path, {
    cache: "no-store",
    headers: await authHeaders(),
  });
}

export function listSpaces(
  includeArchived = false,
  limit = 100,
  offset = 0,
): Promise<Space[]> {
  return get<Space[]>(
    `/api/v1/spaces?include_archived=${includeArchived}&limit=${limit}&offset=${offset}`,
  );
}

/** Fetch the full space directory for administrative search and local paging. */
export async function listAllSpaces(includeArchived = false): Promise<Space[]> {
  const spaces: Space[] = [];
  const limit = 200;
  let offset = 0;

  while (true) {
    const batch = await listSpaces(includeArchived, limit, offset);
    spaces.push(...batch);
    if (batch.length < limit) return spaces;
    offset += batch.length;
  }
}

export function listRecentSpaces(): Promise<Space[]> {
  return get<Space[]>("/api/v1/spaces/recent");
}

export function listFavoriteSpaces(): Promise<Space[]> {
  return get<Space[]>("/api/v1/spaces/favorites");
}

/** This user's own most-opened spaces, ranked by a server-side visit counter. */
export function listTopVisitedSpaces(limit = 5): Promise<Space[]> {
  return get<Space[]>(`/api/v1/spaces/top-visited?limit=${limit}`);
}

export function getSpace(key: string): Promise<Space> {
  return get<Space>(`/api/v1/spaces/${encodeURIComponent(key)}`);
}

export function listSpaceMembers(key: string): Promise<SpaceMember[]> {
  return get<SpaceMember[]>(
    `/api/v1/spaces/${encodeURIComponent(key)}/members`,
  );
}

// Returns one row per (principal, permission) *database* row - `permissions`
// is always a single-element array - mirroring how SpaceUserPermission and
// SpaceGroupPermission are actually stored. `SpaceAccessPanel` (this
// function's only consumer) is built around that shape: it unions matching
// rows to read a principal's permissions and appends/removes single-element
// rows to edit them. `EditSpaceModal`, which instead edits one combined
// per-principal row, groups this same endpoint's response itself - see
// `groupPermissionAssignments` in lib/permissions.ts - rather than this
// function pre-grouping it out from under `SpaceAccessPanel`.
export function listSpacePermissions(key: string): Promise<SpacePermissionAssignment[]> {
  return get<SpacePermissionAssignment[]>(
    `/api/v1/spaces/${encodeURIComponent(key)}/permissions`,
  );
}

export function listSpacePermissionUsers(key: string): Promise<User[]> {
  return get<User[]>(
    `/api/v1/spaces/${encodeURIComponent(key)}/permissions/principals/users`,
  );
}

export function listSpacePermissionGroups(key: string): Promise<Group[]> {
  return get<Group[]>(
    `/api/v1/spaces/${encodeURIComponent(key)}/permissions/principals/groups`,
  );
}
