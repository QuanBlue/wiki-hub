import { notFound, redirect } from "next/navigation";

import { SpaceWorkspace } from "@/components/pages/space-workspace";
import { ApiError } from "@/lib/api-client";
import { getCurrentUser } from "@/lib/auth";
import { listPages } from "@/lib/pages";
import { findHomePage } from "@/lib/home-page";
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
  const groups = [];
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
    <SpaceWorkspace
      space={space}
      pages={pages}
      members={members}
      groups={groups}
      canManageRestrictions={
        user.is_superuser || space.my_permissions?.includes("restrictions") === true
      }
      canExport={space.my_permissions?.includes("export") === true}
      canEdit={
        user.is_superuser ||
        space.my_permissions?.includes("add") === true
      }
    />
  );
}
