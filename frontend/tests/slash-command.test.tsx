import { act, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  SLASH_COMMAND_ITEMS,
  SlashCommandList,
  type SlashCommandItem,
  type SlashCommandListRef,
  filterSlashCommandItems,
} from "@/components/pages/slash-command";

// Only `event.key` is ever read - the rest of the real shape
// (`view`, `range`) is irrelevant to onKeyDown here.
function keyDownProps(key: string) {
  return { event: { key } } as unknown as Parameters<
    SlashCommandListRef["onKeyDown"]
  >[0];
}

describe("filterSlashCommandItems", () => {
  it("returns everything for an empty query", () => {
    expect(filterSlashCommandItems("")).toEqual(SLASH_COMMAND_ITEMS);
    expect(filterSlashCommandItems("   ")).toEqual(SLASH_COMMAND_ITEMS);
  });

  it("matches a label substring, case-insensitively", () => {
    const results = filterSlashCommandItems("head");
    expect(results.map((item) => item.id)).toEqual([
      "heading-1",
      "heading-2",
      "heading-3",
      "heading-4",
    ]);
  });

  it("matches a keyword that isn't in the label", () => {
    // "h1" is a keyword on Heading 1, not part of its label.
    const results = filterSlashCommandItems("h1");
    expect(results.map((item) => item.id)).toEqual(["heading-1"]);
  });

  it("returns nothing for a query matching no label or keyword", () => {
    expect(filterSlashCommandItems("zzz-not-a-block")).toEqual([]);
  });
});

describe("SlashCommandList", () => {
  const items: SlashCommandItem[] = SLASH_COMMAND_ITEMS.slice(0, 3);

  it("renders one option per item, grouped under its group label", () => {
    render(<SlashCommandList items={items} command={vi.fn()} />);
    expect(screen.getAllByRole("option")).toHaveLength(items.length);
    for (const item of items) {
      expect(
        screen.getByRole("option", { name: new RegExp(item.label) }),
      ).toBeInTheDocument();
    }
    expect(screen.getByText("Basic blocks")).toBeInTheDocument();
  });

  it("shows a 'no matching blocks' state when items is empty", () => {
    render(<SlashCommandList items={[]} command={vi.fn()} />);
    expect(screen.queryByRole("option")).toBeNull();
    expect(screen.getByText("No matching blocks.")).toBeInTheDocument();
  });

  it("always shows the 'Close menu' / Esc footer, matched or not", () => {
    const { rerender } = render(
      <SlashCommandList items={items} command={vi.fn()} />,
    );
    expect(screen.getByText("Close menu")).toBeInTheDocument();
    expect(screen.getByText("Esc")).toBeInTheDocument();

    rerender(<SlashCommandList items={[]} command={vi.fn()} />);
    expect(screen.getByText("Close menu")).toBeInTheDocument();
    expect(screen.getByText("Esc")).toBeInTheDocument();
  });

  it("shows a shortcut hint only for items that declare one", () => {
    const withShortcut = SLASH_COMMAND_ITEMS.find(
      (item) => item.id === "quote",
    )!;
    const withoutShortcut = SLASH_COMMAND_ITEMS.find(
      (item) => item.id === "table",
    )!;
    render(
      <SlashCommandList
        items={[withShortcut, withoutShortcut]}
        command={vi.fn()}
      />,
    );
    const options = screen.getAllByRole("option");
    expect(options[0].querySelector("kbd")).toHaveTextContent('"');
    expect(options[1].querySelector("kbd")).toBeNull();
  });

  it("moves the highlighted option with arrow keys, wrapping at each end", () => {
    const ref = createRef<SlashCommandListRef>();
    render(<SlashCommandList ref={ref} items={items} command={vi.fn()} />);

    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    act(() => {
      ref.current!.onKeyDown(keyDownProps("ArrowDown"));
    });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute(
      "aria-selected",
      "true",
    );

    act(() => {
      ref.current!.onKeyDown(keyDownProps("ArrowUp"));
      ref.current!.onKeyDown(keyDownProps("ArrowUp"));
    });
    // Wrapped past the start back to the last item.
    expect(screen.getAllByRole("option")[items.length - 1]).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("invokes command with the highlighted item on Enter", () => {
    const command = vi.fn();
    const ref = createRef<SlashCommandListRef>();
    render(<SlashCommandList ref={ref} items={items} command={command} />);

    // Two separate act() calls, matching two separate native keydown
    // events - React flushes ArrowDown's state update (and so recreates the
    // useImperativeHandle closure) before Enter's keydown ever arrives, the
    // same way it would for two real, separately-dispatched keystrokes.
    act(() => {
      ref.current!.onKeyDown(keyDownProps("ArrowDown"));
    });
    act(() => {
      ref.current!.onKeyDown(keyDownProps("Enter"));
    });

    expect(command).toHaveBeenCalledWith(items[1]);
  });

  it("leaves other keys unhandled", () => {
    const ref = createRef<SlashCommandListRef>();
    render(<SlashCommandList ref={ref} items={items} command={vi.fn()} />);
    expect(ref.current!.onKeyDown(keyDownProps("a"))).toBe(false);
  });
});
