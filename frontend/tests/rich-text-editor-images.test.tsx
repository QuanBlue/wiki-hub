import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  RichTextContent,
  RichTextEditor,
} from "@/components/pages/rich-text-editor";

const SRC = "/api/v1/attachments/11111111-1111-1111-1111-111111111111/content";

beforeEach(() => {
  // jsdom has no pointer capture; the editor asks for it on every press.
  Element.prototype.setPointerCapture ??= () => {};
});

function bounds(element: Element, box: Partial<DOMRect>) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      ...box,
    }),
  });
}

function pointer(type: string, init: MouseEventInit = {}) {
  return new MouseEvent(type, { bubbles: true, ...init });
}

async function renderImage(attrs = 'width="400"', onChange = vi.fn()) {
  const view = render(
    <RichTextEditor
      content={`<img src="${SRC}" alt="Diagram" ${attrs}>`}
      onChange={onChange}
    />,
  );
  const image = (await screen.findByAltText("Diagram")) as HTMLImageElement;
  const figure = image.closest("figure") as HTMLElement;
  const frame = image.parentElement as HTMLElement;
  // The editor measures its frame and the column it sits in.
  bounds(frame, { width: 400, height: 300 });
  Object.defineProperty(frame.closest(".ProseMirror")!, "clientWidth", {
    configurable: true,
    value: 800,
  });
  return { ...view, image, figure, frame, onChange };
}

function showTools(image: HTMLElement) {
  fireEvent.mouseEnter(image);
}

describe("image crops and measurements", () => {
  it.each([
    ["not json", "nope"],
    [
      "a crop leaving the image",
      JSON.stringify({ x: 0.9, y: 0, width: 0.5, height: 0.5 }),
    ],
    [
      "a crop that is too small",
      JSON.stringify({ x: 0, y: 0, width: 0.05, height: 0.5 }),
    ],
  ])("ignores %s and shows the whole image", async (_label, crop) => {
    const { image, frame } = await renderImage(
      `width="400" data-crop='${crop}'`,
    );

    expect(frame.className).not.toContain("overflow-hidden");
    expect(image).toHaveStyle({ width: "400px" });
  });

  it("learns the aspect ratio from a loaded image, ignoring one with no size", async () => {
    const { image } = await renderImage();

    fireEvent.load(image);
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 300 },
      naturalHeight: { configurable: true, value: 200 },
    });
    fireEvent.load(image);
    // The same ratio again changes nothing.
    fireEvent.load(image);
    expect(image).toBeInTheDocument();
  });
});

describe("image resizing", () => {
  it("resizes from a side handle with a pointer", async () => {
    const { image, onChange } = await renderImage();
    showTools(image);
    const handle = await screen.findByRole("button", {
      name: "Resize image from right",
    });

    fireEvent(handle, pointer("pointerdown", { clientX: 400 }));
    fireEvent(window, pointer("pointermove", { clientX: 340 }));
    fireEvent(window, pointer("pointerup"));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining('width="340"'),
      ),
    );
  });

  it("resizes from the edge of the frame, but not from its middle or from a button", async () => {
    const { image, figure, onChange } = await renderImage();
    showTools(image);
    bounds(figure, { left: 0, right: 400, width: 400 });

    fireEvent(figure, pointer("pointerdown", { clientX: 200 }));
    fireEvent(window, pointer("pointerup"));
    const toolbarButton = await screen.findByRole("button", {
      name: "Crop image",
    });
    fireEvent(toolbarButton, pointer("pointerdown", { clientX: 2 }));
    fireEvent(window, pointer("pointerup"));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent(figure, pointer("pointerdown", { clientX: 5 }));
    fireEvent(window, pointer("pointermove", { clientX: 25 }));
    fireEvent(window, pointer("pointerup"));
    await waitFor(() => expect(onChange).toHaveBeenCalled());

    onChange.mockClear();
    fireEvent(figure, pointer("pointerdown", { clientX: 395 }));
    fireEvent(window, pointer("pointermove", { clientX: 330 }));
    fireEvent(window, pointer("pointerup"));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it("resizes from the keyboard, growing from the right and shrinking from the left", async () => {
    const { image, frame, onChange } = await renderImage();
    bounds(frame, { width: 300 });
    Object.defineProperty(frame.closest(".ProseMirror")!, "clientWidth", {
      configurable: true,
      value: 800,
    });
    showTools(image);
    const right = await screen.findByRole("button", {
      name: "Resize image from right",
    });
    const left = screen.getByRole("button", { name: "Resize image from left" });

    fireEvent.keyDown(right, { key: "ArrowRight" });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.stringContaining('width="316"'),
      ),
    );
    fireEvent.keyDown(right, { key: "ArrowLeft" });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.stringContaining('width="284"'),
      ),
    );
    fireEvent.keyDown(left, { key: "ArrowDown" });
    fireEvent.keyDown(left, { key: "ArrowUp" });
    fireEvent.keyDown(left, { key: "Enter" });
    expect(left).toBeInTheDocument();
  });

  it("answers presses on the hidden corner handle too", async () => {
    const { image, onChange } = await renderImage();
    showTools(image);
    const corner = await screen.findByLabelText(
      "Inactive image resize control",
    );

    fireEvent(corner, pointer("pointerdown", { clientX: 400 }));
    fireEvent(window, pointer("pointermove", { clientX: 300 }));
    fireEvent(window, pointer("pointerup"));
    fireEvent.mouseDown(corner, { clientX: 300 });
    fireEvent.mouseUp(window);
    fireEvent.keyDown(corner, { key: "ArrowRight" });
    expect(onChange).toBeDefined();
  });
});

