import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RichTextContent,
  RichTextEditor,
} from "@/components/pages/rich-text-editor";

describe("RichTextEditor images", () => {
  it("renders a resize handle and persists a width after dragging it", async () => {
    const onChange = vi.fn();
    render(
      <RichTextEditor
        content={
          '<img src="/api/v1/attachments/example/content" alt="Diagram" width="600">'
        }
        onChange={onChange}
      />,
    );

    const image = await screen.findByAltText("Diagram");
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 1200 },
      naturalHeight: { configurable: true, value: 800 },
    });
    fireEvent.load(image);
    fireEvent.mouseEnter(image);

    const handle = await screen.findByRole("button", {
      name: "Resize image from right",
    });
    expect(handle).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: /Resize image from (left|right)/ }),
    ).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Align image center" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Add image caption" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Crop image" })).toBeVisible();
    expect(image).toHaveAttribute("draggable", "true");

    fireEvent.mouseLeave(image);
    fireEvent.mouseEnter(
      screen.getByRole("toolbar", { name: "Image options" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Align image center" }));
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining('data-alignment="center"'),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Add image caption" }));
    fireEvent.change(screen.getByLabelText("Caption"), {
      target: { value: "System diagram" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save caption" }));
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining('data-caption="System diagram"'),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Crop image" }));
    expect(screen.getByRole("dialog", { name: "Crop image" })).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: /Resize crop from/ }),
    ).toHaveLength(8);
    const cropPreview = screen.getByAltText("Crop preview").parentElement;
    Object.defineProperty(cropPreview, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ width: 600, height: 480 }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining("data-crop="),
      );
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining('data-crop-width-final="true"'),
      );
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining('width="540"'),
      );
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining('data-crop-source-aspect-ratio="1.25"'),
      );
    });
    expect(screen.getByRole("button", { name: "Crop image" })).toBeVisible();

    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 180 });
    fireEvent.mouseUp(window);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(expect.stringContaining('width="'));
    });
  });

  it("renders a saved crop at the selected size and source aspect ratio", async () => {
    render(
      <RichTextEditor
        content={`<img src="/api/v1/attachments/example/content" alt="Cropped diagram" width="180" data-crop='{"x":0.3,"y":0.2,"width":0.3,"height":0.5}' data-crop-width-final="true" data-crop-source-aspect-ratio="1.5">`}
        onChange={vi.fn()}
      />,
    );

    const image = await screen.findByAltText("Cropped diagram");
    const frame = image.parentElement as HTMLElement;
    // Pinned to the size the crop was saved at, but free to shrink with a
    // narrower column. The height is left to the ratio: a fixed pixel height
    // would hold the frame at its original size and let the page clip it.
    expect(frame).toHaveStyle({ width: "180px", maxWidth: "100%" });
    expect(frame.getAttribute("style")).toContain("aspect-ratio: 0.9");
    expect(frame.getAttribute("style")).not.toContain("height:");
    // The source rectangle is a share of the frame, so it scales with it and
    // the selected region survives any size.
    expect(image).toHaveStyle({
      width: "333.3333%",
      height: "200%",
      left: "-100%",
      top: "-40%",
    });
    // Prose styles give images a vertical margin. Left in place it is added to
    // the offsets above as a fixed pixel amount while the source image scales
    // with the frame, so the visible slice slides as the image is resized.
    expect(image).toHaveStyle({ margin: "0px" });
  });

  it("corrects the size and position of crops saved by the earlier editor", async () => {
    render(
      <RichTextEditor
        content={`<img src="/api/v1/attachments/example/content" alt="Legacy cropped diagram" width="600" data-crop='{"x":0.3,"y":0.2,"width":0.3,"height":0.5}'>`}
        onChange={vi.fn()}
      />,
    );

    const image = await screen.findByAltText("Legacy cropped diagram");
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 1200 },
      naturalHeight: { configurable: true, value: 800 },
    });
    fireEvent.load(image);

    await waitFor(() => {
      expect(image.parentElement).toHaveStyle({
        width: "180px",
        maxWidth: "100%",
      });
    });
    expect(image.parentElement?.getAttribute("style")).toContain(
      "aspect-ratio: 0.9",
    );
    expect(image).toHaveStyle({
      width: "333.3333%",
      height: "200%",
      left: "-100%",
      top: "-40%",
    });
  });

  it("marks the chosen alignment on the figure the wrapper rule keys off", async () => {
    render(
      <RichTextEditor
        content={`<img src="/api/v1/attachments/example/content" alt="Alignable diagram" width="300">`}
        onChange={vi.fn()}
      />,
    );

    const image = await screen.findByAltText("Alignable diagram");
    const figure = image.closest("figure") as HTMLElement;
    fireEvent.mouseEnter(image);
    expect(figure).toHaveAttribute("data-alignment", "left");

    // Alignment cannot live on the figure itself: its wrapper is shrink-wrapped
    // to it, so auto margins there have no free space to distribute. The
    // attribute is what globals.css moves the wrapper by.
    for (const [label, value] of [
      ["Align image center", "center"],
      ["Align image right", "right"],
      ["Align image left", "left"],
    ] as const) {
      fireEvent.click(await screen.findByRole("button", { name: label }));
      await waitFor(() => {
        expect(figure).toHaveAttribute("data-alignment", value);
      });
      expect(
        await screen.findByRole("button", { name: label }),
      ).toHaveAttribute("aria-pressed", "true");
    }
  });

  it("keeps the image toolbar up while the pointer moves between it and the image", async () => {
    render(
      <RichTextEditor
        content={`<img src="/api/v1/attachments/example/content" alt="Hovered diagram" width="300">`}
        onChange={vi.fn()}
      />,
    );

    const image = await screen.findByAltText("Hovered diagram");
    fireEvent.mouseEnter(image);
    const toolbar = await screen.findByRole("toolbar", {
      name: "Image options",
    });
    // Floated above the image rather than over it.
    expect(toolbar.parentElement).toHaveClass("bottom-full");

    // Moving off the toolbar and back onto the image must not dismiss it. The
    // pointer never leaves the figure, so nothing would bring the tools back.
    fireEvent.mouseLeave(toolbar, { relatedTarget: image });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(
      screen.getByRole("toolbar", { name: "Image options" }),
    ).toBeInTheDocument();

    // Leaving the image altogether still dismisses it.
    fireEvent.mouseLeave(image);
    await waitFor(() => {
      expect(
        screen.queryByRole("toolbar", { name: "Image options" }),
      ).not.toBeInTheDocument();
    });
  });

  it("marks the caption button when the image already has one", async () => {
    render(
      <RichTextEditor
        content={`<img src="/api/v1/attachments/example/content" alt="Captioned diagram" width="300" data-caption="A diagram">`}
        onChange={vi.fn()}
      />,
    );

    const image = await screen.findByAltText("Captioned diagram");
    fireEvent.mouseEnter(image);
    const captionButton = await screen.findByRole("button", {
      name: "Add image caption",
    });
    expect(captionButton).toHaveAttribute("aria-pressed", "true");
    expect(captionButton).toHaveClass("text-primary");
  });

  it("offers the caption dialog's confirm action as the primary button", async () => {
    render(
      <RichTextEditor
        content={`<img src="/api/v1/attachments/example/content" alt="Plain diagram" width="300">`}
        onChange={vi.fn()}
      />,
    );

    const image = await screen.findByAltText("Plain diagram");
    fireEvent.mouseEnter(image);
    fireEvent.click(
      await screen.findByRole("button", { name: "Add image caption" }),
    );

    const save = await screen.findByRole("button", { name: "Save caption" });
    expect(save).toHaveClass("bg-primary");
    expect(screen.getByRole("button", { name: "Cancel" })).not.toHaveClass(
      "bg-primary",
    );
  });

  it("shows the resize cursor along the whole side of an image", async () => {
    render(
      <RichTextEditor
        content={`<img src="/api/v1/attachments/example/content" alt="Wide diagram" width="400">`}
        onChange={vi.fn()}
      />,
    );

    const image = await screen.findByAltText("Wide diagram");
    fireEvent.mouseEnter(image);

    for (const name of ["Resize image from left", "Resize image from right"]) {
      const handle = await screen.findByRole("button", { name });
      // Stretched over the full height rather than parked at the midpoint, so
      // the arrow shows anywhere along the grab bar - and over the whole band
      // a press would resize from.
      expect(handle).toHaveClass("inset-y-0", "cursor-ew-resize");
      expect(handle).toHaveStyle({ width: "20px" });
    }
  });

  it("resizes the visible crop frame without jumping to the hidden source size", async () => {
    const onChange = vi.fn();
    render(
      <RichTextEditor
        content={`<img src="/api/v1/attachments/example/content" alt="Resizable cropped diagram" width="600" data-crop='{"x":0.3,"y":0.2,"width":0.3,"height":0.5}' data-crop-source-aspect-ratio="1.5">`}
        onChange={onChange}
      />,
    );

    const image = await screen.findByAltText("Resizable cropped diagram");
    const cropFrame = image.parentElement as HTMLDivElement;
    Object.defineProperty(cropFrame, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ width: 180, height: 200 }),
    });
    Object.defineProperty(cropFrame.closest(".ProseMirror"), "clientWidth", {
      configurable: true,
      value: 600,
    });

    fireEvent.mouseEnter(image);
    const rightHandle = await screen.findByRole("button", {
      name: "Resize image from right",
    });
    expect(rightHandle).toHaveClass("right-0");
    expect(
      screen.getByRole("button", { name: "Resize image from left" }),
    ).toHaveClass("left-0");

    fireEvent.mouseDown(rightHandle, { clientX: 180, clientY: 100 });
    await waitFor(() => {
      expect(cropFrame).toHaveStyle({ width: "180px" });
    });

    fireEvent.mouseMove(window, { clientX: 180, clientY: 40 });
    await waitFor(() => {
      expect(cropFrame).toHaveStyle({ width: "180px" });
    });

    fireEvent.mouseMove(window, { clientX: 220, clientY: 100 });
    await waitFor(() => {
      expect(cropFrame).toHaveStyle({ width: "220px" });
    });
    fireEvent.mouseUp(window);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining('width="220"'),
      );
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining('data-crop-width-final="true"'),
      );
    });
  });

  it("does not start image resize while dragging the crop selection", async () => {
    const onChange = vi.fn();
    render(
      <RichTextEditor
        content='<img src="/api/v1/attachments/example/content" alt="Crop interaction diagram" width="600">'
        onChange={onChange}
      />,
    );

    const image = await screen.findByAltText("Crop interaction diagram");
    const figure = image.closest("figure") as HTMLElement;
    Object.defineProperty(figure, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, right: 600, top: 0, bottom: 400 }),
    });
    fireEvent.mouseEnter(image);
    fireEvent.click(screen.getByRole("button", { name: "Crop image" }));

    const cropPreview = screen.getByAltText("Crop preview").parentElement;
    const cropSelection = cropPreview?.querySelector(".cursor-move");
    expect(cropSelection).not.toBeNull();
    Object.defineProperty(cropPreview, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 600, height: 400 }),
    });
    Object.defineProperty(cropSelection as Element, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    onChange.mockClear();
    fireEvent(
      cropSelection as Element,
      new MouseEvent("pointerdown", {
        bubbles: true,
        clientX: 30,
        clientY: 20,
      }),
    );
    fireEvent(
      window,
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: 90,
        clientY: 20,
      }),
    );
    await waitFor(() => {
      expect(
        Number.parseFloat((cropSelection as HTMLElement).style.left),
      ).toBeGreaterThan(5);
    });
    fireEvent(
      window,
      new MouseEvent("pointerup", {
        bubbles: true,
        clientX: 90,
        clientY: 20,
      }),
    );

    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps both resize bars usable when an image fills the editor width", async () => {
    const onChange = vi.fn();
    render(
      <RichTextEditor
        content='<img src="/api/v1/attachments/example/content" alt="Full width diagram" width="600">'
        onChange={onChange}
      />,
    );

    const image = await screen.findByAltText("Full width diagram");
    const imageFrame = image.parentElement as HTMLDivElement;
    Object.defineProperty(imageFrame, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ width: 600, height: 400 }),
    });
    Object.defineProperty(imageFrame.closest(".ProseMirror"), "clientWidth", {
      configurable: true,
      value: 600,
    });

    fireEvent.mouseEnter(image);
    const rightHandle = await screen.findByRole("button", {
      name: "Resize image from right",
    });
    const leftHandle = screen.getByRole("button", {
      name: "Resize image from left",
    });
    expect(rightHandle).toHaveClass("right-0");
    expect(leftHandle).toHaveClass("left-0");

    fireEvent.mouseDown(rightHandle, { clientX: 600, clientY: 200 });
    fireEvent.mouseMove(window, { clientX: 560, clientY: 200 });
    fireEvent.mouseUp(window);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining('width="560"'),
      );
    });
  });

  it("moves a dragged image instead of leaving a copy behind", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <RichTextEditor
        content={
          '<p>first</p><img src="/api/v1/attachments/a/content" alt="Diagram"><p>second</p>'
        }
        onChange={onChange}
      />,
    );

    const image = await screen.findByAltText("Diagram");
    const editable = container.querySelector(".ProseMirror") as HTMLElement;
    const paragraphs = editable.querySelectorAll(":scope > p");
    const target = paragraphs[paragraphs.length - 1] as HTMLElement;
    const targetText = target.firstChild as Text;

    // ProseMirror resolves a drop point through these two and jsdom implements
    // neither. Point both at the end of the last paragraph.
    document.elementFromPoint = () => target;
    (
      document as unknown as { caretPositionFromPoint: () => unknown }
    ).caretPositionFromPoint = () => ({
      offsetNode: targetText,
      offset: targetText.length,
    });

    // Chrome fills a native image drag with the image's own markup, and that is
    // what ProseMirror used to paste as a second copy while the source stayed
    // put - tiptap's node view hides `dragstart` from it, so it cannot tell the
    // drag apart from an external one.
    const store: Record<string, string> = {
      "text/html": '<img src="/api/v1/attachments/a/content" alt="Diagram">',
      "text/plain": "",
    };
    const dataTransfer = {
      types: Object.keys(store),
      files: [],
      effectAllowed: "all",
      dropEffect: "none",
      getData: (type: string) => store[type] ?? "",
      setData: (type: string, value: string) => {
        store[type] = value;
      },
      clearData: () => {
        for (const key of Object.keys(store)) delete store[key];
      },
      setDragImage: () => {},
    } as unknown as DataTransfer;

    fireEvent.dragStart(image, { dataTransfer });
    fireEvent.drop(target, { dataTransfer, clientX: 10, clientY: 400 });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const html = onChange.mock.calls.at(-1)?.[0] as string;
    expect(html.match(/<img/g) ?? []).toHaveLength(1);
    // Landed after the paragraph it was dropped on rather than back where it
    // started, so the move really happened.
    expect(html.indexOf("<img")).toBeGreaterThan(html.indexOf("second"));
  });
});

