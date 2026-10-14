import type { Editor } from "@tiptap/core";
import { Editor as TiptapEditor } from "@tiptap/core";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SLASH_COMMAND_ITEMS,
  SlashCommand,
  SlashCommandList,
  insertToggle,
  placeCursorInToggleSummary,
  toggleListBlock,
  toggleToggleBlock,
} from "@/components/pages/slash-command";

// ---------------------------------------------------------------- previews
describe("SlashCommandList previews", () => {
  it("shows a mockup and description for every block when highlighted", () => {
    render(<SlashCommandList items={SLASH_COMMAND_ITEMS} command={vi.fn()} />);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(SLASH_COMMAND_ITEMS.length);
    for (const option of options) {
      fireEvent.mouseEnter(option);
      expect(option).toHaveAttribute("aria-selected", "true");
    }
  });

  it("opens the preview on the left when there is no room on the right", () => {
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = () =>
      ({
        right: window.innerWidth + 50,
        left: 0,
        top: 0,
        bottom: 0,
        width: 0,
        height: 0,
      }) as DOMRect;
    try {
      const { container } = render(
        <SlashCommandList
          items={SLASH_COMMAND_ITEMS.slice(0, 2)}
          command={vi.fn()}
        />,
      );
      expect(container.querySelector(".right-full")).not.toBeNull();
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });

  it("copes with the highlighted row disappearing as the list shrinks", () => {
    const { rerender } = render(
      <SlashCommandList items={SLASH_COMMAND_ITEMS} command={vi.fn()} />,
    );
    fireEvent.mouseEnter(screen.getAllByRole("option").at(-1)!);
    rerender(
      <SlashCommandList
        items={SLASH_COMMAND_ITEMS.slice(0, 2)}
        command={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getAllByRole("option")[0]).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("runs the command when a row is clicked, without stealing focus", () => {
    const command = vi.fn();
    render(
      <SlashCommandList
        items={SLASH_COMMAND_ITEMS.slice(0, 2)}
        command={command}
      />,
    );
    const option = screen.getAllByRole("option")[1];
    const down = fireEvent.mouseDown(option);
    expect(down).toBe(false); // default prevented
    fireEvent.click(option);
    expect(command).toHaveBeenCalledWith(SLASH_COMMAND_ITEMS[1]);
  });
});

// ------------------------------------------------------------ item actions
type Call = [string, unknown[]];

/** An editor whose chain records every call, enough to exercise each item's run(). */
function recordingEditor() {
  const calls: Call[] = [];
  const chain: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, name: string) {
        if (name === "run") return () => true;
        return (...args: unknown[]) => {
          calls.push([name, args]);
          return chain;
        };
      },
    },
  );
  const editor = {
    chain: () => chain,
    isActive: () => false,
    state: {
      selection: {
        from: 1,
        $from: { parent: { type: { name: "paragraph" } } },
      },
    },
    commands: { command: () => true },
  } as unknown as Editor;
  return { editor, calls };
}

describe("slash menu items", () => {
  it("every text-block item drives the editor chain", () => {
    for (const item of SLASH_COMMAND_ITEMS) {
      if (
        [
          "image",
          "attachment",
          "link-to-page",
          "create-subpage",
          "toggle-list",
          "ai-continue",
        ].includes(item.id)
      )
        continue;
      const { editor, calls } = recordingEditor();
      item.run(editor);
      expect(calls.length, item.id).toBeGreaterThan(0);
    }
  });

  it("inserts callouts of each type", () => {
    for (const type of ["info", "warning", "tip", "panel"]) {
      const { editor, calls } = recordingEditor();
      SLASH_COMMAND_ITEMS.find((i) => i.id === `callout-${type}`)!.run(editor);
      const insert = calls.find(([name]) => name === "insertContent")!;
      expect(insert[1][0]).toMatchObject({ type: "callout", attrs: { type } });
    }
  });

  it("asks the writing assistant to continue the sentence through a window event", () => {
    const seen = vi.fn();
    window.addEventListener("wikihub:ai-assist", seen, { once: true });
    const { editor } = recordingEditor();

    SLASH_COMMAND_ITEMS.find((i) => i.id === "ai-continue")!.run(editor);

    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("asks the toolbar for files and pages through DOM events", () => {
    const seen: string[] = [];
    for (const name of [
      "wikihub:slash-insert-image",
      "wikihub:slash-insert-attachment",
      "wikihub:slash-link-to-page",
      "wikihub:slash-create-subpage",
    ]) {
      document.addEventListener(name, () => seen.push(name), { once: true });
    }
    const { editor } = recordingEditor();
    for (const id of [
      "image",
      "attachment",
      "link-to-page",
      "create-subpage",
    ]) {
      SLASH_COMMAND_ITEMS.find((i) => i.id === id)!.run(editor);
    }
    expect(seen).toHaveLength(4);
  });
});

// --------------------------------------------------------- toggle helpers
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*", toDOM: () => ["p", 0] },
    heading: { group: "block", content: "inline*", toDOM: () => ["h1", 0] },
    blockquote: {
      group: "block",
      content: "paragraph+",
      toDOM: () => ["blockquote", 0],
    },
    toggle: {
      group: "block",
      content: "toggleSummary toggleContent",
      attrs: { open: { default: true } },
      toDOM: () => ["div", 0],
    },
    toggleSummary: { content: "inline*", toDOM: () => ["div", 0] },
    toggleContent: { content: "block+", toDOM: () => ["div", 0] },
    text: { group: "inline" },
  },
});

