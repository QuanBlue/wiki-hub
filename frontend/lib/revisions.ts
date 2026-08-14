import { api } from "@/lib/api-client";
import type { PageRevisionItem, PageRevisionDiff } from "@/types/api";

export function listPageRevisions(
  spaceKey: string,
  slug: string,
): Promise<PageRevisionItem[]> {
  return api.get<PageRevisionItem[]>(
    `/api/v1/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(slug)}/revisions`,
  );
}

export function getPageRevision(
  spaceKey: string,
  slug: string,
  version: number,
): Promise<PageRevisionItem> {
  return api.get<PageRevisionItem>(
    `/api/v1/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(slug)}/revisions/${version}`,
  );
}

export function getRevisionDiff(
  spaceKey: string,
  slug: string,
  fromVersion?: number,
  toVersion?: number,
): Promise<PageRevisionDiff> {
  const params = new URLSearchParams();
  if (fromVersion !== undefined) params.set("from_version", String(fromVersion));
  if (toVersion !== undefined) params.set("to_version", String(toVersion));
  const query = params.toString() ? `?${params.toString()}` : "";

  return api.get<PageRevisionDiff>(
    `/api/v1/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(slug)}/revisions/diff${query}`,
  );
}

export function restorePageRevision(
  spaceKey: string,
  slug: string,
  version: number,
): Promise<unknown> {
  return api.post<unknown>(
    `/api/v1/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(slug)}/revisions/${version}/restore`,
  );
}
