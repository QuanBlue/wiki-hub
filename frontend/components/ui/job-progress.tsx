"use client";

import { Info } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Progress panels shared by every long-running operation in WikiHub.
 *
 * These began life inside the admin backup panel, where the Confluence import
 * and the WikiHub restore had drifted into two lookalikes of the same panel -
 * one an info strip with labelled columns, the other a raised card with the
 * numbers run together. They live here now because the document importer is
 * the third caller, and a third private copy would repeat that history.
 */

export type TransferStats = {
  loaded: number;
  total: number;
  bytesPerSecond: number;
  secondsRemaining: number | null;
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)) - 1,
    units.length - 1,
  );
  return `${(bytes / 1024 ** (index + 1)).toFixed(index > 1 ? 2 : 1)} ${units[index]}`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "Calculating…";
  if (seconds < 60) return `${Math.ceil(seconds)} sec remaining`;
  if (seconds < 60 * 60) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.ceil(seconds % 60);
    return `${minutes} min ${remainingSeconds} sec remaining`;
  }
  if (seconds < 24 * 60 * 60) {
    const hours = Math.floor(seconds / (60 * 60));
    const remainingMinutes = Math.floor((seconds % (60 * 60)) / 60);
    if (remainingMinutes === 0) return `${hours} hr remaining`;
    return `${hours} hr ${remainingMinutes} min remaining`;
  }
  const days = Math.floor(seconds / (24 * 60 * 60));
  const remainingHours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
  const dayLabel = days === 1 ? "day" : "days";
  if (remainingHours === 0) return `${days} ${dayLabel} remaining`;
  return `${days} ${dayLabel} ${remainingHours} hr remaining`;
}

/** The bar itself. `percent === null` means "working, but we cannot say how
 *  far" - shown as a moving stripe rather than a number we would be making up. */
export function ProgressBar({
  percent,
  label,
}: {
  percent: number | null;
  label: string;
}) {
  if (percent === null) {
    return (
      <div
        aria-label={label}
        aria-valuemax={100}
        aria-valuemin={0}
        className="bg-surface mt-2 h-2 overflow-hidden rounded-full"
        role="progressbar"
      >
        <div className="bg-info motion-safe:animate-pulse h-full w-1/3 rounded-full" />
      </div>
    );
  }
  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={percent}
      className="bg-surface mt-2 h-2 overflow-hidden rounded-full"
      role="progressbar"
    >
      <div
        className="bg-info h-full duration-150 motion-safe:transition-[width]"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/** The info-strip shell every progress panel sits in. */
export function ProgressPanel({ children }: { children: ReactNode }) {
  return (
    <div
      className="border-info/25 bg-info-bg mt-4 rounded-md border p-3 text-sm"
      role="status"
    >
      <div className="flex gap-2.5">
        <Info className="text-info mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

/** Fingerprint-in-progress panel, shared by both archive upload flows. */
export function ArchiveHashProgress({
  filename,
  stats,
}: {
  filename: string | null;
  stats: TransferStats;
}) {
  const percent =
    stats.total > 0 ? Math.round((stats.loaded / stats.total) * 100) : 0;
  return (
    <ProgressPanel>
      <p>
        Checking archive fingerprint{" "}
        <span className="font-medium">{filename}</span>: {percent}%
      </p>
      <ProgressBar percent={percent} label={`Fingerprint ${percent}% complete`} />
      <div className="text-muted-foreground mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs">
        <span>
          <span className="text-foreground font-medium">Speed:</span>{" "}
          {stats.bytesPerSecond > 0
            ? `${formatBytes(stats.bytesPerSecond)}/s`
            : "Calculating speed…"}
        </span>
        <span>
          <span className="text-foreground font-medium">Estimate:</span>{" "}
          {formatDuration(stats.secondsRemaining)}
        </span>
      </div>
    </ProgressPanel>
  );
}

/** Upload-in-progress (or paused) panel, shared by every upload flow. */
export function ArchiveUploadProgress({
  filename,
  percent,
  stats,
  uploading,
  totalFallback = 0,
  note,
}: {
  filename: string | null;
  percent: number;
  stats: TransferStats | null;
  uploading: boolean;
  totalFallback?: number;
  /** Extra line under the stats - e.g. how much a resume skipped. */
  note?: ReactNode;
}) {
  return (
    <ProgressPanel>
      <p>
        {uploading ? "Uploading" : "Upload paused"}{" "}
        <span className="font-medium">{filename}</span>: {percent}%
      </p>
      <ProgressBar percent={percent} label={`Upload ${percent}% complete`} />
      <div className="text-muted-foreground mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs">
        <span>
          <span className="text-foreground font-medium">Uploaded:</span>{" "}
          {formatBytes(stats?.loaded ?? 0)} /{" "}
          {formatBytes(stats?.total ?? totalFallback)}
        </span>
        {uploading ? (
          <>
            <span>
              <span className="text-foreground font-medium">Speed:</span>{" "}
              {stats && stats.bytesPerSecond > 0
                ? `${formatBytes(stats.bytesPerSecond)}/s`
                : "Calculating speed…"}
            </span>
            <span>
              <span className="text-foreground font-medium">Estimate:</span>{" "}
              {formatDuration(stats?.secondsRemaining ?? null)}
            </span>
          </>
        ) : null}
      </div>
      {note ? (
        <p className="text-muted-foreground mt-2 text-xs">{note}</p>
      ) : null}
    </ProgressPanel>
  );
}

/**
 * Server-side job progress: a percent and an ETA the backend derived, rather
 * than bytes the browser counted.
 *
 * `percent === null` is a real state, not a missing value - the API returns it
 * whenever there is not yet enough data to estimate honestly.
 */
export function JobProgress({
  title,
  percent,
  etaSeconds,
  detail,
}: {
  title: ReactNode;
  percent: number | null;
  etaSeconds: number | null;
  detail?: ReactNode;
}) {
  return (
    <ProgressPanel>
      <p>
        {title}
        {percent !== null ? `: ${percent}%` : null}
      </p>
      <ProgressBar
        percent={percent}
        label={percent === null ? "Working" : `${percent}% complete`}
      />
      <div className="text-muted-foreground mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs">
        {detail ? <span>{detail}</span> : null}
        <span>
          <span className="text-foreground font-medium">Estimate:</span>{" "}
          {formatDuration(etaSeconds)}
        </span>
      </div>
    </ProgressPanel>
  );
}
