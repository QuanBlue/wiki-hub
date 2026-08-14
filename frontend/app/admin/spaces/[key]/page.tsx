import type { Metadata } from "next";

import { SpaceAccessPanel } from "@/components/admin/space-access-panel";
import {
  getSpace,
  listSpacePermissionGroups,
  listSpacePermissionUsers,
  listSpacePermissions,
} from "@/lib/spaces";

export const metadata: Metadata = { title: "Space access" };
export const dynamic = "force-dynamic";

export default async function AdminSpaceAccessPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const [space, groups, users, assignments] = await Promise.all([
    getSpace(key),
    listSpacePermissionGroups(key),
    listSpacePermissionUsers(key),
    listSpacePermissions(key),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Access - {space.name}</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage visibility and additive user/group permissions for this Space.
        </p>
      </div>
      <SpaceAccessPanel
        space={space}
        groups={groups}
        users={users}
        initialAssignments={assignments}
      />
    </div>
  );
}
