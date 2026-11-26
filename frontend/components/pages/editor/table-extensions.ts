import { TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { CellSelection, TableMap } from "@tiptap/pm/tables";
import { type Editor } from "@tiptap/react";

const NO_BORDER_VALUE = "0px solid transparent";

function isNoBorderValue(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim().toLowerCase();
  return (
    trimmed === "none" ||
    trimmed === "0" ||
    trimmed.startsWith("0px") ||
    trimmed.includes(" none")
  );
}

function parseUniformBorder(element: HTMLElement): string | null {
  const shorthand = element.style.getPropertyValue("border").trim();
  if (shorthand) return shorthand;
  if (
    element.style.borderStyle === "none" ||
    element.style.borderWidth === "0px"
  ) {
    return NO_BORDER_VALUE;
  }
  return null;
}

function parseSideBorder(
  element: HTMLElement,
  side: "top" | "right" | "bottom" | "left",
): string | null {
  if (parseUniformBorder(element)) return null;
  const value = element.style.getPropertyValue(`border-${side}`).trim();
  if (value) return value;
  const styleProp = element.style
    .getPropertyValue(`border-${side}-style`)
    .trim();
  const widthProp = element.style
    .getPropertyValue(`border-${side}-width`)
    .trim();
  if (styleProp === "none" || widthProp === "0px") return NO_BORDER_VALUE;
  return null;
}

const tableCellFormattingAttributes = {
  backgroundColor: {
    default: null,
    parseHTML: (element: HTMLElement) => element.style.backgroundColor || null,
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.backgroundColor
        ? { style: `background-color: ${attributes.backgroundColor}` }
        : {},
  },
  textAlign: {
    default: null,
    parseHTML: (element: HTMLElement) => element.style.textAlign || null,
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.textAlign ? { style: `text-align: ${attributes.textAlign}` } : {},
  },
  color: {
    default: null,
    parseHTML: (element: HTMLElement) => element.style.color || null,
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.color ? { style: `color: ${attributes.color}` } : {},
  },
  fontSize: {
    default: null,
    parseHTML: (element: HTMLElement) => element.style.fontSize || null,
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.fontSize ? { style: `font-size: ${attributes.fontSize}` } : {},
  },
  widthPercent: {
    default: null,
    parseHTML: (element: HTMLElement) => {
      const value = element.style.width.trim();
      return value.endsWith("%") ? value : null;
    },
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.widthPercent
        ? { style: `width: ${attributes.widthPercent}` }
        : {},
  },
  verticalAlign: {
    default: null,
    parseHTML: (element: HTMLElement) => element.style.verticalAlign || null,
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.verticalAlign
        ? { style: `vertical-align: ${attributes.verticalAlign}` }
        : {},
  },
  border: {
    default: null,
    parseHTML: (element: HTMLElement) => parseUniformBorder(element),
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.border ? { style: `border: ${attributes.border}` } : {},
  },
  borderTop: {
    default: null,
    parseHTML: (element: HTMLElement) => parseSideBorder(element, "top"),
    renderHTML: (attributes: Record<string, unknown>) =>
      !attributes.border && attributes.borderTop
        ? { style: `border-top: ${attributes.borderTop}` }
        : {},
  },
  borderRight: {
    default: null,
    parseHTML: (element: HTMLElement) => parseSideBorder(element, "right"),
    renderHTML: (attributes: Record<string, unknown>) =>
      !attributes.border && attributes.borderRight
        ? { style: `border-right: ${attributes.borderRight}` }
        : {},
  },
  borderBottom: {
    default: null,
    parseHTML: (element: HTMLElement) => parseSideBorder(element, "bottom"),
    renderHTML: (attributes: Record<string, unknown>) =>
      !attributes.border && attributes.borderBottom
        ? { style: `border-bottom: ${attributes.borderBottom}` }
        : {},
  },
  borderLeft: {
    default: null,
    parseHTML: (element: HTMLElement) => parseSideBorder(element, "left"),
    renderHTML: (attributes: Record<string, unknown>) =>
      !attributes.border && attributes.borderLeft
        ? { style: `border-left: ${attributes.borderLeft}` }
        : {},
  },
  diagonalDown: {
    default: null,
    parseHTML: (element: HTMLElement) =>
      element.getAttribute("data-diagonal-down") || null,
    renderHTML: (attributes: Record<string, unknown>) => {
      if (typeof attributes.diagonalDown !== "string" || !attributes.diagonalDown)
        return {};
      const parsed = parseBorderDeclaration(attributes.diagonalDown);
      const halfWidth = parsed
        ? Math.max(0.75, Number.parseFloat(parsed.width) / 2)
        : 0.75;
      const color = parsed?.color ?? DEFAULT_BORDER_COLOR;
      return {
        "data-diagonal-down": attributes.diagonalDown,
        style: `--wh-diag-down-color: ${color}; --wh-diag-down-width: ${halfWidth}px`,
      };
    },
  },
  diagonalUp: {
    default: null,
    parseHTML: (element: HTMLElement) =>
      element.getAttribute("data-diagonal-up") || null,
    renderHTML: (attributes: Record<string, unknown>) => {
      if (typeof attributes.diagonalUp !== "string" || !attributes.diagonalUp)
        return {};
      const parsed = parseBorderDeclaration(attributes.diagonalUp);
      const halfWidth = parsed
        ? Math.max(0.75, Number.parseFloat(parsed.width) / 2)
        : 0.75;
      const color = parsed?.color ?? DEFAULT_BORDER_COLOR;
      return {
        "data-diagonal-up": attributes.diagonalUp,
        style: `--wh-diag-up-color: ${color}; --wh-diag-up-width: ${halfWidth}px`,
      };
    },
  },
};

export const TableCellWithBackground = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...tableCellFormattingAttributes,
    };
  },
});
export const TableHeaderWithBackground = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...tableCellFormattingAttributes,
    };
  },
});

export type TableBorderScope = "table" | "cells";
export type TableBorderPlacement =
  | "bottom"
  | "top"
  | "left"
  | "right"
  | "none"
  | "all"
  | "outer"
  | "inside"
  | "inside-horizontal"
  | "inside-vertical"
  | "diagonal-down"
  | "diagonal-up";
