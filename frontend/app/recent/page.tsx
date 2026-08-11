import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
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
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Recent</h1>
          <p className="text-muted-foreground mt-1.5">
            Most recently updated spaces. Once pages land, this will track the
            pages you have opened and edited.
          </p>
        </div>

        <SpaceList
          spaces={spaces}
          emptyTitle="Nothing recent"
          emptyHint="Spaces you create or update will show up here."
        />
      </div>
    </AppShell>
  );
}
