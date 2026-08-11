import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { SpaceWorkspace } from "@/components/pages/space-workspace";
import { ApiError } from "@/lib/api-client";
import { getCurrentUser } from "@/lib/auth";
import { SITE_NAME } from "@/lib/env";
import { listPages } from "@/lib/pages";
import { getSidebarPreferences } from "@/lib/sidebar-preferences";
import { getSpace, listSpaceMembers } from "@/lib/spaces";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { key } = await params;
  return { title: key.toUpperCase() };
}

export default async function SpaceDetailPage({ params }: Params) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { key } = await params;

  let space;
  let members;
  let pages;
  const sidebarPreferences = await getSidebarPreferences();
  try {
    [space, members, pages] = await Promise.all([
      getSpace(key),
      listSpaceMembers(key),
      listPages(key),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return (
    <AppShell
      siteName={SITE_NAME}
      user={user}
      hideSidebar
      contentClassName="max-w-none px-0 py-0 sm:px-0 sm:py-0"
    >
      <SpaceWorkspace
        space={space}
        pages={pages}
        members={members}
        initialSidebarWidth={sidebarPreferences.spaceWidth}
        canEdit={
          user.is_superuser ||
          space.my_role === "admin" ||
          space.my_role === "editor"
        }
      />
    </AppShell>
  );
}
