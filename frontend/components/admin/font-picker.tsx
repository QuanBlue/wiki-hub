"use client";

import { Check, ChevronDown, ChevronUp, Eye } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import {
  FONT_CATEGORIES,
  FONT_PRESETS,
  type FontCategory,
  type FontPreset,
} from "@/lib/font-presets";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/** Rows of fonts shown before "Show more". */
const COLLAPSED_ROWS = 3;

/** How many cards sit side by side, following the grid's own breakpoints. */
function subscribeToColumns(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const queries = [
    window.matchMedia("(min-width: 640px)"),
    window.matchMedia("(min-width: 1280px)"),
  ];
  queries.forEach((query) => query.addEventListener("change", onChange));
  return () =>
    queries.forEach((query) => query.removeEventListener("change", onChange));
}
const currentColumns = () =>
  typeof window.matchMedia !== "function"
    ? 3
    : window.matchMedia("(min-width: 1280px)").matches
      ? 3
      : window.matchMedia("(min-width: 640px)").matches
        ? 2
        : 1;

/**
 * The typeface picker: similar fonts together, a filter by type, and only the
 * first few rows until "Show more" is pressed.
 */
export function FontPicker({
  value,
  onChange,
  onInspect,
}: {
  value: string;
  onChange: (id: string) => void;
  onInspect: (preset: FontPreset) => void;
}) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<FontCategory | "all">("all");
  const [expanded, setExpanded] = useState(false);
  const columns = useSyncExternalStore(
    subscribeToColumns,
    currentColumns,
    () => 3,
  );

  const shown =
    category === "all"
      ? FONT_PRESETS
      : FONT_PRESETS.filter((preset) => preset.category === category);
  const limit = COLLAPSED_ROWS * columns;
  const hidden = Math.max(0, shown.length - limit);
  const visible = expanded ? shown : shown.slice(0, limit);

  const chip = (active: boolean) =>
    cn(
      "focus-visible:ring-ring flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
      active
        ? "bg-surface text-foreground shadow-xs"
        : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
    );
  const pick = (next: FontCategory | "all") => {
    setCategory(next);
    // A new filter starts from the short list again.
    setExpanded(false);
  };

  return (
    <div className="space-y-3">
      <div
        role="group"
        aria-label={t("fontPicker.filterAria")}
        className="border-border bg-surface-sunken flex w-fit max-w-full flex-wrap items-center rounded-md border p-0.5"
      >
        <button
          type="button"
          aria-pressed={category === "all"}
          onClick={() => pick("all")}
          className={chip(category === "all")}
        >
          {t("fontPicker.all")}
          <span className="text-muted-foreground">{FONT_PRESETS.length}</span>
        </button>
        {FONT_CATEGORIES.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={category === value}
            onClick={() => pick(value)}
            className={chip(category === value)}
          >
            {value}
            <span className="text-muted-foreground">
              {
                FONT_PRESETS.filter((preset) => preset.category === value)
                  .length
              }
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((preset) => {
          const isSelected = value === preset.id;
          return (
            <div
              key={preset.id}
              onClick={() => onChange(preset.id)}
              className={cn(
                "focus-visible:ring-ring relative flex cursor-pointer flex-col justify-between rounded-xl border p-3.5 text-left transition-all duration-150 outline-none select-none focus-visible:ring-2",
                isSelected
                  ? "border-primary ring-primary/20 bg-surface-selected/80 shadow-xs ring-2"
                  : "border-border bg-surface hover:border-border-strong hover:bg-surface-hover/60",
              )}
              role="button"
              aria-pressed={isSelected}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onChange(preset.id);
                }
              }}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="text-foreground truncate text-sm font-semibold"
                    style={{ fontFamily: preset.cssFamily }}
                  >
                    {preset.name}
                  </span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onInspect(preset);
                      }}
                      className="text-muted-foreground hover:text-primary hover:bg-primary/10 cursor-pointer rounded-md p-1 transition-colors"
                      title={`Inspect ${preset.name} specimen`}
                      aria-label={`Inspect ${preset.name} font specimen`}
                    >
                      <Eye className="size-3.5" />
                    </button>
                    <span className="bg-surface-sunken border-border/60 text-muted-foreground rounded-full border px-1.5 py-0.5 text-[10px] font-medium tracking-wider uppercase">
                      {preset.category}
                    </span>
                    {isSelected ? (
                      <span className="bg-primary text-primary-foreground flex size-4 items-center justify-center rounded-full shadow-xs">
                        <Check className="size-2.5 stroke-[3]" />
                      </span>
                    ) : null}
                  </div>
                </div>
                <p className="text-muted-foreground mt-1 line-clamp-2 text-[11px] leading-relaxed">
                  {preset.description}
                </p>
              </div>

              <div
                className="border-border/50 text-foreground/90 mt-3 truncate border-t pt-2.5 text-xs font-normal"
                style={{ fontFamily: preset.cssFamily }}
              >
                {preset.sampleQuote}
              </div>
            </div>
          );
        })}
      </div>

      {hidden > 0 || expanded ? (
        <div className="flex justify-center">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
            className="text-primary hover:bg-primary-subtle focus-visible:ring-ring flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
          >
            {expanded ? (
              <>
                <ChevronUp className="size-4" aria-hidden />
                {t("fontPicker.showLess")}
              </>
            ) : (
              <>
                <ChevronDown className="size-4" aria-hidden />
                {t("fontPicker.showMore", { count: hidden })}
              </>
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
}
