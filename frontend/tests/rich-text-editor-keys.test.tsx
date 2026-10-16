import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RichTextContent,
  RichTextEditor,
} from "@/components/pages/rich-text-editor";

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

/** Calls the first editor plugin handler of this name, the way ProseMirror does for an event. */
function plugin(editor: TestEditor, name: string, ...args: unknown[]) {
  const view = editor.view as unknown as {
    someProp: (
      name: string,
      run: (handler: (...a: unknown[]) => unknown) => unknown,
    ) => unknown;
  };
  return view.someProp(name, (handler) => handler(editor.view, ...args));
}

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
  const editor = dom.editor;
  /** Puts the caret just inside the first text that contains `needle`, at `offset` characters in. */
  const caretIn = (needle: string, offset = 0) => {
    let found = -1;
    editor.state.doc.descendants((node, pos) => {
      if (found < 0 && node.isText && node.text!.includes(needle))
        found = pos + node.text!.indexOf(needle) + offset;
    });
    expect(found).toBeGreaterThanOrEqual(0);
    editor.commands.setTextSelection(found);
  };
  const press = (key: string, init: KeyboardEventInit = {}) =>
    fireEvent.keyDown(dom, { key, ...init });
  const selectedText = () => editor.state.selection.$from.parent.textContent;
  return { ...view, dom, editor, caretIn, press, selectedText, onChange };
}

const TOGGLE =
  '<div data-type="toggle"><div data-type="toggle-summary">Title</div><div data-type="toggle-content"><p>Body</p></div></div>';

describe("toggle keyboard behaviour", () => {
  it("moves from the title into the body on Enter, and leaves other lines alone", async () => {
    const { caretIn, press, selectedText } = await renderEditor(
      `<p>Plain</p>${TOGGLE}`,
    );

    caretIn("Plain", 5);
    press("Enter");
    caretIn("Title", 2);
    press("Enter");
    expect(selectedText()).toBe("Body");
  });

  it("turns a title into a paragraph on Backspace at its start, keeping the body", async () => {
    const { caretIn, press, editor } = await renderEditor(TOGGLE);

    caretIn("Title", 0);
    press("Backspace");
    expect(editor.getHTML()).not.toContain('data-type="toggle"');
    expect(editor.getHTML()).toContain("Title");
    expect(editor.getHTML()).toContain("Body");
  });

  it("drops an empty body when the toggle unwraps", async () => {
    const { caretIn, press, editor } = await renderEditor(
      '<div data-type="toggle"><div data-type="toggle-summary">Only</div><div data-type="toggle-content"><p></p></div></div>',
    );

    caretIn("Only", 0);
    press("Backspace");
    expect(editor.getHTML()).toContain("<p>Only</p>");
    expect(editor.getHTML()).not.toContain("toggle");
  });

  it("leaves Backspace to the editor mid-title or with a range selected", async () => {
    const { caretIn, press, editor } = await renderEditor(TOGGLE);

    caretIn("Title", 3);
    press("Backspace");
    expect(editor.getHTML()).toContain('data-type="toggle"');
    editor.commands.setTextSelection({ from: 2, to: 4 });
    press("Backspace");
    expect(editor.getHTML()).toContain('data-type="toggle"');
  });

  it("opens a toggle when '> ' is typed on an empty line", async () => {
    const { editor, caretIn, dom } = await renderEditor("<p>&gt;</p>");

    caretIn(">", 1);
    const { from } = editor.state.selection;
    plugin(editor, "handleTextInput", from, from, " ");
    await waitFor(() =>
      expect(editor.getHTML()).toContain('data-type="toggle"'),
    );
  });
});

describe("table of contents", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("scrolls to a heading when its entry is clicked", async () => {
    render(
      <RichTextContent
        content={
          '<div data-type="tableOfContents"></div><h1>Intro</h1><h2>Sub</h2>'
        }
      />,
    );

    const entry = await screen.findByRole("button", { name: /Intro/ });
    fireEvent.click(entry);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Sub/ })).toBeInTheDocument();
  });

  it("invites you to add headings when there are none", async () => {
    render(
      <RichTextContent
        content={'<div data-type="tableOfContents"></div><p>No headings</p>'}
      />,
    );

    expect(
      await screen.findByText("Add headings to build this list automatically."),
    ).toBeInTheDocument();
  });
});

describe("code block shortcuts", () => {
  it("selects just the block's code on Select all, and the page elsewhere", async () => {
    const { caretIn, press, editor } = await renderEditor(
      "<p>outside</p><pre><code>one\ntwo</code></pre>",
    );

    caretIn("one", 1);
    press("a", { ctrlKey: true });
    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to)).toBe("one\ntwo");

    caretIn("outside", 2);
    press("a", { ctrlKey: true });
  });
});

