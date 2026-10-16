import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OfficeAttachmentPreview } from "@/components/pages/office-attachment-preview";

const m = vi.hoisted(() => ({
  prepare: vi.fn(),
  theme: "light" as string | undefined,
  pptxProps: null as null | Record<string, unknown>,
  renderer: { node: null as ReactNode, onError: null as null | ((error: Error) => void), file: null as unknown },
}));

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: m.theme }) }));
vi.mock("@/lib/xlsx-preview-workbook", () => ({ prepareWorkbookForPreview: m.prepare }));
vi.mock("next/dynamic", () => ({
  default: (load: () => Promise<unknown>) => {
    void Promise.resolve(load()).catch(() => undefined);
    return function PptxStub(props: Record<string, unknown>) {
      m.pptxProps = props;
      return (
        <div data-testid="pptx">
          {props.headerAfterControls as ReactNode}
        </div>
      );
    };
  },
}));
vi.mock("@lamberl-lee/file-preview", () => ({
  createBasePreviewRegistry: () => ({ list: () => [] }),
  createPreviewPluginRegistry: (plugins: unknown[]) => plugins,
  detectFileType: (name: string) => (/\.(docx|xlsx|pptx)$/i.exec(name)?.[1] ?? "other").toLowerCase(),
  enUS: {},
  LocaleProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  PluginPreviewRenderer: ({
    file,
    onError,
  }: {
    file: unknown;
    onError: (error: Error) => void;
  }) => {
    m.renderer.file = file;
    m.renderer.onError = onError;
    return <>{m.renderer.node}</>;
  },
}));
vi.mock("@lamberl-lee/file-preview/plugins/docx", () => ({ docxPlugin: {} }));
vi.mock("@lamberl-lee/file-preview/plugins/pptx", () => ({ pptxPlugin: {} }));
vi.mock("@lamberl-lee/file-preview/plugins/xlsx", () => ({ xlsxPlugin: {} }));

type Box = { left: number; top: number; width: number; height: number };
const boxes = new WeakMap<Element, Box>();
const widths = new WeakMap<Element, number>();
const layout = { tableWidth: 300, contentWidth: 580, docxPage: 1000, hostWidth: 800 };

function box(el: Element): Box {
  const explicit = boxes.get(el);
  if (explicit) return explicit;
  const cls = (el as HTMLElement).className ?? "";
  if (typeof cls === "string") {
    if (cls.includes("office-preview-card--xlsx")) return { left: 0, top: 0, width: 600, height: 350 };
    if (cls.includes("fv-xlsx__table")) return { left: 0, top: 30, width: layout.tableWidth, height: 100 };
    if (cls.includes("fv-xlsx__content")) return { left: 0, top: 20, width: 600, height: 300 };
    if (cls.includes("fv-xlsx__col-header")) {
      const index = Array.from(el.parentElement!.children).indexOf(el);
      return { left: 40 + index * 100, top: 20, width: 100, height: 22 };
    }
    if (cls.includes("fv-xlsx__row-num")) {
      const index = Array.from(el.closest("tbody")!.children).indexOf(el.closest("tr")!);
      return { left: 0, top: 50 + index * 22, width: 40, height: 22 };
    }
    if (cls.includes("docx") && el.tagName === "SECTION") return { left: 0, top: 0, width: layout.docxPage, height: 1400 };
  }
  if (el.tagName === "TR") {
    const index = Array.from(el.parentElement!.children).indexOf(el);
    return { left: 0, top: 50 + index * 22, width: 300, height: 22 };
  }
  return { left: 0, top: 0, width: 0, height: 0 };
}

function FakeXlsx({ info = "Sheet1 - 2 rows", extraHeaders = true }: { info?: string; extraHeaders?: boolean }) {
  const [zoom, setZoom] = useState(100);
  return (
    <div className="fv-xlsx">
      <div>
        <button className="fv-xlsx__zoom-btn" onClick={() => setZoom((z) => Math.max(10, z - 10))}>
          -
        </button>
        <span className="fv-xlsx__zoom-label">{zoom}%</span>
        <button className="fv-xlsx__zoom-btn" onClick={() => setZoom((z) => Math.min(200, z + 10))}>
          +
        </button>
        <span className="fv-xlsx__info">{info}</span>
      </div>
      <div className="fv-xlsx__content">
        <table className="fv-xlsx__table">
          <thead>
            <tr>
              {extraHeaders ? <th className="fv-xlsx__col-header">A</th> : null}
              {extraHeaders ? <th className="fv-xlsx__col-header">B</th> : null}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="fv-xlsx__row-num">1</td>
            </tr>
            <tr>
              <td className="fv-xlsx__row-num">2</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

const frame = () =>
  act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))));
  });

