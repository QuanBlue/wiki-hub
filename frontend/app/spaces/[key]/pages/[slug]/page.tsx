import { notFound, redirect } from "next/navigation";

import { RecordVisit } from "@/components/pages/record-visit";
import { SpaceWorkspace } from "@/components/pages/space-workspace";
import { ApiError } from "@/lib/api-client";
import { getCurrentUser } from "@/lib/auth";
import { findPageByRouteSlug, getPage, listPages } from "@/lib/pages";
import { getSpace, listSpaceMembers } from "@/lib/spaces";
import type { Group, SpaceMember } from "@/types/api";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string; slug: string }> };

export default async function WikiPageView({ params }: Params) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { key, slug } = await params;

  let space;
  let pages;
  let members: SpaceMember[] = [];
  let page;
  const groups: Group[] = [];
  try {
    [space, pages] = await Promise.all([getSpace(key), listPages(key)]);
  } catch (error) {
    // A 403 here means the space exists but this user has no View permission
    // (e.g. it was switched to Restricted and never granted to them). Treat
    // it the same as a 404 rather than surfacing the generic error boundary:
    // the visitor shouldn't be able to tell "forbidden" from "doesn't exist".
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      notFound();
    }
    throw error;
  }

  try {
    members = await listSpaceMembers(key);
  } catch (error) {
    // Membership is supporting metadata. Older API instances may not expose
    // this endpoint yet, but that must never turn an otherwise valid page into
    // a 404 route.
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
  }

  try {
    page = await getPage(key, slug);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;

    // A per-page restriction can deny View on a page the user can otherwise
    // see the space of. Same rule as the space-level check above: don't
    // distinguish "forbidden" from "doesn't exist" for the visitor.
    if (error.status === 403) notFound();
    if (error.status !== 404) throw error;

    // The navigation tree already came from this space and is a valid source
    // of page data. Prefer it over showing a false 404 when imported or
    // legacy slugs differ only in encoding/case at the detail endpoint.
    const listedPage = findPageByRouteSlug(pages, slug);
    if (!listedPage) notFound();
    page = listedPage;
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
          user.is_superuser ||
          space.my_permissions?.includes("restrictions") === true
        }
      />
    </>
  );
}
