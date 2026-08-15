import { api } from "@/lib/api-client";
import type { PageDraft } from "@/types/api";

export type LocalPageDraft = Pick<
  PageDraft,
  "content" | "content_format" | "edit_mode" | "base_updated_at"
> & {
  saved_at: string;
};

function draftPath(spaceKey: string, slug: string): string {
  return `/api/v1/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(slug)}/draft`;
}

function localDraftKey(spaceKey: string, slug: string): string {
  return `wikihub:page-draft:${spaceKey}:${slug}`;
}

export function saveLocalPageDraft(
  spaceKey: string,
  slug: string,
  draft: Omit<LocalPageDraft, "saved_at">,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      localDraftKey(spaceKey, slug),
      JSON.stringify({ ...draft, saved_at: new Date().toISOString() }),
    );
  } catch {
    // Backend persistence remains the source of truth when local storage is unavailable.
  }
}

export function getLocalPageDraft(
  spaceKey: string,
  slug: string,
): LocalPageDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(localDraftKey(spaceKey, slug));
    return raw ? (JSON.parse(raw) as LocalPageDraft) : null;
  } catch {
    return null;
  }
}

export function clearLocalPageDraft(spaceKey: string, slug: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(localDraftKey(spaceKey, slug));
}

export function getPageDraft(
  spaceKey: string,
  slug: string,
): Promise<PageDraft | null> {
  return api.get<PageDraft | null>(draftPath(spaceKey, slug));
}

export function savePageDraft(
  spaceKey: string,
  slug: string,
  payload: Pick<
    PageDraft,
    "content" | "content_format" | "edit_mode" | "base_updated_at"
  >,
  options?: Pick<RequestInit, "keepalive">,
): Promise<PageDraft> {
  return api.put<PageDraft>(draftPath(spaceKey, slug), payload, options);
}

export function discardPageDraft(spaceKey: string, slug: string): Promise<void> {
  return api.delete<void>(draftPath(spaceKey, slug));
}
