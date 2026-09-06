import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RichTextContent,
  RichTextEditor,
  normalizeConfluenceCodeMacros,
} from "@/components/pages/rich-text-editor";

describe("RichTextContent table of contents", () => {
  it("renders the live table of contents node produced by document imports", async () => {
    render(
      <RichTextContent
        content={'<div data-type="tableOfContents"></div><h1>Architecture</h1><h2>Data model</h2>'}
      />,
    );

    const contents = await screen.findByRole("navigation", {
      name: "Table of contents",
    });
    expect(contents).toHaveTextContent("1.Architecture");
    expect(contents).toHaveTextContent("1.1.Data model");
  });
});

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
  it("renders the same table structure in the editor and live reader", async () => {
    const content =
      "<table><tbody><tr><td><p>First</p><p>Second</p></td><td><p>Value</p></td></tr><tr><td><p></p></td><td><p></p></td></tr></tbody></table>";
    const { container } = render(
      <>
        <RichTextEditor content={content} onChange={vi.fn()} />
        <RichTextContent content={content} />
      </>,
    );

    await waitFor(() => {
      expect(container.querySelectorAll(".ProseMirror table")).toHaveLength(2);
    });

    const [editorTable, readerTable] = Array.from(
      container.querySelectorAll(".ProseMirror table"),
    );
    expect(editorTable.innerHTML).toBe(readerTable.innerHTML);
    const reader = container.querySelectorAll(".ProseMirror")[1];
    expect(reader).toHaveClass("[&>p:last-child]:mb-0");
    expect(reader).not.toHaveClass("[&_p:last-child]:mb-0");
  });

  it("keeps imported table colors and cell alignment in the reader", async () => {
    const { container } = render(
      <RichTextContent
        content={
          '<table><tbody><tr><th style="background-color:#2f5496;color:#e7e6e6;text-align:center">Header</th><td style="text-align:right">Value</td></tr></tbody></table>'
        }
      />,
    );

    const reader = await waitFor(() => {
      const element = container.querySelector(".ProseMirror");
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });

    expect(reader.querySelector("th")).toHaveStyle({
      backgroundColor: "rgb(47, 84, 150)",
      color: "rgb(231, 230, 230)",
      textAlign: "center",
    });
    expect(reader.querySelector("td")).toHaveStyle({ textAlign: "right" });
  });

  it("keeps an imported table header's font size", async () => {
    const { container } = render(
      <RichTextContent
        content={
          '<table><tbody><tr><th style="font-size:200%">Group heading</th><th style="font-size:150%">Column heading</th></tr></tbody></table>'
        }
      />,
    );

    await waitFor(() => {
      expect(container.querySelectorAll("th")).toHaveLength(2);
    });

    expect(container.querySelector("th")).toHaveStyle({ fontSize: "200%" });
    expect(container.querySelectorAll("th")[1]).toHaveStyle({
      fontSize: "150%",
    });
  });

  it("keeps imported paragraph and list alignment and font size", async () => {
    const { container } = render(
      <RichTextContent
        content={
          '<p style="text-align:center"><span style="font-size:125%">Overview</span></p><ol><li style="text-align:right"><span style="font-size:90%">First</span></li><li style="text-align:right">Second</li></ol>'
        }
      />,
    );

    await waitFor(() => {
      expect(container.querySelectorAll("li")).toHaveLength(2);
    });

    expect(container.querySelector("p")).toHaveStyle({ textAlign: "center" });
    expect(container.querySelector("p span")).toHaveStyle({
      fontSize: "125%",
    });
    expect(container.querySelector("li")).toHaveStyle({ textAlign: "right" });
    expect(container.querySelector("li span")).toHaveStyle({
      fontSize: "90%",
    });
  });

  it("keeps Word table column proportions responsive", async () => {
    const { container } = render(
      <RichTextContent
        content={
          '<table style="width:100%"><tbody><tr><td style="width:54.7567%">Left</td><td style="width:45.2433%">Right</td></tr></tbody></table>'
        }
      />,
    );

    const table = await waitFor(() => {
      const element = container.querySelector("table");
      expect(element).not.toBeNull();
      return element as HTMLTableElement;
    });

    expect(container.querySelector(".ProseMirror")).toHaveClass(
      "[&_table]:w-full",
    );
    expect(table.querySelector("td")).toHaveStyle({ width: "54.7567%" });
  });

  it("keeps saved table widths fixed and wraps long cell content in the reader", async () => {
    const { container } = render(
      <RichTextContent content='<table><tbody><tr><td colwidth="420">First column</td><td colwidth="140">Second column</td><td colwidth="180">AReallyLongUnbrokenValueThatMustWrapInsideItsSavedColumn</td></tr></tbody></table>' />,
    );

    const reader = await waitFor(() => {
      const element = container.querySelector(".ProseMirror");
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });

    expect(reader).toHaveClass("[&_table]:table-fixed");
    expect(reader).toHaveClass("[&_td]:break-words");
    expect(reader).toHaveClass("[&_td]:min-w-24", "[&_td]:leading-[1.45]");
    expect(reader).toHaveClass("[&_.tableWrapper]:overflow-y-hidden");
    const table = reader.querySelector("table") as HTMLTableElement;
    expect(table).toBeInTheDocument();
    expect(
      Array.from(table.querySelectorAll("col"), (column) => column.style.width),
    ).toEqual(["420px", "140px", "180px"]);
  });

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

  it("keeps diff state on a saved attachment tile", async () => {
    render(
      <RichTextContent
        content={`<p><a href="${attachmentHref}" data-attachment="jmx_exporter_config.yaml" data-display-mode="card" data-diff-kind="add">jmx_exporter_config.yaml</a></p>`}
      />,
    );

    const link = await screen.findByRole("link", {
      name: "jmx_exporter_config.yaml",
    });
    expect(link).toHaveAttribute("data-diff-kind", "add");
    expect(link).toHaveClass("bg-success-bg/60", "border-success");
  });

  it("in export mode, never mounts the attachment modal or fetches on click", async () => {
    const fetchSpy = vi.spyOn(window, "fetch");
    const { container } = render(
      <RichTextContent
        content={`<p><a href="${attachmentHref}">jmx_exporter_config.yaml</a></p>`}
        exportMode
      />,
    );

    const link = await screen.findByRole("link", {
      name: "jmx_exporter_config.yaml",
    });
    fireEvent.mouseDown(link);
    fireEvent.click(link);

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("calls onReady once the export-mode editor has mounted content", async () => {
    const onReady = vi.fn();
    render(
      <RichTextContent
        content={`<p><a href="${attachmentHref}">jmx_exporter_config.yaml</a></p>`}
        exportMode
        onReady={onReady}
      />,
    );

    await screen.findByRole("link", { name: "jmx_exporter_config.yaml" });
    await waitFor(() => expect(onReady).toHaveBeenCalled());
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

/**
 * The title/language editor lives behind a "Code block options" menu
 * (Radix opens its trigger on pointerdown, which plain fireEvent.click does
 * not synthesize - userEvent does, matching tests/select.test.tsx), not a
 * lone edit button, so a "Delete code block" action can live in the same
 * place without a second control crowding the header.
 */
async function openCodeBlockDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", { name: "Code block options" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: /edit/i }));
}

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

  it("always shows an options button in an editable block, even with no caption or language yet", async () => {
    render(
      <RichTextEditor
        content="<pre><code>echo hi</code></pre>"
        onChange={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole("button", { name: "Code block options" }),
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

    await openCodeBlockDetails(user);
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

    await openCodeBlockDetails(user);
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

    await openCodeBlockDetails(user);
    const titleInput = await screen.findByLabelText("Title");
    await user.clear(titleInput);
    await user.type(titleInput, "discard me");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onChange).not.toHaveBeenCalled();
    // Reopening must show the original value, not the discarded draft.
    await openCodeBlockDetails(user);
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

    await openCodeBlockDetails(user);
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

  it("deletes the code block from the options menu", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RichTextEditor
        content="<p>Keep this paragraph</p><pre><code>echo hi</code></pre>"
        onChange={onChange}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "Code block options" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: /delete code block/i }),
    );

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.not.stringContaining("<pre>"),
      );
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.stringContaining("Keep this paragraph"),
    );
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

    // Two matches once the modal loads, not one: the dialog's own title
    // renders visibly, and DialogContent (dialog.tsx) repeats it a second
    // time in a sr-only Description when no separate description is given,
    // to satisfy Radix's accessibility requirement.
    await waitFor(() => {
      expect(screen.getAllByText("app.py").length).toBeGreaterThan(0);
    });
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

    // See the sibling test above for why this is a count, not a single match.
    await waitFor(() => {
      expect(screen.getAllByText("notes.txt").length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(screen.getByText("def run():")).toBeInTheDocument();
    });
    expect(document.querySelector('[class*="hljs-"]')).toBeNull();
  });
});

