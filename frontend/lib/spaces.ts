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

export function listRecentSpaces(): Promise<Space[]> {
  return get<Space[]>("/api/v1/spaces/recent");
}

export function listFavoriteSpaces(): Promise<Space[]> {
  return get<Space[]>("/api/v1/spaces/favorites");
}

export function getSpace(key: string): Promise<Space> {
  return get<Space>(`/api/v1/spaces/${encodeURIComponent(key)}`);
}

export function listSpaceMembers(key: string): Promise<SpaceMember[]> {
  return get<SpaceMember[]>(
    `/api/v1/spaces/${encodeURIComponent(key)}/members`,
  );
}

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
