/**
 * `useSidebarShortcuts`: which favourites/pinned pages show as sidebar
 * shortcuts.
 *
 * Regression coverage for a reported bug: a space freshly added to
 * favourites (with the sidebar's shortcut list already under its 5-item
 * limit) never appeared in the sidebar - the stored selection was read back
 * exactly as saved, with no way for a favourite that did not exist yet at
 * the last customization to ever get in. `resolveShortcutIds`'s "seen ids"
 * baseline is the fix: an under-the-limit selection gets topped up with
 * favourited/pinned items that are not yet in that baseline, computed fresh
 * on every sync (mount, storage event, or the server handing over a new
 * `favoriteSpaces`/`pinnedPages` array) rather than only in reaction to a
 * change observed while some component happened to stay mounted - so it
 * survives a navigation or reload, too. Ids the user deliberately removed
 * are folded into the baseline at removal time, so a removal made while
 * under the limit is never immediately handed back.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  FAVORITE_SIDEBAR_STORAGE_KEY,
  SIDEBAR_SHORTCUT_LIMIT,
  useSidebarShortcuts,
} from "@/lib/sidebar-shortcuts";
import type { Space } from "@/types/api";

function space(id: string): Space {
  return { id, key: id.toUpperCase(), name: `Space ${id}` } as Space;
}

afterEach(() => {
  window.localStorage.clear();
});

describe("useSidebarShortcuts favourites", () => {
  it("defaults to the first N favourites when nothing has ever been customized", async () => {
    const spaces = ["a", "b", "c"].map(space);
    const { result } = renderHook(() => useSidebarShortcuts(spaces, []));

    await waitFor(() =>
      expect(result.current.sidebarFavoriteIds).toEqual(["a", "b", "c"]),
    );
  });

  it("tops up an under-the-limit customized selection with a newly favourited space", async () => {
    // Customized down to 2 of the (then) 3 favourites.
    window.localStorage.setItem(
      FAVORITE_SIDEBAR_STORAGE_KEY,
      JSON.stringify(["a", "b"]),
    );
    const initialSpaces = ["a", "b", "c"].map(space);
    const { result, rerender } = renderHook(
      ({ spaces }) => useSidebarShortcuts(spaces, []),
      { initialProps: { spaces: initialSpaces } },
    );

    await waitFor(() =>
      expect(result.current.sidebarFavoriteIds).toEqual(["a", "b"]),
    );

    // A new space gets favourited elsewhere - the same shape of update a
    // `router.refresh()` after starring something produces.
    rerender({ spaces: [...initialSpaces, space("d")] });

    await waitFor(() =>
      expect(result.current.sidebarFavoriteIds).toEqual(["a", "b", "d"]),
    );
    // Persisted too, so a reload sees the filled selection.
    expect(
      JSON.parse(window.localStorage.getItem(FAVORITE_SIDEBAR_STORAGE_KEY) ?? "[]"),
    ).toEqual(["a", "b", "d"]);
  });

  it("does not top up a selection that is already at the limit", async () => {
    const fiveIds = ["a", "b", "c", "d", "e"];
    window.localStorage.setItem(
      FAVORITE_SIDEBAR_STORAGE_KEY,
      JSON.stringify(fiveIds),
    );
    const initialSpaces = fiveIds.map(space);
    const { result, rerender } = renderHook(
      ({ spaces }) => useSidebarShortcuts(spaces, []),
      { initialProps: { spaces: initialSpaces } },
    );

    await waitFor(() =>
      expect(result.current.sidebarFavoriteIds).toEqual(fiveIds),
    );

    rerender({ spaces: [...initialSpaces, space("f")] });

    // Give the top-up effect a chance to (not) run.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(result.current.sidebarFavoriteIds).toEqual(fiveIds);
  });

  it("does not immediately hand back a shortcut just removed while under the limit", async () => {
    const spaces = ["a", "b", "c"].map(space);
    const { result } = renderHook(() => useSidebarShortcuts(spaces, []));

    await waitFor(() =>
      expect(result.current.sidebarFavoriteIds).toEqual(["a", "b", "c"]),
    );

    act(() => {
      result.current.toggleSidebarShortcut("favorites", "b");
    });

    // The removal must stick - `favoriteSpaces` itself did not change, so
    // nothing should re-run the top-up and put "b" straight back even
    // though there is now room for it under the limit.
    await waitFor(() =>
      expect(result.current.sidebarFavoriteIds).toEqual(["a", "c"]),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(result.current.sidebarFavoriteIds).toEqual(["a", "c"]);
  });

  it("tops back up from an explicitly cleared selection once something new is favourited", async () => {
    window.localStorage.setItem(FAVORITE_SIDEBAR_STORAGE_KEY, JSON.stringify([]));
    const initialSpaces = ["a", "b"].map(space);
    const { result, rerender } = renderHook(
      ({ spaces }) => useSidebarShortcuts(spaces, []),
      { initialProps: { spaces: initialSpaces } },
    );

    await waitFor(() => expect(result.current.sidebarFavoriteIds).toEqual([]));

    rerender({ spaces: [...initialSpaces, space("c")] });

    await waitFor(() =>
      expect(result.current.sidebarFavoriteIds).toEqual(["c"]),
    );
  });

  it("never exceeds SIDEBAR_SHORTCUT_LIMIT even when many new favourites arrive at once", async () => {
    window.localStorage.setItem(
      FAVORITE_SIDEBAR_STORAGE_KEY,
      JSON.stringify(["a"]),
    );
    const initialSpaces = ["a"].map(space);
    const { result, rerender } = renderHook(
      ({ spaces }) => useSidebarShortcuts(spaces, []),
      { initialProps: { spaces: initialSpaces } },
    );

    await waitFor(() => expect(result.current.sidebarFavoriteIds).toEqual(["a"]));

    rerender({
      spaces: ["a", "b", "c", "d", "e", "f", "g"].map(space),
    });

    await waitFor(() =>
      expect(result.current.sidebarFavoriteIds).toHaveLength(SIDEBAR_SHORTCUT_LIMIT),
    );
    expect(result.current.sidebarFavoriteIds).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("never renders the pre-customization default even for a single frame - no flash on mount", () => {
    // Customized down to just "b", of the 3 favourites that exist.
    window.localStorage.setItem(FAVORITE_SIDEBAR_STORAGE_KEY, JSON.stringify(["b"]));
    const { result } = renderHook(() =>
      useSidebarShortcuts(["a", "b", "c"].map(space), []),
    );

    // Checked synchronously, with no `waitFor`/`act` tick in between: a
    // regression here (e.g. reverting the sync effect to a
    // `requestAnimationFrame`-deferred one) would still show the
    // uncustomized default (["a", "b", "c"]) at this point, only correcting
    // to ["b"] a frame later - the flash this hook must not produce.
    expect(result.current.sidebarFavoriteIds).toEqual(["b"]);
  });

  it("tops up a newly favourited space across a fresh mount, not only while the same instance stays mounted", async () => {
    // A prior session already customized the list down to "a" and recorded
    // "a" and "b" as accounted for (nothing new to add back then).
    window.localStorage.setItem(FAVORITE_SIDEBAR_STORAGE_KEY, JSON.stringify(["a"]));
    window.localStorage.setItem(
      "wikihub:sidebar-favourite-space-seen-ids",
      JSON.stringify(["a", "b"]),
    );

    // Later - after that session ended entirely - "c" gets favourited, and
    // the sidebar (a brand new component instance, e.g. after a navigation
    // or a page reload) mounts straight into a world where "c" already
    // exists. It should not need to observe "c" arrive live to show it.
    const { result } = renderHook(() =>
      useSidebarShortcuts(["a", "b", "c"].map(space), []),
    );

    await waitFor(() =>
      expect(result.current.sidebarFavoriteIds).toEqual(["a", "c"]),
    );
  });
});
