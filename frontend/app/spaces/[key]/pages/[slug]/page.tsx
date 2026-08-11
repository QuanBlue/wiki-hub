import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { SpaceWorkspace } from "@/components/pages/space-workspace";
import { ApiError } from "@/lib/api-client";
import { getCurrentUser } from "@/lib/auth";
import { SITE_NAME } from "@/lib/env";
import { getPage, listPages } from "@/lib/pages";
import { getSidebarPreferences } from "@/lib/sidebar-preferences";
import { getSpace, listSpaceMembers } from "@/lib/spaces";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string; slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug };
}

export default async function WikiPageView({ params }: Params) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { key, slug } = await params;

  let space;
  let page;
  let pages;
  let members;
  const sidebarPreferences = await getSidebarPreferences();
  try {
    [space, page, pages, members] = await Promise.all([
      getSpace(key),
      getPage(key, slug),
      listPages(key),
      listSpaceMembers(key),
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
        currentPage={page}
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
