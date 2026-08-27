"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode, Ref } from "react";

import { cn } from "@/lib/utils";

/**
 * A collapsed list of what a long-running operation has done so far.
 *
 * Shared rather than copied: the admin backup panel and the document importer
 * show the same kind of account of the same kind of work, and whoever is
 * watching should not have to learn two of them.
 */
export function LogDisclosure({
  title,
  count,
  expanded,
  onExpandedChange,
  listRef,
  children,
}: {
  title: string;
  count: number;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  listRef?: Ref<HTMLUListElement>;
  children: ReactNode;
}) {
  return (
    <details
      className="border-border bg-surface mt-4 rounded-md border"
      open={expanded}
      onToggle={(event) => onExpandedChange(event.currentTarget.open)}
    >
      <summary className="hover:bg-surface-hover focus-visible:ring-ring focus-visible:ring-offset-background flex cursor-pointer list-none items-center justify-between gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-offset-1">
        <span>
          {title} ({count})
        </span>
        <ChevronDown
          className={cn(
            "text-muted-foreground size-4 transition-transform duration-150",
            expanded && "rotate-180",
          )}
        />
      </summary>
      <ul
        ref={listRef}
        className="border-border max-h-44 divide-y overflow-y-auto border-t text-xs"
      >
        {children}
      </ul>
    </details>
  );
}

export function formatLogTime(at: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(at);
}
