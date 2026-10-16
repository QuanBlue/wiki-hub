import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PdfAttachmentPreview } from "@/components/pages/pdf-attachment-preview";

const pdf = vi.hoisted(() => ({
  getDocument: vi.fn(),
  workerSrc: "",
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {
    set workerSrc(value: string) {
      pdf.workerSrc = value;
    },
    get workerSrc() {
      return pdf.workerSrc;
    },
  },
  getDocument: pdf.getDocument,
}));

type FakePage = {
  getViewport: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
};

function fakePage(renderImpl?: () => { promise: Promise<void>; cancel?: () => void }): FakePage {
  return {
    getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale })),
    render: vi.fn(renderImpl ?? (() => ({ promise: Promise.resolve(), cancel: vi.fn() }))),
  };
}

function fakeDocument(pages: FakePage[], destroy = vi.fn()) {
  return {
    numPages: pages.length,
    getPage: vi.fn(async (n: number) => pages[n - 1]),
    destroy,
  };
}

function openDocument(doc: ReturnType<typeof fakeDocument>) {
  pdf.getDocument.mockReturnValue({ promise: Promise.resolve(doc) });
}

function stubFetch(ok = true) {
  const spy = vi.fn(async () => ({
    ok,
    arrayBuffer: async () => new ArrayBuffer(8),
  }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function stubCanvas(available = true) {
  const context = { drawImage: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => (available ? context : null)) as never,
  );
  return context;
}

beforeEach(() => {
  pdf.getDocument.mockReset();
  vi.useRealTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

describe("PdfAttachmentPreview", () => {
  it("draws every page of the document", async () => {
    const context = stubCanvas();
    stubFetch();
    const pages = [fakePage(), fakePage()];
    openDocument(fakeDocument(pages));
    render(<PdfAttachmentPreview contentUrl="/a.pdf" filename="a.pdf" />);

    expect(screen.getByText("Loading PDF pages...")).toBeInTheDocument();
    expect(await screen.findByLabelText("PDF page 2")).toBeInTheDocument();
    await waitFor(() => expect(context.drawImage).toHaveBeenCalledTimes(2));
    expect(pdf.workerSrc).toBe("/vendor/pdfjs/pdf.worker.min.mjs");
  });

  it("zooms, resets, rotates and expands from its toolbar", async () => {
    stubCanvas();
    stubFetch();
    openDocument(fakeDocument([fakePage()]));
    const onExpandedChange = vi.fn();
    const user = userEvent.setup();
    render(
      <PdfAttachmentPreview
        contentUrl="/a.pdf"
        filename="a.pdf"
        onExpandedChange={onExpandedChange}
      />,
    );
    await screen.findByLabelText("PDF page 1");
    await settle();

    const percent = () => screen.getByRole("button", { name: "Actual size" }).textContent;
    // jsdom has no layout, so the page is fitted to the smallest size at first.
    await user.click(screen.getByRole("button", { name: "Actual size" }));
    expect(percent()).toBe("100%");
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(percent()).toBe("110%");
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(percent()).toBe("90%");
    await user.click(screen.getByRole("button", { name: "Rotate pages" }));
    await user.click(screen.getByRole("button", { name: "Expand preview" }));

    expect(onExpandedChange).toHaveBeenCalledWith(true);
  });

  it("keeps its own expanded state when nobody else controls it, and puts the toolbar where asked", async () => {
    stubCanvas();
    stubFetch();
    openDocument(fakeDocument([fakePage()]));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const user = userEvent.setup();
    render(
      <PdfAttachmentPreview contentUrl="/a.pdf" filename="a.pdf" toolbarContainer={host} />,
    );
    await screen.findByLabelText("PDF page 1");

    await user.click(screen.getByRole("button", { name: "Expand preview" }));

    expect(host.querySelector('button[aria-label="Shrink preview"]')).not.toBeNull();
    host.remove();
  });

  it("stops zooming at the smallest and largest sizes", async () => {
    stubCanvas();
    stubFetch();
    openDocument(fakeDocument([fakePage()]));
    const user = userEvent.setup();
    render(<PdfAttachmentPreview contentUrl="/a.pdf" filename="a.pdf" />);
    await screen.findByLabelText("PDF page 1");
    await settle();

    for (let i = 0; i < 12; i += 1) await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    for (let i = 0; i < 45; i += 1) await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled();
  });

  it("offers the file for download when it cannot be loaded", async () => {
    stubFetch(false);
    render(<PdfAttachmentPreview contentUrl="/a.pdf" filename="a.pdf" />);

    expect(await screen.findByText("Could not load this PDF file.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download PDF/ })).toHaveAttribute("href", "/a.pdf");
  });

  it("explains a document that cannot be opened with a general message", async () => {
    stubFetch();
    pdf.getDocument.mockReturnValue({ promise: Promise.reject("corrupt") });
    render(<PdfAttachmentPreview contentUrl="/a.pdf" filename="a.pdf" />);

    expect(await screen.findByText("Could not load this PDF file.")).toBeInTheDocument();
  });

  it("shows why a page could not be drawn, using the reason it was given or a general one", async () => {
    stubCanvas();
    stubFetch();
    openDocument(
      fakeDocument([
        fakePage(() => ({ promise: Promise.reject(new Error("Bad glyph")) })),
        fakePage(() => ({ promise: Promise.reject("odd") })),
      ]),
    );
    render(<PdfAttachmentPreview contentUrl="/a.pdf" filename="a.pdf" />);

    expect(await screen.findByText("Bad glyph")).toBeInTheDocument();
    expect(await screen.findByText("Could not render this page.")).toBeInTheDocument();
  });

  it("draws nothing when the browser cannot give it a canvas", async () => {
    const context = stubCanvas(false);
    stubFetch();
    openDocument(fakeDocument([fakePage()]));
    render(<PdfAttachmentPreview contentUrl="/a.pdf" filename="a.pdf" />);

    await screen.findByLabelText("PDF page 1");
    await settle();

    expect(context.drawImage).not.toHaveBeenCalled();
  });

  it("lets go of the document and the pending page when it is removed", async () => {
    stubCanvas();
    stubFetch();
    const cancel = vi.fn();
    const destroy = vi.fn();
    openDocument(
      fakeDocument([fakePage(() => ({ promise: new Promise<void>(() => {}), cancel }))], destroy),
    );
    const { unmount } = render(<PdfAttachmentPreview contentUrl="/a.pdf" filename="a.pdf" />);
    await screen.findByLabelText("PDF page 1");
    await settle();

    unmount();

    expect(cancel).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
  });

  it("destroys a document that finished loading after the preview was closed", async () => {
    stubCanvas();
    const destroy = vi.fn();
    let finish: (value: unknown) => void = () => {};
    pdf.getDocument.mockReturnValue({ promise: new Promise((resolve) => (finish = resolve)) });
    stubFetch();
    const { unmount } = render(<PdfAttachmentPreview contentUrl="/a.pdf" filename="a.pdf" />);
    await settle();

    unmount();
    await act(async () => {
      finish(fakeDocument([fakePage()], destroy));
    });

    await waitFor(() => expect(destroy).toHaveBeenCalled());
  });

  it("starts again for a different file", async () => {
    stubCanvas();
    const spy = stubFetch();
    openDocument(fakeDocument([fakePage()]));
    const { rerender } = render(<PdfAttachmentPreview contentUrl="/a.pdf" filename="a.pdf" />);
    await screen.findByLabelText("PDF page 1");

    openDocument(fakeDocument([fakePage(), fakePage(), fakePage()]));
    rerender(<PdfAttachmentPreview contentUrl="/b.pdf" filename="b.pdf" />);

    expect(await screen.findByLabelText("PDF page 3")).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