export type TableBorderStyle =
  | "solid"
  | "dotted"
  | "dashed"
  | "double"
  | "groove"
  | "ridge"
  | "inset"
  | "outset";
export type TableBorderWidth = "1px" | "2px" | "3px" | "4px";

export type TableBorderConfig = {
  placement: TableBorderPlacement;
  style: TableBorderStyle;
  width: TableBorderWidth;
  color: string;
};

const DEFAULT_BORDER_COLOR = "var(--border-strong)";

const BORDER_STYLE_RE =
  /^(\d+(?:\.\d+)?px)\s+(solid|dotted|dashed|double|groove|ridge|inset|outset)\s+(.+)$/i;

function parseBorderDeclaration(raw: string | null | undefined): {
  width: TableBorderWidth;
  style: TableBorderStyle;
  color: string;
} | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || isNoBorderValue(trimmed)) return null;
  const match = trimmed.match(BORDER_STYLE_RE);
  if (!match) return null;
  const px = Math.round(Number.parseFloat(match[1]!));
  const width: TableBorderWidth =
    px >= 4 ? "4px" : px === 3 ? "3px" : px === 2 ? "2px" : "1px";
  const style = match[2]!.toLowerCase() as TableBorderStyle;
  const color = match[3]!.trim();
  return { width, style, color };
}

export function hasMultiCellSelection(editor: Editor | null): boolean {
  if (!editor) return false;
  const sel = editor.state.selection as unknown as {
    $anchorCell?: { pos: number };
    $headCell?: { pos: number };
  };
  return Boolean(
    sel.$anchorCell &&
      sel.$headCell &&
      sel.$anchorCell.pos !== sel.$headCell.pos,
  );
}

export function getSelectedCellCount(editor: Editor | null): number {
  if (!editor) return 0;
  const { selection } = editor.state;
  if (selection instanceof CellSelection) {
    let count = 0;
    selection.forEachCell(() => {
      count += 1;
    });
    return count;
  }
  const { $from } = selection;
  for (let depth = $from.depth; depth >= 1; depth -= 1) {
    const role = $from.node(depth).type.spec.tableRole;
    if (role === "cell" || role === "header_cell") return 1;
  }
  return 0;
}

export function readTableBorderConfig(editor: Editor | null): TableBorderConfig {
  const fallback: TableBorderConfig = {
    placement: "all",
    style: "solid",
    width: "1px",
    color: DEFAULT_BORDER_COLOR,
  };
  if (!editor) return fallback;

  const { $from } = editor.state.selection;
  let cellAttrs: Record<string, unknown> | null = null;
  for (let depth = $from.depth; depth >= 1; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      cellAttrs = node.attrs;
      break;
    }
  }
  if (!cellAttrs) return fallback;

  const border = typeof cellAttrs.border === "string" ? cellAttrs.border : null;
  const borderTop =
    typeof cellAttrs.borderTop === "string" ? cellAttrs.borderTop : null;
  const borderRight =
    typeof cellAttrs.borderRight === "string" ? cellAttrs.borderRight : null;
  const borderBottom =
    typeof cellAttrs.borderBottom === "string" ? cellAttrs.borderBottom : null;
  const borderLeft =
    typeof cellAttrs.borderLeft === "string" ? cellAttrs.borderLeft : null;
  const diagonalDown =
    typeof cellAttrs.diagonalDown === "string" ? cellAttrs.diagonalDown : null;
  const diagonalUp =
    typeof cellAttrs.diagonalUp === "string" ? cellAttrs.diagonalUp : null;

  if (isNoBorderValue(border)) {
    const diagParsed =
      parseBorderDeclaration(diagonalDown) ?? parseBorderDeclaration(diagonalUp);
    if (diagParsed) {
      return {
        placement: diagonalDown ? "diagonal-down" : "diagonal-up",
        ...diagParsed,
      };
    }
    return { ...fallback, placement: "none" };
  }

  const parsedUniform = parseBorderDeclaration(border);
  if (parsedUniform) {
    return { placement: "all", ...parsedUniform };
  }

  const sides = [borderTop, borderRight, borderBottom, borderLeft];
  const parsedSide = sides
    .map((s) => parseBorderDeclaration(s))
    .find((p) => p !== null);

  if (parsedSide) {
    const hasTop = !isNoBorderValue(borderTop) && borderTop !== null;
    const hasRight = !isNoBorderValue(borderRight) && borderRight !== null;
    const hasBottom = !isNoBorderValue(borderBottom) && borderBottom !== null;
    const hasLeft = !isNoBorderValue(borderLeft) && borderLeft !== null;
    let placement: TableBorderPlacement = "outer";
    if (hasBottom && !hasTop && !hasLeft && !hasRight) placement = "bottom";
    else if (hasTop && !hasBottom && !hasLeft && !hasRight) placement = "top";
    else if (hasLeft && !hasTop && !hasBottom && !hasRight) placement = "left";
    else if (hasRight && !hasTop && !hasBottom && !hasLeft) placement = "right";
    else if ((hasTop || hasBottom) && !hasLeft && !hasRight)
      placement = "inside-horizontal";
    else if ((hasLeft || hasRight) && !hasTop && !hasBottom)
      placement = "inside-vertical";
    return { placement, ...parsedSide };
  }

  if (sides.some((s) => isNoBorderValue(s))) {
    return { ...fallback, placement: "outer" };
  }

  return fallback;
}

function expandCellSides(attrs: Record<string, unknown>): {
  borderTop: string | null;
  borderRight: string | null;
  borderBottom: string | null;
  borderLeft: string | null;
} {
  const uniform = typeof attrs.border === "string" ? attrs.border : null;
  if (uniform) {
    return {
      borderTop: uniform,
      borderRight: uniform,
      borderBottom: uniform,
      borderLeft: uniform,
    };
  }
  return {
    borderTop: typeof attrs.borderTop === "string" ? attrs.borderTop : null,
    borderRight:
      typeof attrs.borderRight === "string" ? attrs.borderRight : null,
    borderBottom:
      typeof attrs.borderBottom === "string" ? attrs.borderBottom : null,
    borderLeft: typeof attrs.borderLeft === "string" ? attrs.borderLeft : null,
  };
}

