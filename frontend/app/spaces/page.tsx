import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { CreateSpaceForm } from "@/components/spaces/create-space-form";
import { SpacesExplorer } from "@/components/spaces/spaces-explorer";
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
    <AppShell fullWidth siteName={SITE_NAME} user={user}>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Knowledge library"
          title="Spaces"
          description="Spaces are the shared homes for your teams, projects, and documentation."
          actions={<CreateSpaceForm />}
        />

        <Suspense fallback={null}>
          <SpacesExplorer spaces={spaces} />
        </Suspense>
      </div>
    </AppShell>
  );
}
