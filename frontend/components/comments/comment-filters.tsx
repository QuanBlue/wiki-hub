"use client";

import { Check, ChevronDown, ListFilter } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "@/lib/i18n/context";
import type { CommentFilter, CommentSort } from "@/lib/comments";
import { cn } from "@/lib/utils";

/** One way of looking at the discussion: an order, optionally narrowed. */
export type CommentView = "oldest" | "newest" | "liked" | "mentions" | "mine";

export function viewToQuery(
  view: CommentView,
  username: string,
): { sort: CommentSort; filter: CommentFilter } {
  switch (view) {
    case "mentions":
      return { sort: "newest", filter: { author: null, mentioning: username } };
    case "mine":
      return { sort: "newest", filter: { author: username, mentioning: null } };
    default:
      return { sort: view, filter: { author: null, mentioning: null } };
  }
}

const SORT_VIEWS: CommentView[] = ["oldest", "newest", "liked"];
const FILTER_VIEWS: CommentView[] = ["mentions", "mine"];

/**
 * "Oldest ▾" at the end of the like / comment row: one menu that orders or narrows
 * the discussion, each choice with a line saying what it shows - the same
 * pattern people know from social feeds, instead of a side panel.
 */
export function CommentViewMenu({
  view,
  onViewChange,
  counts,
}: {
  view: CommentView;
  onViewChange: (view: CommentView) => void;
  /** Matching comments for the narrowing views; 0 disables the choice. */
  counts: { mentions: number; mine: number };
}) {
  const { t } = useTranslation();

  function item(option: CommentView) {
    const selected = option === view;
    const count = option === "mentions" ? counts.mentions : option === "mine" ? counts.mine : null;
    return (
      <DropdownMenuItem
        key={option}
        disabled={count === 0 && !selected}
        onSelect={() => onViewChange(option)}
        // The current choice is a tinted row with a brand bar, so it can't be
        // mistaken for whichever row the pointer happens to be over.
        className={cn(
          "items-start gap-3 border-l-2 py-2",
          selected
            ? "border-primary bg-primary-subtle data-[highlighted]:bg-primary-subtle"
            : "border-transparent",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className={cn("block text-sm font-semibold", selected ? "text-primary" : "text-foreground")}>
            {t(`comments.view.${option}`)}
            {count !== null ? (
              <span className="text-muted-foreground ml-1.5 font-normal tabular-nums">({count})</span>
            ) : null}
          </span>
          <span className="text-muted-foreground mt-0.5 block text-xs leading-snug">
            {t(`comments.view.${option}Hint`)}
          </span>
        </span>
        <Check
          className={cn("text-primary mt-0.5 size-4 shrink-0", !selected && "invisible")}
          aria-hidden
        />
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("comments.viewMenuAria", { view: t(`comments.view.${view}`) })}
          className="border-border bg-surface text-foreground hover:border-border-strong hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring data-[state=open]:border-primary data-[state=open]:bg-primary-subtle data-[state=open]:text-primary flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium shadow-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
        >
          <ListFilter className="text-muted-foreground size-4" aria-hidden />
          {t(`comments.view.${view}`)}
          <ChevronDown className="text-muted-foreground size-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-1">
        {SORT_VIEWS.map(item)}
        <DropdownMenuSeparator />
        {FILTER_VIEWS.map(item)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
