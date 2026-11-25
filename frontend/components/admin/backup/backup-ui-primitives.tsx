"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  Clock,
  Download,
  Loader2,
  XCircle,
} from "lucide-react";
import type { ReactNode, Ref } from "react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { formatBytes, formatDuration } from "@/components/ui/job-progress";
import { LogDisclosure } from "@/components/ui/log-disclosure";
import { cn } from "@/lib/utils";
import type {
  AutomatedBackupStatus,
  AutomatedJobsSort,
  AutomatedJobsSortKey,
  JobLogEntry,
  PortableBackupJob,
} from "./types";

/**
 * "X completed successfully - here is what happened - do another?" dialog,
 * shared by both import flows.
 *
 * They had drifted into two different answers to the same moment: the restore
 * listed what it had written, the Confluence import listed nothing at all, so
 * finishing the same task told you different things depending on which card
 * you had used. Sharing the component is what keeps that from happening again
 * - the two callers now differ only in their wording and their numbers.
 */
export function ImportCompletedDialog({
  open,
  onOpenChange,
  title,
  description,
  summaryLabel,
  counts,
  emptyLabel,
  notice,
  question,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  summaryLabel: string;
  /** Singular nouns keyed by kind; pluralised here. `null` hides the panel. */
  counts: Record<string, number> | null;
  emptyLabel: string;
  /** Anything the run left unresolved, between the summary and the question.
   *  The restore flow puts its "these spaces were skipped" offer here so the
   *  choice is presented rather than sprung as its own modal. */
  notice?: ReactNode;
  question: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  const entries = counts
    ? Object.entries(counts).filter(([, count]) => count > 0)
    : [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        {counts ? (
          <div className="border-border bg-surface-sunken rounded-md border p-3 text-xs">
            <p className="text-foreground font-medium">{summaryLabel}</p>
            <ul className="text-muted-foreground mt-1.5 space-y-0.5">
              {entries.map(([kind, count]) => (
                <li key={kind}>
                  {count} {kind.replaceAll("_", " ")}
                  {count === 1 ? "" : "s"}
                </li>
              ))}
              {entries.length === 0 ? <li>{emptyLabel}</li> : null}
            </ul>
          </div>
        ) : null}
        {notice}
        <p className="text-muted-foreground text-sm">{question}</p>
        <DialogFooter>
          <Button variant="primary" onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            No, close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CountList({
  title,
  counts,
}: {
  title: string;
  counts: Record<string, number>;
}) {
  const entries = Object.entries(counts);
  if (entries.length === 0) return null;
  return (
    <div>
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {title}
      </p>
      <ul className="mt-1 space-y-0.5 text-sm">
        {entries.map(([kind, count]) => (
          <li key={kind}>
            {count} × {kind.replaceAll("_", " ")}
          </li>
        ))}
      </ul>
    </div>
  );
}

const AUTOMATED_BACKUP_STATUS_ICON: Record<AutomatedBackupStatus, typeof Clock> = {
  queued: Clock,
  running: Loader2,
  complete: CheckCircle2,
  failed: XCircle,
};

//: One colour per status, not "green for done, blue for everything else" -
//: "running" and "cancelled" used to share the same blue and were only told
//: apart by reading the word itself.
export function automatedBackupBadgeVariant(status: string): BadgeProps["variant"] {
  if (status === "complete") return "success";
  if (status === "failed") return "danger";
  if (status === "cancelled") return "warning";
  if (status === "running") return "info";
  return "neutral"; // queued
}

/** Status badge shared by the "Last run" line and the history table - same
 * icon+colour pairing everywhere a backup's status appears in this section. */
export function AutomatedBackupStatusBadge({ status }: { status: string }) {
  const Icon =
    AUTOMATED_BACKUP_STATUS_ICON[status as AutomatedBackupStatus] ?? Clock;
  return (
    <Badge variant={automatedBackupBadgeVariant(status)}>
      <Icon className={cn("size-3", status === "running" && "animate-spin")} />
      {status}
    </Badge>
  );
}

/** One clickable, sort-indicating `<th>` for the automated-backup history
 * table - the small up/down/both-ways arrow next to the label always shows
 * which state a click will move to, not just which column is active. */
export function SortableAutomatedJobsHeader({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: AutomatedJobsSortKey;
  sort: AutomatedJobsSort;
  onSort: (key: AutomatedJobsSortKey) => void;
}) {
  const active = sort?.key === sortKey;
  return (
    <th
      className="p-2 font-medium"
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1 font-medium transition-colors duration-150"
        onClick={() => onSort(sortKey)}
      >
        {label}
        {active ? (
          sort.direction === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : (
          <ArrowUpDown className="size-3 opacity-40" />
        )}
      </button>
    </th>
  );
}

/** "2m 15s" / "1h 4m" / "45s" - elapsed wall-clock time, not a countdown. */
export function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const totalMinutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (totalMinutes < 60) {
    return remainingSeconds ? `${totalMinutes}m ${remainingSeconds}s` : `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/** How long a backup job actually ran for, or "—" when it never started. */
export function automatedJobDuration(job: PortableBackupJob): string {
  if (!job.started_at) return "—";
  const start = new Date(job.started_at).getTime();
  const isTerminal = job.status === "complete" || job.status === "failed";
  const end = isTerminal ? new Date(job.updated_at).getTime() : Date.now();
  return formatElapsed((end - start) / 1000);
}

/** "07/09/2026, 14:30:05" - every field zero-padded to 2 digits, so the
 * history table's "Completed at" column stays a fixed width instead of the
 * single-digit day/month/hour a plain `toLocaleString()` can hand back. */
export function formatCompletedAt(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

/** The rows inside any job's activity log - one implementation for the
 * WikiHub export card, the WikiHub restore card, the Confluence import
 * card and the restore's own pre-job panel below, so all four read
 * identically instead of drifting the way the restore and Confluence
 * cards previously had. */
export function renderJobLogRows(entries: JobLogEntry[]) {
  return entries.map((entry) => {
    const level = entry.level.toLowerCase();
    return (
      <li key={entry.id} className="px-3 py-2">
        <span className="text-muted-foreground tabular-nums">
          {entry.time}
        </span>{" "}
        <span
          className={cn(
            "font-medium",
            level === "warning"
              ? "text-warning"
              : level === "error"
                ? "text-danger"
                : undefined,
          )}
        >
          {entry.level}
        </span>{" "}
        · {entry.label ? `${entry.label}: ` : ""}
        {entry.message}
      </li>
    );
  });
}

/** The one job-progress card layout: title, status badge, subtitle,
 * progress bar, an optional detail line, cancel/trailing actions and its
 * activity log. Fed by WikiHub export/restore jobs and the Confluence
 * import job alike so the three cannot visually drift apart. */
export function JobActivityCard({
  title,
  badgeLabel,
  badgeVariant,
  subtitle,
  extraLine,
  percent,
  cancel,
  trailing,
  logs,
  logsTitle,
  logsExpanded,
  onLogsExpandedChange,
  logsListRef,
}: {
  title: string;
  badgeLabel: string;
  badgeVariant: "info" | "success" | "danger";
  subtitle: ReactNode;
  extraLine?: ReactNode;
  percent: number | null;
  cancel?: { label: string; onClick: () => void; disabled: boolean } | null;
  trailing?: ReactNode;
  logs: JobLogEntry[];
  logsTitle: string;
  logsExpanded: boolean;
  onLogsExpandedChange: (expanded: boolean) => void;
  logsListRef: Ref<HTMLUListElement>;
}) {
  return (
    <div
      className="border-border bg-surface-raised mt-4 rounded-lg border p-5 shadow-sm"
      role="status"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-base font-semibold">{title}</p>
        <Badge variant={badgeVariant}>{badgeLabel}</Badge>
      </div>
      <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>
      <div
        className="bg-surface-sunken relative mt-3 h-2 overflow-hidden rounded-full"
        role="progressbar"
        aria-label={`${title} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
      >
        {percent != null ? (
          <div
            className="bg-primary absolute inset-y-0 left-0 rounded-full duration-150 motion-safe:transition-[width]"
            style={{ width: `${percent}%` }}
          />
        ) : (
          <div className="bg-primary progress-indeterminate absolute inset-y-0 w-2/5 rounded-full" />
        )}
      </div>
      {extraLine ? (
        <p className="text-muted-foreground mt-2 text-xs">{extraLine}</p>
      ) : null}
      {cancel || trailing ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {cancel ? (
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={cancel.disabled}
              onClick={cancel.onClick}
            >
              {cancel.label}
            </Button>
          ) : null}
          {trailing}
        </div>
      ) : null}
      {logs.length ? (
        <LogDisclosure
          title={logsTitle}
          count={logs.length}
          expanded={logsExpanded}
          onExpandedChange={onLogsExpandedChange}
          listRef={logsListRef}
        >
          {renderJobLogRows(logs)}
        </LogDisclosure>
      ) : null}
    </div>
  );
}

/** The export-job status card (percent, ETA, cancel), reused verbatim for
 * restore jobs rather than cloned - `forKind` only steers which
 * `portableBackupJob.kind` this particular placement owns and the label
 * strings. */
export function PortableJobCard({
  forKind,
  portableBackupJob,
  isPortableJobRunning,
  cancelExportPending,
  onRequestCancel,
  restoreLogEntries,
  restoreLogsExpanded,
  onRestoreLogsExpandedChange,
  restoreLogsListRef,
}: {
  forKind: "export" | "restore";
  portableBackupJob: PortableBackupJob | null;
  isPortableJobRunning: boolean;
  cancelExportPending: boolean;
  onRequestCancel: () => void;
  restoreLogEntries: JobLogEntry[];
  restoreLogsExpanded: boolean;
  onRestoreLogsExpandedChange: (expanded: boolean) => void;
  restoreLogsListRef: Ref<HTMLUListElement>;
}) {
  if (!portableBackupJob) return null;
  const isThisKind =
    forKind === "restore"
      ? portableBackupJob.kind === "full_import"
      : portableBackupJob.kind !== "full_import";
  if (!isThisKind) return null;
  const isRestore = forKind === "restore";
  const noun = isRestore ? "Restore" : "Export";
  const status = portableBackupJob.status;

  // A finished restore announces itself in a toast and the completion
  // dialog; this banner only said the same thing a third time, and the
  // "Done" button on it quietly threw the archive away - taking with it the
  // ability to restore further spaces from the same file, which is the one
  // thing someone is most likely to want next. An export keeps its card:
  // the download link lives there and has to stay reachable.
  if (isRestore && status === "complete") return null;

  const badgeVariant =
    status === "complete" ? "success" : status === "failed" ? "danger" : "info";
  const badgeLabel =
    portableBackupJob.cancel_requested && status === "running"
      ? "cancelling"
      : status;

  const title =
    status === "complete"
      ? `${noun} is ready`
      : status === "failed"
        ? `${noun} failed`
        : status === "cancelled"
          ? `${noun} was cancelled`
          : portableBackupJob.cancel_requested
            ? `Cancelling ${noun.toLowerCase()}…`
            : `${isRestore ? "Restoring" : "Exporting"} backup…`;

  const subtitle =
    status === "complete"
      ? "It should download automatically — if not, click the button."
      : status === "failed"
        ? (portableBackupJob.error ??
          `The ${noun.toLowerCase()} could not be completed.`)
        : status === "cancelled"
          ? isRestore
            ? "No changes were made."
            : "No file was produced."
          : portableBackupJob.cancel_requested
            ? `The ${noun.toLowerCase()} stops at its next checkpoint.`
            : portableBackupJob.percent != null
              ? `${portableBackupJob.percent}% complete · ${formatDuration(portableBackupJob.eta_seconds)}`
              : "Running in the background — this can take a while.";

  const extraLine =
    isRestore &&
    isPortableJobRunning &&
    portableBackupJob.phase === "downloading" &&
    portableBackupJob.counters.items_total
      ? `Downloading archive: ${formatBytes(portableBackupJob.counters.items_processed ?? 0)} / ${formatBytes(portableBackupJob.counters.items_total)}`
      : null;

  // Complete/cancelled read as "done", full bar and all - the same
  // convention Confluence's own `jobProgressPercent` already uses (100 on
  // "completed"/"cancelled", but *not* "failed") - rather than freezing
  // wherever the last checkpoint happened to land, which reads as a
  // stuck/broken bar once nothing is actually still running. A failure
  // stays at wherever it actually got to, same as Confluence's.
  const percent =
    status === "complete" || status === "cancelled"
      ? 100
      : portableBackupJob.percent;

  return (
    <JobActivityCard
      title={title}
      badgeLabel={badgeLabel}
      badgeVariant={badgeVariant}
      subtitle={subtitle}
      extraLine={extraLine}
      percent={percent}
      cancel={
        isPortableJobRunning
          ? {
              label: portableBackupJob.cancel_requested
                ? "Cancelling…"
                : `Cancel ${noun.toLowerCase()}`,
              onClick: onRequestCancel,
              disabled:
                cancelExportPending || portableBackupJob.cancel_requested,
            }
          : null
      }
      trailing={
        portableBackupJob.download_url && portableBackupJob.output_filename ? (
          <Button asChild variant="secondary" size="sm">
            <a
              href={portableBackupJob.download_url}
              download={portableBackupJob.output_filename}
            >
              <Download /> Download {portableBackupJob.output_filename}
            </a>
          </Button>
        ) : null
      }
      logs={isRestore ? restoreLogEntries : []}
      logsTitle={isRestore ? "Restore logs" : "Export logs"}
      logsExpanded={restoreLogsExpanded}
      onLogsExpandedChange={onRestoreLogsExpandedChange}
      logsListRef={restoreLogsListRef}
    />
  );
}
