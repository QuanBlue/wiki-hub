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

/** Self-service, so it lives outside /admin, which non-admins cannot reach. */
export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AppShell siteName={SITE_NAME} user={user}>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Personal settings"
          title="Your account"
          description={
            <>
              {user.full_name || user.username}{" "}
              <span className="text-muted-foreground">@{user.username}</span>
            </>
          }
        />

        <section className="border-border bg-surface max-w-2xl rounded-xl border p-5 shadow-sm">
          <h2 className="text-base font-semibold">Profile</h2>
          <dl className="mt-3 flex gap-2 text-sm">
            <dt className="text-muted-foreground">Role</dt>
            <dd className="flex items-center gap-2">
              {user.is_superuser ? "Administrator" : "Member"}
              {user.is_protected ? <Badge>protected</Badge> : null}
            </dd>
          </dl>
          <ProfileForm user={user} />
        </section>

        <section className="border-border bg-surface max-w-2xl rounded-xl border p-5 shadow-sm">
          <h2 className="text-base font-semibold">Change password</h2>
          <div className="mt-4">
            <ChangePasswordForm />
          </div>
        </section>
      </div>
    </AppShell>
  );
}
