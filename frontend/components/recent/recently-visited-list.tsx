"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  readRecentlyVisited,
  subscribeRecentlyVisited,
  type VisitedPage,
} from "@/lib/recently-visited";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

/**
 * Reads from `localStorage`, so the list can only be known after hydration -
 * `items` starts `null` and is filled in on mount rather than guessed during
 * the server render.
 */
export function RecentlyVisitedList() {
  const [items, setItems] = useState<VisitedPage[] | null>(null);

  useEffect(() => {
    const sync = () => setItems(readRecentlyVisited());
    sync();
    return subscribeRecentlyVisited(sync);
  }, []);

  if (items === null) return null;

  if (items.length === 0) {
    return (
      <div className="border-border bg-surface rounded-xl border border-dashed p-10 text-center">
        <FileText className="text-muted-foreground mx-auto size-6" aria-hidden />
        <p className="mt-2 text-sm font-medium">No visited pages yet</p>
        <p className="text-muted-foreground mt-1 text-xs">
          Pages you open will show up here, most recent first.
        </p>
      </div>
    );
  }

  return (
    <ul className="border-border bg-surface divide-border divide-y rounded-xl border">
      {items.map((item) => (
        <li key={`${item.spaceKey}/${item.slug}`}>
          <Link
            href={`/spaces/${encodeURIComponent(item.spaceKey)}/${encodeURIComponent(item.slug)}`}
            className="hover:bg-surface-hover flex items-center gap-3 px-4 py-3 transition-colors duration-150 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2"
          >
            <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="text-foreground block truncate text-sm font-medium">
                {item.title}
              </span>
              <span className="text-muted-foreground mt-0.5 block text-xs">
                {item.spaceName} · Visited {formatDate(item.visitedAt)}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
