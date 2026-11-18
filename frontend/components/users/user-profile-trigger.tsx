"use client";

import { Building2, Clock3, Loader2, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  isUserStatusActive,
} from "@/components/account/status-dialog";
import { CroppedAvatarImage, getUserAvatarColor, versionedAvatarUrl } from "@/components/ui/avatar";
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
  const { t, locale } = useTranslation();
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

  useEffect(() => {
    function onStatusChanged(e: Event) {
      const customEvent = e as CustomEvent<{
        username: string;
        status_emoji?: string | null;
        status_text?: string | null;
        status_expires_at?: string | null;
      }>;
      if (
        customEvent.detail?.username &&
        customEvent.detail.username.toLowerCase() === username.toLowerCase()
      ) {
        setProfile((prev) =>
          prev
            ? {
                ...prev,
                status_emoji: customEvent.detail.status_emoji ?? "",
                status_text: customEvent.detail.status_text ?? "",
                status_expires_at: customEvent.detail.status_expires_at ?? null,
              }
            : null,
        );
      }
    }
    window.addEventListener("wikihub:user-status-changed", onStatusChanged);
    return () => {
      window.removeEventListener("wikihub:user-status-changed", onStatusChanged);
    };
  }, [username]);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) return;
    if (loading) return;

    // Show skeleton loader only if we don't have profile data yet
    if (!profile) {
      setLoading(true);
    }
    api
      .get<PublicUser>(`/api/v1/users/${encodeURIComponent(username)}/profile`)
      .then((data) => {
        setProfile(data);
        setLoadError(false);
      })
      .catch(() => {
        if (!profile) {
          setLoadError(true);
        }
      })
      .finally(() => setLoading(false));
  }

  const effectiveAvatarUrl = versionedAvatarUrl(
    profile?.avatar_url ?? avatarUrl ?? null,
    profile?.avatar_updated_at,
  );
  const useCroppedAvatar = Boolean(
    effectiveAvatarUrl &&
      profile?.avatar_content_type === "image/gif" &&
      profile?.avatar_crop &&
      !(
        profile.avatar_crop.zoom === 1 &&
        profile.avatar_crop.x === 0 &&
        profile.avatar_crop.y === 0
      ),
  );
  const displayProfile = profile ?? {
    username,
    full_name: fullName || "",
    avatar_url: effectiveAvatarUrl,
    avatar_content_type: null,
    avatar_crop: null,
    bio: "",
    pronouns: "",
    profile_url: "",
    social_links: [],
    company: "",
    status_emoji: null,
    status_text: null,
    status_expires_at: null,
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
              effectiveAvatarUrl && !useCroppedAvatar
                ? {
                    backgroundImage: `url(${effectiveAvatarUrl})`,
                    backgroundSize: "cover",
                  }
                : undefined
            }
            className={cn(
              "focus-visible:ring-ring relative flex shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none select-none ring-1 ring-inset ring-black/5 dark:ring-white/10",
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
              effectiveAvatarUrl ? (
                useCroppedAvatar ? (
                  <CroppedAvatarImage
                    src={effectiveAvatarUrl}
                    crop={profile?.avatar_crop}
                    contentType={profile?.avatar_content_type}
                  />
                ) : null
              ) : (
                initials(label, username) || (
                  <UserRound className="size-4" aria-hidden />
                )
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
                  "relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-semibold select-none ring-1 ring-inset ring-black/5 dark:ring-white/10",
                  displayProfile.avatar_url
                    ? ""
                    : getUserAvatarColor(displayProfile.username || displayProfile.full_name || ""),
                )}
              >
                {displayProfile.avatar_url ? (
                  <CroppedAvatarImage
                    src={effectiveAvatarUrl ?? displayProfile.avatar_url}
                    crop={displayProfile.avatar_crop}
                    contentType={displayProfile.avatar_content_type}
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
            {isUserStatusActive(displayProfile) ? (
              <div className="border-border/70 bg-surface-sunken/60 relative mt-3 rounded-lg border p-2.5 text-xs shadow-2xs">
                {/* Speech callout tail pointing up to avatar */}
                <span
                  aria-hidden="true"
                  className="border-border/70 bg-surface-sunken absolute -top-1.5 left-5 size-2.5 rotate-45 border-t border-l"
                />
                <div className="relative z-1 flex items-start gap-2">
                  {displayProfile.status_emoji ? (
                    <span className="shrink-0 text-base leading-none pt-0.5" aria-hidden>
                      {displayProfile.status_emoji}
                    </span>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground text-xs font-medium leading-snug break-words">
                      {displayProfile.status_text}
                    </p>
                    {displayProfile.status_expires_at ? (
                      <p className="text-muted-foreground mt-1 flex items-center gap-1 text-[11px]">
                        <Clock3 className="size-3 shrink-0" aria-hidden />
                        <span>
                          {t("profile.statusExpiresTooltip", {
                            time: new Date(displayProfile.status_expires_at).toLocaleString(locale, {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false,
                            }),
                          })}
                        </span>
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
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
