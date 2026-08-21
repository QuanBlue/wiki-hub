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
// TaskList/TaskItem ship inside the same @tiptap/extension-list package
// StarterKit's BulletList/OrderedList already come from - no new dependency.
import { TaskList, TaskItem } from "@tiptap/extension-list";
// Pulled out of StarterKit (which is told blockquote: false below) only so
// its input rule can be re-keyed from "> " to Notion's '" ' - everything
// else (schema, commands, keyboard shortcuts) stays the stock extension.
import Blockquote from "@tiptap/extension-blockquote";
import {
  Extension,
  Node as TiptapNode,
  Mark,
  mergeAttributes,
  InputRule,
  wrappingInputRule,
} from "@tiptap/core";
import { NodeSelection, Plugin, TextSelection } from "@tiptap/pm/state";
import { Fragment, Slice } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
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
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
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
  ChevronRight,
  Code2,
  Crop,
  Ellipsis,
  FilePlus2,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  ImagePlus,
  Info,
  Italic,
  Lightbulb,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Palette,
  Paperclip,
  Pencil,
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
  LayoutGrid,
  ExternalLink,
  Copy,
  Unlink,
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

import { toast } from "sonner";

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
import { Input, inputClassName } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiError } from "@/lib/api-client";
import {
  CODE_LANGUAGES,
  codeLanguageForFilename,
  highlightToLines,
  lowlight,
  type CodeToken,
} from "@/lib/code-highlight";
import { cn } from "@/lib/utils";
import {
  SlashCommand,
  insertToggle,
  placeCursorInToggleSummary,
} from "@/components/pages/slash-command";
import type { WikiPage } from "@/types/api";

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

/** Language picker order: `CODE_LANGUAGES` insertion order, computed once. */
const CODE_LANGUAGE_ENTRIES = Object.entries(CODE_LANGUAGES);

/**
 * Static rendition of a code block for the details modal - the same
 * header/gutter/colours as the real `.wikihub-code` block, but built from
 * plain `CodeToken`s instead of a ProseMirror node view, so it can show the
 * caption and language a person is still drafting before they hit Save.
 */
