"use client";

import * as React from "react";

/**
 * The app's configurable keyboard shortcuts: one registry of what can be
 * bound, plus a localStorage-backed store of the user's overrides.
 *
 * Handlers never compare `event.key` themselves. They ask this module whether
 * an event matches an action, so a rebound shortcut takes effect everywhere at
 * once and the settings UI has a single list to render.
 */

// -- binding format ---------------------------------------------------------
//
// A binding is a normalised string: modifiers in a fixed order, then the key -
// "Mod+K", "Mod+Shift+F", "Space". `Mod` is Ctrl on Windows/Linux and Cmd on
// macOS, and (matching what every handler in this app already did) either one
// satisfies it on either platform.

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "OS"]);

type KeyChord = Pick<
  KeyboardEvent,
  "code" | "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
>;

/**
 * The key half of a binding, taken from `event.code` where that is stable.
 *
 * `event.key` alone is not: holding Alt on macOS turns "f" into "ƒ", and
 * Shift+1 into "!", so the same physical chord would record and match as two
 * different strings. Letters and digits therefore come from `code`, which is
 * layout-position based and unaffected by modifiers; everything else falls
 * back to `key`, where the name is already stable ("Enter", "ArrowUp", "F3").
 */
function keyToken(event: Pick<KeyboardEvent, "code" | "key">): string | null {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  if (event.code === "Space" || event.key === " ") return "Space";
  if (MODIFIER_KEYS.has(event.key)) return null;
  if (event.key.length === 1) return event.key.toUpperCase();
  return event.key;
}

/**
 * The binding a keydown represents, or null when only modifiers are held.
 *
 * Recording in the settings UI and matching at the handler both go through
 * here, so the two can never disagree about how a chord is spelled.
 */
export function eventToBinding(event: KeyChord): string | null {
  const token = keyToken(event);
  if (token === null) return null;
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("Mod");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(token);
  return parts.join("+");
}

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
}

const MAC_SYMBOLS: Record<string, string> = {
  Mod: "⌘",
  Alt: "⌥",
  Shift: "⇧",
  Enter: "↵",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/** A binding written the way this platform's users expect to read it. */
export function formatBinding(binding: string): string {
  const mac = isMacPlatform();
  return binding
    .split("+")
    .map((part) => {
      if (part === "Mod") return mac ? MAC_SYMBOLS.Mod : "Ctrl";
      if (part === "Escape") return "Esc";
      if (mac && MAC_SYMBOLS[part]) return MAC_SYMBOLS[part];
      return part;
    })
    .join(mac ? "" : "+");
}

// -- the registry -----------------------------------------------------------

/**
 * Where a shortcut applies. Two actions may share a binding across different
 * scopes on purpose - Mod+F opens site search globally, but means "find in
 * this file" while an attachment preview is open, and the narrower scope wins.
 * Only a clash *within* one scope is a genuine conflict.
 */
export type ShortcutScope = "global" | "editor" | "preview";

export interface ShortcutAction {
  id: string;
  label: string;
  description: string;
  scope: ShortcutScope;
  group: string;
  defaultBindings: string[];
}

export const SHORTCUT_SCOPE_LABELS: Record<ShortcutScope, string> = {
  global: "Anywhere in the app",
  editor: "While editing a page",
  preview: "While an attachment preview is open",
};

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  {
    id: "search.open",
    label: "Open quick search",
    description: "Opens the search bar over whatever you are looking at.",
    scope: "global",
    group: "Navigation",
    defaultBindings: ["Mod+K", "Mod+F"],
  },
  {
    id: "page.save",
    label: "Save page",
    description: "Saves the page you are editing, when it has unsaved changes.",
    scope: "editor",
    group: "Editing",
    defaultBindings: ["Mod+S"],
  },
  {
    id: "page.reload",
    label: "Reload page content",
    description: "Discards the local draft and reloads the saved page.",
    scope: "editor",
    group: "Editing",
    defaultBindings: ["Mod+R"],
  },
  {
    id: "attachment.find",
    label: "Find in previewed file",
    description:
      "Focuses the find box in a text attachment's preview. Takes precedence over quick search while that preview is open.",
    scope: "preview",
    group: "Attachment previews",
    defaultBindings: ["Mod+F"],
  },
  {
    id: "video.playPause",
    label: "Play / pause video",
    description: "Toggles playback in a video attachment's preview.",
    scope: "preview",
    group: "Attachment previews",
    defaultBindings: ["Space"],
  },
];

const ACTIONS_BY_ID = new Map(SHORTCUT_ACTIONS.map((action) => [action.id, action]));

export type ShortcutOverrides = Record<string, string[]>;

// -- the store --------------------------------------------------------------

const STORAGE_KEY = "wikihub:keyboard-shortcuts";