describe("RichTextEditor slash-command bridge", () => {
  // The slash-command menu (slash-command.tsx) is an editor-instance-agnostic
  // extension - it can't reach the toolbar's hidden file inputs directly, so
  // it dispatches these two events instead. The toolbar must be listening.
  it("opens the image file picker when the menu dispatches its insert-image event", () => {
    render(<RichTextEditor content="<p>hi</p>" onChange={vi.fn()} />);

    const imageInput = document.querySelector(
      'input[type="file"][accept="image/*"]',
    ) as HTMLInputElement;
    const clickSpy = vi.spyOn(imageInput, "click");

    document.dispatchEvent(new CustomEvent("wikihub:slash-insert-image"));

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("opens the attachment file picker when the menu dispatches its insert-attachment event", () => {
    render(<RichTextEditor content="<p>hi</p>" onChange={vi.fn()} />);

    const attachmentInput = document.querySelector(
      'input[type="file"]:not([accept])',
    ) as HTMLInputElement;
    const clickSpy = vi.spyOn(attachmentInput, "click");

    document.dispatchEvent(new CustomEvent("wikihub:slash-insert-attachment"));

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("opens a page picker on link-to-page and inserts a link to the chosen page", async () => {
    const onChange = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              { id: "page-2", slug: "onboarding", title: "Onboarding guide" },
            ]),
            { headers: { "content-type": "application/json" } },
          ),
      ),
    );

    render(
      <RichTextEditor
        content="<p>hi</p>"
        onChange={onChange}
        pageLinkContext={{ spaceKey: "DEMO", currentPageId: "page-1" }}
      />,
    );

    await act(async () => {
      document.dispatchEvent(new CustomEvent("wikihub:slash-link-to-page"));
    });

    const option = await screen.findByRole("option", {
      name: /Onboarding guide/,
    });
    fireEvent.click(option);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining(
          '/spaces/DEMO/pages/onboarding">Onboarding guide',
        ),
      );
    });
  });

  it("creates a sub-page on create-subpage, inserts a link, and hands off to onSubpageCreated", async () => {
    const onChange = vi.fn();
    const onSubpageCreated = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ id: "page-3", slug: "roadmap", title: "Roadmap" }),
            { headers: { "content-type": "application/json" } },
          ),
      ),
    );

    render(
      <RichTextEditor
        content="<p>hi</p>"
        onChange={onChange}
        pageLinkContext={{ spaceKey: "DEMO", currentPageId: "page-1" }}
        onSubpageCreated={onSubpageCreated}
      />,
    );

    act(() => {
      document.dispatchEvent(new CustomEvent("wikihub:slash-create-subpage"));
    });

    const titleInput = await screen.findByLabelText("Title");
    fireEvent.change(titleInput, { target: { value: "Roadmap" } });
    fireEvent.click(screen.getByRole("button", { name: "Create page" }));

    await waitFor(() => {
      expect(onSubpageCreated).toHaveBeenCalledWith(
        expect.objectContaining({ slug: "roadmap", title: "Roadmap" }),
      );
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.stringContaining('/spaces/DEMO/pages/roadmap">Roadmap'),
    );
  });
});

