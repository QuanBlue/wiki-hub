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

export type RevisionDiffSummary = {
  summary: string;
  commit_message: string;
  from_version: number | null;
  to_version: number | null;
  cached: boolean;
};

export function getRevisionDiffSummary(
  spaceKey: string,
  slug: string,
  payload: {
    from_version?: number;
    to_version?: number;
    prompt?: string;
    lang?: string;
    from_content?: string;
    to_content?: string;
    from_title?: string;
    to_title?: string;
  },
): Promise<RevisionDiffSummary> {
  return api.post<RevisionDiffSummary>(
    `/api/v1/ai/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(slug)}/diff-summary`,
    payload,
  );
}
