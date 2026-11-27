import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  moveBlockNode,
  resolveBlockDropTarget,
} from "@/components/pages/editor/block-drag-handle";
import { RichTextEditor } from "@/components/pages/rich-text-editor";

type TestEditor = {
  state: import("@tiptap/pm/state").EditorState;
  view: import("@tiptap/pm/view").EditorView;
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
  return { ...view, dom, editor: dom.editor, onChange };
}

function findNodePos(editor: TestEditor, typeName: string, nth = 0): number {
  let count = 0;
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === typeName) {
      if (count === nth) {
        found = pos;
        return false;
      }
      count += 1;
    }
    return true;
  });
  return found;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("block drag and drop", () => {
  it("moves a table into a bullet list item", async () => {
    const { editor } = await renderEditor(
      "<ul><li><p>Item 1</p></li></ul><table><tbody><tr><td><p>Cell</p></td></tr></tbody></table>",
    );
    const tablePos = findNodePos(editor, "table");
    const listItemPos = findNodePos(editor, "listItem");
    const tableNode = editor.state.doc.nodeAt(tablePos)!;
    const listParaPos = listItemPos + 1;
    const listPara = editor.state.doc.nodeAt(listParaPos)!;

    // Resolve drop over the bullet item's paragraph (lower half).
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({
      pos: listParaPos + 2,
      inside: listParaPos,
    });
    vi.spyOn(editor.view, "nodeDOM").mockReturnValue({
      getBoundingClientRect: () => ({
        top: 100,
        bottom: 124,
        left: 40,
        right: 300,
        width: 260,
        height: 24,
      }),
    } as unknown as Element);

    const target = resolveBlockDropTarget(
      editor.view,
      80,
      118,
      tableNode,
      tablePos,
    );
    expect(target).not.toBeNull();
    expect(target!.pos).toBe(listParaPos + listPara.nodeSize);

    act(() => {
      expect(moveBlockNode(editor.view, tablePos, target!.pos)).toBe(true);
    });

    const html = editor.getHTML();
    expect(html).toMatch(/<li><p>Item 1<\/p><table[\s\S]*<\/table><\/li>/);
  });

  it("moves a code block into a blockquote", async () => {
    const { editor } = await renderEditor(
      "<blockquote><p>Quoted line</p></blockquote><pre><code>const x = 1;</code></pre>",
    );
    const codePos = findNodePos(editor, "codeBlock");
    const quotePos = findNodePos(editor, "blockquote");
    const codeNode = editor.state.doc.nodeAt(codePos)!;
    const quoteParaPos = quotePos + 1;
    const quotePara = editor.state.doc.nodeAt(quoteParaPos)!;

    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({
      pos: quoteParaPos + 2,
      inside: quoteParaPos,
    });
    vi.spyOn(editor.view, "nodeDOM").mockReturnValue({
      getBoundingClientRect: () => ({
        top: 50,
        bottom: 74,
        left: 30,
        right: 300,
        width: 270,
        height: 24,
      }),
    } as unknown as Element);

    const target = resolveBlockDropTarget(
      editor.view,
      80,
      70,
      codeNode,
      codePos,
    );
    expect(target).not.toBeNull();
    expect(target!.pos).toBe(quoteParaPos + quotePara.nodeSize);

    act(() => {
      expect(moveBlockNode(editor.view, codePos, target!.pos)).toBe(true);
    });

    expect(editor.getHTML()).toMatch(
      /<blockquote><p>Quoted line<\/p><pre[\s\S]*const x = 1;[\s\S]*<\/pre><\/blockquote>/,
    );
  });

  it("moves a blockquote into a callout and keeps source callout alive when its sole child moves out", async () => {
    const { editor } = await renderEditor(
      '<div data-type="callout" data-callout-type="info"><p>Notice</p></div><blockquote><p>Wisdom</p></blockquote>',
    );
    const calloutPos = findNodePos(editor, "callout");
    const quotePos = findNodePos(editor, "blockquote");
    const calloutParaPos = calloutPos + 1;
    const calloutPara = editor.state.doc.nodeAt(calloutParaPos)!;

    act(() => {
      expect(
        moveBlockNode(editor.view, quotePos, calloutParaPos + calloutPara.nodeSize),
      ).toBe(true);
    });
    expect(editor.getHTML()).toMatch(
      /data-type="callout"[\s\S]*<p>Notice<\/p><blockquote><p>Wisdom<\/p><\/blockquote>/,
    );

    // Now test moving a sole child out of a callout preserves the callout.
    const { editor: editor2 } = await renderEditor(
      '<div data-type="callout" data-callout-type="tip"><blockquote><p>Only child</p></blockquote></div><p>After</p>',
    );
    const nestedQuotePos = findNodePos(editor2, "blockquote");
    const afterParaPos = findNodePos(editor2, "paragraph", 1);
    const afterPara = editor2.state.doc.nodeAt(afterParaPos)!;

    act(() => {
      expect(
        moveBlockNode(editor2.view, nestedQuotePos, afterParaPos + afterPara.nodeSize),
      ).toBe(true);
    });
    const html2 = editor2.getHTML();
    expect(html2).toContain('data-type="callout"');
    expect(html2).toMatch(/<p>After<\/p><blockquote><p>Only child<\/p><\/blockquote>/);
  });

  it("shows the drag handle when hovering a draggable block and ignores drops onto itself", async () => {
    const { editor, dom } = await renderEditor(
      "<blockquote><p>Drag me</p></blockquote><p>Target</p>",
    );
    const quoteEl = dom.querySelector("blockquote")!;
    const quotePos = findNodePos(editor, "blockquote");
    const quoteNode = editor.state.doc.nodeAt(quotePos)!;

    vi.spyOn(editor.view, "posAtDOM").mockReturnValue(quotePos + 1);
    Object.defineProperty(quoteEl, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        top: 100,
        bottom: 140,
        left: 40,
        right: 400,
        width: 360,
        height: 40,
      }),
    });

    fireEvent.mouseMove(quoteEl, { clientX: 60, clientY: 110 });
    const handle = await screen.findByRole("button", {
      name: "Drag to move block",
    });
    expect(handle).toBeInTheDocument();
    expect(handle).toHaveAttribute("draggable", "true");

    // Dropping onto itself returns null and does not mutate the doc.
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({
      pos: quotePos + 2,
      inside: quotePos,
    });
    expect(
      resolveBlockDropTarget(editor.view, 60, 110, quoteNode, quotePos),
    ).toBeNull();
    expect(moveBlockNode(editor.view, quotePos, quotePos + 2)).toBe(false);
  });
});