describe("code block indentation of several lines", () => {
  it("indents every selected line on Tab and outdents them on Shift+Tab", async () => {
    const { caretIn, press, editor } = await renderEditor(
      "<pre><code>one\ntwo\nthree</code></pre>",
    );

    caretIn("one", 0);
    const from = editor.state.selection.from;
    editor.commands.setTextSelection({ from, to: from + 10 });
    press("Tab");
    expect(editor.getHTML()).toContain("  one\n  two\n  three");
    press("Tab", { shiftKey: true });
    expect(editor.getHTML()).toContain("<code>one\ntwo\nthree</code>");
    // Nothing left to remove: the document stays as it is.
    press("Tab", { shiftKey: true });
    expect(editor.getHTML()).toContain("<code>one\ntwo\nthree</code>");
  });
});

describe("block indent", () => {
  it("indents and outdents paragraphs and headings", async () => {
    const { caretIn, press, editor } = await renderEditor(
      "<h2>Head</h2><p>Para</p>",
    );

    caretIn("Head", 1);
    press("Tab");
    expect(editor.getHTML()).toContain("margin-left: 2rem");
    press("Tab", { shiftKey: true });
    expect(editor.getHTML()).not.toContain("margin-left");
    press("Tab", { shiftKey: true });
    for (let step = 0; step < 10; step += 1) press("Tab");
    expect(editor.getHTML()).toContain("margin-left: 16rem");
  });

  it("leaves Tab to lists and table cells", async () => {
    const { caretIn, press, editor } = await renderEditor(
      "<ul><li><p>item</p></li></ul><table><tbody><tr><td><p>cell</p></td></tr></tbody></table>",
    );

    caretIn("item", 1);
    press("Tab");
    caretIn("cell", 1);
    press("Tab");
    expect(editor.getHTML()).not.toContain("margin-left");
  });

  it("pulls a paragraph under a quote into it, and Shift+Tab backs the last line out", async () => {
    const { caretIn, press, editor } = await renderEditor(
      "<blockquote><p>quoted</p></blockquote><p>after</p>",
    );

    caretIn("after", 1);
    press("Tab");
    expect(editor.getHTML()).toMatch(
      /<blockquote>[\s\S]*after[\s\S]*<\/blockquote>/,
    );

    caretIn("after", 1);
    press("Tab", { shiftKey: true });
    expect(editor.getHTML()).toMatch(/<\/blockquote><p>after<\/p>/);
  });

  it("indents a quote from its first line", async () => {
    const { caretIn, press, editor } = await renderEditor(
      "<blockquote><p>first</p><p>second</p></blockquote>",
    );

    caretIn("first", 1);
    press("Tab");
    expect(editor.getHTML()).toMatch(
      /<blockquote style="margin-left: 2rem;?">/,
    );
    caretIn("second", 1);
    press("Tab");
    expect(editor.getHTML()).toMatch(
      /<p style="margin-left: 2rem;?">second<\/p>/,
    );
  });
});

describe("triple click in a table cell", () => {
  it("selects the line without selecting the cell, and ignores other places", async () => {
    const { editor, caretIn } = await renderEditor(
      "<p>outside</p><table><tbody><tr><td><p>cell text</p></td></tr></tbody></table>",
    );
    const triple = (pos: number) =>
      plugin(editor, "handleTripleClick", pos, new MouseEvent("mousedown"));

    caretIn("cell text", 2);
    const inCell = editor.state.selection.from;
    expect(triple(inCell)).toBe(true);
    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to)).toBe("cell text");

    caretIn("outside", 2);
    expect(triple(editor.state.selection.from)).toBeFalsy();
    // A position between blocks is not a text line at all.
    expect(triple(0)).toBeFalsy();
  });
});

describe("a page that starts with a code block", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens a line above it on ArrowUp from the first position", async () => {
    const { caretIn, press, editor } = await renderEditor(
      "<pre><code>first</code></pre>",
    );

    caretIn("first", 0);
    press("ArrowUp");
    expect(editor.getHTML().startsWith("<p></p>")).toBe(true);
  });

  it("keeps ArrowUp elsewhere for the editor", async () => {
    const { caretIn, press, editor } = await renderEditor(
      "<p>text</p><pre><code>code</code></pre>",
    );

    caretIn("code", 1);
    press("ArrowUp");
    caretIn("text", 0);
    press("ArrowUp");
    expect(editor.getHTML().startsWith("<p>text</p>")).toBe(true);
  });

  it("opens a line when the margin above the first block is clicked", async () => {
    const { editor, dom } = await renderEditor("<pre><code>first</code></pre>");
    const firstBlock = editor.view.nodeDOM(0) as HTMLElement;
    firstBlock.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    const click = (clientY: number) =>
      plugin(editor, "handleClick", 1, { clientY } as MouseEvent);

    expect(click(150)).toBeFalsy();
    expect(click(50)).toBe(true);
    expect(dom.firstElementChild?.tagName).toBe("P");
  });
});

describe("hint on an empty line", () => {
  it.each([
    ["en", "/"],
    ["vi", "/"],
  ])("shows how to reach AI and the slash menu (%s)", async (lang) => {
    document.documentElement.lang = lang;
    try {
      const { caretIn, dom } = await renderEditor("<p>filled</p><p></p>");
      caretIn("filled", 0);
      fireEvent.focus(dom);
      const { editor } = dom as unknown as { editor: TestEditor };
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      await waitFor(() => expect(dom.textContent).toContain("/"));
    } finally {
      document.documentElement.lang = "";
    }
  });
});
