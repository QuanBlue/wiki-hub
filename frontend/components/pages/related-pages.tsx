"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { pageHref } from "@/lib/page-mentions";
import type { PageRelated, RelatedVia } from "@/types/api";

const EMPTY: PageRelated = { pages: [], mentions: [] };

/**
 * The pages tied to a page in the knowledge graph, and the pages it names.
 * Loads once per page; a failure leaves the page as it is (nothing related shown).
 */
export function usePageRelated(spaceKey: string, pageSlug: string | null | undefined) {
  const [loaded, setLoaded] = useState<{ key: string; data: PageRelated } | null>(null);
  const key = pageSlug ? `${spaceKey}/${pageSlug}` : "";

  useEffect(() => {
    if (!pageSlug) return;
    let active = true;
    api
      .get<PageRelated>(
        `/api/v1/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(pageSlug)}/related`,
      )
      .then((data) => {
        if (active) setLoaded({ key, data });
      })
      .catch(() => {
        if (active) setLoaded({ key, data: EMPTY });
      });
    return () => {
      active = false;
    };
  }, [spaceKey, pageSlug, key]);

  // Data read for another page is never shown for this one.
  return loaded?.key === key ? loaded.data : null;
}

/**
 * Below a page's body: the pages tied to it, grouped by their strongest tie, each a
 * compact chip (its other ties in the tooltip). Nothing when there are none.
 */
export function RelatedPages({
  related,
  spaceKey,
}: {
  related: PageRelated | null;
  spaceKey: string;
}) {
  const { t } = useTranslation();
  if (!related?.pages.length) return null;
  // Groups keep the graph's order: the first page of each tie decides where it sits.
  const groups = new Map<RelatedVia, PageRelated["pages"]>();
  for (const page of related.pages) {
    const via = page.via[0] ?? "similar";
    groups.set(via, [...(groups.get(via) ?? []), page]);
  }
  return (
    <section aria-labelledby="related-pages-heading" className="mt-10">
      {/* The same labelled rule as Comments below, so the two read as one footer. */}
      <div className="mb-3 flex items-center gap-3">
        <h2
          id="related-pages-heading"
          className="text-muted-foreground shrink-0 text-xs font-semibold tracking-wider uppercase"
        >
          {t("graph.relatedTitle")}
        </h2>
        <span className="bg-border h-px flex-1" aria-hidden />
      </div>
      <dl className="space-y-2">
        {[...groups].map(([via, pages]) => (
          <div key={via} className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
            <dt className="text-muted-foreground shrink-0 text-xs sm:w-40">
              {t(`graph.via_${via}`)}
            </dt>
            <dd className="flex min-w-0 flex-wrap gap-1.5">
              {pages.map((page) => {
                const elsewhere = page.space_key !== spaceKey;
                return (
                  <Link
                    key={page.id}
                    href={pageHref(page.space_key, page.slug)}
                    title={[
                      ...page.via.map((v) => t(`graph.via_${v}`)),
                      ...(elsewhere ? [t("graph.inSpace", { space: page.space_name })] : []),
                    ].join(" · ")}
                    className="border-border text-primary hover:bg-surface-hover hover:border-border-strong active:bg-surface-selected focus-visible:ring-ring inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-0.5 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <FileText className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{page.title}</span>
                    {elsewhere ? (
                      <span className="text-muted-foreground shrink-0 text-xs">
                        · {page.space_name}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
