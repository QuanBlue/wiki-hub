"use client";

import { FileText, Folder, FolderOpen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { findHomePage } from "@/lib/home-page";
import { useTranslation } from "@/lib/i18n/context";
import type { WikiPage } from "@/types/api";
import { pageHref } from "./content-transforms";
import { TREE_EXPAND_PREFIX } from "./types";
import { SidebarLink } from "./workspace-primitives";

export function PageTree({
  pages,
  spaceKey,
  activeSlug,
}: {
  pages: WikiPage[];
  spaceKey: string;
  activeSlug: string | null;
}) {
  const storageKey = `${TREE_EXPAND_PREFIX}${spaceKey}`;
  const { t } = useTranslation();
  const homePageId = findHomePage(pages, spaceKey)?.id;
  const pagesByParent = useMemo(() => {
    const pageIds = new Set(pages.map((page) => page.id));
    const grouped = new Map<string | null, WikiPage[]>();
    for (const page of pages) {
      if (page.id === homePageId) continue;
      const parentId =
        page.parent_id && pageIds.has(page.parent_id)
          ? page.parent_id === homePageId
            ? null
            : page.parent_id
          : null;
      const siblings = grouped.get(parentId) ?? [];
      siblings.push(page);
      grouped.set(parentId, siblings);
    }
    return grouped;
  }, [homePageId, pages]);
  const [expandedPageIds, setExpandedPageIds] = useState<Set<string>>(() => {
    const activePage = pages.find((p) => p.slug === activeSlug);
    const pageById = new Map(pages.map((p) => [p.id, p]));
    const ancestorIds = new Set<string>();
    let parentId = activePage?.parent_id;
    while (parentId && !ancestorIds.has(parentId)) {
      ancestorIds.add(parentId);
      parentId = pageById.get(parentId)?.parent_id;
    }
    // Merge in whatever was already expanded before this mount, read
    // synchronously here rather than restored in a later effect. Page
    // routes remount this whole tree on every navigation (see the comment
    // on SpaceWorkspace's own sidebar-scroll-restore effect), and restoring
    // this asynchronously used to mean the tree grew *after* the parent
    // sidebar had already measured its height and restored a scroll
    // position against it - visibly shifting the scroll the user had just
    // set up on every single page click. `window` is undefined during SSR,
    // so this still only ever runs client-side; a true first-ever page load
    // (real hydration, not a later soft navigation) has no prior session to
    // restore from anyway, so there is nothing here for it to mismatch.
    if (typeof window !== "undefined") {
      try {
        const saved = window.sessionStorage.getItem(storageKey);
        const ids: unknown = saved ? JSON.parse(saved) : null;
        if (Array.isArray(ids)) {
          for (const id of ids as string[]) ancestorIds.add(id);
        }
      } catch {
        // Ignore storage errors.
      }
    }
    return ancestorIds;
  });

  // Persist expansion state whenever it changes.
  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        storageKey,
        JSON.stringify([...expandedPageIds]),
      );
    } catch {
      // Ignore storage errors.
    }
  }, [expandedPageIds, storageKey]);

  // Defensive only: the initializer above already covers the normal case
  // (a fresh mount per navigation). This keeps the active page's ancestors
  // expanded if `pages`/`activeSlug` ever change on an *already-mounted*
  // instance instead.
  useEffect(() => {
    const activePage = pages.find((page) => page.slug === activeSlug);
    const pageById = new Map(pages.map((page) => [page.id, page]));
    const idsToExpand = new Set<string>();
    let parentId = activePage?.parent_id;

    while (parentId && !idsToExpand.has(parentId)) {
      idsToExpand.add(parentId);
      parentId = pageById.get(parentId)?.parent_id;
    }

    // Also expand the active page itself if it has children so they are
    // immediately visible when the user navigates to a parent page.
    if (activePage && (pagesByParent.get(activePage.id)?.length ?? 0) > 0) {
      idsToExpand.add(activePage.id);
    }

    if (idsToExpand.size === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- expand ancestors discovered from the loaded page tree
    setExpandedPageIds((current) => {
      const next = new Set(current);
      for (const pageId of idsToExpand) next.add(pageId);
      return next;
    });
  }, [activeSlug, pages, pagesByParent]);

  function togglePage(pageId: string) {
    setExpandedPageIds((current) => {
      const next = new Set(current);
      if (next.has(pageId)) {
        next.delete(pageId);
      } else {
        next.add(pageId);
      }
      return next;
    });
  }

  function renderPages(parentId: string | null): React.ReactNode {
    return (pagesByParent.get(parentId) ?? []).map((page) => {
      const children = pagesByParent.get(page.id) ?? [];
      const hasChildren = children.length > 0;
      const expanded = expandedPageIds.has(page.id);
      const active = activeSlug === page.slug;
      return (
        <li key={page.id}>
          {/* The icon lives inside the link so the active/hover highlight (and
              the seasonal rail styling, which targets the link) covers it and
              it inherits the link's colour. The toggle button is an invisible
              keyboard-focusable overlay; pointer clicks on the icon area are
              routed to it from the link. */}
          <div className="relative flex min-h-8 items-stretch">
            <SidebarLink
              href={pageHref(spaceKey, page.slug)}
              active={active}
              className="min-w-0 flex-1 gap-0 rounded-md px-0 pr-2"
              onClick={(event) => {
                if (
                  hasChildren &&
                  (event.target as HTMLElement).closest("[data-tree-icon]")
                ) {
                  event.preventDefault();
                  togglePage(page.id);
                }
              }}
            >
              <span
                data-tree-icon=""
                className="flex w-8 shrink-0 items-center justify-center self-stretch"
                aria-hidden
              >
                {hasChildren ? (
                  expanded ? (
                    <FolderOpen className="size-4" />
                  ) : (
                    <Folder className="size-4" />
                  )
                ) : (
                  <FileText className="size-4" />
                )}
              </span>
              <span className="truncate">{page.title}</span>
            </SidebarLink>
            {hasChildren ? (
              <button
                type="button"
                onClick={() => togglePage(page.id)}
                aria-expanded={expanded}
                aria-label={t(
                  expanded
                    ? "workspace.collapseFolderAria"
                    : "workspace.expandFolderAria",
                  { title: page.title },
                )}
                className="focus-visible:ring-ring pointer-events-none absolute inset-y-0 left-0 w-8 rounded-md focus-visible:ring-2 focus-visible:outline-none"
              />
            ) : null}
          </div>
          {hasChildren && expanded ? (
            <ul className="space-y-0.5 pl-4">{renderPages(page.id)}</ul>
          ) : null}
        </li>
      );
    });
  }

  return <>{renderPages(null)}</>;
}
