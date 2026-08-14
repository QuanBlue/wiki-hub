import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { RecentActivityFeed } from "@/components/recent/recent-activity-feed";
import { getCurrentUser } from "@/lib/auth";
import { SITE_NAME } from "@/lib/env";
import { listRecentPages } from "@/lib/pages";
import { listFavoriteSpaces } from "@/lib/spaces";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [activities, spaces] = await Promise.all([
    listRecentPages(50),
    listFavoriteSpaces(),
  ]);

  return (
    <AppShell fullWidth siteName={SITE_NAME} user={user}>
      <div className="xl:h-[calc(100dvh-var(--wh-topbar-height)-5rem)] xl:overflow-hidden">
        <RecentActivityFeed activities={activities} spaces={spaces} user={user} />
      </div>
    </AppShell>
  );
}