describe("RichTextEditor tables", () => {
  it("resizes a row from its lower edge and persists the height", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <RichTextEditor
        content="<table><tbody><tr><td>First row</td><td>Value</td></tr><tr><td>Second row</td><td>Value</td></tr></tbody></table>"
        onChange={onChange}
      />,
    );

    const row = container.querySelector("tr") as HTMLTableRowElement;
    expect(row).not.toBeNull();
    Object.defineProperty(row, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ top: 20, bottom: 60, height: 40 }),
    });
    fireEvent.mouseDown(row, { button: 0, clientY: 56 });
    fireEvent.mouseMove(window, { clientY: 92 });
    expect(row).toHaveStyle({ height: "76px" });
    fireEvent.mouseUp(window);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining("height: 76px"),
      );
    });
  });
});

describe("RichTextEditor attachments", () => {
  const attachmentHref =
    "/api/v1/attachments/11111111-1111-1111-1111-111111111111/content";

  it("renders a stored attachment link as a tile in the editor", async () => {
    render(
      <RichTextEditor
        content={`<p><a href="${attachmentHref}">jmx_exporter.jar</a></p>`}
        onChange={vi.fn()}
      />,
    );

    const link = await screen.findByRole("button", {
      name: "jmx_exporter.jar",
    });
    // A node view wrapper is what separates the tile from a plain link mark.
    expect(link.closest("[data-node-view-wrapper]")).not.toBeNull();
    expect(link).toHaveAttribute("title", "jmx_exporter.jar");
    // No href while editing: the browser starts navigating from the mouse
    // sequence, and cancelling the click cannot call that back.
    expect(link).not.toHaveAttribute("href");
    // Draggable while editing, so a tile can be moved the way an image can.
    expect(link).toHaveAttribute("draggable", "true");
    expect(link.querySelector("svg")).not.toBeNull();
  });

  it("renders the same tile on a saved page", async () => {
    render(
      <RichTextContent
        content={`<p><a href="${attachmentHref}">jmx_exporter_config.yaml</a></p>`}
      />,
    );

    const link = await screen.findByRole("link", {
      name: "jmx_exporter_config.yaml",
    });
    expect(link.closest("[data-node-view-wrapper]")).not.toBeNull();
    expect(link.querySelector("svg")).not.toBeNull();
    // A saved page is not editable, so nothing there should offer to move.
    expect(link).toHaveAttribute("draggable", "false");
  });

  it("leaves an attachment link written into a sentence as a link", async () => {
    render(
      <RichTextEditor
        content={`<p>see <a href="${attachmentHref}">this document</a> first</p>`}
        onChange={vi.fn()}
      />,
    );

    const link = await screen.findByRole("link", { name: "this document" });
    expect(link.closest("[data-node-view-wrapper]")).toBeNull();
  });

  it("moves a dragged attachment tile instead of leaving a copy behind", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <RichTextEditor
        content={`<p>first <a href="${attachmentHref}">runbook.pdf</a></p><p>second</p>`}
        onChange={onChange}
      />,
    );

    const link = await screen.findByRole("button", { name: "runbook.pdf" });
    const editable = container.querySelector(".ProseMirror") as HTMLElement;
    const target = editable.querySelectorAll(":scope > p")[1] as HTMLElement;
    const targetText = target.firstChild as Text;

    document.elementFromPoint = () => target;
    (
      document as unknown as { caretPositionFromPoint: () => unknown }
    ).caretPositionFromPoint = () => ({
      offsetNode: targetText,
      offset: targetText.length,
    });

    // What Chrome puts on the clipboard for a native link drag, and what
    // ProseMirror would otherwise paste as a second tile.
    const store: Record<string, string> = {
      "text/html": `<a href="${attachmentHref}">runbook.pdf</a>`,
      "text/plain": attachmentHref,
    };
    const dataTransfer = {
      types: Object.keys(store),
      files: [],
      effectAllowed: "all",
      dropEffect: "none",
      getData: (type: string) => store[type] ?? "",
      setData: (type: string, value: string) => {
        store[type] = value;
      },
      clearData: () => {
        for (const key of Object.keys(store)) delete store[key];
      },
      setDragImage: () => {},
    } as unknown as DataTransfer;

    fireEvent.dragStart(link, { dataTransfer });
    fireEvent.drop(target, { dataTransfer, clientX: 10, clientY: 400 });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const html = onChange.mock.calls.at(-1)?.[0] as string;
    expect(html.match(/data-attachment/g) ?? []).toHaveLength(1);
    expect(html.indexOf("data-attachment")).toBeGreaterThan(
      html.indexOf("second"),
    );
  });

  it("does not report a change when the document was not changed", async () => {
    const onChange = vi.fn();
    render(
      <RichTextEditor
        // Stored HTML the schema rewrites on the way in: the tile gains a
        // data-attachment marker, so the editor's serialisation differs from
        // this string although nobody has edited anything.
        content={`<p>first</p><p><a href="${attachmentHref}">runbook.pdf</a></p>`}
        onChange={onChange}
      />,
    );

    await screen.findByRole("button", { name: "runbook.pdf" });
    // A transaction that leaves the document alone - toggling a mark with an
    // empty selection only sets a stored mark. Every transaction re-serialises
    // the document, so before the baseline was taken from the editor this
    // reported the schema's own rewrite as if the reader had edited the page,
    // which armed the unsaved-changes guard on an untouched one.
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("still reports a real edit after that", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <RichTextEditor
        content={`<p>first</p><p><a href="${attachmentHref}">runbook.pdf</a></p>`}
        onChange={onChange}
      />,
    );

    await screen.findByRole("button", { name: "runbook.pdf" });
    const editable = container.querySelector(".ProseMirror") as HTMLElement;
    fireEvent.input(editable, {
      target: { innerHTML: "<p>first edited</p>" },
    });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
  });
  it("inserts an uploaded file as an attachment tile that round-trips", async () => {
    const onChange = vi.fn();
    render(
      <RichTextEditor
        content="<p></p>"
        onChange={onChange}
        onUploadFile={async () => ({
          id: "11111111-1111-1111-1111-111111111111",
          filename: "runbook.pdf",
          content_type: "application/pdf",
          content_url: attachmentHref,
        })}
      />,
    );

    const editable = document.querySelector(".ProseMirror") as HTMLElement;
    fireEvent(
      editable,
      new CustomEvent("wikihub:editor-files", {
        detail: [new File(["x"], "runbook.pdf", { type: "application/pdf" })],
      }),
    );

    const link = await screen.findByRole("button", { name: "runbook.pdf" });
    expect(link.closest("[data-node-view-wrapper]")).not.toBeNull();
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining('data-attachment="runbook.pdf"'),
      );
    });
  });
});

