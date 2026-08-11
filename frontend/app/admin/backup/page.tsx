import type { Metadata } from "next";

import { BackupPanel } from "@/components/admin/backup-panel";

export const metadata: Metadata = { title: "Backup" };
export const dynamic = "force-dynamic";

export default function AdminBackupPage() {
  return <BackupPanel />;
}
