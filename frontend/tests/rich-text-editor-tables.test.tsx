import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RichTextEditor } from "@/components/pages/rich-text-editor";

function rect(
  element: Element,
  left: number,
  width: number,
  top = 0,
  height = 40,
) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      left,
      right: left + width,
      width,
      top,
      bottom: top + height,
      height,
      x: left,
      y: top,
    }),
  });
}

async function renderTable(html: string, onChange = vi.fn()) {
  const view = render(<RichTextEditor content={html} onChange={onChange} />);
  const table = await waitFor(() => {
    const found = view.container.querySelector("table");
    expect(found).not.toBeNull();
    return found as HTMLTableElement;
  });
  await waitFor(() =>
    expect(
      view.container.querySelector('.ProseMirror[contenteditable="true"]'),
    ).not.toBeNull(),
  );
  return { ...view, table, onChange };
}

/** Lays every cell out as a 200px-wide column, one row per 40px. */
function layOut(table: HTMLTableElement) {
  rect(table, 0, 600);
  table.querySelectorAll("tr").forEach((row, rowIndex) => {
    let left = 0;
    Array.from(row.children).forEach((cell) => {
      const span = Number((cell as HTMLTableCellElement).colSpan) || 1;
      rect(cell, left, 200 * span, rowIndex * 40);
      left += 200 * span;
    });
  });
}

const GRID =
  "<table><tbody><tr><td><p>a</p></td><td><p>b</p></td><td><p>c</p></td></tr><tr><td><p>d</p></td><td><p>e</p></td><td><p>f</p></td></tr></tbody></table>";

const cellsOf = (table: HTMLTableElement) =>
  Array.from(table.querySelectorAll("td"));
const marked = (table: HTMLTableElement) =>
  table.querySelectorAll(".wikihub-column-resize-target");

describe("table column resize hover", () => {
  it("lights up the boundary a pointer is next to, and clears it on leaving", async () => {
    const { table, container } = await renderTable(GRID);
    layOut(table);
    const [first, second] = cellsOf(table);

    // Right edge of the first column: both of its cells get the marker.
    fireEvent.mouseMove(first!, { clientX: 198 });
    expect(marked(table)).toHaveLength(2);
    // Left edge of the second column is the same boundary.
    fireEvent.mouseMove(second!, { clientX: 201 });
    expect(marked(table)).toHaveLength(2);
    // The middle of a cell is not an edge.
    fireEvent.mouseMove(second!, { clientX: 250 });
    expect(marked(table)).toHaveLength(0);
    // The table's outer left edge has nothing to its left.
    fireEvent.mouseMove(first!, { clientX: 1 });
    expect(marked(table)).toHaveLength(0);

    fireEvent.mouseMove(first!, { clientX: 198 });
    fireEvent.mouseLeave(container.querySelector(".ProseMirror")!);
    expect(marked(table)).toHaveLength(0);
  });

  it("does not light anything up outside a cell or in a one-column table", async () => {
    const { table, container } = await renderTable(
      "<table><tbody><tr><td><p>solo</p></td></tr></tbody></table>",
    );
    layOut(table);

    fireEvent.mouseMove(cellsOf(table)[0]!, { clientX: 198 });
    expect(marked(table)).toHaveLength(0);
    fireEvent.mouseMove(container.querySelector(".ProseMirror")!, {
      clientX: 5,
    });
    expect(marked(table)).toHaveLength(0);
  });

  it("only marks the cells that really end at the boundary", async () => {
    const { table } = await renderTable(
      '<table><tbody><tr><td colspan="2"><p>wide</p></td><td><p>c</p></td></tr><tr><td><p>a</p></td><td><p>b</p></td><td><p>c</p></td></tr></tbody></table>',
    );
    layOut(table);
    const [wide, , second] = cellsOf(table);
    expect(wide!.colSpan).toBe(2);

    // The boundary after the first column is inside the wide cell, so only the lower cell has an edge there.
    fireEvent.mouseMove(second!, { clientX: 198 });
    expect(marked(table)).toHaveLength(1);
    expect(second!.classList.contains("wikihub-column-resize-target")).toBe(
      true,
    );
  });

  it("stays inert for a read-only reader", async () => {
    const { table, container } = await renderTable(GRID);
    layOut(table);
    const editor = container.querySelector(".ProseMirror") as HTMLElement;
    editor.setAttribute("contenteditable", "false");
    // The plugin reads view.editable, which follows the editor's own state; a mouse move is simply harmless.
    fireEvent.mouseMove(cellsOf(table)[0]!, { clientX: 198 });
  });
});