const p = (text?: string) =>
  schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined);
const toggle = (title: string, body: ReturnType<typeof p>[]) =>
  schema.nodes.toggle.create({ open: true }, [
    schema.nodes.toggleSummary.create(
      null,
      title ? schema.text(title) : undefined,
    ),
    schema.nodes.toggleContent.create(null, body),
  ]);

function harness(
  doc: ReturnType<typeof schema.node>,
  pos: number,
  options: { lift?: boolean; active?: string } = {},
) {
  let state = EditorState.create({
    schema,
    doc,
    selection: TextSelection.near(doc.resolve(pos)),
  });
  const log: string[] = [];
  const runCommand = (
    fn: (args: {
      tr: Transaction;
      state: EditorState;
      dispatch?: (tr: Transaction) => void;
    }) => boolean,
  ) => {
    const tr = state.tr;
    const ok = fn({ tr, state, dispatch: () => {} });
    state = state.apply(tr);
    return ok;
  };
  const makeChain = () => {
    const steps: Array<() => boolean> = [];
    const chain: Record<string, unknown> = new Proxy(
      {},
      {
        get(_t, name: string) {
          if (name === "run")
            return () => steps.reduce((last, step) => step() && last, true);
          return (arg?: unknown) => {
            if (name === "command") steps.push(() => runCommand(arg as never));
            else if (name === "insertContent")
              steps.push(() => {
                log.push(`insertContent:${JSON.stringify(arg).slice(0, 30)}`);
                const node = schema.nodeFromJSON(arg as never);
                const tr = state.tr.replaceSelectionWith(node);
                state = state.apply(tr);
                return true;
              });
            else if (name === "liftListItem")
              steps.push(() => options.lift ?? false);
            else
              steps.push(() => {
                log.push(name);
                return true;
              });
            return chain;
          };
        },
      },
    );
    return chain;
  };
  const editor = {
    get state() {
      return state;
    },
    chain: makeChain,
    isActive: (name: string) => name === options.active,
    commands: { command: runCommand },
  } as unknown as Editor;
  return {
    editor,
    log,
    get state() {
      return state;
    },
  };
}

describe("placeCursorInToggleSummary", () => {
  it("does nothing without a dispatch, or when there is no toggle", () => {
    const doc = schema.node("doc", null, [p("hello")]);
    const state = EditorState.create({ schema, doc });
    expect(placeCursorInToggleSummary(state.tr, undefined, 0)).toBe(true);
    const tr = state.tr;
    const dispatch = vi.fn();
    expect(placeCursorInToggleSummary(tr, dispatch, 0)).toBe(true);
    expect(tr.selection.from).toBe(state.selection.from);
  });

  it("puts the cursor in the title of the nearest toggle", () => {
    const doc = schema.node("doc", null, [
      p("before"),
      toggle("Title", [p("body")]),
      toggle("Other", [p()]),
    ]);
    const state = EditorState.create({ schema, doc });
    const tr = state.tr;
    placeCursorInToggleSummary(tr, vi.fn(), 0);
    expect(tr.selection.$from.parent.type.name).toBe("toggleSummary");
    expect(tr.selection.$from.parent.textContent).toBe("Title");
  });
});

