import { api } from "@/lib/api-client";
import type { HealthPage, SpaceHealth, StaleCheck } from "@/types/api";

/** The four lists of the report, in the order their tabs are shown. */
export const HEALTH_TABS = ["stale", "broken", "orphans", "duplicates"] as const;
export type HealthTab = (typeof HEALTH_TABS)[number];

/** How long without an edit before a page may be out of date: about 6, 12 and 24 months. */
export const STALE_CHOICES = [180, 365, 730] as const;

function spacePath(spaceKey: string): string {
  return `/api/v1/spaces/${encodeURIComponent(spaceKey)}`;
}

/** Where a listed page opens. */
export function healthPageHref(page: Pick<HealthPage, "space_key" | "slug">): string {
  return `/spaces/${encodeURIComponent(page.space_key)}/pages/${encodeURIComponent(page.slug)}`;
}

export function loadSpaceHealth(spaceKey: string, staleDays: number): Promise<SpaceHealth> {
  return api.get<SpaceHealth>(`${spacePath(spaceKey)}/health?stale_days=${staleDays}`);
}

/** Mark a page still correct: it leaves the stale list until it ages again. */
export function markPageReviewed(spaceKey: string, slug: string): Promise<{ reviewed_at: string }> {
  return api.post<{ reviewed_at: string }>(
    `${spacePath(spaceKey)}/pages/${encodeURIComponent(slug)}/review`,
  );
}

/** Ask the AI what in a page the newer pages tied to it contradict or replace. */
export function checkStalePage(
  spaceKey: string,
  slug: string,
  locale: string,
): Promise<StaleCheck> {
  return api.post<StaleCheck>(
    `${spacePath(spaceKey)}/pages/${encodeURIComponent(slug)}/stale-check`,
    { locale: locale === "vi" ? "vi" : "en" },
  );
}

/** How many there are of each list (the totals, not just what the report lists). */
export function healthCounts(health: SpaceHealth): Record<HealthTab, number> {
  return {
    stale: health.stale_total,
    broken: health.broken_total,
    orphans: health.orphans_total,
    duplicates: health.duplicates_total,
  };
}

/** The first list with something in it, so the dialog opens where there is work to do. */
export function firstBusyTab(health: SpaceHealth): HealthTab {
  const counts = healthCounts(health);
  return HEALTH_TABS.find((tab) => counts[tab] > 0) ?? "stale";
}

/** Whole days since an ISO date. */
export function daysSince(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));
}
