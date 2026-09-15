import type { Metadata } from "next";

import { SiteSettingsForm } from "@/components/admin/site-settings-form";
import { getSiteSettings } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth";
import { getServerLocale } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Instance settings" };
export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const [me, { t }] = await Promise.all([getCurrentUser(), getServerLocale()]);
  // The layout also admits `manage_users`/`manage_groups` holders (see its
  // own comment) - neither unlocks this page, only `system_admin` does, so
  // this needs its own check before calling `getSiteSettings()`, which the
  // backend restricts to `system_admin` regardless (see
  // `app/api/v1/site_settings.py`).
  const isSystemAdmin =
    me?.is_superuser || me?.global_permissions.includes("system_admin");

  if (!isSystemAdmin) {
    return (
      <div className="border-border bg-surface rounded-xl border p-6 shadow-sm">
        <p className="font-semibold">{t("adminShared.permissionRequiredTitle")}</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("adminShared.permissionRequiredBody", {
            feature: t("adminSettings.permissionFeature"),
            permission: t("adminShared.systemAdministratorLabel"),
          })}
        </p>
      </div>
    );
  }

  const settings = await getSiteSettings();

  return (
    <div className="space-y-6">
      <header className="border-border border-b pb-5">
        <p className="text-primary text-xs font-semibold tracking-[0.08em] uppercase">{t("nav.administration")}</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">{t("adminSettings.title")}</h2>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">{t("adminSettings.description")}</p>
      </header>

      <SiteSettingsForm settings={settings} />
    </div>
  );
}
