import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { ShortcutSettings } from "@/components/account/shortcut-settings";
import { bindingsFor, currentBindings, resetAllShortcuts, setBindings } from "@/lib/keyboard-shortcuts";

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
    expect(screen.getByRole("button", { name: "Edit shortcuts" })).toBeInTheDocument();
    expect(screen.queryByText(/shortcuts? (is|are)/)).not.toBeInTheDocument();
  });

  it("records a new chord for an existing binding and saves changes", async () => {
    const actor = userEvent.setup();
    render(<ShortcutSettings />);

    // Must click "Edit shortcuts" to enter edit mode first
    await actor.click(screen.getByRole("button", { name: "Edit shortcuts" }));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Change shortcut for Save page" }));
    expect(screen.getByText("Press keys…")).toBeInTheDocument();
    // A modifier alone keeps waiting.
    press({ key: "Control", code: "ControlLeft", ctrlKey: true });
    expect(screen.getByText("Press keys…")).toBeInTheDocument();
    press({ key: "j", code: "KeyJ", ctrlKey: true });

    expect(screen.queryByText("Press keys…")).not.toBeInTheDocument();
    // Save the changes
    await actor.click(screen.getByRole("button", { name: "Save changes" }));
    expect(bindingsFor("page.save", { "page.save": ["Mod+J"] })).toEqual(["Mod+J"]);
    expect(screen.getByRole("button", { name: "Reset all to defaults" })).toBeEnabled();
  });

  it("discards draft changes when clicking Cancel", async () => {
    const actor = userEvent.setup();
    render(<ShortcutSettings />);

    await actor.click(screen.getByRole("button", { name: "Edit shortcuts" }));
    await actor.click(screen.getByRole("button", { name: "Change shortcut for Save page" }));
    press({ key: "j", code: "KeyJ", ctrlKey: true });

    // Cancel without saving
    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit shortcuts" })).toBeInTheDocument();
  });

  it("cancels recording with Escape or by clicking the chord again", async () => {
    const actor = userEvent.setup();
    render(<ShortcutSettings defaultEditing />);
    const change = screen.getByRole("button", { name: "Change shortcut for Save page" });

    await actor.click(change);
    press({ key: "Escape", code: "Escape" });
    expect(screen.queryByText("Press keys…")).not.toBeInTheDocument();

    await actor.click(change);
    await actor.click(change);
    expect(screen.queryByText("Press keys…")).not.toBeInTheDocument();
  });

  it("adds a second chord, ignoring a duplicate", async () => {
    const actor = userEvent.setup();
    render(<ShortcutSettings defaultEditing />);

    await actor.click(screen.getByRole("button", { name: "Add another shortcut for Save page" }));
    // While adding, the plus button turns into the recording slot.
    expect(screen.getByText("Press keys…")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add another shortcut for Save page" }),
    ).not.toBeInTheDocument();
    press({ key: "s", code: "KeyS", ctrlKey: true });
    expect(screen.getAllByRole("button", { name: /Remove .* from Save page/ })).toHaveLength(1);

    await actor.click(screen.getByRole("button", { name: "Add another shortcut for Save page" }));
    press({ key: "k", code: "KeyK", ctrlKey: true, shiftKey: true });
    expect(screen.getAllByRole("button", { name: /Remove .* from Save page/ })).toHaveLength(2);
  });

  it("removes one of several chords, and can remove the last chord to unbind", async () => {
    const actor = userEvent.setup();
    render(<ShortcutSettings defaultEditing />);
    await actor.click(screen.getByRole("button", { name: "Add another shortcut for Open quick search" }));
    press({ key: "j", code: "KeyJ", ctrlKey: true });
    const remove = screen.getAllByRole("button", { name: /Remove .* from Open quick search/ });
    expect(remove).toHaveLength(2);

    await actor.click(remove[0]);
    expect(screen.getAllByRole("button", { name: /Change shortcut for Open quick search/ })).toHaveLength(1);
    const lastRemove = screen.getByRole("button", { name: /Remove .* from Open quick search/ });
    await actor.click(lastRemove);
    expect(screen.getByText("No shortcut")).toBeInTheDocument();
  });

  it("hides the remove button on the chord being recorded", async () => {
    const actor = userEvent.setup();
    render(<ShortcutSettings defaultEditing />);
    const [first] = screen.getAllByRole("button", { name: /Change shortcut for Open quick search/ });
    await actor.click(first);
    expect(screen.queryByRole("button", { name: /Remove .* from Open quick search/ })).not.toBeInTheDocument();
  });

  it("shows the browser-find notice only when a non-preview action binds Ctrl+F", () => {
    const { unmount } = render(<ShortcutSettings defaultEditing />);
    expect(screen.queryByText("Browser search shortcut conflict")).not.toBeInTheDocument();
    unmount();

    act(() => setBindings("search.open", ["Mod+K", "Mod+F"]));
    render(<ShortcutSettings defaultEditing />);
    expect(screen.getByText("Browser search shortcut conflict")).toBeInTheDocument();
  });

  it("warns about chords bound twice in the same scope", () => {
    act(() => setBindings("page.reload", ["Mod+S"]));
    render(<ShortcutSettings defaultEditing />);
    expect(screen.getByText(/One shortcut is/)).toBeInTheDocument();

    act(() => setBindings("video.playPause", ["Mod+S"]));
    act(() => setBindings("attachment.find", ["Mod+S"]));
  });

  it("counts several conflicts", () => {
    act(() => {
      setBindings("page.reload", ["Mod+S"]);
      setBindings("attachment.find", ["Space"]);
    });
    render(<ShortcutSettings defaultEditing />);
    expect(screen.getByText(/2 shortcuts are/)).toBeInTheDocument();
  });

  it("resets one action, or everything", async () => {
    const actor = userEvent.setup();
    act(() => {
      setBindings("page.save", ["Mod+J"]);
      setBindings("page.reload", ["Mod+L"]);
    });
    render(<ShortcutSettings defaultEditing />);

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
  });

  it("resets saved shortcuts outside edit mode and shows unbound actions", async () => {
    act(() => {
      setBindings("page.save", []);
      setBindings("page.reload", ["Mod+L"]);
    });
    render(<ShortcutSettings />);
    expect(screen.getByText("No shortcut")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reset all to defaults" }));
    expect(currentBindings("page.reload")).toEqual(["Mod+R"]);
    expect(screen.queryByText("No shortcut")).not.toBeInTheDocument();
  });

  it("stops recording when an action is reset mid-way", async () => {
    const actor = userEvent.setup();
    act(() => setBindings("page.save", ["Mod+J"]));
    render(<ShortcutSettings defaultEditing />);
    await actor.click(screen.getByRole("button", { name: "Change shortcut for Save page" }));
    await actor.click(screen.getByRole("button", { name: "Reset Save page to its default shortcut" }));
    expect(screen.queryByText("Press keys…")).not.toBeInTheDocument();
  });
});
