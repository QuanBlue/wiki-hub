"use client";

import { Grid2X2, Search, Star, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { SpaceCard } from "@/components/spaces/space-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Space } from "@/types/api";

export function SpacesExplorer({ spaces }: { spaces: Space[] }) {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") === "starred" ? "starred" : "all";
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"all" | "starred">(initialTab);

  const starredCount = useMemo(
    () => spaces.filter((s) => s.is_favorite).length,
    [spaces],
  );

  const filteredSpaces = useMemo(() => {
    let result = spaces;

    if (tab === "starred") {
      result = result.filter((s) => s.is_favorite);
    }

    const trimmed = query.trim().toLowerCase();
    if (trimmed) {
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(trimmed) ||
          s.key.toLowerCase().includes(trimmed) ||
          (s.description && s.description.toLowerCase().includes(trimmed)),
      );
    }

    return result;
  }, [spaces, tab, query]);

  return (
    <div className="space-y-4">
      {/* Search & Filter Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Search Input */}
        <div className="relative min-w-0 flex-1 max-w-md">
          <Search className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter spaces by name, key, or description..."
            className="border-border bg-surface-sunken placeholder:text-muted-foreground focus-visible:ring-ring text-foreground w-full rounded-md border py-1.5 pr-8 pl-9 text-xs outline-none focus-visible:ring-2"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-muted-foreground hover:text-foreground absolute right-2 top-1/2 -translate-y-1/2 rounded p-1"
              aria-label="Clear space search"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

        {/* Filter Tabs & Count Badge */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="border-border bg-surface-sunken flex items-center rounded-md border p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setTab("all")}
              className={cn(
                "flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors duration-150 cursor-pointer",
                tab === "all"
                  ? "bg-surface text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Grid2X2 className="size-3.5" />
              <span>All ({spaces.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setTab("starred")}
              className={cn(
                "flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors duration-150 cursor-pointer",
                tab === "starred"
                  ? "bg-surface text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Star className="size-3.5" />
              <span>Starred ({starredCount})</span>
            </button>
          </div>

          <Badge variant="subtle" className="font-mono text-[11px] hidden sm:inline-flex">
            {filteredSpaces.length} of {spaces.length} spaces
          </Badge>
        </div>
      </div>

      {/* Grid of Spaces */}
      {filteredSpaces.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredSpaces.map((space) => (
            <SpaceCard key={space.id} space={space} />
          ))}
        </div>
      ) : (
        <div className="border-border bg-surface text-muted-foreground rounded-lg border border-dashed p-8 text-center">
          {query ? (
            <div className="space-y-2">
              <p className="text-foreground font-semibold text-sm">
                No spaces matched &ldquo;{query}&rdquo;
              </p>
              <p className="text-xs">Try adjusting your search query or switching tabs.</p>
              <div className="pt-2">
                <Button size="sm" variant="secondary" onClick={() => setQuery("")}>
                  Clear search filter
                </Button>
              </div>
            </div>
          ) : tab === "starred" ? (
            <div className="space-y-1">
              <p className="text-foreground font-semibold text-sm">No starred spaces yet</p>
              <p className="text-xs">Click the star icon on any space card to add it to your favourites.</p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-foreground font-semibold text-sm">No spaces available</p>
              <p className="text-xs">Create your first space to start organising documentation.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
