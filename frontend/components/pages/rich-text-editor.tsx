"use client";

import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import {
  Extension,
  Node as TiptapNode,
  Mark,
  mergeAttributes,
} from "@tiptap/core";
import { NodeSelection, Plugin } from "@tiptap/pm/state";
import { Fragment, Slice } from "@tiptap/pm/model";
import { dropPoint } from "@tiptap/pm/transform";
import { TableMap } from "@tiptap/pm/tables";
import {
  EditorContent,
  useEditor,
  useEditorState,
  NodeViewWrapper,
  NodeViewContent,
  ReactNodeViewRenderer,
  type Editor,
} from "@tiptap/react";
import CodeBlock from "@tiptap/extension-code-block";
import type { NodeViewProps } from "@tiptap/core";
import {
  AlertCircle,
  AlertTriangle,
  Bold,
  AlignCenter,
  AlignLeft,
  AlignRight,
  Check,
  ChevronDown,
  Code2,
  Crop,
  Ellipsis,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Info,
  Italic,
  Lightbulb,
  Link2,
  List,
  ListOrdered,
  Minus,
  Palette,
  Paperclip,
  Pilcrow,
  Plus,
  Quote,
  Redo2,
  RemoveFormatting,
  BetweenHorizontalEnd,
  BetweenVerticalEnd,
  SquareSplitHorizontal,
  Strikethrough,
  Table2,
  TableCellsMerge,
  Type,
  Trash2,
  UnfoldHorizontal,
  Underline,
  Undo2,
  WrapText,
  FileText,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileVideo,
  File as FileIcon,
  Download,
  Loader2,
  Search,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const TableCellWithBackground = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: (element) => element.style.backgroundColor || null,
        renderHTML: (attributes) =>
          attributes.backgroundColor
            ? { style: `background-color: ${attributes.backgroundColor}` }
            : {},
      },
    };
  },
});

const TextStyleMark = Mark.create({
  name: "textStyle",
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => element.style.color || null,
        renderHTML: (attributes) =>
          attributes.color ? { style: `color: ${attributes.color}` } : {},
      },
      backgroundColor: {
        default: null,
        parseHTML: (element) => element.style.backgroundColor || null,
        renderHTML: (attributes) =>
          attributes.backgroundColor
            ? { style: `background-color: ${attributes.backgroundColor}` }
            : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-wikihub-text-style]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-wikihub-text-style": "" }),
      0,
    ];
  },
});

const UnderlineMark = Mark.create({
  name: "underline",
  parseHTML() {
    return [{ tag: "u" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["u", mergeAttributes(HTMLAttributes), 0];
  },
});

const TableHeaderWithBackground = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: (element) => element.style.backgroundColor || null,
        renderHTML: (attributes) =>
          attributes.backgroundColor
            ? { style: `background-color: ${attributes.backgroundColor}` }
            : {},
      },
    };
  },
});

function normaliseTableRowHeight(value: unknown): number | null {
  const height = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(height) && height >= 32 && height <= 2000
    ? Math.round(height)
    : null;
}