export function applyTableBorder(
  editor: Editor | null,
  scope: TableBorderScope,
  config: TableBorderConfig | "reset",
): boolean {
  if (!editor) return false;

  return editor
    .chain()
    .command(({ state, tr, dispatch }) => {
      const { selection } = state;
      const { $from, $to } = selection;

      let tableDepth = -1;
      for (let depth = $from.depth; depth >= 1; depth -= 1) {
        if ($from.node(depth).type.name === "table") {
          tableDepth = depth;
          break;
        }
      }
      if (tableDepth < 0) return false;

      const tableNode = $from.node(tableDepth);
      const tableStart = $from.before(tableDepth) + 1;
      const map = TableMap.get(tableNode);

      const targetOffsets = new Set<number>();
      let bounds = {
        top: 0,
        bottom: map.height,
        left: 0,
        right: map.width,
      };

      if (scope === "table") {
        for (const offset of map.map) {
          targetOffsets.add(offset);
        }
      } else {
        const cellSel = selection as unknown as {
          $anchorCell?: { pos: number };
          $headCell?: { pos: number };
        };
        if (cellSel.$anchorCell && cellSel.$headCell) {
          const rect = map.rectBetween(
            cellSel.$anchorCell.pos - tableStart,
            cellSel.$headCell.pos - tableStart,
          );
          bounds = rect;
          for (const offset of map.cellsInRect(rect)) {
            targetOffsets.add(offset);
          }
        } else {
          let minTop = map.height;
          let maxBottom = 0;
          let minLeft = map.width;
          let maxRight = 0;
          const seen = new Set<number>();
          for (const offset of map.map) {
            if (seen.has(offset)) continue;
            seen.add(offset);
            const cellNode = tableNode.nodeAt(offset);
            if (!cellNode) continue;
            const cellPos = tableStart + offset;
            const cellEnd = cellPos + cellNode.nodeSize - 1;
            const matches = selection.empty
              ? $from.pos >= cellPos && $from.pos <= cellEnd + 1
              : $from.pos <= cellEnd && $to.pos >= cellPos + 1;
            if (matches) {
              targetOffsets.add(offset);
              const r = map.findCell(offset);
              minTop = Math.min(minTop, r.top);
              maxBottom = Math.max(maxBottom, r.bottom);
              minLeft = Math.min(minLeft, r.left);
              maxRight = Math.max(maxRight, r.right);
            }
          }
          if (targetOffsets.size > 0) {
            bounds = {
              top: minTop,
              bottom: maxBottom,
              left: minLeft,
              right: maxRight,
            };
          }
        }
      }

      if (targetOffsets.size === 0) return false;

      const value =
        config === "reset"
          ? null
          : `${config.width} ${config.style} ${config.color}`;

      // For diagonal toggles, check if every target cell already has the exact same diagonal.
      const allHaveDiagonalDown =
        config !== "reset" &&
        config.placement === "diagonal-down" &&
        Array.from(targetOffsets).every(
          (offset) => tableNode.nodeAt(offset)?.attrs.diagonalDown === value,
        );
      const allHaveDiagonalUp =
        config !== "reset" &&
        config.placement === "diagonal-up" &&
        Array.from(targetOffsets).every(
          (offset) => tableNode.nodeAt(offset)?.attrs.diagonalUp === value,
        );

      for (const offset of targetOffsets) {
        const cellNode = tableNode.nodeAt(offset);
        if (!cellNode) continue;
        const r = map.findCell(offset);

        let borderAttrs: Record<string, string | null>;
        if (config === "reset") {
          borderAttrs = {
            border: null,
            borderTop: null,
            borderRight: null,
            borderBottom: null,
            borderLeft: null,
            diagonalDown: null,
            diagonalUp: null,
          };
        } else if (config.placement === "none") {
          borderAttrs = {
            border: NO_BORDER_VALUE,
            borderTop: null,
            borderRight: null,
            borderBottom: null,
            borderLeft: null,
            diagonalDown: null,
            diagonalUp: null,
          };
        } else if (config.placement === "all") {
          borderAttrs = {
            border: value,
            borderTop: null,
            borderRight: null,
            borderBottom: null,
            borderLeft: null,
          };
        } else if (config.placement === "outer") {
          borderAttrs = {
            border: null,
            borderTop: r.top === bounds.top ? value : NO_BORDER_VALUE,
            borderRight: r.right === bounds.right ? value : NO_BORDER_VALUE,
            borderBottom: r.bottom === bounds.bottom ? value : NO_BORDER_VALUE,
            borderLeft: r.left === bounds.left ? value : NO_BORDER_VALUE,
          };
        } else if (config.placement === "inside") {
          borderAttrs = {
            border: null,
            borderTop: r.top > bounds.top ? value : NO_BORDER_VALUE,
            borderRight: r.right < bounds.right ? value : NO_BORDER_VALUE,
            borderBottom: r.bottom < bounds.bottom ? value : NO_BORDER_VALUE,
            borderLeft: r.left > bounds.left ? value : NO_BORDER_VALUE,
          };
        } else if (config.placement === "inside-horizontal") {
          borderAttrs = {
            border: null,
            borderTop: r.top > bounds.top ? value : NO_BORDER_VALUE,
            borderRight: NO_BORDER_VALUE,
            borderBottom: r.bottom < bounds.bottom ? value : NO_BORDER_VALUE,
            borderLeft: NO_BORDER_VALUE,
          };
        } else if (config.placement === "inside-vertical") {
          borderAttrs = {
            border: null,
            borderTop: NO_BORDER_VALUE,
            borderRight: r.right < bounds.right ? value : NO_BORDER_VALUE,
            borderBottom: NO_BORDER_VALUE,
            borderLeft: r.left > bounds.left ? value : NO_BORDER_VALUE,
          };
        } else if (config.placement === "bottom") {
          if (r.bottom !== bounds.bottom) continue;
          const sides = expandCellSides(cellNode.attrs);
          borderAttrs = {
            border: null,
            ...sides,
            borderBottom: value,
          };
        } else if (config.placement === "top") {
          if (r.top !== bounds.top) continue;
          const sides = expandCellSides(cellNode.attrs);
          borderAttrs = {
            border: null,
            ...sides,
            borderTop: value,
          };
        } else if (config.placement === "left") {
          if (r.left !== bounds.left) continue;
          const sides = expandCellSides(cellNode.attrs);
          borderAttrs = {
            border: null,
            ...sides,
            borderLeft: value,
          };
        } else if (config.placement === "right") {
          if (r.right !== bounds.right) continue;
          const sides = expandCellSides(cellNode.attrs);
          borderAttrs = {
            border: null,
            ...sides,
            borderRight: value,
          };
        } else if (config.placement === "diagonal-down") {
          borderAttrs = {
            diagonalDown: allHaveDiagonalDown ? null : value,
          };
        } else {
          borderAttrs = {
            diagonalUp: allHaveDiagonalUp ? null : value,
          };
        }

        tr.setNodeMarkup(tableStart + offset, undefined, {
          ...cellNode.attrs,
          ...borderAttrs,
        });
      }

      if (dispatch && tr.docChanged) dispatch(tr);
      return true;
    })
    .run();
}