describe("RichTextEditor code blocks", () => {
  it("colours a block with a known language and leaves one with none plain", async () => {
    const { container } = render(
      <RichTextEditor
        content={
          '<pre><code class="language-python">class Foo:\n    pass\n</code></pre>' +
          "<pre><code>plain text, no colour</code></pre>"
        }
        onChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector(".hljs-keyword")).not.toBeNull();
    });
    // A compound highlight.js scope keeps its classes together as one token,
    // not nested spans - `.hljs-title.class_` only matches if the classes
    // stayed on one element.
    expect(container.querySelector(".hljs-title.class_")).not.toBeNull();
    // A block with no language falls back to "plaintext", which highlights
    // to zero spans - not `highlightAuto()` guessing a language for it.
    const plainPre = container.querySelectorAll("pre")[1];
    expect(plainPre.querySelector('[class*="hljs-"]')).toBeNull();
  });

  it("always shows an edit button in an editable block, even with no caption or language yet", async () => {
    render(
      <RichTextEditor
        content="<pre><code>echo hi</code></pre>"
        onChange={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole("button", {
        name: "Edit code block title and language",
      }),
    ).toBeInTheDocument();
  });

  it("commits a title and language together from the details modal", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RichTextEditor
        content='<pre><code class="language-bash">echo hi</code></pre>'
        onChange={onChange}
      />,
    );

    // Radix opens its trigger on pointerdown, which plain fireEvent.click
    // does not synthesize - userEvent does, matching tests/select.test.tsx.
    await user.click(
      await screen.findByRole("button", {
        name: "Edit code block title and language",
      }),
    );
    const titleInput = await screen.findByLabelText("Title");
    await user.clear(titleInput);
    await user.type(titleInput, "deploy.sh");
    await user.click(screen.getByRole("button", { name: "Code language" }));
    await user.click(
      await screen.findByRole("menuitemradio", { name: "Python" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining('data-caption="deploy.sh"'),
      );
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.stringContaining('class="language-python"'),
    );
  });

  it("colours the modal's live preview for a drafted language before it is saved", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RichTextEditor
        content="<pre><code>def run():\n    pass</code></pre>"
        onChange={onChange}
      />,
    );

    await user.click(
      await screen.findByRole("button", {
        name: "Edit code block title and language",
      }),
    );
    // Unsaved, the block itself still has no language - the preview must
    // reflect the in-progress choice, not what is actually stored yet.
    expect(screen.queryByText("def", { selector: ".hljs-keyword" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Code language" }));
    await user.click(
      await screen.findByRole("menuitemradio", { name: "Python" }),
    );

    expect(
      await screen.findByText("def", { selector: ".hljs-keyword" }),
    ).toBeInTheDocument();
    // Nothing has been saved yet.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("discards the draft without saving when the details modal is cancelled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RichTextEditor
        content='<pre data-caption="original"><code class="language-bash">echo hi</code></pre>'
        onChange={onChange}
      />,
    );

    await user.click(
      await screen.findByRole("button", {
        name: "Edit code block title and language",
      }),
    );
    const titleInput = await screen.findByLabelText("Title");
    await user.clear(titleInput);
    await user.type(titleInput, "discard me");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onChange).not.toHaveBeenCalled();
    // Reopening must show the original value, not the discarded draft.
    await user.click(
      screen.getByRole("button", {
        name: "Edit code block title and language",
      }),
    );
    expect(await screen.findByLabelText("Title")).toHaveValue("original");
  });

  it("keeps typing in the details modal from reaching ProseMirror's own key handling", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <RichTextEditor
        content='<pre><code class="language-bash">echo hi</code></pre>'
        onChange={vi.fn()}
      />,
    );

    await user.click(
      await screen.findByRole("button", {
        name: "Edit code block title and language",
      }),
    );
    const titleInput = await screen.findByLabelText("Title");
    // The modal is a Radix dialog portaled to document.body, well outside
    // ProseMirror's contentEditable DOM - a keystroke typed here should
    // never reach ProseMirror's own listener, which hangs on .ProseMirror
    // the same way ProseMirror's own handler does.
    const proseMirror = container.querySelector(".ProseMirror") as HTMLElement;
    const spy = vi.fn();
    proseMirror.addEventListener("keydown", spy);
    await user.type(titleInput, "x");
    expect(spy).not.toHaveBeenCalled();
  });

  it("shows the header only when there is a caption or a language to report", async () => {
    const { container: bare } = render(
      <RichTextContent content="<pre><code>echo hi</code></pre>" />,
    );
    await waitFor(() =>
      expect(bare.querySelector(".ProseMirror pre")).not.toBeNull(),
    );
    // The header is the wrapper's first child, sitting above the line-number
    // gutter and <pre>, which together are its only other child. Checking
    // text content alone would miss the header rendering as an empty bar.
    expect(bare.querySelector(".wikihub-code")?.childElementCount).toBe(1);

    const { container: titled } = render(
      <RichTextContent content='<pre data-caption="deploy.sh"><code class="language-bash">echo hi</code></pre>' />,
    );
    await waitFor(() =>
      expect(titled.querySelector(".ProseMirror pre")).not.toBeNull(),
    );
    expect(titled.querySelector(".wikihub-code")?.childElementCount).toBe(2);
    expect(titled.textContent).toContain("deploy.sh");
    expect(titled.textContent).toContain("Bash");
  });
});

