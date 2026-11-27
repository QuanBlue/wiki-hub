import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RichTextContent } from "@/components/pages/rich-text-editor";
import { LocaleProvider } from "@/lib/i18n/context";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

describe("RichTextContent image right-click context menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens context menu on right-click with copy, zoom, and save actions", async () => {
    const html = '<p><img src="https://example.com/diagram.png" alt="Architecture" /></p>';
    const view = render(
      <LocaleProvider initialLocale="en">
        <RichTextContent content={html} />
      </LocaleProvider>,
    );

    const img = await waitFor(() => {
      const el = view.container.querySelector("img");
      expect(el).not.toBeNull();
      return el as HTMLImageElement;
    });

    fireEvent.contextMenu(img, { clientX: 120, clientY: 160 });

    expect(screen.getByRole("menuitem", { name: "Copy image" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Zoom image" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Save image" })).toBeInTheDocument();

    // Zoom opens the lightbox
    fireEvent.click(screen.getByRole("menuitem", { name: "Zoom image" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(await screen.findByLabelText("Zoom in")).toBeInTheDocument();

    // Close lightbox
    fireEvent.click(screen.getAllByLabelText("Close")[0]);
    await waitFor(() => expect(screen.queryByLabelText("Zoom in")).not.toBeInTheDocument());

    // Copy image fetches and writes PNG to clipboard
    const pngBlob = new Blob(["png-bytes"], { type: "image/png" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(pngBlob),
      }),
    );
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(public data: Record<string, Blob>) {}
      },
    );

    fireEvent.contextMenu(img, { clientX: 120, clientY: 160 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy image" }));
    await waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(toasts.success).toHaveBeenCalledWith("Image copied to clipboard");

    // Save image fetches and downloads blob
    const createObjectURL = vi.fn(() => "blob:saved-image");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    fireEvent.contextMenu(img, { clientX: 120, clientY: 160 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Save image" }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(pngBlob));
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(toasts.success).toHaveBeenCalledWith("Image saved");
  });

  it("does not open context menu in exportMode", async () => {
    const html = '<p><img src="https://example.com/diagram.png" alt="Architecture" /></p>';
    const view = render(
      <LocaleProvider initialLocale="en">
        <RichTextContent content={html} exportMode />
      </LocaleProvider>,
    );

    const img = await waitFor(() => {
      const el = view.container.querySelector("img");
      expect(el).not.toBeNull();
      return el as HTMLImageElement;
    });

    fireEvent.contextMenu(img, { clientX: 100, clientY: 100 });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