const TableRowWithHeight = TableRow.extend({
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

const TABLE_ROW_RESIZE_ZONE = 8;
const TABLE_COLUMN_RESIZE_ZONE = 8;
const TABLE_CELL_MIN_WIDTH = 96;
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
  for (let depth = $position.depth; depth > 0; depth -= 1) {
    const node = $position.node(depth);
    if (node.type.name === "table") {
      return { node, start: $position.start(depth) };
    }
  }
  return null;
}

function persistTableColumnWidths(
  view: Editor["view"],
  table: NonNullable<TableColumnResizeState["tableNode"]>,
  tableStart: number,
  widths: number[],
) {
  const map = TableMap.get(table);
  const transaction = view.state.tr;

  widths.forEach((width, column) => {
    for (let row = 0; row < map.height; row += 1) {
      const mapIndex = row * map.width + column;
      if (row && map.map[mapIndex] === map.map[mapIndex - map.width]) {
        continue;
      }
      const cellOffset = map.map[mapIndex];
      const cell = table.nodeAt(cellOffset);
      if (!cell) continue;
      const attributes = cell.attrs;
      const widthIndex =
        attributes.colspan === 1 ? 0 : column - map.colCount(cellOffset);
      if (widthIndex < 0 || widthIndex >= attributes.colspan) continue;

      const columnWidths = attributes.colwidth
        ? attributes.colwidth.slice()
        : Array(attributes.colspan).fill(0);
      if (columnWidths[widthIndex] === width) continue;
      columnWidths[widthIndex] = width;
      transaction.setNodeMarkup(tableStart + cellOffset, undefined, {
        ...attributes,
        colwidth: columnWidths,
      });
    }
  });

  if (transaction.docChanged) view.dispatch(transaction);
}

/**
 * Keeps a table's overall width stable while a boundary moves. Tiptap's
 * default column plugin changes only one column, which lets every remaining
 * auto-sized column redistribute and makes unrelated boundaries drift.
 */
const TableColumnResize = Extension.create({
  name: "tableColumnResize",
  addProseMirrorPlugins() {
    let activeResize: TableColumnResizeState | undefined;
    let disposeDrag = () => undefined;

    const clearColumnHover = (view: Editor["view"]) => {
      view.dom
        .querySelectorAll(".wikihub-column-resize-target")
        .forEach((cell) =>
          cell.classList.remove("wikihub-column-resize-target"),
        );
    };

    const setColumnHover = (table: HTMLTableElement, column: number) => {
      table.querySelectorAll("tr").forEach((row) => {
        const cell = row.children.item(column) as HTMLElement | null;
        cell?.classList.add("wikihub-column-resize-target");
      });
    };

    const resizeTarget = (event: MouseEvent) => {
      const cell = (event.target as HTMLElement | null)?.closest(
        "th, td",
      ) as HTMLTableCellElement | null;
      const table = cell?.closest("table") as HTMLTableElement | null;
      if (!cell || !table || cell.colSpan !== 1) return null;
      const row = cell.parentElement as HTMLTableRowElement | null;
      if (!row) return null;
      const rowCells = Array.from(row.children) as HTMLElement[];
      const cellIndex = rowCells.indexOf(cell);
      if (cellIndex < 0 || rowCells.length < 2) return null;

      const bounds = cell.getBoundingClientRect();
      const nearLeft = event.clientX - bounds.left <= TABLE_COLUMN_RESIZE_ZONE;
      const nearRight =
        bounds.right - event.clientX <= TABLE_COLUMN_RESIZE_ZONE;
      const leftColumn = nearRight ? cellIndex : nearLeft ? cellIndex - 1 : -1;
      // The table's outer *left* edge has nothing to its left to resize, so it
      // stays inert. Its outer right edge does resize the last column - there
      // is simply no neighbour to trade width with, so the table itself grows.
      if (leftColumn < 0) return null;
      const rightColumn =
        leftColumn + 1 < rowCells.length ? leftColumn + 1 : null;
      return { table, leftColumn, rightColumn, rowCells };
    };

    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            mousemove: (view, event) => {
              if (activeResize || !view.editable) return false;
              clearColumnHover(view);
              const target = resizeTarget(event);
              if (target) setColumnHover(target.table, target.leftColumn);
              return false;
            },
            mouseleave: (view) => {
              if (!activeResize) clearColumnHover(view);
              return false;
            },
            mousedown: (view, event) => {
              if (!view.editable || event.button !== 0) return false;
              const target = resizeTarget(event);
              if (!target) return false;
              const context = tableContextAtCell(
                view,
                target.rowCells[target.leftColumn],
              );
              if (!context) return false;

              const columns = Array.from(target.table.querySelectorAll("col"));
              const widths = target.rowCells.map((cell) =>
                Math.max(
                  TABLE_CELL_MIN_WIDTH,
                  Math.round(cell.getBoundingClientRect().width),
                ),
              );
              if (columns.length !== widths.length) return false;

              event.preventDefault();
              clearColumnHover(view);
              const tableWidth = Math.round(
                target.table.getBoundingClientRect().width,
              );
              target.table.style.width = `${tableWidth}px`;
              target.table.style.minWidth = "";
              columns.forEach((column, index) => {
                column.style.width = `${widths[index]}px`;
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
                // Dragging the outer right edge widens the table instead of
                // borrowing from a neighbour, so nothing caps how far it goes.
                const maxDelta =
                  rightColumn === null
                    ? Number.POSITIVE_INFINITY
                    : activeResize.startRightWidth - TABLE_CELL_MIN_WIDTH;
                const boundedDelta = Math.max(
                  minDelta,
                  Math.min(maxDelta, delta),
                );
                activeResize.widths[leftColumn] = Math.round(
                  activeResize.startLeftWidth + boundedDelta,
                );
                const columns = activeResize.table.querySelectorAll("col");
                columns[leftColumn].style.width =
                  `${activeResize.widths[leftColumn]}px`;
                if (rightColumn === null) {
                  activeResize.table.style.width = `${
                    activeResize.startTableWidth + boundedDelta
                  }px`;
                  return;
                }
                activeResize.widths[rightColumn] = Math.round(
                  activeResize.startRightWidth - boundedDelta,
                );
                columns[rightColumn].style.width =
                  `${activeResize.widths[rightColumn]}px`;
              };
              const end = () => {
                if (!activeResize) return;
                const { tableNode, tableStart, widths } = activeResize;
                if (tableNode) {
                  persistTableColumnWidths(view, tableNode, tableStart, widths);
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
  const domPosition = view.posAtDOM(row, 0);
  // `posAtDOM(row, 0)` is normally just inside the row; look back over the
  // table boundary to get the position at which the tableRow node starts.
  for (let offset = 0; offset <= 3; offset += 1) {
    const position = Math.max(0, domPosition - offset);
    if (view.state.doc.nodeAt(position)?.type.name === "tableRow") {
      return position;
    }
  }
  return null;
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
const TableRowResize = Extension.create({
  name: "tableRowResize",
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
      const row = (event.target as HTMLElement | null)?.closest(
        "tr",
      ) as HTMLTableRowElement | null;
      const table = row?.closest("table") as HTMLTableElement | null;
      if (!row || !table) return null;
      const rows = Array.from(table.querySelectorAll("tr"));
      const rowIndex = rows.indexOf(row);
      if (rowIndex < 0 || rows.length < 2) return null;

      const bounds = row.getBoundingClientRect();
      const nearTop = event.clientY - bounds.top <= TABLE_ROW_RESIZE_ZONE;
      const nearBottom = bounds.bottom - event.clientY <= TABLE_ROW_RESIZE_ZONE;
      const upperRowIndex = nearBottom ? rowIndex : nearTop ? rowIndex - 1 : -1;
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
              if (position === null) return false;

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

function CodeBlockWithLines({ node, extension: _extension }: NodeViewProps) {
  let text = node.textContent || "";
  if (text.endsWith("\n")) {
    text = text.slice(0, -1);
  }
  const lineCount = text.split("\n").length;
  const lines = Array.from({ length: Math.max(1, lineCount) }, (_, i) => i + 1);
  // Default to a known language if set, though currently we just use the class
  const language = node.attrs.language || "";

  return (
    <NodeViewWrapper className="group border-border bg-surface-sunken relative my-4 flex overflow-hidden rounded-md border">
      <div className="border-border/50 bg-surface-hover/30 text-muted-foreground/50 border-r px-3 py-4 text-right font-mono text-xs !leading-6 select-none">
        {lines.map((line) => (
          <div key={line} className="h-6">
            {line}
          </div>
        ))}
      </div>
      <pre className="!my-0 flex-1 overflow-x-auto !border-0 !bg-transparent !p-4 font-mono text-xs !leading-6">
        <NodeViewContent
          className={cn(
            "!m-0 !block bg-transparent !p-0 !font-mono !text-xs !leading-6 whitespace-pre",
            language ? `language-${language}` : "",
          )}
        />
      </pre>
    </NodeViewWrapper>
  );
}

function CalloutComponent({ node }: NodeViewProps) {
  const type = (node.attrs.type || "info").toLowerCase();

  const config = useMemo(() => {
    switch (type) {
      case "warning":
      case "note":
        return {
          bg: "bg-amber-500/10 border-amber-500/35 text-foreground dark:bg-amber-500/15",
          icon: AlertTriangle,
          iconColor: "text-amber-600 dark:text-amber-400",
        };
      case "tip":
        return {
          bg: "bg-emerald-500/10 border-emerald-500/30 text-foreground dark:bg-emerald-500/15",
          icon: Lightbulb,
          iconColor: "text-emerald-600 dark:text-emerald-400",
        };
      case "panel":
        return {
          bg: "bg-surface-sunken border-border text-foreground",
          icon: Info,
          iconColor: "text-muted-foreground",
        };
      case "info":
      default:
        return {
          bg: "bg-blue-500/10 border-blue-500/30 text-foreground dark:bg-blue-500/15",
          icon: AlertCircle,
          iconColor: "text-blue-600 dark:text-blue-400",
        };
    }
  }, [type]);

  const IconComponent = config.icon;

  return (
    <NodeViewWrapper className="my-4">
      <div
        className={cn(
          "relative flex items-start gap-3 rounded-md border p-4 transition-colors",
          config.bg,
        )}
      >
        <div className="mt-0.5 flex-shrink-0 select-none">
          <IconComponent className={cn("h-5 w-5", config.iconColor)} />
        </div>
        <div className="min-w-0 flex-1 [&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
          <NodeViewContent />
        </div>
      </div>
    </NodeViewWrapper>
  );
}

function normaliseImageWidth(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed >= 80 ? Math.round(parsed) : null;
}

function normaliseImageAspectRatio(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

type ImageResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
type ImageAlignment = "left" | "center" | "right";
type ImageCrop = { x: number; y: number; width: number; height: number };

const defaultImageCrop: ImageCrop = {
  x: 0.05,
  y: 0.05,
  width: 0.9,
  height: 0.9,
};

function parseImageCrop(value: unknown): ImageCrop | null {
  if (typeof value !== "string") return null;
  try {
    const crop = JSON.parse(value) as ImageCrop;
    if (
      [crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) &&
      crop.width >= 0.1 &&
      crop.height >= 0.1 &&
      crop.x >= 0 &&
      crop.y >= 0 &&
      crop.x + crop.width <= 1 &&
      crop.y + crop.height <= 1
    )
      return crop;
  } catch {
    // Ignore legacy crop values and start with a fresh crop frame.
  }
  return null;
}

const imageResizeHandles: Array<{
  handle: ImageResizeHandle;
  label: string;
  className: string;
  markerClassName: string;
}> = [
  {
    handle: "nw",
    label: "Resize image from top left",
    className: "-top-3 -left-3 cursor-nwse-resize",
    markerClassName: "h-px w-3 -rotate-45 bg-primary",
  },
  {
    handle: "n",
    label: "Resize image from top",
    className: "-top-3 left-1/2 -translate-x-1/2 cursor-ns-resize",
    markerClassName: "h-px w-5 bg-primary",
  },
  {
    handle: "ne",
    label: "Resize image from top right",
    className: "-top-3 -right-3 cursor-nesw-resize",
    markerClassName: "h-px w-3 rotate-45 bg-primary",
  },
  {
    handle: "e",
    label: "Resize image from right",
    className: "top-1/2 right-0 -translate-y-1/2 cursor-ew-resize",
    markerClassName: "h-5 w-px bg-primary",
  },
  {
    handle: "se",
    label: "Resize image",
    className: "-right-3 -bottom-3 cursor-nwse-resize",
    markerClassName: "h-px w-3 -rotate-45 bg-primary",
  },
  {
    handle: "s",
    label: "Resize image from bottom",
    className: "-bottom-3 left-1/2 -translate-x-1/2 cursor-ns-resize",
    markerClassName: "h-px w-5 bg-primary",
  },
  {
    handle: "sw",
    label: "Resize image from bottom left",
    className: "-bottom-3 -left-3 cursor-nesw-resize",
    markerClassName: "h-px w-3 rotate-45 bg-primary",
  },
  {
    handle: "w",
    label: "Resize image from left",
    className: "top-1/2 left-0 -translate-y-1/2 cursor-ew-resize",
    markerClassName: "h-5 w-px bg-primary",
  },
];

function ResizableImageComponent({
  editor,
  getPos,
  node,
  updateAttributes,
}: NodeViewProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const imageFrameRef = useRef<HTMLDivElement>(null);
  const [pendingWidth, setPendingWidth] = useState<number | null>(null);
  const [hovered, setHovered] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [captionOpen, setCaptionOpen] = useState(false);
  const [captionDraft, setCaptionDraft] = useState(
    String(node.attrs.caption ?? ""),
  );
  const [cropOpen, setCropOpen] = useState(false);
  const [cropDraft, setCropDraft] = useState<ImageCrop>(defaultImageCrop);
  const [measuredImageAspectRatio, setMeasuredImageAspectRatio] = useState<
    number | null
  >(null);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  const pendingWidthRef = useRef<number | null>(null);
  const resizeFrame = useRef<number | null>(null);
  const removeResizeListeners = useRef<() => void>(() => undefined);
  const removeCropListeners = useRef<() => void>(() => undefined);
  const hideToolsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cropPreviewRef = useRef<HTMLDivElement>(null);
  const cropActionRef = useRef<{
    kind: "move" | ImageResizeHandle;
    x: number;
    y: number;
    crop: ImageCrop;
  } | null>(null);
  const savedWidth = normaliseImageWidth(node.attrs.width);
  const displayWidth = pendingWidth ?? savedWidth;
  const canResize = editor.isEditable;
  const alignment = (node.attrs.alignment ?? "left") as ImageAlignment;
  const crop = parseImageCrop(node.attrs.crop);
  // Older documents stored the source image width after cropping.  New crops
  // store the width of the resulting (visible) crop instead.  Keep rendering
  // the older form correctly so those pages do not suddenly produce a huge
  // cropped image.
  const cropWidthFinal = Boolean(node.attrs.cropWidthFinal);
  const savedImageAspectRatio = normaliseImageAspectRatio(
    node.attrs.cropSourceAspectRatio,
  );
  const imageAspectRatio =
    measuredImageAspectRatio ?? savedImageAspectRatio ?? 1;
  const cropUsesFinalWidth = Boolean(crop && (cropWidthFinal || pendingWidth));
  const croppedDisplayWidth =
    crop && displayWidth
      ? cropUsesFinalWidth
        ? displayWidth
        : displayWidth * crop.width
      : undefined;
  const croppedDisplayHeight =
    crop && croppedDisplayWidth
      ? Number(
          (
            (croppedDisplayWidth * crop.height) /
            (imageAspectRatio * crop.width)
          ).toPrecision(12),
        )
      : undefined;
  const croppedSourceWidth =
    crop && croppedDisplayWidth ? croppedDisplayWidth / crop.width : undefined;
  const croppedSourceHeight =
    crop && croppedDisplayHeight
      ? croppedDisplayHeight / crop.height
      : undefined;
  const showImageTools =
    canResize && (hovered || resizing || captionOpen || cropOpen);

  const setWidth = useCallback(
    (nextWidth: number) =>
      updateAttributes({
        width: Math.round(nextWidth),
        // A legacy crop stored the source width. Once resized, the saved
        // width becomes the visible crop width so it cannot jump on the next
        // interaction.
        ...(crop
          ? {
              cropWidthFinal: "true",
              cropSourceAspectRatio: String(imageAspectRatio),
            }
          : {}),
      }),
    [crop, imageAspectRatio, updateAttributes],
  );

  useEffect(
    () => () => {
      removeResizeListeners.current();
      removeCropListeners.current();
      if (resizeFrame.current !== null)
        cancelAnimationFrame(resizeFrame.current);
      if (hideToolsTimer.current) clearTimeout(hideToolsTimer.current);
    },
    [],
  );

  function rememberImageAspectRatio(image: HTMLImageElement) {
    const ratio =
      image.naturalWidth > 0 && image.naturalHeight > 0
        ? image.naturalWidth / image.naturalHeight
        : null;
    if (!ratio) return;
    setMeasuredImageAspectRatio((current) =>
      current === null || Math.abs(current - ratio) > 0.0001 ? ratio : current,
    );
  }

  function keepImageToolsVisible() {
    if (hideToolsTimer.current) clearTimeout(hideToolsTimer.current);
    setHovered(true);
  }

  function scheduleImageToolsHide() {
    if (resizing) return;
    if (hideToolsTimer.current) clearTimeout(hideToolsTimer.current);
    hideToolsTimer.current = setTimeout(() => setHovered(false), 180);
  }

  function startResize(
    clientX: number,
    handle: ImageResizeHandle,
    moveEventName: "pointermove" | "mousemove",
    upEventName: "pointerup" | "mouseup",
  ) {
    if (resizeStart.current) return;
    // For cropped images, the <img> is intentionally larger than the visible
    // crop frame. Resize the frame, not that hidden expanded source image.
    const frameBounds = imageFrameRef.current?.getBoundingClientRect();
    const width = frameBounds?.width ?? displayWidth ?? savedWidth ?? 240;
    resizeStart.current = { x: clientX, width };
    pendingWidthRef.current = width;
    setPendingWidth(width);
    setResizing(true);
    const onMove = (moveEvent: Event) => {
      const start = resizeStart.current;
      const frame = imageFrameRef.current;
      if (!start || !frame) return;
      const availableWidth =
        frame.closest(".ProseMirror")?.clientWidth ?? window.innerWidth;
      const pointer = moveEvent as MouseEvent;
      // The editor deliberately exposes only left/right resize bars. Their
      // size must depend solely on X movement; Y movement belongs to neither
      // resizing nor image scaling.
      const horizontalDelta =
        handle === "w" ? start.x - pointer.clientX : pointer.clientX - start.x;
      const nextWidth = Math.max(
        80,
        Math.min(availableWidth, start.width + horizontalDelta),
      );
      pendingWidthRef.current = nextWidth;
      if (resizeFrame.current !== null) return;
      resizeFrame.current = requestAnimationFrame(() => {
        resizeFrame.current = null;
        setPendingWidth(pendingWidthRef.current);
      });
    };
    const onUp = () => {
      const finalWidth = pendingWidthRef.current;
      if (finalWidth !== null) setWidth(finalWidth);
      resizeStart.current = null;
      pendingWidthRef.current = null;
      if (resizeFrame.current !== null) {
        cancelAnimationFrame(resizeFrame.current);
        resizeFrame.current = null;
      }
      setPendingWidth(null);
      setResizing(false);
      removeResizeListeners.current();
    };
    removeResizeListeners.current();
    removeResizeListeners.current = () => {
      window.removeEventListener(moveEventName, onMove);
      window.removeEventListener(upEventName, onUp);
    };
    window.addEventListener(moveEventName, onMove);
    window.addEventListener(upEventName, onUp, { once: true });
  }

  function beginResize(
    event: React.PointerEvent<HTMLButtonElement>,
    handle: ImageResizeHandle,
  ) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    startResize(event.clientX, handle, "pointermove", "pointerup");
  }

  function beginMouseResize(
    event: React.MouseEvent<HTMLButtonElement>,
    handle: ImageResizeHandle,
  ) {
    event.preventDefault();
    event.stopPropagation();
    startResize(event.clientX, handle, "mousemove", "mouseup");
  }

  function beginResizeFromFrameEdge(event: React.PointerEvent<HTMLElement>) {
    if (
      !canResize ||
      (event.target as HTMLElement).closest("button, [role=dialog]")
    )
      return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const edgeSize = 20;
    const handle =
      event.clientX - bounds.left <= edgeSize
        ? "w"
        : bounds.right - event.clientX <= edgeSize
          ? "e"
          : null;
    if (!handle) return;

    // The transparent hit zones are a visual aid. Capturing directly at the
    // frame level makes the resize reliable even if a cropped image paints
    // over one of those zones.
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    startResize(event.clientX, handle, "pointermove", "pointerup");
  }

  function resizeWithKeyboard(
    event: React.KeyboardEvent<HTMLButtonElement>,
    handle: ImageResizeHandle,
  ) {
    const current =
      imageFrameRef.current?.getBoundingClientRect().width ??
      croppedDisplayWidth ??
      displayWidth ??
      240;
    const adjustment =
      event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -16
        : event.key === "ArrowRight" || event.key === "ArrowDown"
          ? 16
          : 0;
    if (!adjustment) return;
    event.preventDefault();
    const availableWidth =
      imageFrameRef.current?.closest(".ProseMirror")?.clientWidth ??
      window.innerWidth;
    const direction = handle.includes("w") || handle.includes("n") ? -1 : 1;
    setWidth(
      Math.max(80, Math.min(availableWidth, current + adjustment * direction)),
    );
  }

  function selectImage() {
    if (!canResize || typeof getPos !== "function") return;
    const position = getPos();
    if (typeof position === "number") {
      editor.commands.setNodeSelection(position);
    }
  }

  function setImageAlignment(nextAlignment: ImageAlignment) {
    updateAttributes({ alignment: nextAlignment });
  }

  function saveCaption() {
    updateAttributes({ caption: captionDraft.trim() || null });
    setCaptionOpen(false);
  }

  function setImageCrop(nextCrop: ImageCrop | null) {
    // The crop is represented against the original source. Its on-page width
    // must therefore be the selected fraction of the source width, rather
    // than the full source width. Otherwise a narrow crop expands into a tall
    // oversized frame after it is saved.
    const measuredWidth = imageRef.current?.getBoundingClientRect().width ?? 0;
    const sourceWidth =
      crop && displayWidth
        ? cropWidthFinal
          ? displayWidth / crop.width
          : displayWidth
        : (displayWidth ?? measuredWidth);
    const croppedWidth = nextCrop
      ? Math.max(80, Math.round(sourceWidth * nextCrop.width))
      : null;
    // The crop preview is the exact canvas the user selected against. Its
    // rendered ratio is more reliable than a previously measured image ratio
    // (which may have been affected by a prior crop or attachment preview).
    const previewBounds = cropPreviewRef.current?.getBoundingClientRect();
    const cropCanvasAspectRatio =
      previewBounds && previewBounds.width > 0 && previewBounds.height > 0
        ? previewBounds.width / previewBounds.height
        : imageAspectRatio;
    if (nextCrop) setMeasuredImageAspectRatio(cropCanvasAspectRatio);
    updateAttributes({
      crop: nextCrop ? JSON.stringify(nextCrop) : null,
      width: croppedWidth ?? node.attrs.width,
      cropWidthFinal: nextCrop ? "true" : null,
      cropSourceAspectRatio: nextCrop ? String(cropCanvasAspectRatio) : null,
      // Re-cropping is allowed. Clearing the legacy lock also lets content
      // cropped with an earlier editor version be adjusted again.
      cropFinal: null,
    });
    setCropOpen(false);
  }

  function openCropEditor() {
    setCropDraft(crop ?? defaultImageCrop);
    setCropOpen(true);
  }

  function beginCrop(
    event: React.PointerEvent<HTMLButtonElement | HTMLDivElement>,
    kind: "move" | ImageResizeHandle,
  ) {
    event.preventDefault();
    // Resize handles live inside the movable crop frame. Do not let their
    // pointer-down event bubble to that frame, or it overwrites the resize
    // action with a move action before dragging starts.
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    cropActionRef.current = {
      kind,
      x: event.clientX,
      y: event.clientY,
      crop: cropDraft,
    };
    removeCropListeners.current();
    const onMove = (moveEvent: PointerEvent) => {
      moveCrop(moveEvent.clientX, moveEvent.clientY);
    };
    const onEnd = () => {
      cropActionRef.current = null;
      removeCropListeners.current();
    };
    removeCropListeners.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd, { once: true });
    window.addEventListener("pointercancel", onEnd, { once: true });
  }

  function moveCrop(clientX: number, clientY: number) {
    const action = cropActionRef.current;
    const bounds = cropPreviewRef.current?.getBoundingClientRect();
    if (!action || !bounds) return;
    const dx = (clientX - action.x) / bounds.width;
    const dy = (clientY - action.y) / bounds.height;
    const minimum = 0.1;
    let { x, y, width, height } = action.crop;
    if (action.kind === "move") {
      x = Math.max(0, Math.min(1 - width, x + dx));
      y = Math.max(0, Math.min(1 - height, y + dy));
    } else {
      if (action.kind.includes("w")) {
        x = Math.max(
          0,
          Math.min(action.crop.x + action.crop.width - minimum, x + dx),
        );
        width = action.crop.width - (x - action.crop.x);
      }
      if (action.kind.includes("n")) {
        y = Math.max(
          0,
          Math.min(action.crop.y + action.crop.height - minimum, y + dy),
        );
        height = action.crop.height - (y - action.crop.y);
      }
      if (action.kind.includes("e"))
        width = Math.max(minimum, Math.min(1 - x, width + dx));
      if (action.kind.includes("s"))
        height = Math.max(minimum, Math.min(1 - y, height + dy));
    }
    setCropDraft({ x, y, width, height });
  }

  function prepareImageMove(event: React.DragEvent<HTMLDivElement>) {
    if (!canResize || (event.target as HTMLElement).closest("button")) return;
    selectImage();
    const position = typeof getPos === "function" ? getPos() : undefined;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.dropEffect = "move";
    event.currentTarget.dispatchEvent(
      new CustomEvent("wikihub:internal-image-drag-start", {
        bubbles: true,
        detail: { pos: position },
      }),
    );
  }

  function finishImageMove(event: React.DragEvent<HTMLDivElement>) {
    event.currentTarget.dispatchEvent(
      new CustomEvent("wikihub:internal-image-drag-end", { bubbles: true }),
    );
  }

  return (
    <NodeViewWrapper
      as="figure"
      className={cn(
        "group/image relative my-4 block w-fit max-w-full align-top",
        alignment === "left" && "mr-auto",
        alignment === "center" && "mx-auto",
        alignment === "right" && "ml-auto",
        showImageTools &&
          "before:bg-border-strong after:bg-border-strong before:pointer-events-none before:absolute before:top-1/3 before:bottom-1/3 before:left-1 before:z-20 before:w-1.5 before:rounded-full after:pointer-events-none after:absolute after:top-1/3 after:right-1 after:bottom-1/3 after:z-20 after:w-1.5 after:rounded-full",
      )}
      contentEditable={false}
      onClick={selectImage}
      onPointerDownCapture={beginResizeFromFrameEdge}
      onMouseEnter={keepImageToolsVisible}
      onMouseLeave={scheduleImageToolsHide}
      onDragStartCapture={prepareImageMove}
      onDragEndCapture={finishImageMove}
    >
      <div
        ref={imageFrameRef}
        className={cn(crop && "relative overflow-hidden")}
        style={
          crop
            ? {
                width: croppedDisplayWidth
                  ? `${croppedDisplayWidth}px`
                  : undefined,
                // Set both dimensions from the selected source rectangle.
                // This avoids aspect-ratio rounding and transform layout
                // quirks that could hide content along the lower edge.
                height: croppedDisplayHeight
                  ? `${croppedDisplayHeight}px`
                  : undefined,
              }
            : undefined
        }
      >
        {/* Authenticated attachment URLs cannot be optimized by next/image. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          src={node.attrs.src}
          alt={node.attrs.alt ?? ""}
          title={node.attrs.title ?? undefined}
          draggable={canResize}
          onLoad={(event) => rememberImageAspectRatio(event.currentTarget)}
          className={cn(
            "block max-w-full cursor-grab active:cursor-grabbing",
            crop ? "max-w-none" : "h-auto",
          )}
          style={
            crop
              ? {
                  position: "absolute",
                  // Fix the entire source rectangle in pixels. Leaving either
                  // dimension to CSS auto-sizing can introduce a tiny ratio
                  // mismatch, which is enough to clip the lower edge.
                  width: croppedSourceWidth
                    ? `${croppedSourceWidth}px`
                    : `${100 / crop.width}%`,
                  height: croppedSourceHeight
                    ? `${croppedSourceHeight}px`
                    : "auto",
                  maxWidth: "none",
                  left: croppedSourceWidth
                    ? `${-crop.x * croppedSourceWidth}px`
                    : `${(-crop.x / crop.width) * 100}%`,
                  top: croppedSourceHeight
                    ? `${-crop.y * croppedSourceHeight}px`
                    : `${(-crop.y / crop.height) * 100}%`,
                }
              : displayWidth
                ? { width: `${displayWidth}px` }
                : undefined
          }
        />
      </div>
      {node.attrs.caption ? (
        <figcaption className="text-muted-foreground -mt-0.5 text-center text-xs italic opacity-80">
          {node.attrs.caption}
        </figcaption>
      ) : null}
      {showImageTools ? (
        <>
          <div
            className="border-border bg-surface-raised/95 backdrop-blur-sm absolute top-2 right-2 z-20 flex h-9 items-center gap-0.5 rounded-md border p-1 shadow-md"
            role="toolbar"
            aria-label="Image options"
            onMouseEnter={keepImageToolsVisible}
            onMouseLeave={scheduleImageToolsHide}
          >
            {(
              [
                ["left", AlignLeft, "Align image left"],
                ["center", AlignCenter, "Align image center"],
                ["right", AlignRight, "Align image right"],
              ] as const
            ).map(([value, Icon, label]) => (
              <button
                key={value}
                type="button"
                aria-label={label}
                title={label}
                aria-pressed={alignment === value}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => setImageAlignment(value)}
                className={cn(
                  "hover:bg-surface-hover focus-visible:ring-ring text-muted-foreground flex size-7 cursor-pointer items-center justify-center rounded transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                  alignment === value && "bg-surface-selected text-primary",
                )}
              >
                <Icon className="size-4" aria-hidden />
              </button>
            ))}
            <span className="bg-border mx-0.5 h-5 w-px" aria-hidden />
            <button
              type="button"
              aria-label="Add image caption"
              title="Add image caption"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                setCaptionDraft(String(node.attrs.caption ?? ""));
                setCaptionOpen(true);
              }}
              className="hover:bg-surface-hover focus-visible:ring-ring text-muted-foreground flex size-7 cursor-pointer items-center justify-center rounded transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
            >
              <Type className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Crop image"
              title="Crop image"
              onPointerDown={(event) => event.preventDefault()}
              onClick={openCropEditor}
              className={cn(
                "hover:bg-surface-hover focus-visible:ring-ring text-muted-foreground flex size-7 cursor-pointer items-center justify-center rounded transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                crop && "bg-surface-selected text-primary",
              )}
            >
              <Crop className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Image details"
              title="Image details"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                const src = String(node.attrs.src ?? "");
                const match = src.match(/\/api\/v1\/attachments\/([a-f0-9-]{36})/i);
                if (match) {
                  const event = new CustomEvent("wikihub:view-file-details", {
                    detail: match[1],
                  });
                  document.dispatchEvent(event);
                }
              }}
              className="hover:bg-surface-hover focus-visible:ring-ring text-muted-foreground flex size-7 cursor-pointer items-center justify-center rounded transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
            >
              <Info className="size-4" aria-hidden />
            </button>
          </div>
          <Dialog open={captionOpen} onOpenChange={setCaptionOpen}>
            <DialogContent title="Image caption" className="max-w-md">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="image-caption">
                  Caption
                </label>
                <Input
                  id="image-caption"
                  value={captionDraft}
                  onChange={(event) => setCaptionDraft(event.target.value)}
                  placeholder="Describe this image"
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setCaptionOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="button" onClick={saveCaption}>
                  Save caption
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={cropOpen} onOpenChange={setCropOpen}>
            <DialogContent
              title="Crop image"
              className="max-w-3xl overflow-hidden p-0 [&>button[aria-label=Close]]:hidden [&>div:first-child]:sr-only"
            >
              <div className="border-border flex h-14 items-center justify-between border-b px-3">
                <span className="w-16" aria-hidden />
                <span className="text-sm font-medium">Crop image</span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setCropOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => setImageCrop(cropDraft)}
                  >
                    Save
                  </Button>
                </div>
              </div>
              <div className="bg-surface-sunken p-6">
                <div
                  ref={cropPreviewRef}
                  className="relative mx-auto w-fit max-w-full touch-none overflow-hidden"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={node.attrs.src}
                    alt="Crop preview"
                    className="mx-auto block max-h-[52vh] max-w-full select-none"
                    draggable={false}
                  />
                  <div
                    className="bg-foreground/20 pointer-events-none absolute inset-x-0 top-0"
                    style={{ height: `${cropDraft.y * 100}%` }}
                    aria-hidden
                  />
                  <div
                    className="bg-foreground/20 pointer-events-none absolute inset-x-0 bottom-0"
                    style={{
                      height: `${(1 - cropDraft.y - cropDraft.height) * 100}%`,
                    }}
                    aria-hidden
                  />
                  <div
                    className="bg-foreground/20 pointer-events-none absolute"
                    style={{
                      left: 0,
                      top: `${cropDraft.y * 100}%`,
                      width: `${cropDraft.x * 100}%`,
                      height: `${cropDraft.height * 100}%`,
                    }}
                    aria-hidden
                  />
                  <div
                    className="bg-foreground/20 pointer-events-none absolute"
                    style={{
                      right: 0,
                      top: `${cropDraft.y * 100}%`,
                      width: `${(1 - cropDraft.x - cropDraft.width) * 100}%`,
                      height: `${cropDraft.height * 100}%`,
                    }}
                    aria-hidden
                  />
                  <div
                    className="border-foreground/80 absolute cursor-move border-2"
                    style={{
                      left: `${cropDraft.x * 100}%`,
                      top: `${cropDraft.y * 100}%`,
                      width: `${cropDraft.width * 100}%`,
                      height: `${cropDraft.height * 100}%`,
                    }}
                    onPointerDown={(event) => beginCrop(event, "move")}
                  >
                    {(
                      [
                        ["nw", "-top-2 -left-2 cursor-nwse-resize"],
                        [
                          "n",
                          "-top-2 left-1/2 -translate-x-1/2 cursor-ns-resize",
                        ],
                        ["ne", "-top-2 -right-2 cursor-nesw-resize"],
                        [
                          "e",
                          "top-1/2 -right-2 -translate-y-1/2 cursor-ew-resize",
                        ],
                        ["se", "-right-2 -bottom-2 cursor-nwse-resize"],
                        [
                          "s",
                          "-bottom-2 left-1/2 -translate-x-1/2 cursor-ns-resize",
                        ],
                        ["sw", "-bottom-2 -left-2 cursor-nesw-resize"],
                        [
                          "w",
                          "top-1/2 -left-2 -translate-y-1/2 cursor-ew-resize",
                        ],
                      ] as const
                    ).map(([handle, positionClass]) => (
                      <button
                        key={handle}
                        type="button"
                        aria-label={`Resize crop from ${handle}`}
                        onPointerDown={(event) => beginCrop(event, handle)}
                        className={cn(
                          "bg-foreground border-surface focus-visible:ring-ring absolute size-3 rounded-sm border-2 focus-visible:ring-2 focus-visible:outline-none",
                          positionClass,
                        )}
                      />
                    ))}
                    <span className="bg-foreground/70 pointer-events-none absolute top-1/2 -left-1 h-10 w-1 -translate-y-1/2 rounded-full" />
                    <span className="bg-foreground/70 pointer-events-none absolute top-1/2 -right-1 h-10 w-1 -translate-y-1/2 rounded-full" />
                    <span className="bg-foreground/70 pointer-events-none absolute -top-1 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full" />
                    <span className="bg-foreground/70 pointer-events-none absolute -bottom-1 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full" />
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <button
            type="button"
            aria-label="Inactive image resize control"
            title="Drag to resize image"
            onPointerDown={(event) => beginResize(event, "se")}
            onMouseDown={(event) => beginMouseResize(event, "se")}
            onKeyDown={(event) => resizeWithKeyboard(event, "se")}
            className="hidden"
          >
            <span aria-hidden>↘</span>
          </button>
        </>
      ) : null}
      {canResize
        ? imageResizeHandles
            .filter(({ handle }) => handle === "e" || handle === "w")
            .map(({ handle, label, className }) => (
              <button
                key={handle}
                type="button"
                aria-label={label}
                title={label}
                onPointerDown={(event) => beginResize(event, handle)}
                onMouseDown={(event) => beginMouseResize(event, handle)}
                onKeyDown={(event) => resizeWithKeyboard(event, handle)}
                className={cn(
                  "focus-visible:ring-ring absolute z-30 flex size-8 cursor-ew-resize touch-none items-center justify-center bg-transparent select-none focus-visible:ring-2 focus-visible:outline-none",
                  className,
                )}
              />
            ))
        : null}
    </NodeViewWrapper>
  );
}

const ResizableImage = Image.extend({
  draggable: true,
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) =>
          normaliseImageWidth(
            element.getAttribute("width") ?? element.style.width,
          ),
        renderHTML: (attributes) =>
          normaliseImageWidth(attributes.width)
            ? { width: String(normaliseImageWidth(attributes.width)) }
            : {},
      },
      alignment: {
        default: "left",
        parseHTML: (element) =>
          element.getAttribute("data-alignment") ?? "left",
        renderHTML: (attributes) =>
          attributes.alignment && attributes.alignment !== "left"
            ? { "data-alignment": attributes.alignment }
            : {},
      },
      caption: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-caption"),
        renderHTML: (attributes) =>
          attributes.caption ? { "data-caption": attributes.caption } : {},
      },
      crop: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-crop"),
        renderHTML: (attributes) =>
          attributes.crop ? { "data-crop": attributes.crop } : {},
      },
      cropFinal: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-crop-final"),
        renderHTML: (attributes) =>
          attributes.cropFinal ? { "data-crop-final": "true" } : {},
      },
      cropWidthFinal: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-crop-width-final"),
        renderHTML: (attributes) =>
          attributes.cropWidthFinal ? { "data-crop-width-final": "true" } : {},
      },
      cropSourceAspectRatio: {
        default: null,
        parseHTML: (element) =>
          normaliseImageAspectRatio(
            element.getAttribute("data-crop-source-aspect-ratio"),
          ),
        renderHTML: (attributes) => {
          const ratio = normaliseImageAspectRatio(
            attributes.cropSourceAspectRatio,
          );
          return ratio
            ? { "data-crop-source-aspect-ratio": String(ratio) }
            : {};
        },
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageComponent);
  },
});

const CustomCalloutNode = TiptapNode.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      type: {
        default: "info",
        parseHTML: (element: HTMLElement) => {
          const dataType = element.getAttribute("data-callout-type");
          if (dataType) return dataType;
          const cls = element.className || "";
          if (/warning/i.test(cls)) return "warning";
          if (/note/i.test(cls)) return "note";
          if (/tip/i.test(cls)) return "tip";
          if (/panel/i.test(cls)) return "panel";
          return "info";
        },
        renderHTML: (attributes) => ({
          "data-callout-type": attributes.type,
        }),
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'div[data-type="callout"]' },
      { tag: "div.callout" },
      { tag: "div.confluence-information-macro" },
      { tag: "blockquote.callout" },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "callout",
        class: `callout callout-${HTMLAttributes["data-callout-type"] || "info"}`,
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutComponent);
  },
});

const CustomCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockWithLines);
  },
});

/** Matches the URL shape the API hands out for a stored attachment. */
const ATTACHMENT_HREF = /\/api\/v1\/attachments\/[a-f0-9-]{36}/i;

/**
 * Attachment links never navigate: a capture listener turns a click on one
 * into the preview modal. Anything guarding real navigation has to know that,
 * or it will challenge a click that was only ever going to open a dialog.
 */
export function isAttachmentHref(href: string) {
  return ATTACHMENT_HREF.test(href);
}
/** A trailing ".ext" is what separates a filename from ordinary link prose. */
const FILENAME_EXTENSION = /\.[A-Za-z0-9]{1,8}$/;

// Elements rather than component references: building a component during a
// render is what react-hooks/static-components warns about, and an element
// created once at module scope is reusable as-is.
const ATTACHMENT_ICON_CLASS = "size-7";
const ATTACHMENT_ICONS: [RegExp, ReactNode][] = [
  [
    /\.(zip|jar|war|ear|tar|gz|tgz|bz2|xz|7z|rar)$/i,
    <FileArchive className={ATTACHMENT_ICON_CLASS} aria-hidden key="archive" />,
  ],
  [
    /\.(png|jpe?g|gif|webp|svg|bmp|ico|tiff?)$/i,
    <FileImage className={ATTACHMENT_ICON_CLASS} aria-hidden key="image" />,
  ],
  [
    /\.(mp4|mov|avi|mkv|webm|wmv|flv)$/i,
    <FileVideo className={ATTACHMENT_ICON_CLASS} aria-hidden key="video" />,
  ],
  [
    /\.(mp3|wav|flac|ogg|m4a|aac)$/i,
    <FileAudio className={ATTACHMENT_ICON_CLASS} aria-hidden key="audio" />,
  ],
  [
    /\.(csv|xlsx?|xlsm|ods)$/i,
    <FileSpreadsheet
      className={ATTACHMENT_ICON_CLASS}
      aria-hidden
      key="sheet"
    />,
  ],
  [
    /\.(ya?ml|json|xml|toml|ini|conf|properties|sh|bash|ps1|sql|py|java|go|rs|ts|tsx|js|jsx|css|html?)$/i,
    <FileCode className={ATTACHMENT_ICON_CLASS} aria-hidden key="code" />,
  ],
  [
    /\.(pdf|docx?|odt|rtf|txt|md|log)$/i,
    <FileText className={ATTACHMENT_ICON_CLASS} aria-hidden key="text" />,
  ],
];
const GENERIC_ATTACHMENT_ICON = (
  <FileIcon className={ATTACHMENT_ICON_CLASS} aria-hidden />
);

function attachmentIcon(filename: string) {
  const match = ATTACHMENT_ICONS.find(([pattern]) => pattern.test(filename));
  return match ? match[1] : GENERIC_ATTACHMENT_ICON;
}

/**
 * A Confluence-style attachment tile. The <a> is kept as the innermost
 * clickable element on purpose: the capture listeners that open the preview
 * modal find their target with `closest("a")`, so the tile inherits that
 * behaviour in the editor and on a saved page alike.
 */
function AttachmentTile({ node, selected }: NodeViewProps) {
  const filename = String(node.attrs.filename ?? "attachment");
  const href = String(node.attrs.href ?? "");
  const icon = attachmentIcon(filename);
  return (
    <NodeViewWrapper as="span" className="mr-2 mb-2 inline-block align-top">
      <a
        href={href}
        title={filename}
        // Attachment links are intercepted and opened in a modal, so they must
        // never be given target="_blank".
        target="_self"
        contentEditable={false}
        draggable={false}
        className={cn(
          "group/attachment border-border bg-surface-raised hover:border-primary focus-visible:ring-ring flex w-24 flex-col items-center gap-1.5 rounded-md border p-2 shadow-sm transition-colors !no-underline focus-visible:ring-2 focus-visible:outline-none",
          selected && "border-primary ring-primary/40 ring-2",
        )}
      >
        <span className="bg-surface-sunken text-muted-foreground group-hover/attachment:text-primary flex h-14 w-full items-center justify-center rounded transition-colors">
          {icon}
        </span>
        <span className="text-foreground w-full truncate text-center text-[11px] leading-tight">
          {filename}
        </span>
      </a>
    </NodeViewWrapper>
  );
}

const AttachmentNode = TiptapNode.create({
  name: "attachment",
  group: "inline",
  inline: true,
  atom: true,
  // Anchors are draggable by default in every browser, and tiptap's node view
  // hides dragstart from ProseMirror, so a dragged tile would be pasted as a
  // copy while the original stayed put - the same fault images used to have.
  // Nothing here needs dragging, so it is switched off on both levels.
  draggable: false,

  addAttributes() {
    return {
      href: {
        default: null,
        parseHTML: (element) => element.getAttribute("href"),
      },
      filename: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute("data-attachment") ||
          element.textContent?.trim() ||
          "attachment",
      },
    };
  },

  parseHTML() {
    // Priority has to clear the Link mark's, or an attachment would be parsed
    // as ordinary linked text before this rule is ever consulted.
    return [
      { tag: "a[data-attachment]", priority: 1100 },
      {
        // Pages written before this node existed - and everything imported
        // from Confluence, whose view-file macro becomes a bare <a> - carry no
        // marker attribute. Recognise them by their href, but only when the
        // link text reads as a filename: that leaves a deliberate inline link
        // to an attachment inside a sentence looking like a link.
        tag: "a[href]",
        priority: 1100,
        getAttrs: (element) => {
          const href = element.getAttribute("href") ?? "";
          if (!ATTACHMENT_HREF.test(href)) return false;
          const text = element.textContent?.trim() ?? "";
          return FILENAME_EXTENSION.test(text) ? null : false;
        },
      },
    ];
  },

  renderHTML({ node }) {
    const filename = String(node.attrs.filename ?? "attachment");
    return [
      "a",
      mergeAttributes({
        href: node.attrs.href,
        title: filename,
        target: "_self",
        "data-attachment": filename,
      }),
      filename,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AttachmentTile);
  },
});

const editorExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    codeBlock: false,
  }),
  CustomCodeBlock,
  CustomCalloutNode,
  Link.configure({
    openOnClick: false,
    autolink: true,
    defaultProtocol: "https",
  }),
  AttachmentNode,
  ResizableImage.configure({
    allowBase64: false,
  }),
  TextStyleMark,
  UnderlineMark,
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  Table.configure({
    resizable: false,
    cellMinWidth: TABLE_CELL_MIN_WIDTH,
  }),
  TableRowWithHeight,
  TableHeaderWithBackground,
  TableCellWithBackground,
  TableColumnResize,
  TableRowResize,
  Placeholder.configure({
    placeholder: "Write your documentation here...",
  }),
];

const headingLevels = [1, 2, 3] as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Convert Confluence's XML-style code & callout macros into semantic HTML for Tiptap. */
export function normalizeConfluenceCodeMacros(content: string): string {
  let res = content.replace(
    /<ac:structured-macro\b[^>]*>([\s\S]*?)<\/ac:structured-macro>/gi,
    (macro, inner: string) => {
      const nameMatch = macro.match(/ac:name=(?:"([^"]+)"|'([^']+)');?/i);
      const name = (nameMatch?.[1] || nameMatch?.[2] || "").toLowerCase();

      if (name === "code") {
        const bodyMatch = inner.match(
          /<ac:plain-text-body\b[^>]*>([\s\S]*?)<\/ac:plain-text-body>/i,
        );
        if (!bodyMatch) return macro;
        let code = bodyMatch[1];

        if (/^\s*<!\[CDATA\[/i.test(code)) {
          code = code.replace(/^\s*<!\[CDATA\[/i, "");
          code = code.replace(/\]\]\s*(?:>?|&gt;)\s*$/i, "");
        }

        code = code
          .replace(/^(?:[ \t]*[\r\n]|&#10;|&#13;|&NewLine;)+/, "")
          .replace(/(?:[\r\n][ \t]*|&#10;|&#13;|&NewLine;)+$/, "");

        const langMatch = inner.match(
          /<ac:parameter\b[^>]*\bac:name=(?:"language"|'language')[^>]*>([\s\S]*?)<\/ac:parameter>/i,
        );
        const language =
          langMatch?.[1]?.trim()?.replace(/[^a-z0-9_-]/gi, "") || "";
        return `<pre><code${language ? ` class="language-${language}"` : ""}>${escapeHtml(code)}</code></pre>`;
      }

      if (
        ["info", "warning", "note", "tip", "panel", "expand"].includes(name)
      ) {
        const bodyMatch = inner.match(
          /<ac:rich-text-body\b[^>]*>([\s\S]*?)<\/ac:rich-text-body>/i,
        );
        const body = bodyMatch ? bodyMatch[1] : "";

        const titleMatch = inner.match(
          /<ac:parameter\b[^>]*\bac:name=(?:"title"|'title')[^>]*>([\s\S]*?)<\/ac:parameter>/i,
        );
        const title = titleMatch ? titleMatch[1].trim() : "";
        const titleHtml = title
          ? `<p><strong>${escapeHtml(title)}</strong></p>`
          : "";

        const type = name === "expand" ? "panel" : name;
        return `<div data-type="callout" data-callout-type="${type}" class="callout callout-${type}">${titleHtml}${body}</div>`;
      }

      return macro;
    },
  );

  // Strip leading and trailing newlines from any existing <pre><code>...</code></pre> blocks
  res = res.replace(
    /(<pre\b[^>]*><code\b[^>]*>)([\s\S]*?)(<\/code><\/pre>)/gi,
    (_match, open, code, close) => {
      const trimmedCode = code
        .replace(/^(?:[ \t]*[\r\n]|&#10;|&#13;|&NewLine;)+/, "")
        .replace(/(?:[\r\n][ \t]*|&#10;|&#13;|&NewLine;)+$/, "");
      return `${open}${trimmedCode}${close}`;
    },
  );

  return res;
}

export function linkifyPlainTextUrls(content: string): string {
  if (typeof document === "undefined" || !content) return content;
  const parsed = document.implementation.createHTMLDocument("");
  parsed.body.innerHTML = content;
  const urlPattern = /\bhttps?:\/\/[^\s<]+[^\s<.,:;!?)]/g;
  const walker = parsed.createTreeWalker(parsed.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null = walker.nextNode();
  while (node) {
    const parent = node.parentElement?.tagName;
    if (parent !== "A" && parent !== "CODE" && parent !== "PRE") {
      textNodes.push(node as Text);
    }
    node = walker.nextNode();
  }
  for (const textNode of textNodes) {
    if (!urlPattern.test(textNode.data)) {
      urlPattern.lastIndex = 0;
      continue;
    }
    urlPattern.lastIndex = 0;
    const fragment = parsed.createDocumentFragment();
    let lastIndex = 0;
    textNode.data.replace(urlPattern, (url: string, offset: number) => {
      fragment.append(textNode.data.slice(lastIndex, offset));
      const anchor = parsed.createElement("a");
      anchor.href = url;
      anchor.textContent = url;
      fragment.append(anchor);
      lastIndex = offset + url.length;
      return url;
    });
    fragment.append(textNode.data.slice(lastIndex));
    textNode.replaceWith(fragment);
  }
  return parsed.body.innerHTML;
}

const editorClassName =
  "min-h-[calc(100vh-19rem)] px-5 py-4 text-sm leading-[1.45] outline-none " +
  "[&_p]:my-2 [&_p:first-child]:mt-0 " +
  "[&_p.is-editor-empty:first-child::before]:text-muted-foreground [&_p.is-editor-empty:first-child::before]:pointer-events-none [&_p.is-editor-empty:first-child::before]:float-left [&_p.is-editor-empty:first-child::before]:h-0 [&_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] " +
  "[&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight " +
  "[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:leading-tight " +
  "[&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:leading-tight " +
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-0.5 " +
  "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-primary [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground " +
  "[&_code]:rounded [&_code]:bg-surface-sunken [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs " +
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-surface-sunken [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:leading-5 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:whitespace-pre " +
  "[&_img]:my-3 [&_img]:max-w-full [&_img]:rounded-md " +
  // Table rhythm (margin, padding, line-height) is kept identical to
  // readerClassName below so a table is the same height in the editor and in
  // the live preview. Only the editor-only min-w-24 differs, so columns stay
  // comfortably grabbable while editing.
  "[&_.tableWrapper]:my-3 [&_.tableWrapper]:overflow-x-auto [&_table]:w-full [&_table]:border-collapse [&_th]:min-w-24 [&_th]:border [&_th]:border-border [&_th]:bg-surface-sunken [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_th]:leading-[1.45] [&_td]:min-w-24 [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5 [&_td]:leading-[1.45] [&_.selectedCell]:bg-primary-subtle";

// Imported pages are read like documentation, not like an editor canvas.
// Keep this separate from editorClassName so editing remains comfortable while
// imported Confluence pages retain their compact, scan-friendly rhythm.
export const readerClassName =
  "text-sm leading-[1.45] " +
  "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 " +
  "[&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight " +
  "[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:leading-tight " +
  "[&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:leading-tight " +
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-primary/50 [&_a]:transition-colors [&_a]:duration-150 [&_a:hover]:text-primary-hover [&_a:hover]:decoration-primary " +
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-0.5 " +
  "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-primary [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground " +
  "[&_code]:rounded [&_code]:bg-surface-sunken [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs " +
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-surface-sunken [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:leading-5 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:whitespace-pre " +
  "[&_img]:my-3 [&_img]:block [&_img]:h-auto [&_img]:max-w-[42rem] [&_img]:rounded-md " +
  "[&_.tableWrapper]:my-3 [&_.tableWrapper]:overflow-x-auto [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:bg-surface-sunken [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5";

function ToolbarButton({
  editor,
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  editor: Editor | null;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      disabled={!editor || disabled}
      onClick={onClick}
      className={cn(active && "bg-surface-selected text-primary")}
    >
      {children}
    </Button>
  );
}

function OverflowToolbarButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: Omit<React.ComponentProps<typeof ToolbarButton>, "editor">) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      className={cn(active && "bg-surface-selected text-primary")}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function HeadingMenu({ editor }: { editor: Editor | null }) {
  const currentLevel =
    useEditorState({
      editor,
      selector: ({ editor: currentEditor }) =>
        headingLevels.find((level) =>
          currentEditor?.isActive("heading", { level }),
        ),
    }) ?? undefined;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Text style"
          title="Text style"
          disabled={!editor}
          className={cn(
            "h-8 min-w-14 px-2",
            currentLevel && "bg-surface-selected text-primary",
          )}
        >
          {currentLevel ? `H${currentLevel}` : "Text"}
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40">
        <DropdownMenuItem
          onSelect={() => editor?.chain().focus().setParagraph().run()}
        >
          <Pilcrow />
          Paragraph
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            editor?.chain().focus().setHeading({ level: 1 }).run()
          }
        >
          <Heading1 />
          Heading 1
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            editor?.chain().focus().setHeading({ level: 2 }).run()
          }
        >
          <Heading2 />
          Heading 2
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            editor?.chain().focus().setHeading({ level: 3 }).run()
          }
        >
          <Heading3 />
          Heading 3
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AlignmentMenu({ editor }: { editor: Editor | null }) {
  const alignment =
    useEditorState({
      editor,
      selector: ({ editor: currentEditor }) =>
        currentEditor?.getAttributes("paragraph").textAlign ?? "left",
    }) ?? "left";
  const Icon =
    alignment === "center"
      ? AlignCenter
      : alignment === "right"
        ? AlignRight
        : AlignLeft;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Text alignment"
          title="Text alignment"
          disabled={!editor}
          className={cn(
            alignment !== "left" && "bg-surface-selected text-primary",
          )}
        >
          <Icon />
          <ChevronDown className="sr-only" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-36">
        <DropdownMenuItem
          onSelect={() => editor?.chain().focus().setTextAlign("left").run()}
        >
          <AlignLeft />
          Align left
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => editor?.chain().focus().setTextAlign("center").run()}
        >
          <AlignCenter />
          Align center
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => editor?.chain().focus().setTextAlign("right").run()}
        >
          <AlignRight />
          Align right
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const textColorOptions = [
  { label: "Blue", value: "var(--primary)" },
  { label: "Green", value: "var(--wh-success)" },
  { label: "Amber", value: "var(--wh-warning)" },
  { label: "Red", value: "var(--danger)" },
  { label: "Muted", value: "var(--muted-foreground)" },
];

const highlightOptions = [
  { label: "Blue", value: "var(--primary-subtle)" },
  { label: "Neutral", value: "var(--surface-sunken)" },
  { label: "Green", value: "var(--wh-success-bg)" },
  { label: "Amber", value: "var(--wh-warning-bg)" },
  { label: "Red", value: "var(--wh-danger-bg)" },
];

const cellColorOptions = [
  "var(--primary-subtle)",
  "var(--wh-info-bg)",
  "var(--wh-warning-bg)",
  "var(--wh-danger-bg)",
  "var(--surface-selected)",
  "var(--wh-success-bg)",
  "var(--wh-warning)",
  "var(--danger)",
  "var(--primary)",
  "var(--wh-info)",
  "var(--surface-hover)",
  "var(--border-strong)",
  "var(--muted-foreground)",
  "var(--foreground)",
  "var(--primary-hover)",
  "var(--surface-sunken)",
  "var(--surface)",
  "var(--surface-raised)",
  "var(--border)",
  "var(--background)",
];

function ColorMenu({
  editor,
  kind,
}: {
  editor: Editor | null;
  kind: "text" | "highlight";
}) {
  const isText = kind === "text";
  const options = isText ? textColorOptions : highlightOptions;
  const currentValue = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) =>
      currentEditor?.getAttributes("textStyle")[
        isText ? "color" : "backgroundColor"
      ] ?? "",
  });
  const current = options.find((option) => option.value === currentValue);
  const Icon = isText ? Type : Palette;
  const label = isText ? "Text colour" : "Text highlight";

  function setColor(value: string | null) {
    if (!editor) return;
    const attributes = editor.getAttributes("textStyle");
    editor
      .chain()
      .focus()
      .setMark("textStyle", {
        ...attributes,
        [isText ? "color" : "backgroundColor"]: value,
      })
      .run();
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={label}
          title={label}
          disabled={!editor}
          className={cn(
            "h-8 gap-1.5 px-2",
            current && "bg-surface-selected text-primary",
          )}
        >
          <Icon
            className="size-4"
            aria-hidden
            style={current ? { color: current.value } : undefined}
          />
          <span>{current?.label ?? label}</span>
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44 p-1">
        <div className="text-muted-foreground px-2 py-1 text-[11px] font-semibold tracking-wide uppercase">
          {label}
        </div>
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => setColor(option.value)}
            className="gap-2"
          >
            <span
              aria-hidden
              className="border-border size-4 shrink-0 rounded-sm border"
              style={{ backgroundColor: option.value }}
            />
            <span className="flex-1">{option.label}</span>
            {currentValue === option.value ? (
              <Check className="size-4" />
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onSelect={() => setColor(null)} className="gap-2">
          <span className="border-border text-muted-foreground flex size-4 shrink-0 items-center justify-center rounded-sm border text-[10px]">
            ×
          </span>
          Clear {isText ? "colour" : "highlight"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TablePicker({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState({ rows: 0, cols: 0 });
  const maxRows = 8;
  const maxCols = 10;

  function insertTable(rows: number, cols: number) {
    if (!editor || rows < 1 || cols < 1) return;
    editor
      .chain()
      .focus()
      .insertTable({ rows, cols, withHeaderRow: true })
      .run();
    setOpen(false);
    setHovered({ rows: 0, cols: 0 });
  }

  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setHovered({ rows: 0, cols: 0 });
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Insert table"
          title="Insert table"
          disabled={!editor}
        >
          <Table2 />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[13.5rem] p-2"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div className="text-muted-foreground mb-2 flex items-center justify-between px-1 text-xs">
          <span>Select table size</span>
          <span className="text-foreground font-medium tabular-nums">
            {hovered.rows}×{hovered.cols}
          </span>
        </div>
        <div
          role="grid"
          aria-label="Table size"
          className="border-border grid grid-cols-10 overflow-hidden rounded-sm border"
          onPointerDown={(event) => event.preventDefault()}
          onPointerLeave={() => setHovered({ rows: 0, cols: 0 })}
        >
          {Array.from({ length: maxRows * maxCols }, (_, index) => {
            const row = Math.floor(index / maxCols) + 1;
            const col = (index % maxCols) + 1;
            const selected = row <= hovered.rows && col <= hovered.cols;
            return (
              <button
                key={`${row}-${col}`}
                type="button"
                role="gridcell"
                aria-label={`${row} rows by ${col} columns`}
                className={cn(
                  "border-border h-5 w-5 border-r border-b transition-colors duration-100 last:border-r-0",
                  "hover:bg-primary-subtle hover:border-primary focus-visible:ring-ring focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none",
                  selected && "bg-primary-subtle border-primary",
                )}
                onPointerEnter={() => setHovered({ rows: row, cols: col })}
                onClick={() => insertTable(row, col)}
              />
            );
          })}
        </div>
        <p className="text-muted-foreground mt-2 px-1 text-[11px]">
          Click a cell to insert
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CellColorMenu({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState(false);
  const [customColor, setCustomColor] = useState("#ffffff");

  function setCellColor(value: string | null) {
    editor?.chain().focus().setCellAttribute("backgroundColor", value).run();
    setOpen(false);
  }

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Cell colour"
          title="Cell colour"
          disabled={!editor}
          className="h-8 gap-1.5 px-2"
        >
          <Palette className="size-4" aria-hidden />
          <span>Cell colour</span>
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-52 p-2"
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          if (!target.closest("label, input")) event.preventDefault();
        }}
      >
        <div className="text-muted-foreground mb-2 px-1 text-[11px] font-semibold tracking-wide uppercase">
          Cell colour
        </div>
        <div
          role="grid"
          aria-label="Cell colour palette"
          className="grid grid-cols-5 overflow-hidden rounded-sm"
        >
          {cellColorOptions.map((color, index) => (
            <button
              key={`${color}-${index}`}
              type="button"
              role="gridcell"
              aria-label={`Cell colour ${index + 1}`}
              title={`Cell colour ${index + 1}`}
              className="border-surface focus-visible:ring-ring size-9 border transition-transform duration-100 hover:z-10 hover:scale-110 hover:rounded-sm focus-visible:z-10 focus-visible:scale-110 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:outline-none"
              style={{ backgroundColor: color }}
              onClick={() => setCellColor(color)}
            />
          ))}
        </div>
        <div className="border-border mt-2 flex items-center justify-between border-t pt-2">
          <button
            type="button"
            aria-label="Clear cell colour"
            title="Clear cell colour"
            className="border-border text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring flex size-8 items-center justify-center rounded-md border transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
            onClick={() => setCellColor(null)}
          >
            <span aria-hidden className="text-base leading-none">
              ×
            </span>
          </button>
          <label
            title="Custom cell colour"
            className="border-border text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-within:ring-ring relative flex size-8 cursor-pointer items-center justify-center rounded-md border transition-colors duration-150 focus-within:ring-2"
          >
            <Palette className="size-4" aria-hidden />
            <input
              type="color"
              aria-label="Custom cell colour"
              value={customColor}
              onChange={(event) => {
                setCustomColor(event.target.value);
                setCellColor(event.target.value);
              }}
              className="sr-only"
            />
          </label>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TableActionButton({
  editor,
  label,
  onClick,
  destructive,
  disabled,
  children,
}: {
  editor: Editor | null;
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      title={label}
      disabled={disabled || !editor}
      onClick={onClick}
      className={cn(
        "h-8 gap-1.5 px-2",
        destructive && "text-danger hover:bg-danger-bg hover:text-danger active:bg-danger-bg/85"
      )}
    >
      {children}
      <span>{label}</span>
    </Button>
  );
}

type TableMenuPosition = { left: number; top: number };

/**
 * Table actions live in a viewport-positioned surface instead of the main
 * toolbar. Keeping it out of document flow means entering a table never makes
 * the formatting bar wrap or shifts the editor content below it.
 */
function TableActionsMenu({ editor }: { editor: Editor | null }) {
  const [position, setPosition] = useState<TableMenuPosition | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredTable, setHoveredTable] = useState({ rows: 0, cols: 0 });
  const maxRows = 8;
  const maxCols = 10;

  function insertTable(rows: number, cols: number) {
    if (!editor || rows < 1 || cols < 1) return;
    editor
      .chain()
      .focus()
      .insertTable({ rows, cols, withHeaderRow: true })
      .run();
    setHoveredTable({ rows: 0, cols: 0 });
  }

  const updatePosition = useCallback(() => {
    if (!editor) return;

    // The menu should remain visible if the editor is focused, OR if the focus
    // has moved to a menu/dialog associated with the table action toolbar.
    const isFocused =
      editor.isFocused ||
      (typeof document !== "undefined" &&
        (document.activeElement?.closest('[role="menu"]') !== null ||
          document.activeElement?.closest('[data-radix-menu-content]') !== null ||
          containerRef.current?.querySelector('[data-state="open"]') !== null ||
          containerRef.current?.contains(document.activeElement) === true));

    // A restored selection can be inside a table as soon as edit mode opens.
    // Only surface table controls after the user actually focuses that table.
    if (!isFocused || !editor.isActive("table")) {
      setPosition(null);
      return;
    }

    const { node } = editor.view.domAtPos(editor.state.selection.$from.pos);
    const table =
      (node instanceof Element ? node : node.parentElement)?.closest("table") ??
      null;

    if (!table) {
      setPosition(null);
      return;
    }

    const rect = table.getBoundingClientRect();
    setPosition({
      // Leave enough room for the compact menu while keeping it on-screen.
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 400)),
      top: Math.min(rect.bottom + 6, window.innerHeight - 48),
    });
  }, [editor]);

  useLayoutEffect(() => {
    if (!editor) return;

    editor.on("selectionUpdate", updatePosition);
    editor.on("transaction", updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- position the floating table toolbar on first render
    updatePosition();

    return () => {
      editor.off("selectionUpdate", updatePosition);
      editor.off("transaction", updatePosition);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [editor, updatePosition]);

  if (!position) return null;

  return (
    <div
      ref={containerRef}
      className="border-border bg-surface-raised fixed z-50 flex max-w-[calc(100vw-1rem)] flex-wrap items-center gap-0.5 rounded-md border p-1 shadow-lg"
      style={position}
      role="toolbar"
      aria-label="Table actions"
      onMouseDown={(event) => {
        // Keep the ProseMirror selection for button actions, but let the native
        // colour picker receive its normal pointer interaction.
        if ((event.target as HTMLElement).closest("button")) {
          event.preventDefault();
        }
      }}
    >
      <TableActionButton
        editor={editor}
        label="Merge selected cells"
        disabled={!editor?.can().mergeCells()}
        onClick={() => editor?.chain().focus().mergeCells().run()}
      >
        <TableCellsMerge />
      </TableActionButton>
      <TableActionButton
        editor={editor}
        label="Split cell"
        disabled={!editor?.can().splitCell()}
        onClick={() => editor?.chain().focus().splitCell().run()}
      >
        <SquareSplitHorizontal />
      </TableActionButton>
      <CellColorMenu editor={editor} />

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!editor}
            className="h-8 gap-1.5 px-2"
          >
            <Plus />
            <span>Add</span>
            <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-40 p-1">
          <DropdownMenuItem
            className="text-muted-foreground data-[highlighted]:text-foreground"
            onClick={() => editor?.chain().focus().addRowAfter().run()}
          >
            <BetweenHorizontalEnd />
            <span>Add row</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-muted-foreground data-[highlighted]:text-foreground"
            onClick={() => editor?.chain().focus().addColumnAfter().run()}
          >
            <BetweenVerticalEnd />
            <span>Add column</span>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="text-muted-foreground data-[highlighted]:text-foreground">
              <Table2 />
              <span>Add table</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-[13.5rem] p-2">
              <div className="text-muted-foreground mb-2 flex items-center justify-between px-1 text-xs">
                <span>Select table size</span>
                <span className="text-foreground font-medium tabular-nums">
                  {hoveredTable.rows}×{hoveredTable.cols}
                </span>
              </div>
              <div
                role="grid"
                aria-label="Table size"
                className="border-border grid grid-cols-10 overflow-hidden rounded-sm border"
                onPointerDown={(event) => event.preventDefault()}
                onPointerLeave={() => setHoveredTable({ rows: 0, cols: 0 })}
              >
                {Array.from({ length: maxRows * maxCols }, (_, index) => {
                  const row = Math.floor(index / maxCols) + 1;
                  const col = (index % maxCols) + 1;
                  const selected = row <= hoveredTable.rows && col <= hoveredTable.cols;
                  return (
                    <button
                      key={`${row}-${col}`}
                      type="button"
                      role="gridcell"
                      aria-label={`${row} rows by ${col} columns`}
                      className={cn(
                        "border-border h-5 w-5 border-r border-b transition-colors duration-100 last:border-r-0",
                        "hover:bg-primary-subtle hover:border-primary focus-visible:ring-ring focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none",
                        selected && "bg-primary-subtle border-primary",
                      )}
                      onPointerEnter={() => setHoveredTable({ rows: row, cols: col })}
                      onClick={() => insertTable(row, col)}
                    />
                  );
                })}
              </div>
              <p className="text-muted-foreground mt-2 px-1 text-[11px]">
                Click a cell to insert
              </p>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!editor}
            className="h-8 gap-1.5 px-2 text-danger hover:bg-danger-bg hover:text-danger active:bg-danger-bg/85"
          >
            <Trash2 />
            <span>Delete</span>
            <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-40 p-1">
          <DropdownMenuItem
            destructive
            onClick={() => editor?.chain().focus().deleteRow().run()}
          >
            <Trash2 />
            <span>Delete row</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            destructive
            onClick={() => editor?.chain().focus().deleteColumn().run()}
          >
            <Trash2 />
            <span>Delete column</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            destructive
            onClick={() => editor?.chain().focus().deleteTable().run()}
          >
            <Trash2 />
            <span>Delete table</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function MoreFormattingMenu({
  hasActions,
  children,
}: {
  hasActions: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="More formatting actions"
          title="More formatting actions"
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-auto max-w-[calc(100vw-1rem)] p-1"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {hasActions ? (
          <div
            role="toolbar"
            aria-label="Hidden formatting actions"
            className="flex max-w-56 flex-wrap gap-0.5"
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("button")) {
                setOpen(false);
              }
            }}
          >
            {children}
          </div>
        ) : (
          <p className="text-muted-foreground px-2 py-1.5 text-xs">
            All actions are visible
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RichTextToolbar({
  editor,
  wrapText,
  onToggleWrap,
  onUploadFile,
}: {
  editor: Editor | null;
  wrapText: boolean;
  onToggleWrap: () => void;
  onUploadFile?: (file: File) => Promise<{
    filename: string;
    content_type: string;
    content_url: string;
  }>;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkTarget, setLinkTarget] = useState("_self");
  const linkSelection = useRef<{ from: number; to: number } | null>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const toolbarActionsRef = useRef<HTMLDivElement>(null);
  const [visibleOverflowActionCount, setVisibleOverflowActionCount] =
    useState(9);
  const [toolbarMeasureVersion, setToolbarMeasureVersion] = useState(0);

  useLayoutEffect(() => {
    const toolbar = toolbarActionsRef.current;
    if (!toolbar) return;
    if (
      toolbar.scrollWidth > toolbar.clientWidth + 1 &&
      visibleOverflowActionCount > 0
    ) {
      setVisibleOverflowActionCount((count) => count - 1);
    }
  }, [toolbarMeasureVersion, visibleOverflowActionCount]);

  useLayoutEffect(() => {
    const toolbar = toolbarActionsRef.current;
    if (!toolbar || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      // Recalculate from the full action set. Layout effects run before paint,
      // so this doesn't make the editor toolbar jump while its container grows.
      setVisibleOverflowActionCount(9);
      setToolbarMeasureVersion((version) => version + 1);
    });
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);

  const openLinkDialog = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const attributes = editor.getAttributes("link");
    linkSelection.current = { from, to };
    setLinkUrl((attributes.href as string | undefined) ?? "");
    setLinkTitle((attributes.title as string | undefined) ?? "");
    setLinkTarget((attributes.target as string | undefined) ?? "_self");
    setLinkText(editor.state.doc.textBetween(from, to, " "));
    setLinkOpen(true);
  }, [editor]);

  function saveLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;

    const href = linkUrl.trim();
    const selection = linkSelection.current;
    if (selection) editor.commands.setTextSelection(selection);
    if (!href) {
      editor.chain().focus().unsetLink().run();
      setLinkOpen(false);
      return;
    }

    const attrs = {
      href,
      title: linkTitle.trim() || null,
      target: linkTarget === "_blank" ? "_blank" : null,
    };
    const displayText = linkText.trim() || href;
    const chain = editor.chain().focus();
    if (selection && selection.from !== selection.to) {
      const selectedText = editor.state.doc.textBetween(
        selection.from,
        selection.to,
        " ",
      );
      if (displayText !== selectedText) {
        chain
          .deleteSelection()
          .insertContent({
            type: "text",
            text: displayText,
            marks: [{ type: "link", attrs }],
          })
          .run();
      } else {
        chain.extendMarkRange("link").setLink(attrs).run();
      }
    } else {
      chain
        .insertContent({
          type: "text",
          text: displayText,
          marks: [{ type: "link", attrs }],
        })
        .run();
    }
    setLinkOpen(false);
  }

  const insertAttachment = useCallback(() => {
    if (!editor) return;
    attachmentInput.current?.click();
  }, [editor]);

  const insertImage = useCallback(() => {
    if (!editor) return;
    imageInput.current?.click();
  }, [editor]);

  async function insertFiles(files: File[]) {
    if (!editor || files.length === 0) return;
    setUploadError(null);
    if (!onUploadFile) {
      const image = files.find((file) => file.type.startsWith("image/"));
      if (!image) return;
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        if (typeof reader.result === "string") {
          editor.chain().focus().setImage({ src: reader.result }).run();
        }
      });
      reader.readAsDataURL(image);
      return;
    }

    setUploading(true);
    try {
      for (const file of files) {
        const uploaded = await onUploadFile(file);
        if (uploaded.content_type.startsWith("image/")) {
          editor
            .chain()
            .focus()
            .setImage({ src: uploaded.content_url, alt: uploaded.filename })
            .run();
        } else {
          editor
            .chain()
            .focus()
            .insertContent({
              type: "attachment",
              attrs: {
                href: uploaded.content_url,
                filename: uploaded.filename,
              },
            })
            .run();
        }
      }
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "Could not upload this file.",
      );
    } finally {
      setUploading(false);
    }
  }

  function handleAttachmentSelected(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void insertFiles(files);
  }

  useEffect(() => {
    if (!editor) return;
    const handleDroppedFiles = (event: Event) => {
      void insertFiles((event as CustomEvent<File[]>).detail);
    };
    editor.view.dom.addEventListener(
      "wikihub:editor-files",
      handleDroppedFiles,
    );
    return () =>
      editor.view.dom.removeEventListener(
        "wikihub:editor-files",
        handleDroppedFiles,
      );
  });

  return (
    <div
      className="border-border bg-surface-sunken flex flex-nowrap items-center gap-1 overflow-hidden rounded-t-md border px-1 py-1 [&>button]:shrink-0"
      role="toolbar"
      aria-label="Page formatting"
    >
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={handleAttachmentSelected}
      />
      <input
        ref={attachmentInput}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={handleAttachmentSelected}
      />
      <div
        ref={toolbarActionsRef}
        className="flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-hidden [&>button]:shrink-0"
      >
        <ToolbarButton
          editor={editor}
          label="Bold"
          active={editor?.isActive("bold")}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Bold />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label="Italic"
          active={editor?.isActive("italic")}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Italic />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label="Underline"
          active={editor?.isActive("underline")}
          onClick={() => editor?.chain().focus().toggleMark("underline").run()}
        >
          <Underline />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label="Strikethrough"
          active={editor?.isActive("strike")}
          onClick={() => editor?.chain().focus().toggleStrike().run()}
        >
          <Strikethrough />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label="Inline code"
          active={editor?.isActive("code")}
          onClick={() => editor?.chain().focus().toggleCode().run()}
        >
          <Code2 />
        </ToolbarButton>
        <ColorMenu editor={editor} kind="text" />
        <ColorMenu editor={editor} kind="highlight" />
        <ToolbarButton
          editor={editor}
          label="Clear text colour and highlight"
          onClick={() => {
            if (!editor) return;
            const markType = editor.schema.marks.textStyle;
            if (!markType) return;

            const { from, to } = editor.state.selection;
            if (from === to) {
              editor.commands.unsetMark("textStyle", {
                extendEmptyMarkRange: true,
              });
            } else {
              editor.view.dispatch(
                editor.state.tr.removeMark(from, to, markType),
              );
              editor.view.focus();
            }
          }}
        >
          <RemoveFormatting />
        </ToolbarButton>
        <span aria-hidden className="bg-border mx-1 h-5 w-px" />
        <HeadingMenu editor={editor} />
        <AlignmentMenu editor={editor} />
        {visibleOverflowActionCount > 0 ? (
          <ToolbarButton
            editor={editor}
            label={wrapText ? "Unwrap text" : "Wrap text"}
            active={wrapText}
            onClick={onToggleWrap}
          >
            {wrapText ? <UnfoldHorizontal /> : <WrapText />}
          </ToolbarButton>
        ) : null}
        {visibleOverflowActionCount > 1 ? (
          <ToolbarButton
            editor={editor}
            label="Bulleted list"
            active={editor?.isActive("bulletList")}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <List />
          </ToolbarButton>
        ) : null}
        {visibleOverflowActionCount > 2 ? (
          <ToolbarButton
            editor={editor}
            label="Numbered list"
            active={editor?.isActive("orderedList")}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered />
          </ToolbarButton>
        ) : null}
        {visibleOverflowActionCount > 3 ? (
          <ToolbarButton
            editor={editor}
            label="Quote"
            active={editor?.isActive("blockquote")}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          >
            <Quote />
          </ToolbarButton>
        ) : null}
        {visibleOverflowActionCount > 4 ? (
          <ToolbarButton
            editor={editor}
            label="Code block"
            active={editor?.isActive("codeBlock")}
            onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
          >
            <Code2 className="fill-current" />
          </ToolbarButton>
        ) : null}
        {visibleOverflowActionCount > 5 ? (
          <ToolbarButton
            editor={editor}
            label="Insert divider"
            onClick={() => editor?.chain().focus().setHorizontalRule().run()}
          >
            <Minus />
          </ToolbarButton>
        ) : null}
        {visibleOverflowActionCount > 6 ? (
          <ToolbarButton
            editor={editor}
            label="Add link"
            onClick={openLinkDialog}
          >
            <Link2 />
          </ToolbarButton>
        ) : null}
        {visibleOverflowActionCount > 7 ? (
          <ToolbarButton
            editor={editor}
            label="Insert image"
            disabled={uploading}
            onClick={insertImage}
          >
            {uploading ? (
              <ImagePlus className="animate-pulse" />
            ) : (
              <ImagePlus />
            )}
          </ToolbarButton>
        ) : null}
        {visibleOverflowActionCount > 8 ? (
          <ToolbarButton
            editor={editor}
            label="Upload file"
            disabled={uploading}
            onClick={insertAttachment}
          >
            {uploading ? (
              <Paperclip className="animate-pulse" />
            ) : (
              <Paperclip />
            )}
          </ToolbarButton>
        ) : null}
        <TablePicker editor={editor} />
      </div>
      <div className="border-border ml-auto flex shrink-0 items-center gap-1 border-l pl-1">
        <ToolbarButton
          editor={editor}
          label="Undo"
          disabled={!editor?.can().undo()}
          onClick={() => editor?.chain().focus().undo().run()}
        >
          <Undo2 />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label="Redo"
          disabled={!editor?.can().redo()}
          onClick={() => editor?.chain().focus().redo().run()}
        >
          <Redo2 />
        </ToolbarButton>
        {visibleOverflowActionCount < 9 ? (
          <MoreFormattingMenu hasActions>
            {visibleOverflowActionCount < 1 ? (
              <OverflowToolbarButton
                label={wrapText ? "Unwrap text" : "Wrap text"}
                active={wrapText}
                onClick={onToggleWrap}
              >
                {wrapText ? <UnfoldHorizontal /> : <WrapText />}
              </OverflowToolbarButton>
            ) : null}
            {visibleOverflowActionCount < 2 ? (
              <OverflowToolbarButton
                label="Bulleted list"
                active={editor?.isActive("bulletList")}
                onClick={() => editor?.chain().focus().toggleBulletList().run()}
              >
                <List />
              </OverflowToolbarButton>
            ) : null}
            {visibleOverflowActionCount < 3 ? (
              <OverflowToolbarButton
                label="Numbered list"
                active={editor?.isActive("orderedList")}
                onClick={() =>
                  editor?.chain().focus().toggleOrderedList().run()
                }
              >
                <ListOrdered />
              </OverflowToolbarButton>
            ) : null}
            {visibleOverflowActionCount < 4 ? (
              <OverflowToolbarButton
                label="Quote"
                active={editor?.isActive("blockquote")}
                onClick={() => editor?.chain().focus().toggleBlockquote().run()}
              >
                <Quote />
              </OverflowToolbarButton>
            ) : null}
            {visibleOverflowActionCount < 5 ? (
              <OverflowToolbarButton
                label="Code block"
                active={editor?.isActive("codeBlock")}
                onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
              >
                <Code2 className="fill-current" />
              </OverflowToolbarButton>
            ) : null}
            {visibleOverflowActionCount < 6 ? (
              <OverflowToolbarButton
                label="Insert divider"
                onClick={() =>
                  editor?.chain().focus().setHorizontalRule().run()
                }
              >
                <Minus />
              </OverflowToolbarButton>
            ) : null}
            {visibleOverflowActionCount < 7 ? (
              <OverflowToolbarButton label="Add link" onClick={openLinkDialog}>
                <Link2 />
              </OverflowToolbarButton>
            ) : null}
            {visibleOverflowActionCount < 8 ? (
              <OverflowToolbarButton
                label={uploading ? "Uploading image" : "Insert image"}
                disabled={uploading}
                onClick={insertImage}
              >
                {uploading ? (
                  <ImagePlus className="animate-pulse" />
                ) : (
                  <ImagePlus />
                )}
              </OverflowToolbarButton>
            ) : null}
            {visibleOverflowActionCount < 9 ? (
              <OverflowToolbarButton
                label={uploading ? "Uploading file" : "Upload file"}
                disabled={uploading}
                onClick={insertAttachment}
              >
                {uploading ? (
                  <Paperclip className="animate-pulse" />
                ) : (
                  <Paperclip />
                )}
              </OverflowToolbarButton>
            ) : null}
          </MoreFormattingMenu>
        ) : null}
      </div>
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent title="Insert or edit link" className="max-w-xl">
          <form onSubmit={saveLink} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <label htmlFor="link-url" className="text-sm font-medium">
                Url
              </label>
              <Input
                id="link-url"
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
                placeholder="https://example.com"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="link-text" className="text-sm font-medium">
                Link text
              </label>
              <Input
                id="link-text"
                value={linkText}
                onChange={(event) => setLinkText(event.target.value)}
                placeholder="Text shown to readers"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="link-title" className="text-sm font-medium">
                Title
              </label>
              <Input
                id="link-title"
                value={linkTitle}
                onChange={(event) => setLinkTitle(event.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="link-target" className="text-sm font-medium">
                Open link in...
              </label>
              <Select value={linkTarget} onValueChange={setLinkTarget}>
                <SelectTrigger id="link-target" aria-label="Open link in">
                  <SelectValue>
                    {linkTarget === "_blank" ? "New window" : "Current window"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_self">Current window</SelectItem>
                  <SelectItem value="_blank">New window</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setLinkOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {uploadError ? (
        <p className="text-danger basis-full px-2 py-1 text-xs" role="alert">
          {uploadError}
        </p>
      ) : null}
    </div>
  );
}

export function RichTextEditor({
  content,
  onChange,
  onUploadFile,
}: {
  content: string;
  onChange: (html: string) => void;
  onUploadFile?: (file: File) => Promise<{
    filename: string;
    content_type: string;
    content_url: string;
  }>;
}) {
  const [wrapText, setWrapText] = useState(true);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<string | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleViewDetails = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      setSelectedAttachmentId(id);
    };
    document.addEventListener("wikihub:view-file-details", handleViewDetails);
    return () => {
      document.removeEventListener("wikihub:view-file-details", handleViewDetails);
    };
  }, []);

  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    // Intercept attachment link clicks at the lowest DOM level possible.
    // We must stop both mousedown AND click events because ProseMirror
    // consumes mousedown and may prevent the click event from firing,
    // while the browser can still follow an <a> link via the mouseup/click
    // sequence if we only intercept one. stopImmediatePropagation() ensures
    // no other capture-phase listener (including ProseMirror's own) sees
    // these events for attachment links.
    const interceptAttachmentLink = (event: MouseEvent, onMatch: (id: string) => void) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a");
      if (!link) return;
      const href = link.getAttribute("href") || "";
      const match = href.match(/\/api\/v1\/attachments\/([a-f0-9-]{36})/i);
      if (match) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onMatch(match[1]);
      }
    };

    let pendingId: string | null = null;

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a");
      if (!link) return;
      const href = link.getAttribute("href") || "";
      const match = href.match(/\/api\/v1\/attachments\/([a-f0-9-]{36})/i);
      if (match) {
        // Prevent the browser from treating this as a link activation,
        // but allow ProseMirror to still update the cursor position.
        event.preventDefault();
        pendingId = match[1];
      }
    };

    const handleClick = (event: MouseEvent) => {
      interceptAttachmentLink(event, (id) => {
        setSelectedAttachmentId(id);
        pendingId = null;
      });
      // If mousedown was intercepted but click wasn't (ProseMirror ate it),
      // open the modal using the id captured on mousedown.
      if (pendingId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setSelectedAttachmentId(pendingId);
        pendingId = null;
      }
    };

    container.addEventListener("mousedown", handleMouseDown, true);
    container.addEventListener("click", handleClick, true);
    return () => {
      container.removeEventListener("mousedown", handleMouseDown, true);
      container.removeEventListener("click", handleClick, true);
    };
  }, []);
  const internalImageDragRef = useRef(false);
  const draggedImagePosRef = useRef<number | null>(null);
  const normalizedContent = useMemo(
    () => normalizeConfluenceCodeMacros(content),
    [content],
  );
  const lastEmittedHtml = useRef(normalizedContent);
  const emitEditorContent = useCallback(
    (updatedEditor: Editor) => {
      const nextHtml = updatedEditor.getHTML();
      if (nextHtml === lastEmittedHtml.current) return;
      lastEmittedHtml.current = nextHtml;
      onChange(nextHtml);
    },
    [onChange],
  );
  const editor = useEditor({
    immediatelyRender: false,
    extensions: editorExtensions,
    content: normalizedContent,
    editorProps: {
      attributes: { class: editorClassName },
      handleDrop(view, event) {
        // Tiptap's default node view `stopEvent` hides `dragstart` from
        // ProseMirror whenever the drag begins on a child of the wrapper - the
        // <img> here - so `view.dragging` is never set. Left to its default,
        // ProseMirror then treats the drop as an external one: it pastes a copy
        // parsed from the drag's text/html and never deletes the source, which
        // is what left a duplicate behind. Own the drop instead and move the
        // node ourselves.
        if (!internalImageDragRef.current) return false;
        const fromPos = draggedImagePosRef.current;
        internalImageDragRef.current = false;
        draggedImagePosRef.current = null;
        // Every path below returns true, which makes ProseMirror call
        // preventDefault: a drop we cannot place must be a no-op, never a copy.
        if (typeof fromPos !== "number") return true;
        const node = view.state.doc.nodeAt(fromPos);
        if (!node || node.type.name !== "image") return true;
        const dropCoords = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        if (!dropCoords) return true;
        const targetPos = dropCoords.pos;
        // Dropped back onto itself: nothing to do.
        if (targetPos >= fromPos && targetPos <= fromPos + node.nodeSize)
          return true;

        const tr = view.state.tr;
        tr.delete(fromPos, fromPos + node.nodeSize);
        const mappedTargetPos = tr.mapping.map(targetPos);
        // A raw text position is not always a place a block image may live -
        // mid-paragraph, for one. dropPoint finds the nearest spot that fits.
        const imageSlice = new Slice(Fragment.from(node), 0, 0);
        const insertPos =
          dropPoint(tr.doc, mappedTargetPos, imageSlice) ?? mappedTargetPos;
        tr.insert(insertPos, node);
        const inserted = tr.doc.nodeAt(insertPos);
        if (inserted && NodeSelection.isSelectable(inserted))
          tr.setSelection(NodeSelection.create(tr.doc, insertPos));
        view.dispatch(tr);
        return true;
      },
    },
    onUpdate: ({ editor: updatedEditor }) => emitEditorContent(updatedEditor),
    onTransaction: ({ editor: updatedEditor }) =>
      emitEditorContent(updatedEditor),
  });

  const handleDroppedFiles = useCallback(
    async (files: FileList) => {
      if (!editor || files.length === 0) return;
      // Let the toolbar own upload state and behaviour by opening its hidden
      // native picker path only for user-selected files; drops call the same
      // backend contract through this custom event.
      const dropEvent = new CustomEvent<File[]>("wikihub:editor-files", {
        detail: Array.from(files),
      });
      editor.view.dom.dispatchEvent(dropEvent);
    },
    [editor],
  );

  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;
    const isFileDrag = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const onDragEnter = (event: DragEvent) => {
      if (isFileDrag(event) && !internalImageDragRef.current)
        setDraggingFiles(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (internalImageDragRef.current) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        return;
      }
      if (!isFileDrag(event)) return;
      // This must run in native capture phase. ProseMirror consumes bubbling
      // events, and without preventDefault Chrome navigates to the dropped file.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setDraggingFiles(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (
        event.relatedTarget instanceof Node &&
        container.contains(event.relatedTarget)
      )
        return;
      setDraggingFiles(false);
    };
    const onDrop = (event: DragEvent) => {
      if (internalImageDragRef.current) {
        // Only the overlay is cleared here. This listener runs in the capture
        // phase, ahead of ProseMirror's own drop handler, so resetting the drag
        // refs would leave `handleDrop` above blind to the move in flight and
        // the image would be copied instead of moved. Calling preventDefault
        // would be just as bad: ProseMirror skips events whose default is
        // already prevented. onDropCleanup below settles the refs afterwards.
        setDraggingFiles(false);
        return;
      }
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      event.stopPropagation();
      setDraggingFiles(false);
      const position = editor?.view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      });
      if (position) editor?.commands.setTextSelection(position.pos);
      void handleDroppedFiles(event.dataTransfer.files);
    };
    const onInternalImageDragStart = (event: Event) => {
      internalImageDragRef.current = true;
      const customEvt = event as CustomEvent<{ pos?: number }>;
      if (typeof customEvt.detail?.pos === "number") {
        draggedImagePosRef.current = customEvt.detail.pos;
      }
      setDraggingFiles(false);
    };
    const onInternalImageDragEnd = () => {
      internalImageDragRef.current = false;
      draggedImagePosRef.current = null;
      setDraggingFiles(false);
    };
    // Bubble phase, so it settles the refs only after ProseMirror's drop
    // handler has had them. The node view's own dragend cannot be relied on:
    // a successful move re-creates it, and the detached element may never see
    // the event.
    const onDropCleanup = () => {
      internalImageDragRef.current = false;
      draggedImagePosRef.current = null;
      setDraggingFiles(false);
    };

    container.addEventListener("dragenter", onDragEnter, true);
    container.addEventListener("dragover", onDragOver, true);
    container.addEventListener("dragleave", onDragLeave, true);
    container.addEventListener("drop", onDrop, true);
    container.addEventListener("drop", onDropCleanup);
    container.addEventListener(
      "wikihub:internal-image-drag-start",
      onInternalImageDragStart,
    );
    container.addEventListener(
      "wikihub:internal-image-drag-end",
      onInternalImageDragEnd,
    );
    return () => {
      container.removeEventListener("dragenter", onDragEnter, true);
      container.removeEventListener("dragover", onDragOver, true);
      container.removeEventListener("dragleave", onDragLeave, true);
      container.removeEventListener("drop", onDrop, true);
      container.removeEventListener("drop", onDropCleanup);
      container.removeEventListener(
        "wikihub:internal-image-drag-start",
        onInternalImageDragStart,
      );
      container.removeEventListener(
        "wikihub:internal-image-drag-end",
        onInternalImageDragEnd,
      );
    };
  }, [editor, handleDroppedFiles]);

  return (
    <div ref={editorContainerRef} className="relative">
      {editor ? (
        <RichTextToolbar
          editor={editor}
          wrapText={wrapText}
          onToggleWrap={() => setWrapText((current) => !current)}
          onUploadFile={onUploadFile}
        />
      ) : (
        <div
          className="border-border bg-surface-sunken h-10 rounded-t-md border"
          aria-hidden
        />
      )}
      <EditorContent
        editor={editor}
        className={cn(
          "border-border bg-surface focus-within:ring-ring focus-within:ring-offset-background max-w-full min-w-0 overflow-x-auto rounded-b-md border border-t-0 focus-within:ring-2 focus-within:ring-offset-2",
          !wrapText &&
            "[&_h1]:whitespace-nowrap [&_h2]:whitespace-nowrap [&_h3]:whitespace-nowrap [&_p]:whitespace-nowrap",
        )}
      />
      <TableActionsMenu editor={editor} />
      {draggingFiles ? (
        <div className="border-primary bg-primary-subtle/90 text-primary pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed text-sm font-semibold">
          Drop images or files to upload
        </div>
      ) : null}
      <AttachmentDetailsModal
        // Keying on the attachment makes each one a fresh mount, so the modal
        // never has to reset its own state on the way out.
        key={selectedAttachmentId ?? "none"}
        attachmentId={selectedAttachmentId}
        onClose={() => setSelectedAttachmentId(null)}
      />
    </div>
  );
}

export function RichTextContent({ content }: { content: string }) {
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<string | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  const normalizedContent = useMemo(
    () => linkifyPlainTextUrls(normalizeConfluenceCodeMacros(content)),
    [content],
  );
  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: editorExtensions,
    content: normalizedContent,
    editorProps: {
      attributes: {
        class: cn(readerClassName, "min-h-0 px-0 py-0"),
      },
    },
  });

  useEffect(() => {
    if (editor && editor.getHTML() !== normalizedContent) {
      editor.commands.setContent(normalizedContent, { emitUpdate: false });
    }
  }, [editor, normalizedContent]);

  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    const interceptAttachmentLink = (event: MouseEvent, onMatch: (id: string) => void) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a");
      if (!link) return;
      const href = link.getAttribute("href") || "";
      const match = href.match(/\/api\/v1\/attachments\/([a-f0-9-]{36})/i);
      if (match) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onMatch(match[1]);
      }
    };

    let pendingId: string | null = null;

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a");
      if (!link) return;
      const href = link.getAttribute("href") || "";
      const match = href.match(/\/api\/v1\/attachments\/([a-f0-9-]{36})/i);
      if (match) {
        event.preventDefault();
        pendingId = match[1];
      }
    };

    const handleClick = (event: MouseEvent) => {
      interceptAttachmentLink(event, (id) => {
        setSelectedAttachmentId(id);
        pendingId = null;
      });
      if (pendingId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setSelectedAttachmentId(pendingId);
        pendingId = null;
      }
    };

    container.addEventListener("mousedown", handleMouseDown, true);
    container.addEventListener("click", handleClick, true);
    return () => {
      container.removeEventListener("mousedown", handleMouseDown, true);
      container.removeEventListener("click", handleClick, true);
    };
  }, []);

  return (
    <div ref={editorContainerRef} className="relative">
      <EditorContent editor={editor} />
      <AttachmentDetailsModal
        // Keying on the attachment makes each one a fresh mount, so the modal
        // never has to reset its own state on the way out.
        key={selectedAttachmentId ?? "none"}
        attachmentId={selectedAttachmentId}
        onClose={() => setSelectedAttachmentId(null)}
      />
    </div>
  );
}

