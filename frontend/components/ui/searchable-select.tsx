"use client";

import { ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { RemoveScroll } from "react-remove-scroll";

import { inputClassName } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface SearchableSelectItem {
  value: string;
  label: string;
  /** Extra text to match against, e.g. a username alongside a display name. Defaults to `label`. */
  searchText?: string;
  disabled?: boolean;
  badge?: React.ReactNode;
}

/**
 * A `<Select>`-alike for lists too long to scan by eye - a filter box narrows
 * the options as you type instead of relying on scroll-and-scan or Radix's
 * one-letter-at-a-time type-ahead. Same trigger styling as `Select`
 * (`inputClassName` + a trailing chevron) so it drops in wherever a plain
 * select would go. See `TimezoneCombobox` for the pattern this generalizes.
 */
export function SearchableSelect({
  id,
  items,
  value,
  onValueChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyMessage = "No matches.",
  disabled = false,
  triggerClassName,
}: {
  id?: string;
  items: SearchableSelectItem[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Index into `results` (skipping disabled rows), for arrow-key navigation.
  const [highlighted, setHighlighted] = useState(0);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => (item.searchText ?? item.label).toLowerCase().includes(needle));
  }, [items, query]);

  // A fresh query (or a freshly opened list) always starts highlighting the
  // first row, so Enter immediately after typing picks the top match.
  useEffect(() => {
    setHighlighted(0);
  }, [query, open]);

  useEffect(() => {
    optionRefs.current[highlighted]?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  function moveHighlight(delta: number) {
    if (results.length === 0) return;
    setHighlighted((current) => {
      let next = current;
      // Step past disabled rows rather than landing (and getting stuck) on
      // one - Enter on a disabled row is a no-op below anyway, but skipping
      // it here keeps the highlight itself meaningful.
      for (let step = 0; step < results.length; step += 1) {
        next = (next + delta + results.length) % results.length;
        if (!results[next]?.disabled) break;
      }
      return next;
    });
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveHighlight(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = results[highlighted];
      if (!item || item.disabled) return;
      onValueChange(item.value);
      setOpen(false);
    } else if (event.key === "Escape") {
      // Radix's own dismissable-layer handling would eventually close this
      // too, but handling it directly here means one Esc always exits the
      // filter instead of first needing to clear a stray keystroke.
      event.preventDefault();
      setOpen(false);
    }
  }

  const selected = items.find((item) => item.value === value);
  const searchId = `${id ?? "searchable-select"}-search`;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          className={cn(
            inputClassName,
            "flex cursor-pointer items-center justify-between gap-2 text-left",
            "disabled:pointer-events-none",
            triggerClassName,
          )}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronDown aria-hidden className="text-muted-foreground size-4 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-56 p-0"
        onOpenAutoFocus={(event) => {
          // The search input, not the popover panel itself, should have
          // focus the instant this opens - typing to narrow the list is the
          // entire point of a searchable select over a plain <Select>.
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
            role="searchbox"
            aria-label={searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={searchPlaceholder}
            className="bg-surface h-8 w-full rounded-md py-1 pr-2 pl-7 text-sm focus-visible:outline-none"
          />
        </div>
        {/* Short enough to reliably fit below a trigger sitting low in a
            dialog, since Popper flips this above the trigger - covering
            whatever's above it - when a taller cap doesn't fit below. */}
        <RemoveScroll
          as="div"
          removeScrollBar={false}
          className="max-h-56 overflow-y-auto overscroll-contain p-1"
        >
          {/* This list opening from *inside* a modal Dialog is the normal
              case (both `EditSpaceModal` and `PageRestrictionsDialog` use
              this), and that Dialog's own scroll lock only recognises a
              scrollable region as "inside" itself via a real DOM
              ancestor check - this popover is portaled to `document.body`,
              a sibling of the dialog, not a descendant, so without this
              `RemoveScroll` the lock reads any wheel/touch here as trying
              to scroll the page behind the dialog and blocks it (dragging
              the scrollbar thumb still worked, since that never fires a
              `wheel` event - which is what made this so easy to miss).
              Nesting a second, independent `RemoveScroll` instance here
              works because the library tracks locks on a stack and only
              the top (most recently mounted) one is enforced - re-parenting
              this element into the dialog's own DOM subtree instead would
              "fix" the same bug, but Radix positions this with `position:
              fixed`, and `DialogContent` animates in with a CSS `transform`
              - which makes it a `fixed` containing block for anything
              inside it, breaking this popover's positioning entirely. */}
          {results.length ? (
            results.map((item, index) => (
              <button
                key={item.value}
                ref={(el) => {
                  optionRefs.current[index] = el;
                }}
                type="button"
                disabled={item.disabled}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => {
                  onValueChange(item.value);
                  setOpen(false);
                }}
                className={cn(
                  "hover:bg-surface-hover relative flex w-full cursor-pointer items-center justify-between gap-2 rounded-md py-2 pr-2.5 pl-2.5 text-left text-sm transition-colors duration-150",
                  "disabled:pointer-events-none disabled:opacity-40",
                  index === highlighted && "bg-surface-hover",
                )}
              >
                <span className="truncate">{item.label}</span>
                {item.badge}
              </button>
            ))
          ) : (
            <p className="text-muted-foreground p-3 text-center text-xs">{emptyMessage}</p>
          )}
        </RemoveScroll>
      </PopoverContent>
    </Popover>
  );
}
