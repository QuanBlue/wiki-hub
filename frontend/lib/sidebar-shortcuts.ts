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

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { Space, UserPinnedPageItem } from "@/types/api";

// `useLayoutEffect` warns when it runs during SSR (it can't - there's no
// DOM to measure), but this hook is client-only in practice; `useEffect` is
// only the fallback for a server render of the same component tree. Runs
// the seed/sync writes below synchronously, before the browser's next
// paint, instead of a frame (or more) later - see `useSidebarShortcuts`.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export const SIDEBAR_SHORTCUT_LIMIT = 5;
export const FAVORITE_SIDEBAR_STORAGE_KEY = "wikihub:sidebar-favourite-space-ids";
export const PINNED_SIDEBAR_STORAGE_KEY = "wikihub:sidebar-pinned-page-ids";
// Everything the top-up logic below has already accounted for - either by
// adding it to the shortcut list or by leaving it out because there was no
// room. Anything favourited/pinned that is *not* in here yet is genuinely
// new since the list was last customized, and is what gets auto-added.
// Without this, "new" could only ever be detected in-memory for as long as
// a component happened to stay mounted, so a favourite added just before a
// navigation or a reload would never make it into the sidebar.
const FAVORITE_SIDEBAR_SEEN_KEY = "wikihub:sidebar-favourite-space-seen-ids";
const PINNED_SIDEBAR_SEEN_KEY = "wikihub:sidebar-pinned-page-seen-ids";
const SIDEBAR_SHORTCUTS_EVENT = "wikihub:sidebar-shortcuts-changed";

export type SidebarShortcutCollection = "favorites" | "pinned";

function storageKeyFor(collection: SidebarShortcutCollection): string {
  return collection === "favorites" ? FAVORITE_SIDEBAR_STORAGE_KEY : PINNED_SIDEBAR_STORAGE_KEY;
}

function seenKeyFor(collection: SidebarShortcutCollection): string {
  return collection === "favorites" ? FAVORITE_SIDEBAR_SEEN_KEY : PINNED_SIDEBAR_SEEN_KEY;
}

function readIdArray(key: string): string[] | null {
  const raw = window.localStorage.getItem(key);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : null;
  } catch {
    return null;
  }
}

/** Appends ids from `source` that are not already present, until either runs
 * out or the list reaches `SIDEBAR_SHORTCUT_LIMIT`. Order among the
 * already-present ids is left untouched - this only ever appends. */
