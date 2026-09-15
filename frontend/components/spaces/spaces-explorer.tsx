"use client";

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Crown,
  Globe2,
  Grid2X2,
  Lock,
  Pencil,
  Search,
  Star,
  UserRound,
  Users,
  UsersRound,
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
import { formatDate } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { Space } from "@/types/api";

/** "@admin" for one owner, "@admin +2" for more - the column has no room to
 * list every name, and the first one plus a count is enough to recognise
 * the space at a glance and know there's more to see in Edit space. Falls
 * back to the space's creator for one migrated in before ownership was
 * trackable and never assigned an Owner since (see the backend's
 * `SpaceOwner` backfill). */
function formatOwners(space: Space): string {
  if (space.owners.length === 0) {
    return space.created_by_username ? "@" + space.created_by_username : "—";
  }
  const [first, ...rest] = space.owners;
  return "@" + first.username + (rest.length > 0 ? " +" + rest.length : "");
}

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
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={pending}
      aria-label={
        favorite
          ? t("spaces.removeFavouriteNamed", { name: space.name })
          : t("spaces.addFavouriteNamed", { name: space.name })
      }
      aria-pressed={favorite}
      className={cn(
        "focus-visible:ring-ring cursor-pointer rounded-md p-2 transition-colors duration-150 hover:bg-surface-selected focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        // Matches the favorite-star color used on space cards elsewhere
        // (see space-card.tsx / space-workspace.tsx) - `text-warning` reads
        // as a dull, muted amber meant for warning text, not a bright star.
        favorite ? "text-amber-500" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Star className={cn("size-4", favorite && "fill-current")} />
    </button>
  );
}

function SpaceDirectoryRow({ space }: { space: Space }) {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const [favorite, setFavorite] = useState(space.is_favorite);
  const [pending, setPending] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const href = "/spaces/" + encodeURIComponent(space.key);
  // Same "full space administration" gate as the Edit space button inside
  // the space itself (see `canAdmin` in space-workspace.tsx) - this row's
  // Edit button opens the same modal, so it stays disabled (with a tooltip
  // explaining why) for a viewer who only has this space's content-editing
  // permissions (e.g. `add`, handed out to everyone by an Open space - see
  // the permission service's module docstring); only its actual Owner/Admin
  // can click through.
  const canAdmin =
    space.my_role === "admin" || space.my_permissions?.includes("admin") === true;

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
      toast.error(t("spaces.favouriteError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Link
        href={href}
        className="border-border group grid min-w-0 grid-cols-[minmax(0,1fr)_8rem] items-center gap-3 border-b px-4 py-3 transition-colors duration-150 last:border-b-0 hover:bg-surface-hover focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none sm:grid-cols-[minmax(0,1fr)_7.5rem_8rem] md:grid-cols-[minmax(0,1fr)_7.5rem_5.5rem_5rem_8rem] lg:grid-cols-[minmax(0,1fr)_9rem_7.5rem_5.5rem_5rem_8rem] xl:grid-cols-[minmax(0,1fr)_9rem_8rem_7.5rem_5.5rem_5rem_8rem]"
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
                  {t("spaces.archivedBadge")}
                </Badge>
              ) : null}
            </span>
            <span className="text-muted-foreground mt-0.5 block truncate text-xs">
              {space.description || t("spaces.noDescriptionShort")}
            </span>
          </span>
        </span>
        <span className="text-muted-foreground hidden min-w-0 items-center gap-1.5 text-xs lg:flex">
          <UserRound className="size-3.5 shrink-0" />
          <span className="truncate">{formatOwners(space)}</span>
        </span>
        <span className="text-muted-foreground hidden items-center gap-1.5 text-xs xl:flex">
          <CalendarDays className="size-3.5 shrink-0" />
          {formatDate(space.created_at, locale)}
        </span>
        <span className="text-muted-foreground hidden items-center gap-1.5 text-xs sm:flex">
          {space.visibility === "open" ? (
            <Globe2 className="size-3.5 shrink-0" />
          ) : (
            <Lock className="size-3.5 shrink-0" />
          )}
          <span>
            {space.visibility === "open"
              ? t("spaces.visibilityOpen")
              : t("spaces.visibilityPrivate")}
          </span>
        </span>
        <span className="text-muted-foreground hidden items-center gap-1.5 text-xs md:flex">
          <Users className="size-3.5 shrink-0" />
          {space.member_count}
        </span>
        <span className="text-muted-foreground hidden items-center gap-1.5 text-xs md:flex">
          <UsersRound className="size-3.5 shrink-0" />
          {space.group_permission_count}
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
            disabled={!canAdmin}
            title={
              canAdmin ? undefined : t("spaces.editOnlyOwnerAdmin")
            }
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setEditOpen(true);
            }}
          >
            <Pencil className="size-3" />
            {t("spaces.edit")}
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

