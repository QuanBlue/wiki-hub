import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { RecentlyVisitedList } from "@/components/recent/recently-visited-list";
import { getCurrentUser } from "@/lib/auth";
import { SITE_NAME } from "@/lib/env";

export const metadata: Metadata = { title: "Recently visited" };
export const dynamic = "force-dynamic";

export default async function RecentlyVisitedPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AppShell siteName={SITE_NAME} user={user}>
      <div className="space-y-6">
        <PageHeader
          eyebrow="My work"
          title="Recently visited"
          description="Pages you've opened on this device recently, most recent first."
        />
        <RecentlyVisitedList />
      </div>
    </AppShell>
  );
}