function fillRemainingSlots(current: string[], source: string[]): string[] {
  if (current.length >= SIDEBAR_SHORTCUT_LIMIT) return current;
  const filled = [...current];
  for (const id of source) {
    if (filled.length >= SIDEBAR_SHORTCUT_LIMIT) break;
    if (!filled.includes(id)) filled.push(id);
  }
  return filled;
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Seeds the "seen" baseline for one collection if it is customized (a
 * stored selection exists) but has no baseline recorded yet - using
 * `mountIds`, the ids present when this hook instance first mounted.
 *
 * Called from a mount-only effect with no dependencies, so - unlike the
 * regular `sync` effect below, which is deferred a frame and re-scheduled
 * whenever `favoriteSpaces`/`pinnedPages` change - it always runs exactly
 * once, synchronously with the first effect flush, and cannot be starved by
 * a prop update (e.g. a favourite added moments after mount) arriving
 * before that deferred frame fires. Without this, such an update could
 * race the baseline into including the very id it should have flagged as
 * new.
 */
function seedSeenBaseline(storageKey: string, seenKey: string, mountIds: string[]) {
  if (window.localStorage.getItem(storageKey) === null) return;
  if (window.localStorage.getItem(seenKey) === null) {
    window.localStorage.setItem(seenKey, JSON.stringify(mountIds));
  }
}

/**
 * Resolves the effective shortcut list for one collection, and what (if
 * anything) needs writing back to localStorage as a result.
 *
 * No stored selection means the user has never customized this list: it
 * always mirrors the first `SIDEBAR_SHORTCUT_LIMIT` current ids, live,
 * without writing anything - so it keeps tracking the live favourites/pinned
 * list exactly, rather than freezing a snapshot of it.
 *
 * A stored selection - even an explicitly empty one - means the user has
 * customized the list. That selection is honoured as saved, except: ids
 * that are new since the list was last accounted for (the "seen" set) get
 * appended to fill any remaining room, up to the limit. Ids the user
 * deliberately removed are not in that "new" set (removing one marks the
 * full set at that moment as seen - see `useSidebarShortcuts`), so they are
 * never hand back the instant there is room again.
 */
function resolveShortcutIds(
  storageKey: string,
  seenKey: string,
  allIds: string[],
): { ids: string[]; persistShortcuts: string[] | null; persistSeen: string[] | null } {
  const validIds = new Set(allIds);
  const storedRaw = readIdArray(storageKey);

  if (storedRaw === null) {
    return { ids: allIds.slice(0, SIDEBAR_SHORTCUT_LIMIT), persistShortcuts: null, persistSeen: null };
  }

  const stored = storedRaw.filter((id) => validIds.has(id)).slice(0, SIDEBAR_SHORTCUT_LIMIT);
  const seenRaw = readIdArray(seenKey);
  // No recorded baseline yet (a selection customized before this existed,
  // or the key was cleared) - treat everything already favourited/pinned
  // right now as already accounted for, so it is not bulk-added below.
  // Only ids favourited/pinned *after* this point count as new.
  const seen = new Set(seenRaw ?? allIds);

  const newIds = allIds.filter((id) => !seen.has(id));
  const ids = newIds.length ? fillRemainingSlots(stored, newIds) : stored;

  return {
    ids,
    persistShortcuts: sameIds(ids, stored) ? null : ids,
    // Ratchet the baseline forward whenever it's missing or stale, so every
    // currently favourited/pinned id is accounted for going forward -
    // whether it made it into the shortcut list (room available) or not
    // (already at the limit).
    persistSeen: seenRaw !== null && sameIds(seenRaw, allIds) ? null : allIds,
  };
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

  // Ids present at first render - `useRef`'s initial value is only ever
  // used once, so these stay fixed across later re-renders even though the
  // expression re-evaluates each time. See `seedSeenBaseline`.
  const mountFavoriteIds = useRef(favoriteSpaces.map((space) => space.id)).current;
  const mountPinnedIds = useRef(pinnedPages.map((page) => page.id)).current;
  useIsomorphicLayoutEffect(() => {
    seedSeenBaseline(FAVORITE_SIDEBAR_STORAGE_KEY, FAVORITE_SIDEBAR_SEEN_KEY, mountFavoriteIds);
    seedSeenBaseline(PINNED_SIDEBAR_STORAGE_KEY, PINNED_SIDEBAR_SEEN_KEY, mountPinnedIds);
    // Mount-only, deliberately: must run exactly once regardless of later
    // favoriteSpaces/pinnedPages changes, not re-run in reaction to them
    // the way `sync` below is.
  }, []);

  const sync = useCallback(() => {
    let persisted = false;

    const favoriteResult = resolveShortcutIds(
      FAVORITE_SIDEBAR_STORAGE_KEY,
      FAVORITE_SIDEBAR_SEEN_KEY,
      favoriteSpaces.map((space) => space.id),
    );
    // A functional update that returns the *same* reference back is a
    // no-op React bails out of - unlike always handing it a fresh array,
    // which would keep re-rendering (and, since this runs in a layout
    // effect keyed on `sync`, re-running this very effect) even once the
    // content has genuinely stopped changing. `favoriteSpaces`/
    // `pinnedPages` need not even be referentially stable across renders
    // for this to settle - only their id *content* has to.
    setSidebarFavoriteIds((current) => (sameIds(current, favoriteResult.ids) ? current : favoriteResult.ids));
    if (favoriteResult.persistShortcuts) {
      window.localStorage.setItem(FAVORITE_SIDEBAR_STORAGE_KEY, JSON.stringify(favoriteResult.persistShortcuts));
      persisted = true;
    }
    if (favoriteResult.persistSeen) {
      window.localStorage.setItem(FAVORITE_SIDEBAR_SEEN_KEY, JSON.stringify(favoriteResult.persistSeen));
    }

    const pinnedResult = resolveShortcutIds(
      PINNED_SIDEBAR_STORAGE_KEY,
      PINNED_SIDEBAR_SEEN_KEY,
      pinnedPages.map((page) => page.id),
    );
    setSidebarPinnedIds((current) => (sameIds(current, pinnedResult.ids) ? current : pinnedResult.ids));
    if (pinnedResult.persistShortcuts) {
      window.localStorage.setItem(PINNED_SIDEBAR_STORAGE_KEY, JSON.stringify(pinnedResult.persistShortcuts));
      persisted = true;
    }
    if (pinnedResult.persistSeen) {
      window.localStorage.setItem(PINNED_SIDEBAR_SEEN_KEY, JSON.stringify(pinnedResult.persistSeen));
    }

    // A top-up write changes what other mounted instances of this hook (the
    // sidebar itself, the profile page's "My Knowledge" tab, ...) should
    // show too - tell them. The next `sync()` this triggers sees no further
    // change (the write already happened), so this cannot loop.
    if (persisted) window.dispatchEvent(new Event(SIDEBAR_SHORTCUTS_EVENT));
  }, [favoriteSpaces, pinnedPages]);

  // Runs before the browser's next paint (see `useIsomorphicLayoutEffect`),
  // both on mount and whenever `favoriteSpaces`/`pinnedPages` change (e.g.
  // after a `router.refresh()`) - so the default (first-N) value the
  // server-rendered HTML necessarily shows is corrected to the real,
  // localStorage-backed one in the same commit React would otherwise have
  // painted that default in, rather than one or more frames later. The
  // previous `requestAnimationFrame` deferral here was exactly that visible
  // gap: long enough on a real page load to read as a flash of favourites/
  // pins appearing and then immediately being replaced.
  useIsomorphicLayoutEffect(() => {
    sync();
  }, [sync]);

  // Pick up a change made elsewhere: another tab (`storage`), another
  // component in this same tab (the custom event above), or the server
  // handing this hook a freshly favourited/pinned id (a new `favoriteSpaces`
  // / `pinnedPages` array - e.g. after a `router.refresh()`).
  useEffect(() => {
    window.addEventListener("storage", sync);
    window.addEventListener(SIDEBAR_SHORTCUTS_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(SIDEBAR_SHORTCUTS_EVENT, sync);
    };
  }, [sync]);

  const toggleSidebarShortcut = useCallback(
    (collection: SidebarShortcutCollection, id: string) => {
      const storageKey = storageKeyFor(collection);
      const seenKey = seenKeyFor(collection);
      const setIds = collection === "favorites" ? setSidebarFavoriteIds : setSidebarPinnedIds;
      const allIds = (collection === "favorites" ? favoriteSpaces : pinnedPages).map((item) => item.id);
      setIds((current) => {
        const next = current.includes(id)
          ? current.filter((currentId) => currentId !== id)
          : current.length < SIDEBAR_SHORTCUT_LIMIT
            ? [...current, id]
            : current;
        window.localStorage.setItem(storageKey, JSON.stringify(next));
        // First-ever customization of this list: everything favourited/
        // pinned up to this moment is the baseline "already known" set, so
        // only items favourited/pinned after this point are ever treated as
        // new by the top-up in `sync`.
        if (window.localStorage.getItem(seenKey) === null) {
          window.localStorage.setItem(seenKey, JSON.stringify(allIds));
        }
        window.dispatchEvent(new Event(SIDEBAR_SHORTCUTS_EVENT));
        return next;
      });
    },
    [favoriteSpaces, pinnedPages],
  );

  return { sidebarFavoriteIds, sidebarPinnedIds, toggleSidebarShortcut };
}
