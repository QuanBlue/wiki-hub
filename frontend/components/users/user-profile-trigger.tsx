"use client";

import { Building2, Loader2, UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { api } from "@/lib/api-client";
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
  variant = "name",
  className,
}: {
  username: string;
  fullName?: string | null;
  variant?: "name" | "avatar";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const label = fullName || username;

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

  const displayProfile = profile ?? {
    username,
    full_name: fullName || "",
    avatar_url: null,
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
            aria-label={`Show profile summary for ${label}`}
            className={cn(
              "bg-primary-subtle text-primary hover:bg-surface-selected focus-visible:ring-ring flex shrink-0 cursor-pointer items-center justify-center rounded-full font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
              className,
            )}
          >
            {initials(label, username) || (
              <UserRound className="size-4" aria-hidden />
            )}
          </button>
        ) : (
          <button
            type="button"
            className={cn(
              "text-primary hover:text-primary-hover focus-visible:ring-ring cursor-pointer rounded-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
              className,
            )}
          >
            {label}
          </button>
        )}
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 p-4">
        {loading ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-5 text-sm">
            <Loader2 className="text-primary size-4 animate-spin" aria-hidden />
            Loading profile…
          </div>
        ) : profile || !loadError ? (
          <div>
            <div className="flex items-start gap-3">
              <span className="bg-primary text-primary-foreground flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-semibold">
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
                <p className="truncate text-sm font-semibold">
                  {displayProfile.full_name || displayProfile.username}
                </p>
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
                View profile
              </Link>
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground py-3 text-center text-sm">
            Profile information is unavailable.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
