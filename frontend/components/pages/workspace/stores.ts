"use client";

import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  SPACE_SIDEBAR_WIDTH_COOKIE,
  SPACE_SIDEBAR_WIDTH_KEY,
} from "./types";

const SAVED_PAGE_KEYS_STORAGE = "wikihub:saved-page-keys";
const SAVED_PAGE_KEYS_EVENT = "wikihub:saved-pages-changed";
let savedPageKeysSnapshot: string[] = [];
export const EMPTY_SAVED_PAGE_KEYS: string[] = [];

export function getSavedPageKeys(): string[] {
  if (typeof window === "undefined") return savedPageKeysSnapshot;

  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(SAVED_PAGE_KEYS_STORAGE) ?? "[]",
    );
    const nextKeys = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
    if (
      nextKeys.length === savedPageKeysSnapshot.length &&
      nextKeys.every((key, index) => key === savedPageKeysSnapshot[index])
    ) {
      return savedPageKeysSnapshot;
    }
    savedPageKeysSnapshot = nextKeys;
    return savedPageKeysSnapshot;
  } catch {
    return savedPageKeysSnapshot;
  }
}

export function subscribeToSavedPages(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(SAVED_PAGE_KEYS_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(SAVED_PAGE_KEYS_EVENT, onStoreChange);
  };
}

export function savePageKeys(keys: string[]) {
  savedPageKeysSnapshot = keys;
  try {
    window.localStorage.setItem(SAVED_PAGE_KEYS_STORAGE, JSON.stringify(keys));
  } catch {
    // The current session can still reflect the saved state if storage is unavailable.
  }
  window.dispatchEvent(new Event(SAVED_PAGE_KEYS_EVENT));
}

export function clampWidth(value: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, value));
}

export const spaceSidebarWidthStore = {
  subscribe(onChange: () => void): () => void {
    window.addEventListener("storage", onChange);
    window.addEventListener(SPACE_SIDEBAR_WIDTH_KEY, onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener(SPACE_SIDEBAR_WIDTH_KEY, onChange);
    };
  },
  getSnapshot(): number {
    try {
      const stored = window.localStorage.getItem(SPACE_SIDEBAR_WIDTH_KEY);
      if (stored !== null) {
        const value = Number(stored);
        if (Number.isFinite(value)) {
          return clampWidth(value);
        }
      }
    } catch {
      // Ignore blocked storage; resizing still works for the current render.
    }
    const preloaded = Number.parseFloat(
      document.documentElement.style.getPropertyValue(
        "--wh-preloaded-space-sidebar-width",
      ),
    );
    if (Number.isFinite(preloaded)) return clampWidth(preloaded);
    return DEFAULT_SIDEBAR_WIDTH;
  },
  set(value: number): void {
    const width = clampWidth(value);
    try {
      window.localStorage.setItem(SPACE_SIDEBAR_WIDTH_KEY, String(width));
    } catch {
      // The preference simply does not persist.
    }
    document.cookie = `${SPACE_SIDEBAR_WIDTH_COOKIE}=${width}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.style.setProperty(
      "--wh-preloaded-space-sidebar-width",
      `${width}px`,
    );
    window.dispatchEvent(new Event(SPACE_SIDEBAR_WIDTH_KEY));
  },
};
