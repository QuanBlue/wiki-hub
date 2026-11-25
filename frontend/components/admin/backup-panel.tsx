"use client";

import { AlertTriangle, Archive, ArchiveRestore } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { apiFetch } from "@/lib/api-client";
import { detectArchiveFormat, type ArchiveFormat } from "@/lib/archive-format";
import { cn } from "@/lib/utils";
import type { SiteSettings, Space } from "@/types/api";
import { AutomatedBackupsSection } from "./backup/automated-backups-section";
import {
  CountList,
  ImportCompletedDialog,
  automatedBackupBadgeVariant,
} from "./backup/backup-ui-primitives";
import {
  clearStoredUploadMetadata,
  fileMatchesStoredUpload,
  forgetCancelledUpload,
  normalizeStoredUpload,
  readCancelledUploadIds,
  readStoredUploadMetadata,
  rememberCancelledUpload,
  saveStoredUploadMetadata,
  serverUploadToStoredUpload,
} from "./backup/confluence-storage";
import { ExportSection } from "./backup/export-section";
import { ImportSection } from "./backup/import-section";
import { sha256File } from "./backup/sha256";
import {
  ConfluenceSpacePickerDialog,
  ExportSpacePickerDialog,
  ImportSpacePickerDialog,
  MismatchedResumeFileDialog,
} from "./backup/space-picker-dialogs";
import {
  CONFLUENCE_UPLOAD_METADATA_KEY,
  backupFeatures,
  errorMessage,
  type PortableBackupJob,
  type StoredConfluenceUpload,
} from "./backup/types";
import { useConfluenceImport } from "./backup/use-confluence-import";
import { useWikihubRestore } from "./backup/use-wikihub-restore";

export {
  backupFeatures,
  errorMessage,
  normalizeStoredUpload,
  readStoredUploadMetadata,
  saveStoredUploadMetadata,
  clearStoredUploadMetadata,
  readCancelledUploadIds,
  rememberCancelledUpload,
  forgetCancelledUpload,
  fileMatchesStoredUpload,
  serverUploadToStoredUpload,
  sha256File,
  CountList,
  automatedBackupBadgeVariant,
};
export type { StoredConfluenceUpload };

const BACKUP_SECTIONS = [
  {
    id: "export" as const,
    label: "Export / Backup",
    icon: Archive,
  },
  {
    id: "import" as const,
    label: "Import / Restore",
    icon: ArchiveRestore,
  },
];

