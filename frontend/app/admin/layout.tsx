import { redirect } from "next/navigation";

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

  // No page header here: the primary sidebar's Administration group
  // (components/layout/sidebar.tsx) already shows which section is open, so
  // a repeated eyebrow/title/description per page was just spending vertical
  // space admin's dense tables and forms can use instead.
  return (
    <AppShell fullWidth siteName={SITE_NAME} user={user}>
      {children}
    </AppShell>
  );
}
