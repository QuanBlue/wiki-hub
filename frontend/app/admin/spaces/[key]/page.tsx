import type { Metadata } from "next";

import { SpaceAccessPanel } from "@/components/admin/space-access-panel";
import { getServerLocale } from "@/lib/i18n/server";
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
  const [space, groups, users, assignments, { t }] = await Promise.all([
    getSpace(key),
    listSpacePermissionGroups(key),
    listSpacePermissionUsers(key),
    listSpacePermissions(key),
    getServerLocale(),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">{t("adminSpaces.accessTitle", { name: space.name })}</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("adminSpaces.accessDescription")}
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
