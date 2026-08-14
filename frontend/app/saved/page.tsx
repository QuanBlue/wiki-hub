import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SavedPagesList } from "@/components/recent/saved-pages-list";
import { getCurrentUser } from "@/lib/auth";
import { SITE_NAME } from "@/lib/env";

export const metadata: Metadata = { title: "Saved for later" };
export const dynamic = "force-dynamic";

export default async function SavedPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AppShell siteName={SITE_NAME} user={user}>
      <div className="space-y-6">
        <PageHeader
          eyebrow="My work"
          title="Saved for later"
          description="Pages you've marked to come back to."
        />
        <SavedPagesList />
      </div>
    </AppShell>
  );
}
