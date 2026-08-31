import { beforeEach, describe, expect, it } from "vitest";

import {
  SHORTCUT_ACTIONS,
  bindingsFor,
  currentBindings,
  eventToBinding,
  findConflicts,
  formatBinding,
  matchesShortcut,
  resetAllShortcuts,
  setBindings,
} from "@/lib/keyboard-shortcuts";

/**
 * A keydown as the DOM reports it. `code` is what the module keys off for
 * letters and digits, so the tests have to supply both halves the way a real
 * event does - including the cases where they disagree.
 */
function chord(
  code: string,
  key: string,
  modifiers: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {},
) {
  return {
    code,
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  resetAllShortcuts();
});

describe("eventToBinding", () => {
  it("spells a plain chord with modifiers in a fixed order", () => {
    expect(eventToBinding(chord("KeyK", "k", { ctrlKey: true }))).toBe("Mod+K");
    expect(
      eventToBinding(chord("KeyF", "F", { ctrlKey: true, shiftKey: true, altKey: true })),
    ).toBe("Mod+Alt+Shift+F");
  });

  it("treats Ctrl and Cmd as the same modifier", () => {
    expect(eventToBinding(chord("KeyK", "k", { metaKey: true }))).toBe(
      eventToBinding(chord("KeyK", "k", { ctrlKey: true })),
    );
  });

  it("takes letters from `code`, so a modifier cannot change the spelling", () => {
    // macOS reports Alt+F as "ƒ" and Shift+1 as "!" in `event.key`; both must
    // still record and match as the plain key they sit on.
    expect(eventToBinding(chord("KeyF", "ƒ", { altKey: true }))).toBe("Alt+F");
    expect(eventToBinding(chord("Digit1", "!", { shiftKey: true }))).toBe("Shift+1");
  });

  it("names Space and keeps other named keys as-is", () => {
    expect(eventToBinding(chord("Space", " "))).toBe("Space");
    expect(eventToBinding(chord("Enter", "Enter", { ctrlKey: true }))).toBe("Mod+Enter");
    expect(eventToBinding(chord("ArrowUp", "ArrowUp"))).toBe("ArrowUp");
  });

  it("is null while only modifiers are held", () => {
    expect(eventToBinding(chord("ControlLeft", "Control", { ctrlKey: true }))).toBeNull();
    expect(eventToBinding(chord("ShiftLeft", "Shift", { shiftKey: true }))).toBeNull();
  });
});

describe("formatBinding", () => {
  it("writes Mod as Ctrl off macOS", () => {
    expect(formatBinding("Mod+K")).toBe("Ctrl+K");
    expect(formatBinding("Mod+Shift+F")).toBe("Ctrl+Shift+F");
    expect(formatBinding("Space")).toBe("Space");
  });
});

describe("matchesShortcut", () => {
  it("matches every binding an action carries by default", () => {
    expect(matchesShortcut("search.open", chord("KeyK", "k", { ctrlKey: true }))).toBe(true);
    expect(matchesShortcut("search.open", chord("KeyF", "f", { ctrlKey: true }))).toBe(true);
    expect(matchesShortcut("search.open", chord("KeyJ", "j", { ctrlKey: true }))).toBe(false);
    // The bare letter is not the shortcut - the modifier is part of it.
    expect(matchesShortcut("search.open", chord("KeyK", "k"))).toBe(false);
  });

  it("follows a rebinding instead of the default", () => {
    setBindings("page.save", ["Mod+Shift+S"]);
    expect(matchesShortcut("page.save", chord("KeyS", "s", { ctrlKey: true }))).toBe(false);
    expect(
      matchesShortcut("page.save", chord("KeyS", "s", { ctrlKey: true, shiftKey: true })),
    ).toBe(true);
  });

  it("stops matching an action whose bindings were all removed", () => {
    setBindings("video.playPause", []);
    expect(matchesShortcut("video.playPause", chord("Space", " "))).toBe(false);
  });

  it("is false for an action that does not exist", () => {
    expect(matchesShortcut("nope.missing", chord("KeyK", "k", { ctrlKey: true }))).toBe(false);
  });
});

describe("persistence", () => {
  it("keeps an override across a fresh read", () => {
    setBindings("page.save", ["Mod+Alt+S"]);
    expect(currentBindings("page.save")).toEqual(["Mod+Alt+S"]);
  });

  it("stores nothing when the value equals the default, so defaults stay live", () => {
    const action = SHORTCUT_ACTIONS.find((item) => item.id === "search.open")!;
    setBindings("search.open", [...action.defaultBindings]);
    expect(window.localStorage.getItem("wikihub:keyboard-shortcuts")).toBe("{}");
  });

  it("resets everything back to the registry", () => {
    setBindings("page.save", ["Mod+Alt+S"]);
    setBindings("page.reload", ["F5"]);
    resetAllShortcuts();
    expect(currentBindings("page.save")).toEqual(["Mod+S"]);
    expect(currentBindings("page.reload")).toEqual(["Mod+R"]);
  });

  it("ignores a corrupt payload rather than throwing on a keypress", () => {
    window.localStorage.setItem("wikihub:keyboard-shortcuts", "{not json");
    expect(currentBindings("page.save")).toEqual(["Mod+S"]);
    expect(matchesShortcut("page.save", chord("KeyS", "s", { ctrlKey: true }))).toBe(true);
  });

  it("drops entries for actions this build no longer has", () => {
    window.localStorage.setItem(
      "wikihub:keyboard-shortcuts",
      JSON.stringify({ "removed.action": ["Mod+Q"], "page.save": ["Mod+Alt+S"] }),
    );
    expect(currentBindings("page.save")).toEqual(["Mod+Alt+S"]);
    expect(matchesShortcut("removed.action", chord("KeyQ", "q", { ctrlKey: true }))).toBe(
      false,
    );
  });
});

describe("findConflicts", () => {
  it("reports nothing for the shipped defaults", () => {
    // Mod+F is deliberately on both quick search and find-in-file, but those
    // sit in different scopes, so it is not a conflict.
    expect([...findConflicts({}).keys()]).toEqual([]);
  });

  it("reports two actions sharing a binding inside one scope", () => {
    const overrides = { "page.reload": ["Mod+S"] };
    const conflicts = findConflicts(overrides);
    expect(conflicts.get("Mod+S")).toEqual(["page.save", "page.reload"]);
  });

  it("does not report a repeat across different scopes", () => {
    // "Find in previewed file" (preview) taking the editor's save chord does
    // not clash with it: only one of the two scopes is ever active.
    const conflicts = findConflicts({ "attachment.find": ["Mod+S"] });
    expect(conflicts.has("Mod+S")).toBe(false);
  });
});

describe("bindingsFor", () => {
  it("prefers an override and falls back to the default", () => {
    expect(bindingsFor("page.save", {})).toEqual(["Mod+S"]);
    expect(bindingsFor("page.save", { "page.save": ["F2"] })).toEqual(["F2"]);
    expect(bindingsFor("unknown.action", {})).toEqual([]);
  });
});
