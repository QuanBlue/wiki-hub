"use client";

import { ExternalLink, History, Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  LineDiff,
  revisionHtml,
  useLineDiff,
} from "@/components/pages/line-diff";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/context";
import { listPageRevisions } from "@/lib/revisions";
import { cn } from "@/lib/utils";
import type { PageRevisionItem } from "@/types/api";

// The reader is heavy: only loaded for a page's first version, shown as it is.
const PageReader = dynamic(
  () =>
    import("@/components/pages/rich-text-editor").then((mod) => {
      function Reader({ content }: { content: string }) {
        return (
          <div className={cn("text-foreground", mod.readerClassName)}>
            <mod.RichTextContent content={content} />
          </div>
        );
      }
      return Reader;
    }),
  { ssr: false },
);

/**
 * The version a change made: the one saved closest to when the change happened (``at``),
 * and the version just before it (none when that change created the page).
 */
export function changeVersions(
  revisions: PageRevisionItem[],
  at: string,
): { after: PageRevisionItem; before: PageRevisionItem | null } | null {
  if (revisions.length === 0) return null;
  // Newest first, as the API lists them; sorted again so the pick does not depend on it.
  const ordered = [...revisions].sort((a, b) => b.version - a.version);
  const when = new Date(at).getTime();
  let index = 0;
  let best = Number.POSITIVE_INFINITY;
  ordered.forEach((revision, i) => {
    const gap = Math.abs(new Date(revision.created_at).getTime() - when);
    if (gap < best) {
      best = gap;
      index = i;
    }
  });
  return { after: ordered[index], before: ordered[index + 1] ?? null };
}

/** One revision as a heading: its version, title, author and when. */
function VersionHeading({ revision }: { revision: PageRevisionItem }) {
  const { locale } = useTranslation();
  return (
    <span className="text-muted-foreground">
      <strong className="text-foreground font-semibold">
        v{revision.version}: {revision.title}
      </strong>
      {" · "}
      {revision.created_by_full_name ||
        revision.created_by_username ||
        "System"}
      {" · "}
      {formatDateTime(revision.created_at, locale)}
    </span>
  );
}

/**
 * What one change on the home page's activity did: that version against the one before it,
 * line by line - not the page's whole history. The full history is a click away.
 */
export function PageChangeDialog({
  open,
  onOpenChange,
  spaceKey,
  slug,
  pageTitle,
  at,
  onOpenHistory,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceKey: string;
  slug: string;
  pageTitle: string;
  /** When the change happened, to find the version it saved. */
  at: string;
  /** Leaves this view for the page's full history. */
  onOpenHistory?: () => void;
}) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<{
    key: string;
    revisions: PageRevisionItem[] | null;
  } | null>(null);
  const key = `${spaceKey}/${slug}@${at}`;

  useEffect(() => {
    if (!open) return;
    let live = true;
    listPageRevisions(spaceKey, slug)
      .then((revisions) => live && setLoaded({ key, revisions }))
      .catch(() => live && setLoaded({ key, revisions: null }));
    return () => {
      live = false;
    };
  }, [open, spaceKey, slug, key]);

  const current = loaded?.key === key ? loaded : null;
  const versions = current?.revisions
    ? changeVersions(current.revisions, at)
    : null;
  const diff = useLineDiff(
    versions ? (versions.before ? revisionHtml(versions.before) : "") : null,
    versions ? revisionHtml(versions.after) : null,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(85vh,52rem)] max-w-[min(100vw-2rem,80rem)] flex-col"
        title={pageTitle}
        description={
          versions
            ? versions.before
              ? t("pageChange.description", {
                  from: versions.before.version,
                  to: versions.after.version,
                })
              : t("pageChange.createdDescription")
            : t("pageChange.loadingDescription")
        }
      >
        {current === null ? (
          <p className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm">
            <Loader2 className="text-primary size-5 animate-spin" aria-hidden />
            {t("pageChange.loading")}
          </p>
        ) : !versions || !diff ? (
          <p
            className="text-danger bg-danger-bg rounded-md px-3 py-2 text-sm"
            role="alert"
          >
            {t("pageChange.error")}
          </p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {versions.before === null ? (
              // The first version: nothing before it to compare, so the page as it is.
              <div className="border-border bg-surface flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
                <div className="border-border border-b px-3 py-2 text-sm">
                  <VersionHeading revision={versions.after} />
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-4">
                  {versions.after.content_format === "html" ? (
                    <PageReader content={versions.after.content} />
                  ) : (
                    <div className="text-sm whitespace-pre-wrap">
                      {versions.after.content}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <LineDiff
                diff={diff}
                counts={[
                  diff.onlyOld === 1
                    ? t("history.removalsOne", { count: diff.onlyOld })
                    : t("history.removalsMany", { count: diff.onlyOld }),
                  diff.onlyNew === 1
                    ? t("history.additionsOne", { count: diff.onlyNew })
                    : t("history.additionsMany", { count: diff.onlyNew }),
                ]}
                headings={[
                  <VersionHeading key="before" revision={versions.before} />,
                  <VersionHeading key="after" revision={versions.after} />,
                ]}
              />
            )}
            <div className="flex flex-wrap justify-end gap-2">
              {onOpenHistory ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onOpenHistory}
                >
                  <History />
                  {t("pageChange.fullHistory")}
                </Button>
              ) : null}
              <Button asChild variant="primary">
                <Link
                  href={`/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(slug)}`}
                >
                  <ExternalLink />
                  {t("pageChange.openPage")}
                </Link>
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
