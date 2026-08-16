import type { Metadata } from "next";

import { SiteSettingsForm } from "@/components/admin/site-settings-form";
import { getSiteSettings } from "@/lib/admin";

export const metadata: Metadata = { title: "Instance settings" };
export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const settings = await getSiteSettings();

  return (
    <div className="space-y-6">
      <header className="border-border border-b pb-5">
        <p className="text-primary text-xs font-semibold tracking-[0.08em] uppercase">Administration</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">Instance settings</h2>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">Manage workspace identity, security limits and navigation rules for this WikiHub instance.</p>
      </header>

      <SiteSettingsForm settings={settings} />
    </div>
  );
}
