import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RichTextContent,
  RichTextEditor,
  isAttachmentHref,
} from "@/components/pages/rich-text-editor";

const ID = "22222222-2222-2222-2222-222222222222";
const HREF = `/api/v1/attachments/${ID}/content`;

type TestEditor = {
  state: import("@tiptap/pm/state").EditorState;
  getHTML: () => string;
};

async function renderTile(html: string) {
  const onChange = vi.fn();
  const view = render(<RichTextEditor content={html} onChange={onChange} />);
  const tile = (await screen.findByRole("button", {
    name: "report.zip",
  })) as HTMLElement;
  const wrapper = tile.closest("[data-node-view-wrapper]") as HTMLElement;
  const editor = (
    view.container.querySelector(".ProseMirror") as HTMLElement & {
      editor: TestEditor;
    }
  ).editor;
  return { ...view, tile, wrapper, editor, onChange };
}

const CARD = `<p><a href="${HREF}" data-attachment="report.zip" data-display-mode="card">report.zip</a></p>`;
const LINK = `<p><a href="${HREF}" data-attachment="report.zip" data-display-mode="link">report.zip</a></p>`;

afterEach(() => vi.restoreAllMocks());

describe("isAttachmentHref", () => {
  it("recognises the URL shape of a stored attachment", () => {
    expect(isAttachmentHref(HREF)).toBe(true);
    expect(isAttachmentHref("/pages/some-page")).toBe(false);
  });
});