describe("Attachment preview syntax highlighting", () => {
  const attachmentId = "11111111-1111-1111-1111-111111111111";

  // jsdom does not implement scrollIntoView; the modal calls it when a
  // search match becomes active.
  Element.prototype.scrollIntoView ??= () => {};

  function mockAttachmentFetch(filename: string, content: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/content")) return new Response(content);
        return new Response(
          JSON.stringify({
            id: attachmentId,
            page_id: "page-1",
            filename,
            content_type: "text/plain",
            created_at: new Date().toISOString(),
            size_bytes: content.length,
          }),
          { headers: { "content-type": "application/json" } },
        );
      }),
    );
  }

  afterEach(() => vi.unstubAllGlobals());

  it("colours a previewed file by its extension and keeps a search match marked over it", async () => {
    mockAttachmentFetch("app.py", "def run():\n    return 1\n");
    const user = userEvent.setup();
    render(<RichTextEditor content="<p>hi</p>" onChange={vi.fn()} />);

    document.dispatchEvent(
      new CustomEvent("wikihub:view-file-details", { detail: attachmentId }),
    );

    await screen.findByText("app.py");
    expect(
      await screen.findByText("def", { selector: ".hljs-keyword" }),
    ).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Search content..."), "return");
    const mark = document.querySelector("mark");
    expect(mark).not.toBeNull();
    // The whole query sits inside one syntax token here, so the match and
    // the colour have to compose on the very same text, not just coexist
    // on different lines.
    expect(mark?.querySelector(".hljs-keyword")).not.toBeNull();
  });

  it("leaves a file with no recognised language plain", async () => {
    mockAttachmentFetch("notes.txt", "def run():\n    return 1\n");
    render(<RichTextEditor content="<p>hi</p>" onChange={vi.fn()} />);

    document.dispatchEvent(
      new CustomEvent("wikihub:view-file-details", { detail: attachmentId }),
    );

    await screen.findByText("notes.txt");
    await waitFor(() => {
      expect(screen.getByText("def run():")).toBeInTheDocument();
    });
    expect(document.querySelector('[class*="hljs-"]')).toBeNull();
  });
});
