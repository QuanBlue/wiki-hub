"use client";

import {
  CalendarDays,
  ChevronDown,
  Clock3,
  FilePenLine,
  FilePlus2,
  FileText,
  FolderTree,
  Mail,
  Pencil,
  Tag,
  UserRound,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PageHistoryModal } from "@/components/pages/page-history-modal";
import { UserProfileTrigger } from "@/components/users/user-profile-trigger";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api-client";
import type {
  PublicUser,
  RecentPageItem,
  UserActivityPage,
  UserDraftItem,
  UserProfileStats,
} from "@/types/api";

type ActivityTab = "all" | "mine" | "drafts";

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
  if (!lastActiveAt) return { isOnline: false, label: "Offline", minutesAgo: undefined };

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
  return { isOnline: false, label: `Active ${relativeDate(lastActiveAt)}`, minutesAgo: undefined };
}

function draftPreview(content: string) {
  return content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || "Empty draft";
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

function CompactActivityFeed({
  items,
  onViewChange,
  scrollContainerRef,
  showActors = true,
}: {
  items: RecentPageItem[];
  onViewChange: (item: RecentPageItem) => void;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
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
  const groupRefs = useRef(new Map<string, HTMLElement>());
  const [activeActor, setActiveActor] = useState<string | null>(groups[0]?.[0] ?? null);
  const [showPinnedActor, setShowPinnedActor] = useState(false);

  useEffect(() => {
    if (!showActors) return;
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const updatePinnedActor = () => {
      const boundary = Math.max(scrollContainer.getBoundingClientRect().top, 0);
      let nextActor = groups[0]?.[0] ?? null;
      let shouldPin = false;
      for (const [username] of groups) {
        const section = groupRefs.current.get(username);
        if (section && section.getBoundingClientRect().top <= boundary) {
          nextActor = username;
          shouldPin = true;
        } else {
          break;
        }
      }
      setActiveActor((current) => (current === nextActor ? current : nextActor));
      setShowPinnedActor((current) => (current === shouldPin ? current : shouldPin));
    };

    updatePinnedActor();
    scrollContainer.addEventListener("scroll", updatePinnedActor, { passive: true });
    window.addEventListener("scroll", updatePinnedActor, { passive: true });
    window.addEventListener("resize", updatePinnedActor);
    return () => {
      scrollContainer.removeEventListener("scroll", updatePinnedActor);
      window.removeEventListener("scroll", updatePinnedActor);
      window.removeEventListener("resize", updatePinnedActor);
    };
  }, [groups, scrollContainerRef, showActors]);

  if (!showActors) {
    return items.length ? (
      <ul className="space-y-0.5 p-4">
        {items.map((item) => <ActivityRow key={item.id} item={item} onViewChange={onViewChange} />)}
      </ul>
    ) : (
      <div className="p-12 text-center"><FileText className="text-muted-foreground mx-auto size-6" /><p className="mt-3 text-sm font-medium">No visible activity yet</p></div>
    );
  }

  const activeGroup = groups.find(([username]) => username === activeActor) ?? groups[0];

  return activeGroup ? (
    <div className="space-y-2 p-4">
      <div className="sticky top-0 z-20 -mx-4 -mb-11 h-11">
        <div
          className={`bg-background flex h-11 items-center gap-3 px-4 ${showPinnedActor ? "" : "pointer-events-none opacity-0"}`}
        >
          {activeGroup[0] === "system" ? (
            <span className="bg-primary-subtle text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold">W</span>
          ) : (
            <UserProfileTrigger username={activeGroup[0]} fullName={activeGroup[1].name} variant="avatar" className="size-8 text-xs" />
          )}
          <p className="min-w-0 text-sm font-semibold">
            {activeGroup[0] === "system" ? activeGroup[1].name : <UserProfileTrigger username={activeGroup[0]} fullName={activeGroup[1].name} />}
          </p>
        </div>
      </div>
      {groups.map(([username, group]) => (
        <section
          key={username}
          ref={(node) => {
            if (node) groupRefs.current.set(username, node);
            else groupRefs.current.delete(username);
          }}
        >
          <div className="flex items-center gap-3 py-1.5">
            {username === "system" ? (
              <span className="bg-primary-subtle text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold">W</span>
            ) : (
              <UserProfileTrigger username={username} fullName={group.name} variant="avatar" className="size-8 text-xs" />
            )}
            <p className="min-w-0 text-sm font-semibold">
              {username === "system" ? group.name : <UserProfileTrigger username={username} fullName={group.name} />}
            </p>
          </div>
          <ul className="mt-0.5 ml-4 space-y-0.5">
            {group.items.map((item, index) => (
              <ActivityRow
                key={item.id}
                item={item}
                onViewChange={onViewChange}
                treePosition={index === group.items.length - 1 ? "last" : "middle"}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  ) : (
    <div className="p-12 text-center"><FileText className="text-muted-foreground mx-auto size-6" /><p className="mt-3 text-sm font-medium">No visible activity yet</p></div>
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
}: {
  user: PublicUser;
  initialActivity: UserActivityPage;
  initialAllActivity: RecentPageItem[];
  stats: UserProfileStats;
  drafts: UserDraftItem[];
  isOwner: boolean;
  isAdmin: boolean;
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

  useEffect(() => {
    const interval = window.setInterval(() => setPresenceNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

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
        ...page.items.filter((entry) => !current.some((known) => known.id === entry.id)),
      ]);
      setNextCursor(page.next_cursor);
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : "Could not load more activity.");
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
    ? ["all", "mine", "drafts"]
    : isAdmin
      ? ["all", "drafts"]
      : ["all"];
  // On another member's profile, the only activity feed is that member's
  // public activity. The workspace-wide feed belongs to the signed-in user's
  // Home, where "My activity" is also meaningful.
  const visibleItems = isOwner && activeTab === "all" ? initialAllActivity : items;
  const presence = presenceOf(user.last_active_at, presenceNow);
  const presenceIndicatorClass =
    presence.minutesAgo !== undefined
      ? "border-success/40 bg-success-bg text-success ring-surface absolute -right-1 bottom-0 flex h-5 min-w-7 items-center justify-center rounded-full border px-1.5 text-[10px] font-semibold leading-none ring-2"
      : `ring-surface absolute right-0 bottom-0 flex size-4 items-center justify-center rounded-full text-[9px] leading-none font-semibold ring-2 ${presence.isOnline ? "bg-success" : "bg-muted-foreground"}`;

  return (
    <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <main className="min-w-0 lg:flex lg:h-[calc(100dvh-var(--wh-topbar-height)-5rem)] lg:flex-col lg:overflow-hidden">
        <div className="shrink-0 px-2 pt-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Activity</h2>
            <Button variant="secondary" size="sm" className="gap-2"><Tag className="size-4" /> All types <ChevronDown className="size-3.5" /></Button>
          </div>
          <div className="mt-3 flex gap-5" role="tablist" aria-label="Profile activity">
            {activityTabs.map((tab) => (
              <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)} className={`focus-visible:ring-ring cursor-pointer border-b-2 px-0.5 pb-2.5 text-xs font-medium capitalize transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none ${activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                {tab === "all"
                  ? isOwner
                    ? "All activity"
                    : `@${user.username} activity`
                  : tab === "mine"
                    ? "My activity"
                    : isOwner
                      ? "Drafts"
                      : `@${user.username} drafts`}
              </button>
            ))}
          </div>
        </div>

        <div ref={activityScrollRef} className="lg:wh-scroll lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {activeTab === "drafts" ? (
          <div className="p-5">
            {drafts.length ? <ul className="space-y-3">{drafts.map((draft) => <li key={draft.id} className="border-border bg-surface-sunken rounded-lg border p-3"><p className="text-sm font-medium">{draft.title}</p><p className="text-muted-foreground mt-1 text-xs">{draft.space_name} · {dateLabel(draft.updated_at)}</p><p className="text-muted-foreground mt-2 line-clamp-3 text-xs leading-5">{draftPreview(draft.content)}</p></li>)}</ul> : <EmptyCard>No drafts are available to view.</EmptyCard>}
          </div>
        ) : (
            <CompactActivityFeed
              items={visibleItems}
              onViewChange={setHistoryItem}
              scrollContainerRef={activityScrollRef}
              showActors={isOwner && activeTab === "all"}
            />
        )}
        {nextCursor && activeTab === "mine" ? <div ref={sentinelRef} className="h-px" aria-hidden /> : null}
        {loading ? <p className="text-muted-foreground p-4 text-center text-sm">Loading more activity…</p> : null}
        {loadError ? <div className="border-danger/30 bg-danger-bg m-4 flex items-center justify-between gap-3 rounded-lg border p-3"><p className="text-danger text-sm">{loadError}</p><Button size="sm" onClick={() => void loadMore()}>Try again</Button></div> : null}
        </div>
      </main>

      <aside className="space-y-5 lg:sticky lg:top-20">
        <section className="border-border bg-surface overflow-hidden rounded-lg border">
          <div className="bg-primary-subtle h-20" />
          <div className="px-4 pb-4 text-center">
            <div className="relative mx-auto -mt-12 size-20">
              <span className="bg-primary text-primary-foreground ring-surface flex size-20 items-center justify-center overflow-hidden rounded-full text-2xl font-semibold ring-4">
                {user.avatar_url ? <img src={user.avatar_url} alt="" className="size-full object-cover" /> : initials(user) || <UserRound className="size-10" aria-hidden />}
              </span>
              <span
                className={presenceIndicatorClass}
                role="img"
                aria-label={presence.label}
                title={presence.label}
              >
                {presence.minutesAgo !== undefined ? `${presence.minutesAgo}m` : null}
              </span>
            </div>
            <h1 className="mt-2.5 text-xl font-semibold tracking-tight">{displayName}</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">@{user.username}</p>
            {user.bio ? <p className="text-muted-foreground mt-3 text-xs leading-5">{user.bio}</p> : null}
            {isOwner ? <Button asChild variant="secondary" size="sm" className="mt-4 w-full"><Link href="/account"><Pencil aria-hidden /> Edit profile</Link></Button> : null}
          </div>
          <dl className="border-border space-y-2.5 border-t px-4 py-3 text-xs">
            <div className="flex items-center gap-2"><UsersRound className="text-muted-foreground size-4" /><dt className="text-muted-foreground">Workspace role</dt><dd className="ml-auto">{user.is_workspace_admin ? "Administrator" : "Member"}</dd></div>
            <div className="flex items-center gap-2"><CalendarDays className="text-muted-foreground size-4" /><dt className="text-muted-foreground">Joined</dt><dd className="ml-auto">{dateLabel(user.created_at)}</dd></div>
            <div className="flex items-center gap-2"><Mail className="text-muted-foreground size-4" /><dt className="text-muted-foreground">Email</dt><dd className="ml-auto max-w-36 truncate">{user.email}</dd></div>
            <div className="flex items-center gap-2"><Clock3 className="text-muted-foreground size-4" /><dt className="text-muted-foreground">Last active</dt><dd className="ml-auto">{user.last_active_at ? relativeDate(user.last_active_at) : "—"}</dd></div>
          </dl>
        </section>
        <SideCard title="Activity statistics">
          <dl className="space-y-3 text-xs">
            <div className="flex items-center justify-between"><dt className="text-muted-foreground flex items-center gap-2"><FilePenLine className="size-4" aria-hidden="true" /> Pages updated</dt><dd className="font-semibold">{stats.pages_updated}</dd></div>
            <div className="flex items-center justify-between"><dt className="text-muted-foreground flex items-center gap-2"><FilePlus2 className="size-4" aria-hidden="true" /> Pages created</dt><dd className="font-semibold">{stats.pages_created}</dd></div>
            <div className="flex items-center justify-between"><dt className="text-muted-foreground flex items-center gap-2"><FolderTree className="size-4" aria-hidden="true" /> Spaces contributed</dt><dd className="font-semibold">{stats.spaces_contributed}</dd></div>
          </dl>
        </SideCard>
        {!isOwner && isAdmin ? <SideCard title="Draft access"><EmptyCard>Administrator preview is read-only. Choose the Drafts tab to review available drafts.</EmptyCard></SideCard> : null}
      </aside>

      {historyItem ? <PageHistoryModal open onOpenChange={(open) => { if (!open) setHistoryItem(null); }} spaceKey={historyItem.space_key} slug={historyItem.slug} pageTitle={historyItem.title} /> : null}
    </div>
  );
}
