"use client";

import {
  ChevronLeft,
  ChevronRight,
  Globe2,
  Grid2X2,
  Lock,
  Pencil,
  Search,
  Star,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EditSpaceModal } from "@/components/admin/edit-space-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { Space } from "@/types/api";

function FavoriteButton({
  space,
  favorite,
  pending,
  onToggle,
}: {
  space: Space;
  favorite: boolean;
  pending: boolean;
  onToggle: (event: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={pending}
      aria-label={favorite ? "Remove " + space.name + " from favourites" : "Add " + space.name + " to favourites"}
      aria-pressed={favorite}
      className={cn(
        "focus-visible:ring-ring cursor-pointer rounded-md p-2 transition-colors duration-150 hover:bg-surface-selected focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        favorite ? "text-warning" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Star className={cn("size-4", favorite && "fill-current")} />
    </button>
  );
}

function SpaceDirectoryRow({ space }: { space: Space }) {
  const router = useRouter();
  const [favorite, setFavorite] = useState(space.is_favorite);
  const [pending, setPending] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const href = "/spaces/" + encodeURIComponent(space.key);

  async function toggleFavorite(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    const next = !favorite;
    setFavorite(next);
    setPending(true);
    try {
      const path = "/api/v1/spaces/" + encodeURIComponent(space.key) + "/favorite";
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
    <>
      <Link
        href={href}
        className="border-border group grid min-w-0 grid-cols-[minmax(0,1fr)_7.5rem_5.5rem_auto] items-center gap-3 border-b px-4 py-3 transition-colors duration-150 last:border-b-0 hover:bg-surface-hover focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="bg-primary-subtle flex size-9 shrink-0 items-center justify-center rounded-md text-lg leading-none">
            {space.icon || "📄"}
          </span>
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold group-hover:text-primary">
                {space.name}
              </span>
              <Badge variant="neutral" className="hidden font-mono text-[10px] sm:inline-flex">
                {space.key}
              </Badge>
              {space.status === "archived" ? (
                <Badge variant="neutral" className="hidden text-[10px] md:inline-flex">
                  Archived
                </Badge>
              ) : null}
            </span>
            <span className="text-muted-foreground mt-0.5 block truncate text-xs">
              {space.description || "No description"}
            </span>
          </span>
        </span>
        <span className="text-muted-foreground hidden items-center gap-1.5 text-xs sm:flex">
          {space.visibility === "open" ? (
            <Globe2 className="size-3.5 shrink-0" />
          ) : (
            <Lock className="size-3.5 shrink-0" />
          )}
          <span>{space.visibility === "open" ? "Open" : "Private"}</span>
        </span>
        <span className="text-muted-foreground hidden items-center gap-1.5 text-xs md:flex">
          <Users className="size-3.5 shrink-0" />
          {space.member_count}
        </span>
        <span
          onClick={(event) => event.preventDefault()}
          className="justify-self-end flex items-center gap-1"
        >
          <FavoriteButton
            space={space}
            favorite={favorite}
            pending={pending}
            onToggle={toggleFavorite}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 text-xs gap-1 px-2 font-medium cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setEditOpen(true);
            }}
          >
            <Pencil className="size-3" />
            Edit
          </Button>
        </span>
      </Link>

      <EditSpaceModal
        space={space}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  );
}

function PinnedSpace({ space }: { space: Space }) {
  return (
    <Link
      href={"/spaces/" + encodeURIComponent(space.key)}
      className="border-border bg-surface hover:border-border-strong hover:bg-surface-hover focus-visible:ring-ring flex min-w-0 items-center gap-2.5 rounded-md border px-3 py-2.5 transition-[color,background-color,border-color] duration-150 focus-visible:ring-2 focus-visible:outline-none"
    >
      <span className="bg-primary-subtle flex size-7 shrink-0 items-center justify-center rounded text-sm">
        {space.icon || "📄"}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{space.name}</span>
        <span className="text-muted-foreground block truncate text-[11px]">
          {space.key}
        </span>
      </span>
    </Link>
  );
}

export function SpacesExplorer({ spaces }: { spaces: Space[] }) {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") === "starred" ? "starred" : "all";
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"all" | "starred">(initialTab);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const starredSpaces = useMemo(
    () => spaces.filter((space) => space.is_favorite),
    [spaces],
  );
  const filteredSpaces = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return spaces.filter((space) => {
      if (tab === "starred" && !space.is_favorite) return false;
      return (
        !needle ||
        space.name.toLowerCase().includes(needle) ||
        space.key.toLowerCase().includes(needle) ||
        space.description.toLowerCase().includes(needle)
      );
    });
  }, [query, spaces, tab]);
  const pageCount = Math.max(1, Math.ceil(filteredSpaces.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const paginatedSpaces = useMemo(
    () =>
      filteredSpaces.slice(safePage * pageSize, (safePage + 1) * pageSize),
    [filteredSpaces, pageSize, safePage],
  );
  const from = filteredSpaces.length === 0 ? 0 : safePage * pageSize + 1;
  const to = Math.min((safePage + 1) * pageSize, filteredSpaces.length);

  return (
    <div className="space-y-7">
      {starredSpaces.length > 0 ? (
        <section aria-labelledby="favorite-spaces-heading">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 id="favorite-spaces-heading" className="text-base font-semibold">
                Favorite spaces
              </h2>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Your quick access list.
              </p>
            </div>
            <Badge variant="neutral">{starredSpaces.length}</Badge>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {starredSpaces.slice(0, 4).map((space) => (
              <PinnedSpace key={space.id} space={space} />
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="space-directory-heading">
        <div className="flex flex-col gap-4 border-border border-b pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 id="space-directory-heading" className="text-xl font-semibold tracking-tight">
              Space directory
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Browse the homes for your team’s knowledge.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end sm:items-center">
            <div className="border-border bg-surface-sunken flex w-fit items-center rounded-md border p-0.5 text-xs">
              <button
                type="button"
                onClick={() => {
                  setTab("all");
                  setPage(0);
                }}
                className={cn(
                  "focus-visible:ring-ring flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1.5 font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                  tab === "all"
                    ? "bg-surface text-foreground shadow-xs"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <Grid2X2 className="size-3.5" />
                All ({spaces.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab("starred");
                  setPage(0);
                }}
                className={cn(
                  "focus-visible:ring-ring flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1.5 font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                  tab === "starred"
                    ? "bg-surface text-foreground shadow-xs"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <Star className="size-3.5" />
                Favorite ({starredSpaces.length})
              </button>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
                placeholder="Search spaces"
                className="border-border bg-surface placeholder:text-muted-foreground hover:border-border-strong focus-visible:ring-ring w-full rounded-md border py-2 pr-8 pl-9 text-sm outline-none transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:ring-2"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setPage(0);
                  }}
                  aria-label="Clear space search"
                  className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded p-1 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {filteredSpaces.length > 0 ? (
          <div className="border-border bg-surface mt-4 overflow-hidden rounded-xl border shadow-sm">
            <div className="border-border bg-surface-sunken grid grid-cols-[minmax(0,1fr)_7.5rem_5.5rem_2.75rem] gap-3 border-b px-4 py-2 text-xs font-medium">
              <span>Space</span>
              <span className="hidden sm:block">Access</span>
              <span className="hidden md:block">Members</span>
              <span className="text-right">Favorite</span>
            </div>
            {paginatedSpaces.map((space) => (
              <SpaceDirectoryRow key={space.id} space={space} />
            ))}
            <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
              <p className="text-muted-foreground text-sm" aria-live="polite">
                Showing {from}–{to} of {filteredSpaces.length}
              </p>
              <div className="flex items-center gap-2">
                <label htmlFor="spaces-page-size" className="text-muted-foreground text-xs">
                  Rows
                </label>
                <Select
                  value={String(pageSize)}
                  onValueChange={(value) => {
                    setPageSize(Number(value));
                    setPage(0);
                  }}
                >
                  <SelectTrigger id="spaces-page-size" className="h-8 w-18" aria-label="Rows per page">
                    <SelectValue>{pageSize}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 25, 50, 100].map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground hidden text-xs sm:inline">
                  Page {safePage + 1} of {pageCount}
                </span>
                <Button
                  variant="secondary"
                  size="icon"
                  disabled={safePage === 0}
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                  aria-label="Previous page"
                >
                  <ChevronLeft />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
                  aria-label="Next page"
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="border-border bg-surface mt-4 rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm font-semibold">
              {query ? "No spaces match your search" : "No spaces found"}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              {query
                ? "Try another term or clear the search."
                : "Create a space to organise your team’s knowledge."}
            </p>
            {query ? (
              <Button
                size="sm"
                variant="secondary"
                className="mt-3"
                onClick={() => {
                  setQuery("");
                  setPage(0);
                }}
              >
                Clear search
              </Button>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
