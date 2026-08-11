import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { CreateSpaceForm } from "@/components/spaces/create-space-form";
import { SpaceList } from "@/components/spaces/space-list";
import { getCurrentUser } from "@/lib/auth";
import { SITE_NAME } from "@/lib/env";
import { listSpaces } from "@/lib/spaces";

export const metadata: Metadata = { title: "Spaces" };
export const dynamic = "force-dynamic";

export default async function SpacesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const spaces = await listSpaces();

  return (
    <AppShell siteName={SITE_NAME} user={user}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Spaces</h1>
            <p className="text-muted-foreground mt-1.5">
              A space is a top-level area of documentation, owned by a team.
            </p>
          </div>
          <CreateSpaceForm />
        </div>

        <SpaceList
          spaces={spaces}
          emptyTitle="No spaces yet"
          emptyHint="Create your first space to start organising documentation."
        />
      </div>
    </AppShell>
  );
}
