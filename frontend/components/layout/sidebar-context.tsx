"use client";

import * as React from "react";

/**
 * Sidebar open/closed state, shared between the top bar's toggle, the sidebar
 * itself and the main content column (which has to shift its left padding).
 *
 * Two independent states, because the sidebar means different things per
 * breakpoint:
 *
 * - `collapsed` (>= md): the rail stays visible but shrinks to icons only.
 *   Persisted, because it is a preference.
 * - `mobileOpen` (< md): the rail is absent entirely and slides in as an
 *   overlay drawer. Deliberately NOT persisted — nobody wants to land on a page
 *   with a drawer already covering it.
 *
 * Collapsing them into one boolean reads as a simplification but behaves badly:
 * closing the drawer on a phone would leave the desktop layout collapsed after
 * a rotate or resize.
 */

const STORAGE_KEY = "wikihub:sidebar-collapsed";

/**
 * localStorage exposed as an external store.
 *
 * The obvious alternative — `useState` plus an effect that reads storage on
 * mount — is what React 19's `react-hooks/set-state-in-effect` rule rejects,
 * and it also renders one frame with the wrong value. `useSyncExternalStore`
 * reads the real value during render on the client and the server snapshot
 * during SSR, so hydration stays consistent. The `storage` event subscription
 * is a free bonus: collapsing the sidebar in one tab updates the others.
 */
const collapsedStore = {
  subscribe(onChange: () => void): () => void {
    window.addEventListener("storage", onChange);
    window.addEventListener(STORAGE_KEY, onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener(STORAGE_KEY, onChange);
    };
  },
  getSnapshot(): boolean {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      // Private mode or a blocked storage partition: fall back to expanded.
      return false;
    }
  },
  // The server cannot know the preference; render expanded and let the first
  // client render correct it.
  getServerSnapshot(): boolean {
    return false;
  },
  set(value: boolean): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // The preference simply does not persist; the UI still works.
    }
    // `storage` only fires in *other* tabs, so notify this one explicitly.
    window.dispatchEvent(new Event(STORAGE_KEY));
  },
};

interface SidebarState {
  collapsed: boolean;
  toggleCollapsed: () => void;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

const SidebarContext = React.createContext<SidebarState | null>(null);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const collapsed = React.useSyncExternalStore(
    collapsedStore.subscribe,
    collapsedStore.getSnapshot,
    collapsedStore.getServerSnapshot,
  );
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const toggleCollapsed = React.useCallback(() => {
    collapsedStore.set(!collapsedStore.getSnapshot());
  }, []);

  const value = React.useMemo(
    () => ({ collapsed, toggleCollapsed, mobileOpen, setMobileOpen }),
    [collapsed, toggleCollapsed, mobileOpen],
  );

  return (
    <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarState {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used inside <SidebarProvider>.");
  }
  return context;
}