function normaliseTableRowHeight(value: unknown): number | null {
  const height = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(height) && height >= 32 && height <= 2000
    ? Math.round(height)
    : null;
}

export const TableRowWithHeight = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      height: {
        default: null,
        parseHTML: (element) => normaliseTableRowHeight(element.style.height),
        renderHTML: (attributes) => {
          const height = normaliseTableRowHeight(attributes.height);
          return height ? { style: `height: ${height}px` } : {};
        },
      },
    };
  },

  // Rendering rows through a node view lets TableRowResize preview a drag by
  // writing `<tr>.style.height` directly, the way TableColumnResize previews
  // on `<col>.style.width`. Without `ignoreMutation`, ProseMirror's DOM
  // observer would see that style change (it is the very thing `height` parses
  // from) as an unexpected edit and redraw the row back. Previewing in the DOM
  // rather than dispatching per frame is what keeps the drag smooth: every
  // transaction re-serialises the whole document through onTransaction and
  // re-renders the live preview.
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("tr");
      const applyHeight = (source: typeof node) => {
        const height = normaliseTableRowHeight(source.attrs.height);
        dom.style.height = height ? `${height}px` : "";
      };
      applyHeight(node);
      return {
        dom,
        contentDOM: dom,
        // Only the row's own attributes are ignored; child mutations still
        // have to reach ProseMirror so typing inside cells is read normally.
        ignoreMutation: (mutation) =>
          mutation.type === "attributes" && mutation.target === dom,
        update: (updated) => {
          if (updated.type !== node.type) return false;
          applyHeight(updated);
          return true;
        },
      };
    };
  },
});

// Keep these grab zones thin: a wide band along every cell edge swallows the
// mousedown of a text-selection drag and turns it into a row/column resize.
const TABLE_ROW_RESIZE_ZONE = 3;
const TABLE_COLUMN_RESIZE_ZONE = 4;
export const TABLE_CELL_MIN_WIDTH = 96;
const TABLE_ROW_MIN_HEIGHT = 32;

type TableColumnResizeState = {
  table: HTMLTableElement;
  tableNode: ReturnType<Editor["state"]["doc"]["nodeAt"]>;
  tableStart: number;
  leftColumn: number;
  /** null while dragging the table's outer right edge, which has no neighbour. */
  rightColumn: number | null;
  startX: number;
  startLeftWidth: number;
  startRightWidth: number;
  startTableWidth: number;
  widths: number[];
};

function tableContextAtCell(view: Editor["view"], cell: HTMLElement) {
  const $position = view.state.doc.resolve(view.posAtDOM(cell, 0));
  // A cell always sits inside a table, so the walk up always finds one.
  let depth = $position.depth;
  while ($position.node(depth).type.name !== "table") depth -= 1;
  const start = $position.start(depth);
  // table > row > cell: the cell sits two levels below the table.
  const cellOffset = $position.before(depth + 2) - start;
  return { node: $position.node(depth), start, cellOffset };
}

function persistTableColumnWidths(
  view: Editor["view"],
  table: NonNullable<TableColumnResizeState["tableNode"]>,
  tableStart: number,
  widths: number[],
) {
  const map = TableMap.get(table);
  const transaction = view.state.tr;
  const seen = new Set<number>();

  for (const cellOffset of map.map) {
    if (seen.has(cellOffset)) continue;
    seen.add(cellOffset);
    const cell = table.nodeAt(cellOffset);
    if (!cell) continue;
    const attributes = cell.attrs;
    const startColumn = map.colCount(cellOffset);
    const span = Math.max(1, Number(attributes.colspan) || 1);
    const columnWidths = widths.slice(startColumn, startColumn + span);
    if (columnWidths.length !== span) continue;

    const currentWidths = Array.isArray(attributes.colwidth)
      ? attributes.colwidth
      : null;
    const widthsUnchanged =
      currentWidths !== null &&
      currentWidths.length === columnWidths.length &&
      currentWidths.every((value, index) => value === columnWidths[index]);
    if (widthsUnchanged && !attributes.widthPercent) continue;

    transaction.setNodeMarkup(tableStart + cellOffset, undefined, {
      ...attributes,
      colwidth: columnWidths,
      widthPercent: null,
    });
  }

  if (transaction.docChanged) view.dispatch(transaction);
}

export const TABLE_COLUMN_HOVER_KEY = new PluginKey<{
  key: string | null;
  decorations: DecorationSet;
}>("tableColumnResizeHover");

/**
 * Keeps a table's overall width stable while a boundary moves. Tiptap's
 * default column plugin changes only one column, which lets every remaining
 * auto-sized column redistribute and makes unrelated boundaries drift.
 */