type AttachmentMetadata = {
  id: string;
  page_id: string;
  filename: string;
  content_type: string;
  created_at: string;
  size_bytes: number;
};

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightedText({
  text,
  query,
  lineIdx,
  activeMatchIdx,
  matches,
}: {
  text: string;
  query: string;
  lineIdx: number;
  activeMatchIdx: number;
  matches: { lineIdx: number; charIdx: number }[];
}) {
  if (!query) return <>{text || " "}</>;

  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, "gi"));
  // Resolve every fragment's offset within the line up front. Carrying a
  // running counter through the map below would mean mutating a variable from
  // inside render, which is not safe to repeat across renders.
  const segments: { part: string; start: number }[] = [];
  for (let index = 0, start = 0; index < parts.length; index += 1) {
    segments.push({ part: parts[index], start });
    start += parts[index].length;
  }

  return (
    <>
      {segments.map(({ part, start: startOffset }, partIdx) => {
        const isMatch = part.toLowerCase() === query.toLowerCase();

        if (isMatch) {
          const globalIdx = matches.findIndex(
            (m) => m.lineIdx === lineIdx && m.charIdx === startOffset,
          );
          const isActive = globalIdx === activeMatchIdx;

          return (
            <mark
              key={partIdx}
              className={cn(
                "rounded-sm px-0.5 font-semibold",
                isActive
                  ? "bg-warning text-warning-foreground ring-2 ring-warning"
                  : "bg-yellow-200 dark:bg-yellow-800 text-foreground",
              )}
            >
              {part}
            </mark>
          );
        }
        return <span key={partIdx}>{part}</span>;
      })}
    </>
  );
}

