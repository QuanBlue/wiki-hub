"use client";

/**
 * Which favourite spaces / pinned pages show as sidebar shortcuts.
 *
 * Shared between the sidebar's own "Manage sidebar" dialog and the My
 * Knowledge tab on the profile page, so a change made in either place is
 * reflected in the other without a reload. The choice itself lives in
 * localStorage (a personal display preference, not worth a round trip), so
 * `storage` only tells other *tabs*; this module also dispatches a same-tab
 * custom event so sibling components in the same page pick the change up too.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Space, UserPinnedPageItem } from "@/types/api";

export const SIDEBAR_SHORTCUT_LIMIT = 5;
export const FAVORITE_SIDEBAR_STORAGE_KEY = "wikihub:sidebar-favourite-space-ids";
export const PINNED_SIDEBAR_STORAGE_KEY = "wikihub:sidebar-pinned-page-ids";
const SIDEBAR_SHORTCUTS_EVENT = "wikihub:sidebar-shortcuts-changed";

export type SidebarShortcutCollection = "favorites" | "pinned";

function storageKeyFor(collection: SidebarShortcutCollection): string {
  return collection === "favorites"
    ? FAVORITE_SIDEBAR_STORAGE_KEY
    : PINNED_SIDEBAR_STORAGE_KEY;
}

/**
 * No stored key means the user has never customized this list, so the
 * default (first N favourites/pinned) should still apply. Once they *have*
 * customized it - even down to an explicitly empty selection - that stored
 * value is read back exactly as saved: no top-up here. Filling an
 * under-the-limit selection with newly favourited/pinned items is handled
 * separately below, on a trigger that cannot fire from this hook's own
 * writes - otherwise removing a single shortcut while under the limit would
 * be handed straight back the instant this ran in response to that removal.
 */
function readStoredIds(key: string, validIds: Set<string>, fallback: string[]): string[] {
  const raw = window.localStorage.getItem(key);
  if (raw === null) return fallback;
  try {
    const stored = JSON.parse(raw);
    return Array.isArray(stored)
      ? stored
          .filter((id): id is string => typeof id === "string" && validIds.has(id))
          .slice(0, SIDEBAR_SHORTCUT_LIMIT)
      : fallback;
  } catch {
    return fallback;
  }
}

/** Appends ids from `newIds` that are not already present, until either runs
 * out or the list reaches `SIDEBAR_SHORTCUT_LIMIT`. Order among the
 * already-present ids is left untouched - this only ever appends. */
function fillRemainingSlots(current: string[], newIds: string[]): string[] {
  if (current.length >= SIDEBAR_SHORTCUT_LIMIT) return current;
  const filled = [...current];
  for (const id of newIds) {
    if (filled.length >= SIDEBAR_SHORTCUT_LIMIT) break;
    if (!filled.includes(id)) filled.push(id);
  }
  return filled;
}

/** Runs `onNewIds` with whichever of `currentIds` were not present the last
 * time this ran (nothing, on the very first call - mounting is the
 * baseline, not itself "new"). Shared between the favourites and pinned
 * top-up effects below so the two do not drift into different rules for
 * what counts as "new". */
function useTopUpOnNewIds(
  currentIds: string[],
  onNewIds: (newIds: string[]) => void,
) {
  const knownIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (knownIds.current === null) {
      knownIds.current = new Set(currentIds);
      return;
    }
    const known = knownIds.current;
    const newIds = currentIds.filter((id) => !known.has(id));
    knownIds.current = new Set(currentIds);
    if (newIds.length) onNewIds(newIds);
    // `onNewIds` is an inline closure at each call site; including it in
    // the dependency array would re-run this on every render instead of
    // only when the id list itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIds]);
}