export const TableColumnResize = Extension.create({
  name: "tableColumnResize",
  priority: 1000,
  addProseMirrorPlugins() {
    let activeResize: TableColumnResizeState | undefined;
    let disposeDrag = () => undefined;

    // Highlight hovered column edges via ProseMirror decorations rather than
    // mutating `<td>`/`<th>` classes directly. Direct classList edits trigger
    // ProseMirror's DOMObserver (`readDOMChange`), which re-reads the hidden
    // native selection inside the last cell and collapses an active
    // CellSelection into a single-cell TextSelection.
    const updateColumnHover = (
      view: Editor["view"],
      target: ReturnType<typeof resizeTarget>,
    ) => {
      const nextKey = target
        ? `${target.context.start}:${target.leftColumn}`
        : null;
      const currentKey =
        TABLE_COLUMN_HOVER_KEY.getState(view.state)?.key ?? null;
      if (nextKey === currentKey) return;

      let decorations = DecorationSet.empty;
      if (target) {
        // A merged cell spans several grid columns, and a rowspan cell is missing
        // from the rows it covers, so a cell's index among its row's DOM children
        // is not its grid column. Every lookup below goes through the TableMap.
        const { map, context, leftColumn } = target;
        const nodes: Decoration[] = [];
        const seen = new Set<number>();
        for (let row = 0; row < map.height; row += 1) {
          const offset = map.map[row * map.width + leftColumn];
          if (seen.has(offset)) continue;
          seen.add(offset);
          const cellNode = context.node.nodeAt(offset);
          // Only a cell that *ends* at this boundary has a real edge here; one
          // that merely spans across it has no line to grab, or to light up.
          if (!cellNode) continue;
          if (
            map.colCount(offset) + cellNode.attrs.colspan - 1 !==
            leftColumn
          ) {
            continue;
          }
          const pos = context.start + offset;
          nodes.push(
            Decoration.node(pos, pos + cellNode.nodeSize, {
              class: "wikihub-column-resize-target",
            }),
          );
        }
        decorations = DecorationSet.create(view.state.doc, nodes);
      }

      view.dispatch(
        view.state.tr
          .setMeta(TABLE_COLUMN_HOVER_KEY, { key: nextKey, decorations })
          .setMeta("addToHistory", false),
      );
    };

    const clearColumnHover = (view: Editor["view"]) => {
      updateColumnHover(view, null);
    };

    const resizeTarget = (view: Editor["view"], event: MouseEvent) => {
      const cell = (event.target as HTMLElement | null)?.closest(
        "th, td",
      ) as HTMLTableCellElement | null;
      const table = cell?.closest("table") as HTMLTableElement | null;
      if (!cell || !table) return null;
      const context = tableContextAtCell(view, cell);
      const map = TableMap.get(context.node);
      if (map.width < 2) return null;
      const rect = map.findCell(context.cellOffset);

      const bounds = cell.getBoundingClientRect();
      const nearLeft = event.clientX - bounds.left <= TABLE_COLUMN_RESIZE_ZONE;
      const nearRight =
        bounds.right - event.clientX <= TABLE_COLUMN_RESIZE_ZONE;
      // The cell's own edges only: a merged cell has no boundary inside it.
      const leftColumn = nearRight
        ? rect.right - 1
        : nearLeft
          ? rect.left - 1
          : -1;
      // The table's outer *left* edge has nothing to its left to resize, so it
      // stays inert. Its outer right edge does resize the last column - there
      // is simply no neighbour to trade width with, so the table itself grows.
      if (leftColumn < 0) return null;
      const rightColumn = leftColumn + 1 < map.width ? leftColumn + 1 : null;
      return { table, context, map, leftColumn, rightColumn };
    };

    // Rendered width of every grid column. Cells that span several columns
    // only contribute an even share for a column no single-column cell covers.
    const gridColumnWidths = (
      view: Editor["view"],
      target: NonNullable<ReturnType<typeof resizeTarget>>,
    ) => {
      const { map, context } = target;
      const widths: number[] = Array(map.width).fill(0);
      const seen = new Set<number>();
      const spanning: {
        column: number;
        span: number;
        width: number;
        colwidth: number[] | null;
      }[] = [];
      for (const offset of map.map) {
        if (seen.has(offset)) continue;
        seen.add(offset);
        const cellNode = context.node.nodeAt(offset);
        const dom = view.nodeDOM(context.start + offset);
        if (!cellNode || !(dom instanceof HTMLElement)) continue;
        const width = dom.getBoundingClientRect().width;
        const column = map.colCount(offset);
        if (cellNode.attrs.colspan === 1) widths[column] = width;
        else
          spanning.push({
            column,
            span: cellNode.attrs.colspan,
            width,
            colwidth: Array.isArray(cellNode.attrs.colwidth)
              ? cellNode.attrs.colwidth
              : null,
          });
      }
      for (const { column, span, width, colwidth } of spanning) {
        for (let index = column; index < column + span; index += 1) {
          if (!widths[index]) {
            const savedWidth = colwidth?.[index - column];
            widths[index] =
              typeof savedWidth === "number" && savedWidth > 0
                ? savedWidth
                : width / span;
          }
        }
      }
      return widths.map((width) =>
        Math.max(TABLE_CELL_MIN_WIDTH, Math.round(width)),
      );
    };

    return [
      new Plugin({
        key: TABLE_COLUMN_HOVER_KEY,
        state: {
          init: () => ({ key: null, decorations: DecorationSet.empty }),
          apply: (tr, value) => {
            const next = tr.getMeta(TABLE_COLUMN_HOVER_KEY);
            if (next !== undefined) return next;
            if (tr.docChanged) {
              const mapped = value.decorations.map(tr.mapping, tr.doc);
              return mapped === DecorationSet.empty
                ? { key: null, decorations: DecorationSet.empty }
                : { key: value.key, decorations: mapped };
            }
            return value;
          },
        },
        props: {
          decorations: (state) =>
            TABLE_COLUMN_HOVER_KEY.getState(state)?.decorations ??
            DecorationSet.empty,
          handleDOMEvents: {
            mousemove: (view, event) => {
              if (activeResize || !view.editable) return false;
              // Never mutate column-hover decorations while a mouse button is
              // held down (e.g. dragging to select text or multiple cells).
              if (event.buttons !== 0) {
                clearColumnHover(view);
                return false;
              }
              const target = resizeTarget(view, event);
              updateColumnHover(view, target);
              return false;
            },
            mouseleave: (view) => {
              if (!activeResize) clearColumnHover(view);
              return false;
            },
            mousedown: (view, event) => {
              if (!view.editable || event.button !== 0) return false;
              const target = resizeTarget(view, event);
              if (!target) return false;
              const { context } = target;

              const columns = Array.from(target.table.querySelectorAll("col"));
              const widths = gridColumnWidths(view, target);
              if (columns.length !== widths.length) return false;

              event.preventDefault();
              clearColumnHover(view);
              const tableWidth = widths.reduce((sum, width) => sum + width, 0);
              target.table.style.width = `${tableWidth}px`;
              target.table.style.minWidth = "";
              columns.forEach((column, index) => {
                column.style.width = `${widths[index]}px`;
                column.style.minWidth = "";
              });

              activeResize = {
                table: target.table,
                tableNode: context.node,
                tableStart: context.start,
                leftColumn: target.leftColumn,
                rightColumn: target.rightColumn,
                startX: event.clientX,
                startLeftWidth: widths[target.leftColumn],
                startRightWidth:
                  target.rightColumn === null ? 0 : widths[target.rightColumn],
                startTableWidth: tableWidth,
                widths,
              };
              const initialCursor = document.body.style.cursor;
              document.body.style.cursor = "col-resize";

              const move = (moveEvent: MouseEvent) => {
                if (!activeResize) return;
                const { leftColumn, rightColumn } = activeResize;
                const delta = moveEvent.clientX - activeResize.startX;
                const minDelta =
                  TABLE_CELL_MIN_WIDTH - activeResize.startLeftWidth;
                const columns = activeResize.table.querySelectorAll("col");

                if (rightColumn === null) {
                  const boundedDelta = Math.max(minDelta, delta);
                  activeResize.widths[leftColumn] = Math.round(
                    activeResize.startLeftWidth + boundedDelta,
                  );
                  columns[leftColumn].style.width =
                    `${activeResize.widths[leftColumn]}px`;
                  activeResize.table.style.width = `${Math.round(
                    activeResize.startTableWidth + boundedDelta,
                  )}px`;
                  return;
                }

                // When stretching right, trade width with the right neighbour
                // while it has room above the minimum width; any further
                // rightward drag (or any drag when the neighbour is already at
                // minimum width, as in Excel imports) widens the column and
                // table. When shrinking left, shrink the column and table
                // directly instead of inflating the right neighbour.
                const rightSpare = Math.max(
                  0,
                  activeResize.startRightWidth - TABLE_CELL_MIN_WIDTH,
                );
                const boundedDelta = Math.max(minDelta, delta);
                const tradedDelta = Math.max(
                  0,
                  Math.min(boundedDelta, rightSpare),
                );
                const extraDelta = boundedDelta - tradedDelta;

                activeResize.widths[leftColumn] = Math.round(
                  activeResize.startLeftWidth + boundedDelta,
                );
                activeResize.widths[rightColumn] = Math.round(
                  activeResize.startRightWidth - tradedDelta,
                );
                columns[leftColumn].style.width =
                  `${activeResize.widths[leftColumn]}px`;
                columns[rightColumn].style.width =
                  `${activeResize.widths[rightColumn]}px`;
                activeResize.table.style.width = `${Math.round(
                  activeResize.startTableWidth + extraDelta,
                )}px`;
              };
              const end = () => {
                if (!activeResize) return;
                const { tableNode, tableStart, widths } = activeResize;
                const currentTable =
                  view.state.doc.nodeAt(tableStart - 1) ?? tableNode;
                if (currentTable) {
                  persistTableColumnWidths(
                    view,
                    currentTable,
                    tableStart,
                    widths,
                  );
                }
                activeResize = undefined;
                document.body.style.cursor = initialCursor;
                disposeDrag();
              };
              disposeDrag = () => {
                window.removeEventListener("mousemove", move);
                window.removeEventListener("mouseup", end);
              };
              window.addEventListener("mousemove", move);
              window.addEventListener("mouseup", end, { once: true });
              return true;
            },
          },
        },
        view: () => ({
          destroy: () => disposeDrag(),
        }),
      }),
    ];
  },
});

