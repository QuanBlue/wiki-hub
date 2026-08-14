import type { Metadata } from "next";

import { GroupManager } from "@/components/admin/group-manager";
import { listUsers } from "@/lib/admin";
import { listGroups } from "@/lib/groups";

export const metadata: Metadata = { title: "Groups" };
export const dynamic = "force-dynamic";

export default async function AdminGroupsPage() {
  const [groups, users] = await Promise.all([
    listGroups(),
    listUsers({ limit: 200 }),
  ]);

  return (
    <div className="space-y-5">
      <div><h2 className="text-lg font-semibold">Groups</h2><p className="text-muted-foreground mt-1 text-sm">Organize users and reuse access across documentation spaces.</p></div>
      <GroupManager initialGroups={groups} users={users.items} />
    </div>
  );
}
