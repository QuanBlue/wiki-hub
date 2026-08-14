import { redirect } from "next/navigation";

import { AdminNav } from "@/components/admin/admin-nav";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { getCurrentUser } from "@/lib/auth";
import { SITE_NAME } from "@/lib/env";

/**
 * Gates every /admin route in one place, so a new section cannot forget it.
 *
 * A non-superuser is shown an explanation rather than redirected: the sidebar
 * offers this section, and silently bouncing someone away from a link they can
 * see is worse than telling them why. The backend enforces the real boundary
 * regardless — this is presentation only.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const isSystemAdmin = user.is_superuser || user.global_permissions.includes("system_admin");

  if (!isSystemAdmin) {
    return (
      <AppShell fullWidth siteName={SITE_NAME} user={user}>
        <div className="space-y-6">
          <PageHeader
            eyebrow="Administration"
            title="Settings"
            description="Manage this WikiHub instance."
          />
          <div className="border-border bg-surface rounded-xl border p-6 shadow-sm">
            <p className="font-semibold">Administrator access required</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Your account does not have administrator privileges. Ask an
              administrator if you need access to this section.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell fullWidth siteName={SITE_NAME} user={user}>
      {/*
        Explicit margins rather than `space-y-*`: the gap below the tab strip
        has to be visibly larger than the one above it, so the tabs read as
        belonging to the header and the panel below reads as their content.
        A uniform rhythm makes the active tab look detached from its own page.
      */}
      <div>
        <PageHeader
          eyebrow="Administration"
          title="Settings"
          description="Manage people, safeguards, and the configuration of this WikiHub instance."
        />

        <div className="mt-6">
          <AdminNav />
        </div>

        <div className="mt-8">{children}</div>
      </div>
    </AppShell>
  );
}
