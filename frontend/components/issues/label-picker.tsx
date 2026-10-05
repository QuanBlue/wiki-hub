"use client";

import { ChevronDown, Search, Tag } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { LabelDot } from "@/components/issues/label-chip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useTranslation } from "@/lib/i18n/context";
import { ISSUE_LABELS, NO_LABEL } from "@/lib/issue-labels";
import { cn } from "@/lib/utils";

/**
 * "Filter by label" / "Labels": a searchable list of checkboxes, each with its
 * colour, name and one-line meaning. It stays open while ticking, so several
 * labels can be chosen in one go. `allowNone` adds the "No labels" row (used
 * by the list filter, not when reporting).
 */
export function LabelPicker({
  selected,
  onChange,
  allowNone,
  title,
  trigger,
  triggerClassName,
  align = "start",
  disabled,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  allowNone?: boolean;
  title: string;
  trigger?: React.ReactNode;
  triggerClassName?: string;
  align?: "start" | "center" | "end";
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const searchId = `${listId}-search`;

  const rows = useMemo(() => {
    const all = [
      ...(allowNone
        ? [
            {
              value: NO_LABEL,
              name: t("issueLabels.none"),
              description: "",
              color: null as string | null,
            },
          ]
        : []),
      ...ISSUE_LABELS.map((label) => ({
        value: label.slug,
        name: t(`issueLabels.${label.key}`),
        description: t(`issueLabels.${label.key}Description`),
        color: label.color as string | null,
      })),
    ];
    const needle = query.trim().toLowerCase();
    return needle
      ? all.filter((row) =>
          `${row.name} ${row.description}`.toLowerCase().includes(needle),
        )
      : all;
  }, [allowNone, query, t]);

  function toggle(value: string) {
    const has = selected.includes(value);
    if (value === NO_LABEL) {
      // "No labels" excludes every real label.
      onChange(has ? [] : [NO_LABEL]);
      return;
    }
    const without = selected.filter((item) => item !== NO_LABEL);
    onChange(
      has ? without.filter((item) => item !== value) : [...without, value],
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          setActive(0);
        }
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          "text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
          "data-[state=open]:bg-surface-selected",
          triggerClassName,
        )}
      >
        {trigger ?? (
          <>
            <Tag className="size-3.5" aria-hidden />
            {title}
          </>
        )}
        {selected.length > 0 ? (
          <span className="bg-primary-subtle text-primary rounded-full px-1.5 text-[11px] font-semibold">
            {selected.length}
          </span>
        ) : null}
        <ChevronDown className="size-3.5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-72 p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById(searchId)?.focus();
        }}
      >
        <div className="border-border relative border-b p-1.5">
          <Search
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2"
          />
          <input
            id={searchId}
            type="text"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-label={title}
            placeholder={t("issueLabels.filterPlaceholder")}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (rows.length === 0) return;
                const step = event.key === "ArrowDown" ? 1 : -1;
                setActive(
                  (current) => (current + step + rows.length) % rows.length,
                );
              } else if (event.key === "Enter") {
                event.preventDefault();
                const row = rows[active];
                if (row) toggle(row.value);
              } else if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
              }
            }}
            className="bg-surface h-8 w-full rounded-md py-1 pr-2 pl-7 text-sm focus-visible:outline-none"
          />
        </div>
        <ul
          id={listId}
          role="listbox"
          aria-label={title}
          aria-multiselectable
          className="max-h-72 overflow-y-auto overscroll-contain p-1"
        >
          {rows.length === 0 ? (
            <li className="text-muted-foreground p-3 text-center text-xs">
              {t("issueLabels.noMatch")}
            </li>
          ) : (
            rows.map((row, index) => {
              const checked = selected.includes(row.value);
              return (
                <li
                  key={row.value}
                  role="option"
                  aria-selected={checked}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => toggle(row.value)}
                  className={cn(
                    "hover:bg-surface-hover flex cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors duration-150",
                    index === active && "bg-surface-hover",
                  )}
                >
                  <input
                    type="checkbox"
                    tabIndex={-1}
                    readOnly
                    checked={checked}
                    aria-label={row.name}
                    className="accent-primary pointer-events-none mt-0.5 size-4 shrink-0"
                  />
                  {row.color ? (
                    <LabelDot color={row.color} className="mt-1" />
                  ) : (
                    <span
                      aria-hidden
                      className="border-border mt-1 inline-block size-3 shrink-0 rounded-full border"
                    />
                  )}
                  <span className="min-w-0">
                    <span className="block font-medium">{row.name}</span>
                    {row.description ? (
                      <span className="text-muted-foreground block text-xs">
                        {row.description}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