function CodeBlockPreview({
  caption,
  languageLabel,
  lines,
  tokenLines,
}: {
  caption: string;
  languageLabel: string;
  lines: number[];
  tokenLines: CodeToken[][];
}) {
  const showHeader = Boolean(caption) || Boolean(languageLabel);

  return (
    <div className="wikihub-code border-code-border bg-code-bg flex h-full flex-col overflow-hidden rounded-md border">
      {showHeader ? (
        <div className="border-code-border bg-code-inset flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3">
          {caption ? (
            <span className="text-code-muted min-w-0 flex-1 truncate font-mono text-xs">
              {caption}
            </span>
          ) : (
            <span aria-hidden className="flex-1" />
          )}
          {languageLabel ? (
            <span className="text-code-muted shrink-0 font-mono text-xs">
              {languageLabel}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 overflow-auto">
        <div className="border-code-border bg-code-inset text-code-muted sticky left-0 border-r px-3 py-4 text-right font-mono text-xs !leading-6 select-none">
          {lines.map((line) => (
            <div key={line} className="h-6">
              {line}
            </div>
          ))}
        </div>
        <pre className="!my-0 flex-1 !border-0 !bg-transparent !p-4 font-mono text-xs !leading-6">
          <code className="!m-0 !block bg-transparent !p-0 !font-mono !text-xs !leading-6 whitespace-pre">
            {tokenLines.map((tokens, lineIdx) => (
              <div key={lineIdx} className="h-6">
                {tokens.length ? (
                  tokens.map((token, tokenIdx) => (
                    <span
                      key={tokenIdx}
                      className={token.className ?? undefined}
                    >
                      {token.text}
                    </span>
                  ))
                ) : (
                  <>&nbsp;</>
                )}
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

function CodeBlockWithLines({
  editor,
  node,
  updateAttributes,
  deleteNode,
}: NodeViewProps) {
  let text = node.textContent || "";
  if (text.endsWith("\n")) {
    text = text.slice(0, -1);
  }
  const lineCount = text.split("\n").length;
  const lines = Array.from({ length: Math.max(1, lineCount) }, (_, i) => i + 1);
  const language: string = node.attrs.language || "";
  const canEdit = editor.isEditable;

  const caption = String(node.attrs.caption ?? "");
  // Title and language are edited together in a modal rather than inline in
  // the header bar - a bare text input sitting right above a code block was
  // too easy to mistake for the first line of the snippet and type into by
  // accident. The modal is a Radix dialog portaled to document.body, well
  // outside ProseMirror's contentEditable DOM, so unlike an inline input
  // nothing typed there can be reinterpreted as a document command.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [captionDraft, setCaptionDraft] = useState(caption);
  const [languageDraft, setLanguageDraft] = useState(language || "plaintext");

  function openDetails() {
    setCaptionDraft(caption);
    setLanguageDraft(language || "plaintext");
    setDetailsOpen(true);
  }

  function saveDetails() {
    const trimmed = captionDraft.trim();
    updateAttributes({ caption: trimmed || null, language: languageDraft });
    setDetailsOpen(false);
  }

  const languageLabel = language ? (CODE_LANGUAGES[language] ?? language) : "";
  const showHeader = canEdit || Boolean(caption) || Boolean(language);

  // Live preview inside the details modal: the block's own text, tokenised
  // for whatever language is currently drafted (not yet saved), so choosing
  // a language shows its actual colours before committing to it.
  const previewTokenLines = useMemo(
    () => highlightToLines(text, detailsOpen ? languageDraft : language),
    [text, languageDraft, detailsOpen, language],
  );

  return (
    <NodeViewWrapper className="wikihub-code group border-code-border bg-code-bg relative my-4 flex flex-col overflow-hidden rounded-md border">
      {showHeader ? (
        <div
          contentEditable={false}
          className="border-code-border bg-code-inset flex h-9 items-center justify-between gap-2 border-b px-3"
        >
          {caption ? (
            <span className="text-code-muted min-w-0 flex-1 truncate font-mono text-xs">
              {caption}
            </span>
          ) : (
            <span aria-hidden className="flex-1" />
          )}

          <div className="flex shrink-0 items-center gap-1">
            {languageLabel ? (
              <span className="text-code-muted font-mono text-xs">
                {languageLabel}
              </span>
            ) : null}
            {canEdit ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Code block options"
                    title="Code block options"
                    className="text-code-muted hover:bg-code-border hover:text-code-fg focus-visible:ring-ring flex size-6 shrink-0 cursor-pointer items-center justify-center rounded transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <Ellipsis className="size-3.5" aria-hidden />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={openDetails} className="gap-2">
                    <Pencil className="size-4" aria-hidden />
                    Edit title &amp; language
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={deleteNode}
                    destructive
                    className="gap-2"
                  >
                    <Trash2 className="size-4" aria-hidden />
                    Delete code block
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      ) : null}
      {canEdit ? (
        <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
          <DialogContent
            title="Code block details"
            description="Give this code block a title and choose its language for syntax colours."
            className="max-w-5xl"
          >
            <div className="flex flex-col gap-6 sm:flex-row">
              <div className="space-y-5 sm:w-56 sm:shrink-0">
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="code-caption">
                    Title
                  </label>
                  <Input
                    id="code-caption"
                    value={captionDraft}
                    onChange={(event) => setCaptionDraft(event.target.value)}
                    placeholder="e.g. deploy.sh"
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <label
                    className="text-sm font-medium"
                    htmlFor="code-language"
                  >
                    Language
                  </label>
                  <Select
                    value={languageDraft}
                    onValueChange={setLanguageDraft}
                  >
                    <SelectTrigger
                      id="code-language"
                      aria-label="Code language"
                    >
                      <SelectValue>
                        {CODE_LANGUAGES[languageDraft] ?? languageDraft}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="max-h-72 overflow-y-auto">
                      {CODE_LANGUAGE_ENTRIES.map(([key, label]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <span className="text-sm font-medium">Preview</span>
                <div className="h-[28rem]">
                  <CodeBlockPreview
                    caption={captionDraft.trim()}
                    languageLabel={
                      CODE_LANGUAGES[languageDraft] ?? languageDraft
                    }
                    lines={lines}
                    tokenLines={previewTokenLines}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setDetailsOpen(false)}
              >
                Cancel
              </Button>
              <Button type="button" variant="primary" onClick={saveDetails}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      <div className="flex">
        <div className="border-code-border bg-code-inset text-code-muted border-r px-3 py-4 text-right font-mono text-xs !leading-6 select-none">
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
      </div>
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

/**
 * The toggle/collapsible block. Its two children (toggleSummary,
 * toggleContent - see CustomToggleSummaryNode/CustomToggleContentNode below)
 * have no node views of their own and render via plain parseHTML/renderHTML,
 * so this is the only node view in the trio. `open` lives solely on this
 * (parent) node - toggleContent stays mounted in the document either way and
 * is only ever hidden with CSS, so nothing typed while collapsed is ever
 * lost, and there's no cross-node attribute write to keep in sync.
 */
function ToggleComponent({ node, updateAttributes }: NodeViewProps) {
  const open = node.attrs.open !== false;

  return (
    <NodeViewWrapper className="my-1">
      <div className="flex items-start gap-1">
        <button
          type="button"
          aria-label={open ? "Collapse toggle" : "Expand toggle"}
          aria-expanded={open}
          contentEditable={false}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => updateAttributes({ open: !open })}
          className="text-muted-foreground hover:bg-surface-hover hover:text-foreground mt-0.5 flex size-5 shrink-0 items-center justify-center rounded transition-colors duration-150"
        >
          <ChevronRight
            className={cn(
              "size-4 transition-transform duration-150",
              open && "rotate-90",
            )}
          />
        </button>
        <div
          className={cn(
            "min-w-0 flex-1 [&_[data-type='toggle-summary']]:font-medium [&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
            !open && "[&_[data-type='toggle-content']]:hidden",
          )}
        >
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

/**
 * How far in from either side of an image a pointer press starts a resize.
 * The visible grab bars sit inside this band, and the transparent side
 * handles - which carry the resize cursor - are drawn exactly this wide, so
 * what the cursor promises and what the hit test accepts stay the same thing.
 */
const IMAGE_RESIZE_EDGE_SIZE = 20;

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
    className: "-top-3 -left-3 cursor-nwse-resize size-8",
    markerClassName: "h-px w-3 -rotate-45 bg-primary",
  },
  {
    handle: "n",
    label: "Resize image from top",
    className: "-top-3 left-1/2 -translate-x-1/2 cursor-ns-resize size-8",
    markerClassName: "h-px w-5 bg-primary",
  },
  {
    handle: "ne",
    label: "Resize image from top right",
    className: "-top-3 -right-3 cursor-nesw-resize size-8",
    markerClassName: "h-px w-3 rotate-45 bg-primary",
  },
  {
    handle: "e",
    label: "Resize image from right",
    className: "inset-y-0 right-0 cursor-ew-resize",
    markerClassName: "h-5 w-px bg-primary",
  },
  {
    handle: "se",
    label: "Resize image",
    className: "-right-3 -bottom-3 cursor-nwse-resize size-8",
    markerClassName: "h-px w-3 -rotate-45 bg-primary",
  },
  {
    handle: "s",
    label: "Resize image from bottom",
    className: "-bottom-3 left-1/2 -translate-x-1/2 cursor-ns-resize size-8",
    markerClassName: "h-px w-5 bg-primary",
  },
  {
    handle: "sw",
    label: "Resize image from bottom left",
    className: "-bottom-3 -left-3 cursor-nesw-resize size-8",
    markerClassName: "h-px w-3 rotate-45 bg-primary",
  },
  {
    handle: "w",
    label: "Resize image from left",
    className: "inset-y-0 left-0 cursor-ew-resize",
    markerClassName: "h-5 w-px bg-primary",
  },
];

/**
 * Trims the float noise out of a value on its way into a style attribute.
 * 100 / 0.3 is 333.33333333333337 in binary floating point, which is both
 * unreadable in the DOM and awkward to assert on.
 */
function roundForCss(value: number) {
  return Number(value.toFixed(4));
}

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
  // The visible crop's own aspect ratio: the selected fraction of the source,
  // in the source's proportions. Everything about the cropped frame is laid
  // out from this ratio and relative units, so the frame can shrink with its
  // container - a fixed pixel height would keep the frame at its original size
  // and let the page clip whatever no longer fits.
  const croppedAspectRatio =
    crop && crop.height > 0
      ? roundForCss((crop.width / crop.height) * imageAspectRatio)
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

  // Hover is tracked on the figure alone. The toolbar sits inside it, so
  // moving between the two never leaves the figure - but a mouseleave on the
  // toolbar itself would fire on the way back to the image and hide the tools
  // the pointer is still over, with no matching mouseenter to bring them back.
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
    const edgeSize = IMAGE_RESIZE_EDGE_SIZE;
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
      new CustomEvent("wikihub:internal-node-drag-start", {
        bubbles: true,
        detail: { pos: position },
      }),
    );
  }

  function finishImageMove(event: React.DragEvent<HTMLDivElement>) {
    event.currentTarget.dispatchEvent(
      new CustomEvent("wikihub:internal-node-drag-end", { bubbles: true }),
    );
  }

  return (
    <NodeViewWrapper
      as="figure"
      className={cn(
        "group/image relative my-4 block w-fit max-w-full align-top",
        showImageTools &&
          "before:bg-border-strong after:bg-border-strong before:pointer-events-none before:absolute before:top-1/3 before:bottom-1/3 before:left-1 before:z-20 before:w-1.5 before:rounded-full after:pointer-events-none after:absolute after:top-1/3 after:right-1 after:bottom-1/3 after:z-20 after:w-1.5 after:rounded-full",
      )}
      contentEditable={false}
      // Read by the wrapper rule in globals.css, which is the element that
      // actually has room to move.
      data-alignment={alignment}
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
                // A definite pixel width keeps the frame at the size the crop
                // was saved at, while max-width lets it shrink with a narrower
                // column the way an uncropped image does. Percentages here
                // would be circular - the figure is shrink-to-fit around this
                // very element - and collapse the frame to nothing.
                width: croppedDisplayWidth
                  ? `${croppedDisplayWidth}px`
                  : undefined,
                maxWidth: "100%",
                // The height follows from the ratio, so shrinking keeps both
                // the proportions and the selected region.
                aspectRatio: croppedAspectRatio
                  ? String(croppedAspectRatio)
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
                  // Prose styles give images a vertical margin. On an
                  // absolutely positioned box that margin is added to the
                  // offsets below, sliding the source image down by a fixed
                  // number of pixels while its height scales with the frame -
                  // so the visible slice drifts as the image is resized.
                  margin: 0,
                  // Every dimension is a share of the frame, so the source
                  // rectangle scales with it and the selected region stays
                  // put whatever size the frame ends up.
                  width: `${roundForCss(100 / crop.width)}%`,
                  height: `${roundForCss(100 / crop.height)}%`,
                  maxWidth: "none",
                  left: `${roundForCss((-crop.x / crop.width) * 100)}%`,
                  top: `${roundForCss((-crop.y / crop.height) * 100)}%`,
                }
              : displayWidth
                ? { width: `${displayWidth}px`, maxWidth: "100%" }
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
          {/* Floats above the image so it covers none of it. The wrapper's
              bottom padding is what puts the visible gap there: an actual gap
              would be a strip of neither figure nor toolbar, and crossing it
              would count as leaving the image. */}
          <div className="absolute right-0 bottom-full z-20 pb-1">
            <div
              className="border-border bg-surface-raised/95 flex h-9 items-center gap-0.5 rounded-md border p-1 shadow-md backdrop-blur-sm"
              role="toolbar"
              aria-label="Image options"
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
                aria-pressed={Boolean(node.attrs.caption)}
                className={cn(
                  "hover:bg-surface-hover focus-visible:ring-ring text-muted-foreground flex size-7 cursor-pointer items-center justify-center rounded transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                  node.attrs.caption && "bg-surface-selected text-primary",
                )}
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
                  const match = src.match(
                    /\/api\/v1\/attachments\/([a-f0-9-]{36})/i,
                  );
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
                <Button type="button" variant="primary" onClick={saveCaption}>
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
                // Sits under the options toolbar (z-20) so the buttons in it
                // stay clickable on a short image.
                className={cn(
                  "focus-visible:ring-ring absolute z-10 flex touch-none items-center justify-center bg-transparent select-none focus-visible:ring-2 focus-visible:outline-none",
                  className,
                )}
                style={{ width: IMAGE_RESIZE_EDGE_SIZE }}
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

// Notion's own markdown shortcuts use '" ' for Quote and '> ' for Toggle
// list, the opposite of Blockquote's stock '> ' input rule - re-key it here
// rather than in a second place, so there is exactly one source of truth for
// what triggers a blockquote.
const CustomBlockquote = Blockquote.extend({
  addInputRules() {
    return [
      wrappingInputRule({
        find: /^\s*"\s$/,
        type: this.type,
      }),
    ];
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

// The toggle/collapsible block. No official @tiptap/extension-details
// install here: its companion -summary/-content packages are only published
// for Tiptap v2 (peer dep ^2.7.0, incompatible with the v3 core this app
// runs) or as an unreleased v3 beta (peer dep pinned to that exact beta) -
// installing either would be unsafe. This is a small hand-rolled
// equivalent, same three-node shape, following the same
// TiptapNode.create()/ReactNodeViewRenderer pattern as CustomCalloutNode
// above.
const CustomToggleSummaryNode = TiptapNode.create({
  name: "toggleSummary",
  content: "inline*",
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="toggle-summary"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "toggle-summary" }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {
      // The parent toggle's content expression is exactly "toggleSummary
      // toggleContent" (one of each, no repeats), so the default Enter
      // (splitBlock, which would try to create a second toggleSummary
      // sibling) is schema-invalid here. Move into the body instead - the
      // same "Enter escapes this node" idea TaskItem's own Enter override
      // already uses.
      Enter: () =>
        this.editor.commands.command(({ tr, dispatch, state }) => {
          const { $from } = state.selection;
          if ($from.parent.type.name !== this.name) return false;
          const toggleDepth = $from.depth - 1;
          if (toggleDepth < 0) return false;
          const toggleNode = $from.node(toggleDepth);
          const summaryNode = toggleNode?.firstChild;
          if (toggleNode?.type.name !== "toggle" || !summaryNode) return false;
          const toggleStart = $from.before(toggleDepth);
          const contentStart = toggleStart + 1 + summaryNode.nodeSize + 1;
          if (dispatch) {
            tr.setSelection(
              TextSelection.near(tr.doc.resolve(contentStart), 1),
            );
          }
          return true;
        }),
      // Backspace at the very start of the title line used to be a dead
      // end: ProseMirror's default joinBackward doesn't know how to merge
      // a fixed "toggleSummary toggleContent" shape into whatever comes
      // before it, so the toggle was stuck - no keyboard way to remove one.
      // Unwrap instead: the title becomes a plain paragraph, the body's own
      // blocks (if any) follow it, and an empty toggle collapses to exactly
      // the one empty paragraph you'd expect Backspace to leave behind.
      Backspace: () =>
        this.editor.commands.command(({ tr, dispatch, state }) => {
          const { $from, empty } = state.selection;
          if (!empty || $from.parent.type.name !== this.name) return false;
          if ($from.parentOffset !== 0) return false;
          const toggleDepth = $from.depth - 1;
          if (toggleDepth < 0) return false;
          const toggleNode = $from.node(toggleDepth);
          if (toggleNode?.type.name !== "toggle") return false;
          const summaryNode = toggleNode.firstChild;
          const contentNode = toggleNode.lastChild;
          if (!summaryNode || !contentNode) return false;

          if (dispatch) {
            const toggleStart = $from.before(toggleDepth);
            const toggleEnd = toggleStart + toggleNode.nodeSize;
            const contentIsEmpty =
              contentNode.childCount === 0 ||
              (contentNode.childCount === 1 &&
                contentNode.firstChild?.isTextblock &&
                contentNode.firstChild.content.size === 0);
            const replacement = Fragment.fromArray([
              state.schema.nodes.paragraph.create(null, summaryNode.content),
              ...(contentIsEmpty ? [] : contentNode.content.content),
            ]);
            tr.replaceWith(toggleStart, toggleEnd, replacement);
            tr.setSelection(
              TextSelection.near(tr.doc.resolve(toggleStart + 1), 1),
            );
          }
          return true;
        }),
    };
  },
});

const CustomToggleContentNode = TiptapNode.create({
  name: "toggleContent",
  content: "block+",
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="toggle-content"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "toggle-content" }),
      0,
    ];
  },
});

const CustomToggleNode = TiptapNode.create({
  name: "toggle",
  group: "block",
  content: "toggleSummary toggleContent",
  defining: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-open") !== "false",
        renderHTML: (attributes: { open: boolean }) => ({
          "data-open": String(attributes.open),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="toggle"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "toggle" }),
      0,
    ];
  },

  addInputRules() {
    // Not a wrappingInputRule: toggle's content is a fixed two-node
    // sequence (a summary, then a content block), not a plain "wrap this
    // paragraph" shape wrappingInputRule can build - so this builds the
    // same {toggleSummary, toggleContent} shape insertToggle() in
    // slash-command.tsx inserts, just triggered by typing instead of
    // picking it from the menu.
    return [
      new InputRule({
        find: /^\s*>\s$/,
        handler: ({ chain, range }) => {
          // Same "land in the empty title, not the body" fix insertToggle()
          // in slash-command.tsx needs - see placeCursorInToggleSummary's
          // own comment for why this can't just be a hardcoded offset from
          // range.from.
          chain()
            .deleteRange(range)
            .insertContent({
              type: "toggle",
              attrs: { open: true },
              content: [
                { type: "toggleSummary" },
                { type: "toggleContent", content: [{ type: "paragraph" }] },
              ],
            })
            .command(({ tr, dispatch }) =>
              placeCursorInToggleSummary(tr, dispatch, range.from),
            )
            .run();
        },
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleComponent);
  },
});

const CustomCodeBlock = CodeBlockLowlight.extend({
  addAttributes() {
    const parentAttributes = (this.parent?.() ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    return {
      ...parentAttributes,
      // A block with no language chosen must stay genuinely unset - no
      // `language-plaintext` class - so an untouched or freshly typed
      // snippet round-trips exactly as it always has. `defaultLanguage:
      // "plaintext"` (configured below) is read only by the highlighting
      // plugin, as the fallback that keeps that same falsy language
      // monochrome instead of guessing it from the text.
      language: {
        ...parentAttributes.language,
        default: null,
      },
      caption: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-caption"),
        renderHTML: (attributes: { caption?: string | null }) =>
          attributes.caption ? { "data-caption": attributes.caption } : {},
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockWithLines);
  },
  addKeyboardShortcuts() {
    return {
      // Selecting the whole document from inside a long snippet is rarely
      // what someone wants - scope Ctrl/Cmd-A to just this block's code
      // first. Falls through to the editor's normal select-all (returns
      // false) whenever the cursor isn't inside a code block at all.
      "Mod-a": () => {
        const { $from } = this.editor.state.selection;
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          if ($from.node(depth).type === this.type) {
            return this.editor.commands.setTextSelection({
              from: $from.start(depth),
              to: $from.end(depth),
            });
          }
        }
        return false;
      },
    };
  },
});

/**
 * A code block (or any node that isn't a paragraph) sitting first in the
 * document leaves no position "above" it for a cursor to land on - position
 * 0 is before the node structurally, but a leaf-content node like a code
 * block only accepts a cursor from position 1 onward, inside its own text.
 * A page that starts with a code block could otherwise never gain a line
 * above it. Pressing Up from that first position, or clicking in the blank
 * margin above the first node, opens one instead.
 */
const LeadingParagraph = Extension.create({
  name: "leadingParagraph",
  addProseMirrorPlugins() {
    const editor = this.editor;
    function insertLeadingParagraph(view: EditorView) {
      const firstChild = view.state.doc.firstChild;
      if (!firstChild || firstChild.type.name === "paragraph") return false;
      const paragraph = view.state.schema.nodes.paragraph.create();
      const tr = view.state.tr.insert(0, paragraph);
      view.dispatch(
        tr.setSelection(TextSelection.create(tr.doc, 1)).scrollIntoView(),
      );
      return true;
    }
    return [
      new Plugin({
        props: {
          handleKeyDown(view, event) {
            if (
              event.key !== "ArrowUp" ||
              !editor.isEditable ||
              !view.state.selection.empty ||
              view.state.selection.$from.pos !== 1
            ) {
              return false;
            }
            return insertLeadingParagraph(view);
          },
          handleClick(view, _pos, event) {
            if (!editor.isEditable) return false;
            const firstNodeDom = view.nodeDOM(0);
            if (!(firstNodeDom instanceof HTMLElement)) return false;
            if (event.clientY >= firstNodeDom.getBoundingClientRect().top) {
              return false;
            }
            return insertLeadingParagraph(view);
          },
        },
      }),
    ];
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

/**
 * The attachment a link points at, or null for anything else.
 *
 * While a page is being edited the tile carries no href at all - see
 * AttachmentTile for why - so the target is read from a data attribute too.
 */
function attachmentIdFromLink(link: Element) {
  const target =
    link.getAttribute("href") ||
    link.getAttribute("data-attachment-href") ||
    "";
  return target.match(/\/api\/v1\/attachments\/([a-f0-9-]{36})/i)?.[1] ?? null;
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
function AttachmentTile({
  node,
  getPos,
  selected,
  editor,
  updateAttributes,
  deleteNode,
}: NodeViewProps) {
  const filename = String(node.attrs.filename ?? "attachment");
  const href = String(node.attrs.href ?? "");
  const displayMode = String(node.attrs.displayMode ?? "card");
  const [hovered, setHovered] = useState(false);
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);
  const icon = attachmentIcon(filename);

  const isCard = displayMode !== "link";
  const showToolbar = editor.isEditable && (selected || hovered);

  const keepToolsVisible = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setHovered(true);
  }, []);

  const scheduleToolsHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setHovered(false), 250);
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  function handleSelectNode(e?: React.MouseEvent) {
    if (!editor.isEditable) return;
    e?.preventDefault();
    e?.stopPropagation();
    if (typeof getPos === "function") {
      const pos = getPos();
      if (typeof pos === "number") {
        editor.commands.setNodeSelection(pos);
      }
    }
  }

  // Same machinery images use. Tiptap's node view hides dragstart from
  // ProseMirror, so the editor's own handleDrop has to be told which node is
  // moving; without this the tile would be copied on drop, not moved.
  function beginMove(event: React.DragEvent<HTMLElement>) {
    if (!editor.isEditable) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.dropEffect = "move";
    event.currentTarget.dispatchEvent(
      new CustomEvent("wikihub:internal-node-drag-start", {
        bubbles: true,
        detail: { pos: typeof getPos === "function" ? getPos() : undefined },
      }),
    );
  }

  function endMove(event: React.DragEvent<HTMLElement>) {
    event.currentTarget.dispatchEvent(
      new CustomEvent("wikihub:internal-node-drag-end", { bubbles: true }),
    );
  }

  function handleOpenDetails(e?: React.MouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    const match = href.match(/\/api\/v1\/attachments\/([a-f0-9-]{36})/i)?.[1];
    if (match) {
      const event = new CustomEvent("wikihub:open-attachment-modal", {
        bubbles: true,
        detail: { attachmentId: match },
      });
      window.dispatchEvent(event);
    }
  }

  const floatingToolbar = showToolbar ? (
    <div
      className={cn(
        "absolute z-50 flex items-center gap-1 rounded-lg border border-border bg-surface-raised p-1 shadow-lg text-xs whitespace-nowrap animate-in fade-in zoom-in-95 duration-100 select-none bottom-full mb-1.5 left-0 min-w-max after:absolute after:top-full after:left-0 after:right-0 after:h-2 after:content-['']",
      )}
      contentEditable={false}
      onMouseEnter={keepToolsVisible}
      onMouseLeave={scheduleToolsHide}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center rounded-md bg-surface-sunken/80 p-0.5 border border-border/50">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            updateAttributes({ displayMode: "card" });
          }}
          className={cn(
            "px-2 py-0.5 rounded text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer",
            isCard
              ? "bg-primary text-primary-foreground shadow-2xs"
              : "text-muted-foreground hover:text-foreground hover:bg-surface-raised",
          )}
          title="Display as Card"
        >
          <LayoutGrid className="size-3" />
          <span>Card</span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            updateAttributes({ displayMode: "link" });
          }}
          className={cn(
            "px-2 py-0.5 rounded text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer",
            !isCard
              ? "bg-primary text-primary-foreground shadow-2xs"
              : "text-muted-foreground hover:text-foreground hover:bg-surface-raised",
          )}
          title="Display as Link"
        >
          <Link2 className="size-3" />
          <span>Link</span>
        </button>
      </div>

      <div className="h-3.5 w-px bg-border mx-0.5" />

      <button
        type="button"
        onClick={handleOpenDetails}
        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-surface-sunken transition-colors cursor-pointer"
        title="View file details and preview"
      >
        <Info className="size-3.5" />
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const a = document.createElement("a");
          a.href = href;
          a.download = filename;
          a.target = "_blank";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }}
        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-surface-sunken transition-colors flex items-center justify-center cursor-pointer"
        title="Download file"
      >
        <Download className="size-3.5" />
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          deleteNode();
        }}
        className="p-1 rounded text-red-500 hover:text-red-600 hover:bg-red-500/10 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-500/20 transition-colors cursor-pointer"
        title="Remove attachment"
      >
        <Trash2 className="size-3.5 text-red-500 dark:text-red-400" />
      </button>
    </div>
  ) : null;

  if (!isCard) {
    return (
      <NodeViewWrapper
        as="span"
        className="relative inline-block align-baseline mr-1.5 my-0.5 group/attachment-wrapper"
        onDragStartCapture={beginMove}
        onDragEndCapture={endMove}
        onMouseEnter={keepToolsVisible}
        onMouseLeave={scheduleToolsHide}
      >
        {floatingToolbar}
        <a
          href={editor.isEditable ? undefined : href}
          data-attachment-href={href}
          data-display-mode="link"
          title={filename}
          target="_self"
          role={editor.isEditable ? "button" : undefined}
          tabIndex={editor.isEditable ? 0 : undefined}
          onClick={handleSelectNode}
          onKeyDown={(event) => {
            if (!editor.isEditable) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleSelectNode();
            }
          }}
          contentEditable={false}
          draggable={editor.isEditable}
          className={cn(
            "attachment-link inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-border bg-surface-raised text-primary text-xs font-medium !no-underline shadow-2xs hover:bg-surface-sunken hover:border-primary/50 transition-colors align-baseline",
            editor.isEditable
              ? "cursor-grab active:cursor-grabbing"
              : "cursor-pointer",
            selected && "border-primary ring-primary/40 ring-2",
          )}
        >
          <span className="text-muted-foreground shrink-0 size-3.5 flex items-center justify-center">
            <Paperclip className="size-3" />
          </span>
          <span className="truncate max-w-[260px]">{filename}</span>
        </a>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="span"
      className="relative mr-2 mb-2 inline-block align-top group/attachment-wrapper"
      onDragStartCapture={beginMove}
      onDragEndCapture={endMove}
      onMouseEnter={keepToolsVisible}
      onMouseLeave={scheduleToolsHide}
    >
      {floatingToolbar}
      <a
        href={editor.isEditable ? undefined : href}
        data-attachment-href={href}
        data-display-mode="card"
        title={filename}
        target="_self"
        role={editor.isEditable ? "button" : undefined}
        tabIndex={editor.isEditable ? 0 : undefined}
        onClick={handleSelectNode}
        onKeyDown={(event) => {
          if (!editor.isEditable) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleSelectNode();
          }
        }}
        contentEditable={false}
        draggable={editor.isEditable}
        className={cn(
          "group/attachment border-border bg-surface-raised hover:border-primary focus-visible:ring-ring flex w-24 flex-col items-center gap-1.5 rounded-md border p-2 !no-underline shadow-sm transition-colors focus-visible:ring-2 focus-visible:outline-none",
          editor.isEditable
            ? "cursor-grab active:cursor-grabbing"
            : "cursor-pointer",
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
  draggable: true,

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
      displayMode: {
        default: "card",
        parseHTML: (element) =>
          element.getAttribute("data-display-mode") ||
          (element.classList.contains("attachment-link") ? "link" : "card"),
      },
    };
  },

  parseHTML() {
    // Priority has to clear the Link mark's, or an attachment would be parsed
    // as ordinary linked text before this rule is ever consulted.
    return [
      {
        tag: "a[data-attachment]",
        priority: 1100,
        getAttrs: (element) => {
          const el = element as HTMLElement;
          return {
            href: el.getAttribute("href"),
            filename:
              el.getAttribute("data-attachment") ||
              el.textContent?.trim() ||
              "attachment",
            displayMode:
              el.getAttribute("data-display-mode") ||
              (el.classList.contains("attachment-link") ? "link" : "card"),
          };
        },
      },
      {
        // Pages written before this node existed - and everything imported
        // from Confluence, whose view-file macro becomes a bare <a> - carry no
        // marker attribute. Recognise them by their href, but only when the
        // link text reads as a filename: that leaves a deliberate inline link
        // to an attachment inside a sentence looking like a link.
        tag: "a[href]",
        priority: 1100,
        getAttrs: (element) => {
          const el = element as HTMLElement;
          const href = el.getAttribute("href") ?? "";
          if (!ATTACHMENT_HREF.test(href)) return false;
          const text = el.textContent?.trim() ?? "";
          if (!FILENAME_EXTENSION.test(text)) return false;
          return {
            href,
            filename: text,
            displayMode: el.classList.contains("attachment-link")
              ? "link"
              : "card",
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const filename = String(node.attrs.filename ?? "attachment");
    const displayMode = String(node.attrs.displayMode ?? "card");
    return [
      "a",
      mergeAttributes({
        href: node.attrs.href,
        title: filename,
        target: "_self",
        "data-attachment": filename,
        "data-display-mode": displayMode,
        class:
          displayMode === "link"
            ? "attachment-link inline-flex items-center gap-1 text-primary hover:underline font-medium text-xs align-baseline"
            : undefined,
      }),
      filename,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AttachmentTile);
  },
});

/**
 * Node types whose node view starts a drag through the custom move machinery.
 * Both hide `dragstart` from ProseMirror behind a node view, so both need the
 * drop to be owned rather than left to ProseMirror's external-drop path.
 */
const DRAGGABLE_NODE_TYPES = new Set(["image", "attachment"]);
const editorExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3, 4] },
    codeBlock: false,
    blockquote: false,
    // The stock drop cursor draws a rule across the whole block, which reads
    // like a horizontal divider rather than an insertion point. Styled down to
    // a caret in globals.css; the colour comes from there too.
    dropcursor: { class: "wikihub-dropcursor", width: 2, color: false },
  }),
  CustomCodeBlock.configure({
    lowlight,
    // Also read by the LowlightPlugin's decoration pass as the fallback for
    // any block with a falsy language, so an untouched block stays
    // monochrome instead of `highlightAuto()` guessing its language.
    defaultLanguage: "plaintext",
  }),
  CustomBlockquote,
  LeadingParagraph,
  SlashCommand,
  CustomCalloutNode,
  CustomToggleSummaryNode,
  CustomToggleContentNode,
  CustomToggleNode,
  TaskList.configure({ HTMLAttributes: { class: "wikihub-task-list" } }),
  TaskItem.configure({ nested: true }),
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

const headingLevels = [1, 2, 3, 4] as const;

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
  "[&_h4]:mt-4 [&_h4]:mb-1.5 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:leading-tight " +
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-0.5 " +
  // Task list: no bullet marker, checkbox instead, styled to match the raw
  // checkbox convention already used across the admin screens. TaskItem
  // ships its own vanilla node view for the live editing DOM, which never
  // carries the "data-type" it puts on serialized HTML - but it always sets
  // data-checked (both live and serialized), so that's the selector that
  // actually matches in both places.
  // The content <div> next to the checkbox has no intrinsic width of its
  // own (an empty paragraph is near-0px wide), so as a flex sibling it
  // shrank to nothing and hid the caret with it - flex-1 + min-w-0 makes it
  // claim the rest of the row like every other flex-text-column in this app.
  "[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0 [&_li[data-checked]]:flex [&_li[data-checked]]:items-start [&_li[data-checked]]:gap-2 [&_li[data-checked]>label]:mt-1 [&_li[data-checked]>label]:flex-shrink-0 [&_li[data-checked]>div]:min-w-0 [&_li[data-checked]>div]:flex-1 " +
  "[&_li[data-checked]>label>input[type=checkbox]]:accent-primary [&_li[data-checked]>label>input[type=checkbox]]:size-4 [&_li[data-checked]>label>input[type=checkbox]]:cursor-pointer [&_li[data-checked]>label>input[type=checkbox]]:rounded " +
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
  "[&_h4]:mt-4 [&_h4]:mb-1.5 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:leading-tight " +
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-primary/50 [&_a]:transition-colors [&_a]:duration-150 [&_a:hover]:text-primary-hover [&_a:hover]:decoration-primary " +
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-0.5 " +
  "[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0 [&_li[data-checked]]:flex [&_li[data-checked]]:items-start [&_li[data-checked]]:gap-2 [&_li[data-checked]>label]:mt-1 [&_li[data-checked]>label]:flex-shrink-0 [&_li[data-checked]>div]:min-w-0 [&_li[data-checked]>div]:flex-1 " +
  "[&_li[data-checked]>label>input[type=checkbox]]:accent-primary [&_li[data-checked]>label>input[type=checkbox]]:size-4 [&_li[data-checked]>label>input[type=checkbox]]:rounded [&_li[data-checked]>label>input[type=checkbox]]:pointer-events-none " +
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
        <DropdownMenuItem
          onSelect={() =>
            editor?.chain().focus().setHeading({ level: 4 }).run()
          }
        >
          <Heading4 />
          Heading 4
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
        destructive &&
          "text-danger hover:bg-danger-bg hover:text-danger active:bg-danger-bg/85",
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
          document.activeElement?.closest("[data-radix-menu-content]") !==
            null ||
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
                  const selected =
                    row <= hoveredTable.rows && col <= hoveredTable.cols;
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
                      onPointerEnter={() =>
                        setHoveredTable({ rows: row, cols: col })
                      }
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
            className="text-danger hover:bg-danger-bg hover:text-danger active:bg-danger-bg/85 h-8 gap-1.5 px-2"
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

function LinkFloatingToolbar({
  editor,
  onEditLink,
}: {
  editor: Editor | null;
  onEditLink: (linkData?: {
    href: string;
    text: string;
    title: string;
    target: string;
  }) => void;
}) {
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    href: string;
    text: string;
    title: string;
    target: string;
    pos?: number;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isHoveredRef = useRef(false);

  const keepToolbar = useCallback(() => {
    isHoveredRef.current = true;
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    isHoveredRef.current = false;
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (!isHoveredRef.current) {
        setPosition(null);
      }
    }, 250);
  }, []);

  const updateFromSelection = useCallback(() => {
    if (!editor || !editor.isEditable) {
      setPosition(null);
      return;
    }

    if (!editor.isActive("link")) {
      if (!isHoveredRef.current) {
        setPosition(null);
      }
      return;
    }

    const { href, title, target } = editor.getAttributes("link");
    if (!href) {
      setPosition(null);
      return;
    }

    const { from, to } = editor.state.selection;
    const coords = editor.view.coordsAtPos(from);
    if (!coords) return;

    const text =
      from !== to ? editor.state.doc.textBetween(from, to, " ") : String(href);

    setPosition({
      left: Math.max(8, Math.min(coords.left, window.innerWidth - 380)),
      top: coords.bottom + 6,
      href: String(href),
      text,
      title: String(title ?? ""),
      target: String(target ?? "_self"),
      pos: from,
    });
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    const dom = editor.view.dom;

    const handleMouseOver = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const isInsideAttachment = target?.closest(
        "[data-node-view-wrapper], .group\\/attachment, .attachment-link, [data-attachment], .group\\/attachment-wrapper",
      );
      if (isInsideAttachment) {
        scheduleHide();
        return;
      }

      const link = target?.closest(
        "a:not([data-attachment]):not(.attachment-link)",
      ) as HTMLAnchorElement | null;
      if (!link) {
        scheduleHide();
        return;
      }

      keepToolbar();
      const rect = link.getBoundingClientRect();
      const href = link.getAttribute("href") || "";
      const text = link.textContent || "";
      const title = link.getAttribute("title") || "";
      const targetAttr = link.getAttribute("target") || "_self";
      let pos: number | undefined;
      try {
        pos = editor.view.posAtDOM(link, 0);
      } catch {
        // ignore
      }

      if (href) {
        setPosition({
          left: Math.max(8, Math.min(rect.left, window.innerWidth - 380)),
          top: rect.bottom + 6,
          href,
          text,
          title,
          target: targetAttr,
          pos,
        });
      }
    };

    const handleMouseLeave = (event: MouseEvent) => {
      // If moving towards the floating toolbar, do not close
      const related = event.relatedTarget as HTMLElement | null;
      if (containerRef.current?.contains(related)) {
        keepToolbar();
        return;
      }
      scheduleHide();
    };

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const isInsideAttachment = target?.closest(
        "[data-node-view-wrapper], .group\\/attachment, .attachment-link, [data-attachment], .group\\/attachment-wrapper",
      );
      if (isInsideAttachment) {
        return;
      }

      const link = target?.closest(
        "a:not([data-attachment]):not(.attachment-link)",
      ) as HTMLAnchorElement | null;
      if (!link) return;

      // Prevent redirect in edit mode!
      event.preventDefault();
      event.stopPropagation();

      const pos = editor.view.posAtDOM(link, 0);
      editor.commands.setTextSelection(pos);
      editor.commands.extendMarkRange("link");

      keepToolbar();
      const rect = link.getBoundingClientRect();
      const href = link.getAttribute("href") || "";
      const text = link.textContent || "";
      const title = link.getAttribute("title") || "";
      const targetAttr = link.getAttribute("target") || "_self";
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 380)),
        top: rect.bottom + 6,
        href,
        text,
        title,
        target: targetAttr,
        pos,
      });
    };

    dom.addEventListener("mouseover", handleMouseOver);
    dom.addEventListener("mouseleave", handleMouseLeave);
    dom.addEventListener("click", handleClick, true);

    editor.on("selectionUpdate", updateFromSelection);
    editor.on("transaction", updateFromSelection);

    return () => {
      dom.removeEventListener("mouseover", handleMouseOver);
      dom.removeEventListener("mouseleave", handleMouseLeave);
      dom.removeEventListener("click", handleClick, true);
      editor.off("selectionUpdate", updateFromSelection);
      editor.off("transaction", updateFromSelection);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [editor, keepToolbar, scheduleHide, updateFromSelection]);

  if (!position) return null;

  function copyLink() {
    if (!position?.href) return;
    void navigator.clipboard.writeText(position.href);
    setCopied(true);
    toast.success("Link copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  }

  function openLink() {
    if (!position?.href) return;
    const rawHref = position.href.trim();
    const url =
      rawHref.startsWith("http://") ||
      rawHref.startsWith("https://") ||
      rawHref.startsWith("/") ||
      rawHref.startsWith("#") ||
      rawHref.startsWith("mailto:") ||
      rawHref.startsWith("tel:")
        ? rawHref
        : `https://${rawHref}`;

    if (position.target === "_self") {
      window.location.href = url;
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  function removeLink() {
    editor?.chain().focus().extendMarkRange("link").unsetLink().run();
    setPosition(null);
  }

  const normalizedHref = position
    ? position.href.startsWith("http://") ||
      position.href.startsWith("https://") ||
      position.href.startsWith("/") ||
      position.href.startsWith("#") ||
      position.href.startsWith("mailto:") ||
      position.href.startsWith("tel:")
      ? position.href
      : `https://${position.href}`
    : "";

  return (
    <div
      ref={containerRef}
      className="border-border bg-surface-raised fixed z-50 flex items-center gap-0.5 rounded-lg border p-1 text-xs shadow-lg animate-in fade-in zoom-in-95 duration-100 select-none before:absolute before:-top-3 before:left-0 before:right-0 before:h-3 before:content-['']"
      style={{ left: position.left, top: position.top }}
      onMouseEnter={keepToolbar}
      onMouseLeave={scheduleHide}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={openLink}
        className="hover:bg-surface-sunken text-muted-foreground hover:text-foreground rounded p-1.5 transition-colors cursor-pointer"
        title={
          position.target === "_self"
            ? `Open link in current window (${position.href})`
            : `Open link in new tab (${position.href})`
        }
      >
        <ExternalLink className="size-3.5" />
      </button>

      <button
        type="button"
        onClick={copyLink}
        className="hover:bg-surface-sunken text-muted-foreground hover:text-foreground rounded p-1.5 transition-colors cursor-pointer"
        title="Copy link URL"
      >
        {copied ? (
          <Check className="text-success size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>

      <button
        type="button"
        onClick={() => {
          if (typeof position.pos === "number") {
            editor?.commands.setTextSelection(position.pos);
            editor?.commands.extendMarkRange("link");
          }
          onEditLink({
            href: position.href,
            text: position.text,
            title: position.title,
            target: position.target,
          });
          setPosition(null);
        }}
        className="hover:bg-surface-sunken text-muted-foreground hover:text-foreground rounded p-1.5 transition-colors cursor-pointer"
        title="Edit link"
      >
        <Pencil className="size-3.5" />
      </button>

      <button
        type="button"
        onClick={removeLink}
        className="p-1.5 rounded text-red-500 hover:text-red-600 hover:bg-red-500/10 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-500/20 transition-colors cursor-pointer"
        title="Remove link"
      >
        <Unlink className="size-3.5 text-red-500 dark:text-red-400" />
      </button>
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
  pageLinkContext,
  onSubpageCreated,
}: {
  editor: Editor | null;
  wrapText: boolean;
  onToggleWrap: () => void;
  onUploadFile?: (file: File) => Promise<{
    filename: string;
    content_type: string;
    content_url: string;
  }>;
  // Threaded down from RichTextEditor's own optional prop of the same name -
  // undefined wherever there's no real page to search/parent to (the space
  // overview editor), in which case "Link to page"/"Create sub-page" in the
  // slash menu still dispatch their events but nothing here answers them.
  pageLinkContext?: { spaceKey: string; currentPageId: string | null };
  onSubpageCreated?: (page: WikiPage) => void;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkTarget, setLinkTarget] = useState("_blank");
  const linkSelection = useRef<{ from: number; to: number } | null>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pagePickerOpen, setPagePickerOpen] = useState(false);
  const [pagePickerSearch, setPagePickerSearch] = useState("");
  const [pagePickerPages, setPagePickerPages] = useState<WikiPage[]>([]);
  const [pagePickerLoading, setPagePickerLoading] = useState(false);
  const [subpageOpen, setSubpageOpen] = useState(false);
  const [subpageTitle, setSubpageTitle] = useState("");
  const [subpagePending, setSubpagePending] = useState(false);
  const toolbarActionsRef = useRef<HTMLDivElement>(null);
  const [visibleOverflowActionCount, setVisibleOverflowActionCount] =
    useState(11);
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
      setVisibleOverflowActionCount(11);
      setToolbarMeasureVersion((version) => version + 1);
    });
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);

  const openLinkDialog = useCallback(
    (customData?: {
      href?: string;
      text?: string;
      title?: string;
      target?: string;
    }) => {
      if (!editor) return;
      if (editor.isActive("link")) {
        editor.commands.extendMarkRange("link");
      }
      const { from, to } = editor.state.selection;
      const attributes = editor.getAttributes("link");
      linkSelection.current = { from, to };
      const currentSelectedText =
        from !== to ? editor.state.doc.textBetween(from, to, " ") : "";

      const href =
        customData?.href ?? (attributes.href as string | undefined) ?? "";
      const title =
        customData?.title ?? (attributes.title as string | undefined) ?? "";
      const target =
        customData?.target ??
        (attributes.target as string | undefined) ??
        "_blank";
      const text =
        customData?.text ||
        currentSelectedText ||
        (attributes.href as string | undefined) ||
        "";

      setLinkUrl(href);
      setLinkTitle(title);
      setLinkTarget(target === "_self" ? "_self" : "_blank");
      setLinkText(text);
      setLinkOpen(true);
    },
    [editor],
  );

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const customEvt = event as CustomEvent<{
        href?: string;
        text?: string;
        title?: string;
        target?: string;
      }>;
      openLinkDialog(customEvt.detail);
    };
    window.addEventListener("wikihub:open-link-dialog", handleOpen);
    return () => {
      window.removeEventListener("wikihub:open-link-dialog", handleOpen);
    };
  }, [openLinkDialog]);

  function saveLink(event?: React.FormEvent<HTMLFormElement> | React.MouseEvent) {
    event?.preventDefault();
    event?.stopPropagation();
    if (!editor) return;

    let href = linkUrl.trim();
    const selection = linkSelection.current;
    if (selection) {
      editor.commands.setTextSelection(selection);
    }
    if (editor.isActive("link")) {
      editor.commands.extendMarkRange("link");
    }

    if (!href) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      setLinkOpen(false);
      return;
    }

    if (
      !href.startsWith("http://") &&
      !href.startsWith("https://") &&
      !href.startsWith("/") &&
      !href.startsWith("#") &&
      !href.startsWith("mailto:") &&
      !href.startsWith("tel:")
    ) {
      href = `https://${href}`;
    }

    const attrs = {
      href,
      title: linkTitle.trim() || null,
      target: linkTarget === "_self" ? "_self" : "_blank",
    };
    const displayText = linkText.trim() || href;
    const chain = editor.chain().focus();
    const curSelection = editor.state.selection;
    if (curSelection.from !== curSelection.to) {
      const selectedText = editor.state.doc.textBetween(
        curSelection.from,
        curSelection.to,
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

  const openPagePicker = useCallback(() => {
    if (!editor || !pageLinkContext) return;
    setPagePickerSearch("");
    setPagePickerOpen(true);
    setPagePickerLoading(true);
    void api
      .get<WikiPage[]>(
        `/api/v1/spaces/${encodeURIComponent(pageLinkContext.spaceKey)}/pages`,
      )
      .then(setPagePickerPages)
      .catch(() => {
        toast.error("Could not load pages.");
        setPagePickerPages([]);
      })
      .finally(() => setPagePickerLoading(false));
  }, [editor, pageLinkContext]);

  function insertPageLink(page: WikiPage) {
    if (!editor || !pageLinkContext) return;
    editor
      .chain()
      .focus()
      .insertContent({
        type: "text",
        text: page.title,
        marks: [
          {
            type: "link",
            attrs: {
              href: `/spaces/${encodeURIComponent(pageLinkContext.spaceKey)}/pages/${encodeURIComponent(page.slug)}`,
            },
          },
        ],
      })
      .run();
    setPagePickerOpen(false);
  }

  const openSubpageDialog = useCallback(() => {
    if (!editor || !pageLinkContext) return;
    setSubpageTitle("");
    setSubpageOpen(true);
  }, [editor, pageLinkContext]);

  async function submitSubpage(
    event?: React.FormEvent<HTMLFormElement> | React.MouseEvent,
  ) {
    event?.preventDefault();
    event?.stopPropagation();
    if (!editor || !pageLinkContext) return;
    const trimmedTitle = subpageTitle.trim();
    if (!trimmedTitle) return;

    setSubpagePending(true);
    try {
      const page = await api.post<WikiPage>(
        `/api/v1/spaces/${encodeURIComponent(pageLinkContext.spaceKey)}/pages`,
        {
          title: trimmedTitle,
          content: "",
          parent_id: pageLinkContext.currentPageId,
        },
      );
      // Insert the link into THIS document before handing off to
      // onSubpageCreated, which typically saves this document and then
      // navigates away - the editor instance (and this component) is gone
      // once that happens, so the link has to land first.
      editor
        .chain()
        .focus()
        .insertContent({
          type: "text",
          text: page.title,
          marks: [
            {
              type: "link",
              attrs: {
                href: `/spaces/${encodeURIComponent(pageLinkContext.spaceKey)}/pages/${encodeURIComponent(page.slug)}`,
              },
            },
          ],
        })
        .run();
      setSubpageOpen(false);
      onSubpageCreated?.(page);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Could not create page.",
      );
    } finally {
      setSubpagePending(false);
    }
  }

  // The slash-command menu (slash-command.tsx) can't reach these directly -
  // it's an editor-instance-agnostic extension, while the hidden file inputs
  // and upload state live here. It dispatches the same kind of CustomEvent
  // this file already uses for "a node view needs a toolbar-owned action"
  // (see the image node view's "wikihub:view-file-details").
  useEffect(() => {
    const onSlashInsertImage = () => insertImage();
    const onSlashInsertAttachment = () => insertAttachment();
    const onSlashLinkToPage = () => openPagePicker();
    const onSlashCreateSubpage = () => openSubpageDialog();
    document.addEventListener("wikihub:slash-insert-image", onSlashInsertImage);
    document.addEventListener(
      "wikihub:slash-insert-attachment",
      onSlashInsertAttachment,
    );
    document.addEventListener("wikihub:slash-link-to-page", onSlashLinkToPage);
    document.addEventListener(
      "wikihub:slash-create-subpage",
      onSlashCreateSubpage,
    );
    return () => {
      document.removeEventListener(
        "wikihub:slash-insert-image",
        onSlashInsertImage,
      );
      document.removeEventListener(
        "wikihub:slash-insert-attachment",
        onSlashInsertAttachment,
      );
      document.removeEventListener(
        "wikihub:slash-link-to-page",
        onSlashLinkToPage,
      );
      document.removeEventListener(
        "wikihub:slash-create-subpage",
        onSlashCreateSubpage,
      );
    };
  }, [insertImage, insertAttachment, openPagePicker, openSubpageDialog]);

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
      className="border-border bg-surface-sunken sticky top-topbar md:top-0 z-20 flex flex-nowrap items-center gap-1 overflow-hidden rounded-t-md border px-1 py-1 shadow-xs [&>button]:shrink-0"
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
            label="To-do list"
            active={editor?.isActive("taskList")}
            onClick={() => editor?.chain().focus().toggleTaskList().run()}
          >
            <ListTodo />
          </ToolbarButton>
        ) : null}
        {visibleOverflowActionCount > 4 ? (
          <ToolbarButton
            editor={editor}
            label="Toggle list"
            active={editor?.isActive("toggle")}
            onClick={() => editor && insertToggle(editor)}
          >
            <ChevronRight />
          </ToolbarButton>
        ) : null}
        {visibleOverflowActionCount > 5 ? (
          <ToolbarButton
            editor={editor}
            label="Quote"
            active={editor?.isActive("blockquote")}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          >
            <Quote />
          </ToolbarButton>
        ) : null}
        {visibleOverflowActionCount > 6 ? (
          <ToolbarButton
            editor={editor}
            label="Code block"
            active={editor?.isActive("codeBlock")}
            onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
          >
            <Code2 className="fill-current" />
          </ToolbarButton>
        ) : null}
        {visibleOverflowActionCount > 7 ? (
          <ToolbarButton
            editor={editor}
            label="Insert divider"
            onClick={() => editor?.chain().focus().setHorizontalRule().run()}
          >
            <Minus />
          </ToolbarButton>
        ) : null}
        {visibleOverflowActionCount > 8 ? (
          <ToolbarButton
            editor={editor}
            label="Add link"
            onClick={openLinkDialog}
          >
            <Link2 />
          </ToolbarButton>
        ) : null}
        {visibleOverflowActionCount > 9 ? (
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
        {visibleOverflowActionCount > 10 ? (
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
        {visibleOverflowActionCount < 11 ? (
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
                label="To-do list"
                active={editor?.isActive("taskList")}
                onClick={() => editor?.chain().focus().toggleTaskList().run()}
              >
                <ListTodo />
              </OverflowToolbarButton>
            ) : null}
            {visibleOverflowActionCount < 5 ? (
              <OverflowToolbarButton
                label="Toggle list"
                active={editor?.isActive("toggle")}
                onClick={() => editor && insertToggle(editor)}
              >
                <ChevronRight />
              </OverflowToolbarButton>
            ) : null}
            {visibleOverflowActionCount < 6 ? (
              <OverflowToolbarButton
                label="Quote"
                active={editor?.isActive("blockquote")}
                onClick={() => editor?.chain().focus().toggleBlockquote().run()}
              >
                <Quote />
              </OverflowToolbarButton>
            ) : null}
            {visibleOverflowActionCount < 7 ? (
              <OverflowToolbarButton
                label="Code block"
                active={editor?.isActive("codeBlock")}
                onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
              >
                <Code2 className="fill-current" />
              </OverflowToolbarButton>
            ) : null}
            {visibleOverflowActionCount < 8 ? (
              <OverflowToolbarButton
                label="Insert divider"
                onClick={() =>
                  editor?.chain().focus().setHorizontalRule().run()
                }
              >
                <Minus />
              </OverflowToolbarButton>
            ) : null}
            {visibleOverflowActionCount < 9 ? (
              <OverflowToolbarButton label="Add link" onClick={openLinkDialog}>
                <Link2 />
              </OverflowToolbarButton>
            ) : null}
            {visibleOverflowActionCount < 10 ? (
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
            {visibleOverflowActionCount < 11 ? (
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
        <DialogContent
          title={linkUrl ? "Edit link" : "Insert link"}
          className="max-w-xl"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              saveLink(e);
            }}
            className="space-y-4"
            noValidate
          >
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
              <Button
                type="submit"
                variant="primary"
                onClick={(e) => e.stopPropagation()}
              >
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={pagePickerOpen} onOpenChange={setPagePickerOpen}>
        <DialogContent title="Link to page" className="max-w-md">
          <div className="space-y-3">
            <div className="relative">
              <Search
                aria-hidden
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2"
              />
              <input
                type="search"
                role="combobox"
                aria-expanded
                aria-controls="slash-page-picker-options"
                aria-label="Search pages"
                autoFocus
                value={pagePickerSearch}
                onChange={(event) => setPagePickerSearch(event.target.value)}
                placeholder="Search pages..."
                className={cn(inputClassName, "pl-9")}
              />
            </div>
            <div
              id="slash-page-picker-options"
              role="listbox"
              aria-label="Pages"
              className="border-border max-h-64 overflow-y-auto rounded-md border p-1"
            >
              {pagePickerLoading ? (
                <p className="text-muted-foreground flex items-center gap-2 px-2 py-1.5 text-sm">
                  <Loader2 className="size-4 animate-spin" /> Loading pages...
                </p>
              ) : (
                (() => {
                  const results = pagePickerPages.filter(
                    (page) =>
                      page.id !== pageLinkContext?.currentPageId &&
                      page.title
                        .toLowerCase()
                        .includes(pagePickerSearch.trim().toLowerCase()),
                  );
                  if (results.length === 0) {
                    return (
                      <p className="text-muted-foreground px-2 py-1.5 text-sm">
                        No matching pages.
                      </p>
                    );
                  }
                  return results.map((page) => (
                    <button
                      key={page.id}
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => insertPageLink(page)}
                      className="text-foreground hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <FileText
                        className="text-muted-foreground size-4 shrink-0"
                        aria-hidden
                      />
                      <span className="truncate">{page.title}</span>
                    </button>
                  ));
                })()
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={subpageOpen} onOpenChange={setSubpageOpen}>
        <DialogContent
          title="Create sub-page"
          description="Creates a page under this one and takes you there - save this page first if you have unsaved changes you want to keep."
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void submitSubpage(e);
            }}
            className="space-y-4"
            noValidate
          >
            <div className="space-y-1.5">
              <Label htmlFor="slash-subpage-title">Title</Label>
              <Input
                id="slash-subpage-title"
                value={subpageTitle}
                onChange={(event) => setSubpageTitle(event.target.value)}
                placeholder="Meeting notes, runbook, project brief..."
                autoFocus
                required
                maxLength={255}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setSubpageOpen(false)}
                disabled={subpagePending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                onClick={(e) => e.stopPropagation()}
                disabled={subpagePending || !subpageTitle.trim()}
              >
                {subpagePending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <FilePlus2 />
                )}
                {subpagePending ? "Creating..." : "Create page"}
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
  pageLinkContext,
  onSubpageCreated,
}: {
  content: string;
  onChange: (html: string) => void;
  onUploadFile?: (file: File) => Promise<{
    filename: string;
    content_type: string;
    content_url: string;
  }>;
  // Powers the slash menu's "Link to page" (search + insert a link to an
  // existing page in this space) and "Create sub-page" (create one under
  // currentPageId, insert a link to it, then hand off to onSubpageCreated)
  // items. Omit both on editors with no real page to search/parent to (the
  // space overview editor) - those two menu items then simply do nothing.
  pageLinkContext?: { spaceKey: string; currentPageId: string | null };
  onSubpageCreated?: (page: WikiPage) => void;
}) {
  const [wrapText, setWrapText] = useState(true);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<
    string | null
  >(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleViewDetails = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      setSelectedAttachmentId(id);
    };
    document.addEventListener("wikihub:view-file-details", handleViewDetails);
    return () => {
      document.removeEventListener(
        "wikihub:view-file-details",
        handleViewDetails,
      );
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
    const interceptAttachmentLink = (
      event: MouseEvent,
      onMatch: (id: string) => void,
    ) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a");
      if (!link) return;
      const id = attachmentIdFromLink(link);
      if (id) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onMatch(id);
      }
    };

    let pendingId: string | null = null;

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a");
      if (!link) return;
      const id = attachmentIdFromLink(link);
      if (id) {
        pendingId = id;
        // Preventing the default here would also stop the browser starting a
        // drag, so a draggable tile is left alone. It carries no href, so
        // there is nothing for the browser to navigate to anyway.
        if (!link.draggable) event.preventDefault();
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
  const internalNodeDragRef = useRef(false);
  const draggedNodePosRef = useRef<number | null>(null);
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
        // <img> or the tile's <a> here - so `view.dragging` is never set. Left
        // to its default, ProseMirror then treats the drop as an external one:
        // it pastes a copy parsed from the drag's text/html and never deletes
        // the source, which is what left a duplicate behind. Own the drop
        // instead and move the node ourselves.
        if (!internalNodeDragRef.current) return false;
        const fromPos = draggedNodePosRef.current;
        internalNodeDragRef.current = false;
        draggedNodePosRef.current = null;
        // Every path below returns true, which makes ProseMirror call
        // preventDefault: a drop we cannot place must be a no-op, never a copy.
        if (typeof fromPos !== "number") return true;
        const node = view.state.doc.nodeAt(fromPos);
        if (!node || !DRAGGABLE_NODE_TYPES.has(node.type.name)) return true;
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
    // Round-tripping the stored HTML through the schema rewrites it a little -
    // attribute order, rel on links, the marker on an attachment tile - so the
    // editor's own serialisation rarely matches the string the page was loaded
    // with. Seeding the baseline from the editor means that difference is not
    // mistaken for an edit: without this the first transaction of any kind,
    // even just selecting a node, reported a change and armed the
    // unsaved-changes guard on a page nobody had touched.
    onCreate: ({ editor: createdEditor }) => {
      lastEmittedHtml.current = createdEditor.getHTML();
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
      if (isFileDrag(event) && !internalNodeDragRef.current)
        setDraggingFiles(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (internalNodeDragRef.current) {
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
      if (internalNodeDragRef.current) {
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
    const onInternalNodeDragStart = (event: Event) => {
      internalNodeDragRef.current = true;
      const customEvt = event as CustomEvent<{ pos?: number }>;
      if (typeof customEvt.detail?.pos === "number") {
        draggedNodePosRef.current = customEvt.detail.pos;
      }
      setDraggingFiles(false);
    };
    const onInternalNodeDragEnd = () => {
      internalNodeDragRef.current = false;
      draggedNodePosRef.current = null;
      setDraggingFiles(false);
    };
    // Bubble phase, so it settles the refs only after ProseMirror's drop
    // handler has had them. The node view's own dragend cannot be relied on:
    // a successful move re-creates it, and the detached element may never see
    // the event.
    const onDropCleanup = () => {
      internalNodeDragRef.current = false;
      draggedNodePosRef.current = null;
      setDraggingFiles(false);
    };

    container.addEventListener("dragenter", onDragEnter, true);
    container.addEventListener("dragover", onDragOver, true);
    container.addEventListener("dragleave", onDragLeave, true);
    container.addEventListener("drop", onDrop, true);
    container.addEventListener("drop", onDropCleanup);
    container.addEventListener(
      "wikihub:internal-node-drag-start",
      onInternalNodeDragStart,
    );
    container.addEventListener(
      "wikihub:internal-node-drag-end",
      onInternalNodeDragEnd,
    );
    const onOpenAttachmentModal = (event: Event) => {
      const customEvt = event as CustomEvent<{ attachmentId?: string }>;
      if (customEvt.detail?.attachmentId) {
        setSelectedAttachmentId(customEvt.detail.attachmentId);
      }
    };
    window.addEventListener(
      "wikihub:open-attachment-modal",
      onOpenAttachmentModal,
    );

    return () => {
      window.removeEventListener(
        "wikihub:open-attachment-modal",
        onOpenAttachmentModal,
      );
      container.removeEventListener("dragenter", onDragEnter, true);
      container.removeEventListener("dragover", onDragOver, true);
      container.removeEventListener("dragleave", onDragLeave, true);
      container.removeEventListener("drop", onDrop, true);
      container.removeEventListener("drop", onDropCleanup);
      container.removeEventListener(
        "wikihub:internal-node-drag-start",
        onInternalNodeDragStart,
      );
      container.removeEventListener(
        "wikihub:internal-node-drag-end",
        onInternalNodeDragEnd,
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
          pageLinkContext={pageLinkContext}
          onSubpageCreated={onSubpageCreated}
        />
      ) : (
        <div
          className="border-border bg-surface-sunken sticky top-topbar md:top-0 z-20 h-10 rounded-t-md border shadow-xs"
          aria-hidden
        />
      )}
      <EditorContent
        editor={editor}
        className={cn(
          "border-border bg-surface focus-within:ring-ring focus-within:ring-offset-background max-w-full min-w-0 overflow-x-auto rounded-b-md border border-t-0 focus-within:ring-2 focus-within:ring-offset-2",
          !wrapText &&
            "[&_h1]:whitespace-nowrap [&_h2]:whitespace-nowrap [&_h3]:whitespace-nowrap [&_h4]:whitespace-nowrap [&_p]:whitespace-nowrap",
        )}
      />
      <TableActionsMenu editor={editor} />
      <LinkFloatingToolbar
        editor={editor}
        onEditLink={(linkData) =>
          window.dispatchEvent(
            new CustomEvent("wikihub:open-link-dialog", { detail: linkData }),
          )
        }
      />
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
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<
    string | null
  >(null);
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

    const interceptAttachmentLink = (
      event: MouseEvent,
      onMatch: (id: string) => void,
    ) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a");
      if (!link) return;
      const id = attachmentIdFromLink(link);
      if (id) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onMatch(id);
      }
    };

    let pendingId: string | null = null;

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a");
      if (!link) return;
      const id = attachmentIdFromLink(link);
      if (id) {
        event.preventDefault();
        pendingId = id;
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

    const onOpenAttachmentModal = (event: Event) => {
      const customEvt = event as CustomEvent<{ attachmentId?: string }>;
      if (customEvt.detail?.attachmentId) {
        setSelectedAttachmentId(customEvt.detail.attachmentId);
      }
    };
    window.addEventListener(
      "wikihub:open-attachment-modal",
      onOpenAttachmentModal,
    );

    container.addEventListener("mousedown", handleMouseDown, true);
    container.addEventListener("click", handleClick, true);
    return () => {
      window.removeEventListener(
        "wikihub:open-attachment-modal",
        onOpenAttachmentModal,
      );
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

/** One coloured token's span within the line it belongs to. */
type TokenSpan = { start: number; end: number; className: string | null };

function tokenSpans(tokens: CodeToken[]): TokenSpan[] {
  const spans: TokenSpan[] = [];
  let offset = 0;
  for (const token of tokens) {
    spans.push({
      start: offset,
      end: offset + token.text.length,
      className: token.className,
    });
    offset += token.text.length;
  }
  return spans;
}

/**
 * Slices one fragment of a line against the token boundaries, so a fragment
 * that straddles two differently-coloured tokens - most often a search
 * match - keeps both syntax colours instead of losing them to plain text.
 * With no spans (a plain file, or a surface with no highlighting at all),
 * the fragment is returned as a single, uncoloured piece.
 */
function sliceByTokens(
  fragment: string,
  fragmentStart: number,
  spans: TokenSpan[],
) {
  if (spans.length === 0 || !fragment)
    return [{ text: fragment, className: null as string | null }];
  const pieces: { text: string; className: string | null }[] = [];
  let cursor = fragmentStart;
  const end = fragmentStart + fragment.length;
  while (cursor < end) {
    const span = spans.find((s) => s.start <= cursor && cursor < s.end);
    const pieceEnd = span ? Math.min(span.end, end) : end;
    pieces.push({
      text: fragment.slice(cursor - fragmentStart, pieceEnd - fragmentStart),
      className: span?.className ?? null,
    });
    cursor = pieceEnd;
  }
  return pieces;
}

function HighlightedText({
  text,
  tokens,
  query,
  lineIdx,
  activeMatchIdx,
  matches,
}: {
  text: string;
  /** Syntax tokens for this same line, when the file is being highlighted. */
  tokens?: CodeToken[];
  query: string;
  lineIdx: number;
  activeMatchIdx: number;
  matches: { lineIdx: number; charIdx: number }[];
}) {
  if (!text) return <> </>;

  const spans = tokens ? tokenSpans(tokens) : [];
  const renderPieces = (
    fragment: string,
    fragmentStart: number,
    keyPrefix: string,
  ) =>
    sliceByTokens(fragment, fragmentStart, spans).map((piece, pieceIdx) => (
      <span
        key={`${keyPrefix}-${pieceIdx}`}
        className={piece.className ?? undefined}
      >
        {piece.text}
      </span>
    ));

  if (!query) return <>{renderPieces(text, 0, "t")}</>;

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

        if (!isMatch) return renderPieces(part, startOffset, String(partIdx));

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
                ? "bg-warning text-warning-foreground ring-warning ring-2"
                : "text-foreground bg-yellow-200 dark:bg-yellow-800",
            )}
          >
            {renderPieces(part, startOffset, String(partIdx))}
          </mark>
        );
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
            const res = await fetch(
              `/api/v1/attachments/${attachmentId}/content`,
            );
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

  // The same colour theme the editor's code blocks use, keyed off the
  // filename since a plain attachment has no explicit language choice.
  // Highlighting the whole file once, rather than one line at a time, is
  // what keeps a multi-line string or block comment tokenised correctly.
  const codeLanguage = metadata
    ? codeLanguageForFilename(metadata.filename)
    : null;
  const tokenLines = useMemo(
    () =>
      textContent !== null && codeLanguage
        ? highlightToLines(textContent, codeLanguage)
        : null,
    [textContent, codeLanguage],
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
      if (element)
        element.scrollIntoView({ block: "nearest", behavior: "smooth" });
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

  const handleSearchInputKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (matches.length === 0) return;
      if (event.shiftKey) {
        setActiveMatchIdx(
          (prev) => (prev - 1 + matches.length) % matches.length,
        );
      } else {
        setActiveMatchIdx((prev) => (prev + 1) % matches.length);
      }
    }
  };

  return (
    <Dialog
      open={!!attachmentId}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent title="Attachment details" className="max-w-3xl">
        {loading ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2">
            <Loader2 className="text-muted-foreground size-8 animate-spin" />
            <p className="text-muted-foreground text-sm">Loading details...</p>
          </div>
        ) : error ? (
          <div className="text-danger flex h-48 flex-col items-center justify-center gap-2">
            <p className="text-sm font-semibold">{error}</p>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : metadata ? (
          <div className="space-y-4">
            {/* Compact details bar */}
            <div className="bg-surface-sunken border-border text-muted-foreground flex flex-wrap gap-x-6 gap-y-2 rounded-md border px-3 py-1.5 text-xs">
              <div>
                <span className="text-foreground font-semibold">File: </span>
                <span className="break-all">{metadata.filename}</span>
              </div>
              <div>
                <span className="text-foreground font-semibold">Size: </span>
                <span>{formatSize(metadata.size_bytes)}</span>
              </div>
              <div>
                <span className="text-foreground font-semibold">Type: </span>
                <span>{metadata.content_type}</span>
              </div>
              <div>
                <span className="text-foreground font-semibold">
                  Uploaded:{" "}
                </span>
                <span>{formatDate(metadata.created_at)}</span>
              </div>
            </div>

            <div className="border-border overflow-hidden rounded-lg border">
              <div className="bg-surface-sunken text-muted-foreground flex items-center justify-between border-b px-3 py-1.5 text-xs font-semibold tracking-wider uppercase">
                <span>Preview</span>
                {textContent !== null && (
                  <div className="flex items-center gap-3 tracking-normal normal-case">
                    <div className="flex items-center gap-1.5">
                      <div className="relative">
                        <Search className="text-muted-foreground absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
                        <Input
                          ref={searchInputRef}
                          value={searchQuery}
                          onChange={(e) => {
                            setSearchQuery(e.target.value);
                            setActiveMatchIdx(0);
                          }}
                          onKeyDown={handleSearchInputKeyDown}
                          placeholder="Search content..."
                          className="h-7 w-40 pr-2 pl-7 text-xs"
                        />
                      </div>
                      {matches.length > 0 && (
                        <div className="text-muted-foreground flex items-center gap-1 text-xs select-none">
                          <span className="text-foreground font-medium">
                            {activeMatchIdx + 1}/{matches.length}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setActiveMatchIdx(
                                (prev) =>
                                  (prev - 1 + matches.length) % matches.length,
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
                              setActiveMatchIdx(
                                (prev) => (prev + 1) % matches.length,
                              )
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
                      title={
                        wrapLines
                          ? "Disable line wrapping"
                          : "Enable line wrapping"
                      }
                    >
                      <WrapText className="size-4" />
                    </button>
                  </div>
                )}
              </div>
              <div className="bg-surface flex max-h-96 min-h-32 items-center justify-center overflow-auto p-4">
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={contentUrl}
                    alt={metadata.filename}
                    className="max-h-80 w-auto rounded border object-contain shadow-sm"
                  />
                ) : textContent !== null ? (
                  <div className="wikihub-code bg-code-bg border-code-border max-h-80 w-full overflow-auto rounded border font-mono text-xs leading-relaxed select-text">
                    {lines.map((line, idx) => (
                      <div
                        key={idx}
                        data-line-idx={idx}
                        className={cn(
                          "hover:bg-code-inset flex",
                          matches[activeMatchIdx]?.lineIdx === idx &&
                            searchQuery &&
                            "bg-code-highlight/15 hover:bg-code-highlight/25",
                        )}
                      >
                        <span className="text-code-muted border-code-border w-12 shrink-0 border-r pr-2.5 text-right tabular-nums select-none">
                          {idx + 1}
                        </span>
                        <span
                          className={cn(
                            "pl-3",
                            wrapLines ? "break-all whitespace-pre-wrap" : "",
                          )}
                        >
                          <HighlightedText
                            text={line}
                            tokens={tokenLines?.[idx]}
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
                    <span className="text-muted-foreground text-xs">
                      Loading content...
                    </span>
                  </div>
                ) : isPdf ? (
                  <object
                    data={contentUrl}
                    type="application/pdf"
                    className="h-80 w-full rounded border"
                  >
                    <div className="p-4 text-center">
                      <FileText className="text-muted-foreground mx-auto size-12" />
                      <p className="text-muted-foreground mt-2 text-sm">
                        Your browser cannot display this PDF inline.
                      </p>
                      <a
                        href={contentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary mt-1 inline-block text-sm hover:underline"
                      >
                        Open the PDF in a new tab
                      </a>
                    </div>
                  </object>
                ) : (
                  <div className="py-6 text-center">
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
                <a
                  href={contentUrl}
                  download={metadata.filename}
                  className="gap-1.5"
                >
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
