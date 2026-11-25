"use client";

import {
  AlertTriangle,
  ArchiveRestore,
  ArrowDownToLine,
  ChevronDown,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Upload,
} from "lucide-react";
import Link from "next/link";
import type { RefObject } from "react";
import { ImportHistory } from "@/components/admin/import-history";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArchiveHashProgress,
  ArchiveUploadProgress,
  formatBytes,
} from "@/components/ui/job-progress";
import { LogDisclosure } from "@/components/ui/log-disclosure";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { ConfluenceArchive, SiteSettings } from "@/types/api";
import {
  CountList,
  JobActivityCard,
  PortableJobCard,
  renderJobLogRows,
} from "./backup-ui-primitives";
import type { PortableBackupJob } from "./types";
import type { useConfluenceImport } from "./use-confluence-import";
import type { useWikihubRestore } from "./use-wikihub-restore";

type RestoreStateProps = Omit<
  ReturnType<typeof useWikihubRestore>,
  "fileInput" | "restoreUploadActiveRef" | "uploadBackupRun" | "restoreLogsListRef"
>;

type ConfluenceStateProps = Omit<
  ReturnType<typeof useConfluenceImport>,
  | "confluenceFileInput"
  | "confluenceUploadRequest"
  | "confluenceHashAbort"
  | "uploadPauseReason"
  | "uploadRestoreRun"
  | "uploadActiveRef"
  | "logsListRef"
>;

export type ImportSectionProps = {
  visible: boolean;
  siteSettings: SiteSettings | null;
  portableBackupJob: PortableBackupJob | null;
  isPortableJobRunning: boolean;
  cancelExportPending: boolean;
  onRequestCancelPortableJob: () => void;
  restoreLockedByConfluence: boolean;
  confluenceLockedByRestore: boolean;
  restoreInputsLocked: boolean;
  restore: RestoreStateProps;
  confluence: ConfluenceStateProps;
  restoreFileInputRef: RefObject<HTMLInputElement | null>;
  restoreLogsListRef: RefObject<HTMLUListElement | null>;
  confluenceFileInputRef: RefObject<HTMLInputElement | null>;
  confluenceLogsListRef: RefObject<HTMLUListElement | null>;
};

