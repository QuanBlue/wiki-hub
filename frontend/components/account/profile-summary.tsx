"use client";

import {
  AtSign,
  Building2,
  ExternalLink,
  Globe,
  Link2,
  Mail,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProfileImageViewer } from "@/components/users/profile-image-viewer";
import { getUserAvatarColor, resolveAvatarUrl } from "@/components/ui/avatar";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { Me } from "@/types/api";

function initials(name: string, username: string): string {
  return (name.trim() || username)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

function ExternalProfileLink({ href, children }: { href: string; children: ReactNode }) {
  const url = href.startsWith("http://") || href.startsWith("https://") ? href : `https://${href}`;

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="text-primary inline-flex max-w-full items-center gap-1.5 truncate text-sm font-medium transition-colors duration-150 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <span className="truncate">{children}</span>
      <ExternalLink className="size-3.5 shrink-0 opacity-70" aria-hidden />
    </a>
  );
}

export function ProfileSummary({ user, onEdit }: { user: Me; onEdit: () => void }) {
  const { t } = useTranslation();
  const [imgError, setImgError] = useState(false);
  const effectiveAvatarUrl = resolveAvatarUrl(user.avatar_url);

  return (
    <section className="w-full max-w-[37.5rem] space-y-6">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{t("profile.profileTitle")}</h2>
          <p className="text-muted-foreground mt-0.5 text-sm">{t("account.pageDescription")}</p>
        </div>
        <Button variant="secondary" onClick={onEdit} className="shrink-0 gap-1.5">
          <Pencil className="size-3.5" aria-hidden />
          {t("profile.editProfile")}
        </Button>
      </div>

      {/* Main Profile Card */}
      <div className="border-border bg-surface relative w-full overflow-hidden rounded-lg border">
        <div className="bg-primary-subtle relative aspect-[15/4] overflow-hidden">
          {user.cover_url ? (
            <ProfileImageViewer src={user.cover_url} kind="cover" ownerName={user.full_name} ownerUsername={user.username} updatedAt={user.cover_updated_at} className="absolute inset-0 size-full">
              <img src={user.cover_url} alt="" className="absolute inset-0 size-full object-cover" />
            </ProfileImageViewer>
          ) : null}
        </div>
        {/* Identity Header */}
        <div className="px-4 pb-4 sm:px-6 sm:pb-6">
          <div className="flex items-start gap-3 sm:gap-5">
            <div className="relative z-10 -mt-10 size-20 shrink-0 self-start sm:-mt-20 sm:size-40">
              <ProfileImageViewer
                src={effectiveAvatarUrl && !imgError ? effectiveAvatarUrl : null}
                kind="avatar"
                ownerName={user.full_name}
                ownerUsername={user.username}
                updatedAt={user.avatar_updated_at}
                className="size-full rounded-full focus-visible:rounded-full"
              >
                <span
                  aria-hidden
                  className={cn(
                    "ring-surface flex size-full items-center justify-center overflow-hidden rounded-full text-3xl font-semibold ring-4 select-none sm:text-4xl",
                    effectiveAvatarUrl && !imgError
                      ? ""
                      : getUserAvatarColor(user.username || user.full_name || ""),
                  )}
                >
                  {effectiveAvatarUrl && !imgError ? (
                    <img
                      src={effectiveAvatarUrl}
                      alt=""
                      className="size-full object-cover"
                      onError={() => setImgError(true)}
                    />
                  ) : (
                    initials(user.full_name, user.username) || <UserRound className="size-10" />
                  )}
                </span>
              </ProfileImageViewer>
            </div>

            <div className="min-w-0 flex-1 pt-4">
              <h3 className="line-clamp-2 text-xl leading-tight font-semibold tracking-tight text-foreground">
                {user.full_name || user.username}
              </h3>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant={user.is_superuser ? "info" : "neutral"} className="gap-1 py-0.5 px-2 text-xs font-semibold">
                  <ShieldCheck className="size-3.5" aria-hidden />
                  {user.is_superuser ? t("profile.administrator") : t("profile.member")}
                </Badge>
                {user.is_protected ? (
                  <Badge variant="warning" className="gap-1 py-0.5 px-2 text-xs font-semibold">
                    <ShieldAlert className="size-3.5" aria-hidden />
                    {t("profile.protected")}
                  </Badge>
                ) : null}
              </div>

              <p className="text-muted-foreground mt-2 flex items-center gap-1.5 text-sm font-medium">
                <AtSign className="size-3.5 text-muted-foreground" aria-hidden />
                <span>{user.username}</span>
              </p>
            </div>
          </div>
          {user.bio ? (
            <p className="text-foreground/90 mt-2 max-w-2xl text-sm leading-relaxed whitespace-pre-line">
              {user.bio}
            </p>
          ) : null}
        </div>

        {/* Structured Profile Attributes */}
        <dl className="border-border divide-border border-t divide-y text-sm">
          {/* Email Address */}
          <div className="flex flex-col sm:flex-row sm:items-center px-6 py-4 gap-1.5 sm:gap-4 hover:bg-surface-hover/40 transition-colors">
            <dt className="text-muted-foreground w-48 sm:w-56 font-medium flex items-center gap-2.5 shrink-0">
              <Mail className="size-4 text-primary" aria-hidden />
              <span>{t("profile.email")}</span>
            </dt>
            <dd className="text-foreground font-medium truncate min-w-0 flex-1">
              {user.email}
            </dd>
          </div>

          {/* Company / Team */}
          {user.company ? (
            <div className="flex flex-col sm:flex-row sm:items-center px-6 py-4 gap-1.5 sm:gap-4 hover:bg-surface-hover/40 transition-colors">
              <dt className="text-muted-foreground w-48 sm:w-56 font-medium flex items-center gap-2.5 shrink-0">
                <Building2 className="size-4 text-primary" aria-hidden />
                <span>{t("profile.company")}</span>
              </dt>
              <dd className="text-foreground font-medium min-w-0 flex-1">
                {user.company}
              </dd>
            </div>
          ) : null}

          {/* Pronouns */}
          {user.pronouns ? (
            <div className="flex flex-col sm:flex-row sm:items-center px-6 py-4 gap-1.5 sm:gap-4 hover:bg-surface-hover/40 transition-colors">
              <dt className="text-muted-foreground w-48 sm:w-56 font-medium flex items-center gap-2.5 shrink-0">
                <UserRound className="size-4 text-primary" aria-hidden />
                <span>{t("profile.pronouns")}</span>
              </dt>
              <dd className="text-foreground font-medium min-w-0 flex-1">
                {user.pronouns}
              </dd>
            </div>
          ) : null}

          {/* Website */}
          {user.profile_url ? (
            <div className="flex flex-col sm:flex-row sm:items-center px-6 py-4 gap-1.5 sm:gap-4 hover:bg-surface-hover/40 transition-colors">
              <dt className="text-muted-foreground w-48 sm:w-56 font-medium flex items-center gap-2.5 shrink-0">
                <Globe className="size-4 text-primary" aria-hidden />
                <span>{t("profile.website")}</span>
              </dt>
              <dd className="min-w-0 flex-1">
                <ExternalProfileLink href={user.profile_url}>
                  {user.profile_url}
                </ExternalProfileLink>
              </dd>
            </div>
          ) : null}

          {/* Social Links */}
          {user.social_links.length ? (
            <div className="flex flex-col sm:flex-row sm:items-start px-6 py-4 gap-1.5 sm:gap-4 hover:bg-surface-hover/40 transition-colors">
              <dt className="text-muted-foreground w-48 sm:w-56 font-medium flex items-center gap-2.5 shrink-0 pt-0.5">
                <Link2 className="size-4 text-primary" aria-hidden />
                <span>{t("profile.socialLinks")}</span>
              </dt>
              <dd className="min-w-0 flex-1 space-y-1.5">
                {user.social_links.map((link) => (
                  <div key={link} className="flex items-center gap-2">
                    <ExternalProfileLink href={link}>{link}</ExternalProfileLink>
                  </div>
                ))}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
    </section>
  );
}
