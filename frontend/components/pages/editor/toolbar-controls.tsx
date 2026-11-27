"use client";

import { useEditorState, type Editor } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Check,
  ChevronDown,
  Ellipsis,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Palette,
  Pilcrow,
  Table2,
  Type,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

import { headingLevels, TOGGLE_ON_CLASS } from "./content-normalize";

export function ToolbarButton({
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
      className={cn(active && TOGGLE_ON_CLASS)}
    >
      {children}
    </Button>
  );
}

export function OverflowToolbarButton({
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
      className={cn(active && TOGGLE_ON_CLASS)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function HeadingMenu({ editor }: { editor: Editor | null }) {
  const { t } = useTranslation();
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
          aria-label={t("editor.textStyleAria")}
          title={t("editor.textStyleAria")}
          disabled={!editor}
          className={cn("h-8 min-w-14 px-2", currentLevel && TOGGLE_ON_CLASS)}
        >
          {currentLevel ? `H${currentLevel}` : t("editor.textButton")}
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40">
        <DropdownMenuItem
          onSelect={() => editor?.chain().focus().setParagraph().run()}
        >
          <Pilcrow />
          {t("editor.paragraph")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            editor?.chain().focus().setHeading({ level: 1 }).run()
          }
        >
          <Heading1 />
          {t("slash.heading1Label")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            editor?.chain().focus().setHeading({ level: 2 }).run()
          }
        >
          <Heading2 />
          {t("slash.heading2Label")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            editor?.chain().focus().setHeading({ level: 3 }).run()
          }
        >
          <Heading3 />
          {t("slash.heading3Label")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            editor?.chain().focus().setHeading({ level: 4 }).run()
          }
        >
          <Heading4 />
          {t("slash.heading4Label")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AlignmentMenu({ editor }: { editor: Editor | null }) {
  const { t } = useTranslation();
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
          aria-label={t("editor.textAlignAria")}
          title={t("editor.textAlignAria")}
          disabled={!editor}
          className={cn(alignment !== "left" && TOGGLE_ON_CLASS)}
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
          {t("editor.alignLeft")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => editor?.chain().focus().setTextAlign("center").run()}
        >
          <AlignCenter />
          {t("editor.alignCenter")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => editor?.chain().focus().setTextAlign("right").run()}
        >
          <AlignRight />
          {t("editor.alignRight")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// One palette for every colour picker in the toolbar (text colour, text
// highlight and table-cell background), so they look and behave alike.
export const colorPalette = [
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

/**
 * The dropdown body shared by the colour pickers: a swatch grid, a clear
 * button and a native picker for any custom colour. `current` marks the
 * swatch already applied to the selection.
 */
export function ColorPaletteContent({
  title,
  paletteAria,
  clearLabel,
  customLabel,
  current,
  onSelect,
}: {
  title: string;
  paletteAria: string;
  clearLabel: string;
  customLabel: string;
  current?: string | null;
  onSelect: (value: string | null) => void;
}) {
  const [customColor, setCustomColor] = useState("#ffffff");
  const { t } = useTranslation();

  return (
    <DropdownMenuContent
      align="start"
      className="w-52 p-2"
      onPointerDown={(event) => {
        const target = event.target as HTMLElement;
        if (!target.closest("label, input")) event.preventDefault();
      }}
    >
      <div className="text-muted-foreground mb-2 px-1 text-[11px] font-semibold tracking-wide uppercase">
        {title}
      </div>
      <div
        role="grid"
        aria-label={paletteAria}
        className="grid grid-cols-5 overflow-hidden rounded-sm"
      >
        {colorPalette.map((color, index) => {
          const label = t("editor.colourSwatchAria", { index: index + 1 });
          return (
            <button
              key={`${color}-${index}`}
              type="button"
              role="gridcell"
              aria-label={label}
              aria-selected={current === color}
              title={label}
              className="border-surface focus-visible:ring-ring relative flex size-9 items-center justify-center border transition-transform duration-100 hover:z-10 hover:scale-110 hover:rounded-sm focus-visible:z-10 focus-visible:scale-110 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:outline-none"
              style={{ backgroundColor: color }}
              onClick={() => onSelect(color)}
            >
              {current === color ? (
                <span
                  aria-hidden
                  className="bg-surface text-foreground flex size-4 items-center justify-center rounded-full shadow-sm"
                >
                  <Check className="size-3" />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="border-border mt-2 flex items-center justify-between border-t pt-2">
        <button
          type="button"
          aria-label={clearLabel}
          title={clearLabel}
          className="border-border text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring flex size-8 items-center justify-center rounded-md border transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
          onClick={() => onSelect(null)}
        >
          <span aria-hidden className="text-base leading-none">
            ×
          </span>
        </button>
        <label
          title={customLabel}
          className="border-border text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-within:ring-ring relative flex size-8 cursor-pointer items-center justify-center rounded-md border transition-colors duration-150 focus-within:ring-2"
        >
          <Palette className="size-4" aria-hidden />
          <input
            type="color"
            aria-label={customLabel}
            value={customColor}
            onChange={(event) => {
              setCustomColor(event.target.value);
              onSelect(event.target.value);
            }}
            className="sr-only"
          />
        </label>
      </div>
    </DropdownMenuContent>
  );
}

export function ColorMenu({
  editor,
  kind,
  compact = false,
}: {
  editor: Editor | null;
  kind: "text" | "highlight";
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isText = kind === "text";
  const currentValue = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) =>
      currentEditor?.getAttributes("textStyle")[
        isText ? "color" : "backgroundColor"
      ] ?? "",
  });
  const Icon = isText ? Type : Palette;
  const { t } = useTranslation();
  const label = isText ? t("editor.textColour") : t("editor.textHighlight");

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
    setOpen(false);
  }

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={label}
          title={label}
          disabled={!editor}
          className={cn(
            compact ? "h-8 gap-0.5 px-1.5" : "h-8 gap-1.5 px-2",
            currentValue && TOGGLE_ON_CLASS,
          )}
        >
          <span className="relative flex flex-col items-center">
            <Icon className="size-4" aria-hidden />
            {currentValue ? (
              <span
                aria-hidden
                className="border-border absolute -bottom-1 h-[3px] w-4 rounded-full border"
                style={{ backgroundColor: currentValue }}
              />
            ) : null}
          </span>
          {compact ? null : <span>{label}</span>}
          <ChevronDown className={compact ? "size-3 opacity-70" : "size-3.5"} />
        </Button>
      </DropdownMenuTrigger>
      <ColorPaletteContent
        title={label}
        paletteAria={
          isText
            ? t("editor.textColourPaletteAria")
            : t("editor.textHighlightPaletteAria")
        }
        clearLabel={
          isText ? t("editor.clearColour") : t("editor.clearHighlight")
        }
        customLabel={
          isText ? t("editor.customTextColour") : t("editor.customHighlight")
        }
        current={currentValue}
        onSelect={setColor}
      />
    </DropdownMenu>
  );
}

export function TablePicker({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState({ rows: 0, cols: 0 });
  const { t } = useTranslation();
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
          aria-label={t("editor.insertTable")}
          title={t("editor.insertTable")}
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
          <span>{t("editor.selectTableSize")}</span>
          <span className="text-foreground font-medium tabular-nums">
            {hovered.rows}×{hovered.cols}
          </span>
        </div>
        <div
          role="grid"
          aria-label={t("editor.tableSizeAria")}
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
                aria-label={t("editor.gridSizeAria", { rows: row, cols: col })}
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
          {t("editor.clickCellToInsert")}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CellColorMenu({
  editor,
  onSelectComplete,
}: {
  editor: Editor | null;
  onSelectComplete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const { t } = useTranslation();

  function setCellColor(value: string | null) {
    editor?.chain().focus().setCellAttribute("backgroundColor", value).run();
    setOpen(false);
    onSelectComplete?.();
  }

  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setTipOpen(false);
      }}
    >
      <Tooltip open={!open && tipOpen} onOpenChange={setTipOpen}>
        <DropdownMenuTrigger asChild>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("editor.cellColour")}
              disabled={!editor}
              className="h-8 gap-0.5 px-1.5"
            >
              <Palette className="size-4" aria-hidden />
              <ChevronDown className="size-3 opacity-70" aria-hidden />
            </Button>
          </TooltipTrigger>
        </DropdownMenuTrigger>
        <TooltipContent side="top">{t("editor.cellColour")}</TooltipContent>
      </Tooltip>
      <ColorPaletteContent
        title={t("editor.cellColour")}
        paletteAria={t("editor.cellColourPaletteAria")}
        clearLabel={t("editor.clearCellColour")}
        customLabel={t("editor.customCellColour")}
        onSelect={setCellColor}
      />
    </DropdownMenu>
  );
}

export function TableActionButton({
  editor,
  label,
  onClick,
  disabled,
  className,
  children,
}: {
  editor: Editor | null;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const isDisabled = disabled || !editor;
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      disabled={isDisabled}
      onClick={onClick}
      className={cn(isDisabled && "pointer-events-none", className)}
    >
      {children}
    </Button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {isDisabled ? (
          <span className="inline-flex cursor-not-allowed" tabIndex={-1}>
            {button}
          </span>
        ) : (
          button
        )}
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
export function MoreFormattingMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("editor.moreFormattingAria")}
          title={t("editor.moreFormattingAria")}
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-auto max-w-[calc(100vw-1rem)] p-1"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div
          role="toolbar"
          aria-label={t("editor.hiddenFormattingAria")}
          className="flex max-w-56 flex-wrap gap-0.5"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("button")) {
              setOpen(false);
            }
          }}
        >
          {children}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
