"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * `false` during server rendering and the hydration pass, `true` afterwards.
 *
 * Use it to defer rendering anything that depends on browser-only state (theme,
 * locale, `window`), so the server and client produce identical initial markup.
 * Preferred over the `useState` + `useEffect` idiom, which triggers a cascading
 * render that React 19 flags.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