function tableRowPosition(view: Editor["view"], row: HTMLTableRowElement) {
  // `posAtDOM(row, 0)` is just inside the row, so the tableRow node itself
  // starts one position earlier.
  return view.posAtDOM(row, 0) - 1;
}

/** Commits a finished row drag. Called once, on release. */
function persistTableRowHeight(
  view: Editor["view"],
  position: number,
  height: number,
) {
  const node = view.state.doc.nodeAt(position);
  if (!node || node.attrs.height === height) return;
  view.dispatch(
    view.state.tr.setNodeMarkup(position, undefined, {
      ...node.attrs,
      height,
    }),
  );
}

/**
 * The tallest a row's own content needs, ignoring any height already applied
 * to it. Used as the drag floor: clamping anywhere below this leaves a dead
 * zone where the pointer keeps moving but the row - held open by its content,
 * since a row renders at `max(its own height, its tallest cell)` - visibly
 * cannot, which is what makes a drag feel like it stopped tracking.
 *
 * Clearing the height to measure is safe because TableRowWithHeight's node
 * view ignores its own attribute mutations, and it is restored before this
 * returns, so the browser never paints the intermediate state.
 */
function measureTableRowContentHeight(row: HTMLTableRowElement) {
  const previous = row.style.height;
  row.style.height = "";
  const natural = Math.max(
    TABLE_ROW_MIN_HEIGHT,
    Math.ceil(row.getBoundingClientRect().height),
  );
  row.style.height = previous;
  return natural;
}

/**
 * Adds row-height resizing to Tiptap's built-in column-resize support.
 *
 * Mirrors TableColumnResize's shape: the drag is previewed purely in the DOM
 * and committed with a single transaction on release.
 */
