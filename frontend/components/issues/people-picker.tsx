"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useId, useMemo, useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface PickerOption {
  value: string;
  /** The bold part: a username, or a short phrase like "Assigned to me". */
  primary: string;
  /** The quieter part after it: the person's full name. */
  secondary?: string;
}

/**
 * A filterable list in a popover - "Filter by author", "Apply assignees".
 *
 * A search box on top, then rows: the one that is selected is ticked, the one
 * under the pointer or arrow keys is highlighted, and Enter or a click picks
 * it. The caller decides what picking means (set a filter, clear it, assign).
 */
export function PeoplePicker({
  trigger,
  triggerClassName,
  title,
  filterPlaceholder,
  noMatch,
  options,
  selected,
  onPick,
  align = "end",
  disabled,
}: {
  trigger: React.ReactNode;
  triggerClassName?: string;
  title: string;
  filterPlaceholder: string;
  noMatch: string;
  options: PickerOption[];
  selected: string | null;
  onPick: (value: string) => void;
  align?: "start" | "center" | "end";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const searchId = `${listId}-search`;

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      `${option.primary} ${option.secondary ?? ""}`
        .toLowerCase()
        .includes(needle),
    );
  }, [options, query]);

  function pick(value: string) {
    onPick(value);
    setOpen(false);
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
        {trigger}
        <ChevronDown className="size-3.5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-64 p-0"
        onOpenAutoFocus={(event) => {
          // Typing to narrow the list is the point: focus goes to the search
          // box, not the panel.
          event.preventDefault();
          document.getElementById(searchId)?.focus();
        }}
      >
        {/* The same shape as every other searchable list in the app (see
            SearchableSelect): a search row, a rule, then plain rows. */}
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
            placeholder={filterPlaceholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (shown.length === 0) return;
                const step = event.key === "ArrowDown" ? 1 : -1;
                setActive(
                  (current) => (current + step + shown.length) % shown.length,
                );
              } else if (event.key === "Enter") {
                event.preventDefault();
                const option = shown[active];
                if (option) pick(option.value);
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
          className="max-h-56 overflow-y-auto overscroll-contain p-1"
        >
          {shown.length === 0 ? (
            <li className="text-muted-foreground p-3 text-center text-xs">
              {noMatch}
            </li>
          ) : (
            shown.map((option, index) => (
              <li
                key={option.value}
                role="option"
                aria-selected={option.value === selected}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(option.value)}
                className={cn(
                  "hover:bg-surface-hover flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm transition-colors duration-150",
                  index === active && "bg-surface-hover",
                )}
              >
                <span className="min-w-0 truncate">
                  <span className="font-medium">{option.primary}</span>
                  {option.secondary ? (
                    <span className="text-muted-foreground ml-2 text-xs">
                      {option.secondary}
                    </span>
                  ) : null}
                </span>
                {option.value === selected ? (
                  <Check className="text-primary size-4 shrink-0" aria-hidden />
                ) : null}
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
