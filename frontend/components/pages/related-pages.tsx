"use client";

import { FileText, Lightbulb } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
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
 * The pages tied to a page, grouped by their strongest tie, each a compact chip
 * (its other ties in the tooltip). Opened on demand from the page's ... menu
 * rather than sitting under the text, so it does not crowd what people came to read.
 */
export function RelatedPagesDialog({
  related,
  spaceKey,
  open,
  onOpenChange,
}: {
  related: PageRelated | null;
  spaceKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A fixed height, so the panel does not jump about between pages with
          one related page and pages with many; the list scrolls inside it. */}
      <DialogContent
        title={t("graph.relatedTitle")}
        className="flex h-[28rem] max-w-xl flex-col overflow-hidden"
      >
        <dl className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {[...groups].map(([via, pages]) => (
            <div key={via} className="space-y-1.5">
              <dt className="text-muted-foreground text-xs font-medium">
                {t(`graph.via_${via}`)}
              </dt>
              <dd className="flex min-w-0 flex-wrap gap-1.5">
                {pages.map((page) => {
                  const elsewhere = page.space_key !== spaceKey;
                  return (
                    <Link
                      key={page.id}
                      href={pageHref(page.space_key, page.slug)}
                      onClick={() => onOpenChange(false)}
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
        <div className="border-border mt-3 shrink-0 space-y-2.5 border-t pt-3">
          <p className="text-muted-foreground text-xs leading-relaxed">
            {t("graph.relatedNote")}
          </p>
          <div className="border-primary/25 bg-primary-subtle flex items-start gap-2.5 rounded-lg border px-3 py-2.5">
            <Lightbulb className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="text-foreground text-sm leading-snug">
              <strong className="text-primary font-semibold">{t("graph.relatedTipLabel")}: </strong>
              {t("graph.relatedTip")}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
