export const CHEAT_SHEET_OPEN_EVENT = "wikihub:cheat-sheet-open";
export const SEARCH_OPEN_EVENT = "wikihub:search-open";

export type CheatSheetTab = "shortcuts" | "search" | "editor" | "features";

export interface CheatSheetOpenDetail {
  initialTab?: CheatSheetTab;
}

export interface SearchOpenDetail {
  query?: string;
}

/** Open the Quick Shortcuts & Feature Cheat Sheet modal. */
export function openCheatSheet(detail: CheatSheetOpenDetail = {}): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CHEAT_SHEET_OPEN_EVENT, { detail }));
  }
}

/** Trigger opening the global search modal, optionally with a pre-filled query. */
export function triggerOpenSearch(detail: SearchOpenDetail = {}): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SEARCH_OPEN_EVENT, { detail }));
  }
}
