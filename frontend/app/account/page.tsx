import { CalendarClock, Mail, ShieldCheck, UserRound } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ChangePasswordForm } from "@/components/account/change-password-form";
import { ProfileForm } from "@/components/account/profile-form";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { getCurrentUser } from "@/lib/auth";
import { SITE_NAME } from "@/lib/env";

export const metadata: Metadata = { title: "Your account" };
export const dynamic = "force-dynamic";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

/** Self-service, so it lives outside /admin, which non-admins cannot reach. */
export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const initials = (user.full_name.trim() || user.username)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

  return (
    <AppShell siteName={SITE_NAME} user={user}>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Personal settings"
          title="Your account"
          description="Manage your profile and how you sign in."
        />

        <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start">
          {/* Read-only identity summary - the forms below are for changing it. */}
          <aside className="lg:sticky lg:top-[calc(var(--wh-topbar-height)+1.5rem)]">
            <div className="border-border bg-surface rounded-xl border p-5 text-center shadow-sm lg:text-left">
              <span
                aria-hidden
                className="bg-primary text-primary-foreground mx-auto flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-cover bg-center text-lg font-semibold lg:mx-0"
                style={
                  user.avatar_url
                    ? { backgroundImage: `url(${user.avatar_url})` }
                    : undefined
                }
              >
                {user.avatar_url ? null : initials || <UserRound className="size-6" />}
              </span>

              <p className="mt-3 truncate text-sm font-semibold">
                {user.full_name || user.username}
              </p>
              <p className="text-muted-foreground truncate text-xs">
                @{user.username}
              </p>

              <div className="mt-3 flex flex-wrap justify-center gap-1.5 lg:justify-start">
                <Badge variant={user.is_superuser ? "info" : "neutral"}>
                  {user.is_superuser ? "Administrator" : "Member"}
                </Badge>
                {user.is_protected ? <Badge>protected</Badge> : null}
              </div>

              <dl className="border-border mt-4 space-y-2 border-t pt-4 text-left text-xs">
                <div className="text-muted-foreground flex items-center gap-2">
                  <Mail className="size-3.5 shrink-0" aria-hidden />
                  <dd className="min-w-0 truncate">{user.email}</dd>
                </div>
                <div className="text-muted-foreground flex items-center gap-2">
                  <CalendarClock className="size-3.5 shrink-0" aria-hidden />
                  <dd>Joined {formatDate(user.created_at)}</dd>
                </div>
              </dl>
            </div>
          </aside>

          <div className="min-w-0 space-y-6">
            <section className="border-border bg-surface rounded-xl border p-5 shadow-sm sm:p-6">
              <div className="flex items-center gap-2">
                <UserRound className="text-muted-foreground size-4" aria-hidden />
                <h2 className="text-base font-semibold">Profile</h2>
              </div>
              <p className="text-muted-foreground mt-1 text-sm">
                How you appear to the rest of the workspace.
              </p>
              <ProfileForm user={user} />
            </section>

            <section className="border-border bg-surface rounded-xl border p-5 shadow-sm sm:p-6">
              <div className="flex items-center gap-2">
                <ShieldCheck className="text-muted-foreground size-4" aria-hidden />
                <h2 className="text-base font-semibold">Security</h2>
              </div>
              <p className="text-muted-foreground mt-1 text-sm">
                Change your password. You&apos;ll stay signed in on this device.
              </p>
              <div className="mt-4">
                <ChangePasswordForm />
              </div>
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
