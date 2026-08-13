import type { WikiPage } from "@/types/api";

/** Resolve the space home page across both new and legacy imports. */
export function findHomePage(
  pages: WikiPage[],
  spaceKey: string,
  spaceName?: string,
): WikiPage | undefined {
  const normalizedKey = spaceKey.trim().toLowerCase();
  const normalizedName = spaceName?.trim().toLowerCase();
  const bySlug = pages.find(
    (page) => page.slug.trim().toLowerCase() === normalizedKey,
  );
  if (bySlug) return bySlug;

  const byTitle = pages.find((page) => {
    const title = page.title.trim().toLowerCase();
    return title === normalizedKey || title === normalizedName;
  });
  if (byTitle) return byTitle;

  const pageIds = new Set(pages.map((page) => page.id));
  const roots = pages.filter(
    (page) => !page.parent_id || !pageIds.has(page.parent_id),
  );
  if (roots.length === 0) return pages[0];

  return roots.reduce((best, candidate) => {
    const bestChildren = pages.filter((page) => page.parent_id === best.id).length;
    const candidateChildren = pages.filter(
      (page) => page.parent_id === candidate.id,
    ).length;
    return candidateChildren > bestChildren ? candidate : best;
  });
}
