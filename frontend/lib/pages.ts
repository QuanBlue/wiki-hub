/**
 * Server-side Page fetchers.
 */

import { cookies } from "next/headers";

import { api } from "@/lib/api-client";
import { ACCESS_COOKIE_NAME } from "@/lib/auth";
import type {
  PublicUser,
  RecentPageItem,
  UserActivityPage,
  UserDraftItem,
  UserPinnedPageItem,
  UserProfileStats,
  UserTag,
  WikiPage,
} from "@/types/api";

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

export function listPages(spaceKey: string): Promise<WikiPage[]> {
  return get<WikiPage[]>(
    `/api/v1/spaces/${encodeURIComponent(spaceKey)}/pages`,
  );
}

export function listRecentPages(limit = 50): Promise<RecentPageItem[]> {
  return get<RecentPageItem[]>(`/api/v1/pages/recent?limit=${limit}`);
}

export function getPublicUser(username: string): Promise<PublicUser> {
  return get<PublicUser>(`/api/v1/users/${encodeURIComponent(username)}/profile`);
}

export function listUserActivity(
  username: string,
  cursor?: string | null,
): Promise<UserActivityPage> {
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);
  return get<UserActivityPage>(
    `/api/v1/users/${encodeURIComponent(username)}/activity?${params.toString()}`,
  );
}

export function getUserProfileStats(username: string): Promise<UserProfileStats> {
  return get<UserProfileStats>(`/api/v1/users/${encodeURIComponent(username)}/stats`);
}

export function listUserDrafts(username: string): Promise<UserDraftItem[]> {
  return get<UserDraftItem[]>(`/api/v1/users/${encodeURIComponent(username)}/drafts`);
}

export function listOwnPinnedPages(): Promise<UserPinnedPageItem[]> {
  return get<UserPinnedPageItem[]>("/api/v1/users/me/pins");
}

export function listOwnUserTags(): Promise<UserTag[]> {
  return get<UserTag[]>("/api/v1/users/me/tags");
}

export function getPage(spaceKey: string, slug: string): Promise<WikiPage> {
  return get<WikiPage>(
    `/api/v1/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(slug)}`,
  );
}

/**
 * Resolve a page from the already-loaded space tree when a direct page URL is
 * temporarily stale. Imported data can retain a differently cased or encoded
 * slug even though the list endpoint still exposes the page correctly.
 */
export function findPageByRouteSlug(
  pages: WikiPage[],
  routeSlug: string,
): WikiPage | undefined {
  let normalizedSlug = routeSlug;
  try {
    normalizedSlug = decodeURIComponent(routeSlug);
  } catch {
    // Keep the raw route segment when it is not valid URI encoding.
  }
  normalizedSlug = normalizedSlug.trim().toLocaleLowerCase();
  return pages.find(
    (page) => page.slug.trim().toLocaleLowerCase() === normalizedSlug,
  );
}

/** Resolve the space home page across both new and legacy imports. */
