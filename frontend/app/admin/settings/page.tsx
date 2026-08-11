import type { Metadata } from "next";

import { SiteSettingsForm } from "@/components/admin/site-settings-form";
import { getSiteSettings } from "@/lib/admin";

export const metadata: Metadata = { title: "Instance settings" };
export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const settings = await getSiteSettings();

  return (
    <div className="space-y-5">
      <p className="text-muted-foreground text-sm">
        These take effect immediately, with no restart. A field left empty falls
        back to its environment variable.
      </p>

      <div className="border-border bg-surface max-w-2xl rounded-lg border p-5">
        <SiteSettingsForm settings={settings} />
      </div>
    </div>
  );
}