/** Parsed overrides, recomputed only when the raw string actually changes. */
let cachedRaw: string | null = null;
let cachedOverrides: ShortcutOverrides = {};

const EMPTY_OVERRIDES: ShortcutOverrides = {};

function readOverrides(): ShortcutOverrides {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return EMPTY_OVERRIDES;
  }
  if (raw === null) return EMPTY_OVERRIDES;
  // `useSyncExternalStore` compares snapshots by identity and re-renders in a
  // loop if a fresh object comes back every time, so hold on to the last parse.
  if (raw === cachedRaw) return cachedOverrides;

  let result: ShortcutOverrides = EMPTY_OVERRIDES;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const collected: ShortcutOverrides = {};
      for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
        // Drop entries for actions this build no longer has, so a stale
        // localStorage payload cannot resurrect a removed shortcut.
        if (!ACTIONS_BY_ID.has(id) || !Array.isArray(value)) continue;
        collected[id] = value.filter((item): item is string => typeof item === "string");
      }
      result = collected;
    }
  } catch {
    // Corrupt payload: fall back to the defaults rather than throwing on a
    // keypress. It is rewritten as soon as the user changes anything.
    result = EMPTY_OVERRIDES;
  }
  cachedRaw = raw;
  cachedOverrides = result;
  return result;
}

const store = {
  subscribe(onChange: () => void): () => void {
    window.addEventListener("storage", onChange);
    window.addEventListener(STORAGE_KEY, onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener(STORAGE_KEY, onChange);
    };
  },
  getSnapshot(): ShortcutOverrides {
    return readOverrides();
  },
  // The server cannot know a preference kept in localStorage; render the
  // defaults and let the first client render correct them.
  getServerSnapshot(): ShortcutOverrides {
    return EMPTY_OVERRIDES;
  },
  write(overrides: ShortcutOverrides): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    } catch {
      // The preference simply does not persist; the UI still works.
    }
    // `storage` only fires in *other* tabs, so notify this one explicitly.
    window.dispatchEvent(new Event(STORAGE_KEY));
  },
};

/** The bindings in force for one action, overrides applied. */
export function bindingsFor(actionId: string, overrides: ShortcutOverrides): string[] {
  return overrides[actionId] ?? ACTIONS_BY_ID.get(actionId)?.defaultBindings ?? [];
}

/**
 * Read the current bindings without subscribing.
 *
 * For keydown handlers, which need the value at the moment a key is pressed
 * rather than a re-render when it changes.
 */
export function currentBindings(actionId: string): string[] {
  if (typeof window === "undefined") {
    return ACTIONS_BY_ID.get(actionId)?.defaultBindings ?? [];
  }
  return bindingsFor(actionId, readOverrides());
}

/** Whether a keydown triggers `actionId` under the bindings in force now. */
export function matchesShortcut(actionId: string, event: KeyChord): boolean {
  const binding = eventToBinding(event);
  if (binding === null) return false;
  return currentBindings(actionId).includes(binding);
}

export function setBindings(actionId: string, bindings: string[]): void {
  const action = ACTIONS_BY_ID.get(actionId);
  if (!action) return;
  const overrides = { ...readOverrides() };
  const isDefault =
    bindings.length === action.defaultBindings.length &&
    bindings.every((binding, index) => binding === action.defaultBindings[index]);
  // Storing a value identical to the default would freeze today's default in
  // place; drop the entry so the action keeps following the registry.
  if (isDefault) delete overrides[actionId];
  else overrides[actionId] = bindings;
  store.write(overrides);
}

export function resetAllShortcuts(): void {
  store.write({});
}

/** Subscribe to the user's overrides. For settings UI, not for handlers. */
export function useShortcutOverrides(): ShortcutOverrides {
  return React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
}

/** The bindings for one action, re-rendering when they change. */
export function useShortcutBindings(actionId: string): string[] {
  return bindingsFor(actionId, useShortcutOverrides());
}

/**
 * Actions sharing a binding within one scope, as `binding -> action ids`.
 *
 * Cross-scope repeats are left out: a preview-scoped shortcut deliberately
 * shadows a global one while that preview is open.
 */
export function findConflicts(overrides: ShortcutOverrides): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  for (const action of SHORTCUT_ACTIONS) {
    for (const binding of bindingsFor(action.id, overrides)) {
      const key = `${action.scope} ${binding}`;
      const existing = seen.get(key);
      if (existing) existing.push(action.id);
      else seen.set(key, [action.id]);
    }
  }
  const conflicts = new Map<string, string[]>();
  for (const [key, ids] of seen) {
    if (ids.length < 2) continue;
    conflicts.set(key.split(" ")[1]!, ids);
  }
  return conflicts;
}
