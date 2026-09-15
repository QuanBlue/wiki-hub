import type { Metadata } from "next";

import { BackupPanel } from "@/components/admin/backup-panel";
import { getCurrentUser } from "@/lib/auth";
import { getServerLocale } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Backup" };
export const dynamic = "force-dynamic";

export default async function AdminBackupPage() {
  const [me, { t }] = await Promise.all([getCurrentUser(), getServerLocale()]);
  // The layout also admits `manage_users`/`manage_groups` holders (see its
  // own comment) - neither unlocks this page, only `system_admin` does.
  // `BackupPanel` fetches its own data client-side, which the backend
  // already restricts to `system_admin`, but that would only surface as an
  // inline error inside the panel rather than this clear message.
  const isSystemAdmin =
    me?.is_superuser || me?.global_permissions.includes("system_admin");

  if (!isSystemAdmin) {
    return (
      <div className="border-border bg-surface rounded-xl border p-6 shadow-sm">
        <p className="font-semibold">{t("adminShared.permissionRequiredTitle")}</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("adminShared.permissionRequiredBody", {
            feature: t("adminBackup.permissionFeature"),
            permission: t("adminShared.systemAdministratorLabel"),
          })}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="border-border border-b pb-5">
        <p className="text-primary text-xs font-semibold tracking-[0.08em] uppercase">
          {t("nav.administration")}
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">
          {t("adminBackup.title")}
        </h2>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
          {t("adminBackup.description")}
        </p>
      </header>
      <BackupPanel />
    </div>
  );
}
