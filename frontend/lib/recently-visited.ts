/**
 * Client-side "recently visited" history.
 *
 * WikiHub has no server-side page-view log, so this is a small, best-effort
 * per-browser record - the same trade-off `space-workspace.tsx` already makes
 * for "Saved for later". It is written whenever `RecordVisit` mounts on a page
 * view, and read by the /recent/visited list.
 */

const STORAGE_KEY = "wikihub:recently-visited";
const EVENT_NAME = "wikihub:recently-visited-changed";
const MAX_ENTRIES = 25;

export interface VisitedPage {
  spaceKey: string;
  spaceName: string;
  slug: string;
  title: string;
  visitedAt: string;
}

function isVisitedPage(value: unknown): value is VisitedPage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.spaceKey === "string" &&
    typeof candidate.spaceName === "string" &&
    typeof candidate.slug === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.visitedAt === "string"
  );
}

/** Most recent first. Safe to call during SSR (returns an empty list). */
export function readRecentlyVisited(): VisitedPage[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "[]",
    );
    return Array.isArray(value) ? value.filter(isVisitedPage) : [];
  } catch {
    return [];
  }
}

/** Records a visit, moving it to the front if it was already there. */
export function recordVisit(entry: VisitedPage) {
  if (typeof window === "undefined") return;
  try {
    const withoutDuplicate = readRecentlyVisited().filter(
      (item) => !(item.spaceKey === entry.spaceKey && item.slug === entry.slug),
    );
    const next = [entry, ...withoutDuplicate].slice(0, MAX_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(EVENT_NAME));
  } catch {
    // Best-effort only: a full or blocked store just means no history.
  }
}

export function subscribeRecentlyVisited(onChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT_NAME, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT_NAME, onChange);
  };
}
