import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RichTextEditor } from "@/components/pages/rich-text-editor";

type TestEditor = {
  state: import("@tiptap/pm/state").EditorState;
  view: import("@tiptap/pm/view").EditorView;
  getHTML: () => string;
};

const ID = "33333333-3333-3333-3333-333333333333";
const HREF = `/api/v1/attachments/${ID}/content`;

/** The editor's own handler for an event, which is what ProseMirror asks first. */
function ownProp(editor: TestEditor, name: string, ...args: unknown[]) {
  const props = editor.view.props as unknown as Record<
    string,
    (...a: unknown[]) => unknown
  >;
  return props[name]!(editor.view, ...args);
}

function plugin(editor: TestEditor, name: string, ...args: unknown[]) {
  const view = editor.view as unknown as {
    someProp: (
      name: string,
      run: (handler: (...a: unknown[]) => unknown) => unknown,
    ) => unknown;
  };
  return view.someProp(name, (handler) => handler(editor.view, ...args));
}

async function renderEditor(
  html: string,
  props: Partial<React.ComponentProps<typeof RichTextEditor>> = {},
) {
  const onChange = vi.fn();
  const view = render(
    <RichTextEditor content={html} onChange={onChange} {...props} />,
  );
  const dom = await waitFor(() => {
    const found = view.container.querySelector(
      '.ProseMirror[contenteditable="true"]',
    );
    expect(found).not.toBeNull();
    return found as HTMLElement & { editor: TestEditor };
  });
  const wrapper = view.container.firstElementChild as HTMLElement;
  return { ...view, dom, editor: dom.editor, wrapper, onChange };
}

/** A dragleave that says where the pointer went; the plain event helper cannot carry that. */
function leave(from: HTMLElement, to: Element) {
  const event = createEvent.dragLeave(from, {
    dataTransfer: transfer(["Files"]),
  });
  Object.defineProperty(event, "relatedTarget", { value: to });
  fireEvent(from, event);
}

const transfer = (types: string[] = [], files: File[] = []) => ({
  types,
  files,
  dropEffect: "none",
  effectAllowed: "all",
  getData: () => "",
  setData: () => {},
});

afterEach(() => vi.restoreAllMocks());

