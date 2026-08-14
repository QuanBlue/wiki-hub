"use client";

import { ArrowRight, Grid2X2, Search, Star, Users, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { SpaceCard } from "@/components/spaces/space-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { Space } from "@/types/api";

function SpaceRow({ space }: { space: Space }) {
  const router = useRouter();
  const [favorite, setFavorite] = useState(space.is_favorite);
  const [pending, setPending] = useState(false);

  async function toggleFavorite(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    const next = !favorite;
    setFavorite(next);
    setPending(true);
    try {
      const path = `/api/v1/spaces/${encodeURIComponent(space.key)}/favorite`;
      if (next) await api.put<void>(path);
      else await api.delete<void>(path);
      router.refresh();
    } catch {
      setFavorite(!next);
      toast.error("Could not update favourites.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Link
      href={`/spaces/${encodeURIComponent(space.key)}`}
      className="border-border group flex min-w-0 items-center gap-3 border-b px-4 py-3 last:border-b-0 transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span className="bg-primary-subtle flex size-9 shrink-0 items-center justify-center rounded-md text-lg">
        {space.icon || "📄"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-foreground truncate text-sm font-medium group-hover:text-primary">{space.name}</span>
          <Badge variant="neutral" className="hidden font-mono text-[10px] sm:inline-flex">{space.key}</Badge>
        </span>
        <span className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
          <Users className="size-3.5" />
          {space.member_count} {space.member_count === 1 ? "member" : "members"}
          {space.description ? <><span aria-hidden>·</span><span className="truncate">{space.description}</span></> : null}
        </span>
      </span>
      <button
        type="button"
        onClick={toggleFavorite}
        disabled={pending}
        aria-label={favorite ? `Remove ${space.name} from favourites` : `Add ${space.name} to favourites`}
        aria-pressed={favorite}
        className={cn("cursor-pointer rounded-md p-2 transition-colors duration-150 hover:bg-surface-selected focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", favorite ? "text-warning" : "text-muted-foreground hover:text-foreground")}
      >
        <Star className={cn("size-4", favorite && "fill-current")} />
      </button>
      <ArrowRight className="text-muted-foreground size-4 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-primary" />
    </Link>
  );
}

export function SpacesExplorer({ spaces }: { spaces: Space[] }) {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") === "starred" ? "starred" : "all";
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"all" | "starred">(initialTab);

  const starredCount = useMemo(() => spaces.filter((space) => space.is_favorite).length, [spaces]);
  const featuredSpaces = useMemo(() => {
    const starred = spaces.filter((space) => space.is_favorite);
    return (starred.length > 0 ? starred : spaces).slice(0, 4);
  }, [spaces]);
  const filteredSpaces = useMemo(() => {
    let result = tab === "starred" ? spaces.filter((space) => space.is_favorite) : spaces;
    const trimmed = query.trim().toLowerCase();
    if (trimmed) result = result.filter((space) => space.name.toLowerCase().includes(trimmed) || space.key.toLowerCase().includes(trimmed) || space.description.toLowerCase().includes(trimmed));
    return result;
  }, [spaces, tab, query]);

  return (
    <div className="space-y-8">
      <section aria-labelledby="your-spaces-heading" className="space-y-3">
        <div className="flex items-end justify-between gap-3"><div><h2 id="your-spaces-heading" className="text-xl font-semibold tracking-tight">Your spaces</h2><p className="text-muted-foreground mt-0.5 text-xs">Quick access to the spaces you use most.</p></div><Link href="#all-spaces" className="text-primary hover:text-primary-hover inline-flex items-center gap-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Show all <ArrowRight className="size-4" /></Link></div>
        {featuredSpaces.length > 0 ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{featuredSpaces.map((space) => <SpaceCard key={space.id} space={space} />)}</div> : <div className="border-border bg-surface rounded-lg border border-dashed p-6 text-center"><p className="text-sm font-medium">No spaces yet</p><p className="text-muted-foreground mt-1 text-xs">Create a space to give your team’s knowledge a home.</p></div>}
      </section>

      <section id="all-spaces" aria-labelledby="all-spaces-heading" className="space-y-3">
        <div><h2 id="all-spaces-heading" className="text-2xl font-semibold tracking-tight">All spaces</h2><p className="text-muted-foreground mt-0.5 text-xs">Browse every shared home available to you.</p></div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-sm"><Search className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" /><input type="text" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by title or key" className="border-border bg-surface-sunken placeholder:text-muted-foreground hover:border-border-strong focus-visible:ring-ring text-foreground w-full rounded-md border py-2 pr-8 pl-9 text-sm outline-none focus-visible:ring-2" />{query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear space search" className="text-muted-foreground hover:text-foreground absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="size-3.5" /></button> : null}</div>
          <div className="flex items-center gap-2"><div className="border-border bg-surface-sunken flex items-center rounded-md border p-0.5 text-xs"><button type="button" onClick={() => setTab("all")} className={cn("flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1.5 font-medium transition-colors duration-150", tab === "all" ? "bg-surface text-foreground shadow-xs font-semibold" : "text-muted-foreground hover:bg-surface-hover hover:text-foreground") }><Grid2X2 className="size-3.5" />All ({spaces.length})</button><button type="button" onClick={() => setTab("starred")} className={cn("flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1.5 font-medium transition-colors duration-150", tab === "starred" ? "bg-surface text-foreground shadow-xs font-semibold" : "text-muted-foreground hover:bg-surface-hover hover:text-foreground")}><Star className="size-3.5" />Starred ({starredCount})</button></div><Badge variant="subtle" className="hidden font-mono text-[11px] sm:inline-flex">{filteredSpaces.length} spaces</Badge></div>
        </div>

        {filteredSpaces.length > 0 ? <div className="border-border bg-surface overflow-hidden rounded-lg border">{filteredSpaces.map((space) => <SpaceRow key={space.id} space={space} />)}</div> : <div className="border-border bg-surface text-muted-foreground rounded-lg border border-dashed p-8 text-center"><p className="text-foreground text-sm font-semibold">{query ? `No spaces matched “${query}”` : tab === "starred" ? "No starred spaces yet" : "No spaces available"}</p><p className="mt-1 text-xs">{query ? "Try a different search term or clear the filter." : "Create a space to start organising documentation."}</p>{query ? <Button size="sm" variant="secondary" className="mt-3" onClick={() => setQuery("")}>Clear search</Button> : null}</div>}
      </section>
    </div>
  );
}
