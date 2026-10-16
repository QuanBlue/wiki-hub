import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PptxAttachmentPreview } from "@/components/pages/pptx-attachment-preview";

const deck = vi.hoisted(() => ({
  slideCount: 3,
  openError: null as unknown,
  thumbnailHandle: true,
  viewers: [] as unknown[],
}));

vi.mock("@aiden0z/pptx-renderer/browser", () => {
  class FakeViewer {
    slideCount = deck.slideCount;
    slideWidth = 960;
    slideHeight = 540;
    options: unknown;
    handles: { dispose: ReturnType<typeof vi.fn> }[] = [];
    destroy = vi.fn();
    open = vi.fn(async () => {
      if (deck.openError) throw deck.openError;
    });
    renderThumbnailToContainer = vi.fn((_index: number, el: HTMLElement) => {
      const run = document.createElement("p");
      run.style.fontFamily = "Fancy Sans";
      const known = document.createElement("p");
      known.style.fontFamily = "Georgia, serif";
      el.append(run, known);
      if (!deck.thumbnailHandle) return null;
      const handle = { dispose: vi.fn() };
      this.handles.push(handle);
      return handle;
    });
    renderSlideToContainer = vi.fn((_index: number, el: HTMLElement) => {
      const run = document.createElement("span");
      run.style.fontFamily = "Fancy Sans";
      el.appendChild(run);
      const handle = { dispose: vi.fn() };
      this.handles.push(handle);
      return handle;
    });
    constructor(_element: HTMLElement, options: unknown) {
      this.options = options;
      deck.viewers.push(this);
    }
  }
  return { PptxViewer: FakeViewer, RECOMMENDED_ZIP_LIMITS: { maxEntries: 1 } };
});

