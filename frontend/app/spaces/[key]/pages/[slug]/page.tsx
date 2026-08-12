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
import { spaceTabTitle } from "@/lib/space-tab-title";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string; slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { key } = await params;
  try {
    const space = await getSpace(key);
    return { title: spaceTabTitle(space.name, key) };
  } catch {
    return { title: key.toUpperCase() };
  }
}

export default async function WikiPageView({ params }: Params) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { key, slug } = await params;

  let space;
  let pages;
  let members;
  const sidebarPreferences = await getSidebarPreferences();
  try {
    [space, pages, members] = await Promise.all([
      getSpace(key),
      listPages(key),
      listSpaceMembers(key),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  // The page tree already contains the canonical page records (including the
  // generated slug). Resolve the route from that same collection so a page
  // created moments ago cannot fall through to the global 404 while the
  // individual lookup is catching up. Slugs are case-insensitive in the API.
  const page = pages.find(
    (candidate) => candidate.slug.toLowerCase() === slug.toLowerCase(),
  );
  if (!page) notFound();

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