describe("attachment links in the editor", () => {
  it("opens the preview for a click on an attachment link, and ignores other clicks", async () => {
    const { dom, wrapper } = await renderEditor(
      `<p>plain <a href="https://example.test">out</a> <a href="${HREF}" data-attachment="a.zip">a.zip</a></p>`,
    );

    // Clicks that are not on an attachment pass through.
    fireEvent.click(wrapper);
    fireEvent.click(screen.getByText("out"));
    expect(screen.queryByRole("dialog")).toBeNull();

    const tile = dom.querySelector("a[data-attachment-href]") as HTMLElement;
    fireEvent.mouseDown(tile);
    fireEvent.click(tile);
    // The details request has nowhere to go, but the modal opens on the id.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("opens the preview from a press even when the click never arrives", async () => {
    const { dom, wrapper } = await renderEditor(
      `<p><a href="${HREF}" data-attachment="a.zip">a.zip</a></p>`,
    );
    const tile = dom.querySelector("a[data-attachment-href]") as HTMLElement;

    fireEvent.mouseDown(tile);
    // The press was on a tile, so a click landing anywhere else still opens it.
    fireEvent.click(wrapper);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("opens the preview when asked by event, and ignores an event without an attachment", async () => {
    await renderEditor("<p>hi</p>");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("wikihub:open-attachment-modal", { detail: {} }),
      );
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => {
      window.dispatchEvent(
        new CustomEvent("wikihub:open-attachment-modal", {
          detail: { attachmentId: ID },
        }),
      );
    });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("pasting", () => {
  const clipboard = (
    init: { files?: File[]; text?: string; html?: string } | null,
  ) => ({
    clipboardData: init
      ? {
          files: init.files ?? [],
          getData: (type: string) =>
            type === "text/html"
              ? (init.html ?? "")
              : type === "text/plain"
                ? (init.text ?? "")
                : "",
        }
      : null,
    preventDefault: vi.fn(),
  });

  it("hands a pasted screenshot to the upload path", async () => {
    const { editor, dom } = await renderEditor("<p>hi</p>");
    const received = vi.fn();
    dom.addEventListener("wikihub:editor-files", received);
    const image = new File(["x"], "shot.png", { type: "image/png" });

    const event = clipboard({ files: [image], html: '<img src="x">' });
    expect(plugin(editor, "handlePaste", event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect((received.mock.calls[0]![0] as CustomEvent).detail).toEqual([image]);
  });

  it("leaves everything else to the editor", async () => {
    const { editor } = await renderEditor("<p>hi</p>");
    const image = new File(["x"], "shot.png", { type: "image/png" });

    expect(plugin(editor, "handlePaste", clipboard(null))).toBeFalsy();
    expect(
      plugin(editor, "handlePaste", clipboard({ text: "just text" })),
    ).toBeFalsy();
    expect(
      plugin(
        editor,
        "handlePaste",
        clipboard({ files: [new File(["x"], "a.txt")], text: "t" }),
      ),
    ).toBeFalsy();
    // Text that arrives with the image (Word, Excel) keeps the normal paste.
    expect(
      plugin(
        editor,
        "handlePaste",
        clipboard({ files: [image], text: "caption", html: "<p>caption</p>" }),
      ),
    ).toBeFalsy();
  });
});

describe("dragging files and nodes over the editor", () => {
  it("shows the drop hint for a file drag and clears it on leaving", async () => {
    const { wrapper, dom } = await renderEditor("<p>hi</p>");

    fireEvent.dragEnter(wrapper, { dataTransfer: transfer(["Files"]) });
    expect(
      await screen.findByText("Drop images or files to upload"),
    ).toBeInTheDocument();
    // Moving onto a child is not leaving.
    leave(wrapper, dom);
    expect(
      screen.getByText("Drop images or files to upload"),
    ).toBeInTheDocument();
    leave(wrapper, document.body);
    await waitFor(() =>
      expect(screen.queryByText("Drop images or files to upload")).toBeNull(),
    );
  });

  it("accepts a file drag over it, and ignores other drags", async () => {
    const { wrapper } = await renderEditor("<p>hi</p>");
    const files = transfer(["Files"]);

    expect(fireEvent.dragOver(wrapper, { dataTransfer: files })).toBe(false);
    expect(files.dropEffect).toBe("copy");
    expect(
      fireEvent.dragOver(wrapper, { dataTransfer: transfer(["text/plain"]) }),
    ).toBe(true);
  });

  it("sends dropped files to the upload path at the drop point", async () => {
    const { wrapper, dom } = await renderEditor("<p>hi</p>");
    document.elementFromPoint = () => dom.querySelector("p");
    const received = vi.fn();
    dom.addEventListener("wikihub:editor-files", received);
    const file = new File(["x"], "a.txt");

    fireEvent.drop(wrapper, {
      dataTransfer: transfer(["Files"], [file]),
      clientX: 5,
      clientY: 5,
    });
    expect((received.mock.calls[0]![0] as CustomEvent).detail).toEqual([file]);
    // A drop with nothing in it is left alone.
    fireEvent.drop(wrapper, { dataTransfer: transfer([], []) });
    expect(received).toHaveBeenCalledTimes(1);
  });

  it("does not offer the file hint while a node is being moved", async () => {
    const { wrapper, dom } = await renderEditor("<p>hi</p>");

    dom.dispatchEvent(
      new CustomEvent("wikihub:internal-node-drag-start", {
        bubbles: true,
        detail: { pos: 0 },
      }),
    );
    const moving = transfer(["Files"]);
    fireEvent.dragEnter(wrapper, { dataTransfer: moving });
    expect(screen.queryByText("Drop images or files to upload")).toBeNull();
    expect(fireEvent.dragOver(wrapper, { dataTransfer: moving })).toBe(false);
    expect(moving.dropEffect).toBe("move");
    fireEvent.drop(wrapper, { dataTransfer: moving });
    dom.dispatchEvent(
      new CustomEvent("wikihub:internal-node-drag-end", { bubbles: true }),
    );
    // A drag-start without a position still counts as a move in flight.
    dom.dispatchEvent(
      new CustomEvent("wikihub:internal-node-drag-start", {
        bubbles: true,
        detail: {},
      }),
    );
    dom.dispatchEvent(
      new CustomEvent("wikihub:internal-node-drag-end", { bubbles: true }),
    );
  });
});

describe("dropping a moved node", () => {
  async function startMove(html: string, pos: number | undefined) {
    const view = await renderEditor(html);
    document.elementFromPoint = () => view.dom.querySelector("p");
    view.dom.dispatchEvent(
      new CustomEvent("wikihub:internal-node-drag-start", {
        bubbles: true,
        detail: { pos },
      }),
    );
    return view;
  }
  const drop = (editor: TestEditor) =>
    plugin(editor, "handleDrop", { clientX: 1, clientY: 1 }, null, true);

  it("is left to the editor when no move was started", async () => {
    const { editor } = await renderEditor(
      '<p>hi</p><img src="/x.png" alt="x">',
    );

    expect(drop(editor)).toBeFalsy();
  });

  it("swallows a drop it cannot place", async () => {
    const noPosition = await startMove(
      '<p>hi</p><img src="/x.png" alt="x">',
      undefined,
    );
    expect(drop(noPosition.editor)).toBe(true);
    noPosition.unmount();

    const notDraggable = await startMove(
      '<p>hi</p><img src="/x.png" alt="x">',
      1,
    );
    expect(drop(notDraggable.editor)).toBe(true);
  });

  it("swallows a drop that lands nowhere, or back on the node itself", async () => {
    const lost = await startMove('<p>hi</p><img src="/y.png" alt="y">', 4);
    document.elementFromPoint = () => null;
    expect(drop(lost.editor)).toBe(true);
    lost.unmount();

    const onItself = await startMove('<p>hi</p><img src="/z.png" alt="z">', 4);
    (
      onItself.editor.view as unknown as { posAtCoords: () => { pos: number } }
    ).posAtCoords = () => ({ pos: 4 });
    expect(drop(onItself.editor)).toBe(true);
    expect(onItself.editor.getHTML()).toContain("z.png");
  });
});