function AttachmentDetailsModal({
  attachmentId,
  onClose,
}: {
  attachmentId: string | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<AttachmentMetadata | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  const [wrapLines, setWrapLines] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // All hooks must run unconditionally (rules of hooks)
  useEffect(() => {
    // Nothing to clear when there is no attachment: the render sites key this
    // component by id, so closing the modal unmounts this state rather than
    // asking the effect to reset it.
    if (!attachmentId) return;

    async function fetchDetails() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/v1/attachments/${attachmentId}`);
        if (!response.ok) {
          // The API answers failures in a standard envelope. Surfacing its
          // message separates a genuinely missing attachment (a link left
          // behind in a local draft after the record was deleted) from a
          // permission or connectivity problem - all three used to read as
          // the same unhelpful sentence.
          const envelope = (await response.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          throw new Error(
            envelope?.error?.message ??
              (response.status === 404
                ? "This attachment no longer exists."
                : `Could not retrieve file details (HTTP ${response.status}).`),
          );
        }
        const data = (await response.json()) as AttachmentMetadata;
        setMetadata(data);

        const isText =
          data.content_type.startsWith("text/") ||
          /\.(txt|py|js|ts|tsx|jsx|json|css|html|md|sh|yml|yaml|xml|ini|conf)$/i.test(
            data.filename,
          );
        if (isText) {
          setTextLoading(true);
          try {
            const res = await fetch(`/api/v1/attachments/${attachmentId}/content`);
            if (res.ok) setTextContent(await res.text());
          } catch (e) {
            console.error("Error reading file content", e);
          } finally {
            setTextLoading(false);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred.");
      } finally {
        setLoading(false);
      }
    }

    void fetchDetails();
  }, [attachmentId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    if (attachmentId) window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [attachmentId]);

  const lines = useMemo(
    () => (textContent !== null ? textContent.split(/\r?\n/) : []),
    [textContent],
  );

  const matches = useMemo(() => {
    if (!searchQuery || !textContent) return [];
    const queryLower = searchQuery.toLowerCase();
    const allMatches: { lineIdx: number; charIdx: number }[] = [];
    lines.forEach((line, lineIdx) => {
      let charIdx = line.toLowerCase().indexOf(queryLower);
      while (charIdx !== -1) {
        allMatches.push({ lineIdx, charIdx });
        charIdx = line.toLowerCase().indexOf(queryLower, charIdx + 1);
      }
    });
    return allMatches;
  }, [searchQuery, textContent, lines]);

  useEffect(() => {
    if (matches.length > 0 && matches[activeMatchIdx]) {
      const element = document.querySelector(
        `[data-line-idx="${matches[activeMatchIdx].lineIdx}"]`,
      );
      if (element) element.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeMatchIdx, matches]);

  // All hooks above — safe to do early return now
  if (!attachmentId) return null;

  const contentUrl = `/api/v1/attachments/${attachmentId}/content`;

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  };

  const isImage = metadata ? metadata.content_type.startsWith("image/") : false;
  const isPdf = metadata ? metadata.content_type === "application/pdf" : false;

  const handleSearchInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (matches.length === 0) return;
      if (event.shiftKey) {
        setActiveMatchIdx((prev) => (prev - 1 + matches.length) % matches.length);
      } else {
        setActiveMatchIdx((prev) => (prev + 1) % matches.length);
      }
    }
  };

  return (
    <Dialog open={!!attachmentId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent title="Attachment details" className="max-w-3xl">
        {loading ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2">
            <Loader2 className="text-muted-foreground size-8 animate-spin" />
            <p className="text-muted-foreground text-sm">Loading details...</p>
          </div>
        ) : error ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-danger">
            <p className="text-sm font-semibold">{error}</p>
            <Button variant="secondary" onClick={onClose}>Close</Button>
          </div>
        ) : metadata ? (
          <div className="space-y-4">
            {/* Compact details bar */}
            <div className="bg-surface-sunken flex flex-wrap gap-x-6 gap-y-2 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground">
              <div>
                <span className="font-semibold text-foreground">File: </span>
                <span className="break-all">{metadata.filename}</span>
              </div>
              <div>
                <span className="font-semibold text-foreground">Size: </span>
                <span>{formatSize(metadata.size_bytes)}</span>
              </div>
              <div>
                <span className="font-semibold text-foreground">Type: </span>
                <span>{metadata.content_type}</span>
              </div>
              <div>
                <span className="font-semibold text-foreground">Uploaded: </span>
                <span>{formatDate(metadata.created_at)}</span>
              </div>
            </div>

            <div className="border-border overflow-hidden rounded-lg border">
              <div className="bg-surface-sunken flex items-center justify-between border-b px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <span>Preview</span>
                {textContent !== null && (
                  <div className="flex items-center gap-3 normal-case tracking-normal">
                    <div className="flex items-center gap-1.5">
                      <div className="relative">
                        <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          ref={searchInputRef}
                          value={searchQuery}
                          onChange={(e) => {
                            setSearchQuery(e.target.value);
                            setActiveMatchIdx(0);
                          }}
                          onKeyDown={handleSearchInputKeyDown}
                          placeholder="Search content..."
                          className="h-7 w-40 pl-7 pr-2 text-xs"
                        />
                      </div>
                      {matches.length > 0 && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground select-none">
                          <span className="font-medium text-foreground">
                            {activeMatchIdx + 1}/{matches.length}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setActiveMatchIdx(
                                (prev) => (prev - 1 + matches.length) % matches.length,
                              )
                            }
                            className="hover:bg-surface-hover hover:text-foreground flex size-6 cursor-pointer items-center justify-center rounded transition-colors duration-150"
                            title="Previous match"
                          >
                            <ChevronDown className="size-4 rotate-180" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setActiveMatchIdx((prev) => (prev + 1) % matches.length)
                            }
                            className="hover:bg-surface-hover hover:text-foreground flex size-6 cursor-pointer items-center justify-center rounded transition-colors duration-150"
                            title="Next match"
                          >
                            <ChevronDown className="size-4" />
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setWrapLines((w) => !w)}
                      className={cn(
                        "hover:bg-surface-hover focus-visible:ring-ring flex size-7 cursor-pointer items-center justify-center rounded border border-transparent transition-all duration-150 focus-visible:ring-2 focus-visible:outline-none",
                        wrapLines
                          ? "bg-primary-subtle text-primary border-primary-subtle font-medium"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      title={wrapLines ? "Disable line wrapping" : "Enable line wrapping"}
                    >
                      <WrapText className="size-4" />
                    </button>
                  </div>
                )}
              </div>
              <div className="bg-surface flex items-center justify-center p-4 min-h-32 max-h-96 overflow-auto">
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={contentUrl}
                    alt={metadata.filename}
                    className="max-h-80 w-auto rounded border object-contain shadow-sm"
                  />
                ) : textContent !== null ? (
                  <div className="bg-surface-sunken border-border w-full overflow-auto rounded border font-mono text-xs max-h-80 select-text leading-relaxed">
                    {lines.map((line, idx) => (
                      <div
                        key={idx}
                        data-line-idx={idx}
                        className={cn(
                          "flex hover:bg-surface-hover/30",
                          matches[activeMatchIdx]?.lineIdx === idx &&
                            searchQuery &&
                            "bg-warning-subtle/20 hover:bg-warning-subtle/30",
                        )}
                      >
                        <span className="text-muted-foreground/60 w-12 shrink-0 border-r border-border pr-2.5 text-right select-none tabular-nums">
                          {idx + 1}
                        </span>
                        <span className={cn("pl-3", wrapLines ? "whitespace-pre-wrap break-all" : "")}>
                          <HighlightedText
                            text={line}
                            query={searchQuery}
                            lineIdx={idx}
                            activeMatchIdx={activeMatchIdx}
                            matches={matches}
                          />
                        </span>
                      </div>
                    ))}
                  </div>
                ) : textLoading ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-4">
                    <Loader2 className="text-muted-foreground size-5 animate-spin" />
                    <span className="text-muted-foreground text-xs">Loading content...</span>
                  </div>
                ) : isPdf ? (
                  <object
                    data={contentUrl}
                    type="application/pdf"
                    className="h-80 w-full rounded border"
                  >
                    <div className="text-center p-4">
                      <FileText className="text-muted-foreground mx-auto size-12" />
                      <p className="text-muted-foreground mt-2 text-sm">
                        Your browser cannot display this PDF inline.
                      </p>
                      <a
                        href={contentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline mt-1 inline-block text-sm"
                      >
                        Open the PDF in a new tab
                      </a>
                    </div>
                  </object>
                ) : (
                  <div className="text-center py-6">
                    <FileText className="text-muted-foreground mx-auto size-12" />
                    <p className="text-muted-foreground mt-2 text-sm">
                      No preview available for this file type.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={onClose}>
                Close
              </Button>
              <Button asChild>
                <a href={contentUrl} download={metadata.filename} className="gap-1.5">
                  <Download className="size-4" />
                  <span>Download</span>
                </a>
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