export function BackupPanel() {
  const router = useRouter();
  const exportActiveRef = useRef(false);
  const allowConfirmedLeaveRef = useRef(false);
  const autoDownloadedJobIdRef = useRef<string | null>(null);
  const settledRestoreJobIdRef = useRef<string | null>(null);
  const uploadRenewalStops = useRef(new Set<() => void>());

  const [siteSettings, setSiteSettings] = useState<SiteSettings | null>(null);
  const [activeSection, setActiveSection] = useState<"export" | "import">(
    "export",
  );
  const [includeCredentials, setIncludeCredentials] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [confluenceExportProfile, setConfluenceExportProfile] = useState("");
  const [portableBackupJob, setPortableBackupJob] =
    useState<PortableBackupJob | null>(null);

  // Native-export space scope
  const [exportSpaceScope, setExportSpaceScope] = useState<"all" | "selected">(
    "all",
  );
  const [exportSelectedSpaceKeys, setExportSelectedSpaceKeys] = useState<
    string[]
  >([]);
  const [exportSpaceFilter, setExportSpaceFilter] = useState("");
  const [isExportSpacePickerOpen, setIsExportSpacePickerOpen] = useState(false);
  const [isExportOptionsOpen, setIsExportOptionsOpen] = useState(false);
  const [availableSpaces, setAvailableSpaces] = useState<Space[] | null>(null);
  const [isLoadingAvailableSpaces, setIsLoadingAvailableSpaces] =
    useState(false);

  // Navigation / cancel guards
  const [leaveTarget, setLeaveTarget] = useState<string | null>(null);
  const [confirmCancelExport, setConfirmCancelExport] = useState(false);
  const [cancelExportPending, setCancelExportPending] = useState(false);
  const [exportLeaveTarget, setExportLeaveTarget] = useState<string | null>(
    null,
  );

  const renewUploadSession = useCallback(async () => {
    await apiFetch<void>("/api/v1/auth/renew", { method: "POST" });
  }, []);

  const startUploadSessionRenewal = useCallback(
    (runRenewal: () => void): (() => void) => {
      const timer = window.setInterval(runRenewal, 2 * 60 * 1000);
      const onVisible = () => {
        if (document.visibilityState === "visible") runRenewal();
      };
      document.addEventListener("visibilitychange", onVisible);
      const stop = () => {
        if (!uploadRenewalStops.current.delete(stop)) return;
        window.clearInterval(timer);
        document.removeEventListener("visibilitychange", onVisible);
      };
      uploadRenewalStops.current.add(stop);
      return stop;
    },
    [],
  );

  const rejectWrongArchiveFormat = useCallback(
    async (
      candidate: File,
      expected: ArchiveFormat,
      reject: (message: string) => void,
    ) => {
      if (!candidate.name.toLocaleLowerCase().endsWith(".zip")) return;
      const format = await detectArchiveFormat(candidate);
      if (format === "unknown" || format === expected) return;
      reject(
        format === "confluence"
          ? "This is a Confluence export, not a WikiHub backup. Upload it under “Import Confluence Backup” instead."
          : "This is a WikiHub backup, not a Confluence export. Upload it under “Restore WikiHub Backup” instead.",
      );
    },
    [],
  );

  const confluence = useConfluenceImport({
    siteSettings,
    setSiteSettings,
    renewUploadSession,
    startUploadSessionRenewal,
    rejectWrongArchiveFormat,
  });

  const restore = useWikihubRestore({
    siteSettings,
    portableBackupJob,
    setPortableBackupJob,
    setActiveSection,
    renewUploadSession,
    startUploadSessionRenewal,
    rejectWrongArchiveFormat,
    settledRestoreJobIdRef,
  });

  const isFullExportRunning =
    portableBackupJob?.kind === "full_export" &&
    (portableBackupJob.status === "queued" ||
      portableBackupJob.status === "running");
  const isConfluenceExportRunning =
    portableBackupJob?.kind === "confluence_export" &&
    (portableBackupJob.status === "queued" ||
      portableBackupJob.status === "running");
  const isPortableJobRunning =
    isFullExportRunning ||
    isConfluenceExportRunning ||
    restore.isRestoreJobRunning;

  const confluenceLockedByRestore =
    restore.restoreFlowActive && !confluence.confluenceFlowActive;
  const restoreLockedByConfluence =
    confluence.confluenceFlowActive && !restore.restoreFlowActive;
  const restoreInputsLocked =
    restoreLockedByConfluence ||
    restore.isRestoreJobRunning ||
    restore.pending === "apply";

  // Keep the administrator's session alive while this panel is open.
  useEffect(() => {
    let timer: number | null = null;
    let cancelled = false;

    const runHeartbeat = () => {
      if (cancelled) return;
      void renewUploadSession().catch(() => {
        // Transient network issues should not break the panel.
      });
    };

    runHeartbeat();
    timer = window.setInterval(runHeartbeat, 2 * 60 * 1000);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        runHeartbeat();
      }
    };
    const onFocus = () => {
      runHeartbeat();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearInterval(timer);
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [renewUploadSession]);

  useEffect(() => {
    exportActiveRef.current = isPortableJobRunning;
  }, [isPortableJobRunning]);

  // Invalidate any in-flight uploads and stop renewal timers on unmount.
  useEffect(() => {
    const renewalStops = uploadRenewalStops.current;
    const backupRun = restore.uploadBackupRun;
    const restoreRun = confluence.uploadRestoreRun;
    return () => {
      backupRun.current += 1;
      restoreRun.current += 1;
      for (const stop of [...renewalStops]) stop();
    };
  }, [restore.uploadBackupRun, confluence.uploadRestoreRun]);

  // Navigation and beforeunload guards for active uploads and portable jobs.
  useEffect(() => {
    const confluenceUploadActiveRef = confluence.uploadActiveRef;
    const wikihubRestoreUploadActiveRef = restore.restoreUploadActiveRef;
    const confirmNavigation = (event: MouseEvent) => {
      if (
        (!confluenceUploadActiveRef.current &&
          !wikihubRestoreUploadActiveRef.current &&
          !exportActiveRef.current) ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const link = (event.target as Element | null)?.closest<HTMLAnchorElement>(
        "a[href]",
      );
      if (!link || link.target || link.hasAttribute("download")) return;
      const target = new URL(link.href, window.location.href);
      if (target.href === window.location.href || target.hash) return;
      event.preventDefault();
      event.stopPropagation();
      if (
        confluenceUploadActiveRef.current ||
        wikihubRestoreUploadActiveRef.current
      ) {
        setLeaveTarget(target.href);
      } else {
        setExportLeaveTarget(target.pathname + target.search);
      }
    };
    const confirmUnload = (event: BeforeUnloadEvent) => {
      if (
        (!confluenceUploadActiveRef.current &&
          !wikihubRestoreUploadActiveRef.current &&
          !exportActiveRef.current) ||
        allowConfirmedLeaveRef.current
      ) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("click", confirmNavigation, true);
    window.addEventListener("beforeunload", confirmUnload);
    return () => {
      document.removeEventListener("click", confirmNavigation, true);
      window.removeEventListener("beforeunload", confirmUnload);
    };
  }, [confluence.uploadActiveRef, restore.restoreUploadActiveRef]);

  // Load site settings on mount
  useEffect(() => {
    void apiFetch<SiteSettings>("/api/v1/settings")
      .then((settings) => setSiteSettings(settings))
      .catch(() => {});
  }, []);

  async function loadAllSpacesClient(): Promise<Space[]> {
    const spaces: Space[] = [];
    const limit = 200;
    let offset = 0;
    while (true) {
      const batch = await apiFetch<Space[]>(
        `/api/v1/spaces?include_archived=true&limit=${limit}&offset=${offset}`,
      );
      spaces.push(...batch);
      if (batch.length < limit) return spaces;
      offset += batch.length;
    }
  }

  useEffect(() => {
    if (!isExportSpacePickerOpen || availableSpaces !== null) return;
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch the live space list the first time the export picker opens
    setIsLoadingAvailableSpaces(true);
    void loadAllSpacesClient()
      .then((spaces) => {
        if (active) setAvailableSpaces(spaces);
      })
      .catch((err) => {
        if (active) {
          toast.error(
            err instanceof Error ? err.message : "Could not load spaces.",
          );
        }
      })
      .finally(() => {
        if (active) setIsLoadingAvailableSpaces(false);
      });
    return () => {
      active = false;
    };
  }, [isExportSpacePickerOpen, availableSpaces]);

  function triggerBrowserDownload(url: string, filename: string) {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  async function createPortableExport(
    kind: "full_export" | "confluence_export",
  ) {
    if (isDownloading) return;
    if (kind === "confluence_export" && !backupFeatures.confluenceExport) return;
    setIsDownloading(true);
    try {
      const job = await apiFetch<PortableBackupJob>("/api/v1/backup/jobs", {
        method: "POST",
        body: {
          kind,
          include_credentials: kind === "full_export" && includeCredentials,
          confluence_profile:
            kind === "confluence_export" ? confluenceExportProfile : null,
          space_keys:
            kind === "full_export"
              ? exportSpaceScope === "all"
                ? []
                : exportSelectedSpaceKeys
              : [],
        },
      });
      setPortableBackupJob(job);
      if (kind === "full_export") setIsExportOptionsOpen(false);
      toast.success("Backup export queued. It will continue in the background.");
    } catch (downloadError) {
      toast.error(
        errorMessage(downloadError, "Could not download the backup."),
      );
    } finally {
      setIsDownloading(false);
    }
  }

  async function cancelPortableExport() {
    if (!portableBackupJob) return;
    setCancelExportPending(true);
    try {
      const cancelled = await apiFetch<PortableBackupJob>(
        `/api/v1/backup/jobs/${portableBackupJob.id}/cancel`,
        { method: "POST" },
      );
      setPortableBackupJob(cancelled);
      const isRestore = cancelled.kind === "full_import";
      toast.success(
        cancelled.status === "cancelled"
          ? `${isRestore ? "Restore" : "Export"} cancelled.`
          : "Cancellation requested.",
      );
    } catch (cancelError) {
      toast.error(
        errorMessage(
          cancelError,
          `Could not cancel the ${portableBackupJob.kind === "full_import" ? "restore" : "export"}.`,
        ),
      );
    } finally {
      setCancelExportPending(false);
      setConfirmCancelExport(false);
    }
  }

  // Poll active portable export/restore job
  useEffect(() => {
    if (
      !portableBackupJob ||
      ["complete", "failed", "cancelled"].includes(portableBackupJob.status)
    ) {
      return;
    }
    const timer = window.setInterval(async () => {
      try {
        const job = await apiFetch<PortableBackupJob>(
          `/api/v1/backup/jobs/${portableBackupJob.id}`,
        );
        setPortableBackupJob(job);
        const isRestore = job.kind === "full_import";
        if (isRestore) await restore.loadRestoreJobLogs(job.id);
        if (job.status === "complete") {
          if (isRestore) {
            if (settledRestoreJobIdRef.current === job.id) return;
            settledRestoreJobIdRef.current = job.id;
            const conflicts = job.result?.conflicting_space_keys ?? [];
            router.refresh();
            restore.setConflictingImportSpaceKeys(conflicts);
            restore.setRestoreSuccessReport(job.result ?? null);
            restore.setIsRestoreSuccessModalOpen(true);
            toast.success(
              conflicts.length > 0
                ? `Restore is complete. ${conflicts.length} ${conflicts.length === 1 ? "space that" : "spaces that"} already existed ${conflicts.length === 1 ? "was" : "were"} skipped.`
                : "Restore is complete. The backup was applied.",
            );
          } else {
            toast.success("Backup export is ready to download.");
            if (
              job.download_url &&
              job.output_filename &&
              autoDownloadedJobIdRef.current !== job.id
            ) {
              autoDownloadedJobIdRef.current = job.id;
              triggerBrowserDownload(job.download_url, job.output_filename);
            }
          }
        }
        if (job.status === "failed") {
          toast.error(
            job.error ??
              (isRestore ? "Restore failed." : "Backup export failed."),
          );
        }
        if (job.status === "cancelled") {
          toast(
            isRestore ? "Restore was cancelled." : "Export was cancelled.",
          );
        }
      } catch {
        // Keep polling on a transient request failure.
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [
    portableBackupJob,
    router,
    restore.loadRestoreJobLogs,
    restore.setConflictingImportSpaceKeys,
    restore.setRestoreSuccessReport,
    restore.setIsRestoreSuccessModalOpen,
  ]);

  const restorePortableBackupJob = useCallback(async () => {
    try {
      const jobs = await apiFetch<PortableBackupJob[]>("/api/v1/backup/jobs");
      const activeJob = jobs.find(
        (job) =>
          (job.status === "queued" || job.status === "running") &&
          !job.automated,
      );
      setPortableBackupJob((current) => {
        if (!activeJob) {
          if (
            current?.status === "cancelled" ||
            current?.status === "failed"
          ) {
            return null;
          }
          return current;
        }
        if (current?.id === activeJob.id) return current;
        setActiveSection(
          activeJob.kind === "full_import" ? "import" : "export",
        );
        return activeJob;
      });
      if (activeJob?.kind === "full_import") {
        await restore.loadRestoreJobLogs(activeJob.id);
      }
    } catch {
      // Ignore active job fetch errors on restore
    }
  }, [restore.loadRestoreJobLogs]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore persisted server state on mount
    void restorePortableBackupJob();
  }, [restorePortableBackupJob]);

  // Restore on mount, focus, pageshow, storage, and visibilitychange.
  useEffect(() => {
    const restoreAll = () => {
      void confluence.restoreStoredConfluenceUpload();
      void confluence.restoreActiveConfluenceJob();
      void restorePortableBackupJob();
      void restore.restoreActiveBackupArchive();
    };
    const initialRestore = window.setTimeout(restoreAll, 0);
    const restoreWhenVisible = () => {
      if (document.visibilityState === "visible") restoreAll();
    };
    const restoreFromStorage = (event: StorageEvent) => {
      if (event.key === CONFLUENCE_UPLOAD_METADATA_KEY) restoreAll();
    };
    window.addEventListener("focus", restoreAll);
    window.addEventListener("pageshow", restoreAll);
    window.addEventListener("storage", restoreFromStorage);
    document.addEventListener("visibilitychange", restoreWhenVisible);
    const uploadRestoreRunRef = confluence.uploadRestoreRun;
    const uploadPauseReasonRef = confluence.uploadPauseReason;
    const confluenceUploadReqRef = confluence.confluenceUploadRequest;
    const confluenceHashAbortRef = confluence.confluenceHashAbort;
    return () => {
      uploadRestoreRunRef.current += 1;
      uploadPauseReasonRef.current = "pause";
      confluenceUploadReqRef.current?.abort();
      confluenceHashAbortRef.current?.abort();
      window.clearTimeout(initialRestore);
      window.removeEventListener("focus", restoreAll);
      window.removeEventListener("pageshow", restoreAll);
      window.removeEventListener("storage", restoreFromStorage);
      document.removeEventListener("visibilitychange", restoreWhenVisible);
    };
  }, [
    confluence.restoreStoredConfluenceUpload,
    confluence.restoreActiveConfluenceJob,
    confluence.uploadRestoreRun,
    confluence.uploadPauseReason,
    confluence.confluenceUploadRequest,
    confluence.confluenceHashAbort,
    restorePortableBackupJob,
    restore.restoreActiveBackupArchive,
  ]);

  function leaveWhileUploading() {
    if (!leaveTarget) return;
    allowConfirmedLeaveRef.current = true;
    if (confluence.uploadActiveRef.current) {
      confluence.cancelConfluenceUpload("pause");
    }
    if (restore.restoreUploadActiveRef.current) {
      restore.pauseBackupArchiveUpload();
    }
    window.location.assign(leaveTarget);
  }

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
      {/* Sidebar */}
      <aside
        aria-label="Backup sections"
        className="border-border border-r pr-5 lg:sticky lg:top-24"
      >
        <p className="text-muted-foreground px-2 text-[10px] font-semibold tracking-[0.08em] uppercase">
          Backup sections
        </p>
        <div className="mt-3 space-y-1">
          {BACKUP_SECTIONS.map(({ id, label, icon: Icon }) => {
            const selected = activeSection === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveSection(id)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected
                    ? "bg-surface-selected text-primary font-semibold hover:bg-surface-hover"
                    : "text-muted-foreground font-normal hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </button>
            );
          })}
        </div>
      </aside>

      {/* Main content */}
      <div className="min-w-0 space-y-6">
        <ExportSection
          visible={activeSection === "export"}
          isDownloading={isDownloading}
          isPortableJobRunning={isPortableJobRunning}
          isFullExportRunning={isFullExportRunning}
          isConfluenceExportRunning={isConfluenceExportRunning}
          confluenceExportProfile={confluenceExportProfile}
          setConfluenceExportProfile={setConfluenceExportProfile}
          includeCredentials={includeCredentials}
          setIncludeCredentials={setIncludeCredentials}
          exportSpaceScope={exportSpaceScope}
          setExportSpaceScope={setExportSpaceScope}
          exportSelectedSpaceKeys={exportSelectedSpaceKeys}
          isExportOptionsOpen={isExportOptionsOpen}
          setIsExportOptionsOpen={setIsExportOptionsOpen}
          onOpenExportSpacePicker={() => setIsExportSpacePickerOpen(true)}
          onCreatePortableExport={createPortableExport}
          portableBackupJob={portableBackupJob}
          cancelExportPending={cancelExportPending}
          onRequestCancelExport={() => setConfirmCancelExport(true)}
          restoreLogEntries={restore.restoreLogEntries}
          restoreLogsExpanded={restore.restoreLogsExpanded}
          onRestoreLogsExpandedChange={restore.setRestoreLogsExpanded}
          restoreLogsListRef={restore.restoreLogsListRef}
        />

        <AutomatedBackupsSection visible={activeSection === "export"} />

        <ImportSection
          visible={activeSection === "import"}
          siteSettings={siteSettings}
          portableBackupJob={portableBackupJob}
          isPortableJobRunning={isPortableJobRunning}
          cancelExportPending={cancelExportPending}
          onRequestCancelPortableJob={() => setConfirmCancelExport(true)}
          restoreLockedByConfluence={restoreLockedByConfluence}
          confluenceLockedByRestore={confluenceLockedByRestore}
          restoreInputsLocked={restoreInputsLocked}
          restore={restore}
          confluence={confluence}
          restoreFileInputRef={restore.fileInput}
          restoreLogsListRef={restore.restoreLogsListRef}
          confluenceFileInputRef={confluence.confluenceFileInput}
          confluenceLogsListRef={confluence.logsListRef}
        />

        <ExportSpacePickerDialog
          open={isExportSpacePickerOpen}
          onOpenChange={setIsExportSpacePickerOpen}
          availableSpaces={availableSpaces}
          isLoadingAvailableSpaces={isLoadingAvailableSpaces}
          exportSpaceFilter={exportSpaceFilter}
          setExportSpaceFilter={setExportSpaceFilter}
          exportSelectedSpaceKeys={exportSelectedSpaceKeys}
          setExportSelectedSpaceKeys={setExportSelectedSpaceKeys}
        />

        <ImportSpacePickerDialog
          open={restore.isImportSpacePickerOpen}
          onOpenChange={restore.setIsImportSpacePickerOpen}
          backupArchive={restore.backupArchive}
          importSpaceFilter={restore.importSpaceFilter}
          setImportSpaceFilter={restore.setImportSpaceFilter}
          importSelectedSpaceKeys={restore.importSelectedSpaceKeys}
          setImportSelectedSpaceKeys={restore.setImportSelectedSpaceKeys}
          restoreInputsLocked={restoreInputsLocked}
          pending={restore.pending}
          onRequestImportRestore={restore.requestImportRestore}
        />

        <ConfluenceSpacePickerDialog
          open={confluence.isSpaceModalOpen}
          onOpenChange={confluence.setIsSpaceModalOpen}
          confluenceArchive={confluence.confluenceArchive}
          spaceFilter={confluence.spaceFilter}
          setSpaceFilter={confluence.setSpaceFilter}
          selectedSpaces={confluence.selectedSpaces}
          setSelectedSpaces={confluence.setSelectedSpaces}
          importAllSpaces={confluence.importAllSpaces}
          setImportAllSpaces={confluence.setImportAllSpaces}
          importInProgress={confluence.importInProgress}
          confluencePending={confluence.confluencePending}
          onRequestConfluenceImport={confluence.requestConfluenceImport}
        />

        <ImportCompletedDialog
          open={confluence.isImportSuccessModalOpen}
          onOpenChange={confluence.setIsImportSuccessModalOpen}
          title="Import Completed Successfully"
          description="All selected spaces from your Confluence backup have been successfully imported."
          summaryLabel="What was imported"
          counts={confluence.importSuccessCounts}
          emptyLabel="Nothing new - every record in the archive already existed."
          question="Do you want to import another Confluence archive, or close and continue?"
          confirmLabel="Yes, import another"
          onConfirm={confluence.resetAfterImportSuccess}
        />

        <MismatchedResumeFileDialog
          mismatchedResumeFile={restore.mismatchedResumeFile}
          onDismiss={() => restore.setMismatchedResumeFile(null)}
          pendingRestoreUpload={restore.pendingRestoreUpload}
          pendingRestoreUploadedBytes={restore.pendingRestoreUploadedBytes}
          onUploadMismatchedFileInstead={restore.uploadMismatchedFileInstead}
          onReselectFileForResume={restore.reselectFileForResume}
        />

        <ImportCompletedDialog
          open={restore.isRestoreSuccessModalOpen}
          onOpenChange={restore.setIsRestoreSuccessModalOpen}
          title="Restore Completed Successfully"
          description="The WikiHub backup has been restored into this instance."
          summaryLabel="What was restored"
          counts={restore.restoreSuccessReport?.created ?? null}
          emptyLabel="Nothing new - every record in the backup already existed."
          notice={
            restore.conflictingImportSpaceKeys.length > 0 ? (
              <div className="border-warning/30 bg-warning-bg rounded-md border p-3 text-xs">
                <div className="flex gap-2.5">
                  <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-foreground font-medium">
                      {restore.conflictingImportSpaceKeys.length}{" "}
                      {restore.conflictingImportSpaceKeys.length === 1
                        ? "space already existed and was"
                        : "spaces already existed and were"}{" "}
                      left untouched
                    </p>
                    <p className="text-muted-foreground mt-1 break-words">
                      {restore.conflictingImportSpaceKeys
                        .slice(0, 8)
                        .join(", ")}
                      {restore.conflictingImportSpaceKeys.length > 8
                        ? ` and ${restore.conflictingImportSpaceKeys.length - 8} more`
                        : ""}
                    </p>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2.5"
                  onClick={() => {
                    restore.setIsRestoreSuccessModalOpen(false);
                    restore.setConfirmOverwriteImportSpaces(true);
                  }}
                >
                  Replace them with the archive&apos;s version
                </Button>
              </div>
            ) : null
          }
          question={
            restore.backupArchive
              ? "Do you want to restore more spaces from this backup, or close and continue?"
              : "Do you want to restore another backup, or close and continue?"
          }
          confirmLabel={
            restore.backupArchive
              ? "Yes, choose more spaces"
              : "Yes, restore another"
          }
          onConfirm={() => void restore.restoreMoreFromSameArchive()}
        />

        <ConfirmDialog
          open={leaveTarget !== null}
          onOpenChange={(open) => {
            if (!open) setLeaveTarget(null);
          }}
          title="Pause this upload and leave?"
          description={
            confluence.confluencePending
              ? "The current part will stop. Completed parts and your selected archive stay on this device, so you can resume the upload from this page later."
              : "The current part will stop. Everything uploaded so far stays in storage, so you can select the same file on this page later and carry on from where it stopped."
          }
          confirmLabel="Pause and leave"
          onConfirm={leaveWhileUploading}
        />
        <ConfirmDialog
          open={confluence.confirmCancelUpload}
          onOpenChange={confluence.setConfirmCancelUpload}
          title="Cancel this upload?"
          description="This discards the uploaded parts and removes the saved archive from this browser. You will need to select the file and start again."
          confirmLabel="Cancel upload"
          destructive
          pending={confluence.cancelUploadPending}
          onConfirm={() => void confluence.abandonConfluenceUpload()}
        />
        <ConfirmDialog
          open={confluence.confirmOverwriteSpaces}
          onOpenChange={confluence.setConfirmOverwriteSpaces}
          title="Replace existing spaces?"
          description={`This will permanently replace ${confluence.conflictingSelectedSpaces.length} existing ${confluence.conflictingSelectedSpaces.length === 1 ? "space" : "spaces"}: ${confluence.overwriteSpaceSummary}. Their current pages and memberships will be deleted before the archive version is imported.`}
          confirmLabel="Replace and import"
          destructive
          pending={confluence.confluencePending}
          onConfirm={() => void confluence.startConfluenceImport(true)}
        />
        <ConfirmDialog
          open={restore.confirmOverwriteImportSpaces}
          onOpenChange={restore.setConfirmOverwriteImportSpaces}
          title="Replace existing spaces?"
          description={`This will permanently replace ${restore.conflictingImportSpaceKeys.length} existing ${restore.conflictingImportSpaceKeys.length === 1 ? "space" : "spaces"}: ${restore.overwriteImportSpaceKeysSummary}. Their current pages and attachments will be deleted before the archive version is restored. Space membership and permissions are kept either way.`}
          confirmLabel="Replace and restore"
          destructive
          pending={restore.pending === "apply"}
          onConfirm={() => {
            restore.setIsImportSpacePickerOpen(false);
            void restore.submitImport(restore.conflictingImportSpaceKeys);
          }}
        />
        <ConfirmDialog
          open={confluence.confirmDiscardArchive}
          onOpenChange={confluence.setConfirmDiscardArchive}
          title="Cancel this import?"
          description="This will permanently delete the uploaded and scanned archive from the server. If you decide to import it later, you will need to re-upload the entire archive file, which will take time."
          confirmLabel="Yes, cancel import"
          destructive
          pending={confluence.discardingArchivePending}
          onConfirm={() => void confluence.discardConfluenceArchive()}
        />
        <ConfirmDialog
          open={restore.confirmDiscardBackupArchive}
          onOpenChange={restore.setConfirmDiscardBackupArchive}
          title="Cancel this restore?"
          description="This clears the space selection and stops offering the backup for restore. The uploaded file itself stays in object storage, so choosing it again picks up without re-uploading - delete it under Administration > Object storage once you no longer need it."
          confirmLabel="Cancel restore"
          destructive
          onConfirm={restore.discardBackupArchive}
        />
        <ConfirmDialog
          open={restore.confirmCancelBackupUpload}
          onOpenChange={restore.setConfirmCancelBackupUpload}
          title="Cancel this upload?"
          description="This discards the uploaded parts and the selected file. You will need to select the file and start again."
          confirmLabel="Cancel upload"
          destructive
          pending={restore.cancelBackupUploadPending}
          onConfirm={() => void restore.cancelBackupArchiveUpload()}
        />
        <ConfirmDialog
          open={confirmCancelExport}
          onOpenChange={setConfirmCancelExport}
          title={`Cancel this ${portableBackupJob?.kind === "full_import" ? "restore" : "export"}?`}
          description={
            portableBackupJob?.kind === "full_import"
              ? "The restore in progress will stop. Any spaces it already applied are kept; nothing further will be written."
              : "The export in progress will stop and its partial file will be discarded."
          }
          confirmLabel={`Cancel ${portableBackupJob?.kind === "full_import" ? "restore" : "export"}`}
          destructive
          pending={cancelExportPending}
          onConfirm={() => void cancelPortableExport()}
        />
        <ConfirmDialog
          open={exportLeaveTarget !== null}
          onOpenChange={(open) => {
            if (!open) setExportLeaveTarget(null);
          }}
          title={`${portableBackupJob?.kind === "full_import" ? "Restore" : "Export"} is still running`}
          description={`Leaving this page won't stop it — the ${portableBackupJob?.kind === "full_import" ? "restore" : "export"} keeps running on the server and you can come back anytime to check progress${portableBackupJob?.kind === "full_import" ? "" : " or download the file"}. Prefer to stop it instead?`}
          confirmLabel="Leave, keep running"
          cancelLabel="Stay"
          secondaryLabel={`Cancel ${portableBackupJob?.kind === "full_import" ? "restore" : "export"}`}
          onSecondary={() => {
            setExportLeaveTarget(null);
            setConfirmCancelExport(true);
          }}
          onConfirm={() => {
            const target = exportLeaveTarget;
            setExportLeaveTarget(null);
            if (target) router.push(target);
          }}
        />
      </div>
    </div>
  );
}
