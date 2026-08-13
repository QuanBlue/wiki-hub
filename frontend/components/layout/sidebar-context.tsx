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
const WIDTH_STORAGE_KEY = "wikihub:sidebar-width";
const COLLAPSED_COOKIE = "wikihub_sidebar_collapsed";
const WIDTH_COOKIE = "wikihub_sidebar_width";
const DEFAULT_SIDEBAR_WIDTH = 256;
const MAX_SIDEBAR_WIDTH = 520;

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
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored !== null) return stored === "true";
    } catch {
      // Fall back to the server-provided preference below.
    }
    return document.documentElement.dataset.whSidebarCollapsed === "true";
  },
  // The server cannot know the preference; render expanded and let the first
  // client render correct it.
  getServerSnapshot(): boolean {
    if (typeof document !== "undefined") {
      return document.documentElement.dataset.whSidebarCollapsed === "true";
    }
    return false;
  },
  set(value: boolean): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // The preference simply does not persist; the UI still works.
    }
    document.cookie = `${COLLAPSED_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.dataset.whSidebarCollapsed = String(value);
    // `storage` only fires in *other* tabs, so notify this one explicitly.
    window.dispatchEvent(new Event(STORAGE_KEY));
  },
};

const widthStore = {
  subscribe(onChange: () => void): () => void {
    window.addEventListener("storage", onChange);
    window.addEventListener(WIDTH_STORAGE_KEY, onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener(WIDTH_STORAGE_KEY, onChange);
    };
  },
  getSnapshot(): number {
    try {
      const stored = window.localStorage.getItem(WIDTH_STORAGE_KEY);
      if (stored !== null) {
        const value = Number(stored);
        if (Number.isFinite(value)) {
          return Math.min(MAX_SIDEBAR_WIDTH, Math.max(0, value));
        }
      }
    } catch {
      // Fall through to the default width.
    }
    const preloaded = Number.parseFloat(
      document.documentElement.style.getPropertyValue(
        "--wh-preloaded-sidebar-width",
      ),
    );
    if (Number.isFinite(preloaded)) {
      return Math.min(MAX_SIDEBAR_WIDTH, Math.max(0, preloaded));
    }
    return DEFAULT_SIDEBAR_WIDTH;
  },
  getServerSnapshot(): number {
    return DEFAULT_SIDEBAR_WIDTH;
  },
  set(value: number): void {
    const width = Math.min(MAX_SIDEBAR_WIDTH, Math.max(0, value));
    try {
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(width));
    } catch {
      // The preference simply does not persist; the UI still works.
    }
    document.cookie = `${WIDTH_COOKIE}=${width}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.style.setProperty(
      "--wh-preloaded-sidebar-width",
      `${width}px`,
    );
    window.dispatchEvent(new Event(WIDTH_STORAGE_KEY));
  },
};

interface SidebarState {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

const SidebarContext = React.createContext<SidebarState | null>(null);

export function SidebarProvider({
  children,
  initialCollapsed = false,
  initialSidebarWidth = DEFAULT_SIDEBAR_WIDTH,
}: {
  children: React.ReactNode;
  initialCollapsed?: boolean;
  initialSidebarWidth?: number;
}) {
  const collapsed = React.useSyncExternalStore(
    collapsedStore.subscribe,
    collapsedStore.getSnapshot,
    () => {
      return initialCollapsed;
    },
  );
  const sidebarWidth = React.useSyncExternalStore(
    widthStore.subscribe,
    widthStore.getSnapshot,
    () => initialSidebarWidth,
  );
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    document.documentElement.dataset.whSidebarHydrated = "true";
  }, []);

  const setCollapsed = React.useCallback((value: boolean) => {
    if (!value && widthStore.getSnapshot() <= 56) {
      widthStore.set(DEFAULT_SIDEBAR_WIDTH);
    }
    collapsedStore.set(value);
  }, []);

  const toggleCollapsed = React.useCallback(() => {
    const next = !collapsedStore.getSnapshot();
    if (!next && widthStore.getSnapshot() <= 56) {
      widthStore.set(DEFAULT_SIDEBAR_WIDTH);
    }
    collapsedStore.set(next);
  }, []);

  const setSidebarWidth = React.useCallback((width: number) => {
    widthStore.set(width);
  }, []);

  const value = React.useMemo(
    () => ({
      collapsed,
      setCollapsed,
      toggleCollapsed,
      sidebarWidth,
      setSidebarWidth,
      mobileOpen,
      setMobileOpen,
    }),
    [
      collapsed,
      setCollapsed,
      toggleCollapsed,
      sidebarWidth,
      setSidebarWidth,
      mobileOpen,
    ],
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
