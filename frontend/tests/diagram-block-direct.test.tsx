import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeViewProps } from "@tiptap/react";

import { DiagramBlockComponent } from "@/components/pages/diagram-block";
import { LocaleProvider } from "@/lib/i18n/context";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn().mockResolvedValue({ svg: '<svg viewBox="0 0 320 180"><text>Diagram</text></svg>' }),
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("mermaid", () => ({ default: mermaid }));
vi.mock("sonner", () => ({ toast: toasts }));
let resolvedTheme = "light";
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme }) }));
vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
}));

function mount(editable: boolean, attrs: Record<string, unknown> = {}) {
  const updateAttributes = vi.fn();
  const deleteNode = vi.fn();
  const props = {
    editor: { isEditable: editable },
    node: { attrs: { code: "flowchart TD\nA-->B", ...attrs } },
    updateAttributes,
    deleteNode,
  } as unknown as NodeViewProps;
  const view = render(
    <LocaleProvider initialLocale="en">
      <DiagramBlockComponent {...props} />
    </LocaleProvider>,
  );
  return { ...view, updateAttributes, deleteNode };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolvedTheme = "light";
  mermaid.render.mockResolvedValue({ svg: '<svg viewBox="0 0 320 180"><text>Diagram</text></svg>' });
});
afterEach(() => vi.unstubAllGlobals());

