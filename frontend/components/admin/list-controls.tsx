"use client";

import { ChevronLeft, ChevronRight, Loader2, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Filter and pagination controls that write their state into the URL.
 *
 * `searchParams` rather than component state on purpose: the server component
 * reads the filters, so a `router.refresh()` after a mutation re-renders the
 * *current* filtered page. It also makes a filtered view linkable and keeps the
 * back button working.
 */

interface FilterOption {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
}

function useParamWriter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Without this, every write - one per debounced keystroke while
  // searching - re-suspends the `<Suspense>` these controls sit in (it needs
  // one for `useSearchParams`) until the new server-rendered page streams
  // back in, blanking the search box and filters for a moment each time:
  // exactly the flicker this was reported for. Marking the navigation as a
  // transition keeps the current UI on screen while the next one loads.
  const [isPending, startTransition] = useTransition();

  const write = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      // Any filter change invalidates the current page.
      if (!("offset" in updates)) next.delete("offset");
      const qs = next.toString();
      startTransition(() => {
        const navigate = (router.replace ?? router.push).bind(router);
        navigate(qs ? `${pathname}?${qs}` : pathname);
      });
    },
    [router, pathname, searchParams],
  );

  return Object.assign(write, { isPending });
}

export function ListFilters({
  searchValue,
  searchPlaceholder = "Search…",
  filters = [],
}: {
  searchValue: string;
  searchPlaceholder?: string;
  filters?: FilterOption[];
}) {
  const write = useParamWriter();
  const isPending = (write as { isPending?: boolean }).isPending ?? false;
  const writeRef = useRef(write);
  writeRef.current = write;

  const [term, setTerm] = useState(searchValue);
  const [prevSearchValue, setPrevSearchValue] = useState(searchValue);
  const lastDispatchedRef = useRef<string>(searchValue);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  // Keep the box in step when the URL changes from elsewhere (back button, a
  // filter reset, or external navigation) without fighting the user while they type.
  // If the new searchValue equals what we just dispatched, it's an echo from our
  // own typing/debouncing and must NOT overwrite the user's active input.
  if (searchValue !== prevSearchValue) {
    setPrevSearchValue(searchValue);
    if (searchValue !== lastDispatchedRef.current) {
      lastDispatchedRef.current = searchValue;
      setTerm(searchValue);
    }
  }

  // Realtime search: debounce URL updates so typing filters automatically.
  // Using writeRef ensures an in-flight server response arriving does not
  // restart or cancel the user's pending debounce timer.
  useEffect(() => {
    const trimmed = term.trim();
    if (trimmed === (searchValue || "").trim()) return;

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      lastDispatchedRef.current = trimmed;
      writeRef.current({ q: trimmed || null });
    }, 300);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [term, searchValue]);

  const handleClear = () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    setTerm("");
    lastDispatchedRef.current = "";
    writeRef.current({ q: null });
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const trimmed = term.trim();
    lastDispatchedRef.current = trimmed;
    writeRef.current({ q: trimmed || null });
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <form
        className="flex items-end gap-2"
        onSubmit={handleSubmit}
      >
        <div className="relative">
          {isPending ? (
            <Loader2 className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 animate-spin" />
          ) : (
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          )}
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="w-56 pr-8 pl-8"
          />
          {term ? (
            <button
              type="button"
              onClick={handleClear}
              className="text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring absolute top-1/2 right-2 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {filters.map((filter) => (
        <div key={filter.name} className="min-w-36">
          <Select
            value={filter.value || "__all__"}
            onValueChange={(value) => write({ [filter.name]: value === "__all__" ? null : value })}
          >
            <SelectTrigger aria-label={filter.label}>
              <SelectValue>
                {filter.value
                  ? filter.options.find((option) => option.value === filter.value)?.label ?? filter.value
                  : `${filter.label}: all`}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{filter.label}: all</SelectItem>
              {filter.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  );
}

/**
 * The footer of an admin table: how many rows are shown, the rows-per-page choice,
 * the page number and previous/next. It only draws; `PaginationControls` feeds it from
 * the URL and a table that pages in memory feeds it from its own state.
 */
export function PaginationBar({
  total,
  limit,
  offset,
  pageSizes,
  onLimitChange,
  onOffsetChange,
}: {
  total: number;
  limit: number;
  offset: number;
  pageSizes?: number[];
  onLimitChange: (limit: number) => void;
  onOffsetChange: (offset: number) => void;
}) {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  const hasPrevious = offset > 0;
  const hasNext = offset + limit < total;
  const page = total === 0 ? 0 : Math.floor(offset / limit) + 1;
  const pageCount = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-muted-foreground text-sm" aria-live="polite">
        {total === 0 ? "No results" : `Showing ${from}–${to} of ${total}`}
      </p>
      <div className="flex items-center gap-2">
        {pageSizes ? (
          <div className="flex items-center gap-2">
            <label htmlFor="page-size" className="text-muted-foreground text-xs">
              Rows per page
            </label>
            <Select
              value={String(limit)}
              onValueChange={(value) => onLimitChange(Number(value))}
            >
              <SelectTrigger id="page-size" className="h-8 w-20" aria-label="Rows per page">
                <SelectValue>{limit}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {pageSizes.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <span className="text-muted-foreground hidden text-xs sm:inline">
          Page {page} of {pageCount}
        </span>
        <span className="border-border h-5 border-l" aria-hidden />
        <Button
          variant="secondary"
          size="icon"
          disabled={!hasPrevious}
          onClick={() => onOffsetChange(Math.max(0, offset - limit))}
          aria-label="Previous page"
          title="Previous page"
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          disabled={!hasNext}
          onClick={() => onOffsetChange(offset + limit)}
          aria-label="Next page"
          title="Next page"
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

export function PaginationControls({
  total,
  limit,
  offset,
  pageSizes,
}: {
  total: number;
  limit: number;
  offset: number;
  pageSizes?: number[];
}) {
  const write = useParamWriter();

  return (
    <PaginationBar
      total={total}
      limit={limit}
      offset={offset}
      pageSizes={pageSizes}
      onLimitChange={(value) => write({ limit: String(value) })}
      onOffsetChange={(value) => write({ offset: String(value) })}
    />
  );
}
