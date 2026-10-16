import type { Metadata } from "next";

import { MonitorView } from "@/components/admin/monitor/monitor-view";
import { getMonitorOverview } from "@/lib/admin-monitor";
import { getCurrentUser } from "@/lib/auth";
import { getServerLocale } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Server" };
export const dynamic = "force-dynamic";

export default async function AdminMonitorPage() {
  const [me, { t }] = await Promise.all([getCurrentUser(), getServerLocale()]);
  // The monitor API is superuser-only: it lists every container and their logs.
  if (!me?.is_superuser) {
    return (
      <div className="border-border bg-surface rounded-xl border p-6 shadow-sm">
        <p className="font-semibold">
          {t("adminShared.permissionRequiredTitle")}
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("adminShared.permissionRequiredBody", {
            feature: t("adminMonitor.permissionFeature"),
            permission: t("adminShared.systemAdministratorLabel"),
          })}
        </p>
      </div>
    );
  }

  const initial = await getMonitorOverview();

  return (
    <div className="space-y-6">
      <header className="border-border border-b pb-5">
        <p className="text-primary text-xs font-semibold tracking-[0.08em] uppercase">
          {t("nav.administration")}
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">
          {t("adminMonitor.title")}
        </h2>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
          {t("adminMonitor.description")}
        </p>
      </header>
      <MonitorView initial={initial} />
    </div>
  );
}
