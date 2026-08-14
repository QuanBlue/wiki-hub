import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { CreateSpaceForm } from "@/components/spaces/create-space-form";
import { SpacesExplorer } from "@/components/spaces/spaces-explorer";
import { ApiError } from "@/lib/api-client";
import { getCurrentUser } from "@/lib/auth";
import { SITE_NAME } from "@/lib/env";
import { listSpaces } from "@/lib/spaces";
import type { Space } from "@/types/api";

export const metadata: Metadata = { title: "Spaces" };
export const dynamic = "force-dynamic";

export default async function SpacesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  let spaces: Space[] = [];
  let spacesError: string | null = null;

  try {
    spaces = await listSpaces();
  } catch (error) {
    spacesError =
      error instanceof ApiError && error.status >= 500
        ? "The space service is temporarily unavailable. Please try again shortly."
        : error instanceof ApiError
          ? error.message
          : "Could not load spaces. Please try again shortly.";
    console.error("Failed to load spaces", error);
  }

  return (
    <AppShell fullWidth siteName={SITE_NAME} user={user}>
      <div className="space-y-6">
        <PageHeader
          className="pb-2"
          title="Spaces"
          description="Spaces are the shared homes for your teams, projects, and documentation."
          actions={<CreateSpaceForm />}
        />

        {spacesError ? (
          <div
            role="alert"
            className="border-danger/30 bg-danger/10 text-danger rounded-lg border px-4 py-3 text-sm"
          >
            {spacesError}
          </div>
        ) : null}

        <Suspense fallback={null}>
          <SpacesExplorer spaces={spaces} />
        </Suspense>
      </div>
    </AppShell>
  );
}
