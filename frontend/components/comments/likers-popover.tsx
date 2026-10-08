"use client";

import { Loader2, ThumbsUp } from "lucide-react";
import { useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserProfileTrigger } from "@/components/users/user-profile-trigger";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

export interface Liker {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
}

/**
 * A like count that opens "who liked this" - the count is its own button,
 * separate from the thumbs-up that toggles your like, as on social posts.
 * The list is fetched each time it opens, so it is never stale after
 * someone else (or you) likes in the meantime.
 */
export function LikersPopover({
  url,
  count,
  className,
  badge = false,
}: {
  /** The ``GET .../likes`` endpoint for the page or comment. */
  url: string;
  count: number;
  className?: string;
  /** Lead the count with a small round thumbs-up badge, as under a comment. */
  badge?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [likers, setLikers] = useState<Liker[] | null>(null);
  const [failed, setFailed] = useState(false);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    setLikers(null);
    setFailed(false);
    api
      .get<Liker[]>(url)
      .then(setLikers)
      .catch(() => setFailed(true));
  }

  if (count === 0) {
    return <span className={cn("tabular-nums", className)}>0</span>;
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("comments.likersAria", { count })}
          title={t("comments.likersTitle")}
          className={cn(
            "focus-visible:ring-ring inline-flex cursor-pointer items-center gap-1 rounded tabular-nums underline-offset-2 transition-colors duration-150 hover:underline focus-visible:ring-2 focus-visible:outline-none",
            className,
          )}
        >
          {badge ? (
            <span className="bg-primary text-primary-foreground ring-surface inline-flex size-4 items-center justify-center rounded-full ring-2">
              <ThumbsUp className="size-2.5 fill-current" aria-hidden />
            </span>
          ) : null}
          {count}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="border-border text-muted-foreground flex items-center gap-1.5 border-b px-3 py-2 text-xs font-semibold">
          <ThumbsUp className="text-primary size-3.5 fill-current" aria-hidden />
          {t("comments.likersHeading", { count })}
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {failed ? (
            <p className="text-danger px-2 py-2 text-xs">{t("comments.likersError")}</p>
          ) : likers === null ? (
            <div className="text-muted-foreground flex items-center gap-2 px-2 py-2 text-xs">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            </div>
          ) : (
            <ul>
              {likers.map((person) => (
                <li
                  key={person.id}
                  className="hover:bg-surface-hover flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors duration-150"
                >
                  <Avatar
                    name={person.full_name}
                    username={person.username}
                    src={person.avatar_url}
                    className="size-6 text-[10px]"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <UserProfileTrigger username={person.username} fullName={person.full_name} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
