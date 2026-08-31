"use client";

import { BookOpen, Clock3, FileText, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { PageHistoryModal } from "@/components/pages/page-history-modal";
import { UserProfileTrigger } from "@/components/users/user-profile-trigger";
import type { Me, RecentPageItem, Space } from "@/types/api";

type ActivityGroup = {
  username: string;
  name: string;
  items: RecentPageItem[];
};

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date));
}

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "W"
  );
}

export function RecentActivityFeed({
  activities,
  spaces,
  user,
}: {
  activities: RecentPageItem[];
  spaces: Space[];
  user: Me;
}) {
  const [historyItem, setHistoryItem] = useState<RecentPageItem | null>(null);

  const groups = useMemo<ActivityGroup[]>(() => {
    const grouped = new Map<string, ActivityGroup>();
    for (const item of activities) {
      const username = item.user_username || "system";
      if (!grouped.has(username))
        grouped.set(username, {
          username,
          name: item.user_full_name || username,
          items: [],
        });
      grouped.get(username)!.items.push(item);
    }
    return Array.from(grouped.values());
  }, [activities]);

  return (
    <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_20rem] xl:h-full xl:min-h-0">
      <main
        className="wh-scroll flex min-w-0 flex-col overflow-hidden xl:h-[calc(100dvh-var(--wh-topbar-height)-5rem)] xl:pr-3"
        aria-labelledby="all-updates-heading"
      >
        <div className="mb-7 flex shrink-0 items-end justify-between gap-3">
          <h1
            id="all-updates-heading"
            className="text-3xl font-semibold tracking-tight"
          >
            All updates
          </h1>
          <span className="text-muted-foreground text-xs">
            {activities.length} updates
          </span>
        </div>
        <div className="wh-scroll min-h-0 flex-1 overflow-y-scroll">
          {groups.length > 0 ? (
            <div className="space-y-8">
              {groups.map((group) => (
                <section key={group.username} className="flex gap-4">
                  {group.username === "system" ? (
                    <span className="bg-primary-subtle text-primary flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
                      {initials(group.name)}
                    </span>
                  ) : (
                    <UserProfileTrigger
                      username={group.username}
                      fullName={group.name}
                      variant="avatar"
                      className="size-11 text-sm"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold">
                      {group.username === "system" ? (
                        group.username
                      ) : (
                        <UserProfileTrigger username={group.username} fullName={group.name} />
                      )}
                    </h2>
                    <div className="mt-2 space-y-0.5">
                      {group.items.map((item) => (
                        <div
                          key={item.id}
                          className="group hover:bg-surface-hover flex items-start gap-2 rounded-md px-2 py-2 transition-colors duration-150"
                        >
                          <FileText className="text-primary mt-0.5 size-4 shrink-0" />
                          <span className="min-w-0 flex-1">
                            <Link
                              href={`/spaces/${encodeURIComponent(item.space_key)}/pages/${encodeURIComponent(item.slug)}`}
                              className="text-foreground hover:text-primary focus-visible:ring-ring block truncate text-sm font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                            >
                              {item.title}
                            </Link>
                            <span className="text-muted-foreground mt-0.5 block text-xs">
                              Updated {formatDate(item.updated_at)}{" "}
                              <button
                                type="button"
                                onClick={() => setHistoryItem(item)}
                                className="text-primary hover:bg-primary-subtle hover:text-primary-hover hover:underline active:bg-surface-selected focus-visible:ring-ring cursor-pointer rounded-sm px-0.5 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                              >
                                (view change)
                              </button>{" "}
                              ·{" "}
                              <Link
                                href={`/spaces/${encodeURIComponent(item.space_key)}`}
                                className="text-primary hover:text-primary-hover focus-visible:ring-ring rounded-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                              >
                                {item.space_name}
                              </Link>
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="border-border bg-surface rounded-lg border border-dashed p-10 text-center">
              <FileText className="text-muted-foreground mx-auto size-6" />
              <p className="mt-2 text-sm font-medium">No updates yet</p>
              <p className="text-muted-foreground mt-1 text-xs">
                Workspace contributions will appear here.
              </p>
            </div>
          )}
        </div>
      </main>

      <aside className="space-y-7" aria-label="Workspace information">
        <section className="bg-surface rounded-lg p-5 text-center">
          <div className="bg-primary-subtle text-primary mx-auto flex size-20 items-center justify-center rounded-full">
            <BookOpen className="size-10" />
          </div>
          <h2 className="mt-5 text-lg font-semibold">Welcome to WikiHub</h2>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
            Your team’s shared space for documentation, decisions, and useful
            project knowledge.
          </p>
        </section>
        <section className="border-border bg-surface rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <div className="bg-primary text-primary-foreground flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-semibold">
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                initials(user.full_name || user.username)
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {user.full_name || user.username}
              </p>
              <p className="text-muted-foreground truncate text-xs">
                {user.email}
              </p>
            </div>
          </div>
          <Link
            href="/settings"
            className="text-primary hover:text-primary-hover focus-visible:ring-ring mt-4 block text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
          >
            View profile settings
          </Link>
        </section>
        <section
          className="border-border bg-surface-sunken rounded-lg border p-4"
          aria-label="Favorite spaces"
        >
          <nav aria-label="Favorite spaces navigation">
            <Link
              href="/"
              aria-current="page"
              className="bg-surface-selected text-primary flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium"
            >
              <Clock3 className="size-4" />
              All updates
            </Link>
            <div className="border-border mt-5 border-t pt-4">
              <div className="flex items-center justify-between px-2">
                <p className="text-muted-foreground text-[10px] font-semibold tracking-[0.08em] uppercase">
                  My favorite spaces
                </p>
                <Link
                  href="/spaces?tab=starred"
                  className="text-primary hover:text-primary-hover focus-visible:ring-ring rounded px-1 text-[10px] font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                >
                  All
                </Link>
              </div>
              <div className="mt-2 space-y-0.5">
                {spaces.slice(0, 6).map((space) => (
                  <Link
                    key={space.id}
                    href={`/spaces/${encodeURIComponent(space.key)}`}
                    className="text-foreground hover:bg-surface-hover focus-visible:ring-ring flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <span className="bg-primary-subtle flex size-5 items-center justify-center rounded text-[11px]">
                      {space.icon || "📄"}
                    </span>
                    <span className="truncate">{space.name}</span>
                  </Link>
                ))}
                {spaces.length === 0 ? (
                  <p className="text-muted-foreground px-2 py-2 text-xs">
                    No favorite spaces yet.
                  </p>
                ) : null}
              </div>
            </div>
          </nav>
          <div className="border-border mt-5 border-t pt-4">
            <Link
              href="/spaces"
              className="text-primary hover:text-primary-hover focus-visible:ring-ring flex items-center gap-2 px-2 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
            >
              <Search className="size-3.5" />
              Find knowledge
            </Link>
          </div>
        </section>
      </aside>

      {historyItem ? (
        <PageHistoryModal
          open={historyItem !== null}
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
