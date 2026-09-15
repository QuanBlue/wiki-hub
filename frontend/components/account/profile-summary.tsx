import {
  AtSign,
  Building2,
  ExternalLink,
  Link2,
  Mail,
  Pencil,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/context";
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
      className="text-primary inline-flex max-w-full items-center gap-1.5 truncate hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <span className="truncate">{children}</span>
      <ExternalLink className="size-3.5 shrink-0" aria-hidden />
    </a>
  );
}

function ProfileField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="mt-1.5 text-sm">{children}</dd>
    </div>
  );
}

export function ProfileSummary({ user, onEdit }: { user: Me; onEdit: () => void }) {
  const hasAbout = Boolean(user.pronouns || user.company);
  const hasLinks = Boolean(user.profile_url || user.social_links.length);
  const { t } = useTranslation();

  return (
    <section className="w-full">
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="max-w-2xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-base font-semibold">{t("profile.profileTitle")}</h2>
            <Button variant="secondary" onClick={onEdit}>
              <Pencil />
              {t("profile.editProfile")}
            </Button>
          </div>

          <div className="mt-7">
            <p className="text-xl font-semibold">{user.full_name || user.username}</p>
            <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-sm">
              <AtSign className="size-3.5" aria-hidden />
              {user.username}
            </p>
            {user.bio ? (
              <p className="mt-5 max-w-xl text-sm leading-6">{user.bio}</p>
            ) : null}
          </div>

          <dl className="border-border mt-8 space-y-7 border-t pt-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <ProfileField label={t("profile.email")}>
                <span className="flex min-w-0 items-center gap-2 font-medium">
                  <Mail className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  <span className="truncate">{user.email}</span>
                </span>
              </ProfileField>
              <ProfileField label={t("profile.workspaceRole")}>
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  <ShieldCheck className="text-muted-foreground size-4" aria-hidden />
                  <Badge variant={user.is_superuser ? "info" : "neutral"}>
                    {user.is_superuser ? t("profile.administrator") : t("profile.member")}
                  </Badge>
                  {user.is_protected ? <Badge>{t("profile.protected")}</Badge> : null}
                </span>
              </ProfileField>
            </div>

            {hasAbout ? (
              <div className="border-border grid gap-6 border-t pt-6 sm:grid-cols-2">
                {user.pronouns ? <ProfileField label={t("profile.pronouns")}>{user.pronouns}</ProfileField> : <div />}
                {user.company ? (
                  <ProfileField label={t("profile.company")}>
                    <span className="flex items-center gap-2">
                      <Building2 className="text-muted-foreground size-4" aria-hidden />
                      {user.company}
                    </span>
                  </ProfileField>
                ) : null}
              </div>
            ) : null}

            {hasLinks ? (
              <div className="border-border grid gap-6 border-t pt-6 sm:grid-cols-2">
                {user.profile_url ? (
                  <ProfileField label={t("profile.website")}>
                    <ExternalProfileLink href={user.profile_url}>
                      {user.profile_url}
                    </ExternalProfileLink>
                  </ProfileField>
                ) : <div />}
                {user.social_links.length ? (
                  <ProfileField label={t("profile.socialLinks")}>
                    <div className="space-y-2">
                      {user.social_links.map((link) => (
                        <div key={link} className="flex items-center gap-2">
                          <Link2 className="text-muted-foreground size-4 shrink-0" aria-hidden />
                          <ExternalProfileLink href={link}>{link}</ExternalProfileLink>
                        </div>
                      ))}
                    </div>
                  </ProfileField>
                ) : null}
              </div>
            ) : null}
          </dl>
        </div>

        <aside className="border-border bg-surface-sunken/60 flex flex-col items-center rounded-lg border p-5 text-center">
          <span
            aria-hidden
            className="bg-primary text-primary-foreground flex size-36 shrink-0 items-center justify-center overflow-hidden rounded-full text-3xl font-semibold shadow-sm ring-1 ring-border"
          >
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" className="size-full object-cover" />
            ) : (
              initials(user.full_name, user.username) || <UserRound className="size-10" />
            )}
          </span>
          <p className="mt-4 text-sm font-medium">{t("profile.profilePicture")}</p>
          <p className="text-muted-foreground mt-1 text-xs">{t("profile.profilePictureHint")}</p>
        </aside>
      </div>
    </section>
  );
}
