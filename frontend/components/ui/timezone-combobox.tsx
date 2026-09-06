"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { inputClassName } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { searchTimezones, timezoneDisplayLabel, TIMEZONE_IDS } from "@/lib/timezones";
import { cn } from "@/lib/utils";

/**
 * A searchable IANA time zone picker - the flat list runs to 400+ entries,
 * long enough that a plain `<Select>` (built for a couple dozen choices at
 * most, no way to jump to one by typing more than its first letter) is the
 * wrong tool once there are this many.
 *
 * Same trigger styling as `Select` (`inputClassName` + a trailing chevron)
 * so it drops into a field grid next to a real `<Select>` without looking
 * like a different kind of control.
 */
export function TimezoneCombobox({
  id,
  value,
  onValueChange,
  disabled = false,
}: {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // The canonical list `Intl.supportedValuesOf` returns omits some still-
  // valid IANA names ("Asia/Ho_Chi_Minh" resolves to the same zone as the
  // canonical "Asia/Saigon", but is not itself in that list) - a value
  // already saved under one of those names must stay visible and
  // selectable here, not silently vanish from the list the moment this
  // control renders it.
  const zones = useMemo(
    () => (value && !TIMEZONE_IDS.includes(value) ? [value, ...TIMEZONE_IDS] : TIMEZONE_IDS),
    [value],
  );
  const results = useMemo(() => searchTimezones(query, zones), [query, zones]);

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
          )}
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? timezoneDisplayLabel(value) : "Select timezone…"}
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
          // entire point of a combobox over a plain <Select>.
          event.preventDefault();
          document.getElementById(`${id ?? "timezone"}-search`)?.focus();
        }}
      >
        <div className="border-border relative border-b p-1.5">
          <Search
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2"
          />
          <input
            id={`${id ?? "timezone"}-search`}
            type="text"
            role="searchbox"
            aria-label="Search time zones"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search a city or UTC offset…"
            className="bg-surface h-8 w-full rounded-md py-1 pr-2 pl-7 text-sm focus-visible:outline-none"
          />
        </div>
        <div className="max-h-64 overflow-y-auto overscroll-contain p-1">
          {results.length ? (
            results.map((zone) => (
              <button
                key={zone}
                type="button"
                onClick={() => {
                  onValueChange(zone);
                  setOpen(false);
                }}
                className={cn(
                  "hover:bg-surface-hover relative flex w-full cursor-pointer items-center justify-between gap-2 rounded-md py-2 pr-8 pl-2.5 text-left text-sm transition-colors duration-150",
                )}
              >
                <span className="truncate">{zone.replaceAll("_", " ")}</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {timezoneDisplayLabel(zone).match(/\(([^)]+)\)$/)?.[1]}
                </span>
                {zone === value ? (
                  <Check
                    aria-hidden
                    className="text-primary absolute right-2.5 size-4 shrink-0"
                  />
                ) : null}
              </button>
            ))
          ) : (
            <p className="text-muted-foreground p-3 text-center text-xs">
              No matching time zone.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
