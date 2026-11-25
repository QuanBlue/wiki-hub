import type { Metadata } from "next";

import { TemplateManager } from "@/components/templates/template-manager";
import { getCurrentUser } from "@/lib/auth";
import { getServerLocale } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Templates" };
export const dynamic = "force-dynamic";

export default async function AdminTemplatesPage() {
  const [me, { t }] = await Promise.all([getCurrentUser(), getServerLocale()]);
  const isSystemAdmin =
    me?.is_superuser || me?.global_permissions.includes("system_admin");

  if (!isSystemAdmin) {
    return (
      <div className="border-border bg-surface rounded-xl border p-6 shadow-sm">
        <p className="font-semibold">
          {t("adminShared.permissionRequiredTitle")}
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("adminShared.permissionRequiredBody", {
            feature: t("templates.adminPermissionFeature"),
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
          {t("templates.adminTitle")}
        </h2>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
          {t("templates.adminDescription")}
        </p>
      </header>
      <TemplateManager mode="global" />
    </div>
  );
}