describe("RichTextEditor toggle blocks", () => {
  it("collapses/expands via the chevron, keeps the body in the document, and persists open state", async () => {
    const onChange = vi.fn();
    render(
      <RichTextEditor
        content='<div data-type="toggle"><div data-type="toggle-summary">Details</div><div data-type="toggle-content"><p>Hidden body</p></div></div>'
        onChange={onChange}
      />,
    );

    await screen.findByText("Hidden body");
    const button = screen.getByRole("button", { name: "Collapse toggle" });
    expect(button).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(button);

    expect(
      await screen.findByRole("button", { name: "Expand toggle" }),
    ).toHaveAttribute("aria-expanded", "false");
    // Still in the document, not removed - collapsing must never lose typed
    // content, and reopening has to show the same text back.
    expect(screen.getByText("Hidden body")).toBeInTheDocument();
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining('data-open="false"'),
      );
    });
  });
});

describe("RichTextEditor to-do list", () => {
  it("renders a checkbox and persists its checked state", async () => {
    const onChange = vi.fn();
    render(
      <RichTextEditor
        content='<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>Buy milk</p></div></li></ul>'
        onChange={onChange}
      />,
    );

    const checkbox = await screen.findByRole("checkbox");
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);

    expect(checkbox).toBeChecked();
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining('data-checked="true"'),
      );
    });
  });
});

