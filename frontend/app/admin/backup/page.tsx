import type { Metadata } from "next";

import { BackupPanel } from "@/components/admin/backup-panel";

export const metadata: Metadata = { title: "Backup" };
export const dynamic = "force-dynamic";

export default function AdminBackupPage() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Backup and migration</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Protect this workspace and prepare knowledge for a future migration.
        </p>
      </div>
      <BackupPanel />
    </div>
  );
}
