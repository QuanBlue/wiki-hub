import type { Metadata } from "next";

import { GroupManager } from "@/components/admin/group-manager";
import { listAllUsers } from "@/lib/admin";
import { listGroups } from "@/lib/groups";

export const metadata: Metadata = { title: "Groups" };
export const dynamic = "force-dynamic";

export default async function AdminGroupsPage() {
  const [groups, users] = await Promise.all([
    listGroups(),
    listAllUsers(),
  ]);

  return (
    <div className="space-y-6">
      <header className="border-border border-b pb-5">
        <p className="text-primary text-xs font-semibold tracking-[0.08em] uppercase">Administration</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">Groups</h2>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">Organize people into reusable teams for workspace and space access.</p>
      </header>
      <GroupManager initialGroups={groups} users={users} />
    </div>
  );
}
