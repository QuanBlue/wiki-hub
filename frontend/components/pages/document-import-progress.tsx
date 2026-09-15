"use client";

import {
  AlertTriangle,
  Check,
  Clock,
  FileText,
  Loader2,
  MinusCircle,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { JobProgress } from "@/components/ui/job-progress";
import { LogDisclosure } from "@/components/ui/log-disclosure";
import { api, ApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { DocumentImportItem, DocumentImportJob } from "@/types/api";

const TERMINAL: ReadonlySet<DocumentImportJob["status"]> = new Set([
  "complete",
  "failed",
  "cancelled",
]);

/** Matches the 1s cadence the Confluence import already polls at. */
const POLL_MS = 1000;

function pageHref(spaceKey: string, slug: string): string {
  return `/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(slug)}`;
}

function ItemIcon({ status }: { status: DocumentImportItem["status"] }) {
  if (status === "complete") return <Check className="text-success size-4 shrink-0" />;
  if (status === "failed")
    return <AlertTriangle className="text-danger size-4 shrink-0" />;
  if (status === "running")
    return <Loader2 className="text-info size-4 shrink-0 animate-spin" />;
  if (status === "cancelled")
    return <MinusCircle className="text-muted-foreground size-4 shrink-0" />;
  return <Clock className="text-muted-foreground size-4 shrink-0" />;
}

function ItemRow({
  item,
  spaceKey,
}: {
  item: DocumentImportItem;
  spaceKey: string;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex items-start gap-2 px-3 py-2">
      <ItemIcon status={item.status} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{item.filename}</p>
        {item.status === "complete" && item.page_slug ? (
          <Link
            href={pageHref(spaceKey, item.page_slug)}
            className="text-primary hover:underline focus-visible:underline"
          >
            {item.page_title ?? t("importProgress.openPage")}
          </Link>
        ) : null}
        {item.error ? <p className="text-danger">{item.error}</p> : null}
        {item.warnings.map((warning) => (
          <p key={warning} className="text-warning">
            {warning}
          </p>
        ))}
      </div>
    </li>
  );
}

/**
 * The live account of a running import, plus the summary once it finishes.
 *
 * Rendered inline above the page rather than as a modal: an import can take
 * minutes, and there is no reason to stop someone reading while it runs.
 */
export function DocumentImportProgress({
  job,
  spaceKey,
  onJobChange,
  onDismiss,
  onFinished,
}: {
  job: DocumentImportJob;
  spaceKey: string;
  onJobChange: (job: DocumentImportJob) => void;
  onDismiss: () => void;
  /** Called once, when the job reaches a terminal state - refresh the tree. */
  onFinished: (job: DocumentImportJob) => void;
}) {
  const [logExpanded, setLogExpanded] = useState(true);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  // Guards the completion handling: a second poll tick landing before the
  // effect tears down would otherwise re-open the dialog just dismissed.
  const settledRef = useRef<string | null>(null);
  const { t } = useTranslation();

  const finished = TERMINAL.has(job.status);

  useEffect(() => {
    if (TERMINAL.has(job.status)) return;
    const timer = window.setInterval(async () => {
      try {
        onJobChange(await api.get<DocumentImportJob>(`/api/v1/document-imports/${job.id}`));
      } catch {
        // Keep polling: the job is durable server-side, and a single failed
        // request is not a reason to stop showing progress.
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [job.id, job.status, onJobChange]);

  useEffect(() => {
    if (!TERMINAL.has(job.status)) return;
    if (settledRef.current === job.id) return;
    settledRef.current = job.id;

    const created = job.counters?.pages_created ?? 0;
    const failed = job.counters?.items_failed ?? 0;
    if (job.status === "cancelled") {
      toast(t("importProgress.cancelledToast", { count: created }));
    } else if (job.status === "failed") {
      toast.error(job.error ?? t("importProgress.failedToast"));
    } else if (failed > 0) {
      toast.warning(
        t("importProgress.partialToast", {
          created,
          total: created + failed,
          failed,
        }),
      );
    } else {
      toast.success(t("importProgress.completeToast", { count: created }));
    }
    setShowSummary(true);
    onFinished(job);
  }, [job, onFinished, t]);

  async function cancel() {
    setCancelling(true);
    try {
      onJobChange(
        await api.post<DocumentImportJob>(`/api/v1/document-imports/${job.id}/cancel`),
      );
      setConfirmingCancel(false);
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : t("importProgress.cancelError"),
      );
    } finally {
      setCancelling(false);
    }
  }

  const items = job.items ?? [];
  const counters = job.counters ?? {};
  const total = counters.items_total ?? items.length;
  const processed = counters.items_processed ?? 0;
  const percent = job.percent === undefined ? 0 : job.percent;
  const createdPages = items.filter(
    (item) => item.status === "complete" && item.page_slug,
  );
  const failedItems = items.filter((item) => item.status === "failed");

  return (
    <>
      <div>
        <JobProgress
          title={
            finished ? (
              <span className="inline-flex items-center gap-1.5">
                <FileText className="size-4" />
                {t("importProgress.statusTitle", { status: job.status })}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="size-4 animate-spin" />
                {t("importProgress.importingTitle", { count: total })}
              </span>
            )
          }
          percent={finished ? 100 : percent}
          etaSeconds={finished ? 0 : job.eta_seconds}
          detail={
            <>
              <span className="text-foreground font-medium">{t("importProgress.filesLabel")}</span> {processed} /{" "}
              {total}
            </>
          }
        />

        <LogDisclosure
          title={t("importProgress.filesHeading")}
          count={items.length}
          expanded={logExpanded}
          onExpandedChange={setLogExpanded}
        >
          {items.map((item) => (
            <ItemRow key={item.id} item={item} spaceKey={spaceKey} />
          ))}
        </LogDisclosure>

        <div className="mt-3 flex justify-end gap-2">
          {finished ? (
            <Button variant="secondary" size="sm" onClick={onDismiss}>
              {t("importProgress.dismiss")}
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmingCancel(true)}
              disabled={job.cancel_requested}
            >
              {job.cancel_requested
                ? t("importProgress.cancelling")
                : t("importProgress.cancelImport")}
            </Button>
          )}
        </div>
      </div>

      <Dialog open={confirmingCancel} onOpenChange={setConfirmingCancel}>
        <DialogContent
          title={t("importProgress.cancelTitle")}
          description={t("importProgress.cancelDescription")}
        >
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setConfirmingCancel(false)}
              disabled={cancelling}
            >
              {t("importProgress.keepImporting")}
            </Button>
            <Button variant="danger" onClick={cancel} disabled={cancelling}>
              {cancelling ? <Loader2 className="animate-spin" /> : null}
              {t("importProgress.cancelImport")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSummary} onOpenChange={setShowSummary}>
        <DialogContent
          title={
            job.status === "complete"
              ? t("importProgress.finishedTitle")
              : t("importProgress.statusTitle", { status: job.status })
          }
          description={
            createdPages.length > 0
              ? t("importProgress.summaryCreated", { count: createdPages.length })
              : t("importProgress.summaryNone")
          }
        >
          {createdPages.length > 0 ? (
            <div className="border-border bg-surface-sunken rounded-md border p-3 text-sm">
              <p className="text-foreground font-medium">{t("importProgress.newPages")}</p>
              <ul className="mt-1.5 space-y-1">
                {createdPages.map((item) => (
                  <li key={item.id}>
                    {/* Links rather than a redirect: with several pages there
                        is no defensible single destination, and taking someone
                        away from what they were reading is worse than a list. */}
                    <Link
                      href={pageHref(spaceKey, item.page_slug as string)}
                      className="text-primary hover:underline focus-visible:underline"
                      onClick={() => setShowSummary(false)}
                    >
                      {item.page_title ?? item.filename}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {failedItems.length > 0 ? (
            <div
              className={cn(
                "border-danger/25 bg-danger-bg mt-3 rounded-md border p-3 text-sm",
              )}
            >
              <p className="text-foreground font-medium">
                {t("importProgress.failedHeading", { count: failedItems.length })}
              </p>
              <ul className="text-muted-foreground mt-1.5 space-y-1">
                {failedItems.map((item) => (
                  <li key={item.id}>
                    <span className="text-foreground font-medium">{item.filename}</span>
                    {item.error ? ` — ${item.error}` : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="primary" onClick={() => setShowSummary(false)}>
              {t("importProgress.done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
