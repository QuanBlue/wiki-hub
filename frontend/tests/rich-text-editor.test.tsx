import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
    expect(image.parentElement).toHaveStyle({
      width: "180px",
      height: "200px",
    });
    expect(image).toHaveStyle({
      width: "600px",
      height: "400px",
      left: "-180px",
      top: "-80px",
    });
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
        height: "200px",
      });
    });
    expect(image).toHaveStyle({
      width: "600px",
      height: "400px",
      left: "-180px",
      top: "-80px",
    });
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

    const link = await screen.findByRole("link", { name: "jmx_exporter.jar" });
    // A node view wrapper is what separates the tile from a plain link mark.
    expect(link.closest("[data-node-view-wrapper]")).not.toBeNull();
    expect(link).toHaveAttribute("title", "jmx_exporter.jar");
    // Dragging an anchor is a browser default; leaving it on would duplicate
    // the tile on drop, exactly as it used to for images.
    expect(link).toHaveAttribute("draggable", "false");
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

    const link = await screen.findByRole("link", { name: "runbook.pdf" });
    expect(link.closest("[data-node-view-wrapper]")).not.toBeNull();
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining('data-attachment="runbook.pdf"'),
      );
    });
  });
});
