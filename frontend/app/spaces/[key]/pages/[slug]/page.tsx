import { notFound, redirect } from "next/navigation";

import { RecordVisit } from "@/components/pages/record-visit";
import { SpaceWorkspace } from "@/components/pages/space-workspace";
import { ApiError } from "@/lib/api-client";
import { getCurrentUser } from "@/lib/auth";
import { getPage, listPages } from "@/lib/pages";
import { getSpace, listSpaceMembers } from "@/lib/spaces";
import type { Group } from "@/types/api";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string; slug: string }> };

export default async function WikiPageView({ params }: Params) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { key, slug } = await params;

  let space;
  let pages;
  let members;
  let page;
  const groups: Group[] = [];
  try {
    [space, pages, members, page] = await Promise.all([
      getSpace(key),
      listPages(key),
      listSpaceMembers(key),
      getPage(key, slug),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  // Fetch the selected page directly as the source of truth. The list endpoint
  // can briefly lag after creation, while the slug endpoint already knows the
  // newly-created record. Add it to the tree until the list catches up.
  if (!pages.some((candidate) => candidate.id === page.id)) {
    pages = [...pages, page];
  }

  return (
    <>
      <RecordVisit
        spaceKey={space.key}
        spaceName={space.name}
        slug={page.slug}
        title={page.title}
      />
      <SpaceWorkspace
        space={space}
        pages={pages}
        members={members}
        groups={groups}
        currentPage={page}
        canEdit={page.can_edit === true}
        canExport={page.can_export === true}
        canManageRestrictions={
          user.is_superuser || space.my_permissions?.includes("restrictions") === true
        }
      />
    </>
  );
}
