import type { Metadata } from "next";

import { StoragePanel } from "@/components/admin/storage-panel";

export const metadata: Metadata = { title: "Object storage" };
export const dynamic = "force-dynamic";

export default function AdminStoragePage() {
  return (
    <div className="space-y-6">
      <header className="border-border border-b pb-5">
        <p className="text-primary text-xs font-semibold tracking-[0.08em] uppercase">
          Administration
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">
          Object storage
        </h2>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
          Browse and manage files held in the workspace storage bucket.
        </p>
      </header>
      <StoragePanel />
    </div>
  );
}