describe("diagram block directly", () => {
  it("renders a read-only diagram and opens its context actions", async () => {
    const view = mount(false, { caption: "Flow" });
    const output = await waitFor(() => {
      const el = view.container.querySelector(".mermaid-render-output");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(view.container.querySelector('[data-diagram-pending="false"]')).not.toBeNull();
    fireEvent.contextMenu(output, { clientX: 35, clientY: 45 });
    expect(screen.getByText("Copy Mermaid code")).toBeInTheDocument();
    screen.getByText("Copy Mermaid code").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(screen.getByText("Copy Mermaid code")).toBeInTheDocument();
    fireEvent.pointerDown(window);
    expect(screen.queryByText("Copy Mermaid code")).not.toBeInTheDocument();
  });

  it("copies the source and opens fullscreen from the context menu", async () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const view = mount(true);
    const output = await waitFor(() => {
      const el = view.container.querySelector(".mermaid-render-output");
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.contextMenu(output);
    fireEvent.click(screen.getByText("Copy Mermaid code"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("flowchart TD\nA-->B"));
    fireEvent.contextMenu(output);
    fireEvent.click(screen.getByText("Zoom diagram"));
    const canvas = view.container.querySelector(".cursor-grab") as HTMLElement;
    expect(canvas).not.toBeNull();
    canvas.setPointerCapture = vi.fn();
    canvas.releasePointerCapture = vi.fn(() => { throw new Error("capture already released"); });
    fireEvent.pointerDown(canvas, { button: 2, pointerId: 1 });
    expect(canvas).toHaveClass("cursor-grab");
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 5, clientY: 10 });
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 2, clientX: 10, clientY: 20 });
    expect(canvas.setPointerCapture).toHaveBeenCalledOnce();
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 40, clientY: 50 });
    expect(canvas).toHaveClass("cursor-grabbing");
    fireEvent.pointerUp(canvas, { pointerId: 2 });
    expect(canvas.releasePointerCapture).toHaveBeenCalledOnce();
    fireEvent.pointerCancel(canvas, { pointerId: 2 });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(view.container.querySelector(".cursor-grab")).toBeNull();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2_100)); });
    vi.unstubAllGlobals();
  });

  it("shows a syntax error when Mermaid rejects the diagram", async () => {
    mermaid.render.mockRejectedValueOnce(new Error("invalid syntax"));
    mount(false);
    expect(await screen.findByText("invalid syntax")).toBeInTheDocument();
  });

  it("uses the dark Mermaid palette when the workspace is dark", async () => {
    resolvedTheme = "dark";
    mount(false);
    await waitFor(() => expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ theme: "dark", themeVariables: expect.objectContaining({ darkMode: true }) })));
  });

  it("shows the syntax error in the editable preview", async () => {
    mermaid.render.mockRejectedValueOnce(new Error("bad graph"));
    mount(true);
    expect(await screen.findByText("bad graph")).toBeInTheDocument();
  });

  it.each(["left", "center", "right"])("marks %s alignment as selected", (alignment) => {
    const view = mount(true, { alignment });
    const title = alignment === "left" ? "Căn trái" : alignment === "right" ? "Căn phải" : "Căn giữa";
    const button = Array.from(view.container.querySelectorAll("button")).find((item) => item.title === title);
    expect(button).toHaveClass("bg-primary");
  });

  it("runs context actions in reader and editor modes", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const createObjectURL = vi.fn(() => "blob:diagram");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    for (const editable of [false, true]) {
      const view = mount(editable);
      const output = await waitFor(() => {
        const el = view.container.querySelector(".mermaid-render-output");
        expect(el).not.toBeNull();
        return el!;
      });
      for (const label of ["Download SVG vector", "Download Mermaid file (.mmd)"]) {
        fireEvent.contextMenu(output);
        fireEvent.click(screen.getByText(label));
      }
      fireEvent.contextMenu(output);
      fireEvent.click(screen.getByText("Copy Mermaid code"));
      await waitFor(() => expect(writeText).toHaveBeenCalled());
      fireEvent.contextMenu(output);
      fireEvent.click(screen.getByText("Zoom diagram"));
      expect(view.container.querySelector(".cursor-grab")).not.toBeNull();
      view.unmount();
    }
    expect(createObjectURL).toHaveBeenCalledTimes(4);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2_100)); });
  });

  it("downloads and copies a PNG after rasterizing the rendered SVG", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    const fillRect = vi.fn();
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillRect, drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(blob));
    vi.stubGlobal("Image", class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    vi.stubGlobal("ClipboardItem", class { constructor(_data: Record<string, Blob>) {} });
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write } });
    const createObjectURL = vi.fn(() => "blob:diagram");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const view = mount(true, { caption: "Diagram/one" });
    const output = await waitFor(() => {
      const el = view.container.querySelector(".mermaid-render-output");
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.contextMenu(output);
    fireEvent.click(screen.getByText("Download PNG image"));
    await waitFor(() => expect(fillRect).toHaveBeenCalled());
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(drawImage).toHaveBeenCalled();
    fireEvent.contextMenu(output);
    fireEvent.click(screen.getByText("Copy image as PNG"));
    await waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();

    view.unmount();
    mermaid.render.mockResolvedValue({ svg: '<svg width="240" height="120"><foreignObject x="10" y="20" width="100" height="40"><div xmlns="http://www.w3.org/1999/xhtml">Box</div></foreignObject></svg>' });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 240, height: 120 } as DOMRect);
    write.mockRejectedValueOnce(new Error("clipboard denied"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const second = mount(true);
    const secondOutput = await waitFor(() => {
      const el = second.container.querySelector(".mermaid-render-output");
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.contextMenu(secondOutput);
    fireEvent.click(screen.getByText("Copy image as PNG"));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(2));
    expect(write).toHaveBeenCalledTimes(2);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("falling back"), expect.any(Error));

    second.unmount();
    const reader = mount(false);
    const readerOutput = await waitFor(() => {
      const el = reader.container.querySelector(".mermaid-render-output");
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.contextMenu(readerOutput);
    fireEvent.click(screen.getByText("Copy image as PNG"));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(3));
    fireEvent.contextMenu(readerOutput);
    fireEvent.click(screen.getByText("Download PNG image"));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(3));
  });

  it("resizes from either side, saves the width, and resets it", () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 400, height: 200 } as DOMRect);
    const view = mount(true, { width: 500, alignment: "center" });
    const [west, east] = Array.from(view.container.querySelectorAll('[class*="cursor-ew-resize"]'));
    expect(west).toBeDefined();
    expect(east).toBeDefined();
    fireEvent.pointerDown(east, { clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 150 });
    fireEvent.pointerUp(window);
    expect(view.updateAttributes).toHaveBeenCalledWith({ width: 500 });
    fireEvent.pointerDown(west, { clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 150 });
    fireEvent.pointerUp(window);
    expect(view.updateAttributes).toHaveBeenCalledWith({ width: 300 });
    const reset = Array.from(view.container.querySelectorAll("button")).find((button) => button.title.includes("100%"));
    expect(reset).toBeDefined();
    fireEvent.click(reset!);
    expect(view.updateAttributes).toHaveBeenCalledWith({ width: null });
  });

  it("reports when a PNG cannot be rasterized", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const view = mount(true);
    const output = await waitFor(() => {
      const el = view.container.querySelector(".mermaid-render-output");
      expect(el).not.toBeNull();
      return el!;
    });
    for (const label of ["Copy image as PNG", "Download PNG image"]) {
      fireEvent.contextMenu(output);
      fireEvent.click(screen.getByText(label));
    }
    await waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(2));
    expect(toasts.error.mock.calls.every(([message]) => String(message).includes("PNG"))).toBe(true);
  });

  it("reports SVG image loading errors while copying or downloading PNG", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillRect: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.stubGlobal("Image", class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onerror?.()); }
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = mount(true);
    const output = await waitFor(() => {
      const el = view.container.querySelector(".mermaid-render-output");
      expect(el).not.toBeNull();
      return el!;
    });
    for (const label of ["Copy image as PNG", "Download PNG image"]) {
      fireEvent.contextMenu(output);
      fireEvent.click(screen.getByText(label));
    }
    await waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(2));
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("handles failed code copying and file download", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => { throw new Error("URL failed"); } });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = mount(true);
    const output = await waitFor(() => {
      const el = view.container.querySelector(".mermaid-render-output");
      expect(el).not.toBeNull();
      return el!;
    });
    for (const label of ["Copy Mermaid code", "Download SVG vector", "Download Mermaid file (.mmd)"]) {
      fireEvent.contextMenu(output);
      fireEvent.click(screen.getByText(label));
    }
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(log).toHaveBeenCalledTimes(2);
    expect(toasts.error).toHaveBeenCalledTimes(2);
  });
});
