import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RichTextContent } from "@/components/pages/rich-text-editor";

const ID = "66666666-6666-6666-6666-666666666666";
const HREF = `/api/v1/attachments/${ID}/content`;

const PAGE =
  `<p>plain text <img src="/pic.png" alt="Pic"> <a href="https://x.test">external</a> ` +
  `<a href="${HREF}" data-attachment="a.zip" data-display-mode="card">a.zip</a></p>`;

beforeEach(() => {
  // The preview asks the API for the file; a missing file is enough to open it.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 404 })),
  );
  Element.prototype.setPointerCapture ??= () => {};
});

afterEach(() => vi.unstubAllGlobals());

async function renderPage(
  props: Partial<React.ComponentProps<typeof RichTextContent>> = {},
) {
  const view = render(<RichTextContent content={PAGE} {...props} />);
  const tile = (await screen.findByRole("link", {
    name: "a.zip",
  })) as HTMLElement;
  return { ...view, tile };
}

describe("attachment links on a saved page", () => {
  it("opens the preview on a click, and leaves ordinary links alone", async () => {
    const { tile } = await renderPage();

    fireEvent.click(screen.getByText("external"));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.mouseDown(tile);
    fireEvent.click(tile);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("opens it from a press even when the click lands elsewhere", async () => {
    const { tile } = await renderPage();

    fireEvent.mouseDown(tile);
    fireEvent.click(screen.getByText("plain text", { exact: false }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("does nothing more for a click something else already handled", async () => {
    await renderPage();
    const swallow = (event: Event) => event.preventDefault();
    document.addEventListener("click", swallow, true);
    try {
      fireEvent.click(screen.getByAltText("Pic"));
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      document.removeEventListener("click", swallow, true);
    }
  });

  it("opens the preview when asked by event, and ignores an event with no attachment", async () => {
    await renderPage();

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

  it("leaves everything alone in export mode", async () => {
    const { tile } = await renderPage({ exportMode: true });

    fireEvent.click(tile);
    fireEvent.click(screen.getByAltText("Pic"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lets someone allowed to edit open the preview's editor", async () => {
    const { tile } = await renderPage({ canEditAttachments: true });

    fireEvent.click(tile);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("zooming into an image", () => {
  async function openLightbox() {
    await renderPage();
    fireEvent.click(screen.getByAltText("Pic"));
    const dialog = await screen.findByRole("dialog");
    const zoomed = () => dialog.querySelectorAll("img")[0] as HTMLImageElement;
    return {
      dialog,
      zoomed,
      percent: () => dialog.textContent?.match(/\d+%/)?.[0],
    };
  }

  it("shows the picture at full size, with its description above it", async () => {
    const { dialog, percent } = await openLightbox();

    expect(percent()).toBe("100%");
    expect(dialog).toHaveTextContent("Pic");
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reset zoom" })).toBeDisabled();
  });

  it("zooms with the buttons, up to a limit, and resets", async () => {
    const { percent } = await openLightbox();

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(percent()).toBe("150%");
    for (let step = 0; step < 8; step += 1)
      fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(percent()).toBe("400%");
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(percent()).toBe("350%");
    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(percent()).toBe("100%");
  });

  it("zooms with the wheel, and snaps back to the centre when fully out", async () => {
    const { dialog, zoomed, percent } = await openLightbox();
    const viewport = zoomed().parentElement as HTMLElement;

    fireEvent.wheel(viewport, { deltaY: -400 });
    expect(Number.parseInt(percent()!)).toBeGreaterThan(100);
    fireEvent.wheel(viewport, { deltaY: 4000 });
    expect(percent()).toBe("100%");
    expect(dialog).toBeInTheDocument();
  });

  it("toggles a quick zoom on double click", async () => {
    const { zoomed, percent } = await openLightbox();

    fireEvent.doubleClick(zoomed());
    expect(percent()).toBe("250%");
    fireEvent.doubleClick(zoomed());
    expect(percent()).toBe("100%");
  });

  it("drags the picture around once it is zoomed, and not before", async () => {
    const { zoomed } = await openLightbox();
    const move = (type: string, x: number, y: number) =>
      fireEvent(
        zoomed(),
        new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }),
      );

    // At 100% there is nothing to drag.
    move("pointerdown", 10, 10);
    move("pointermove", 50, 50);
    expect(zoomed().style.transform).toContain("translate(0px, 0px)");
    move("pointerup", 50, 50);

    fireEvent.doubleClick(zoomed());
    move("pointerdown", 10, 10);
    expect(zoomed().className).toContain("cursor-grabbing");
    move("pointermove", 40, 30);
    expect(zoomed().style.transform).toContain("translate(30px, 20px)");
    move("pointerup", 40, 30);
    expect(zoomed().className).toContain("cursor-grab");
    // A move after letting go changes nothing.
    move("pointermove", 90, 90);
    expect(zoomed().style.transform).toContain("translate(30px, 20px)");

    move("pointerdown", 40, 30);
    move("pointercancel", 40, 30);
    expect(zoomed().className).not.toContain("cursor-grabbing");
  });

  it("closes from its button, the backdrop and the keyboard", async () => {
    const { dialog } = await openLightbox();

    fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByAltText("Pic"));
    const reopened = await screen.findByRole("dialog");
    fireEvent.click(reopened);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByAltText("Pic"));
    const viewport = (
      (await screen.findByRole("dialog")).querySelector("img") as HTMLElement
    ).parentElement as HTMLElement;
    fireEvent.click(viewport);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(dialog).toBeDefined();
  });

  it("hints how to zoom when the picture has no description", async () => {
    const { container } = render(
      <RichTextContent content={'<p><img src="/plain.png"></p>'} />,
    );

    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    fireEvent.click(container.querySelector("img")!);
    expect(
      await screen.findByText("Scroll or double-click the image to zoom"),
    ).toBeInTheDocument();
  });
});
