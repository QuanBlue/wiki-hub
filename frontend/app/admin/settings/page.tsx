import type { Metadata } from "next";

import { SiteSettingsForm } from "@/components/admin/site-settings-form";
import { getSiteSettings } from "@/lib/admin";

export const metadata: Metadata = { title: "Instance settings" };
export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const settings = await getSiteSettings();

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Workspace configuration</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Changes take effect immediately. Leave a field empty to keep its
          environment-provided value.
        </p>
      </div>

      <div>
        <SiteSettingsForm settings={settings} />
      </div>
    </div>
  );
}
