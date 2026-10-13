import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { ShortcutSettings } from "@/components/account/shortcut-settings";
import { bindingsFor, resetAllShortcuts, setBindings } from "@/lib/keyboard-shortcuts";

function press(init: KeyboardEventInit) {
  act(() => {
    fireEvent.keyDown(window, init);
  });
}

beforeEach(() => {
  act(() => resetAllShortcuts());
});

describe("ShortcutSettings", () => {
  it("lists every action grouped, with defaults and no reset available", () => {
    render(<ShortcutSettings />);
    expect(screen.getByText("Keyboard shortcuts")).toBeInTheDocument();
    expect(screen.getByText("Open quick search")).toBeInTheDocument();
    expect(screen.getByText("Play / pause video")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset all to defaults" })).toBeDisabled();
    expect(screen.queryByText(/shortcuts? (is|are)/)).not.toBeInTheDocument();
  });

  it("records a new chord for an existing binding", async () => {
    const actor = userEvent.setup();
    render(<ShortcutSettings />);

    await actor.click(screen.getByRole("button", { name: "Change shortcut for Save page" }));
    expect(screen.getByText("Press keys…")).toBeInTheDocument();
    // A modifier alone keeps waiting.
    press({ key: "Control", code: "ControlLeft", ctrlKey: true });
    expect(screen.getByText("Press keys…")).toBeInTheDocument();
    press({ key: "j", code: "KeyJ", ctrlKey: true });

    expect(bindingsFor("page.save", { "page.save": ["Mod+J"] })).toEqual(["Mod+J"]);
    expect(screen.queryByText("Press keys…")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset all to defaults" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reset Save page to its default shortcut" })).toBeInTheDocument();
  });

  it("cancels recording with Escape or by clicking the chord again", async () => {
    const actor = userEvent.setup();
    render(<ShortcutSettings />);
    const change = screen.getByRole("button", { name: "Change shortcut for Save page" });

    await actor.click(change);
    press({ key: "Escape", code: "Escape" });
    expect(screen.queryByText("Press keys…")).not.toBeInTheDocument();

    await actor.click(change);
    await actor.click(change);
    expect(screen.queryByText("Press keys…")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset all to defaults" })).toBeDisabled();
  });

  it("adds a second chord, ignoring a duplicate", async () => {
    const actor = userEvent.setup();
    render(<ShortcutSettings />);

    await actor.click(screen.getByRole("button", { name: "Add another shortcut for Save page" }));
    // While adding, the plus button turns into the recording slot.
    expect(screen.getByText("Press keys…")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add another shortcut for Save page" }),
    ).not.toBeInTheDocument();
    press({ key: "s", code: "KeyS", ctrlKey: true });
    expect(screen.queryByRole("button", { name: /Remove .* from Save page/ })).not.toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Add another shortcut for Save page" }));
    press({ key: "k", code: "KeyK", ctrlKey: true, shiftKey: true });
    expect(screen.getAllByRole("button", { name: /Remove .* from Save page/ })).toHaveLength(2);
  });

  it("removes one of several chords", async () => {
    const actor = userEvent.setup();
    render(<ShortcutSettings />);
    const remove = screen.getAllByRole("button", { name: /Remove .* from Open quick search/ });
    expect(remove).toHaveLength(2);

    await actor.click(remove[0]);
    expect(screen.getAllByRole("button", { name: /Change shortcut for Open quick search/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Remove .* from Open quick search/ })).not.toBeInTheDocument();
  });

  it("hides the remove button on the chord being recorded", async () => {
    const actor = userEvent.setup();
    render(<ShortcutSettings />);
    const [first] = screen.getAllByRole("button", { name: /Change shortcut for Open quick search/ });
    await actor.click(first);
    expect(screen.getAllByRole("button", { name: /Remove .* from Open quick search/ })).toHaveLength(1);
  });

  it("warns about chords bound twice in the same scope", () => {
    act(() => setBindings("page.reload", ["Mod+S"]));
    render(<ShortcutSettings />);
    expect(screen.getByText(/One shortcut is/)).toBeInTheDocument();

    act(() => setBindings("video.playPause", ["Mod+S"]));
    act(() => setBindings("attachment.find", ["Mod+S"]));
  });

  it("counts several conflicts", () => {
    act(() => {
      setBindings("page.reload", ["Mod+S"]);
      setBindings("attachment.find", ["Space"]);
    });
    render(<ShortcutSettings />);
    expect(screen.getByText(/2 shortcuts are/)).toBeInTheDocument();
  });

  it("resets one action, or everything", async () => {
    const actor = userEvent.setup();
    act(() => {
      setBindings("page.save", ["Mod+J"]);
      setBindings("page.reload", ["Mod+L"]);
    });
    render(<ShortcutSettings />);

    await actor.click(screen.getByRole("button", { name: "Reset Save page to its default shortcut" }));
    expect(
      screen.queryByRole("button", { name: "Reset Save page to its default shortcut" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reset Reload page content to its default shortcut" }),
    ).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Change shortcut for Save page" }));
    await actor.click(screen.getByRole("button", { name: "Reset all to defaults" }));
    expect(screen.queryByText("Press keys…")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset all to defaults" })).toBeDisabled();
  });

  it("stops recording when an action is reset mid-way", async () => {
    const actor = userEvent.setup();
    act(() => setBindings("page.save", ["Mod+J"]));
    render(<ShortcutSettings />);
    await actor.click(screen.getByRole("button", { name: "Change shortcut for Save page" }));
    await actor.click(screen.getByRole("button", { name: "Reset Save page to its default shortcut" }));
    expect(screen.queryByText("Press keys…")).not.toBeInTheDocument();
  });
});
