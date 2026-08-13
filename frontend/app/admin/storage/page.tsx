import type { Metadata } from "next";

import { StoragePanel } from "@/components/admin/storage-panel";

export const metadata: Metadata = { title: "Object storage" };
export const dynamic = "force-dynamic";

export default function AdminStoragePage() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Object storage</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Browse, download and delete files stored in the S3 bucket. Removing a
          Confluence archive also clears its duplicate-detection hash so the
          same file can be re-imported.
        </p>
      </div>

      <div className="border-border bg-surface rounded-xl border p-5 shadow-sm">
        <StoragePanel />
      </div>
    </div>
  );
}
