"use client";

import { NodeSelection, type Transaction } from "@tiptap/pm/state";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  Bold,
  Check,
  ChevronDown,
  Code2,
  Eraser,
  Italic,
  Link2,
  Pencil,
  Plus,
  BetweenHorizontalEnd,
  BetweenVerticalEnd,
  RemoveFormatting,
  SquareSplitHorizontal,
  Strikethrough,
  Table2,
  TableCellsMerge,
  Trash2,
  Sparkles,
  ExternalLink,
  Copy,
  Underline,
  Unlink,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

import { TABLE_COLUMN_HOVER_KEY } from "./table-extensions";
import { TableBorderMenu } from "./table-border-menu";
import {
  AlignmentMenu,
  CellColorMenu,
  ColorMenu,
  HeadingMenu,
  TableActionButton,
  ToolbarButton,
} from "./toolbar-controls";

type TableMenuPosition = { left: number; top: number };

/**
 * Table actions live in a viewport-positioned surface instead of the main
 * toolbar. Keeping it out of document flow means entering a table never makes
 * the formatting bar wrap or shifts the editor content below it.
 */
export function TableActionsMenu({ editor }: { editor: Editor | null }) {
  const [position, setPosition] = useState<TableMenuPosition | null>(null);
  const [contextMenuPos, setContextMenuPos] =
    useState<TableMenuPosition | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addTipOpen, setAddTipOpen] = useState(false);
  const [deleteMenuOpen, setDeleteMenuOpen] = useState(false);
  const [deleteTipOpen, setDeleteTipOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredTable, setHoveredTable] = useState({ rows: 0, cols: 0 });
  const { t } = useTranslation();
  const maxRows = 8;
  const maxCols = 10;

  function insertTable(rows: number, cols: number) {
    editor!
      .chain()
      .focus()
      .insertTable({ rows, cols, withHeaderRow: true })
      .run();
    setHoveredTable({ rows: 0, cols: 0 });
    setContextMenuPos(null);
  }

  function clearSelectedCells() {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .command(({ state, tr, dispatch }) => {
        const { selection, schema } = state;
        const { $from, $to } = selection;
        const emptyPara = schema.nodes.paragraph?.create();
        if (!emptyPara) return false;

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
        const cellRanges: Array<{ from: number; to: number }> = [];

        tableNode.forEach((rowNode, rowOffset) => {
          const rowStart = tableStart + rowOffset + 1;
          rowNode.forEach((cellNode, cellOffset) => {
            const cellPos = rowStart + cellOffset;
            const cellStart = cellPos + 1;
            const cellEnd = cellPos + cellNode.nodeSize - 1;
            const matches =
              selection.ranges.length > 1
                ? selection.ranges.some(
                    (range) =>
                      range.$from.pos <= cellEnd && range.$to.pos >= cellStart,
                  )
                : selection.empty
                  ? $from.pos >= cellPos && $from.pos <= cellEnd + 1
                  : $from.pos <= cellEnd && $to.pos >= cellStart;
            if (matches) {
              cellRanges.push({ from: cellStart, to: cellEnd });
            }
          });
        });

        if (cellRanges.length === 0) return false;
        cellRanges
          .sort((a, b) => b.from - a.from)
          .forEach(({ from, to }) => {
            tr.replaceWith(from, to, emptyPara.copy(emptyPara.content));
          });
        if (dispatch) dispatch(tr);
        return true;
      })
      .run();
    setContextMenuPos(null);
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
    // The selection is in a table, so its DOM node is too.
    const table = (
      node instanceof Element ? node : node.parentElement
    )!.closest("table")!;
    const rect = table.getBoundingClientRect();
    setPosition({
      // Leave enough room for the compact icon menu while keeping it on-screen.
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 360)),
      top: Math.min(rect.bottom + 6, window.innerHeight - 52),
    });
  }, [editor]);

  useLayoutEffect(() => {
    if (!editor) return;

    const targetElement = (target: EventTarget | null): Element | null =>
      target instanceof Element
        ? target
        : target instanceof Node
          ? target.parentElement
          : null;

    const handleSelectionUpdate = () => {
      setContextMenuPos(null);
      updatePosition();
    };
    const handleTransaction = ({
      transaction,
    }: {
      transaction: Transaction;
    }) => {
      if (transaction.getMeta(TABLE_COLUMN_HOVER_KEY)) return;
      updatePosition();
    };
    const handleViewportChange = () => {
      setContextMenuPos(null);
      updatePosition();
    };
    const handleMouseDown = (event: MouseEvent) => {
      if (
        !editor.isEditable ||
        event.button !== 2 ||
        (!("$anchorCell" in editor.state.selection) &&
          editor.state.selection.empty)
      ) {
        return;
      }
      const cell = targetElement(event.target)?.closest("td, th");
      if (!cell || !editor.view.dom.contains(cell)) return;
      // Stop the browser from collapsing an active selection to the right-clicked word.
      event.preventDefault();
    };
    const handleContextMenu = (event: MouseEvent) => {
      if (!editor.isEditable) return;
      const cell = targetElement(event.target)?.closest("td, th");
      if (!cell || !editor.view.dom.contains(cell)) return;
      // Preserve an existing multi-cell selection or active range under the cursor;
      // otherwise focus the right-clicked cell. When a non-empty text range is
      // selected inside a cell, defer to SelectionFormatMenu so the user gets
      // text formatting at the cursor while TableActionsMenu stays docked below.
      const sel = editor.state.selection;
      if (!("$anchorCell" in sel)) {
        const coords = editor.view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        const insideSelection =
          !sel.empty &&
          !(sel instanceof NodeSelection) &&
          coords != null &&
          coords.pos >= sel.from &&
          coords.pos <= sel.to;
        if (insideSelection) {
          return;
        }
        if (coords && coords.pos >= 0) {
          editor.commands.setTextSelection(coords.pos);
        }
      }
      event.preventDefault();
      if (!editor.isFocused) editor.view.focus();
      setContextMenuPos({
        left: Math.max(8, Math.min(event.clientX, window.innerWidth - 360)),
        top: Math.max(8, Math.min(event.clientY, window.innerHeight - 52)),
      });
    };
    const handleOutsidePointer = (event: PointerEvent) => {
      const target = targetElement(event.target);
      if (
        containerRef.current?.contains(target) ||
        target?.closest('[role="menu"], [data-radix-menu-content]')
      ) {
        return;
      }
      setContextMenuPos(null);
    };

    const dom = editor.view.dom;
    dom.addEventListener("mousedown", handleMouseDown, true);
    dom.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("pointerdown", handleOutsidePointer);
    editor.on("selectionUpdate", handleSelectionUpdate);
    editor.on("transaction", handleTransaction);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- position the floating table toolbar on first render
    updatePosition();

    return () => {
      dom.removeEventListener("mousedown", handleMouseDown, true);
      dom.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("pointerdown", handleOutsidePointer);
      editor.off("selectionUpdate", handleSelectionUpdate);
      editor.off("transaction", handleTransaction);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [editor, updatePosition]);

  const activePosition = contextMenuPos ?? position;
  if (!activePosition) return null;

  return (
    <TooltipProvider delayDuration={200} disableHoverableContent>
      <div
        ref={containerRef}
        className="border-border bg-surface-raised fixed z-50 flex max-w-[calc(100vw-1rem)] flex-wrap items-center gap-0.5 rounded-lg border p-1 shadow-lg"
        style={activePosition}
        role="toolbar"
        aria-label={t("editor.tableActionsAria")}
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
          label={t("editor.tableAskAi")}
          className="text-primary [&:not(:disabled)]:hover:text-primary"
          onClick={() => {
            setContextMenuPos(null);
            window.dispatchEvent(
              new CustomEvent("wikihub:ai-assist", {
                detail: { mode: "prompt" },
              }),
            );
          }}
        >
          <Sparkles aria-hidden />
        </TableActionButton>

        <span aria-hidden className="bg-border mx-0.5 h-5 w-px shrink-0" />

        <TableActionButton
          editor={editor}
          label={t("editor.mergeSelectedCells")}
          disabled={!editor?.can().mergeCells()}
          onClick={() => {
            editor?.chain().focus().mergeCells().run();
            setContextMenuPos(null);
          }}
        >
          <TableCellsMerge aria-hidden />
        </TableActionButton>
        <TableActionButton
          editor={editor}
          label={t("editor.splitCell")}
          disabled={!editor?.can().splitCell()}
          onClick={() => {
            editor?.chain().focus().splitCell().run();
            setContextMenuPos(null);
          }}
        >
          <SquareSplitHorizontal aria-hidden />
        </TableActionButton>
        <TableActionButton
          editor={editor}
          label={t("editor.tableClearCells")}
          onClick={clearSelectedCells}
        >
          <Eraser aria-hidden />
        </TableActionButton>
        <CellColorMenu
          editor={editor}
          onSelectComplete={() => setContextMenuPos(null)}
        />
        <TableBorderMenu
          editor={editor}
          onSelectComplete={() => setContextMenuPos(null)}
        />

        <span aria-hidden className="bg-border mx-0.5 h-5 w-px shrink-0" />

        <DropdownMenu
          modal={false}
          open={addMenuOpen}
          onOpenChange={(next) => {
            setAddMenuOpen(next);
            if (next) setAddTipOpen(false);
          }}
        >
          <Tooltip open={!addMenuOpen && addTipOpen} onOpenChange={setAddTipOpen}>
            <DropdownMenuTrigger asChild>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t("editor.add")}
                  disabled={!editor}
                  className="h-8 gap-0.5 px-1.5"
                >
                  <Plus className="size-4" aria-hidden />
                  <ChevronDown className="size-3 opacity-70" aria-hidden />
                </Button>
              </TooltipTrigger>
            </DropdownMenuTrigger>
            <TooltipContent side="top">{t("editor.add")}</TooltipContent>
          </Tooltip>
        <DropdownMenuContent align="start" className="w-44 p-1">
          <DropdownMenuItem
            className="text-muted-foreground data-[highlighted]:text-foreground"
            onClick={() => {
              editor?.chain().focus().addRowBefore().run();
              setContextMenuPos(null);
            }}
          >
            <BetweenHorizontalEnd />
            <span>{t("editor.addRowBefore")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-muted-foreground data-[highlighted]:text-foreground"
            onClick={() => {
              editor?.chain().focus().addRowAfter().run();
              setContextMenuPos(null);
            }}
          >
            <BetweenHorizontalEnd />
            <span>{t("editor.addRow")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-muted-foreground data-[highlighted]:text-foreground"
            onClick={() => {
              editor?.chain().focus().addColumnBefore().run();
              setContextMenuPos(null);
            }}
          >
            <BetweenVerticalEnd />
            <span>{t("editor.addColumnBefore")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-muted-foreground data-[highlighted]:text-foreground"
            onClick={() => {
              editor?.chain().focus().addColumnAfter().run();
              setContextMenuPos(null);
            }}
          >
            <BetweenVerticalEnd />
            <span>{t("editor.addColumn")}</span>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="text-muted-foreground data-[highlighted]:text-foreground">
              <Table2 />
              <span>{t("editor.addTable")}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-[13.5rem] p-2">
              <div className="text-muted-foreground mb-2 flex items-center justify-between px-1 text-xs">
                <span>{t("editor.selectTableSize")}</span>
                <span className="text-foreground font-medium tabular-nums">
                  {hoveredTable.rows}×{hoveredTable.cols}
                </span>
              </div>
              <div
                role="grid"
                aria-label={t("editor.tableSizeAria")}
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
                      aria-label={t("editor.gridSizeAria", {
                        rows: row,
                        cols: col,
                      })}
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
                {t("editor.clickCellToInsert")}
              </p>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu
        modal={false}
        open={deleteMenuOpen}
        onOpenChange={(next) => {
          setDeleteMenuOpen(next);
          if (next) setDeleteTipOpen(false);
        }}
      >
        <Tooltip
          open={!deleteMenuOpen && deleteTipOpen}
          onOpenChange={setDeleteTipOpen}
        >
          <DropdownMenuTrigger asChild>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t("editor.delete")}
                disabled={!editor}
                className="text-danger [&:not(:disabled)]:hover:bg-danger-bg [&:not(:disabled)]:hover:text-danger active:bg-danger-bg/85 h-8 gap-0.5 px-1.5"
              >
                <Trash2 className="size-4" aria-hidden />
                <ChevronDown className="size-3 opacity-70" aria-hidden />
              </Button>
            </TooltipTrigger>
          </DropdownMenuTrigger>
          <TooltipContent side="top">{t("editor.delete")}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="w-40 p-1">
          <DropdownMenuItem
            destructive
            onClick={() => {
              editor?.chain().focus().deleteRow().run();
              setContextMenuPos(null);
            }}
          >
            <Trash2 />
            <span>{t("editor.deleteRow")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            destructive
            onClick={() => {
              editor?.chain().focus().deleteColumn().run();
              setContextMenuPos(null);
            }}
          >
            <Trash2 />
            <span>{t("editor.deleteColumn")}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            destructive
            onClick={() => {
              editor?.chain().focus().deleteTable().run();
              setContextMenuPos(null);
            }}
          >
            <Trash2 />
            <span>{t("editor.deleteTable")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>
    </TooltipProvider>
  );
}

/**
 * Right-click text formatting toolbar shown when the user selects text in edit
 * mode and opens the context menu, mirroring the main header's formatting
 * controls at the cursor so the user does not have to glance up to the top bar.
 */
export function SelectionFormatMenu({ editor }: { editor: Editor | null }) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(
    null,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  const marks = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      bold: currentEditor?.isActive("bold") ?? false,
      italic: currentEditor?.isActive("italic") ?? false,
      underline: currentEditor?.isActive("underline") ?? false,
      strike: currentEditor?.isActive("strike") ?? false,
      code: currentEditor?.isActive("code") ?? false,
      link: currentEditor?.isActive("link") ?? false,
    }),
  });

  useEffect(() => {
    if (!editor) return;

    const targetElement = (target: EventTarget | null): Element | null =>
      target instanceof Element
        ? target
        : target instanceof Node
          ? target.parentElement
          : null;

    const hasTextSelection = () => {
      const sel = editor.state.selection;
      return (
        !sel.empty &&
        !(sel instanceof NodeSelection) &&
        !("$anchorCell" in sel)
      );
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (!editor.isEditable || event.button !== 2 || !hasTextSelection()) {
        return;
      }
      // Keep the browser from collapsing the active text selection before
      // `contextmenu` fires.
      event.preventDefault();
    };

    const handleContextMenu = (event: MouseEvent) => {
      if (!editor.isEditable || event.defaultPrevented || !hasTextSelection()) {
        return;
      }
      const target = targetElement(event.target);
      if (!target || !editor.view.dom.contains(target)) return;
      // Don't hijack right-clicks on images or attachment tiles.
      if (target.closest("img, [data-attachment], .attachment-link")) return;

      event.preventDefault();
      if (!editor.isFocused) editor.view.focus();
      setPosition({
        left: Math.max(8, Math.min(event.clientX, window.innerWidth - 460)),
        top: Math.max(8, Math.min(event.clientY + 8, window.innerHeight - 56)),
      });
    };

    const handleSelectionUpdate = () => {
      if (!hasTextSelection()) setPosition(null);
    };

    const handleOutsidePointer = (event: PointerEvent) => {
      const target = targetElement(event.target);
      if (
        containerRef.current?.contains(target) ||
        target?.closest('[role="menu"], [data-radix-menu-content]')
      ) {
        return;
      }
      setPosition(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPosition(null);
    };

    const handleViewportChange = () => setPosition(null);

    const dom = editor.view.dom;
    dom.addEventListener("mousedown", handleMouseDown, true);
    dom.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("pointerdown", handleOutsidePointer);
    document.addEventListener("keydown", handleKeyDown);
    editor.on("selectionUpdate", handleSelectionUpdate);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      dom.removeEventListener("mousedown", handleMouseDown, true);
      dom.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("pointerdown", handleOutsidePointer);
      document.removeEventListener("keydown", handleKeyDown);
      editor.off("selectionUpdate", handleSelectionUpdate);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [editor]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("wikihub:selection-format-menu", {
        detail: { open: position !== null },
      }),
    );
    return () => {
      if (position !== null) {
        window.dispatchEvent(
          new CustomEvent("wikihub:selection-format-menu", {
            detail: { open: false },
          }),
        );
      }
    };
  }, [position]);

  if (!position || !editor) return null;

  return (
    <div
      ref={containerRef}
      className="border-border bg-surface-raised fixed z-50 flex max-w-[calc(100vw-1rem)] flex-wrap items-center gap-0.5 rounded-lg border p-1 shadow-lg"
      style={position}
      role="toolbar"
      aria-label={t("editor.textFormattingAria")}
      onMouseDown={(event) => {
        if ((event.target as HTMLElement).closest("button")) {
          event.preventDefault();
        }
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("ai.writing.button")}
        title={t("ai.writing.button")}
        className="text-primary [&:not(:disabled)]:hover:text-primary"
        onClick={() => {
          setPosition(null);
          window.dispatchEvent(
            new CustomEvent("wikihub:ai-assist", {
              detail: { mode: "prompt" },
            }),
          );
        }}
      >
        <Sparkles aria-hidden />
      </Button>
      <span aria-hidden className="bg-border mx-0.5 h-5 w-px shrink-0" />
      <HeadingMenu editor={editor} />
      <span aria-hidden className="bg-border mx-0.5 h-5 w-px shrink-0" />
      <ToolbarButton
        editor={editor}
        label={t("editor.bold")}
        active={marks?.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold />
      </ToolbarButton>
      <ToolbarButton
        editor={editor}
        label={t("editor.italic")}
        active={marks?.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic />
      </ToolbarButton>
      <ToolbarButton
        editor={editor}
        label={t("editor.underline")}
        active={marks?.underline}
        onClick={() => editor.chain().focus().toggleMark("underline").run()}
      >
        <Underline />
      </ToolbarButton>
      <ToolbarButton
        editor={editor}
        label={t("editor.strikethrough")}
        active={marks?.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough />
      </ToolbarButton>
      <ToolbarButton
        editor={editor}
        label={t("editor.inlineCode")}
        active={marks?.code}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code2 />
      </ToolbarButton>
      <ColorMenu editor={editor} kind="text" compact />
      <ColorMenu editor={editor} kind="highlight" compact />
      <ToolbarButton
        editor={editor}
        label={t("editor.clearTextColourHighlight")}
        onClick={() => {
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
      <span aria-hidden className="bg-border mx-0.5 h-5 w-px shrink-0" />
      <AlignmentMenu editor={editor} />
      <ToolbarButton
        editor={editor}
        label={t("editor.addLink")}
        active={marks?.link}
        onClick={() => {
          setPosition(null);
          window.dispatchEvent(new CustomEvent("wikihub:open-link-dialog"));
        }}
      >
        <Link2 />
      </ToolbarButton>
    </div>
  );
}

export function LinkFloatingToolbar({
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
  const { t } = useTranslation();

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
    }, 60);
  }, []);

  // Only subscribed while an editor exists, and this editor is always editable.
  const updateFromSelection = useCallback(() => {
    const current = editor!;
    if (!current.isActive("link")) {
      if (!isHoveredRef.current) {
        setPosition(null);
      }
      return;
    }

    const { href, title, target } = current.getAttributes("link");

    const { from, to } = current.state.selection;
    let coords: { left: number; bottom: number } | null = null;
    try {
      coords = current.view.coordsAtPos(from);
    } catch {
      coords = null;
    }
    if (!coords) return;

    const text =
      from !== to ? current.state.doc.textBetween(from, to, " ") : String(href);

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
      const pos = editor.view.posAtDOM(link, 0);
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
    toast.success(t("editor.linkCopiedToast"));
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
    if (!editor) return;
    // The toolbar also opens on hover, when the caret is somewhere else
    // entirely. Select the link this toolbar is about first, or the command
    // acts on whatever the caret happens to touch (usually nothing).
    const chain = editor.chain().focus();
    if (typeof position?.pos === "number") chain.setTextSelection(position.pos);
    chain.extendMarkRange("link").unsetLink().run();
    setPosition(null);
  }

  return (
    <div
      ref={containerRef}
      className="border-border bg-surface-raised animate-in fade-in zoom-in-95 fixed z-50 flex items-center gap-0.5 rounded-lg border p-1 text-xs shadow-lg duration-100 select-none before:absolute before:-top-3 before:right-0 before:left-0 before:h-3 before:content-['']"
      style={{ left: position.left, top: position.top }}
      onMouseEnter={keepToolbar}
      onMouseLeave={scheduleHide}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={openLink}
        className="hover:bg-surface-sunken text-muted-foreground hover:text-foreground cursor-pointer rounded p-1.5 transition-colors"
        title={
          position.target === "_self"
            ? t("editor.openLinkCurrent", { href: position.href })
            : t("editor.openLinkNewTab", { href: position.href })
        }
      >
        <ExternalLink className="size-3.5" />
      </button>

      <button
        type="button"
        onClick={copyLink}
        className="hover:bg-surface-sunken text-muted-foreground hover:text-foreground cursor-pointer rounded p-1.5 transition-colors"
        title={t("editor.copyLinkUrl")}
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
        className="hover:bg-surface-sunken text-muted-foreground hover:text-foreground cursor-pointer rounded p-1.5 transition-colors"
        title={t("editor.editLink")}
      >
        <Pencil className="size-3.5" />
      </button>

      <button
        type="button"
        onClick={removeLink}
        className="cursor-pointer rounded p-1.5 text-red-500 transition-colors hover:bg-red-500/10 hover:text-red-600 dark:text-red-400 dark:hover:bg-red-500/20 dark:hover:text-red-300"
        title={t("editor.removeLink")}
      >
        <Unlink className="size-3.5 text-red-500 dark:text-red-400" />
      </button>
    </div>
  );
}
