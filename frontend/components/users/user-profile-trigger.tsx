"use client";

import { Building2, Loader2, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { getUserAvatarColor, resolveAvatarUrl } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { PublicUser } from "@/types/api";

function initials(name: string, username: string): string {
  return (name.trim() || username)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

export function UserProfileTrigger({
  username,
  fullName,
  avatarUrl,
  variant = "name",
  className,
  openOnHover = variant === "mention" || variant === "avatar",
  children,
  asSpan = false,
  statusBadge,
  popoverAlign = "start",
}: {
  username: string;
  fullName?: string | null;
  avatarUrl?: string | null;
  variant?: "name" | "avatar" | "mention";
  className?: string;
  /** Also open the card when the pointer rests on the name (and close it after leaving). */
  openOnHover?: boolean;
  children?: ReactNode;
  /** Render as an inline <span> instead of <button> for tight inline text integration. */
  asSpan?: boolean;
  /** Optional badge shown next to the name in the popover card. */
  statusBadge?: ReactNode;
  /** Popover alignment relative to trigger. */
  popoverAlign?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const { t } = useTranslation();
  const label = fullName || username;
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function hoverTo(next: boolean) {
    if (!openOnHover) return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(
      () => handleOpenChange(next),
      next ? 250 : 150,
    );
  }
  useEffect(
    () => () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    },
    [],
  );

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen || profile || loading || loadError) return;
    setLoading(true);
    api
      .get<PublicUser>(`/api/v1/users/${encodeURIComponent(username)}/profile`)
      .then((data) => {
        setProfile(data);
      })
      .catch(() => {
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  }

  const effectiveAvatarUrl = resolveAvatarUrl(profile?.avatar_url ?? avatarUrl ?? null);
  const displayProfile = profile ?? {
    username,
    full_name: fullName || "",
    avatar_url: effectiveAvatarUrl,
    bio: "",
    pronouns: "",
    profile_url: "",
    social_links: [],
    company: "",
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {variant === "avatar" ? (
          <button
            type="button"
            onMouseEnter={() => hoverTo(true)}
            onMouseLeave={() => hoverTo(false)}
            aria-label={t("userProfile.profileSummaryAria", { name: label })}
            style={
              effectiveAvatarUrl
                ? {
                    backgroundImage: `url(${effectiveAvatarUrl})`,
                    backgroundSize: "cover",
                  }
                : undefined
            }
            className={cn(
              "focus-visible:ring-ring flex shrink-0 cursor-pointer items-center justify-center rounded-full font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none select-none ring-1 ring-inset ring-black/5 dark:ring-white/10",
              !children &&
                (effectiveAvatarUrl
                  ? ""
                  : label.trim() || username.trim()
                    ? getUserAvatarColor(username || label)
                    : "bg-primary-subtle text-primary"),
              className,
            )}
          >
            {children ?? (
              effectiveAvatarUrl
                ? null
                : initials(label, username) || (
                    <UserRound className="size-4" aria-hidden />
                  )
            )}
          </button>
        ) : variant === "mention" ? (
          asSpan ? (
            <span
              role="button"
              tabIndex={0}
              onMouseEnter={() => hoverTo(true)}
              onMouseLeave={() => hoverTo(false)}
              className={cn(
                "bg-primary-subtle text-primary hover:bg-surface-selected focus-visible:ring-ring inline cursor-pointer rounded px-1 align-baseline font-bold transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                className,
              )}
            >
              {children ?? <span className="text-primary font-bold">@{username}</span>}
            </span>
          ) : (
            <button
              type="button"
              onMouseEnter={() => hoverTo(true)}
              onMouseLeave={() => hoverTo(false)}
              className={cn(
                "bg-primary-subtle text-primary hover:bg-surface-selected focus-visible:ring-ring inline-flex cursor-pointer items-center rounded px-1 align-baseline font-bold transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                className,
              )}
            >
              {children ?? <span className="text-primary font-bold">@{username}</span>}
            </button>
          )
        ) : (
          <button
            type="button"
            onMouseEnter={() => hoverTo(true)}
            onMouseLeave={() => hoverTo(false)}
            className={cn(
              "text-primary hover:text-primary-hover underline-offset-2 hover:underline focus-visible:ring-ring cursor-pointer rounded-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
              className,
            )}
          >
            {children ?? label}
          </button>
        )}
      </PopoverTrigger>

      <PopoverContent
        align={popoverAlign}
        className="w-72 p-4"
        onMouseEnter={() => hoverTo(true)}
        onMouseLeave={() => hoverTo(false)}
      >
        {loading ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-5 text-sm">
            <Loader2 className="text-primary size-4 animate-spin" aria-hidden />
            {t("userProfile.loadingProfile")}
          </div>
        ) : profile || !loadError ? (
          <div>
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-semibold select-none ring-1 ring-inset ring-black/5 dark:ring-white/10",
                  displayProfile.avatar_url
                    ? ""
                    : getUserAvatarColor(displayProfile.username || displayProfile.full_name || ""),
                )}
              >
                {displayProfile.avatar_url ? (
                  <img
                    src={displayProfile.avatar_url}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  initials(
                    displayProfile.full_name,
                    displayProfile.username,
                  ) || <UserRound className="size-4" aria-hidden />
                )}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="truncate text-sm font-semibold">
                    {displayProfile.full_name || displayProfile.username}
                  </p>
                  {statusBadge}
                </div>
                <p className="text-muted-foreground mt-0.5 truncate text-xs">
                  @{displayProfile.username}
                </p>
              </div>
            </div>
            {displayProfile.bio ? (
              <p className="text-muted-foreground mt-3 line-clamp-3 text-sm leading-5">
                {displayProfile.bio}
              </p>
            ) : null}
            {displayProfile.company ? (
              <p className="text-muted-foreground mt-3 flex items-center gap-1.5 text-xs">
                <Building2 className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{displayProfile.company}</span>
              </p>
            ) : null}
            <Button className="mt-4 w-full" size="sm" asChild>
              <Link href={`/users/${encodeURIComponent(username)}`}>
                {t("userProfile.viewProfile")}
              </Link>
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground py-3 text-center text-sm">
            {t("userProfile.profileUnavailable")}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