beforeEach(() => {
  m.theme = "light";
  m.pptxProps = null;
  m.renderer.node = null;
  m.renderer.onError = null;
  m.renderer.file = null;
  layout.tableWidth = 300;
  layout.docxPage = 1000;
  layout.hostWidth = 800;
  m.prepare.mockReset().mockResolvedValue(new ArrayBuffer(4));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) })),
  );
  URL.createObjectURL = vi.fn(() => "blob:fixed");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const { left, top, width, height } = box(this);
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      if (widths.has(this)) return widths.get(this)!;
      if (this.className?.toString().includes("fv-xlsx__content")) return layout.contentWidth;
      if (this.className?.toString().includes("office-docx-preview-host")) return layout.hostWidth;
      return 0;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as unknown as { clientWidth?: unknown }).clientWidth;
});

const mount = (props: Partial<React.ComponentProps<typeof OfficeAttachmentPreview>> = {}) =>
  render(
    <OfficeAttachmentPreview
      contentUrl="/f.docx"
      filename="plan.docx"
      contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      {...props}
    />,
  );

describe("OfficeAttachmentPreview presentations", () => {
  it("hands a presentation to the slide viewer, with its own expand button", async () => {
    const onExpandedChange = vi.fn();
    const user = userEvent.setup();
    mount({ filename: "deck.pptx", contentUrl: "/d.pptx", onExpandedChange });

    expect(screen.getByTestId("pptx")).toBeInTheDocument();
    expect(m.pptxProps).toMatchObject({ contentUrl: "/d.pptx", filename: "deck.pptx", expanded: false });
    await user.click(screen.getByRole("button", { name: "Expand preview" }));
    expect(onExpandedChange).toHaveBeenCalledWith(true);
  });

  it("moves the expand button into the viewer's header when there is one", async () => {
    const host = document.createElement("div");
    const onExpandedChange = vi.fn();
    const user = userEvent.setup();
    m.theme = "dark";
    const { container } = mount({
      filename: "deck.pptx",
      expanded: true,
      toolbarContainer: host,
      onExpandedChange,
    });

    expect(container.querySelector('[data-fv-theme="dark"]')).not.toBeNull();
    const shrink = within(screen.getByTestId("pptx")).getByRole("button", { name: "Shrink preview" });
    await user.click(shrink);
    expect(onExpandedChange).toHaveBeenCalledWith(false);
  });

  it("tells a presentation from its extension when the type is unknown", () => {
    mount({ filename: "DECK.PPTX", contentType: "application/octet-stream" });

    expect(screen.getByTestId("pptx")).toBeInTheDocument();
  });
});

describe("OfficeAttachmentPreview documents", () => {
  it("fits a wide page to the width, then zooms and resets from its own toolbar", async () => {
    const user = userEvent.setup();
    m.renderer.node = (
      <div className="docx-wrapper">
        <section className="docx">page</section>
      </div>
    );
    const { container } = mount();
    await frame();

    await waitFor(() => expect(screen.getByRole("button", { name: "Reset zoom" })).toHaveTextContent("70%"));
    expect(container.querySelector('[data-fit-width="true"]')).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByRole("button", { name: "Reset zoom" })).toHaveTextContent("80%");
    expect(container.querySelector('[data-fit-width="true"]')).toBeNull();
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByRole("button", { name: "Reset zoom" })).toHaveTextContent("60%");
    await user.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(screen.getByRole("button", { name: "Reset zoom" })).toHaveTextContent("100%");
  });

  it("stops zooming at the smallest and largest sizes", async () => {
    const user = userEvent.setup();
    mount();
    for (let i = 0; i < 10; i += 1) await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    for (let i = 0; i < 20; i += 1) await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled();
  });

  it("keeps trying to fit until the page has been drawn", async () => {
    layout.hostWidth = 0;
    mount();
    await frame();
    expect(screen.getByRole("button", { name: "Reset zoom" })).toHaveTextContent("100%");

    layout.hostWidth = 800;
    layout.docxPage = 0;
    m.renderer.node = (
      <div className="docx-wrapper">
        <section className="docx">page</section>
      </div>
    );
    const { rerender } = mount({ contentUrl: "/g.docx" });
    rerender(
      <OfficeAttachmentPreview
        contentUrl="/g.docx"
        filename="plan.docx"
        contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        expanded
      />,
    );
    await frame();
    expect(screen.getAllByRole("button", { name: "Reset zoom" }).at(-1)).toHaveTextContent("100%");
  });

  it("puts its controls in the header when asked, with the expand button after them", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onExpandedChange = vi.fn();
    const user = userEvent.setup();
    mount({ toolbarContainer: host, onExpandedChange });

    expect(within(host).getByRole("button", { name: "Reset zoom" })).toBeInTheDocument();
    await user.click(within(host).getByRole("button", { name: "Expand preview" }));
    expect(onExpandedChange).toHaveBeenCalledWith(true);
    expect(document.querySelector(".office-docx-toolbar")).toBeNull();
    host.remove();
  });

  it("offers a download when the file cannot be previewed", async () => {
    mount();
    act(() => m.renderer.onError?.(new Error("Corrupt file.")));

    expect(await screen.findByText("Corrupt file.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download/ })).toHaveAttribute("href", "/f.docx");
  });

  it("shrinks back from the expanded view", async () => {
    const onExpandedChange = vi.fn();
    const user = userEvent.setup();
    mount({ expanded: true, onExpandedChange });

    await user.click(screen.getByRole("button", { name: "Shrink preview" }));

    expect(onExpandedChange).toHaveBeenCalledWith(false);
  });
});