describe("attachment tile toolbar", () => {
  it("shows its tools on hover, and hides them shortly after the pointer leaves", async () => {
    const { wrapper } = await renderTile(CARD);

    expect(screen.queryByTitle("Remove attachment")).toBeNull();
    fireEvent.mouseEnter(wrapper);
    expect(await screen.findByTitle("Remove attachment")).toBeInTheDocument();
    fireEvent.mouseLeave(wrapper);
    await waitFor(() =>
      expect(screen.queryByTitle("Remove attachment")).toBeNull(),
    );

    // Re-entering before the timer fires keeps them.
    fireEvent.mouseEnter(wrapper);
    fireEvent.mouseLeave(wrapper);
    fireEvent.mouseEnter(wrapper);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(screen.getByTitle("Remove attachment")).toBeInTheDocument();
  });

  it("puts the tools above the tile when there is room, and below when there is not", async () => {
    const { wrapper, container } = await renderTile(CARD);
    const surface = container.querySelector(".ProseMirror") as HTMLElement;
    surface.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;

    wrapper.getBoundingClientRect = () => ({ top: 200 }) as DOMRect;
    fireEvent.mouseEnter(wrapper);
    const toolbar = (await screen.findByTitle("Remove attachment")).closest(
      "div.absolute",
    ) as HTMLElement;
    expect(toolbar.className).toContain("bottom-full");
    fireEvent.mouseLeave(wrapper);
    await waitFor(() =>
      expect(screen.queryByTitle("Remove attachment")).toBeNull(),
    );

    wrapper.getBoundingClientRect = () => ({ top: 10 }) as DOMRect;
    fireEvent.mouseEnter(wrapper);
    expect(
      (
        (await screen.findByTitle("Remove attachment")).closest(
          "div.absolute",
        ) as HTMLElement
      ).className,
    ).toContain("top-full");
  });

  it("switches between a card and a link", async () => {
    const { wrapper, editor } = await renderTile(CARD);

    fireEvent.mouseEnter(wrapper);
    fireEvent.click(await screen.findByTitle("Display as Link"));
    await waitFor(() =>
      expect(editor.getHTML()).toContain('data-display-mode="link"'),
    );
    fireEvent.mouseEnter(
      screen
        .getByRole("button", { name: "report.zip" })
        .closest("[data-node-view-wrapper]")!,
    );
    fireEvent.click(await screen.findByTitle("Display as Card"));
    await waitFor(() =>
      expect(editor.getHTML()).toContain('data-display-mode="card"'),
    );
  });

  it("asks for the file's details, and removes the tile", async () => {
    const opened = vi.fn();
    window.addEventListener("wikihub:open-attachment-modal", opened);
    try {
      const { wrapper, editor } = await renderTile(CARD);
      fireEvent.mouseEnter(wrapper);
      fireEvent.click(
        await screen.findByTitle("View file details and preview"),
      );
      expect(opened).toHaveBeenCalledTimes(1);
      expect((opened.mock.calls[0]![0] as CustomEvent).detail).toEqual({
        attachmentId: ID,
      });

      fireEvent.click(screen.getByTitle("Remove attachment"));
      await waitFor(() => expect(editor.getHTML()).not.toContain("report.zip"));
    } finally {
      window.removeEventListener("wikihub:open-attachment-modal", opened);
    }
  });

  it("downloads the file through a temporary link", async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const { wrapper } = await renderTile(CARD);

    fireEvent.mouseEnter(wrapper);
    fireEvent.click(await screen.findByTitle("Download file"));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("selects the tile on click and on Enter or Space, but ignores other keys", async () => {
    const { tile, editor } = await renderTile(CARD);

    fireEvent.keyDown(tile, { key: "a" });
    expect(editor.state.selection.constructor.name).not.toBe("NodeSelection");
    fireEvent.keyDown(tile, { key: "Enter" });
    expect(editor.state.selection.constructor.name).toBe("NodeSelection");
    act(() => {
      (
        editor as unknown as {
          commands: { setTextSelection: (p: number) => void };
        }
      ).commands.setTextSelection(1);
    });
    fireEvent.keyDown(tile, { key: " " });
    expect(editor.state.selection.constructor.name).toBe("NodeSelection");
    act(() => {
      (
        editor as unknown as {
          commands: { setTextSelection: (p: number) => void };
        }
      ).commands.setTextSelection(1);
    });
    // A click claims the event so the browser never follows the link.
    expect(fireEvent.click(tile)).toBe(false);
  });

  it("starts a move on drag, and does not offer one on a saved page", async () => {
    const { tile } = await renderTile(CARD);
    const dataTransfer = {
      effectAllowed: "none",
      dropEffect: "none",
      setData: vi.fn(),
      setDragImage: vi.fn(),
    };
    const started = vi.fn();
    document.addEventListener("wikihub:internal-node-drag-start", started);
    document.addEventListener("wikihub:internal-node-drag-end", started);
    try {
      fireEvent.dragStart(tile, { dataTransfer });
      fireEvent.dragEnd(tile, { dataTransfer });
      expect(started).toHaveBeenCalledTimes(2);
      expect(dataTransfer.effectAllowed).toBe("move");
    } finally {
      document.removeEventListener("wikihub:internal-node-drag-start", started);
      document.removeEventListener("wikihub:internal-node-drag-end", started);
    }

    render(
      <RichTextContent
        content={CARD.replace("report.zip", "saved.zip").replace(
          'data-attachment="report.zip"',
          'data-attachment="saved.zip"',
        )}
      />,
    );
    const saved = await screen.findByRole("link", { name: "saved.zip" });
    expect(fireEvent.dragStart(saved, { dataTransfer })).toBe(false);
  });
});

describe("attachment link tile", () => {
  it("shows a paperclip link, with the same tools", async () => {
    const { tile, wrapper, editor } = await renderTile(LINK);

    expect(tile).toHaveAttribute("data-display-mode", "link");
    fireEvent.keyDown(tile, { key: "Enter" });
    expect(editor.state.selection.constructor.name).toBe("NodeSelection");
    fireEvent.mouseEnter(wrapper);
    fireEvent.click(await screen.findByTitle("Display as Card"));
    await waitFor(() =>
      expect(editor.getHTML()).toContain('data-display-mode="card"'),
    );
  });

  it("starts a move, and marks added and deleted attachments", async () => {
    const { tile } = await renderTile(LINK);
    const dataTransfer = {
      effectAllowed: "none",
      dropEffect: "none",
      setData: vi.fn(),
      setDragImage: vi.fn(),
    };
    fireEvent.dragStart(tile, { dataTransfer });
    fireEvent.dragEnd(tile, { dataTransfer });
    expect(dataTransfer.effectAllowed).toBe("move");

    render(
      <RichTextContent
        content={
          `<p><a href="${HREF}" data-attachment="added.zip" data-display-mode="link" data-diff-kind="add">added.zip</a>` +
          `<a href="${HREF}" data-attachment="removed.zip" data-display-mode="link" data-diff-kind="delete">removed.zip</a>` +
          `<a href="${HREF}" data-attachment="gone.zip" data-display-mode="card" data-diff-kind="delete">gone.zip</a></p>`
        }
      />,
    );
    expect(await screen.findByRole("link", { name: "added.zip" })).toHaveClass(
      "bg-success-bg",
    );
    expect(screen.getByRole("link", { name: "removed.zip" })).toHaveClass(
      "line-through",
    );
    expect(screen.getByRole("link", { name: "gone.zip" })).toHaveClass(
      "border-danger",
    );
  });

  it("does not move a saved page's link tile", async () => {
    render(<RichTextContent content={LINK} />);
    const saved = await screen.findByRole("link", { name: "report.zip" });
    const dataTransfer = { effectAllowed: "none", dropEffect: "none" };

    expect(fireEvent.dragStart(saved, { dataTransfer })).toBe(false);
  });
});

describe("attachment icons and legacy markup", () => {
  it.each([
    "a.zip",
    "a.png",
    "a.mp4",
    "a.mp3",
    "a.xlsx",
    "a.pptx",
    "a.json",
    "a.pdf",
    "a.unknownext",
  ])("gives %s a tile", async (name) => {
    const { container } = render(
      <RichTextContent
        content={`<p><a href="${HREF}" data-attachment="${name}" data-display-mode="card">${name}</a></p>`}
      />,
    );

    await waitFor(() =>
      expect(container.querySelector("a[data-attachment-href]")).not.toBeNull(),
    );
    expect(
      container.querySelector(
        "[data-node-view-wrapper] svg, [data-node-view-wrapper] img",
      ),
    ).not.toBeNull();
  });

  it("previews an image attachment in its tile", async () => {
    const { container } = render(
      <RichTextContent
        content={`<p><a href="${HREF}" data-attachment="shot.png" data-display-mode="card">shot.png</a></p>`}
      />,
    );

    await waitFor(() =>
      expect(container.querySelector("a[data-attachment-href]")).not.toBeNull(),
    );
    expect(container.querySelector("img")).toHaveAttribute("src", HREF);
  });

  it("names a tile from its download hint when the text only says Download", async () => {
    render(
      <RichTextContent
        content={
          `<p><a href="${HREF}" data-attachment="download" title="Real.zip" data-display-mode="card">Download</a>` +
          `<a href="${HREF}" data-attachment="Download" download="other.zip" data-display-mode="card">Download</a>` +
          `<a href="${HREF}" data-attachment="Download" title="Download" download="Download">Download</a></p>`
        }
      />,
    );

    expect((await screen.findAllByRole("link")).length).toBeGreaterThan(0);
  });

  it("recognises an older attachment link by its URL, but not other links", async () => {
    render(
      <RichTextContent
        content={
          `<p><a href="${HREF}">old.zip</a> <a href="${HREF}">no extension</a> ` +
          `<a href="/somewhere/else.zip">else.zip</a> <a href="${HREF}" data-display-mode="card">card.zip</a></p>`
        }
      />,
    );

    expect(
      await screen.findByRole("link", { name: "old.zip" }),
    ).toHaveAttribute("data-display-mode", "link");
    expect(screen.getByRole("link", { name: "card.zip" })).toHaveAttribute(
      "data-display-mode",
      "card",
    );
    expect(
      screen.getByRole("link", { name: "no extension" }),
    ).not.toHaveAttribute("data-attachment-href");
  });

  it("falls back to the link's own text for a tile marked only by data-attachment", async () => {
    render(
      <RichTextContent
        content={`<p><a href="${HREF}" data-attachment="" class="attachment-link">plain.txt</a><a href="${HREF}" data-attachment="">  </a></p>`}
      />,
    );

    expect(
      await screen.findByRole("link", { name: "plain.txt" }),
    ).toBeInTheDocument();
  });
});