export function ImportSection({
  visible,
  siteSettings,
  portableBackupJob,
  isPortableJobRunning,
  cancelExportPending,
  onRequestCancelPortableJob,
  restoreLockedByConfluence,
  confluenceLockedByRestore,
  restoreInputsLocked,
  restore,
  confluence,
  restoreFileInputRef,
  restoreLogsListRef,
  confluenceFileInputRef,
  confluenceLogsListRef,
}: ImportSectionProps) {
  const isZipSelected =
    restore.file?.name.toLocaleLowerCase().endsWith(".zip") ||
    Boolean(restore.backupArchive) ||
    restore.restoreUploadResumable;

  return (
    <section
      id="backup-import-section"
      role="tabpanel"
      className={cn(
        "border-border bg-surface overflow-hidden rounded-xl border p-5 shadow-sm",
        !visible && "hidden",
      )}
    >
      <div className="mb-5">
        <h2 className="flex items-center gap-2.5 text-base font-semibold">
          <span className="bg-primary-subtle text-primary flex size-8 items-center justify-center rounded-md">
            <ArchiveRestore className="size-4" />
          </span>
          Import &amp; Restore workspace data
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Two separate import paths are available. They serve different
          purposes and are{" "}
          <strong className="text-foreground font-medium">
            not interchangeable
          </strong>
          .
        </p>
      </div>

      {/* 2-card grid */}
      <div className="grid grid-cols-1 gap-0 md:grid-cols-[1fr_auto_1fr]">
        {/* Card 1: WikiHub Restore */}
        <div
          data-testid="wikihub-restore-card"
          className="border-border bg-surface-raised flex flex-col overflow-hidden rounded-xl border shadow-sm"
        >
          <div className="flex flex-1 flex-col p-4">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="bg-primary-subtle text-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
                  <RotateCcw className="size-4" />
                </span>
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    Restore WikiHub Backup
                  </div>
                  <div className="text-muted-foreground mt-0.5 text-[11px]">
                    Native restore package
                  </div>
                </div>
              </div>
              <span className="bg-primary-subtle text-primary shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium">
                Native
              </span>
            </div>

            <p className="text-muted-foreground text-xs leading-relaxed">
              Upload a trusted WikiHub{" "}
              <code className="text-foreground bg-surface-sunken rounded px-1 py-0.5 font-mono text-[11px]">
                .zip
              </code>{" "}
              or{" "}
              <code className="text-foreground bg-surface-sunken rounded px-1 py-0.5 font-mono text-[11px]">
                .json
              </code>{" "}
              backup to restore it. Existing records are{" "}
              <span className="text-foreground font-medium">
                skipped, never overwritten
              </span>
              , and the built-in administrator is always left untouched.
            </p>
            {siteSettings?.effective?.max_backup_import_size_mb ? (
              <p className="text-muted-foreground mt-1 text-[11px]">
                Max file size: {siteSettings.effective.max_backup_import_size_mb}{" "}
                MB. Raise it under{" "}
                <Link href="/admin/storage" className="text-primary hover:underline">
                  Admin → Object storage → Quotas
                </Link>
                .
              </p>
            ) : null}

            <div className="mt-auto space-y-3 pt-4">
              <div>
                <input
                  id="backup-file"
                  ref={restoreFileInputRef}
                  type="file"
                  accept="application/json,.json,application/zip,.zip"
                  disabled={
                    restore.isPreparingArchive ||
                    Boolean(restore.backupArchive) ||
                    restoreInputsLocked
                  }
                  onChange={restore.handleRestoreFileInputChange}
                  className={cn(
                    "border-border bg-surface file:bg-surface-sunken file:text-foreground hover:border-border-strong block w-full rounded-md border text-sm transition-colors duration-150 file:mr-3 file:border-0 file:px-3 file:py-2 file:text-sm",
                    restore.isPreparingArchive ||
                      restore.backupArchive ||
                      restoreInputsLocked
                      ? "cursor-not-allowed opacity-50 file:cursor-not-allowed"
                      : "cursor-pointer file:cursor-pointer",
                  )}
                />
                {restoreLockedByConfluence ? (
                  <p className="text-muted-foreground mt-1.5 text-xs">
                    A Confluence import is in progress. Finish or cancel
                    it to restore a WikiHub backup instead — both write
                    the same spaces, so only one can run.
                  </p>
                ) : restore.isRestoreJobRunning || restore.pending === "apply" ? (
                  <p className="text-muted-foreground mt-1.5 text-xs">
                    A restore is running. Wait for it to finish, or
                    cancel it below, before choosing another backup.
                  </p>
                ) : restore.restoreUploadNeedsFile ? (
                  <p className="text-muted-foreground mt-1.5 text-xs">
                    Select {restore.pendingRestoreUpload?.filename} again so
                    WikiHub can read the remaining parts.
                  </p>
                ) : restore.restoreUploadResumable && restore.pendingRestoreUpload ? (
                  <p className="text-muted-foreground mt-1.5 text-xs">
                    {formatBytes(restore.pendingRestoreUploadedBytes)} of{" "}
                    {restore.pendingRestoreUpload.filename} is already in
                    storage. Resume upload sends only what is missing.
                  </p>
                ) : restore.backupArchive ? (
                  <p className="text-muted-foreground mt-1.5 text-xs">
                    Use a different file below to replace this
                    selection.
                  </p>
                ) : null}
              </div>

              {restore.error ? (
                <p
                  role="alert"
                  className="border-danger/30 bg-danger/10 text-danger rounded-md border px-3 py-2 text-sm"
                >
                  {restore.error}
                </p>
              ) : null}

              {isZipSelected && !restore.backupArchive ? (
                restore.isScanningBackupArchive ? null : restore.isPreparingArchive ? (
                  <div className="flex gap-2">
                    {restore.isUploadingBackupArchive ? (
                      <Button
                        variant="secondary"
                        className="flex-1"
                        onClick={restore.pauseBackupArchiveUpload}
                      >
                        <Pause /> Pause upload
                      </Button>
                    ) : null}
                    <Button
                      variant="danger"
                      className="flex-1"
                      onClick={() => restore.setConfirmCancelBackupUpload(true)}
                    >
                      Cancel upload
                    </Button>
                  </div>
                ) : restore.restoreArchiveRejected ? (
                  <Button
                    variant="primary"
                    className="w-full"
                    disabled={restoreInputsLocked}
                    onClick={restore.uploadAnotherAfterRejection}
                  >
                    <Upload /> Upload another file
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      className="flex-1"
                      disabled={
                        (!restore.file && !restore.restoreUploadNeedsFile) ||
                        restoreInputsLocked
                      }
                      onClick={() => {
                        if (restore.restoreUploadNeedsFile) {
                          restoreFileInputRef.current?.click();
                          return;
                        }
                        if (restore.file) {
                          void restore.uploadAndScanBackupArchive(restore.file);
                        }
                      }}
                    >
                      {restore.restoreUploadResumable ? <Play /> : <Upload />}
                      {restore.restoreUploadNeedsFile
                        ? "Select file to resume"
                        : restore.restoreUploadResumable
                          ? "Resume upload"
                          : "Upload and scan"}
                    </Button>
                    {restore.restoreUploadResumable ? (
                      <Button
                        variant="danger"
                        className="flex-1"
                        disabled={restoreInputsLocked}
                        onClick={() => {
                          if (restore.restoreUploadProgress != null) {
                            restore.setConfirmCancelBackupUpload(true);
                            return;
                          }
                          void restore.discardPendingRestoreUpload();
                        }}
                      >
                        Cancel upload
                      </Button>
                    ) : null}
                  </div>
                )
              ) : (
                <Button
                  variant="primary"
                  className="w-full"
                  disabled={
                    (!restore.file && !restore.backupArchive) ||
                    restore.pending !== null ||
                    restoreInputsLocked ||
                    restore.restoreDecisionOwnedByReadyBar
                  }
                  aria-busy={restore.pending === "apply"}
                  onClick={() => void restore.submitImport()}
                >
                  {restore.pending === "apply" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Upload />
                  )}
                  Restore backup
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* "or" divider */}
        <div className="flex items-center justify-center py-4 md:flex-col md:px-4 md:py-0">
          <div className="bg-border h-px w-full md:h-full md:w-px" />
          <span className="bg-surface border-border text-muted-foreground mx-3 shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium md:mx-0 md:my-3">
            or
          </span>
          <div className="bg-border h-px w-full md:h-full md:w-px" />
        </div>

        {/* Card 2: Confluence Import */}
        <div className="border-border bg-surface-raised flex flex-col overflow-hidden rounded-xl border shadow-sm">
          <div className="flex flex-1 flex-col p-4">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    backgroundColor: "hsl(38 92% 50% / 0.12)",
                    color: "hsl(38 92% 50%)",
                  }}
                >
                  <ArrowDownToLine className="size-4" />
                </span>
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    Import Confluence Backup
                  </div>
                  <div className="text-muted-foreground mt-0.5 text-[11px]">
                    Migration / hand-off format
                  </div>
                </div>
              </div>
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{
                  backgroundColor: "hsl(38 92% 50% / 0.12)",
                  color: "hsl(38 92% 50%)",
                }}
              >
                Migration
              </span>
            </div>

            <p className="text-muted-foreground text-xs leading-relaxed">
              Upload a Confluence site or space export{" "}
              <code className="text-foreground bg-surface-sunken rounded px-1 py-0.5 font-mono text-[11px]">
                .zip
              </code>{" "}
              archive to bring content into WikiHub. The archive uploads
              directly to protected object storage.
            </p>
            {siteSettings?.effective?.max_backup_import_size_mb ? (
              <p className="text-muted-foreground mt-1 text-[11px]">
                Max file size: {siteSettings.effective.max_backup_import_size_mb}{" "}
                MB. Raise it under{" "}
                <Link href="/admin/storage" className="text-primary hover:underline">
                  Admin → Object storage → Quotas
                </Link>
                .
              </p>
            ) : null}

            <div className="mt-auto space-y-3 pt-4">
              <div>
                <input
                  id="confluence-backup-file"
                  ref={confluenceFileInputRef}
                  type="file"
                  accept=".zip,application/zip,application/x-zip-compressed"
                  disabled={
                    confluence.confluencePending ||
                    Boolean(confluence.confluenceArchive) ||
                    confluence.importInProgress ||
                    confluenceLockedByRestore
                  }
                  onChange={confluence.handleConfluenceFileChange}
                  className={cn(
                    "border-border bg-surface file:bg-surface-sunken file:text-foreground hover:border-border-strong block w-full rounded-md border text-sm transition-colors duration-150 file:mr-3 file:border-0 file:px-3 file:py-2 file:text-sm",
                    confluence.confluencePending ||
                      confluence.confluenceArchive ||
                      confluence.importInProgress ||
                      confluenceLockedByRestore
                      ? "cursor-not-allowed opacity-50 file:cursor-not-allowed"
                      : "cursor-pointer file:cursor-pointer",
                  )}
                />
                {(confluence.storedUploadNeedsFile ||
                  confluence.confluenceArchive ||
                  confluenceLockedByRestore) && (
                  <p className="text-muted-foreground mt-1.5 text-xs">
                    {confluenceLockedByRestore
                      ? "A WikiHub restore is in progress. Finish or cancel it to import a Confluence archive instead — both write the same spaces, so only one can run."
                      : confluence.storedUploadNeedsFile
                        ? `Select ${confluence.storedConfluenceUpload?.fileName} again so WikiHub can read the remaining parts.`
                        : "Finish or clear this space selection before choosing another archive."}
                  </p>
                )}
              </div>

              {confluence.confluenceUploadError ? (
                <p
                  role="alert"
                  className="border-danger/30 bg-danger/10 text-danger rounded-md border px-3 py-2 text-sm"
                >
                  {confluence.confluenceUploadError}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {confluence.isUploading || confluence.isHashingArchive ? (
                  <>
                    {confluence.isUploading ? (
                      <Button
                        variant="secondary"
                        className="flex-1"
                        onClick={() => confluence.cancelConfluenceUpload("pause")}
                      >
                        <Pause /> Pause upload
                      </Button>
                    ) : null}
                    <Button
                      variant="danger"
                      className="flex-1"
                      disabled={confluence.cancelUploadPending}
                      onClick={() => confluence.setConfirmCancelUpload(true)}
                    >
                      Cancel upload
                    </Button>
                  </>
                ) : !confluence.isFinalizingArchive ? (
                  <>
                    <Button
                      variant="primary"
                      className="flex-1"
                      disabled={
                        (!confluence.confluenceFile &&
                          !confluence.canResumeStoredUpload &&
                          !confluence.storedUploadNeedsFile) ||
                        confluence.confluencePending ||
                        Boolean(confluence.confluenceArchive) ||
                        confluence.importInProgress ||
                        confluenceLockedByRestore
                      }
                      onClick={() => {
                        if (confluence.storedUploadNeedsFile) {
                          confluenceFileInputRef.current?.click();
                          return;
                        }
                        void confluence.uploadConfluence(
                          Boolean(confluence.storedConfluenceUpload),
                        );
                      }}
                    >
                      {confluence.confluencePending &&
                      !confluence.confluenceArchive ? (
                        <Loader2 className="animate-spin" />
                      ) : confluence.storedConfluenceUpload ? (
                        <Play />
                      ) : (
                        <Upload />
                      )}{" "}
                      {confluence.storedUploadNeedsFile
                        ? "Select file to resume"
                        : confluence.storedConfluenceUpload
                          ? "Resume upload"
                          : "Upload and scan"}
                    </Button>
                    {confluence.storedConfluenceUpload &&
                    !confluence.confluenceArchive ? (
                      <Button
                        variant="danger"
                        className="flex-1"
                        disabled={confluence.cancelUploadPending}
                        onClick={() => confluence.setConfirmCancelUpload(true)}
                      >
                        Cancel upload
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Full-width status panels below the grid ── */}

      {/* Confluence: fingerprint progress */}
      {confluence.isHashingArchive && confluence.hashStats ? (
        <ArchiveHashProgress
          filename={confluence.confluenceArchiveName}
          stats={confluence.hashStats}
        />
      ) : null}

      {/* Confluence: finalizing */}
      {confluence.isFinalizingArchive ? (
        <div
          className="border-info/25 bg-info-bg mt-4 flex gap-2.5 rounded-md border p-3 text-sm"
          role="status"
        >
          <Loader2 className="text-info mt-0.5 size-4 shrink-0 animate-spin" />
          <div>
            <p className="font-medium">
              Upload complete. Preparing your archive…
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              Verifying the upload and scanning spaces can take a few minutes
              for large archives. Keep this page open while WikiHub prepares
              the import list.
            </p>
          </div>
        </div>
      ) : null}

      {/* Confluence: upload progress */}
      {confluence.uploadProgress !== null &&
      !confluence.confluenceArchive &&
      !confluence.isFinalizingArchive &&
      !confluence.isHashingArchive ? (
        <ArchiveUploadProgress
          filename={confluence.confluenceArchiveName}
          percent={confluence.uploadProgress}
          stats={confluence.uploadStats}
          uploading={confluence.isUploading}
          totalFallback={confluence.confluenceArchiveSize}
        />
      ) : null}

      {/* Confluence: preparation logs */}
      {confluence.preparationLogs.length > 0 && !confluence.confluenceArchive ? (
        <details
          className="border-border bg-surface mt-4 rounded-md border"
          open={confluence.preparationLogsExpanded}
          onToggle={(event) =>
            confluence.setPreparationLogsExpanded(event.currentTarget.open)
          }
        >
          <summary className="hover:bg-surface-hover focus-visible:ring-ring focus-visible:ring-offset-background flex cursor-pointer list-none items-center justify-between gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-offset-1">
            <span>Preparation logs ({confluence.preparationLogs.length})</span>
            <ChevronDown
              className={cn(
                "text-muted-foreground size-4 transition-transform duration-150",
                confluence.preparationLogsExpanded && "rotate-180",
              )}
            />
          </summary>
          <ul className="border-border max-h-36 divide-y overflow-y-auto border-t text-xs">
            {confluence.preparationLogs.map((log, index) => (
              <li key={`${index}-${log}`} className="px-3 py-2">
                {log}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {/* Confluence: archive ready */}
      {confluence.confluenceArchive && !confluence.importInProgress ? (
        <div className="border-border bg-surface-sunken mt-4 flex items-center justify-between gap-3 rounded-md border p-4 text-sm">
          <div>
            <p className="font-semibold">Confluence archive ready for import</p>
            <p className="text-muted-foreground mt-1 text-xs">
              {confluence.confluenceArchive.spaces.length} spaces found. Choose
              which spaces to import.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="danger"
              size="sm"
              disabled={confluence.confluencePending}
              onClick={() => confluence.setConfirmDiscardArchive(true)}
            >
              Cancel import
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                confluence.setIsSpaceModalOpen(true);
                if (confluence.confluenceArchive) {
                  apiFetch<ConfluenceArchive>(
                    `/api/v1/confluence-imports/archives/${confluence.confluenceArchive.id}`,
                  )
                    .then((archive) => confluence.setConfluenceArchive(archive))
                    .catch(() => {});
                }
              }}
            >
              Select spaces &amp; import
            </Button>
          </div>
        </div>
      ) : null}

      {/* Confluence: job progress */}
      {confluence.confluenceJob ? (
        <JobActivityCard
          title={confluence.jobTitle}
          badgeLabel={confluence.confluenceJob.status}
          badgeVariant={
            confluence.confluenceJob.status === "completed"
              ? "success"
              : confluence.confluenceJob.status === "failed"
                ? "danger"
                : "info"
          }
          subtitle={
            <>
              {Math.round(confluence.jobProgressPercent)}% complete ·{" "}
              {confluence.jobSpacesCompleted}/{confluence.jobSpacesTotal} spaces
              {" · "}
              {confluence.jobPagesSummary}
              {confluence.jobAttachmentsTotal > 0
                ? ` · ${confluence.jobAttachmentsProcessed}/${confluence.jobAttachmentsTotal} attachments`
                : ""}
            </>
          }
          extraLine={
            confluence.confluenceJob.phase === "downloading" ? (
              <>
                Downloading archive:{" "}
                {formatBytes(
                  confluence.confluenceJob.counters.downloaded_bytes ?? 0,
                )}{" "}
                /{" "}
                {formatBytes(
                  confluence.confluenceJob.counters.download_total_bytes ?? 0,
                )}{" "}
                ({confluence.displayedDownloadPercent}%)
              </>
            ) : null
          }
          percent={confluence.jobProgressPercent}
          cancel={
            !["completed", "failed", "cancelled"].includes(
              confluence.confluenceJob.status,
            )
              ? {
                  label: confluence.confluenceCancelPending
                    ? "Cancelling..."
                    : "Cancel",
                  disabled: confluence.confluenceCancelPending,
                  onClick: () => void confluence.cancelConfluenceJob(),
                }
              : null
          }
          logs={confluence.confluenceActivityLogs}
          logsTitle="Import activity"
          logsExpanded={confluence.confluenceLogsExpanded}
          onLogsExpandedChange={confluence.setConfluenceLogsExpanded}
          logsListRef={confluenceLogsListRef}
        />
      ) : null}

      {/* WikiHub restore, .zip: "Upload and scan" fingerprint progress. */}
      {visible && restore.isHashingBackupArchive && restore.backupHashStats ? (
        <ArchiveHashProgress
          filename={restore.file?.name ?? null}
          stats={restore.backupHashStats}
        />
      ) : null}

      {/* WikiHub restore, .zip: chunked-archive-upload progress */}
      {visible &&
      !restore.restoreArchiveRejected &&
      (restore.restoreUploadProgress != null ||
        restore.restoreUploadNeedsFile) ? (
        <ArchiveUploadProgress
          filename={
            restore.file?.name ?? restore.pendingRestoreUpload?.filename ?? null
          }
          percent={
            restore.restoreUploadProgress ?? restore.pendingRestorePercent
          }
          stats={restore.restoreUploadStats ?? restore.pendingRestoreStats}
          uploading={restore.isUploadingBackupArchive}
          totalFallback={restore.file?.size ?? 0}
          note={
            restore.restoreResumedBytes > 0
              ? `Resumed an earlier upload of this file — ${formatBytes(restore.restoreResumedBytes)} was already in storage and is not being sent again.`
              : restore.restoreUploadNeedsFile
                ? "Nothing already uploaded was lost. Select the same file again to carry on from here."
                : !restore.isUploadingBackupArchive
                  ? "Nothing already uploaded was lost. Press Resume upload to carry on from here."
                  : undefined
          }
        />
      ) : null}

      {/* WikiHub restore, .zip: scanning */}
      {visible && restore.isScanningBackupArchive ? (
        <div
          className="border-info/25 bg-info-bg mt-4 flex gap-2.5 rounded-md border p-3 text-sm"
          role="status"
        >
          <Loader2 className="text-info mt-0.5 size-4 shrink-0 animate-spin" />
          <div>
            <p className="font-medium">
              Upload complete. Scanning the archive…
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              Reading its space list can take a few minutes for large
              archives. Keep this page open.
            </p>
          </div>
        </div>
      ) : null}

      {/* WikiHub restore, .zip: archive ready */}
      {visible &&
      restore.backupArchive &&
      !restore.isRestoreJobRunning &&
      restore.pending !== "apply" ? (
        <div className="border-border bg-surface-sunken mt-4 flex items-center justify-between gap-3 rounded-md border p-4 text-sm">
          <div>
            <p className="font-semibold">WikiHub backup ready to restore</p>
            <p className="text-muted-foreground mt-1 text-xs">
              {restore.backupArchive.spaces.length} spaces found. Choose which
              spaces to restore.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="danger"
              size="sm"
              disabled={restoreInputsLocked}
              onClick={() => restore.setConfirmDiscardBackupArchive(true)}
            >
              Cancel restore
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={restoreInputsLocked}
              onClick={() => restore.setIsImportSpacePickerOpen(true)}
            >
              Select spaces &amp; restore
            </Button>
          </div>
        </div>
      ) : null}

      {/* WikiHub restore, .json: blocking progress */}
      {restore.pending === "apply" &&
      visible &&
      !restore.file?.name.toLocaleLowerCase().endsWith(".zip") ? (
        <div className="border-border bg-surface-raised mt-4 rounded-lg border p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-base font-semibold">Restoring WikiHub backup…</p>
            <Badge variant="info">running</Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            Uploading and applying {restore.file?.name ?? "the archive"}. Keep
            this tab open.
          </p>
          <div
            className="bg-surface-sunken relative mt-3 h-2 overflow-hidden rounded-full"
            role="progressbar"
            aria-label="Restore in progress"
          >
            <div className="bg-primary progress-indeterminate absolute inset-y-0 w-2/5 rounded-full" />
          </div>
        </div>
      ) : null}

      {/* WikiHub restore, .zip: durable job card */}
      {visible ? (
        <PortableJobCard
          forKind="restore"
          portableBackupJob={portableBackupJob}
          isPortableJobRunning={isPortableJobRunning}
          cancelExportPending={cancelExportPending}
          onRequestCancel={onRequestCancelPortableJob}
          restoreLogEntries={restore.restoreLogEntries}
          restoreLogsExpanded={restore.restoreLogsExpanded}
          onRestoreLogsExpandedChange={restore.setRestoreLogsExpanded}
          restoreLogsListRef={restoreLogsListRef}
        />
      ) : null}

      {/* Standalone restore log panel when job card is not showing */}
      {visible &&
      !restore.restoreJobCardVisible &&
      restore.restoreLogEntries.length > 0 ? (
        <LogDisclosure
          title="Restore logs"
          count={restore.restoreLogEntries.length}
          expanded={restore.restoreLogsExpanded}
          onExpandedChange={restore.setRestoreLogsExpanded}
          listRef={restoreLogsListRef}
        >
          {renderJobLogRows(restore.restoreLogEntries)}
        </LogDisclosure>
      ) : null}

      {/* Past runs and their stored logs */}
      {visible ? (
        <ImportHistory
          key={`${confluence.confluenceJob?.id}:${confluence.confluenceJob?.status}:${portableBackupJob?.id}:${portableBackupJob?.status}`}
        />
      ) : null}

      {/* WikiHub restore: report */}
      {restore.report && visible ? (
        <div className="border-border bg-surface-raised mt-4 rounded-lg border p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold">
              {restore.report.dry_run ? "Preview" : "Import result"}
            </h3>
            <Badge variant={restore.report.dry_run ? "info" : "success"}>
              {restore.report.dry_run ? "nothing written" : "applied"}
            </Badge>
            {restore.report.includes_credentials ? (
              <Badge variant="warning">includes credentials</Badge>
            ) : null}
          </div>
          <div className="mt-4 grid gap-5 sm:grid-cols-3">
            <CountList title="Created" counts={restore.report.created} />
            <CountList title="Skipped" counts={restore.report.skipped} />
            <CountList title="Errors" counts={restore.report.errors} />
          </div>
          {restore.report.users_without_password.length > 0 ? (
            <div className="border-warning/30 bg-warning-bg mt-4 flex gap-2.5 rounded-md border p-3">
              <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" />
              <div className="text-sm">
                <p className="font-medium">
                  {restore.report.users_without_password.length} account(s)
                  cannot sign in yet
                </p>
                <p className="text-muted-foreground mt-0.5">
                  The backup carried no password hashes. Set a password for each
                  from the Users tab:{" "}
                  {restore.report.users_without_password.slice(0, 10).join(", ")}
                  {restore.report.users_without_password.length > 10 ? "…" : ""}
                </p>
              </div>
            </div>
          ) : null}
          {restore.report.entries.length > 0 ? (
            <details
              className="border-border bg-surface mt-4 rounded-md border"
              open
            >
              <summary className="hover:bg-surface-hover cursor-pointer px-3 py-2 text-sm font-medium transition-colors duration-150">
                Per-item detail ({restore.report.entries.length}
                {restore.report.entries_truncated ? ", truncated" : ""})
              </summary>
              <ul className="border-border max-h-44 divide-y overflow-y-auto border-t text-xs">
                {restore.report.entries.map((entry, index) => (
                  <li
                    key={`${entry.kind}-${entry.label}-${index}`}
                    className="px-3 py-2"
                  >
                    <Badge
                      variant={
                        entry.outcome === "created"
                          ? "success"
                          : entry.outcome === "error"
                            ? "danger"
                            : "neutral"
                      }
                    >
                      {entry.outcome}
                    </Badge>{" "}
                    <span className="text-muted-foreground">{entry.kind}</span>{" "}
                    {entry.label}
                    {entry.reason ? (
                      <span className="text-muted-foreground">
                        {" "}
                        — {entry.reason.replaceAll("_", " ")}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
