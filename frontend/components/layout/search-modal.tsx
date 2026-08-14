"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { BookOpen, FileText, Grid2X2, Loader2, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { SearchResultPage, SearchResultSpace, SearchResults } from "@/types/api";

type SearchItem =
  | { kind: "space"; data: SearchResultSpace }
  | { kind: "page"; data: SearchResultPage };

export function SearchModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global Ctrl+K / Cmd+K keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  // Focus input when dialog opens & reset search state on close
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
      setResults(null);
      setSelectedIndex(0);
    }
  }, [open]);

  // Debounced search query fetching
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(() => {
      api
        .get<SearchResults>(`/api/v1/search?q=${encodeURIComponent(trimmed)}&limit=20`)
        .then((res) => {
          setResults(res);
          setSelectedIndex(0);
        })
        .catch(() => {
          setResults({ query: trimmed, pages: [], spaces: [] });
        })
        .finally(() => {
          setLoading(false);
        });
    }, 150);

    return () => clearTimeout(timer);
  }, [query]);

  // Flatten items for unified keyboard navigation
  const flatItems = useMemo<SearchItem[]>(() => {
    if (!results) return [];
    const items: SearchItem[] = [];
    for (const space of results.spaces) {
      items.push({ kind: "space", data: space });
    }
    for (const page of results.pages) {
      items.push({ kind: "page", data: page });
    }
    return items;
  }, [results]);

  const selectItem = useCallback(
    (item: SearchItem) => {
      onOpenChange(false);
      if (item.kind === "space") {
        router.push(`/spaces/${encodeURIComponent(item.data.key)}`);
      } else {
        router.push(
          `/spaces/${encodeURIComponent(item.data.space_key)}/${encodeURIComponent(item.data.slug)}`,
        );
      }
    },
    [onOpenChange, router],
  );

  // Keyboard navigation inside search results
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!flatItems.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % flatItems.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + flatItems.length) % flatItems.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (flatItems[selectedIndex]) {
        selectItem(flatItems[selectedIndex]);
      }
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/50 backdrop-blur-xs",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "border-border bg-surface fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-2xl",
            "-translate-x-1/2 rounded-xl border shadow-2xl outline-none",
            "flex max-h-[75vh] flex-col overflow-hidden",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
          )}
          onKeyDown={handleKeyDown}
        >
          {/* Header Search Input */}
          <div className="border-border flex items-center border-b px-4 py-3">
            <Search className="text-muted-foreground mr-3 size-5 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search spaces, page titles, and content..."
              className="text-foreground placeholder:text-muted-foreground w-full bg-transparent text-base outline-none"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-muted-foreground hover:text-foreground mr-2 cursor-pointer rounded p-1"
                aria-label="Clear search query"
              >
                <X className="size-4" />
              </button>
            ) : null}
            <kbd className="border-border text-muted-foreground bg-surface-sunken hidden rounded border px-1.5 py-0.5 font-mono text-xs sm:inline">
              ESC
            </kbd>
          </div>

          {/* Results List or Empty States */}
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {loading ? (
              <div className="text-muted-foreground flex items-center justify-center py-12 text-sm">
                <Loader2 className="mr-2 size-5 animate-spin text-primary" />
                Searching WikiHub...
              </div>
            ) : !query.trim() ? (
              <div className="text-muted-foreground py-12 text-center text-sm">
                <p className="font-medium text-foreground">Quick Search WikiHub</p>
                <p className="mt-1 text-xs">
                  Type a space handle, page title, or keyword to find documentation instantly.
                </p>
              </div>
            ) : results && flatItems.length === 0 ? (
              <div className="text-muted-foreground py-12 text-center text-sm">
                No spaces or pages matched &ldquo;<span className="text-foreground font-medium">{query}</span>&rdquo;
              </div>
            ) : (
              <div className="space-y-4 py-1">
                {/* Spaces Section */}
                {results?.spaces && results.spaces.length > 0 ? (
                  <div>
                    <div className="text-muted-foreground px-3 py-1.5 text-[11px] font-semibold tracking-wider uppercase">
                      Spaces ({results.spaces.length})
                    </div>
                    <ul className="space-y-1">
                      {results.spaces.map((space) => {
                        const itemIndex = flatItems.findIndex(
                          (i) => i.kind === "space" && i.data.id === space.id,
                        );
                        const isSelected = itemIndex === selectedIndex;
                        return (
                          <li key={space.id}>
                            <button
                              type="button"
                              onClick={() => selectItem({ kind: "space", data: space })}
                              onMouseEnter={() => setSelectedIndex(itemIndex)}
                              className={cn(
                                "flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors duration-150",
                                isSelected
                                  ? "bg-surface-selected text-primary"
                                  : "hover:bg-surface-hover text-foreground",
                              )}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <Grid2X2 className="size-4 shrink-0 text-muted-foreground" />
                                <span className="font-medium text-sm truncate">{space.name}</span>
                                {space.description ? (
                                  <span className="text-muted-foreground text-xs truncate max-w-xs">
                                    — {space.description}
                                  </span>
                                ) : null}
                              </div>
                              <Badge variant="subtle" className="shrink-0 font-mono text-[11px]">
                                {space.key}
                              </Badge>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}

                {/* Pages Section */}
                {results?.pages && results.pages.length > 0 ? (
                  <div>
                    <div className="text-muted-foreground px-3 py-1.5 text-[11px] font-semibold tracking-wider uppercase">
                      Pages ({results.pages.length})
                    </div>
                    <ul className="space-y-1">
                      {results.pages.map((page) => {
                        const itemIndex = flatItems.findIndex(
                          (i) => i.kind === "page" && i.data.id === page.id,
                        );
                        const isSelected = itemIndex === selectedIndex;
                        return (
                          <li key={page.id}>
                            <button
                              type="button"
                              onClick={() => selectItem({ kind: "page", data: page })}
                              onMouseEnter={() => setSelectedIndex(itemIndex)}
                              className={cn(
                                "flex w-full cursor-pointer items-start justify-between rounded-lg px-3 py-2.5 text-left transition-colors duration-150",
                                isSelected
                                  ? "bg-surface-selected text-primary"
                                  : "hover:bg-surface-hover text-foreground",
                              )}
                            >
                              <div className="flex items-start gap-3 min-w-0 flex-1 pr-3">
                                <FileText className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
                                <div className="min-w-0 flex-1">
                                  <div className="font-medium text-sm truncate">{page.title}</div>
                                  {page.snippet ? (
                                    <div className="text-muted-foreground mt-0.5 text-xs line-clamp-2 leading-relaxed">
                                      {page.snippet}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                              <div className="flex flex-col items-end shrink-0 gap-1">
                                <Badge variant="subtle" className="font-mono text-[11px]">
                                  {page.space_key}
                                </Badge>
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {/* Footer keyboard hint */}
          <div className="border-border bg-surface-sunken text-muted-foreground flex items-center justify-between border-t px-4 py-2 text-[11px]">
            <div className="flex items-center gap-3">
              <span>
                <kbd className="border-border bg-surface rounded border px-1 font-mono">↑</kbd>{" "}
                <kbd className="border-border bg-surface rounded border px-1 font-mono">↓</kbd> to navigate
              </span>
              <span>
                <kbd className="border-border bg-surface rounded border px-1 font-mono">↵</kbd> to select
              </span>
            </div>
            <span>
              <kbd className="border-border bg-surface rounded border px-1 font-mono">ESC</kbd> to close
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