describe("OfficeAttachmentPreview workbooks", () => {
  const xlsx = (props: Partial<React.ComponentProps<typeof OfficeAttachmentPreview>> = {}) =>
    mount({ contentUrl: "/w.xlsx", filename: "book.xlsx", contentType: "application/xlsx", ...props });

  it("previews a corrected copy of the workbook, and gives the copy back when it is removed", async () => {
    m.renderer.node = <FakeXlsx />;
    const { unmount } = xlsx();

    await waitFor(() => expect((m.renderer.file as { source: { url: string } }).source.url).toBe("blob:fixed"));
    expect(m.prepare).toHaveBeenCalled();

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fixed");
  });

  it("falls back to the file itself when the copy cannot be made", async () => {
    m.prepare.mockRejectedValue(new Error("bad zip"));
    m.renderer.node = <FakeXlsx />;
    xlsx();

    await waitFor(() => expect((m.renderer.file as { source: { url: string } }).source.url).toBe("/w.xlsx"));
  });

  it("falls back to the file itself when it cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
    m.renderer.node = <FakeXlsx />;
    xlsx();

    await waitFor(() => expect((m.renderer.file as { source: { url: string } }).source.url).toBe("/w.xlsx"));
  });

  it("draws nothing for a workbook that was abandoned while it was being prepared", async () => {
    let finish: (value: ArrayBuffer) => void = () => {};
    m.prepare.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    m.renderer.node = <FakeXlsx />;
    const { unmount } = xlsx();
    await waitFor(() => expect(m.prepare).toHaveBeenCalled());

    unmount();
    await act(async () => {
      finish(new ArrayBuffer(1));
    });

    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("zooms the sheet out to fit its width", async () => {
    layout.tableWidth = 1000;
    m.renderer.node = <FakeXlsx />;
    xlsx();

    await waitFor(() => expect(document.querySelector(".fv-xlsx__zoom-label")).toHaveTextContent("50%"));
  });

  it("zooms the sheet in when it is narrower than the preview, but never beyond 100%", async () => {
    layout.tableWidth = 100;
    m.renderer.node = <FakeXlsx />;
    xlsx();
    await frame();

    expect(document.querySelector(".fv-xlsx__zoom-label")).toHaveTextContent("100%");
  });

  it("shows the sheet's zoom and information beside the header controls, and drives the sheet's own buttons", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const user = userEvent.setup();
    m.renderer.node = <FakeXlsx />;
    xlsx({ toolbarContainer: host });
    await frame();

    await waitFor(() => expect(within(host).getByText("Sheet1 - 2 rows")).toBeInTheDocument());
    expect(within(host).getByText("100%")).toBeInTheDocument();
    await user.click(within(host).getByRole("button", { name: "Zoom out" }));
    await waitFor(() => expect(within(host).getByText("90%")).toBeInTheDocument());
    await user.click(within(host).getByRole("button", { name: "Zoom in" }));
    await waitFor(() => expect(within(host).getByText("100%")).toBeInTheDocument());
    host.remove();
  });

  it("disables zooming at the ends of its range", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const user = userEvent.setup();
    layout.tableWidth = 100;
    m.renderer.node = <FakeXlsx />;
    xlsx({ toolbarContainer: host });
    await frame();

    for (let i = 0; i < 6; i += 1) {
      await user.click(within(host).getByRole("button", { name: "Zoom out" }));
      await frame();
    }
    await waitFor(() => expect(within(host).getByRole("button", { name: "Zoom out" })).toBeDisabled());
    host.remove();
  });

  it("draws the empty rows and columns of the sheet around the data", async () => {
    m.renderer.node = <FakeXlsx />;
    const { container } = xlsx();
    await frame();

    await waitFor(() => expect(container.querySelector(".office-xlsx-column-headers")).not.toBeNull());
    // Two real columns, then enough blank ones to fill the width.
    expect(container.querySelectorAll(".office-xlsx-column-headers span").length).toBeGreaterThan(2);
    expect(container.querySelectorAll(".office-xlsx-row-headers span")).toHaveLength(2);
    expect(container.querySelectorAll(".office-xlsx-empty-grid-row")).toHaveLength(2);
    expect(container.querySelector(".office-xlsx-corner-header")).not.toBeNull();
  });

  it("keeps the blank grid in step with the sheet when it scrolls", async () => {
    m.renderer.node = <FakeXlsx />;
    const { container } = xlsx();
    await waitFor(() => expect(container.querySelector(".office-xlsx-column-headers")).not.toBeNull());
    const content = container.querySelector<HTMLElement>(".fv-xlsx__content")!;
    Object.defineProperty(content, "scrollLeft", { configurable: true, value: 30 });
    Object.defineProperty(content, "scrollTop", { configurable: true, value: 12 });

    fireEvent.scroll(content);

    expect(container.querySelector<HTMLElement>(".office-xlsx-column-headers")!.style.transform).toContain("-30px");
    expect(container.querySelector<HTMLElement>(".office-xlsx-empty-grid")!.style.transform).toContain("-12px");
    expect(container.querySelector<HTMLElement>(".office-xlsx-row-headers")!.style.transform).toContain("-12px");
  });

  it("leaves its sheet alone once it is removed", async () => {
    m.renderer.node = <FakeXlsx />;
    const { container, unmount } = xlsx();
    await waitFor(() => expect(container.querySelector(".office-xlsx-column-headers")).not.toBeNull());
    const sheet = container.querySelector<HTMLElement>(".fv-xlsx")!;
    expect(sheet.style.width).toBe("600px");

    unmount();

    expect(sheet.style.width).toBe("");
  });

  it("redraws when the window is resized, and ignores a resize that changes nothing", async () => {
    m.renderer.node = <FakeXlsx />;
    const { container } = xlsx();
    await waitFor(() => expect(container.querySelector(".office-xlsx-column-headers")).not.toBeNull());
    const before = container.querySelectorAll(".office-xlsx-column-headers span").length;

    fireEvent(window, new Event("resize"));
    await frame();
    expect(container.querySelectorAll(".office-xlsx-column-headers span")).toHaveLength(before);

    layout.contentWidth = 900;
    fireEvent(window, new Event("resize"));
    await waitFor(() =>
      expect(container.querySelectorAll(".office-xlsx-column-headers span").length).toBeGreaterThan(before),
    );
    layout.contentWidth = 580;
  });

  it("draws no blank grid for a sheet without headers", async () => {
    m.renderer.node = <FakeXlsx extraHeaders={false} />;
    const { container } = xlsx();
    await frame();

    fireEvent(window, new Event("resize"));
    await frame();

    expect(container.querySelector(".office-xlsx-column-headers")).toBeNull();
  });

  it("copes with a browser without ResizeObserver", async () => {
    const original = window.ResizeObserver;
    // @ts-expect-error - simulating a browser that lacks it
    delete window.ResizeObserver;
    try {
      m.renderer.node = <FakeXlsx />;
      const { container } = xlsx();
      await waitFor(() => expect(container.querySelector(".office-xlsx-column-headers")).not.toBeNull());
    } finally {
      window.ResizeObserver = original;
    }
  });

  it("does nothing until the sheet exists", async () => {
    m.renderer.node = <div>loading</div>;
    const { container } = xlsx();
    await frame();

    expect(container.querySelector(".office-xlsx-column-headers")).toBeNull();
    expect(screen.queryByText("100%")).toBeNull();
  });
});
