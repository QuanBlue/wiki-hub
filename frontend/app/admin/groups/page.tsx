import type { Metadata } from "next";

import { GroupManager } from "@/components/admin/group-manager";
import { listAllUsers } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth";
import { listGroups } from "@/lib/groups";
import { getServerLocale } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Groups" };
export const dynamic = "force-dynamic";

export default async function AdminGroupsPage() {
  const [me, { t }] = await Promise.all([getCurrentUser(), getServerLocale()]);
  // Mirrors the check in app/admin/users/page.tsx - the layout only checks
  // for *some* admin permission, so `manage_users` alone gets someone past
  // it but grants nothing here (`list_groups` requires `manage_groups` - see
  // `app/api/v1/groups.py`).
  const canManageGroups =
    me?.is_superuser ||
    me?.global_permissions.includes("system_admin") ||
    me?.global_permissions.includes("manage_groups");

  if (!canManageGroups) {
    return (
      <div className="border-border bg-surface rounded-xl border p-6 shadow-sm">
        <p className="font-semibold">{t("adminShared.permissionRequiredTitle")}</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("adminShared.permissionRequiredBody", {
            feature: t("adminGroups.permissionFeature"),
            permission: t("adminShared.manageGroupsLabel"),
          })}
        </p>
      </div>
    );
  }

  const [groups, users] = await Promise.all([
    listGroups(),
    listAllUsers(),
  ]);

  return (
    <div className="space-y-6">
      <header className="border-border border-b pb-5">
        <p className="text-primary text-xs font-semibold tracking-[0.08em] uppercase">{t("nav.administration")}</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">{t("adminGroups.title")}</h2>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">{t("adminGroups.description")}</p>
      </header>
      <GroupManager initialGroups={groups} users={users} />
    </div>
  );
}
