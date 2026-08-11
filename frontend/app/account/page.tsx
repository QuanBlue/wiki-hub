import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ChangePasswordForm } from "@/components/account/change-password-form";
import { AppShell } from "@/components/layout/app-shell";
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
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Your account
          </h1>
          <p className="text-muted-foreground mt-1.5">
            {user.full_name || user.username}{" "}
            <span className="text-muted-foreground">@{user.username}</span>
          </p>
        </div>

        <section className="border-border bg-surface max-w-2xl rounded-lg border p-5">
          <h2 className="font-medium">Profile</h2>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">E-mail</dt>
            <dd>{user.email}</dd>
            <dt className="text-muted-foreground">Role</dt>
            <dd className="flex items-center gap-2">
              {user.is_superuser ? "Administrator" : "Member"}
              {user.is_protected ? <Badge>protected</Badge> : null}
            </dd>
            <dt className="text-muted-foreground">Last sign-in</dt>
            <dd>
              {user.last_login_at
                ? new Date(user.last_login_at).toLocaleString()
                : "—"}
            </dd>
          </dl>
        </section>

        <section className="border-border bg-surface max-w-2xl rounded-lg border p-5">
          <h2 className="font-medium">Change password</h2>
          <div className="mt-4">
            <ChangePasswordForm protectedAccount={user.is_protected} />
          </div>
        </section>
      </div>
    </AppShell>
  );
}
