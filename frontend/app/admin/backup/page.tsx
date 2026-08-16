import type { Metadata } from "next";

import { BackupPanel } from "@/components/admin/backup-panel";

export const metadata: Metadata = { title: "Backup" };
export const dynamic = "force-dynamic";

export default function AdminBackupPage() {
  return (
    <div className="space-y-6">
      <header className="border-border border-b pb-5">
        <p className="text-primary text-xs font-semibold tracking-[0.08em] uppercase">
          Administration
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">
          Backup &amp; migration
        </h2>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
          Export workspace data, restore a trusted backup, or bring knowledge
          across from a Confluence archive.
        </p>
      </header>
      <BackupPanel />
    </div>
  );
}