export const TableRowResize = Extension.create({
  name: "tableRowResize",
  priority: 1000,
  addProseMirrorPlugins() {
    let activeResize:
      | {
          row: HTMLTableRowElement;
          position: number;
          startY: number;
          startHeight: number;
          minHeight: number;
          dragged: boolean;
        }
      | undefined;
    let disposeDrag = () => undefined;

    const resizeTarget = (event: MouseEvent) => {
      const cell = (event.target as HTMLElement | null)?.closest(
        "th, td",
      ) as HTMLTableCellElement | null;
      const row = cell?.parentElement as HTMLTableRowElement | null;
      const table = row?.closest("table") as HTMLTableElement | null;
      if (!cell || !row || !table) return null;
      const rows = Array.from(table.querySelectorAll("tr"));
      const rowIndex = rows.indexOf(row);
      if (rowIndex < 0 || rows.length < 2) return null;

      // Measure the *cell*, not its row: a cell merged down over several rows
      // has no edge at the boundaries it spans, so those must not be grabbable
      // (they are drawn as nothing), while its true bottom edge is the bottom
      // of the last row it covers.
      const bounds = cell.getBoundingClientRect();
      const nearTop = event.clientY - bounds.top <= TABLE_ROW_RESIZE_ZONE;
      const nearBottom = bounds.bottom - event.clientY <= TABLE_ROW_RESIZE_ZONE;
      const lastCoveredRow = rowIndex + Math.max(1, cell.rowSpan) - 1;
      const upperRowIndex = nearBottom
        ? lastCoveredRow
        : nearTop
          ? rowIndex - 1
          : -1;
      // Only the table's outer *top* edge is inert - it has no row above it to
      // resize. The bottom edge resizes the last row like any other boundary,
      // since a drag only ever changes the row above it.
      if (upperRowIndex < 0) return null;
      return { table, upperRowIndex, rows };
    };

    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            // No hover tracking here: the row boundary has no accent line to
            // light up, so the CSS hitbox's row-resize cursor is the whole
            // affordance and mousemove has nothing to do.
            mousedown: (view, event) => {
              if (!view.editable || event.button !== 0) return false;
              const target = resizeTarget(event);
              if (!target) return false;

              const upperRow = target.rows[target.upperRowIndex];
              const position = tableRowPosition(view, upperRow);

              event.preventDefault();

              const bounds = upperRow.getBoundingClientRect();
              activeResize = {
                row: upperRow,
                position,
                startY: event.clientY,
                // Start from what the row currently shows, so the boundary
                // sits under the pointer from the very first frame.
                startHeight: Math.max(
                  TABLE_ROW_MIN_HEIGHT,
                  Math.round(bounds.height),
                ),
                minHeight: measureTableRowContentHeight(upperRow),
                dragged: false,
              };
              const initialCursor = document.body.style.cursor;
              document.body.style.cursor = "row-resize";

              const move = (moveEvent: MouseEvent) => {
                if (!activeResize) return;
                const height = Math.round(
                  Math.max(
                    activeResize.minHeight,
                    Math.min(
                      2000,
                      activeResize.startHeight +
                        moveEvent.clientY -
                        activeResize.startY,
                    ),
                  ),
                );
                activeResize.dragged = true;
                activeResize.row.style.height = `${height}px`;
              };
              const end = () => {
                if (!activeResize) return;
                const {
                  row: resizedRow,
                  position: rowPosition,
                  dragged,
                } = activeResize;
                activeResize = undefined;
                document.body.style.cursor = initialCursor;
                disposeDrag();

                // A press that never moved the boundary must leave the
                // document untouched rather than committing the height the
                // row happened to be rendering.
                if (!dragged) return;
                const height = normaliseTableRowHeight(resizedRow.style.height);
                if (height) persistTableRowHeight(view, rowPosition, height);
              };
              disposeDrag = () => {
                window.removeEventListener("mousemove", move);
                window.removeEventListener("mouseup", end);
              };
              window.addEventListener("mousemove", move);
              window.addEventListener("mouseup", end, { once: true });
              return true;
            },
          },
        },
        view: () => ({
          destroy: () => {
            disposeDrag();
          },
        }),
      }),
    ];
  },
});
/**
 * Triple-click inside a table cell selects that line's text straight away.
 * prosemirror-tables otherwise answers a triple-click by selecting the whole
 * cell first, so the cell flashed highlighted before the line selection
 * landed. Runs ahead of the table plugin (priority) and claims the click.
 */
export const TableCellTripleClick = Extension.create({
  name: "tableCellTripleClick",
  priority: 1000,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleTripleClick(view, pos) {
            const $pos = view.state.doc.resolve(pos);
            if (!$pos.parent.isTextblock) return false;
            let inCell = false;
            for (let depth = $pos.depth; depth > 0; depth -= 1) {
              const name = $pos.node(depth).type.name;
              if (name === "tableCell" || name === "tableHeader") {
                inCell = true;
                break;
              }
            }
            if (!inCell) return false;
            view.dispatch(
              view.state.tr.setSelection(
                TextSelection.create(view.state.doc, $pos.start(), $pos.end()),
              ),
            );
            return true;
          },
        },
      }),
    ];
  },
});

function cellPosFromDOM(
  view: Editor["view"],
  cell: HTMLElement,
): number | null {
  try {
    const innerPos = view.posAtDOM(cell, 0);
    const $pos = view.state.doc.resolve(innerPos);
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      const role = $pos.node(depth).type.spec.tableRole;
      if (role === "cell" || role === "header_cell") {
        return $pos.before(depth);
      }
    }
  } catch {
    return null;
  }
  return null;
}

function sameTableCells(
  doc: Editor["state"]["doc"],
  anchorCellPos: number,
  headCellPos: number,
): boolean {
  try {
    const $a = doc.resolve(anchorCellPos);
    const $h = doc.resolve(headCellPos);
    return (
      $a.depth === $h.depth &&
      $a.depth >= 2 &&
      $a.start(-1) === $h.start(-1)
    );
  } catch {
    return false;
  }
}

