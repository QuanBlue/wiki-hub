"use client";

import { Building2, Clock3, Loader2, UserRound, UsersRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  isUserStatusActive,
} from "@/components/account/status-dialog";
import {
  WelcomePopoverBadge,
  WelcomePopoverEffect,
} from "@/components/users/welcome-effect-badge";
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
  avatarCrop,
  avatarContentType,
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
  avatarCrop?: { zoom: number; x: number; y: number } | null;
  avatarContentType?: string | null;
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
    function onWelcomeChanged(e: Event) {
      const customEvent = e as CustomEvent<{
        username: string;
        welcome_effect?: PublicUser["welcome_effect"];
        welcome_message?: string;
      }>;
      if (
        customEvent.detail?.username &&
        customEvent.detail.username.toLowerCase() === username.toLowerCase()
      ) {
        setProfile((prev) =>
          prev
            ? {
                ...prev,
                welcome_effect: customEvent.detail.welcome_effect ?? "",
                welcome_message: customEvent.detail.welcome_message ?? "",
              }
            : null,
        );
      }
    }
    window.addEventListener("wikihub:user-welcome-changed", onWelcomeChanged);
    return () => {
      window.removeEventListener("wikihub:user-status-changed", onStatusChanged);
      window.removeEventListener("wikihub:user-welcome-changed", onWelcomeChanged);
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
  const effectiveAvatarCrop = profile?.avatar_crop ?? avatarCrop ?? null;
  const effectiveAvatarContentType =
    profile?.avatar_content_type ?? avatarContentType ?? null;
  const displayProfile = profile ?? {
    username,
    full_name: fullName || "",
    avatar_url: effectiveAvatarUrl,
    avatar_content_type: null,
    avatar_crop: null,
    cover_url: null,
    cover_updated_at: null,
    bio: "",
    pronouns: "",
    profile_url: "",
    social_links: [],
    company: "",
    status_emoji: null,
    status_text: null,
    status_expires_at: null,
    welcome_effect: "" as const,
    welcome_message: "",
    is_workspace_admin: false,
  };
  const welcomeEffect = displayProfile.welcome_effect ?? "";
  const welcomeMessage = displayProfile.welcome_message?.trim() ?? "";
  const effectiveCoverUrl = versionedAvatarUrl(
    displayProfile.cover_url ?? null,
    displayProfile.cover_updated_at,
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {variant === "avatar" ? (
          <button
            type="button"
            onMouseEnter={() => hoverTo(true)}
            onMouseLeave={() => hoverTo(false)}
            aria-label={t("userProfile.profileSummaryAria", { name: label })}
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
                <CroppedAvatarImage
                  src={effectiveAvatarUrl}
                  crop={effectiveAvatarCrop}
                  contentType={effectiveAvatarContentType}
                />
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
        className="w-72 overflow-hidden p-0"
        onMouseEnter={() => hoverTo(true)}
        onMouseLeave={() => hoverTo(false)}
      >
        {loading ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 px-4 py-6 text-sm">
            <Loader2 className="text-primary size-4 animate-spin" aria-hidden />
            {t("userProfile.loadingProfile")}
          </div>
        ) : profile || !loadError ? (
          <div>
            {/* Cover banner matching Home profile card */}
            <div className="bg-primary-subtle relative aspect-[15/4] w-full overflow-hidden">
              {effectiveCoverUrl ? (
                <img
                  src={effectiveCoverUrl}
                  alt=""
                  className="size-full object-cover"
                />
              ) : null}
              {welcomeEffect ? (
                <div className="absolute top-2 right-2">
                  <WelcomePopoverBadge effect={welcomeEffect} />
                </div>
              ) : null}
            </div>

            {/* Lower body with welcome effect rendered underneath readable content */}
            <div className="relative px-4 pb-4">
              {welcomeEffect ? <WelcomePopoverEffect effect={welcomeEffect} /> : null}
              <div className="relative z-10">
                <div className="flex items-end gap-3">
                  <span
                    className={cn(
                      "ring-surface relative -mt-8 flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full text-lg font-semibold ring-4 select-none",
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
                  ) || <UserRound className="size-6" aria-hidden />
                )}
              </span>
              <div className="min-w-0 flex-1 pb-0.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="truncate text-[15px] leading-tight font-semibold tracking-tight">
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
            {welcomeEffect && welcomeMessage ? (
              <p className="bg-surface/80 border-border/70 text-foreground mt-2.5 rounded-md border px-2.5 py-1.5 text-xs leading-snug backdrop-blur-xs">
                {welcomeMessage}
              </p>
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
            {profile ? (
              <div className="border-border/70 mt-3 flex items-center gap-2 border-t pt-2.5 text-xs">
                <UsersRound className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                <span className="text-muted-foreground">
                  {t("profile.workspaceRole")}
                </span>
                <span className="text-foreground ml-auto font-medium">
                  {displayProfile.is_workspace_admin
                    ? t("profile.administrator")
                    : t("profile.member")}
                </span>
              </div>
            ) : null}
                <Button className="mt-3 w-full" size="sm" asChild>
                  <Link href={`/users/${encodeURIComponent(username)}`}>
                    {t("userProfile.viewProfile")}
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground px-4 py-4 text-center text-sm">
            {t("userProfile.profileUnavailable")}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