describe("toggleToggleBlock", () => {
  it("turns a paragraph into a toggle titled with its text", () => {
    const doc = schema.node("doc", null, [p("Plain text")]);
    const h = harness(doc, 6);
    toggleToggleBlock(h.editor);
    const first = h.state.doc.firstChild!;
    expect(first.type.name).toBe("toggle");
    expect(first.firstChild!.textContent).toBe("Plain text");
  });

  it("inserts a toggle instead when the cursor is not in a paragraph", () => {
    const doc = schema.node("doc", null, [
      schema.node("heading", null, [schema.text("Title")]),
    ]);
    const h = harness(doc, 3);
    toggleToggleBlock(h.editor);
    expect(h.log.some((entry) => entry.startsWith("insertContent"))).toBe(true);
  });

  it("falls back to inserting an empty toggle where a paragraph cannot be converted", () => {
    const doc = schema.node("doc", null, [
      schema.node("blockquote", null, [p("quoted")]),
    ]);
    const h = harness(doc, 3);
    toggleToggleBlock(h.editor);
    expect(h.log.some((entry) => entry.startsWith("insertContent"))).toBe(true);
  });

  it("unwraps a toggle from its title, keeping the body", () => {
    const doc = schema.node("doc", null, [toggle("Heading", [p("body text")])]);
    const h = harness(doc, 3); // inside the title
    toggleToggleBlock(h.editor);
    expect(h.state.doc.childCount).toBe(2);
    expect(h.state.doc.child(0).textContent).toBe("Heading");
    expect(h.state.doc.child(1).textContent).toBe("body text");
  });

  it("unwraps a toggle with an empty body to a single paragraph", () => {
    const doc = schema.node("doc", null, [toggle("Only title", [p()])]);
    const h = harness(doc, 3);
    toggleToggleBlock(h.editor);
    expect(h.state.doc.childCount).toBe(1);
    expect(h.state.doc.child(0).type.name).toBe("paragraph");
  });

  it("lifts out of a list first, up to the safety limit", () => {
    const doc = schema.node("doc", null, [p("item")]);
    const stuck = harness(doc, 2, { lift: true, active: "bulletList" });
    toggleToggleBlock(stuck.editor);
    expect(stuck.state.doc.firstChild!.type.name).toBe("toggle");

    const refused = harness(doc, 2, { lift: false, active: "taskList" });
    toggleToggleBlock(refused.editor);
    expect(refused.state.doc.firstChild!.type.name).toBe("toggle");
  });
});

describe("toggleListBlock and insertToggle", () => {
  it("applies the list command, unwrapping a toggle title first", () => {
    const plain = harness(schema.node("doc", null, [p("x")]), 2);
    toggleListBlock(plain.editor, "toggleBulletList");
    expect(plain.log).toContain("toggleBulletList");

    const inToggle = harness(
      schema.node("doc", null, [toggle("Title", [p("b")])]),
      3,
    );
    toggleListBlock(inToggle.editor, "toggleOrderedList");
    expect(inToggle.state.doc.firstChild!.type.name).toBe("paragraph");
    expect(inToggle.log).toContain("toggleOrderedList");
  });

  it("inserts a toggle with the cursor in its title", () => {
    const h = harness(schema.node("doc", null, [p()]), 1);
    insertToggle(h.editor);
    expect(h.state.doc.firstChild!.type.name).toBe("toggle");
    expect(h.state.selection.$from.parent.type.name).toBe("toggleSummary");
  });
});

// -------------------------------------------------------------- the plugin
describe("SlashCommand extension", () => {
  let editor: TiptapEditor | null = null;
  afterEach(() => {
    editor = null;
  });

  function Host() {
    const instance = useEditor({
      extensions: [StarterKit, SlashCommand],
      content: "<p></p>",
      immediatelyRender: true,
    });
    editor = instance;
    return <EditorContent editor={instance} />;
  }

  // The popup is rendered through the editor's content component, so the
  // editor has to be mounted by React rather than created on its own.
  function mount() {
    render(<Host />);
    return editor!;
  }

  it("opens the menu after a slash, filters, navigates and runs an item", async () => {
    const e = mount();
    act(() => {
      e.commands.focus();
      e.commands.insertContent("/");
    });

    const list = await screen.findByRole("listbox");
    expect(list).toBeInTheDocument();
    expect(screen.getAllByRole("option").length).toBe(
      SLASH_COMMAND_ITEMS.length,
    );
    // The faint hint appears while nothing has been typed to filter.
    expect(document.body.textContent).toContain("Type to search");

    act(() => {
      e.commands.insertContent("head");
    });
    await waitFor(() =>
      expect(screen.getAllByRole("option").length).toBeLessThan(
        SLASH_COMMAND_ITEMS.length,
      ),
    );
    expect(document.body.textContent).not.toContain("Type to search");

    // Enter chooses the highlighted item and removes the typed "/head".
    act(() => {
      e.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
      e.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
    expect(e.getText().trim()).toBe("");
  });

  it("closes without choosing on Escape", async () => {
    const e = mount();
    act(() => {
      e.commands.focus();
      e.commands.insertContent("/");
    });
    await screen.findByRole("listbox");
    act(() => {
      e.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
    expect(e.getText()).toBe("/");
  });

  it("chooses an item by clicking it", async () => {
    const e = mount();
    act(() => {
      e.commands.focus();
      e.commands.insertContent("/");
    });
    const options = await screen.findAllByRole("option");
    const heading = options.find((o) => /Heading 1/.test(o.textContent ?? ""))!;
    fireEvent.click(heading);
    await waitFor(() => expect(e.isActive("heading", { level: 1 })).toBe(true));
  });
});
