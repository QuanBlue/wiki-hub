"use client";

import { Clock3, FileText, Grid2X2, User as UserIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { SpaceCard } from "@/components/spaces/space-card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RecentPageItem, Space } from "@/types/api";

type GroupedUserActivity = {
  username: string;
  fullName: string;
  items: RecentPageItem[];
};

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export function RecentActivityFeed({
  activities,
  recentSpaces,
}: {
  activities: RecentPageItem[];
  recentSpaces: Space[];
}) {
  const [tab, setTab] = useState<"updates" | "spaces">("updates");

  // Group activity items by user
  const groupedByUser = useMemo<GroupedUserActivity[]>(() => {
    const groupsMap = new Map<string, GroupedUserActivity>();

    for (const item of activities) {
      const key = item.user_username || "system";
      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          username: item.user_username,
          fullName: item.user_full_name || item.user_username,
          items: [],
        });
      }
      groupsMap.get(key)!.items.push(item);
    }

    return Array.from(groupsMap.values());
  }, [activities]);

  return (
    <div className="space-y-6">
      {/* Top Filter Tabs (Confluence All Updates style) */}
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <button
          type="button"
          onClick={() => setTab("updates")}
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-150 cursor-pointer",
            tab === "updates"
              ? "bg-surface-selected text-primary font-semibold shadow-2xs"
              : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
          )}
        >
          <Clock3 className="size-3.5" />
          <span>All updates ({activities.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setTab("spaces")}
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-150 cursor-pointer",
            tab === "spaces"
              ? "bg-surface-selected text-primary font-semibold shadow-2xs"
              : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
          )}
        >
          <Grid2X2 className="size-3.5" />
          <span>Recently updated spaces ({recentSpaces.length})</span>
        </button>
      </div>

      {tab === "updates" ? (
        <div className="space-y-8">
          {groupedByUser.length > 0 ? (
            groupedByUser.map((group) => (
              <div key={group.username} className="flex gap-4">
                {/* User Avatar Circle */}
                <div className="bg-primary-subtle text-primary border-border flex size-10 shrink-0 items-center justify-center rounded-full border text-sm font-semibold uppercase">
                  {group.fullName ? group.fullName.charAt(0) : <UserIcon className="size-4" />}
                </div>

                {/* User Updates List */}
                <div className="min-w-0 flex-1 space-y-3 pt-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-foreground text-sm">
                      {group.fullName}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      (@{group.username})
                    </span>
                  </div>

                  <ul className="space-y-3">
                    {group.items.map((item) => (
                      <li key={item.id} className="group/item flex items-start gap-2.5">
                        <FileText className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link
                              href={`/spaces/${encodeURIComponent(item.space_key)}/${encodeURIComponent(item.slug)}`}
                              className="font-medium text-foreground hover:text-primary hover:underline text-sm transition-colors"
                            >
                              {item.title}
                            </Link>
                            <Badge variant="subtle" className="font-mono text-[10px]">
                              {item.space_key}
                            </Badge>
                          </div>
                          <p className="text-muted-foreground mt-0.5 text-xs">
                            Updated {formatDate(item.updated_at)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))
          ) : (
            <div className="border-border bg-surface text-muted-foreground rounded-lg border border-dashed p-8 text-center">
              <p className="text-foreground font-semibold text-sm">No recent activity</p>
              <p className="mt-1 text-xs">Page updates from team members will appear here.</p>
            </div>
          )}
        </div>
      ) : (
        /* Spaces Tab */
        <div>
          {recentSpaces.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {recentSpaces.map((space) => (
                <SpaceCard key={space.id} space={space} />
              ))}
            </div>
          ) : (
            <div className="border-border bg-surface text-muted-foreground rounded-lg border border-dashed p-8 text-center">
              <p className="text-foreground font-semibold text-sm">No recent spaces</p>
              <p className="mt-1 text-xs">Spaces you create or edit will show up here.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