function findCellInTableAtPoint(
  table: HTMLTableElement,
  clientX: number,
  clientY: number,
  eventTarget: EventTarget | null,
): HTMLTableCellElement | null {
  const direct =
    eventTarget instanceof Element
      ? (eventTarget.closest("td, th") as HTMLTableCellElement | null)
      : null;
  if (direct && direct.closest("table") === table) {
    return direct;
  }

  const probe = (x: number, y: number): HTMLTableCellElement | null => {
    if (typeof document.elementsFromPoint === "function") {
      const elements = document.elementsFromPoint(x, y);
      for (const el of elements) {
        const cell = el.closest("td, th") as HTMLTableCellElement | null;
        if (cell && cell.closest("table") === table) return cell;
      }
    }
    return null;
  };

  const atCursor = probe(clientX, clientY);
  if (atCursor) return atCursor;

  // When dragging past the table's outer edge (e.g. selecting an entire row or
  // column), clamp the coordinates into the table rect and pick the nearest
  // cell so the drag still reaches the first/last row or column.
  const rect = table.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    const clampedX = Math.min(rect.right - 2, Math.max(rect.left + 2, clientX));
    const clampedY = Math.min(rect.bottom - 2, Math.max(rect.top + 2, clientY));
    const atClamped = probe(clampedX, clampedY);
    if (atClamped) return atClamped;

    // Fallback by geometry (also works in test environments without elementsFromPoint).
    const cells = Array.from(table.querySelectorAll("td, th")).filter(
      (cell) => cell.closest("table") === table,
    ) as HTMLTableCellElement[];
    for (const cell of cells) {
      const box = cell.getBoundingClientRect();
      if (
        clampedX >= box.left &&
        clampedX <= box.right &&
        clampedY >= box.top &&
        clampedY <= box.bottom
      ) {
        return cell;
      }
    }
  }

  return null;
}

/**
 * Reliable multi-cell drag and Shift+Click selection for tables.
 *
 * prosemirror-tables resolves the hovered cell via `view.posAtCoords`, which
 * can return null or collapse to the starting cell when crossing resize handle
 * pseudo-elements, empty cells, nested tables, or custom row node views.
 * Resolving cells directly from DOM (`posAtDOM`) and clamping drags that go
 * past the table edge keeps row/column selection smooth and predictable.
 */
export const TableCellDragSelection = Extension.create({
  name: "tableCellDragSelection",
  priority: 500,
  addProseMirrorPlugins() {
    let disposeDrag = () => undefined;

    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            mousedown: (view, event) => {
              if (
                !view.editable ||
                event.button !== 0 ||
                event.ctrlKey ||
                event.metaKey ||
                event.defaultPrevented
              ) {
                return false;
              }

              const target =
                event.target instanceof Element
                  ? event.target
                  : event.target instanceof Node
                    ? event.target.parentElement
                    : null;
              const startCell = target?.closest(
                "td, th",
              ) as HTMLTableCellElement | null;
              const anchorTable = startCell?.closest(
                "table",
              ) as HTMLTableElement | null;
              if (!startCell || !anchorTable || !view.dom.contains(anchorTable)) {
                return false;
              }

              const startCellPos = cellPosFromDOM(view, startCell);
              if (startCellPos === null) return false;

              // Shift+Click extends a cell selection from the active cell.
              if (event.shiftKey) {
                const { selection } = view.state;
                let anchorPos: number | null = null;
                if (selection instanceof CellSelection) {
                  anchorPos = selection.$anchorCell.pos;
                } else {
                  const $a = selection.$anchor;
                  for (let d = $a.depth; d > 0; d -= 1) {
                    const role = $a.node(d).type.spec.tableRole;
                    if (role === "cell" || role === "header_cell") {
                      anchorPos = $a.before(d);
                      break;
                    }
                  }
                }
                if (
                  anchorPos !== null &&
                  anchorPos !== startCellPos &&
                  sameTableCells(view.state.doc, anchorPos, startCellPos)
                ) {
                  event.preventDefault();
                  view.dispatch(
                    view.state.tr.setSelection(
                      CellSelection.create(
                        view.state.doc,
                        anchorPos,
                        startCellPos,
                      ),
                    ),
                  );
                  return true;
                }
              }

              disposeDrag();
              let selectingCells = false;

              const move = (moveEvent: MouseEvent) => {
                if (moveEvent.buttons === 0) {
                  stop();
                  return;
                }
                const currentCell = findCellInTableAtPoint(
                  anchorTable,
                  moveEvent.clientX,
                  moveEvent.clientY,
                  moveEvent.target,
                );
                if (!currentCell) return;

                if (!selectingCells) {
                  if (currentCell === startCell) return;
                  selectingCells = true;
                  window.getSelection()?.removeAllRanges();
                }

                // Prevent prosemirror-tables' own mousemove listener and native
                // text drag from overriding the multi-cell selection.
                moveEvent.preventDefault();
                moveEvent.stopImmediatePropagation();

                const headCellPos = cellPosFromDOM(view, currentCell);
                if (
                  headCellPos === null ||
                  !sameTableCells(view.state.doc, startCellPos, headCellPos)
                ) {
                  return;
                }

                const nextSelection = CellSelection.create(
                  view.state.doc,
                  startCellPos,
                  headCellPos,
                );
                if (!view.state.selection.eq(nextSelection)) {
                  view.dispatch(view.state.tr.setSelection(nextSelection));
                }
              };

              const stop = (upEvent?: MouseEvent) => {
                if (selectingCells && upEvent) {
                  upEvent.preventDefault();
                }
                disposeDrag();
              };

              disposeDrag = () => {
                window.removeEventListener("mousemove", move, true);
                window.removeEventListener("mouseup", stop, true);
                window.removeEventListener("blur", stop);
                disposeDrag = () => undefined;
              };

              window.addEventListener("mousemove", move, true);
              window.addEventListener("mouseup", stop, true);
              window.addEventListener("blur", stop);
              return false;
            },
          },
        },
        view: () => ({
          destroy: () => disposeDrag(),
        }),
      }),
    ];
  },
});
