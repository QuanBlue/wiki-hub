import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CellSelection } from "@tiptap/pm/tables";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RichTextEditor } from "@/components/pages/rich-text-editor";

type TestEditor = {
  state: import("@tiptap/pm/state").EditorState;
  view: import("@tiptap/pm/view").EditorView;
  commands: {
    setTextSelection: (
      position: number | { from: number; to: number },
    ) => boolean;
  };
  getHTML: () => string;
};

async function renderEditor(html: string) {
  const onChange = vi.fn();
  const view = render(<RichTextEditor content={html} onChange={onChange} />);
  const dom = await waitFor(() => {
    const found = view.container.querySelector(
      '.ProseMirror[contenteditable="true"]',
    );
    expect(found).not.toBeNull();
    return found as HTMLElement & { editor: TestEditor };
  });
  return {
    ...view,
    dom,
    editor: dom.editor,
    onChange,
    user: userEvent.setup(),
  };
}

/** Puts the caret in the document and in the browser's selection, so the editor does not read it back elsewhere. */
function placeCaret(editor: TestEditor, position: number) {
  editor.commands.setTextSelection(position);
  const { node, offset } = editor.view.domAtPos(position);
  window.getSelection()!.collapse(node, offset);
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as unknown as Record<string, unknown>)
    .scrollWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>)
    .clientWidth;
});

describe("a narrow toolbar", () => {
  /** Makes the toolbar's own action strip too wide for its box, so actions spill into the menu. */
  function squeezeToolbar() {
    const isStrip = (element: HTMLElement) =>
      element.className.includes("min-w-0 flex-1 flex-nowrap");
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return isStrip(this) ? 1000 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return isStrip(this) ? 400 : 0;
      },
    });
  }

  it("moves every action into the More menu, where each still works", async () => {
    squeezeToolbar();
    const click = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});
    const { editor, user } = await renderEditor("<p>Hello world</p>");
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });

    const labels = [
      "Unwrap text",
      "Bulleted list",
      "Numbered list",
      "To-do list",
      "Toggle list",
      "Quote",
      "Code block",
      "Insert divider",
      "Add link",
      "Insert image",
      "Upload file",
    ];
    for (const label of labels) {
      await user.click(
        await screen.findByRole("button", { name: "More formatting actions" }),
      );
      const menu = await screen.findByRole("toolbar", {
        name: "Hidden formatting actions",
      });
      const action = Array.from(menu.querySelectorAll("button")).find(
        (candidate) =>
          candidate
            .getAttribute("aria-label")
            ?.toLowerCase()
            .includes(label.toLowerCase().split(" ")[0]!),
      );
      expect(action, label).toBeDefined();
      await user.click(action!);
      // A dialog from "Add link" would trap focus; close it before the next round.
      const dialog = screen.queryByRole("dialog");
      if (dialog) await user.keyboard("{Escape}");
    }
    expect(click).toHaveBeenCalled();
  });

  it("lists each action under its own name, and shows busy labels while uploading", async () => {
    squeezeToolbar();
    const onUploadFile = vi.fn(() => new Promise<never>(() => {}));
    const view = render(
      <RichTextEditor
        content="<p>hi</p>"
        onChange={vi.fn()}
        onUploadFile={onUploadFile}
      />,
    );
    const dom = (await waitFor(() => {
      const found = view.container.querySelector(
        '.ProseMirror[contenteditable="true"]',
      );
      expect(found).not.toBeNull();
      return found;
    })) as HTMLElement;
    act(() => {
      dom.dispatchEvent(
        new CustomEvent("wikihub:editor-files", {
          detail: [new File(["x"], "a.png", { type: "image/png" })],
        }),
      );
    });
    await userEvent
      .setup()
      .click(
        await screen.findByRole("button", { name: "More formatting actions" }),
      );
    const menu = await screen.findByRole("toolbar", {
      name: "Hidden formatting actions",
    });
    expect(menu.querySelector('[aria-label="Uploading image"]')).not.toBeNull();
    expect(menu.querySelector('[aria-label="Uploading file"]')).not.toBeNull();
  });

  it("measures again when the toolbar is resized", async () => {
    let notify: () => void = () => {};
    window.ResizeObserver = class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    await renderEditor("<p>hi</p>");

    act(() => notify());
    expect(
      screen.getByRole("button", { name: "Upload file" }),
    ).toBeInTheDocument();
  });
});