function stubFetch(ok = true) {
  const spy = vi.fn(async () => ({ ok, arrayBuffer: async () => new ArrayBuffer(4) }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

let fullscreen: Element | null = null;
const requestFullscreen = vi.fn();
const exitFullscreen = vi.fn();

function installFullscreen() {
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreen,
  });
  requestFullscreen.mockReset().mockImplementation(async function (this: Element) {
    fullscreen = this;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  exitFullscreen.mockReset().mockImplementation(async () => {
    fullscreen = null;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  (HTMLElement.prototype as unknown as { requestFullscreen: unknown }).requestFullscreen = requestFullscreen;
  (document as unknown as { exitFullscreen: unknown }).exitFullscreen = exitFullscreen;
}

function removeFullscreen() {
  fullscreen = null;
  delete (HTMLElement.prototype as unknown as { requestFullscreen?: unknown }).requestFullscreen;
  delete (document as unknown as { exitFullscreen?: unknown }).exitFullscreen;
  delete (document as unknown as { fullscreenElement?: unknown }).fullscreenElement;
}

beforeEach(() => {
  deck.slideCount = 3;
  deck.openError = null;
  deck.thumbnailHandle = true;
  deck.viewers = [];
  stubFetch();
  installFullscreen();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  removeFullscreen();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function loaded(props: Partial<React.ComponentProps<typeof PptxAttachmentPreview>> = {}) {
  const user = userEvent.setup();
  const view = render(<PptxAttachmentPreview contentUrl="/a.pptx" filename="a.pptx" {...props} />);
  await screen.findByText("1 / 3");
  await waitFor(() =>
    expect(document.querySelectorAll(".pptx-thumbnail-canvas")).toHaveLength(3),
  );
  // The thumbnails' handles are kept once the last one has been drawn.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
  return { user, view, viewer: deck.viewers[0] as { slideCount: number; renderSlideToContainer: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; handles: { dispose: ReturnType<typeof vi.fn> }[]; options: { pdfjs: { moduleUrl: string } } } };
}

describe("PptxAttachmentPreview", () => {
  it("shows the first slide and a thumbnail for each, with a readable font fallback", async () => {
    const { viewer } = await loaded();

    expect(viewer.options.pdfjs.moduleUrl).toMatch(/\/vendor\/pdfjs\/pdf\.min\.mjs$/);
    const thumbs = document.querySelectorAll<HTMLElement>(".pptx-thumbnail-canvas");
    expect(thumbs[0]!.dataset.active).toBe("true");
    expect(thumbs[1]!.dataset.active).toBe("false");
    expect(thumbs[0]!.querySelector<HTMLElement>("p")!.style.fontFamily).toContain("-apple-system");
    // A font that already names a generic family is left alone.
    expect(thumbs[0]!.querySelectorAll<HTMLElement>("p")[1]!.style.fontFamily).toBe("Georgia, serif");
    expect(document.querySelector<HTMLElement>(".pptx-main-slide span")!.style.fontFamily).toContain(
      "-apple-system",
    );
    expect(screen.getByText("Previewing a.pptx")).toBeInTheDocument();
  });

  it("moves between slides with the buttons, the arrow keys and the thumbnails", async () => {
    const { user } = await loaded();
    const previous = screen.getByRole("button", { name: "Previous slide" });
    const next = screen.getByRole("button", { name: "Next slide" });
    expect(previous).toBeDisabled();

    await user.click(next);
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(await screen.findByText("3 / 3")).toBeInTheDocument();
    expect(next).toBeDisabled();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(await screen.findByText("2 / 3")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "a" });
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    await user.click(previous);
    expect(screen.getByText("1 / 3")).toBeInTheDocument();

    fireEvent.click(document.querySelectorAll(".pptx-thumbnail-canvas")[2]!);
    expect(await screen.findByText("3 / 3")).toBeInTheDocument();
    expect(document.querySelectorAll<HTMLElement>(".pptx-thumbnail-canvas")[2]!.dataset.active).toBe("true");
  });

  it("zooms between 50% and 300%", async () => {
    const { user } = await loaded();
    const zoomOut = screen.getByRole("button", { name: "Zoom out" });
    const zoomIn = screen.getByRole("button", { name: "Zoom in" });

    await user.click(zoomOut);
    await user.click(zoomOut);
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(zoomOut).toBeDisabled();
    for (let i = 0; i < 10; i += 1) await user.click(zoomIn);
    expect(screen.getByText("300%")).toBeInTheDocument();
    expect(zoomIn).toBeDisabled();
  });

  it("puts its controls in the header when asked, with anything the header adds after them", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    await loaded({ toolbarContainer: host, headerAfterControls: <span>after</span> });

    expect(host.querySelector('button[aria-label="Zoom in"]')).not.toBeNull();
    expect(host.textContent).toContain("after");
    expect(document.querySelector(".pptx-toolbar")).toBeNull();
    host.remove();
  });

  it("starts a slideshow in fullscreen, and ends it with Escape or the exit button", async () => {
    const { user } = await loaded();

    await user.click(screen.getByRole("button", { name: "Start slideshow" }));
    expect(requestFullscreen).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Exit presentation" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zoom in" })).toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Exit presentation" })).toBeNull());
    expect(exitFullscreen).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Start slideshow" }));
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Exit presentation" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Exit presentation" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Exit presentation" })).toBeNull());
  });

  it("follows the browser leaving fullscreen on its own", async () => {
    const { user } = await loaded();
    await user.click(screen.getByRole("button", { name: "Start slideshow" }));
    expect(screen.getByRole("button", { name: "Exit presentation" })).toBeInTheDocument();

    await act(async () => {
      fullscreen = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });

    expect(screen.queryByRole("button", { name: "Exit presentation" })).toBeNull();
  });

  it("still presents, without fullscreen, where the browser has none or refuses it", async () => {
    delete (HTMLElement.prototype as unknown as { requestFullscreen?: unknown }).requestFullscreen;
    const { user } = await loaded();
    await user.click(screen.getByRole("button", { name: "Start slideshow" }));
    expect(screen.getByRole("button", { name: "Exit presentation" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Exit presentation" }));

    requestFullscreen.mockImplementation(() => Promise.reject(new Error("denied")));
    (HTMLElement.prototype as unknown as { requestFullscreen: unknown }).requestFullscreen = requestFullscreen;
    await user.click(screen.getByRole("button", { name: "Start slideshow" }));
    expect(screen.getByRole("button", { name: "Exit presentation" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Exit presentation" }));

    requestFullscreen.mockImplementation(() => {
      throw new Error("blocked");
    });
    await user.click(screen.getByRole("button", { name: "Start slideshow" }));
    expect(screen.getByRole("button", { name: "Exit presentation" })).toBeInTheDocument();
  });

  it("uses the prefixed fullscreen calls of older Safari", async () => {
    delete (HTMLElement.prototype as unknown as { requestFullscreen?: unknown }).requestFullscreen;
    delete (document as unknown as { exitFullscreen?: unknown }).exitFullscreen;
    const webkitRequest = vi.fn(function (this: Element) {
      fullscreen = this;
    });
    const webkitExit = vi.fn(() => {
      fullscreen = null;
    });
    (HTMLElement.prototype as unknown as { webkitRequestFullscreen: unknown }).webkitRequestFullscreen = webkitRequest;
    (document as unknown as { webkitExitFullscreen: unknown }).webkitExitFullscreen = webkitExit;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => null });
    Object.defineProperty(document, "webkitFullscreenElement", { configurable: true, get: () => fullscreen });
    try {
      const { user, view } = await loaded();
      await user.click(screen.getByRole("button", { name: "Start slideshow" }));
      expect(webkitRequest).toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Exit presentation" }));
      expect(webkitExit).toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Start slideshow" }));
      view.unmount();
      expect(webkitExit).toHaveBeenCalledTimes(2);
    } finally {
      delete (HTMLElement.prototype as unknown as { webkitRequestFullscreen?: unknown }).webkitRequestFullscreen;
      delete (document as unknown as { webkitExitFullscreen?: unknown }).webkitExitFullscreen;
      delete (document as unknown as { webkitFullscreenElement?: unknown }).webkitFullscreenElement;
    }
  });

  it("leaves fullscreen when it is removed mid-slideshow", async () => {
    const { user, view } = await loaded();
    await user.click(screen.getByRole("button", { name: "Start slideshow" }));

    view.unmount();

    expect(exitFullscreen).toHaveBeenCalled();
  });

  it("lets go of every slide and the viewer when it is removed", async () => {
    const { view, viewer } = await loaded();

    view.unmount();

    expect(viewer.destroy).toHaveBeenCalled();
    expect(viewer.handles.length).toBeGreaterThan(0);
    for (const handle of viewer.handles) expect(handle.dispose).toHaveBeenCalled();
  });

  it("copes with a renderer that gives no handle for a thumbnail", async () => {
    deck.thumbnailHandle = false;
    const { view } = await loaded();

    expect(() => view.unmount()).not.toThrow();
  });

  it("starts again for another file", async () => {
    const { view, viewer } = await loaded();

    view.rerender(<PptxAttachmentPreview contentUrl="/b.pptx" filename="b.pptx" />);

    await waitFor(() => expect(deck.viewers).toHaveLength(2));
    expect(viewer.destroy).toHaveBeenCalled();
  });

  it("fits the slide to the height and resets the zoom when expanded", async () => {
    const { user, view } = await loaded();
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("125%")).toBeInTheDocument();

    view.rerender(<PptxAttachmentPreview contentUrl="/a.pptx" filename="a.pptx" expanded />);

    await waitFor(() => expect(screen.getByText("100%")).toBeInTheDocument());
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))));
    });
  });

  it("redraws the slide when its panel is resized", async () => {
    let notify: () => void = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    const { viewer } = await loaded();
    const before = viewer.renderSlideToContainer.mock.calls.length;

    await act(async () => notify());

    expect(viewer.renderSlideToContainer.mock.calls.length).toBeGreaterThan(before);
  });

  it("explains a file that cannot be fetched", async () => {
    stubFetch(false);
    render(<PptxAttachmentPreview contentUrl="/a.pptx" filename="a.pptx" />);

    expect(await screen.findByText("Could not load this PowerPoint file.")).toBeInTheDocument();
  });

  it("explains a file that cannot be read, using the reason when there is one", async () => {
    deck.openError = new Error("Not a presentation.");
    const first = render(<PptxAttachmentPreview contentUrl="/a.pptx" filename="a.pptx" />);
    expect(await screen.findByText("Not a presentation.")).toBeInTheDocument();
    first.unmount();

    deck.openError = "weird";
    render(<PptxAttachmentPreview contentUrl="/a.pptx" filename="a.pptx" />);
    expect(await screen.findByText("Could not load this PowerPoint file.")).toBeInTheDocument();
  });

  it("says nothing about a file that was abandoned while it was still loading", async () => {
    const { unmount } = render(<PptxAttachmentPreview contentUrl="/a.pptx" filename="a.pptx" />);
    unmount();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect(deck.viewers).toHaveLength(0);
  });
});