describe("Confluence macro normalization and attachment display modes", () => {
  it("normalizes view-file macros into card attachment nodes", () => {
    const raw = `<p>Presentation: <ac:structured-macro ac:name="view-file"><ac:parameter ac:name="name"><ri:attachment ri:filename="VCS-NSM.pptx" /></ac:parameter></ac:structured-macro></p>`;
    const normalized = normalizeConfluenceCodeMacros(raw);
    expect(normalized).toContain('data-display-mode="card"');
    expect(normalized).toContain('data-attachment="VCS-NSM.pptx"');
  });

  it("recovers legacy view-file div wrappers into card attachment nodes (download attr)", () => {
    const legacy = `<div class="confluence-macro confluence-macro-view-file my-3 inline-flex"><a href="/api/v1/attachments/123/content" download="NSM_Training.pptx">Download</a></div></div>`;
    const normalized = normalizeConfluenceCodeMacros(legacy);
    expect(normalized).toContain('data-display-mode="card"');
    expect(normalized).toContain('data-attachment="NSM_Training.pptx"');
    expect(normalized).toContain('href="/api/v1/attachments/123/content"');
  });

  it("recovers legacy view-file div wrappers into card attachment nodes (title attr)", () => {
    const legacy = `<div class="confluence-macro confluence-macro-view-file"><a href="/content">Download</a><span title="File.pdf"></span></div></div>`;
    const normalized = normalizeConfluenceCodeMacros(legacy);
    expect(normalized).toContain('data-attachment="File.pdf"');
  });

  it("recovers legacy view-file div wrappers into card attachment nodes (text fallback)", () => {
    const legacy = `<div class="confluence-macro confluence-macro-view-file"><a href="/content">Download</a><span>MyDoc.docx</span></div></div>`;
    const normalized = normalizeConfluenceCodeMacros(legacy);
    expect(normalized).toContain('data-attachment="MyDoc.docx"');
  });

  it("recovers legacy view-file div wrappers into card attachment nodes (ext badge fallback)", () => {
    const legacy = `<div class="confluence-macro confluence-macro-view-file"><a href="/content">Download</a><p>MyDoc</p><div class="opacity-15">DOCX</div></div></div>`;
    const normalized = normalizeConfluenceCodeMacros(legacy);
    expect(normalized).toContain('data-attachment="MyDoc.docx"');
  });

  it("renders attachment link with link display mode as inline link and card display mode as tile", async () => {
    render(
      <RichTextContent
        content={`
          <p><a href="/api/v1/attachments/11111111-1111-1111-1111-111111111111/content" data-attachment="doc.pdf" data-display-mode="link" class="attachment-link">doc.pdf</a></p>
          <p><a href="/api/v1/attachments/22222222-2222-2222-2222-222222222222/content" data-attachment="slides.pptx" data-display-mode="card">slides.pptx</a></p>
        `}
      />,
    );

    const linkEl = await screen.findByRole("link", { name: "doc.pdf" });
    expect(linkEl).toHaveClass("attachment-link");

    const cardEl = await screen.findByRole("link", { name: "slides.pptx" });
    expect(cardEl).toHaveClass("group/attachment");
  });
});
