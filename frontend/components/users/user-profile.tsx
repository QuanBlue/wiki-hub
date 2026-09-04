"use client";

import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FilePenLine,
  FilePlus2,
  FileText,
  Bookmark,
  FolderOpen,
  FolderTree,
  Mail,
  PanelLeft,
  Pencil,
  Pin,
  RotateCcw,
  Search,
  Star,
  ThumbsUp,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PageHistoryModal } from "@/components/pages/page-history-modal";
import { Button } from "@/components/ui/button";
import { UserProfileTrigger } from "@/components/users/user-profile-trigger";
import { api, ApiError } from "@/lib/api-client";
import {
  SIDEBAR_SHORTCUT_LIMIT,
  useSidebarShortcuts,
} from "@/lib/sidebar-shortcuts";
import { cn } from "@/lib/utils";
import type {
  PublicUser,
  RecentPageItem,
  UserActivityPage,
  UserDraftItem,
  UserProfileStats,
  UserPinnedPageItem,
  UserPageLabelItem,
  Space,
  WikiPage,
} from "@/types/api";

type ActivityTab = "all" | "mine" | "drafts" | "knowledge";
type KnowledgeSection = "favourites" | "pinned" | "liked" | "saved";

const KNOWLEDGE_PAGE_SIZES = [10, 25, 50, 100] as const;

function treeConnectorClass(position: "middle" | "last" | undefined) {
  if (position === "middle") {
    return "before:bg-border after:bg-border relative pl-5 before:absolute before:top-3.5 before:left-0 before:h-px before:w-4 after:absolute after:top-0 after:-bottom-0.5 after:left-0 after:w-px";
  }
  if (position === "last") {
    return "before:bg-border after:bg-border relative pl-5 before:absolute before:top-3.5 before:left-0 before:h-px before:w-4 after:absolute after:top-0 after:left-0 after:h-3.5 after:w-px";
  }
  return undefined;
}

function initials(user: PublicUser) {
  return (user.full_name.trim() || user.username)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

function dateLabel(value: string | null) {
  if (!value) return "No recent activity";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function relativeDate(value: string) {
  const elapsedMinutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 60_000),
  );
  if (elapsedMinutes < 1) return "Just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return "Yesterday";
  return `${Math.floor(hours / 24)}d ago`;
}

function presenceOf(lastActiveAt: string | null, now: number) {
  if (!lastActiveAt)
    return { isOnline: false, label: "Offline", minutesAgo: undefined };

  const lastActiveTime = new Date(lastActiveAt).getTime();
  if (Number.isNaN(lastActiveTime)) {
    return { isOnline: false, label: "Offline", minutesAgo: undefined };
  }
  const elapsedMinutes = Math.max(
    0,
    Math.floor((now - lastActiveTime) / 60_000),
  );
  if (elapsedMinutes < 5) {
    return { isOnline: true, label: "Active now", minutesAgo: undefined };
  }
  if (elapsedMinutes < 60) {
    return {
      isOnline: false,
      label: `Active ${elapsedMinutes}m ago`,
      minutesAgo: elapsedMinutes < 60 ? elapsedMinutes : undefined,
    };
  }
  return {
    isOnline: false,
    label: `Active ${relativeDate(lastActiveAt)}`,
    minutesAgo: undefined,
  };
}

function SideCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-border bg-surface rounded-lg border p-3.5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground text-xs leading-5">{children}</p>;
}

function KnowledgeCard({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={`${title}: ${count}`}>
      <span className="hidden" aria-hidden>
        {icon}
      </span>
      {children}
    </section>
  );
}

function KnowledgeEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground flex min-h-24 flex-col items-center justify-center px-4 py-3 text-center text-xs">
      {children}
    </div>
  );
}

/**
 * A compact filter dropdown with a search box built in - the plain `Select`
 * primitive has no way to narrow a long option list, and the knowledge
 * filters (every space, every label) can easily outgrow one screenful.
 */
/**
 * A checkbox-style dropdown: the search box narrows a long option list, and
 * more than one option can be picked at once - the trigger's own label just
 * summarises how many are selected. Selecting "all" is the one action that
 * both clears the selection and closes the panel; every other option toggles
 * in place so several can be picked without reopening.
 */
