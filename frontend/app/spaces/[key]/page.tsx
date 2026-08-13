import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ApiError } from "@/lib/api-client";
import { getCurrentUser } from "@/lib/auth";
import { listPages } from "@/lib/pages";
import { getSpace } from "@/lib/spaces";
import { spaceTabTitle } from "@/lib/space-tab-title";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { key } = await params;
  try {
    const space = await getSpace(key);
    return { title: spaceTabTitle(space.name, key) };
  } catch {
    return { title: key.toUpperCase() };
  }
}

export default async function SpaceDetailPage({ params }: Params) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { key } = await params;

  let pages;
  try {
    await getSpace(key);
    pages = await listPages(key);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  // Find the root page (no parent_id) to use as the space home page.
  // Fall back to the first page alphabetically if no root page exists.
  const rootPage =
    pages.find((p) => p.parent_id === null || p.parent_id === undefined) ??
    pages[0];

  if (rootPage) {
    redirect(
      `/spaces/${encodeURIComponent(key)}/pages/${encodeURIComponent(rootPage.slug)}`,
    );
  }

  // Space has no pages yet — show a redirect back to itself so the user can
  // create one.  This branch is very rare but ensures the page never crashes.
  notFound();
}