export function useSidebarShortcuts(
  favoriteSpaces: Space[],
  pinnedPages: UserPinnedPageItem[],
) {
  const [sidebarFavoriteIds, setSidebarFavoriteIds] = useState(() =>
    favoriteSpaces.slice(0, SIDEBAR_SHORTCUT_LIMIT).map((space) => space.id),
  );
  const [sidebarPinnedIds, setSidebarPinnedIds] = useState(() =>
    pinnedPages.slice(0, SIDEBAR_SHORTCUT_LIMIT).map((page) => page.id),
  );

  const sync = useCallback(() => {
    setSidebarFavoriteIds(
      readStoredIds(
        FAVORITE_SIDEBAR_STORAGE_KEY,
        new Set(favoriteSpaces.map((space) => space.id)),
        favoriteSpaces.slice(0, SIDEBAR_SHORTCUT_LIMIT).map((space) => space.id),
      ),
    );
    setSidebarPinnedIds(
      readStoredIds(
        PINNED_SIDEBAR_STORAGE_KEY,
        new Set(pinnedPages.map((page) => page.id)),
        pinnedPages.slice(0, SIDEBAR_SHORTCUT_LIMIT).map((page) => page.id),
      ),
    );
  }, [favoriteSpaces, pinnedPages]);

  // Initial read, deferred a frame so it never blocks first paint.
  useEffect(() => {
    const frame = window.requestAnimationFrame(sync);
    return () => window.cancelAnimationFrame(frame);
  }, [sync]);

  // Pick up a change made elsewhere: another tab (`storage`) or another
  // component in this same tab (the custom event below).
  useEffect(() => {
    window.addEventListener("storage", sync);
    window.addEventListener(SIDEBAR_SHORTCUTS_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(SIDEBAR_SHORTCUTS_EVENT, sync);
    };
  }, [sync]);

  // Top up an under-the-limit selection with spaces favourited (or pages
  // pinned) *during this session* - e.g. starring a space elsewhere calls
  // `router.refresh()`, which hands this hook a `favoriteSpaces` array with
  // one more id than it had a moment ago. Keyed on that array actually
  // changing, never on `sync`'s own reads, so it cannot immediately re-add a
  // shortcut this hook's own `toggleSidebarShortcut` just removed - that
  // write does not touch `favoriteSpaces`/`pinnedPages` at all.
  // Memoized so this only re-derives (and so `useTopUpOnNewIds`'s effect
  // only re-runs) when `favoriteSpaces` itself is a genuinely new array from
  // the caller, not on every unrelated render of whatever renders this hook.
  const favoriteIds = useMemo(
    () => favoriteSpaces.map((space) => space.id),
    [favoriteSpaces],
  );
  useTopUpOnNewIds(favoriteIds, (newIds) => {
    setSidebarFavoriteIds((current) => {
      const filled = fillRemainingSlots(current, newIds);
      if (filled === current) return current;
      window.localStorage.setItem(FAVORITE_SIDEBAR_STORAGE_KEY, JSON.stringify(filled));
      window.dispatchEvent(new Event(SIDEBAR_SHORTCUTS_EVENT));
      return filled;
    });
  });

  const pinnedIds = useMemo(
    () => pinnedPages.map((page) => page.id),
    [pinnedPages],
  );
  useTopUpOnNewIds(pinnedIds, (newIds) => {
    setSidebarPinnedIds((current) => {
      const filled = fillRemainingSlots(current, newIds);
      if (filled === current) return current;
      window.localStorage.setItem(PINNED_SIDEBAR_STORAGE_KEY, JSON.stringify(filled));
      window.dispatchEvent(new Event(SIDEBAR_SHORTCUTS_EVENT));
      return filled;
    });
  });

  const toggleSidebarShortcut = useCallback(
    (collection: SidebarShortcutCollection, id: string) => {
      const storageKey = storageKeyFor(collection);
      const setIds =
        collection === "favorites" ? setSidebarFavoriteIds : setSidebarPinnedIds;
      setIds((current) => {
        const next = current.includes(id)
          ? current.filter((currentId) => currentId !== id)
          : current.length < SIDEBAR_SHORTCUT_LIMIT
            ? [...current, id]
            : current;
        window.localStorage.setItem(storageKey, JSON.stringify(next));
        window.dispatchEvent(new Event(SIDEBAR_SHORTCUTS_EVENT));
        return next;
      });
    },
    [],
  );

  return { sidebarFavoriteIds, sidebarPinnedIds, toggleSidebarShortcut };
}