function SearchableFilterSelect({
  ariaLabel,
  value,
  allLabel,
  pluralNoun,
  options,
  onChange,
  searchPlaceholder,
  className,
  align = "start",
}: {
  ariaLabel: string;
  value: string[];
  /** Label for the reset ("all") option, always pinned above the search results. */
  allLabel: string;
  /** Noun used once more than one option is picked, e.g. "2 spaces". */
  pluralNoun: string;
  options: { value: string; label: string }[];
  onChange: (value: string[]) => void;
  searchPlaceholder: string;
  className?: string;
  /**
   * Which edge the panel (wider than the trigger) hangs from. "start" opens
   * rightward from the trigger's left edge; "end" opens leftward from its
   * right edge - needed for a trigger sitting near the card's right edge, or
   * the panel overflows past the card and gets clipped by its rounded-corner
   * `overflow-hidden`.
   */
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  // Autofocus via the HTML attribute makes the browser scroll the nearest
  // scrollable ancestor to bring the input into view - visible here as the
  // whole knowledge panel jerking when the dropdown opens, since it sits
  // inside its own scroll region. Focusing manually with `preventScroll`
  // keeps the "start typing immediately" behaviour without that jump.
  useEffect(() => {
    if (!open) return;
    searchInputRef.current?.focus({ preventScroll: true });
  }, [open]);

  const selectedLabel =
    value.length === 0
      ? allLabel
      : value.length === 1
        ? (options.find((option) => option.value === value[0])?.label ?? value[0])
        : `${value.length} ${pluralNoun}`;
  const needle = query.trim().toLowerCase();
  const filteredOptions = needle
    ? options.filter((option) => option.label.toLowerCase().includes(needle))
    : options;

  const toggle = (optionValue: string) => {
    onChange(
      value.includes(optionValue)
        ? value.filter((current) => current !== optionValue)
        : [...value, optionValue],
    );
  };
  const chooseAll = () => {
    onChange([]);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="border-border bg-surface hover:border-border-strong focus-visible:ring-ring flex h-8 w-full cursor-pointer items-center justify-between gap-1.5 rounded-md border px-2.5 text-left text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
      </button>
      {open ? (
        <div
          className={cn(
            "border-border bg-surface absolute z-20 mt-1 w-52 overflow-hidden rounded-lg border shadow-lg",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          <div className="border-border relative border-b p-1.5">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2"
              aria-hidden
            />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="border-border bg-surface placeholder:text-muted-foreground focus-visible:ring-ring h-7 w-full rounded-md border py-1 pr-2 pl-6 text-xs outline-none focus-visible:ring-1"
            />
          </div>
          <ul role="listbox" aria-multiselectable="true" className="max-h-48 overflow-y-auto p-1">
            <li>
              <button
                type="button"
                role="option"
                aria-selected={value.length === 0}
                onClick={chooseAll}
                className="hover:bg-surface-hover focus-visible:ring-ring flex min-h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 text-left text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
              >
                <span className="truncate">{allLabel}</span>
                {value.length === 0 ? (
                  <Check className="text-primary size-3.5 shrink-0" aria-hidden />
                ) : null}
              </button>
            </li>
            {filteredOptions.map((option) => {
              const checked = value.includes(option.value);
              return (
                <li key={option.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={checked}
                    onClick={() => toggle(option.value)}
                    className="hover:bg-surface-hover focus-visible:ring-ring flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <span
                      className={cn(
                        "border-border flex size-3.5 shrink-0 items-center justify-center rounded-sm border",
                        checked && "border-primary bg-primary",
                      )}
                      aria-hidden
                    >
                      {checked ? (
                        <Check className="text-primary-foreground size-3" />
                      ) : null}
                    </span>
                    <span className="truncate">{option.label}</span>
                  </button>
                </li>
              );
            })}
            {needle && filteredOptions.length === 0 ? (
              <li className="text-muted-foreground px-2.5 py-2 text-xs">
                No matches
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ActivityRow({
  item,
  onViewChange,
  treePosition,
}: {
  item: RecentPageItem;
  onViewChange: (item: RecentPageItem) => void;
  treePosition?: "middle" | "last";
}) {
  const treeClassName = treeConnectorClass(treePosition);

  return (
    <li className={treeClassName}>
      <div className="hover:bg-surface-hover group flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors duration-150">
        <FileText className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <Link
            href={`/spaces/${encodeURIComponent(item.space_key)}/pages/${encodeURIComponent(item.slug)}`}
            className="text-foreground hover:text-primary focus-visible:ring-ring block truncate text-sm font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
          >
            {item.title}
          </Link>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Updated {dateLabel(item.updated_at)} at {timeLabel(item.updated_at)}{" "}
            <button
              type="button"
              onClick={() => onViewChange(item)}
              className="text-primary hover:bg-primary-subtle hover:text-primary-hover active:bg-surface-selected focus-visible:ring-ring cursor-pointer rounded-sm px-0.5 transition-colors duration-150 hover:underline focus-visible:ring-2 focus-visible:outline-none"
            >
              (view change)
            </button>{" "}
            ·{" "}
            <Link
              href={`/spaces/${encodeURIComponent(item.space_key)}`}
              className="hover:text-primary focus-visible:ring-ring transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
            >
              {item.space_name}
            </Link>
          </p>
        </div>
      </div>
    </li>
  );
}

function DraftRow({ draft }: { draft: UserDraftItem }) {
  return (
    <li>
      <div className="hover:bg-surface-hover group flex items-start gap-2 rounded-md px-2 py-2 transition-colors duration-150">
        <FileText className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <Link
            href={`/spaces/${encodeURIComponent(draft.space_key)}/pages/${encodeURIComponent(draft.slug)}`}
            className="text-foreground hover:text-primary focus-visible:ring-ring block truncate text-sm font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
          >
            {draft.title}
          </Link>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Draft saved {dateLabel(draft.updated_at)} at{" "}
            {timeLabel(draft.updated_at)} · {draft.space_name}
          </p>
        </div>
      </div>
    </li>
  );
}

function CompactActivityFeed({
  items,
  onViewChange,
  showActors = true,
}: {
  items: RecentPageItem[];
  onViewChange: (item: RecentPageItem) => void;
  showActors?: boolean;
}) {
  const groups = useMemo(() => {
    const byUser = new Map<string, { name: string; items: RecentPageItem[] }>();
    for (const item of items) {
      const username = item.user_username || "system";
      const group = byUser.get(username) ?? {
        name: item.user_full_name || username,
        items: [],
      };
      group.items.push(item);
      byUser.set(username, group);
    }
    return [...byUser.entries()];
  }, [items]);
  if (!showActors) {
    return items.length ? (
      <ul className="space-y-0.5 p-4">
        {items.map((item) => (
          <ActivityRow key={item.id} item={item} onViewChange={onViewChange} />
        ))}
      </ul>
    ) : (
      <div className="p-12 text-center">
        <FileText className="text-muted-foreground mx-auto size-6" />
        <p className="mt-3 text-sm font-medium">No visible activity yet</p>
      </div>
    );
  }

  return groups.length ? (
    <div className="space-y-2 p-4">
      {groups.map(([username, group]) => (
        <section key={username}>
          <div className="flex items-center gap-3 py-1.5">
            {username === "system" ? (
              <span className="bg-primary-subtle text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                W
              </span>
            ) : (
              <UserProfileTrigger
                username={username}
                fullName={group.name}
                variant="avatar"
                className="size-8 text-xs"
              />
            )}
            <p className="min-w-0 text-sm font-semibold">
              {username === "system" ? (
                group.name
              ) : (
                <UserProfileTrigger username={username} fullName={group.name} />
              )}
            </p>
          </div>
          <ul className="mt-0.5 ml-4 space-y-0.5">
            {group.items.map((item, index) => (
              <ActivityRow
                key={item.id}
                item={item}
                onViewChange={onViewChange}
                treePosition={
                  index === group.items.length - 1 ? "last" : "middle"
                }
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  ) : (
    <div className="p-12 text-center">
      <FileText className="text-muted-foreground mx-auto size-6" />
      <p className="mt-3 text-sm font-medium">No visible activity yet</p>
    </div>
  );
}

export function UserProfile({
  user,
  initialActivity,
  initialAllActivity,
  stats,
  drafts,
  isOwner,
  isAdmin,
  favoriteSpaces,
  pinnedPages,
  likedPages,
}: {
  user: PublicUser;
  initialActivity: UserActivityPage;
  initialAllActivity: RecentPageItem[];
  stats: UserProfileStats;
  drafts: UserDraftItem[];
  isOwner: boolean;
  isAdmin: boolean;
  favoriteSpaces: Space[];
  pinnedPages: UserPinnedPageItem[];
  likedPages: UserPinnedPageItem[];
}) {
  const [items, setItems] = useState(initialActivity.items);
  const [nextCursor, setNextCursor] = useState(initialActivity.next_cursor);
  const [activeTab, setActiveTab] = useState<ActivityTab>("all");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [historyItem, setHistoryItem] = useState<RecentPageItem | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const activityScrollRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);
  const [presenceNow, setPresenceNow] = useState(() => Date.now());
  const [savedPageKeys, setSavedPageKeys] = useState<string[]>([]);
  // "Saved for later" only stores "spaceKey/slug" strings client-side, so the
  // list needs its own lookups for a title and a friendly space name -
  // undefined = not fetched yet, null = the page is gone or no longer
  // reachable (mirrors components/recent/saved-pages-list.tsx).
  const [savedPages, setSavedPages] = useState<Record<string, WikiPage | null>>({});
  const [savedSpaceNames, setSavedSpaceNames] = useState<Record<string, string>>({});
  const [pageLabelItems, setPageLabelItems] = useState<UserPageLabelItem[]>([]);
  // Empty array = no filter ("all"). A page/space only needs to match one of
  // the selected spaces, and one of the selected labels, so picking several
  // narrows down *which* of them you're looking at rather than requiring all
  // of them at once.
  const [knowledgeSpace, setKnowledgeSpace] = useState<string[]>([]);
  const [knowledgeLabel, setKnowledgeLabel] = useState<string[]>([]);
  // Favourite spaces lists spaces, not pages - a search box suits picking one
  // of many by name better than an exact-match dropdown, and there is no
  // per-page label to filter by there at all.
  const [knowledgeSpaceSearch, setKnowledgeSpaceSearch] = useState("");
  const [knowledgeSection, setKnowledgeSection] =
    useState<KnowledgeSection>("favourites");
  const [knowledgePage, setKnowledgePage] = useState(0);
  const [knowledgePageSize, setKnowledgePageSize] =
    useState<(typeof KNOWLEDGE_PAGE_SIZES)[number]>(10);
  const { sidebarFavoriteIds, sidebarPinnedIds, toggleSidebarShortcut } =
    useSidebarShortcuts(isOwner ? favoriteSpaces : [], isOwner ? pinnedPages : []);

  useEffect(() => {
    const interval = window.setInterval(
      () => setPresenceNow(Date.now()),
      30_000,
    );
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isOwner) return;
    const read = () => {
      try {
        const value = JSON.parse(
          window.localStorage.getItem("wikihub:saved-page-keys") ?? "[]",
        );
        setSavedPageKeys(
          Array.isArray(value)
            ? value.filter((item): item is string => typeof item === "string")
            : [],
        );
      } catch {
        setSavedPageKeys([]);
      }
    };
    const initial = window.setTimeout(read, 0);
    window.addEventListener("storage", read);
    window.addEventListener("wikihub:saved-pages-changed", read);
    return () => {
      window.clearTimeout(initial);
      window.removeEventListener("storage", read);
      window.removeEventListener("wikihub:saved-pages-changed", read);
    };
  }, [isOwner]);

  useEffect(() => {
    if (!isOwner || savedPageKeys.length === 0) return;
    const missingPages = savedPageKeys.filter((key) => !(key in savedPages));
    const missingSpaceKeys = Array.from(
      new Set(
        savedPageKeys
          .map((key) => key.split("/")[0])
          .filter(
            (spaceKey): spaceKey is string =>
              Boolean(spaceKey) && !(spaceKey in savedSpaceNames),
          ),
      ),
    );
    if (missingPages.length === 0 && missingSpaceKeys.length === 0) return;

    let cancelled = false;
    void Promise.all([
      ...missingPages.map(async (key) => {
        const slashIndex = key.indexOf("/");
        const spaceKey = slashIndex < 0 ? key : key.slice(0, slashIndex);
        const slug = slashIndex < 0 ? "" : key.slice(slashIndex + 1);
        try {
          const page = await api.get<WikiPage>(
            `/api/v1/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(slug)}`,
          );
          if (!cancelled) setSavedPages((current) => ({ ...current, [key]: page }));
        } catch {
          if (!cancelled) setSavedPages((current) => ({ ...current, [key]: null }));
        }
      }),
      ...missingSpaceKeys.map(async (spaceKey) => {
        try {
          const space = await api.get<Space>(
            `/api/v1/spaces/${encodeURIComponent(spaceKey)}`,
          );
          if (!cancelled)
            setSavedSpaceNames((current) => ({ ...current, [spaceKey]: space.name }));
        } catch {
          // Falls back to the raw space key at render time; nothing to store.
        }
      }),
    ]);
    return () => {
      cancelled = true;
    };
    // savedPages/savedSpaceNames are read only to find what's still missing,
    // not reacted to - including them would re-run this on every fetch result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, savedPageKeys]);

  useEffect(() => {
    if (!isOwner) return;
    void api
      .get<UserPageLabelItem[]>("/api/v1/users/me/page-labels")
      .then(setPageLabelItems)
      .catch(() => setPageLabelItems([]));
  }, [isOwner]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ limit: "20", cursor: nextCursor });
      const page = await api.get<UserActivityPage>(
        `/api/v1/users/${encodeURIComponent(user.username)}/activity?${params.toString()}`,
      );
      setItems((current) => [
        ...current,
        ...page.items.filter(
          (entry) => !current.some((known) => known.id === entry.id),
        ),
      ]);
      setNextCursor(page.next_cursor);
    } catch (error) {
      setLoadError(
        error instanceof ApiError
          ? error.message
          : "Could not load more activity.",
      );
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [nextCursor, user.username]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !nextCursor) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "240px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, nextCursor]);

  const displayName = user.full_name || user.username;
  const activityTabs: ActivityTab[] = isOwner
    ? ["all", "mine", "knowledge", "drafts"]
    : isAdmin
      ? ["all", "drafts"]
      : ["all"];
  // On another member's profile, the only activity feed is that member's
  // public activity. The workspace-wide feed belongs to the signed-in user's
  // Home, where "My activity" is also meaningful.
  const visibleItems =
    isOwner && activeTab === "all" ? initialAllActivity : items;
  const presence = presenceOf(user.last_active_at, presenceNow);
  const presenceIndicatorClass =
    presence.minutesAgo !== undefined
      ? "border-success/40 bg-success-bg text-success ring-surface absolute -right-1 bottom-0 flex h-5 min-w-7 items-center justify-center rounded-full border px-1.5 text-[10px] font-semibold leading-none ring-2"
      : `ring-surface absolute right-0 bottom-0 flex size-4 items-center justify-center rounded-full text-[9px] leading-none font-semibold ring-2 ${presence.isOnline ? "bg-success" : "bg-muted-foreground"}`;
  // Filter options are scoped to whichever section is open, not a union
  // across all four - a space or label with nothing in the current section
  // is noise, not a useful filter.
  const knowledgeSectionPageKeys =
    knowledgeSection === "pinned"
      ? new Set(pinnedPages.map((page) => `${page.space_key}/${page.slug}`))
      : knowledgeSection === "liked"
        ? new Set(likedPages.map((page) => `${page.space_key}/${page.slug}`))
        : knowledgeSection === "saved"
          ? new Set(savedPageKeys)
          : null; // "favourites" lists spaces, not pages - no per-page labels apply.
  // Each dropdown's options are further narrowed by whatever is already
  // picked in the *other* dropdown - picking a space first should leave only
  // labels that appear in it, and picking a label first should leave only
  // spaces that carry it, so the two stay in sync with each other.
  const knowledgeLabels = Array.from(
    new Set(
      knowledgeSectionPageKeys
        ? pageLabelItems
            .filter(
              (item) =>
                knowledgeSectionPageKeys.has(`${item.space_key}/${item.slug}`) &&
                (knowledgeSpace.length === 0 ||
                  knowledgeSpace.includes(item.space_key)),
            )
            .map((item) => item.name)
        : [],
    ),
  ).sort();
  const labeledPageKeys = new Set(
    pageLabelItems
      .filter(
        (item) => knowledgeLabel.length === 0 || knowledgeLabel.includes(item.name),
      )
      .map((item) => `${item.space_key}/${item.slug}`),
  );
  const knowledgeSpaces = Array.from(
    new Map(
      knowledgeSection === "favourites"
        ? favoriteSpaces.map((space) => [space.key, space.name] as const)
        : knowledgeSection === "pinned"
          ? pinnedPages
              .filter(
                (page) =>
                  knowledgeLabel.length === 0 ||
                  labeledPageKeys.has(`${page.space_key}/${page.slug}`),
              )
              .map((page) => [page.space_key, page.space_name] as const)
          : knowledgeSection === "liked"
            ? likedPages
                .filter(
                  (page) =>
                    knowledgeLabel.length === 0 ||
                    labeledPageKeys.has(`${page.space_key}/${page.slug}`),
                )
                .map((page) => [page.space_key, page.space_name] as const)
            : savedPageKeys
                .filter(
                  (key) => knowledgeLabel.length === 0 || labeledPageKeys.has(key),
                )
                .map((key) => {
                  const spaceKey = key.split("/")[0] ?? "";
                  return [spaceKey, savedSpaceNames[spaceKey] ?? spaceKey] as const;
                }),
    ),
  );
  const matchesKnowledge = (spaceKey: string, slug?: string) =>
    (knowledgeSpace.length === 0 || knowledgeSpace.includes(spaceKey)) &&
    (knowledgeLabel.length === 0 ||
      (slug ? labeledPageKeys.has(`${spaceKey}/${slug}`) : false));
  // Items already shown in the sidebar float to the top - that's the whole
  // point of picking a shortcut, so it should not then hide at the bottom of
  // a paginated list. `Array#sort` is stable, so ties (both shown, or both
  // not) keep their original order.
  const favoriteSpaceQuery = knowledgeSpaceSearch.trim().toLowerCase();
  const hasActiveKnowledgeFilter =
    knowledgeSection === "favourites"
      ? favoriteSpaceQuery !== ""
      : knowledgeSpace.length > 0 || knowledgeLabel.length > 0;
  const clearKnowledgeFilters = () => {
    setKnowledgeSpace([]);
    setKnowledgeLabel([]);
    setKnowledgeSpaceSearch("");
  };
  const filteredFavoriteSpaces = favoriteSpaces
    .filter(
      (space) =>
        !favoriteSpaceQuery ||
        space.name.toLowerCase().includes(favoriteSpaceQuery) ||
        space.key.toLowerCase().includes(favoriteSpaceQuery),
    )
    .sort(
      (a, b) =>
        Number(sidebarFavoriteIds.includes(b.id)) -
        Number(sidebarFavoriteIds.includes(a.id)),
    );
  const filteredPinnedPages = pinnedPages
    .filter((page) => matchesKnowledge(page.space_key, page.slug))
    .sort(
      (a, b) =>
        Number(sidebarPinnedIds.includes(b.id)) -
        Number(sidebarPinnedIds.includes(a.id)),
    );
  const filteredLikedPages = likedPages.filter((page) =>
    matchesKnowledge(page.space_key, page.slug),
  );
  const filteredSavedPageKeys = savedPageKeys.filter((key) => {
    const [spaceKey, ...parts] = key.split("/");
    return matchesKnowledge(spaceKey ?? "", parts.join("/"));
  });
  const knowledgeItemCount = knowledgeSection === "favourites"
    ? filteredFavoriteSpaces.length
    : knowledgeSection === "pinned"
      ? filteredPinnedPages.length
      : knowledgeSection === "liked"
        ? filteredLikedPages.length
        : filteredSavedPageKeys.length;
  const knowledgePageCount = Math.max(1, Math.ceil(knowledgeItemCount / knowledgePageSize));
  // Switching sections/filters or shrinking the page size can leave
  // `knowledgePage` past the new last page - clamp rather than show a blank slice.
  const knowledgeSafePage = Math.min(knowledgePage, knowledgePageCount - 1);
  const knowledgeStart = knowledgeSafePage * knowledgePageSize;

  const knowledgeSectionDetails: Record<
    KnowledgeSection,
    { title: string; description: string; icon: React.ReactNode }
  > = {
    favourites: {
      title: "Favourite spaces",
      description: "Spaces you marked as favourites.",
      icon: <Star className="size-4" aria-hidden />,
    },
    pinned: {
      title: "Pinned pages",
      description: "Pages you pinned to keep them close at hand.",
      icon: <Pin className="size-4" aria-hidden />,
    },
    liked: {
      title: "Liked pages",
      description: "Pages you have liked.",
      icon: <ThumbsUp className="size-4" aria-hidden />,
    },
    saved: {
      title: "Saved for later",
      description: "Pages you saved to revisit later.",
      icon: <Bookmark className="size-4" aria-hidden />,
    },
  };
  const activeKnowledgeSection = knowledgeSectionDetails[knowledgeSection];

  return (
    <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <main className="min-w-0 lg:flex lg:h-[calc(100dvh-var(--wh-topbar-height)-5rem)] lg:flex-col lg:overflow-hidden">
        <div className="shrink-0 px-2 pt-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Activity</h2>
          </div>
          <div
            className="mt-3 flex gap-5"
            role="tablist"
            aria-label="Profile activity"
          >
            {activityTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                className={`focus-visible:ring-ring cursor-pointer border-b-2 px-0.5 pb-2.5 text-xs font-medium capitalize transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none ${activeTab === tab ? "border-primary text-primary" : "text-muted-foreground hover:text-foreground border-transparent"}`}
              >
                {tab === "all"
                  ? isOwner
                    ? "All activity"
                    : `@${user.username} activity`
                  : tab === "mine"
                    ? "My activity"
                    : tab === "knowledge"
                      ? "My knowledge"
                      : isOwner
                        ? "Drafts"
                        : `@${user.username} Draft`}
              </button>
            ))}
          </div>
        </div>

        <div
          ref={activityScrollRef}
          className="lg:wh-scroll lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
        >
          {activeTab === "knowledge" ? (
            <div className="p-4 lg:flex lg:h-full lg:min-h-0 lg:flex-col">
              <div className="grid gap-5 lg:flex lg:min-h-0 lg:flex-1 lg:flex-row lg:items-start lg:gap-7">
                <nav
                  aria-label="My knowledge sections"
                  className="border-border lg:w-48 lg:shrink-0 lg:border-r lg:pr-5"
                >
                  <p className="text-muted-foreground px-2 text-[10px] font-semibold tracking-[0.08em] uppercase">
                    Knowledge sections
                  </p>
                  <div className="mt-3 space-y-1">
                    {(
                      [
                        [
                          "favourites",
                          "Favourite spaces",
                          <Star
                            key="favourites"
                            className="size-4 shrink-0"
                            aria-hidden
                          />,
                        ],
                        [
                          "pinned",
                          "Pinned pages",
                          <Pin key="pinned" className="size-4 shrink-0" aria-hidden />,
                        ],
                        [
                          "liked",
                          "Liked pages",
                          <ThumbsUp
                            key="liked"
                            className="size-4 shrink-0"
                            aria-hidden
                          />,
                        ],
                        [
                          "saved",
                          "Saved for later",
                          <Bookmark
                            key="saved"
                            className="size-4 shrink-0"
                            aria-hidden
                          />,
                        ],
                      ] as const
                    ).map(([section, label, icon]) => (
                      <button
                        key={section}
                        type="button"
                        aria-current={
                          knowledgeSection === section ? "page" : undefined
                        }
                        onClick={() => {
                          setKnowledgeSection(section);
                          setKnowledgePage(0);
                          // The filters are scoped to the section being left;
                          // carrying one over could leave it pointing at an
                          // option (or search match) that no longer applies.
                          clearKnowledgeFilters();
                        }}
                        className={`focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none ${knowledgeSection === section ? "bg-primary-subtle text-primary font-semibold" : "text-muted-foreground font-normal hover:bg-surface-sunken hover:text-foreground active:bg-surface-selected"}`}
                      >
                        {icon}
                        <span className="truncate">{label}</span>
                      </button>
                    ))}
                  </div>
                </nav>
                <section className="border-border bg-surface overflow-hidden rounded-lg border lg:flex lg:min-h-0 lg:min-w-0 lg:flex-1 lg:flex-col lg:self-stretch">
                  <header className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="bg-primary-subtle text-primary flex size-7 shrink-0 items-center justify-center rounded-md">
                        {activeKnowledgeSection.icon}
                      </span>
                      <h3
                        className="truncate text-sm font-semibold tracking-tight"
                        title={activeKnowledgeSection.description}
                      >
                        {activeKnowledgeSection.title}
                      </h3>
                      {knowledgeSection === "favourites" || knowledgeSection === "pinned" ? (
                        <span
                          className="bg-primary-subtle text-primary inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
                          title={`Shown as shortcuts in the sidebar (up to ${SIDEBAR_SHORTCUT_LIMIT})`}
                        >
                          <PanelLeft className="size-3.5" aria-hidden />
                          {knowledgeSection === "favourites"
                            ? sidebarFavoriteIds.length
                            : sidebarPinnedIds.length}
                          /{SIDEBAR_SHORTCUT_LIMIT}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {knowledgeSection === "favourites" ? (
                        <div className="relative w-36 sm:w-44">
                          <Search
                            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
                            aria-hidden
                          />
                          <input
                            type="search"
                            value={knowledgeSpaceSearch}
                            onChange={(event) =>
                              setKnowledgeSpaceSearch(event.target.value)
                            }
                            placeholder="Search spaces"
                            aria-label="Search favourite spaces"
                            className="border-border bg-surface placeholder:text-muted-foreground hover:border-border-strong focus-visible:ring-ring h-8 w-full rounded-md border py-1.5 pr-7 pl-8 text-xs outline-none transition-colors duration-150 focus-visible:ring-2"
                          />
                          {knowledgeSpaceSearch ? (
                            <button
                              type="button"
                              onClick={() => setKnowledgeSpaceSearch("")}
                              aria-label="Clear space search"
                              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-1/2 right-1.5 -translate-y-1/2 cursor-pointer rounded p-0.5 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                            >
                              <X className="size-3" aria-hidden />
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <>
                          <SearchableFilterSelect
                            ariaLabel="Filter by space"
                            value={knowledgeSpace}
                            allLabel="All spaces"
                            pluralNoun="spaces"
                            options={knowledgeSpaces.map(([key, name]) => ({
                              value: key,
                              label: name,
                            }))}
                            onChange={setKnowledgeSpace}
                            searchPlaceholder="Search spaces"
                            className="w-32"
                          />
                          <SearchableFilterSelect
                            ariaLabel="Filter by label"
                            value={knowledgeLabel}
                            allLabel="All labels"
                            pluralNoun="labels"
                            options={knowledgeLabels.map((label) => ({
                              value: label,
                              label,
                            }))}
                            onChange={setKnowledgeLabel}
                            searchPlaceholder="Search labels"
                            className="w-28"
                            align="end"
                          />
                        </>
                      )}
                      {hasActiveKnowledgeFilter ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Clear filters"
                          title="Clear filters"
                          className="size-8"
                          onClick={clearKnowledgeFilters}
                        >
                          <RotateCcw className="size-3.5" aria-hidden />
                        </Button>
                      ) : null}
                    </div>
                  </header>
                  <div className="space-y-3 p-5 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
                    <div className="space-y-1 lg:wh-scroll lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                      {knowledgeSection === "favourites" ? (
                        <KnowledgeCard
                          icon={<Star className="size-4" aria-hidden />}
                          title="Favourite spaces"
                          count={filteredFavoriteSpaces.length}
                        >
                          {filteredFavoriteSpaces.length ? (
                            <ul className="space-y-0.5">
                              {filteredFavoriteSpaces
                                .slice(knowledgeStart, knowledgeStart + knowledgePageSize)
                                .map((space) => {
                                  const shownInSidebar = sidebarFavoriteIds.includes(space.id);
                                  return (
                                    <li key={space.id} className="flex items-center gap-1">
                                      <Link
                                        href={`/spaces/${encodeURIComponent(space.key)}`}
                                        className="hover:bg-surface-hover focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-3 rounded-md px-2.5 py-2 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                                      >
                                        <span className="text-primary flex size-4 shrink-0 items-center justify-center">
                                          <FolderOpen
                                            className="size-3.5"
                                            aria-hidden
                                          />
                                        </span>
                                        <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                                          {space.name}
                                        </span>
                                      </Link>
                                      <Button
                                        type="button"
                                        variant={shownInSidebar ? "subtle" : "ghost"}
                                        size="icon"
                                        aria-label={
                                          shownInSidebar
                                            ? `Remove ${space.name} from sidebar`
                                            : `Show ${space.name} in sidebar`
                                        }
                                        title={
                                          shownInSidebar
                                            ? "Shown in sidebar"
                                            : "Show in sidebar"
                                        }
                                        disabled={
                                          !shownInSidebar &&
                                          sidebarFavoriteIds.length >= SIDEBAR_SHORTCUT_LIMIT
                                        }
                                        onClick={() =>
                                          toggleSidebarShortcut("favorites", space.id)
                                        }
                                      >
                                        {shownInSidebar ? (
                                          <Check aria-hidden />
                                        ) : (
                                          <PanelLeft aria-hidden />
                                        )}
                                      </Button>
                                    </li>
                                  );
                                })}
                            </ul>
                          ) : (
                            <KnowledgeEmpty>
                              No favourite spaces match the current filters.
                            </KnowledgeEmpty>
                          )}
                        </KnowledgeCard>
                      ) : null}
                      {knowledgeSection === "pinned" ? (
                        <KnowledgeCard
                          icon={<Pin className="size-4" aria-hidden />}
                          title="Pinned pages"
                          count={filteredPinnedPages.length}
                        >
                          {filteredPinnedPages.length ? (
                            <ul className="space-y-0.5">
                              {filteredPinnedPages
                                .slice(knowledgeStart, knowledgeStart + knowledgePageSize)
                                .map((page) => {
                                  const shownInSidebar = sidebarPinnedIds.includes(page.id);
                                  return (
                                    <li key={page.id} className="flex items-center gap-1">
                                      <Link
                                        href={`/spaces/${encodeURIComponent(page.space_key)}/pages/${encodeURIComponent(page.slug)}`}
                                        className="hover:bg-surface-hover focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-3 rounded-md px-2.5 py-2 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                                      >
                                        <span className="text-primary flex size-4 shrink-0 items-center justify-center">
                                          <FileText
                                            className="size-3.5"
                                            aria-hidden
                                          />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                          <span className="text-foreground block truncate text-sm">
                                            {page.title}
                                          </span>
                                          <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                                            {page.space_name}
                                          </span>
                                        </span>
                                      </Link>
                                      <Button
                                        type="button"
                                        variant={shownInSidebar ? "subtle" : "ghost"}
                                        size="icon"
                                        aria-label={
                                          shownInSidebar
                                            ? `Remove ${page.title} from sidebar`
                                            : `Show ${page.title} in sidebar`
                                        }
                                        title={
                                          shownInSidebar
                                            ? "Shown in sidebar"
                                            : "Show in sidebar"
                                        }
                                        disabled={
                                          !shownInSidebar &&
                                          sidebarPinnedIds.length >= SIDEBAR_SHORTCUT_LIMIT
                                        }
                                        onClick={() =>
                                          toggleSidebarShortcut("pinned", page.id)
                                        }
                                      >
                                        {shownInSidebar ? (
                                          <Check aria-hidden />
                                        ) : (
                                          <PanelLeft aria-hidden />
                                        )}
                                      </Button>
                                    </li>
                                  );
                                })}
                            </ul>
                          ) : (
                            <KnowledgeEmpty>
                              No pinned pages match the current filters.
                            </KnowledgeEmpty>
                          )}
                        </KnowledgeCard>
                      ) : null}
                      {knowledgeSection === "liked" ? (
                        <KnowledgeCard
                          icon={<ThumbsUp className="size-4" aria-hidden />}
                          title="Liked pages"
                          count={
                            likedPages.filter((page) =>
                              matchesKnowledge(page.space_key, page.slug),
                            ).length
                          }
                        >
                          {likedPages.filter((page) =>
                            matchesKnowledge(page.space_key, page.slug),
                          ).length ? (
                            <ul className="space-y-0.5">
                              {likedPages
                                .filter((page) =>
                                  matchesKnowledge(page.space_key, page.slug),
                                )
                                .slice(knowledgeStart, knowledgeStart + knowledgePageSize)
                                .map((page) => (
                                  <li key={page.id}>
                                    <Link
                                      href={`/spaces/${encodeURIComponent(page.space_key)}/pages/${encodeURIComponent(page.slug)}`}
                                      className="hover:bg-surface-hover focus-visible:ring-ring flex items-center gap-3 rounded-md px-2.5 py-2 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                                    >
                                      <span className="text-primary flex size-4 shrink-0 items-center justify-center">
                                        <ThumbsUp
                                          className="size-3.5"
                                          aria-hidden
                                        />
                                      </span>
                                      <span className="min-w-0 flex-1">
                                        <span className="text-foreground block truncate text-sm">
                                          {page.title}
                                        </span>
                                        <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                                          {page.space_name}
                                        </span>
                                      </span>
                                    </Link>
                                  </li>
                                ))}
                            </ul>
                          ) : (
                            <KnowledgeEmpty>
                              No liked pages match the current filters.
                            </KnowledgeEmpty>
                          )}
                        </KnowledgeCard>
                      ) : null}
                      {knowledgeSection === "saved" ? (
                        <KnowledgeCard
                          icon={<Bookmark className="size-4" aria-hidden />}
                          title="Saved for later"
                          count={filteredSavedPageKeys.length}
                        >
                          {filteredSavedPageKeys.length ? (
                            <ul className="space-y-0.5">
                              {filteredSavedPageKeys
                                .slice(knowledgeStart, knowledgeStart + knowledgePageSize)
                                .map((key) => {
                                  const [spaceKey, ...slugParts] =
                                    key.split("/");
                                  const slug = slugParts.join("/");
                                  const page = savedPages[key];
                                  return (
                                    <li key={key}>
                                      <Link
                                        href={`/spaces/${encodeURIComponent(spaceKey ?? "")}/pages/${encodeURIComponent(slug)}`}
                                        className="hover:bg-surface-hover focus-visible:ring-ring flex items-center gap-3 rounded-md px-2.5 py-2 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                                      >
                                        <span className="text-primary flex size-4 shrink-0 items-center justify-center">
                                          <Bookmark
                                            className="size-3.5"
                                            aria-hidden
                                          />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                          <span className="text-foreground block truncate text-sm">
                                            {page?.title ?? slug}
                                          </span>
                                          <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                                            {page === null
                                              ? "No longer available"
                                              : (savedSpaceNames[spaceKey ?? ""] ?? spaceKey)}
                                          </span>
                                        </span>
                                      </Link>
                                    </li>
                                  );
                                })}
                            </ul>
                          ) : (
                            <KnowledgeEmpty>
                              <span>
                                No saved pages match the current filters.
                              </span>
                              <Link
                                href="/saved"
                                className="text-primary hover:text-primary-hover focus-visible:ring-ring mt-1 rounded-sm focus-visible:ring-2 focus-visible:outline-none"
                              >
                                Open Saved for later
                              </Link>
                            </KnowledgeEmpty>
                          )}
                        </KnowledgeCard>
                      ) : null}
                    </div>
                    {knowledgeItemCount > 0 ? (
                      <div className="border-border flex items-center justify-between border-t pt-3">
                        <p className="text-muted-foreground text-xs">
                          Showing {knowledgeStart + 1}–{Math.min(knowledgeStart + knowledgePageSize, knowledgeItemCount)} of {knowledgeItemCount}
                        </p>
                        <div className="flex items-center gap-2">
                          <label
                            htmlFor="knowledge-page-size"
                            className="text-muted-foreground text-xs"
                          >
                            Rows
                          </label>
                          <select
                            id="knowledge-page-size"
                            value={knowledgePageSize}
                            onChange={(event) => {
                              setKnowledgePageSize(
                                Number(
                                  event.target.value,
                                ) as (typeof KNOWLEDGE_PAGE_SIZES)[number],
                              );
                              setKnowledgePage(0);
                            }}
                            className="border-border bg-surface text-foreground hover:border-border-strong focus-visible:ring-ring h-8 rounded-md border px-1.5 text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                          >
                            {KNOWLEDGE_PAGE_SIZES.map((size) => (
                              <option key={size} value={size}>
                                {size}
                              </option>
                            ))}
                          </select>
                          <span className="text-muted-foreground hidden text-xs sm:inline">
                            Page {knowledgeSafePage + 1} of {knowledgePageCount}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <Button type="button" variant="secondary" size="icon" aria-label="Previous page" title="Previous page" disabled={knowledgeSafePage === 0} onClick={() => setKnowledgePage(knowledgeSafePage - 1)}><ChevronLeft aria-hidden /></Button>
                            <Button type="button" variant="secondary" size="icon" aria-label="Next page" title="Next page" disabled={knowledgeSafePage >= knowledgePageCount - 1} onClick={() => setKnowledgePage(knowledgeSafePage + 1)}><ChevronRight aria-hidden /></Button>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </section>
              </div>
            </div>
          ) : activeTab === "drafts" ? (
            <div className="p-5">
              {drafts.length ? (
                <ul className="space-y-0.5">
                  {drafts.map((draft) => (
                    <DraftRow key={draft.id} draft={draft} />
                  ))}
                </ul>
              ) : (
                <EmptyCard>No drafts are available to view.</EmptyCard>
              )}
            </div>
          ) : (
            <CompactActivityFeed
              items={visibleItems}
              onViewChange={setHistoryItem}
              showActors={isOwner && activeTab === "all"}
            />
          )}
          {nextCursor && activeTab === "mine" ? (
            <div ref={sentinelRef} className="h-px" aria-hidden />
          ) : null}
          {loading ? (
            <p className="text-muted-foreground p-4 text-center text-sm">
              Loading more activity…
            </p>
          ) : null}
          {loadError ? (
            <div className="border-danger/30 bg-danger-bg m-4 flex items-center justify-between gap-3 rounded-lg border p-3">
              <p className="text-danger text-sm">{loadError}</p>
              <Button size="sm" onClick={() => void loadMore()}>
                Try again
              </Button>
            </div>
          ) : null}
        </div>
      </main>

      <aside className="space-y-5 lg:sticky lg:top-20">
        <section className="border-border bg-surface overflow-hidden rounded-lg border">
          <div className="bg-primary-subtle h-20" />
          <div className="px-4 pb-4 text-center">
            <div className="relative mx-auto -mt-12 size-20">
              <span className="bg-primary text-primary-foreground ring-surface flex size-20 items-center justify-center overflow-hidden rounded-full text-2xl font-semibold ring-4">
                {user.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  initials(user) || (
                    <UserRound className="size-10" aria-hidden />
                  )
                )}
              </span>
              <span
                className={presenceIndicatorClass}
                role="img"
                aria-label={presence.label}
                title={presence.label}
              >
                {presence.minutesAgo !== undefined
                  ? `${presence.minutesAgo}m`
                  : null}
              </span>
            </div>
            <h1 className="mt-2.5 text-xl font-semibold tracking-tight">
              {displayName}
            </h1>
            <p className="text-muted-foreground mt-0.5 text-sm">
              @{user.username}
            </p>
            {user.bio ? (
              <p className="text-muted-foreground mt-3 text-xs leading-5">
                {user.bio}
              </p>
            ) : null}
            {isOwner ? (
              <Button
                asChild
                variant="secondary"
                size="sm"
                className="mt-4 w-full"
              >
                <Link href="/account">
                  <Pencil aria-hidden /> Edit profile
                </Link>
              </Button>
            ) : null}
          </div>
          <dl className="border-border space-y-2.5 border-t px-4 py-3 text-xs">
            <div className="flex items-center gap-2">
              <UsersRound className="text-muted-foreground size-4" />
              <dt className="text-muted-foreground">Workspace role</dt>
              <dd className="ml-auto">
                {user.is_workspace_admin ? "Administrator" : "Member"}
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <CalendarDays className="text-muted-foreground size-4" />
              <dt className="text-muted-foreground">Joined</dt>
              <dd className="ml-auto">{dateLabel(user.created_at)}</dd>
            </div>
            <div className="flex items-center gap-2">
              <Mail className="text-muted-foreground size-4" />
              <dt className="text-muted-foreground">Email</dt>
              <dd className="ml-auto max-w-36 truncate">{user.email}</dd>
            </div>
            <div className="flex items-center gap-2">
              <Clock3 className="text-muted-foreground size-4" />
              <dt className="text-muted-foreground">Last active</dt>
              <dd className="ml-auto">
                {user.last_active_at ? relativeDate(user.last_active_at) : "—"}
              </dd>
            </div>
          </dl>
        </section>
        <SideCard title="Activity statistics">
          <dl className="space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground flex items-center gap-2">
                <FilePenLine className="size-4" aria-hidden="true" /> Pages
                updated
              </dt>
              <dd className="font-semibold">{stats.pages_updated}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground flex items-center gap-2">
                <FilePlus2 className="size-4" aria-hidden="true" /> Pages
                created
              </dt>
              <dd className="font-semibold">{stats.pages_created}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground flex items-center gap-2">
                <FolderTree className="size-4" aria-hidden="true" /> Spaces
                contributed
              </dt>
              <dd className="font-semibold">{stats.spaces_contributed}</dd>
            </div>
          </dl>
        </SideCard>
        {!isOwner && isAdmin ? (
          <SideCard title="Draft access">
            <EmptyCard>
              Administrator preview is read-only. Choose the Drafts tab to
              review available drafts.
            </EmptyCard>
          </SideCard>
        ) : null}
      </aside>

      {historyItem ? (
        <PageHistoryModal
          open
          onOpenChange={(open) => {
            if (!open) setHistoryItem(null);
          }}
          spaceKey={historyItem.space_key}
          slug={historyItem.slug}
          pageTitle={historyItem.title}
        />
      ) : null}
    </div>
  );
}
