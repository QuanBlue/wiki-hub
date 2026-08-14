import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { RecentActivityFeed } from "@/components/recent/recent-activity-feed";
import { getCurrentUser } from "@/lib/auth";
import { SITE_NAME } from "@/lib/env";
import { listRecentPages } from "@/lib/pages";
import { listRecentSpaces } from "@/lib/spaces";

export const metadata: Metadata = { title: "Recent Updates" };
export const dynamic = "force-dynamic";

export default async function RecentPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [activities, spaces] = await Promise.all([
    listRecentPages(50),
    listRecentSpaces(),
  ]);

  return (
    <AppShell fullWidth siteName={SITE_NAME} user={user}>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Activity stream"
          title="Recent updates"
          description="Track recent page creations, updates, and contributions across your team."
        />

        <RecentActivityFeed activities={activities} recentSpaces={spaces} />
      </div>
    </AppShell>
  );
}
