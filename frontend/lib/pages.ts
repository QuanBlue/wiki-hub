/**
 * Server-side Page fetchers.
 */

import { cookies } from "next/headers";

import { api } from "@/lib/api-client";
import { ACCESS_COOKIE_NAME } from "@/lib/auth";
import type { RecentPageItem, WikiPage } from "@/types/api";

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

export function getPage(spaceKey: string, slug: string): Promise<WikiPage> {
  return get<WikiPage>(
    `/api/v1/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(slug)}`,
  );
}

/** Resolve the space home page across both new and legacy imports. */
