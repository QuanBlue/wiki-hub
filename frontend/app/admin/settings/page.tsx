import type { Metadata } from "next";
import { HardDrive, ShieldCheck, SlidersHorizontal } from "lucide-react";

import { SiteSettingsForm } from "@/components/admin/site-settings-form";
import { getSiteSettings } from "@/lib/admin";

export const metadata: Metadata = { title: "Instance settings" };
export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const settings = await getSiteSettings();

  return (
    <div className="space-y-6">
      <div className="border-border bg-surface-sunken flex items-start gap-3 rounded-lg border px-4 py-3.5">
        <div className="bg-primary-subtle text-primary mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-semibold">W</div>
        <div>
          <h2 className="text-sm font-semibold">Workspace configuration</h2>
          <p className="text-muted-foreground mt-0.5 text-sm">Manage the identity, limits and navigation rules for this WikiHub instance.</p>
        </div>
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="border-border bg-surface-sunken rounded-lg border p-4 lg:sticky lg:top-24">
          <p className="text-muted-foreground px-2 text-[10px] font-semibold uppercase tracking-[0.08em]">Settings sections</p>
          <nav aria-label="Settings sections" className="mt-3 space-y-1">
            <a href="#general-settings" className="bg-surface-selected text-primary flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><SlidersHorizontal className="size-4" />General workspace</a>
            <a href="#storage-settings" className="text-foreground hover:bg-surface-hover flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><HardDrive className="text-muted-foreground size-4" />Storage &amp; quotas</a>
            <a href="#sidebar-settings" className="text-foreground hover:bg-surface-hover flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ShieldCheck className="text-muted-foreground size-4" />Sidebar access</a>
          </nav>
          <div className="border-border mt-5 border-t pt-4">
            <p className="text-muted-foreground px-2 text-xs leading-relaxed">Changes apply immediately after saving.</p>
          </div>
        </aside>

        <div className="min-w-0">
          <SiteSettingsForm settings={settings} />
        </div>
      </div>
    </div>
  );
}