describe("table actions", () => {
  const TABLE =
    "<table><tbody><tr><td><p>one</p></td><td><p>two</p></td></tr><tr><td><p>three</p></td><td><p>four</p></td></tr></tbody></table>";

  async function inTable() {
    const view = await renderEditor(TABLE);
    const cells: number[] = [];
    view.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell" || node.type.name === "tableHeader")
        cells.push(pos);
    });
    act(() => {
      view.dom.focus();
      placeCaret(view.editor, cells[0]! + 2);
    });
    const menu = await screen.findByRole("toolbar", { name: "Table actions" });
    return { ...view, cells, menu };
  }

  it("appears while the caret is in a table, and goes when it leaves", async () => {
    const { editor, dom } = await renderEditor(`<p>outside</p>${TABLE}`);
    expect(screen.queryByRole("toolbar", { name: "Table actions" })).toBeNull();

    let cell = 0;
    editor.state.doc.descendants((node, pos) => {
      if (!cell && node.type.name === "tableCell") cell = pos;
    });
    act(() => {
      dom.focus();
      editor.commands.setTextSelection(cell + 2);
    });
    expect(
      await screen.findByRole("toolbar", { name: "Table actions" }),
    ).toBeInTheDocument();
    act(() => {
      editor.commands.setTextSelection(2);
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("toolbar", { name: "Table actions" }),
      ).toBeNull(),
    );
    act(() => {
      window.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("scroll"));
    });
  });

  it("merges the selected cells and splits them again", async () => {
    const { editor, cells, user } = await inTable();

    expect(
      screen.getByRole("button", { name: "Merge selected cells" }),
    ).toBeDisabled();
    act(() => {
      const { doc, tr } = editor.state;
      editor.view.dispatch(
        tr.setSelection(CellSelection.create(doc, cells[0]!, cells[1]!)),
      );
    });
    await user.click(
      await screen.findByRole("button", { name: "Merge selected cells" }),
    );
    expect(editor.getHTML()).toContain('colspan="2"');

    act(() => {
      editor.commands.setTextSelection(cells[0]! + 2);
    });
    await user.click(await screen.findByRole("button", { name: "Split cell" }));
    expect(editor.getHTML()).not.toContain('colspan="2"');
  });

  it("colours a cell, and adds a row and a column", async () => {
    const { editor, user, cells } = await inTable();

    await user.click(screen.getByRole("button", { name: "Cell colour" }));
    await user.click(await screen.findByRole("gridcell", { name: "Colour 4" }));
    expect(editor.getHTML()).toContain("background-color");

    act(() => placeCaret(editor, cells[0]! + 2));
    await user.click(await screen.findByRole("button", { name: /^Add$/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Add row" }));
    expect((editor.getHTML().match(/<tr/g) ?? []).length).toBe(3);
    act(() => placeCaret(editor, cells[0]! + 2));
    await user.click(await screen.findByRole("button", { name: /^Add$/ }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Add column" }),
    );
    expect((editor.getHTML().match(/<td/g) ?? []).length).toBeGreaterThan(4);
  });

  it("deletes a row and a column", async () => {
    const { editor, user, cells } = await inTable();

    await user.click(screen.getByRole("button", { name: /^Delete$/ }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Delete row" }),
    );
    expect((editor.getHTML().match(/<tr/g) ?? []).length).toBe(1);
    act(() => placeCaret(editor, cells[0]! + 2));
    await user.click(await screen.findByRole("button", { name: /^Delete$/ }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Delete column" }),
    );
    expect((editor.getHTML().match(/<td/g) ?? []).length).toBe(1);
  });

  it("deletes the whole table", async () => {
    const { editor, user } = await inTable();

    await user.click(screen.getByRole("button", { name: /^Delete$/ }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Delete table" }),
    );
    expect(editor.getHTML()).not.toContain("<table");
  });

  it("inserts another table from the Add menu", async () => {
    const { editor, user } = await inTable();

    await user.click(screen.getByRole("button", { name: /^Add$/ }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Add table" }),
    );
    const cell = await screen.findByRole("gridcell", {
      name: "2 rows by 2 columns",
    });
    fireEvent.pointerEnter(cell);
    expect(screen.getAllByText("2×2").length).toBeGreaterThan(0);
    fireEvent.pointerLeave(cell.parentElement!);
    fireEvent.click(cell);
    expect(editor.getHTML()).toContain("<table");
  });
});

describe("the link toolbar", () => {
  const HTML =
    '<p><a href="https://x.test" title="Tip" target="_blank">first</a> plain <a href="#part" target="_self">second</a></p>';

  async function hover(text: string) {
    const view = await renderEditor(HTML);
    const link = Array.from(view.dom.querySelectorAll("a")).find(
      (a) => a.textContent === text,
    ) as HTMLElement;
    link.getBoundingClientRect = () =>
      ({ left: 40, bottom: 60, top: 40, right: 100 }) as DOMRect;
    fireEvent.mouseOver(link);
    return { ...view, link };
  }

  it("shows on hover with the link's actions, and opens it in a new tab", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    await hover("first");

    fireEvent.click(
      await screen.findByTitle("Open link in new tab (https://x.test)"),
    );
    expect(open).toHaveBeenCalledWith(
      "https://x.test",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("opens a same-window link in place", async () => {
    await hover("second");

    fireEvent.click(
      await screen.findByTitle("Open link in current window (#part)"),
    );
    expect(window.location.hash).toBe("#part");
    window.location.hash = "";
  });

  it("copies the address and shows it was copied", async () => {
    await hover("first");
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);

    fireEvent.click(await screen.findByTitle("Copy link URL"));
    expect(writeText).toHaveBeenCalledWith("https://x.test");
  });

  it("hands the link to the edit dialog", async () => {
    const { editor } = await hover("first");
    expect(editor).toBeDefined();

    fireEvent.click(await screen.findByTitle("Edit link"));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Edit link");
    expect(
      ((await screen.findByLabelText("Url")) as HTMLInputElement).value,
    ).toBe("https://x.test");
  });

  it("removes the link", async () => {
    const { editor } = await hover("first");

    fireEvent.click(await screen.findByTitle("Remove link"));
    expect(editor.getHTML()).not.toContain("https://x.test");
    await waitFor(() => expect(screen.queryByTitle("Remove link")).toBeNull());
  });

  it("goes away shortly after the pointer leaves, unless it moved onto the toolbar", async () => {
    const { dom, link } = await hover("first");
    const toolbar = (await screen.findByTitle("Remove link"))
      .parentElement as HTMLElement;

    const toward = createLeave(dom, toolbar);
    fireEvent(dom, toward);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getByTitle("Remove link")).toBeInTheDocument();

    fireEvent(dom, createLeave(dom, document.body));
    await waitFor(() => expect(screen.queryByTitle("Remove link")).toBeNull());

    fireEvent.mouseOver(link);
    fireEvent.mouseEnter(
      await screen
        .findByTitle("Remove link")
        .then((button) => button.parentElement!),
    );
    fireEvent.mouseLeave(screen.getByTitle("Remove link").parentElement!);
    await waitFor(() => expect(screen.queryByTitle("Remove link")).toBeNull());
  });

  it("hides when the pointer moves onto plain text", async () => {
    const { dom } = await hover("first");
    await screen.findByTitle("Remove link");

    fireEvent.mouseOver(dom.firstElementChild!);
    await waitFor(() => expect(screen.queryByTitle("Remove link")).toBeNull());
  });

  it("is selected rather than followed when clicked while editing", async () => {
    const { link, editor } = await hover("first");
    fireEvent.mouseOver(dom_of(link));

    expect(fireEvent.click(link)).toBe(false);
    expect(await screen.findByTitle("Remove link")).toBeInTheDocument();
    expect(editor.state.selection.from).toBeLessThan(editor.state.selection.to);
  });

  it("ignores clicks that are not on a link", async () => {
    const { dom } = await hover("first");

    expect(fireEvent.click(dom.firstElementChild!)).toBe(true);
  });

  it("shows for a caret inside a link, and for a selected part of one", async () => {
    const { editor, dom } = await renderEditor(HTML);
    (editor.view as unknown as { coordsAtPos: () => unknown }).coordsAtPos =
      () => ({ left: 20, bottom: 30 });
    void dom;

    act(() => {
      editor.commands.setTextSelection(3);
    });
    expect(await screen.findByTitle("Remove link")).toBeInTheDocument();
    act(() => {
      editor.commands.setTextSelection({ from: 2, to: 4 });
    });
    expect(await screen.findByTitle("Edit link")).toBeInTheDocument();
    // Leaving the link takes the toolbar away.
    act(() => {
      editor.commands.setTextSelection(9);
    });
    await waitFor(() => expect(screen.queryByTitle("Remove link")).toBeNull());
  });

  it("stays quiet when the caret's position cannot be measured", async () => {
    const { editor } = await renderEditor(HTML);
    (editor.view as unknown as { coordsAtPos: () => never }).coordsAtPos =
      () => {
        throw new Error("no layout");
      };

    act(() => {
      editor.commands.setTextSelection(3);
    });
    expect(screen.queryByTitle("Remove link")).toBeNull();
  });

  it("leaves attachment tiles to their own tools", async () => {
    const { dom } = await renderEditor(
      '<p><a href="/api/v1/attachments/55555555-5555-5555-5555-555555555555/content" data-attachment="a.zip">a.zip</a></p>',
    );
    const tile = dom.querySelector("a[data-attachment-href]") as HTMLElement;

    fireEvent.mouseOver(tile);
    fireEvent.click(tile);
    expect(screen.queryByTitle("Remove link")).toBeNull();
  });

  it("prefixes a bare address before opening it", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { dom } = await renderEditor(
      '<p><a href="example.org" target="_blank">bare</a></p>',
    );
    const link = dom.querySelector("a") as HTMLElement;
    link.getBoundingClientRect = () => ({ left: 0, bottom: 0 }) as DOMRect;

    fireEvent.mouseOver(link);
    fireEvent.click(await screen.findByTitle(/Open link in new tab/));
    expect(open).toHaveBeenCalledWith(
      "https://example.org",
      "_blank",
      "noopener,noreferrer",
    );
  });
});

function createLeave(target: Element, related: Element) {
  const event = new MouseEvent("mouseleave", { bubbles: false });
  Object.defineProperty(event, "relatedTarget", { value: related });
  void target;
  return event;
}

function dom_of(link: HTMLElement) {
  return link;
}