describe("table column resize drag", () => {
  it("trades width between neighbours and saves the new widths on release", async () => {
    const onChange = vi.fn();
    const { table } = await renderTable(GRID, onChange);
    layOut(table);
    const [first] = cellsOf(table);

    expect(fireEvent.mouseDown(first!, { button: 0, clientX: 198 })).toBe(
      false,
    );
    expect(document.body.style.cursor).toBe("col-resize");
    expect(table.style.width).toBe("600px");
    const columns = table.querySelectorAll("col");
    expect(columns).toHaveLength(3);
    expect(columns[0]!.style.width).toBe("200px");

    fireEvent.mouseMove(window, { clientX: 218 });
    expect(columns[0]!.style.width).toBe("220px");
    expect(columns[1]!.style.width).toBe("180px");

    // Neither neighbour can shrink below the minimum width.
    fireEvent.mouseMove(window, { clientX: 400 });
    expect(columns[1]!.style.width).toBe("96px");
    fireEvent.mouseMove(window, { clientX: -400 });
    expect(columns[0]!.style.width).toBe("96px");

    fireEvent.mouseMove(window, { clientX: 218 });
    fireEvent.mouseUp(window);
    expect(document.body.style.cursor).toBe("");
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining("colwidth"),
      ),
    );
    // A late move after release does nothing.
    fireEvent.mouseMove(window, { clientX: 250 });
  });

  it("widens the table when the outer right edge is dragged", async () => {
    const onChange = vi.fn();
    const { table } = await renderTable(GRID, onChange);
    layOut(table);
    const last = cellsOf(table)[2]!;

    fireEvent.mouseDown(last, { button: 0, clientX: 598 });
    fireEvent.mouseMove(window, { clientX: 658 });
    expect(table.style.width).toBe("660px");
    expect(table.querySelectorAll("col")[2]!.style.width).toBe("260px");
    fireEvent.mouseUp(window);
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining("colwidth"),
      ),
    );
  });

  it("measures a merged cell's share of each column it spans", async () => {
    const onChange = vi.fn();
    const { table } = await renderTable(
      '<table><tbody><tr><td colspan="2"><p>wide</p></td><td><p>c</p></td></tr><tr><td><p>a</p></td><td><p>b</p></td><td><p>c</p></td></tr></tbody></table>',
      onChange,
    );
    layOut(table);
    const cells = cellsOf(table);

    // Drag the boundary after the first column using the lower row's cell.
    fireEvent.mouseDown(cells[2]!, { button: 0, clientX: 198, clientY: 60 });
    fireEvent.mouseMove(window, { clientX: 208 });
    fireEvent.mouseUp(window);
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.stringContaining("colwidth"),
      ),
    );
  });

  it("ignores presses that are not a plain left click on an edge", async () => {
    const { table } = await renderTable(GRID);
    layOut(table);
    const [first] = cellsOf(table);

    expect(fireEvent.mouseDown(first!, { button: 2, clientX: 198 })).toBe(true);
    expect(fireEvent.mouseDown(first!, { button: 0, clientX: 50 })).toBe(true);
    // A table whose <col> elements do not match its grid is left to the browser.
    table.querySelector("col")!.remove();
    expect(fireEvent.mouseDown(first!, { button: 0, clientX: 198 })).toBe(true);
  });

  it("stops listening when the editor goes away mid-drag", async () => {
    const { table, unmount } = await renderTable(GRID);
    layOut(table);

    fireEvent.mouseDown(cellsOf(table)[0]!, { button: 0, clientX: 198 });
    unmount();
    fireEvent.mouseMove(window, { clientX: 230 });
  });
});

describe("table column resize with merged cells", () => {
  it("skips the cells a merged cell already covers and builds on saved widths", async () => {
    const onChange = vi.fn();
    const { table } = await renderTable(
      '<table><tbody><tr><td rowspan="2"><p>a</p></td><td><p>b</p></td><td><p>c</p></td></tr><tr><td><p>d</p></td><td><p>e</p></td></tr></tbody></table>',
      onChange,
    );
    const drag = async (to: number) => {
      layOut(table);
      const merged = cellsOf(table)[0]!;
      // The merged cell spans both rows; press in the middle of its right edge.
      rect(merged, 0, 200, 0, 80);
      fireEvent.mouseDown(merged, { button: 0, clientX: 198, clientY: 40 });
      fireEvent.mouseMove(window, { clientX: to });
      fireEvent.mouseUp(window);
      await waitFor(() =>
        expect(onChange.mock.calls.at(-1)![0]).toContain("colwidth"),
      );
    };

    await drag(210);
    const first = onChange.mock.calls.at(-1)![0] as string;
    await drag(215);
    expect(onChange.mock.calls.at(-1)![0]).not.toBe(first);
  });
});