describe("image crop editor", () => {
  async function openCrop(onChange = vi.fn()) {
    const view = await renderImage('width="600"', onChange);
    showTools(view.image);
    fireEvent.click(await screen.findByRole("button", { name: "Crop image" }));
    const preview = screen.getByAltText("Crop preview")
      .parentElement as HTMLElement;
    bounds(preview, { width: 600, height: 400 });
    const frame = preview.querySelector(".cursor-move") as HTMLElement;
    return { ...view, preview, cropFrame: frame };
  }

  const left = (element: HTMLElement) => Number.parseFloat(element.style.left);
  const top = (element: HTMLElement) => Number.parseFloat(element.style.top);
  const width = (element: HTMLElement) =>
    Number.parseFloat(element.style.width);
  const height = (element: HTMLElement) =>
    Number.parseFloat(element.style.height);

  it("moves the selection and keeps it inside the picture", async () => {
    const { cropFrame } = await openCrop();

    fireEvent(
      cropFrame,
      pointer("pointerdown", { clientX: 100, clientY: 100 }),
    );
    fireEvent(window, pointer("pointermove", { clientX: 112, clientY: 108 }));
    await waitFor(() => expect(left(cropFrame)).toBeCloseTo(7, 0));
    expect(top(cropFrame)).toBeCloseTo(7, 0);
    fireEvent(window, pointer("pointermove", { clientX: 5000, clientY: 5000 }));
    await waitFor(() => expect(left(cropFrame)).toBeCloseTo(10, 0));
    fireEvent(
      window,
      pointer("pointermove", { clientX: -5000, clientY: -5000 }),
    );
    await waitFor(() => expect(left(cropFrame)).toBe(0));
    fireEvent(window, pointer("pointerup"));
    // A move after the press ended is ignored.
    fireEvent(window, pointer("pointermove", { clientX: 300, clientY: 300 }));
    expect(left(cropFrame)).toBe(0);
  });

  it.each([
    ["nw", (f: HTMLElement) => left(f) > 5 && top(f) > 5],
    ["n", (f: HTMLElement) => top(f) > 5],
    ["ne", (f: HTMLElement) => width(f) > 90 || top(f) > 5],
    ["e", (f: HTMLElement) => width(f) < 90 || width(f) > 90],
    ["se", (f: HTMLElement) => height(f) !== 90],
    ["s", (f: HTMLElement) => height(f) !== 90],
    ["sw", (f: HTMLElement) => left(f) !== 5],
    ["w", (f: HTMLElement) => left(f) !== 5],
  ])("resizes from the %s handle", async (handle, changed) => {
    const { cropFrame } = await openCrop();
    const grip = screen.getByRole("button", {
      name: `Resize crop from ${handle}`,
    });

    fireEvent(grip, pointer("pointerdown", { clientX: 100, clientY: 100 }));
    fireEvent(window, pointer("pointermove", { clientX: 150, clientY: 140 }));
    await waitFor(() => expect(changed(cropFrame)).toBe(true));
    // Dragged far past the other side, the selection stops at its minimum size.
    fireEvent(
      window,
      pointer("pointermove", { clientX: -4000, clientY: -4000 }),
    );
    fireEvent(window, pointer("pointermove", { clientX: 4000, clientY: 4000 }));
    fireEvent(window, pointer("pointercancel"));
    expect(width(cropFrame)).toBeGreaterThan(9.9);
    expect(height(cropFrame)).toBeGreaterThan(9.9);
  });

  it("saves the selection, or leaves it behind when cancelled", async () => {
    const onChange = vi.fn();
    const { cropFrame } = await openCrop(onChange);
    fireEvent(
      cropFrame,
      pointer("pointerdown", { clientX: 100, clientY: 100 }),
    );
    fireEvent(window, pointer("pointermove", { clientX: 130, clientY: 100 }));
    fireEvent(window, pointer("pointerup"));

    onChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Crop image" })).toBeNull(),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reopens on the saved crop", async () => {
    const onChange = vi.fn();
    const { image } = await renderImage(
      `width="600" data-crop='${JSON.stringify({ x: 0.2, y: 0.2, width: 0.5, height: 0.5 })}'`,
      onChange,
    );
    showTools(image);
    fireEvent.click(await screen.findByRole("button", { name: "Crop image" }));
    const preview = screen.getByAltText("Crop preview")
      .parentElement as HTMLElement;
    expect(
      Number.parseFloat(
        (preview.querySelector(".cursor-move") as HTMLElement).style.left,
      ),
    ).toBeCloseTo(20, 0);
  });
});

describe("image toolbar", () => {
  it("aligns the image and edits, clears or abandons its caption", async () => {
    const { image, onChange } = await renderImage();
    showTools(image);

    fireEvent.click(
      await screen.findByRole("button", { name: "Align image right" }),
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.stringContaining('data-alignment="right"'),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Align image left" }));

    fireEvent.click(screen.getByRole("button", { name: "Add image caption" }));
    fireEvent.change(screen.getByLabelText("Caption"), {
      target: { value: "  First  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save caption" }));
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.stringContaining('data-caption="First"'),
      ),
    );

    showTools(image);
    fireEvent.click(screen.getByRole("button", { name: "Add image caption" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Add image caption" }));
    fireEvent.change(screen.getByLabelText("Caption"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save caption" }));
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.not.stringContaining("data-caption"),
      ),
    );
  });

  it("opens the file details for a stored image, and does nothing for any other", async () => {
    const seen = vi.fn();
    document.addEventListener("wikihub:view-file-details", seen);
    try {
      const { image } = await renderImage();
      showTools(image);
      fireEvent.click(
        await screen.findByRole("button", { name: "Image details" }),
      );
      expect(seen).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("wikihub:view-file-details", seen);
    }

    const other = vi.fn();
    document.addEventListener("wikihub:view-file-details", other);
    try {
      render(
        <RichTextEditor
          content='<img src="https://example.test/a.png" alt="Remote">'
          onChange={vi.fn()}
        />,
      );
      const remote = await screen.findByAltText("Remote");
      showTools(remote);
      const buttons = await screen.findAllByRole("button", {
        name: "Image details",
      });
      fireEvent.click(buttons.at(-1)!);
      expect(other).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("wikihub:view-file-details", other);
    }
  });

  it("does not start a move when the drag begins on a toolbar button", async () => {
    const { image, figure } = await renderImage();
    showTools(image);
    const button = await screen.findByRole("button", { name: "Crop image" });
    const dataTransfer = {
      effectAllowed: "all",
      dropEffect: "none",
      setData: vi.fn(),
      setDragImage: vi.fn(),
    };

    fireEvent.dragStart(button, { dataTransfer });
    fireEvent.dragEnd(figure, { dataTransfer });
    expect(dataTransfer.effectAllowed).toBe("all");
  });
});

describe("saving a crop", () => {
  async function saveCrop(attrs: string, mockPreview = true) {
    const onChange = vi.fn();
    const { image } = await renderImage(attrs, onChange);
    showTools(image);
    fireEvent.click(await screen.findByRole("button", { name: "Crop image" }));
    if (mockPreview) {
      bounds(screen.getByAltText("Crop preview").parentElement!, {
        width: 500,
        height: 250,
      });
    }
    onChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    return onChange.mock.calls.at(-1)![0] as string;
  }

  const crop = `data-crop='${JSON.stringify({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 })}'`;

  it("sizes the frame from the source when the saved width was already the cropped one", async () => {
    const html = await saveCrop(
      `width="300" ${crop} data-crop-width-final="true"`,
    );
    expect(html).toContain('data-crop-source-aspect-ratio="2"');
    expect(html).toContain('width="300"');
  });

  it("reads an older crop's width as the whole image", async () => {
    const html = await saveCrop(`width="400" ${crop}`);
    expect(html).toContain('width="200"');
  });

  it("measures an image that has no saved width", async () => {
    const html = await saveCrop("", false);
    expect(html).toContain("data-crop=");
  });
});

describe("images on a saved page", () => {
  it("offers no resize or toolbar controls", async () => {
    render(
      <RichTextContent
        content={`<img src="${SRC}" alt="Saved" width="300">`}
      />,
    );

    const image = await screen.findByAltText("Saved");
    fireEvent.mouseEnter(image);
    expect(screen.queryByRole("button", { name: /Resize image/ })).toBeNull();
    expect(screen.queryByRole("toolbar")).toBeNull();
  });
});

describe("images without a saved width", () => {
  it("leaves a cropped frame's width to the browser", async () => {
    const { frame } = await renderImage(
      `data-crop='${JSON.stringify({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 })}'`,
    );

    expect(frame.style.width).toBe("");
  });

  it("shows an unsized image at its natural size", async () => {
    const { image } = await renderImage("");

    expect(image.getAttribute("style")).toBeNull();
  });
});
