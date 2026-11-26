"use client";

import { type Editor } from "@tiptap/react";
import {
  Check,
  ChevronDown,
  Grid2x2,
  Palette,
  RotateCcw,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

import {
  applyTableBorder,
  hasMultiCellSelection,
  readTableBorderConfig,
  type TableBorderConfig,
  type TableBorderPlacement,
  type TableBorderStyle,
  type TableBorderWidth,
} from "./table-extensions";

const BORDER_COLOR_PALETTE = [
  "var(--border)",
  "var(--border-strong)",
  "var(--muted-foreground)",
  "var(--foreground)",
  "var(--primary)",
  "var(--wh-info)",
  "var(--wh-success)",
  "var(--wh-warning)",
  "var(--danger)",
];

const BORDER_STYLES: TableBorderStyle[] = [
  "solid",
  "dotted",
  "dashed",
  "double",
  "groove",
  "ridge",
  "inset",
  "outset",
];

const BORDER_WIDTHS: TableBorderWidth[] = ["1px", "2px", "3px", "4px"];

const STYLES_REQUIRING_THICKER_LINE = new Set<TableBorderStyle>([
  "double",
  "groove",
  "ridge",
]);

const BOX_PREVIEW_STYLES = new Set<TableBorderStyle>([
  "groove",
  "ridge",
  "inset",
  "outset",
]);

function PlacementIcon({ placement }: { placement: TableBorderPlacement }) {
  const dashed = {
    stroke: "currentColor",
    strokeWidth: "1",
    strokeDasharray: "1.5 1.5",
    opacity: 0.35,
  };
  const solid = {
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round" as const,
  };

  if (placement === "none") {
    return (
      <svg viewBox="0 0 18 18" className="size-4" fill="none" aria-hidden>
        <rect
          x="2.5"
          y="2.5"
          width="13"
          height="13"
          rx="1"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeDasharray="2 2"
          opacity="0.7"
        />
        <line
          x1="9"
          y1="2.5"
          x2="9"
          y2="15.5"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeDasharray="2 2"
          opacity="0.7"
        />
        <line
          x1="2.5"
          y1="9"
          x2="15.5"
          y2="9"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeDasharray="2 2"
          opacity="0.7"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 18 18" className="size-4" fill="none" aria-hidden>
      <rect x="2.5" y="2.5" width="13" height="13" rx="0.75" {...dashed} />
      <line x1="9" y1="2.5" x2="9" y2="15.5" {...dashed} />
      <line x1="2.5" y1="9" x2="15.5" y2="9" {...dashed} />

      {(placement === "top" ||
        placement === "all" ||
        placement === "outer") && (
        <line x1="2.5" y1="2.5" x2="15.5" y2="2.5" {...solid} />
      )}
      {(placement === "bottom" ||
        placement === "all" ||
        placement === "outer") && (
        <line x1="2.5" y1="15.5" x2="15.5" y2="15.5" {...solid} />
      )}
      {(placement === "left" ||
        placement === "all" ||
        placement === "outer") && (
        <line x1="2.5" y1="2.5" x2="2.5" y2="15.5" {...solid} />
      )}
      {(placement === "right" ||
        placement === "all" ||
        placement === "outer") && (
        <line x1="15.5" y1="2.5" x2="15.5" y2="15.5" {...solid} />
      )}
      {(placement === "all" ||
        placement === "inside" ||
        placement === "inside-horizontal") && (
        <line x1="2.5" y1="9" x2="15.5" y2="9" {...solid} />
      )}
      {(placement === "all" ||
        placement === "inside" ||
        placement === "inside-vertical") && (
        <line x1="9" y1="2.5" x2="9" y2="15.5" {...solid} />
      )}
    </svg>
  );
}

function StylePreview({ style }: { style: TableBorderStyle }) {
  if (BOX_PREVIEW_STYLES.has(style)) {
    return (
      <span
        aria-hidden
        className="inline-block h-3 w-6 shrink-0 rounded-[1px]"
        style={{
          borderWidth: "3px",
          borderStyle: style,
          borderColor: "var(--muted-foreground)",
        }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-block w-6 shrink-0"
      style={{
        borderTopWidth: style === "double" ? "3px" : "2px",
        borderTopStyle: style,
        borderTopColor: "currentColor",
      }}
    />
  );
}

export function TableBorderMenu({
  editor,
  onSelectComplete,
}: {
  editor: Editor | null;
  onSelectComplete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [hoveredPlacement, setHoveredPlacement] =
    useState<TableBorderPlacement | null>(null);
  const [config, setConfig] = useState<TableBorderConfig>({
    placement: "all",
    style: "solid",
    width: "1px",
    color: "var(--border-strong)",
  });
  const [customColor, setCustomColor] = useState("#64748b");
  const { t } = useTranslation();

  function activeScope() {
    return hasMultiCellSelection(editor) ? "cells" : "table";
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setTipOpen(false);
      setStyleOpen(false);
      setHoveredPlacement(null);
      const current = readTableBorderConfig(editor);
      setConfig(current);
      if (current.color.startsWith("#")) {
        setCustomColor(current.color);
      }
    }
  }

  function commit(next: TableBorderConfig) {
    setConfig(next);
    applyTableBorder(editor, activeScope(), next);
  }

  function handleReset() {
    applyTableBorder(editor, activeScope(), "reset");
    setConfig({
      placement: "all",
      style: "solid",
      width: "1px",
      color: "var(--border-strong)",
    });
    setOpen(false);
    onSelectComplete?.();
  }

  const placements: Array<{ value: TableBorderPlacement; label: string }> = [
    // Row 1: common table presets
    { value: "all", label: t("editor.borderPlacementAll") },
    { value: "outer", label: t("editor.borderPlacementOuter") },
    { value: "inside", label: t("editor.borderPlacementInside") },
    {
      value: "inside-horizontal",
      label: t("editor.borderPlacementInsideHorizontal"),
    },
    {
      value: "inside-vertical",
      label: t("editor.borderPlacementInsideVertical"),
    },
    // Row 2: individual edges & none
    { value: "top", label: t("editor.borderPlacementTop") },
    { value: "bottom", label: t("editor.borderPlacementBottom") },
    { value: "left", label: t("editor.borderPlacementLeft") },
    { value: "right", label: t("editor.borderPlacementRight") },
    { value: "none", label: t("editor.borderPlacementNone") },
  ];

  const placementLabelMap = Object.fromEntries(
    placements.map((item) => [item.value, item.label]),
  ) as Partial<Record<TableBorderPlacement, string>>;

  const styleLabels: Record<TableBorderStyle, string> = {
    solid: t("editor.borderStyleSolid"),
    dotted: t("editor.borderStyleDotted"),
    dashed: t("editor.borderStyleDashed"),
    double: t("editor.borderStyleDouble"),
    groove: t("editor.borderStyleGroove"),
    ridge: t("editor.borderStyleRidge"),
    inset: t("editor.borderStyleInset"),
    outset: t("editor.borderStyleOutset"),
  };

  const activePlacementLabel =
    placementLabelMap[hoveredPlacement ?? config.placement] ??
    t("editor.borderPlacementAll");

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={handleOpenChange}>
      <Tooltip open={!open && tipOpen} onOpenChange={setTipOpen}>
        <DropdownMenuTrigger asChild>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("editor.tableBorders")}
              disabled={!editor}
              className="h-8 gap-0.5 px-1.5"
            >
              <Grid2x2 className="size-4" aria-hidden />
              <ChevronDown className="size-3 opacity-70" aria-hidden />
            </Button>
          </TooltipTrigger>
        </DropdownMenuTrigger>
        <TooltipContent side="top">{t("editor.tableBorders")}</TooltipContent>
      </Tooltip>

      <DropdownMenuContent
        align="start"
        className="w-[18.5rem] space-y-2.5 p-2.5"
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          if (!target.closest("label, input")) event.preventDefault();
        }}
      >
        {/* Header + Reset */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
            {t("editor.tableBorders")}
          </span>
          <button
            type="button"
            onClick={handleReset}
            className="text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
          >
            <RotateCcw className="size-3" aria-hidden />
            <span>{t("editor.resetTableBorders")}</span>
          </button>
        </div>

        {/* Placement 6x2 compact grid with live label */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground font-medium">
              {t("editor.borderPlacement")}
            </span>
            <span className="text-foreground truncate font-medium">
              {activePlacementLabel}
            </span>
          </div>
          <div
            role="radiogroup"
            aria-label={t("editor.borderPlacement")}
            className="grid grid-cols-5 gap-1"
            onMouseLeave={() => setHoveredPlacement(null)}
          >
            {placements.map((item) => {
              const active = config.placement === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={item.label}
                  title={item.label}
                  onMouseEnter={() => setHoveredPlacement(item.value)}
                  onFocus={() => setHoveredPlacement(item.value)}
                  onClick={() =>
                    commit({ ...config, placement: item.value })
                  }
                  className={cn(
                    "focus-visible:ring-ring flex h-8 cursor-pointer items-center justify-center rounded-md border transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                    active
                      ? "border-primary bg-surface-selected text-primary hover:bg-surface-selected-hover"
                      : "border-border bg-surface text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected",
                  )}
                >
                  <PlacementIcon placement={item.value} />
                </button>
              );
            })}
          </div>
        </div>

        {/* Style selector + Width pills on one row */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <div className="min-w-0 space-y-1">
            <div className="text-muted-foreground text-[11px] font-medium">
              {t("editor.borderStyle")}
            </div>
            <button
              type="button"
              aria-expanded={styleOpen}
              aria-label={t("editor.borderStyle")}
              onClick={() => setStyleOpen((prev) => !prev)}
              className={cn(
                "border-border bg-surface text-foreground hover:bg-surface-hover focus-visible:ring-ring flex h-8 w-full min-w-0 cursor-pointer items-center justify-between gap-1.5 rounded-md border px-2 text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                styleOpen && "border-primary",
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <StylePreview style={config.style} />
                <span className="truncate font-medium">
                  {styleLabels[config.style]}
                </span>
              </span>
              <ChevronDown
                className={cn(
                  "text-muted-foreground size-3.5 shrink-0 transition-transform duration-150",
                  styleOpen && "rotate-180",
                )}
                aria-hidden
              />
            </button>
          </div>

          <div className="shrink-0 space-y-1">
            <div className="text-muted-foreground text-[11px] font-medium">
              {t("editor.borderWidth")}
            </div>
            <div
              role="radiogroup"
              aria-label={t("editor.borderWidth")}
              className="flex items-center gap-1"
            >
              {BORDER_WIDTHS.map((width) => {
                const active =
                  config.placement !== "none" && config.width === width;
                return (
                  <button
                    key={width}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={width}
                    title={width}
                    onClick={() =>
                      commit({
                        ...config,
                        placement:
                          config.placement === "none"
                            ? "all"
                            : config.placement,
                        width,
                      })
                    }
                    className={cn(
                      "focus-visible:ring-ring flex h-8 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border text-[11px] font-medium tabular-nums transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                      active
                        ? "border-primary bg-surface-selected text-primary hover:bg-surface-selected-hover"
                        : "border-border bg-surface text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected",
                    )}
                  >
                    {width.replace("px", "")}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Collapsible Style list (8 Word-supported styles with preview + label) */}
        {styleOpen ? (
          <div
            role="radiogroup"
            aria-label={t("editor.borderStyle")}
            className="border-border bg-surface-sunken grid grid-cols-2 gap-1 rounded-md border p-1"
          >
            {BORDER_STYLES.map((style) => {
              const active =
                config.placement !== "none" && config.style === style;
              return (
                <button
                  key={style}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={styleLabels[style]}
                  onClick={() => {
                    const nextWidth: TableBorderWidth =
                      STYLES_REQUIRING_THICKER_LINE.has(style) &&
                      (config.width === "1px" || config.width === "2px")
                        ? "3px"
                        : config.width;
                    commit({
                      ...config,
                      placement:
                        config.placement === "none" ? "all" : config.placement,
                      style,
                      width: nextWidth,
                    });
                    setStyleOpen(false);
                  }}
                  className={cn(
                    "focus-visible:ring-ring flex h-7 cursor-pointer items-center gap-2 rounded px-2 text-left text-[11px] font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                    active
                      ? "bg-surface-selected text-primary"
                      : "text-foreground hover:bg-surface-hover",
                  )}
                >
                  <StylePreview style={style} />
                  <span className="truncate">{styleLabels[style]}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {/* Single-row Colour swatches + custom picker */}
        <div className="space-y-1.5">
          <div className="text-muted-foreground text-[11px] font-medium">
            {t("editor.borderColour")}
          </div>
          <div className="flex items-center gap-1">
            <div
              role="grid"
              aria-label={t("editor.borderColourPaletteAria")}
              className="flex flex-1 items-center gap-1"
            >
              {BORDER_COLOR_PALETTE.map((color, index) => {
                const label = t("editor.colourSwatchAria", {
                  index: index + 1,
                });
                const selected =
                  config.placement !== "none" && config.color === color;
                return (
                  <button
                    key={`${color}-${index}`}
                    type="button"
                    role="gridcell"
                    aria-label={label}
                    aria-selected={selected}
                    title={label}
                    className={cn(
                      "border-border/80 focus-visible:ring-ring relative flex size-6 cursor-pointer items-center justify-center rounded-sm border transition-transform duration-100 hover:z-10 hover:scale-110 focus-visible:z-10 focus-visible:scale-110 focus-visible:ring-2 focus-visible:outline-none",
                      selected && "ring-primary ring-offset-surface ring-2 ring-offset-1",
                    )}
                    style={{ backgroundColor: color }}
                    onClick={() =>
                      commit({
                        ...config,
                        placement:
                          config.placement === "none"
                            ? "all"
                            : config.placement,
                        color,
                      })
                    }
                  >
                    {selected ? (
                      <span
                        aria-hidden
                        className="bg-surface text-foreground flex size-3.5 items-center justify-center rounded-full shadow-xs"
                      >
                        <Check className="size-2.5" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <label
              title={t("editor.customBorderColour")}
              className="border-border text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-within:ring-ring relative flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm border transition-colors duration-150 focus-within:ring-2"
            >
              <Palette className="size-3.5" aria-hidden />
              <input
                type="color"
                aria-label={t("editor.customBorderColour")}
                value={customColor}
                onChange={(event) => {
                  const value = event.target.value;
                  setCustomColor(value);
                  commit({
                    ...config,
                    placement:
                      config.placement === "none" ? "all" : config.placement,
                    color: value,
                  });
                }}
                className="sr-only"
              />
            </label>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
