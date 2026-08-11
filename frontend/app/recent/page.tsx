import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SpaceList } from "@/components/spaces/space-list";
import { getCurrentUser } from "@/lib/auth";
import { SITE_NAME } from "@/lib/env";
import { listRecentSpaces } from "@/lib/spaces";

export const metadata: Metadata = { title: "Recent" };
export const dynamic = "force-dynamic";

export default async function RecentPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const spaces = await listRecentSpaces();

  return (
    <AppShell siteName={SITE_NAME} user={user}>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Keep moving"
          title="Recent"
          description="Return to the spaces your team has updated most recently."
        />

        <SpaceList
          spaces={spaces}
          emptyTitle="Nothing recent"
          emptyHint="Spaces you create or update will show up here."
        />
      </div>
    </AppShell>
  );
}
