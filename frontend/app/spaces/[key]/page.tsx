import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { SpaceWorkspace } from "@/components/pages/space-workspace";
import { ApiError } from "@/lib/api-client";
import { SITE_NAME } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth";
import { listPages } from "@/lib/pages";
import { findHomePage } from "@/lib/home-page";
import { getSidebarPreferences } from "@/lib/sidebar-preferences";
import { getSpace, listSpaceMembers } from "@/lib/spaces";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string }> };

export default async function SpaceDetailPage({ params }: Params) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { key } = await params;

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

  // A space home uses the stable slug derived from the space key (for example
  // QUAN -> /pages/quan). Only fall back to a root page for older spaces that
  // were created before the explicit home-page convention.
  const rootPage = findHomePage(pages, key, space.name);

  if (rootPage) {
    redirect(
      `/spaces/${encodeURIComponent(key)}/pages/${encodeURIComponent(rootPage.slug)}`,
    );
  }

  // Space has no pages yet — show a redirect back to itself so the user can
  // create one.  This branch is very rare but ensures the page never crashes.
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