type SpacesTab = "all" | "starred" | "owned";

function tabFromParam(value: string | null): SpacesTab {
  if (value === "starred" || value === "owned") return value;
  return "all";
}

export function SpacesExplorer({ spaces }: { spaces: Space[] }) {
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<SpacesTab>(tabFromParam(searchParams.get("tab")));
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const starredSpaces = useMemo(
    () => spaces.filter((space) => space.is_favorite),
    [spaces],
  );
  const ownedSpaces = useMemo(
    () => spaces.filter((space) => space.is_owner),
    [spaces],
  );
  const filteredSpaces = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return spaces.filter((space) => {
      if (tab === "starred" && !space.is_favorite) return false;
      if (tab === "owned" && !space.is_owner) return false;
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
      <section aria-label={t("spaces.directoryAria")}>
        <div className="flex flex-col gap-3 border-border border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
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
              {t("spaces.tabAll", { count: spaces.length })}
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
              {t("spaces.tabFavorite", { count: starredSpaces.length })}
            </button>
            <button
              type="button"
              onClick={() => {
                setTab("owned");
                setPage(0);
              }}
              className={cn(
                "focus-visible:ring-ring flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1.5 font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                tab === "owned"
                  ? "bg-surface text-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              )}
            >
              <Crown className="size-3.5" />
              {t("spaces.tabOwn", { count: ownedSpaces.length })}
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
              placeholder={t("spaces.searchSpaces")}
              className="border-border bg-surface placeholder:text-muted-foreground hover:border-border-strong focus-visible:ring-ring w-full rounded-md border py-2 pr-8 pl-9 text-sm outline-none transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:ring-2"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setPage(0);
                }}
                aria-label={t("spaces.clearSpaceSearch")}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded p-1 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>

        {filteredSpaces.length > 0 ? (
          <div className="border-border bg-surface mt-4 overflow-hidden rounded-xl border shadow-sm">
            <div className="border-border bg-surface-sunken grid grid-cols-[minmax(0,1fr)_8rem] gap-3 border-b px-4 py-2 text-xs font-medium sm:grid-cols-[minmax(0,1fr)_7.5rem_8rem] md:grid-cols-[minmax(0,1fr)_7.5rem_5.5rem_5rem_8rem] lg:grid-cols-[minmax(0,1fr)_9rem_7.5rem_5.5rem_5rem_8rem] xl:grid-cols-[minmax(0,1fr)_9rem_8rem_7.5rem_5.5rem_5rem_8rem]">
              <span>{t("spaces.columnSpace")}</span>
              <span className="hidden lg:block">{t("spaces.columnOwner")}</span>
              <span className="hidden xl:block">{t("spaces.columnCreated")}</span>
              <span className="hidden sm:block">{t("spaces.columnAccess")}</span>
              <span className="hidden md:block">{t("spaces.columnMembers")}</span>
              <span className="hidden md:block">{t("spaces.columnGroups")}</span>
              <span className="text-right">{t("spaces.columnFavorite")}</span>
            </div>
            {paginatedSpaces.map((space) => (
              <SpaceDirectoryRow key={space.id} space={space} />
            ))}
            <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
              <p className="text-muted-foreground text-sm" aria-live="polite">
                {t("common.showingRange", {
                  from,
                  to,
                  total: filteredSpaces.length,
                })}
              </p>
              <div className="flex items-center gap-2">
                <label htmlFor="spaces-page-size" className="text-muted-foreground text-xs">
                  {t("common.rows")}
                </label>
                <Select
                  value={String(pageSize)}
                  onValueChange={(value) => {
                    setPageSize(Number(value));
                    setPage(0);
                  }}
                >
                  <SelectTrigger id="spaces-page-size" className="h-8 w-18" aria-label={t("common.rowsPerPage")}>
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
                  {t("common.pageIndicator", {
                    current: safePage + 1,
                    total: pageCount,
                  })}
                </span>
                <Button
                  variant="secondary"
                  size="icon"
                  disabled={safePage === 0}
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                  aria-label={t("common.previousPage")}
                >
                  <ChevronLeft />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
                  aria-label={t("common.nextPage")}
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="border-border bg-surface mt-4 rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm font-semibold">
              {query
                ? t("spaces.emptyNoMatch")
                : tab === "starred"
                  ? t("spaces.emptyNoFavorite")
                  : tab === "owned"
                    ? t("spaces.emptyNoOwned")
                    : t("spaces.emptyNoSpaces")}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              {query
                ? t("spaces.emptyHintSearch")
                : tab === "owned"
                  ? t("spaces.emptyHintOwned")
                  : t("spaces.emptyHintCreate")}
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
                {t("spaces.clearSearch")}
              </Button>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
