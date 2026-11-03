import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RichTextEditor, RichTextContent } from "@/components/pages/rich-text-editor";
import { filterSlashCommandItems } from "@/components/pages/slash-command";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg class="test-svg"><g>Test</g></svg>' }),
  },
}));

describe("RichTextEditor Mermaid diagrams", () => {
  it("includes /diagram command in Slash menu with diagram keywords", () => {
    const items = filterSlashCommandItems("diagram");
    expect(items.some((i) => i.id === "diagram")).toBe(true);

    const mermaidItems = filterSlashCommandItems("mermaid");
    expect(mermaidItems.some((i) => i.id === "diagram")).toBe(true);

    const flowchartItems = filterSlashCommandItems("flowchart");
    expect(flowchartItems.some((i) => i.id === "diagram")).toBe(true);
  });

  it("renders a diagram node from saved HTML with data-type='diagram'", async () => {
    const html = '<div data-type="diagram" data-engine="mermaid" data-code="flowchart TD&#10;A--&gt;B" data-look="classic"></div>';
    const onChange = vi.fn();
    const view = render(<RichTextEditor content={html} onChange={onChange} />);

    await waitFor(() => {
      const diagramEl = view.container.querySelector('[data-type="diagram"]');
      expect(diagramEl).not.toBeNull();
    });

    const diagram = view.container.querySelector('[data-type="diagram"]') as HTMLElement;
    expect(diagram.getAttribute("data-engine")).toBe("mermaid");
  });

  it.each([
    ["language code", '<code class="language-mermaid">graph TD; A--&gt;B</code>'],
    ["preformatted code", "<pre>graph TD; A--&gt;B</pre>"],
    ["plain text", "graph TD; A--&gt;B"],
    ["an empty element", ""],
  ])("reads diagram source from %s when data-code is absent", async (_, body) => {
    const view = render(
      <RichTextContent content={`<div data-type="diagram" data-engine="mermaid">${body}</div>`} />,
    );
    await waitFor(() =>
      expect(view.container.querySelector('[data-type="diagram"]')).toHaveAttribute(
        "data-code", body ? "graph TD; A-->B" : "",
      ),
    );
  });

  it("converts standard language-mermaid code blocks into diagram nodes", async () => {
    const html = '<pre><code class="language-mermaid">graph TD\n  Start --&gt; End</code></pre>';
    const onChange = vi.fn();
    const view = render(<RichTextEditor content={html} onChange={onChange} />);

    await waitFor(() => {
      const diagramEl = view.container.querySelector('[data-type="diagram"]');
      expect(diagramEl).not.toBeNull();
    });
  });

  it("renders in read-only RichTextContent without errors and without editor chrome frame", async () => {
    const html = '<div data-type="diagram" data-engine="mermaid" data-code="sequenceDiagram&#10;Alice-&gt;&gt;Bob: Hi" data-look="handDrawn" data-width="480" data-alignment="center" data-caption="A sequence diagram"></div>';
    const onReady = vi.fn();
    const view = render(<RichTextContent content={html} onReady={onReady} />);

    await waitFor(() => {
      const diagramEl = view.container.querySelector('[data-type="diagram"]');
      expect(diagramEl).not.toBeNull();
      expect(diagramEl?.getAttribute("data-look")).toBe("handDrawn");
      expect(diagramEl?.getAttribute("data-width")).toBe("480");
      expect(diagramEl?.getAttribute("data-alignment")).toBe("center");
      // Check that edit toolbar / delete button is not rendered in view mode
      expect(view.container.querySelector('button[aria-label="Delete diagram"]')).toBeNull();
    });
  });

  it("inserts a diagram node when clicking the diagram button on the toolbar", async () => {
    const onChange = vi.fn();
    const view = render(<RichTextEditor content="<p>Test</p>" onChange={onChange} />);

    await waitFor(() => {
      const btn = view.container.querySelector('button[aria-label="Insert diagram (Mermaid)"]');
      expect(btn).not.toBeNull();
    });

    const btn = view.container.querySelector('button[aria-label="Insert diagram (Mermaid)"]') as HTMLButtonElement;
    fireEvent.click(btn);

    await waitFor(() => {
      const diagramEl = view.container.querySelector('[data-type="diagram"]');
      expect(diagramEl).not.toBeNull();
    });
  });

  it("opens fullscreen modal when clicking the diagram, with pan, zoom and context menu", async () => {
    const html = '<div data-type="diagram" data-engine="mermaid" data-code="flowchart TD&#10;A--&gt;B" data-look="classic" data-caption="Test Flow"></div>';
    const onChange = vi.fn();
    const view = render(<RichTextEditor content={html} onChange={onChange} />);

    await waitFor(() => {
      const diagramEl = view.container.querySelector('.mermaid-render-output') as HTMLElement;
      expect(diagramEl).not.toBeNull();
    });

    const diagramEl = view.container.querySelector('.mermaid-render-output') as HTMLElement;
    
    // Right click opens context menu
    fireEvent.contextMenu(diagramEl);
    await waitFor(() => {
      expect(view.container.textContent).toContain("Copy image as PNG");
      expect(view.container.textContent).toContain("Copy Mermaid code");
      expect(view.container.textContent).toContain("Download PNG image");
      expect(view.container.textContent).toContain("Download SVG vector");
      expect(view.container.textContent).toContain("Download Mermaid file (.mmd)");
    });

    // Left click on diagram opens fullscreen zoom modal
    fireEvent.click(diagramEl);

    // Fullscreen modal should now be open
    await waitFor(() => {
      expect(view.container.textContent).toContain("Test Flow");
      expect(view.container.textContent).toContain("100%");
      expect(view.container.querySelector('button[title="Phóng to (+)"]')).not.toBeNull();
      expect(view.container.querySelector('button[title="Thu nhỏ (-)"]')).not.toBeNull();
      expect(view.container.querySelector('button[title="Tải xuống ảnh PNG"]')).not.toBeNull();
      expect(view.container.querySelector('button[title="Tải xuống vector SVG"]')).not.toBeNull();
      expect(view.container.querySelector('button[title="Tải xuống file Mermaid (.mmd)"]')).not.toBeNull();
    });

    // Click Zoom In button
    const zoomInBtn = view.container.querySelector('button[title="Phóng to (+)"]') as HTMLButtonElement;
    fireEvent.click(zoomInBtn);
    expect(view.container.textContent).toContain("125%");

    const zoomOutBtn = [...view.container.querySelectorAll("button")].find((button) => button.title.endsWith("(-)"))!;
    fireEvent.click(zoomOutBtn);
    expect(view.container.textContent).toContain("100%");
    const canvas = view.container.querySelector('.cursor-grab') as HTMLElement;
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 20, clientY: 20 });
    expect(view.container.textContent).toContain("115%");
    fireEvent.doubleClick(canvas);
    expect(view.container.textContent).toContain("100%");

    const createObjectURL = vi.fn(() => "blob:test-diagram");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click([...view.container.querySelectorAll("button")].find((button) => button.title.includes("SVG"))!);
    fireEvent.click([...view.container.querySelectorAll("button")].find((button) => button.title.includes(".mmd"))!);
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    anchorClick.mockRestore();

    // Click Reset 100% button
    const resetBtn = view.container.querySelector('button[title="Đặt lại tỉ lệ (100%)"]') as HTMLButtonElement;
    fireEvent.click(resetBtn);
    expect(view.container.textContent).toContain("100%");

    // Close modal via close button
    const closeBtn = view.container.querySelector('button[title="Đóng (ESC)"]') as HTMLButtonElement;
    fireEvent.click(closeBtn);
    expect(view.container.querySelector('button[title="Đóng (ESC)"]')).toBeNull();
  });

  it("edits Mermaid code, view mode, look, alignment and caption", async () => {
    const html = '<div data-type="diagram" data-engine="mermaid" data-code="flowchart TD&#10;A--&gt;B" data-look="classic"></div>';
    const onChange = vi.fn();
    const view = render(<RichTextEditor content={html} onChange={onChange} />);
    await waitFor(() => expect(view.container.querySelector('button[title="Code"]')).not.toBeNull());
    fireEvent.click(view.container.querySelector('button[title="Code"]')!);
    const input = view.container.querySelector("textarea") as HTMLTextAreaElement;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: "flowchart LR\nA-->C" } });
    fireEvent.keyDown(input, { key: "Tab" });
    fireEvent.click(view.container.querySelector('button[title="Split"]')!);
    fireEvent.click(view.container.querySelector('button[title="Preview"]')!);
    fireEvent.click(view.container.querySelector('button[title="Hand-drawn"]')!);
    await waitFor(() => expect(view.container.querySelector('button[title="Classic"]')).not.toBeNull());
    fireEvent.click(view.container.querySelector('button[title="Căn trái"]')!);
    fireEvent.click(view.container.querySelector('button[title="Căn phải"]')!);
    fireEvent.click(view.container.querySelector('button[title="Căn giữa"]')!);
    const caption = view.container.querySelector('input[placeholder]') as HTMLInputElement;
    fireEvent.change(caption, { target: { value: "Flow" } });
    fireEvent.blur(caption);
    expect(onChange).toHaveBeenCalled();
    await userEvent.click(view.container.querySelector('button[title="Templates"]')!);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Flowchart" }));
  });

});
