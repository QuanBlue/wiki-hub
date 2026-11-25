"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { formatBytes } from "@/components/ui/job-progress";
import { formatLogTime } from "@/components/ui/log-disclosure";
import { ApiError, apiFetch } from "@/lib/api-client";
import type { ArchiveFormat } from "@/lib/archive-format";
import type {
  ConfluenceArchive,
  ConfluenceImportJob,
  ConfluenceImportLog,
  ConfluenceUploadProgress,
  ConfluenceUploadTarget,
  SiteSettings,
} from "@/types/api";
import {
  clearStoredUpload,
  fileMatchesStoredUpload,
  forgetCancelledUpload,
  readCancelledUploadIds,
  readStoredUpload,
  rememberCancelledUpload,
  saveStoredUpload,
  serverUploadToStoredUpload,
} from "./confluence-storage";
import { sha256File } from "./sha256";
import {
  SESSION_EXPIRED_UPLOAD_MESSAGE,
  errorMessage,
  type HashStats,
  type JobLogEntry,
  type StoredConfluenceUpload,
  type UploadStats,
} from "./types";

export function useConfluenceImport({
  siteSettings,
  setSiteSettings,
  renewUploadSession,
  startUploadSessionRenewal,
  rejectWrongArchiveFormat,
}: {
  siteSettings: SiteSettings | null;
  setSiteSettings: (settings: SiteSettings) => void;
  renewUploadSession: () => Promise<void>;
  startUploadSessionRenewal: (runRenewal: () => void) => () => void;
  rejectWrongArchiveFormat: (
    candidate: File,
    expected: ArchiveFormat,
    reject: (message: string) => void,
  ) => Promise<void>;
}) {
  const confluenceFileInput = useRef<HTMLInputElement>(null);
  const confluenceUploadRequest = useRef<XMLHttpRequest | null>(null);
  const confluenceHashAbort = useRef<AbortController | null>(null);
  const uploadPauseReason = useRef<
    "pause" | "cancel" | "session-expired" | null
  >(null);
  const uploadRestoreRun = useRef(0);
  const storedConfluenceUploadRef = useRef<StoredConfluenceUpload | null>(null);
  const uploadActiveRef = useRef(false);
  const logsListRef = useRef<HTMLUListElement>(null);

  const [confluenceFile, setConfluenceFile] = useState<File | null>(null);
  const [storedConfluenceUpload, setStoredConfluenceUpload] =
    useState<StoredConfluenceUpload | null>(null);
  const [confluenceArchive, setConfluenceArchive] =
    useState<ConfluenceArchive | null>(null);
  const [confluenceJob, setConfluenceJob] =
    useState<ConfluenceImportJob | null>(null);
  const [confluenceCancelPending, setConfluenceCancelPending] = useState(false);
  const [confluenceLogsExpanded, setConfluenceLogsExpanded] = useState(true);
  const [confluenceLogs, setConfluenceLogs] = useState<ConfluenceImportLog[]>(
    [],
  );
  const [preparationLogs, setPreparationLogs] = useState<string[]>([]);
  const [preparationLogsExpanded, setPreparationLogsExpanded] = useState(true);
  const [selectedSpaces, setSelectedSpaces] = useState<string[]>([]);
  const [importAllSpaces, setImportAllSpaces] = useState(false);
  const [spaceFilter, setSpaceFilter] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadStats, setUploadStats] = useState<UploadStats | null>(null);
  const [hashStats, setHashStats] = useState<HashStats | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [confluencePending, setConfluencePending] = useState(false);
  const [confirmDiscardArchive, setConfirmDiscardArchive] = useState(false);
  const [discardingArchivePending, setDiscardingArchivePending] =
    useState(false);
  const [confirmCancelUpload, setConfirmCancelUpload] = useState(false);
  const [confirmOverwriteSpaces, setConfirmOverwriteSpaces] = useState(false);
  const [cancelUploadPending, setCancelUploadPending] = useState(false);
  const [confluenceUploadError, setConfluenceUploadError] = useState<
    string | null
  >(null);
  const [isSpaceModalOpen, setIsSpaceModalOpen] = useState(false);
  const [isImportSuccessModalOpen, setIsImportSuccessModalOpen] =
    useState(false);
  const [importSuccessCounts, setImportSuccessCounts] = useState<Record<
    string,
    number
  > | null>(null);

  // Modal is opened explicitly by the user clicking "Select spaces & import".
  // Closing happens when a job starts or the archive is discarded.
  useEffect(() => {
    if (confluenceJob || !confluenceArchive) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- close a user-opened modal when its source job/archive disappears
      setIsSpaceModalOpen(false);
    }
  }, [confluenceArchive, confluenceJob]);

  const selectedImportKeys = importAllSpaces
    ? (confluenceArchive?.spaces.map((space) => space.key) ?? [])
    : selectedSpaces;
  const conflictingSelectedSpaces =
    confluenceArchive?.spaces.filter(
      (space) => space.conflict && selectedImportKeys.includes(space.key),
    ) ?? [];
  const overwriteSpaceSummary = [
    ...conflictingSelectedSpaces.slice(0, 8).map((space) => space.key),
    ...(conflictingSelectedSpaces.length > 8
      ? [`and ${conflictingSelectedSpaces.length - 8} more`]
      : []),
  ].join(", ");
  const confluenceArchiveName =
    storedConfluenceUpload?.fileName ?? confluenceFile?.name ?? null;

  const displayConfluenceLogs = useMemo(() => {
    const result: ConfluenceImportLog[] = [];
    let foundDownloadLog = false;
    for (const log of confluenceLogs) {
      if (
        log.message.startsWith("Downloading archive to worker scratch space:")
      ) {
        if (!foundDownloadLog) {
          result.push(log);
          foundDownloadLog = true;
        }
      } else {
        result.push(log);
      }
    }
    return result.reverse();
  }, [confluenceLogs]);

  useEffect(() => {
    if (logsListRef.current) {
      logsListRef.current.scrollTop = logsListRef.current.scrollHeight;
    }
  }, [displayConfluenceLogs]);

  const confluenceArchiveSize =
    storedConfluenceUpload?.fileSize ?? confluenceFile?.size ?? 0;
  const storedUploadNeedsFile = Boolean(
    storedConfluenceUpload && !storedConfluenceUpload.file,
  );
  const canResumeStoredUpload = Boolean(storedConfluenceUpload?.file);
  const isHashingArchive = Boolean(confluencePending && hashStats);
  const isFinalizingArchive =
    confluencePending &&
    !isUploading &&
    !confluenceArchive &&
    !isHashingArchive &&
    uploadProgress === 100;
  const importInProgress = Boolean(
    confluenceJob &&
    !["completed", "failed", "cancelled"].includes(confluenceJob.status),
  );
  const confluenceFlowActive = Boolean(
    confluencePending ||
      isUploading ||
      confluenceArchive ||
      importInProgress ||
      // Paused, or waiting for the file to be handed back so it can resume.
      storedConfluenceUpload,
  );

  const jobSpacesTotal = confluenceJob?.counters.spaces_total ?? 0;
  const jobSpacesCompleted = confluenceJob?.counters.spaces_completed ?? 0;
  const jobAttachmentsTotal = confluenceJob?.counters.attachments_total ?? 0;
  const jobAttachmentsProcessed =
    confluenceJob?.counters.attachments_processed ?? 0;
  const jobDownloadPercent = Math.min(
    100,
    confluenceJob?.counters.download_percent ?? 0,
  );
  const displayedDownloadPercent =
    confluenceJob?.status === "completed" ? 100 : jobDownloadPercent;
  const jobSpacePercent = Math.min(
    100,
    (jobSpacesCompleted / Math.max(1, jobSpacesTotal)) * 100,
  );
  const jobAttachmentPercent =
    jobAttachmentsTotal > 0
      ? Math.min(
          100,
          (jobAttachmentsProcessed / Math.max(1, jobAttachmentsTotal)) * 100,
        )
      : 100;
  const jobProgressPercent = !confluenceJob
    ? 0
    : confluenceJob.status === "completed" ||
        confluenceJob.status === "cancelled"
      ? 100
      : confluenceJob.status === "queued"
        ? 0
        : confluenceJob.phase === "downloading"
          ? jobDownloadPercent
          : confluenceJob.phase === "scanning"
            ? 10
            : confluenceJob.phase === "importing"
              ? Math.min(85, 10 + Math.round(jobSpacePercent * 0.75))
              : confluenceJob.phase === "attachments"
                ? Math.min(99, 85 + Math.round(jobAttachmentPercent * 0.14))
                : confluenceJob.phase === "comments"
                  ? 99
                  : jobSpacePercent;
  const jobTitle = !confluenceJob
    ? ""
    : confluenceJob.status === "completed"
      ? "Import complete"
      : confluenceJob.status === "failed"
        ? "Import failed"
        : confluenceJob.status === "cancelled"
          ? "Import cancelled"
          : confluenceJob.phase === "downloading"
            ? "Downloading archive"
            : confluenceJob.phase === "scanning"
              ? "Scanning archive"
              : confluenceJob.phase === "importing"
                ? "Importing spaces and pages"
                : confluenceJob.phase === "attachments"
                  ? "Importing and linking attachments"
                  : confluenceJob.phase === "comments"
                    ? "Importing comments and likes"
                    : "Import running";
  const jobPagesSummary = confluenceJob?.counters.pages_total
    ? `${confluenceJob.counters.pages_processed ?? 0}/${confluenceJob.counters.pages_total} pages`
    : `${confluenceJob?.counters.pages_processed ?? 0} pages`;
  const confluenceActivityLogs: JobLogEntry[] = displayConfluenceLogs.map(
    (log) => ({
      id: log.id,
      time: formatLogTime(new Date(log.created_at)),
      level: log.level,
      label: log.entity_label,
      message:
        log.phase === "downloading" && !log.message.includes("%")
          ? `${log.message} (${displayedDownloadPercent}%)`
          : log.message,
    }),
  );

  const appendPreparationLog = useCallback((message: string) => {
    const time = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date());
    setPreparationLogs((current) => [...current, `${time} - ${message}`]);
  }, []);

  // CRITICAL AGENTS.md rule: Keep uploadActiveRef synced with confluencePending
  // so navigation & beforeunload warnings trigger during hashing, uploading, and scan finalization.
  useEffect(() => {
    uploadActiveRef.current = confluencePending;
  }, [confluencePending]);

  useEffect(() => {
    storedConfluenceUploadRef.current = storedConfluenceUpload;
  }, [storedConfluenceUpload]);

  // Poll active Confluence import job
  useEffect(() => {
    if (
      !confluenceJob ||
      ["completed", "failed", "cancelled"].includes(confluenceJob.status)
    )
      return;
    const timer = window.setInterval(async () => {
      try {
        const [job, logs] = await Promise.all([
          apiFetch<ConfluenceImportJob>(
            `/api/v1/confluence-imports/jobs/${confluenceJob.id}`,
          ),
          apiFetch<{ items: ConfluenceImportLog[] }>(
            `/api/v1/confluence-imports/jobs/${confluenceJob.id}/logs`,
          ),
        ]);
        let finalLogs = logs.items;
        if (
          job.status === "completed" &&
          confluenceJob.status !== "completed"
        ) {
          toast.success("Confluence import completed successfully!");
          const successLog: ConfluenceImportLog = {
            id: "local-success-log",
            level: "info",
            phase: "completed",
            entity_type: null,
            entity_label: null,
            message: "Import completed successfully!",
            created_at: new Date().toISOString(),
          };
          finalLogs = [...finalLogs, successLog];
          setImportSuccessCounts({
            space: job.counters.spaces_completed ?? 0,
            page: job.counters.pages_processed ?? 0,
            attachment: job.counters.attachments_processed ?? 0,
          });
          setIsImportSuccessModalOpen(true);
        }
        setConfluenceJob(job);
        setConfluenceLogs(finalLogs);
      } catch {
        /* next poll reports a recoverable API failure */
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [confluenceJob]);

  const restoreActiveConfluenceJob = useCallback(async () => {
    try {
      const jobs = await apiFetch<ConfluenceImportJob[]>(
        "/api/v1/confluence-imports/jobs",
      );
      const activeJob = jobs.find(
        (job) => !["completed", "failed", "cancelled"].includes(job.status),
      );
      if (activeJob) {
        setConfluenceJob(activeJob);
        try {
          const logs = await apiFetch<{ items: ConfluenceImportLog[] }>(
            `/api/v1/confluence-imports/jobs/${activeJob.id}/logs`,
          );
          setConfluenceLogs(logs.items);
        } catch {
          // Ignore logs fetch error on restore
        }
      } else {
        setConfluenceJob(null);
      }
    } catch {
      // Ignore active job fetch errors on restore
    }
  }, []);

  // Import work is server-side once queued. Restore the most recent active job
  // whenever this panel mounts so navigation and refresh never hide progress.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore persisted server state on mount
    void restoreActiveConfluenceJob();
  }, [restoreActiveConfluenceJob]);

  const restoreStoredConfluenceUpload = useCallback(async () => {
    const run = uploadRestoreRun.current + 1;
    uploadRestoreRun.current = run;
    const stillCurrent = () => uploadRestoreRun.current === run;
    try {
      const cancelledUploadIds = readCancelledUploadIds();
      const localStored = await readStoredUpload();
      const safeLocalStored =
        localStored && !cancelledUploadIds.has(localStored.archiveId)
          ? localStored
          : null;
      if (localStored && !safeLocalStored) {
        await clearStoredUpload();
      }
      const serverUploads = await apiFetch<ConfluenceUploadProgress[]>(
        "/api/v1/confluence-imports/uploads/active",
      );
      if (!stillCurrent()) return;

      // Cross-tab sync: if a scanned archive is waiting for space selection,
      // restore it so the modal opens in every tab, not just the one that did
      // the upload. We only do this when there is no in-progress upload to avoid
      // overwriting a live resumable upload state.
      const scannedUpload = serverUploads.find(
        (u) => u.status === "scanned" && !cancelledUploadIds.has(u.archive_id),
      );
      if (scannedUpload && !safeLocalStored) {
        try {
          const archive = await apiFetch<ConfluenceArchive>(
            `/api/v1/confluence-imports/archives/${scannedUpload.archive_id}`,
          );
          if (!stillCurrent()) return;
          setConfluenceArchive(archive);
          setSelectedSpaces([]);
          setImportAllSpaces(false);
          setStoredConfluenceUpload(null);
          setUploadProgress(null);
          setUploadStats(null);
          setHashStats(null);
          return;
        } catch {
          // If the archive fetch fails, fall through to normal restore logic.
        }
      }

      const candidates = [
        ...(safeLocalStored ? [safeLocalStored] : []),
        ...serverUploads
          .filter((upload) => !cancelledUploadIds.has(upload.archive_id))
          .map(serverUploadToStoredUpload)
          .filter(
            (candidate) => candidate.archiveId !== safeLocalStored?.archiveId,
          ),
      ];
      if (!candidates.length) {
        await clearStoredUpload();
        if (!stillCurrent()) return;
        setStoredConfluenceUpload(null);
        setUploadProgress(null);
        setUploadStats(null);
        setHashStats(null);
        return;
      }
      for (const candidate of candidates) {
        const currentStored = storedConfluenceUploadRef.current;
        const candidateWithFile =
          currentStored?.archiveId === candidate.archiveId &&
          fileMatchesStoredUpload(currentStored.file ?? null, candidate)
            ? { ...candidate, file: currentStored.file }
            : candidate;
        storedConfluenceUploadRef.current = candidateWithFile;
        setStoredConfluenceUpload(candidateWithFile);
        setConfluenceFile(null);
        setConfluenceArchive(null);
        setUploadProgress((current) => current ?? 0);
        setUploadStats((current) => ({
          loaded:
            current?.total === candidateWithFile.fileSize
              ? (current.loaded ?? 0)
              : 0,
          total: candidateWithFile.fileSize,
          bytesPerSecond: 0,
          secondsRemaining: null,
        }));
        let progress: ConfluenceUploadProgress;
        try {
          progress = await apiFetch<ConfluenceUploadProgress>(
            `/api/v1/confluence-imports/archives/${candidateWithFile.archiveId}/upload`,
          );
        } catch (candidateError) {
          if (
            candidateError instanceof ApiError &&
            candidateError.status === 404 &&
            candidateWithFile.archiveId === safeLocalStored?.archiveId
          ) {
            await clearStoredUpload();
            continue;
          }
          throw candidateError;
        }
        if (!stillCurrent()) return;
        if (progress.status === "uploaded") {
          setPreparationLogs([]);
          setPreparationLogsExpanded(true);
          appendPreparationLog(
            "Upload was already complete. Scanning archive.",
          );
          const archive = await apiFetch<ConfluenceArchive>(
            `/api/v1/confluence-imports/archives/${candidateWithFile.archiveId}/scan`,
            { method: "POST" },
          );
          if (!stillCurrent()) return;
          appendPreparationLog("Archive scan completed. Spaces are ready.");
          await clearStoredUpload();
          setConfluenceArchive(archive);
          setSelectedSpaces([]);
          setImportAllSpaces(false);
          return;
        }
        if (progress.status === "scanned") {
          setPreparationLogs([]);
          setPreparationLogsExpanded(true);
          appendPreparationLog(
            "Archive was already scanned. Spaces are ready.",
          );
          const archive = await apiFetch<ConfluenceArchive>(
            `/api/v1/confluence-imports/archives/${candidateWithFile.archiveId}`,
          );
          if (!stillCurrent()) return;
          await clearStoredUpload();
          setConfluenceArchive(archive);
          setSelectedSpaces([]);
          setImportAllSpaces(false);
          return;
        }
        if (progress.status !== "uploading") {
          if (candidateWithFile.archiveId === safeLocalStored?.archiveId) {
            await clearStoredUpload();
          }
          continue;
        }
        const stored = {
          ...candidateWithFile,
          fileName: progress.filename,
          fileSize: progress.size_bytes,
          sha256: progress.sha256,
          partSize: progress.part_size_bytes,
        };
        if (
          !safeLocalStored ||
          stored.archiveId !== safeLocalStored.archiveId
        ) {
          await saveStoredUpload(stored);
        }
        if (!stillCurrent()) return;
        storedConfluenceUploadRef.current = stored;
        setStoredConfluenceUpload(stored);
        const uploadedBytes = progress.uploaded_parts.reduce(
          (total, part) =>
            total +
            Math.min(
              stored.partSize,
              stored.fileSize - (part - 1) * stored.partSize,
            ),
          0,
        );
        setUploadProgress(Math.round((uploadedBytes / stored.fileSize) * 100));
        setUploadStats({
          loaded: uploadedBytes,
          total: stored.fileSize,
          bytesPerSecond: 0,
          secondsRemaining: null,
        });
        return;
      }
      await clearStoredUpload();
      if (!stillCurrent()) return;
      setStoredConfluenceUpload(null);
      setUploadProgress(null);
      setUploadStats(null);
      setHashStats(null);
    } catch (restoreError) {
      if (restoreError instanceof ApiError && restoreError.status === 404) {
        void clearStoredUpload();
      }
      if (!stillCurrent()) return;
      if (restoreError instanceof ApiError && restoreError.status === 404) {
        setStoredConfluenceUpload(null);
        setUploadProgress(null);
        setUploadStats(null);
        setHashStats(null);
      } else if (
        restoreError instanceof ApiError &&
        restoreError.status === 401
      ) {
        setConfluenceUploadError(SESSION_EXPIRED_UPLOAD_MESSAGE);
      } else {
        setConfluenceUploadError(
          errorMessage(
            restoreError,
            "Could not refresh the saved upload progress. You can still try Resume upload.",
          ),
        );
      }
    }
  }, [appendPreparationLog]);

  async function uploadConfluence(
    resume = false,
    overrideStored?: StoredConfluenceUpload,
  ) {
    const saved = overrideStored ?? (resume ? storedConfluenceUpload : null);
    const selectedFile = saved?.file ?? confluenceFile;
    if (!selectedFile) return;
    // Check file size limit before starting hashing
    let settings = siteSettings;
    if (!settings) {
      try {
        settings = await apiFetch<SiteSettings>("/api/v1/settings");
        setSiteSettings(settings);
      } catch {
        // Ignore fetch errors to let backend handle it
      }
    }
    if (settings?.effective?.max_backup_import_size_bytes) {
      if (selectedFile.size > settings.effective.max_backup_import_size_bytes) {
        setConfluenceUploadError(
          `This archive is ${formatBytes(selectedFile.size)}, which is over the ` +
            `${settings.effective.max_backup_import_size_mb} MB limit set for Confluence ` +
            `imports on this instance. A system administrator can raise it under ` +
            `Admin → Object storage → Quotas → "Max Confluence / Backup Archive (MB)", ` +
            `or you can split the export into smaller per-space archives.`,
        );
        return;
      }
    }

    setConfluencePending(true);
    setConfluenceUploadError(null);
    uploadPauseReason.current = null;
    let stopSessionRenewal: (() => void) | null = null;
    let preparingArchive = false;
    if (!saved) {
      setPreparationLogs([]);
      setPreparationLogsExpanded(true);
    }
    if (!saved || uploadProgress === null) {
      setUploadProgress(0);
      setUploadStats({
        loaded: 0,
        total: selectedFile.size,
        bytesPerSecond: 0,
        secondsRemaining: null,
      });
    }
    const runRenewal = () =>
      void renewUploadSession().catch((renewError) => {
        if (renewError instanceof ApiError && renewError.status === 401) {
          uploadPauseReason.current = "session-expired";
          setConfluenceUploadError(SESSION_EXPIRED_UPLOAD_MESSAGE);
          confluenceUploadRequest.current?.abort();
        }
      });
    try {
      await renewUploadSession();
      stopSessionRenewal = startUploadSessionRenewal(runRenewal);
      const hashAbortController = new AbortController();
      confluenceHashAbort.current = hashAbortController;
      const hashStartedAt = performance.now();
      setHashStats({
        loaded: 0,
        total: selectedFile.size,
        bytesPerSecond: 0,
        secondsRemaining: null,
      });
      appendPreparationLog("Calculating archive fingerprint.");
      const selectedSha256 = await sha256File(
        selectedFile,
        (loaded) => {
          const elapsedSeconds = Math.max(
            (performance.now() - hashStartedAt) / 1000,
            0.001,
          );
          const bytesPerSecond = loaded / elapsedSeconds;
          setHashStats({
            loaded,
            total: selectedFile.size,
            bytesPerSecond,
            secondsRemaining:
              bytesPerSecond > 0
                ? (selectedFile.size - loaded) / bytesPerSecond
                : null,
          });
        },
        hashAbortController.signal,
      );
      confluenceHashAbort.current = null;
      appendPreparationLog(
        `Archive fingerprint ready: ${selectedSha256.slice(0, 12)}...`,
      );
      setHashStats(null);
      const resumeArchive = saved;
      if (resumeArchive?.sha256 && resumeArchive.sha256 !== selectedSha256) {
        setConfluenceUploadError(null);
        toast.error(
          `Select ${resumeArchive.fileName} to resume the paused upload.`,
        );
        setConfluenceFile(null);
        if (confluenceFileInput.current) {
          confluenceFileInput.current.value = "";
        }
        return;
      }
      const resumeProgress = resumeArchive
        ? await apiFetch<ConfluenceUploadProgress>(
            `/api/v1/confluence-imports/archives/${resumeArchive.archiveId}/upload`,
          )
        : null;
      if (
        resumeArchive &&
        resumeProgress?.sha256 &&
        resumeProgress.sha256 !== selectedSha256
      ) {
        setConfluenceUploadError(null);
        toast.error(
          `Select ${resumeArchive.fileName} to resume the paused upload.`,
        );
        setConfluenceFile(null);
        if (confluenceFileInput.current) {
          confluenceFileInput.current.value = "";
        }
        return;
      }
      const target = resumeArchive
        ? {
            archive_id: resumeArchive.archiveId,
            part_size_bytes: resumeArchive.partSize,
            uploaded_parts: resumeProgress?.uploaded_parts ?? [],
            status: resumeProgress?.status ?? "uploading",
            sha256: selectedSha256,
            reused:
              resumeProgress?.status === "uploaded" ||
              resumeProgress?.status === "scanned",
          }
        : await apiFetch<ConfluenceUploadTarget>(
            "/api/v1/confluence-imports/uploads",
            {
              method: "POST",
              body: {
                filename: selectedFile.name,
                size_bytes: selectedFile.size,
                sha256: selectedSha256,
              },
            },
          );
      if (target.reused) {
        setUploadProgress(null);
        setUploadStats(null);
        setHashStats(null);
        setIsUploading(false);
        preparingArchive = true;
        appendPreparationLog(
          "Archive already exists in object storage. Skipping upload.",
        );
        await clearStoredUpload();
        storedConfluenceUploadRef.current = null;
        setStoredConfluenceUpload(null);
        const archive = await apiFetch<ConfluenceArchive>(
          `/api/v1/confluence-imports/archives/${target.archive_id}/scan`,
          { method: "POST" },
        );
        appendPreparationLog("Archive scan completed. Spaces are ready.");
        setConfluenceArchive(archive);
        setSpaceFilter("");
        setSelectedSpaces([]);
        setImportAllSpaces(false);
        setIsSpaceModalOpen(true);
        toast.success("Archive already uploaded. Choose the Spaces to import.");
        return;
      }
      if (!resumeArchive) {
        const nextStored = {
          archiveId: target.archive_id,
          file: selectedFile,
          fileName: selectedFile.name,
          fileSize: selectedFile.size,
          fileLastModified: selectedFile.lastModified,
          sha256: selectedSha256,
          partSize: target.part_size_bytes,
        };
        forgetCancelledUpload(target.archive_id);
        await saveStoredUpload(nextStored);
        storedConfluenceUploadRef.current = nextStored;
        setStoredConfluenceUpload(nextStored);
      }
      setIsUploading(true);
      const partCount = Math.ceil(selectedFile.size / target.part_size_bytes);
      const uploadedParts = new Set(target.uploaded_parts);
      let uploadedBytes = [...uploadedParts].reduce(
        (total, part) =>
          total +
          Math.min(
            target.part_size_bytes,
            selectedFile.size - (part - 1) * target.part_size_bytes,
          ),
        0,
      );
      setUploadProgress(Math.round((uploadedBytes / selectedFile.size) * 100));
      setUploadStats({
        loaded: uploadedBytes,
        total: selectedFile.size,
        bytesPerSecond: 0,
        secondsRemaining: null,
      });
      const startedAt = performance.now();
      for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
        if (uploadedParts.has(partNumber)) continue;
        const urls = await apiFetch<{ urls: Record<string, string> }>(
          `/api/v1/confluence-imports/archives/${target.archive_id}/upload-parts`,
          { method: "POST", body: { part_numbers: [partNumber] } },
        );
        const chunk = selectedFile.slice(
          (partNumber - 1) * target.part_size_bytes,
          partNumber * target.part_size_bytes,
        );
        await new Promise<void>((resolve, reject) => {
          const request = new XMLHttpRequest();
          confluenceUploadRequest.current = request;
          request.open("PUT", urls.urls[String(partNumber)]);
          request.setRequestHeader("Content-Type", "application/zip");
          request.upload.onprogress = (event) => {
            if (!event.lengthComputable) return;
            const elapsedSeconds = Math.max(
              (performance.now() - startedAt) / 1000,
              0.001,
            );
            const loaded = uploadedBytes + event.loaded;
            const bytesPerSecond = loaded / elapsedSeconds;
            setUploadProgress(Math.round((loaded / selectedFile.size) * 100));
            setUploadStats({
              loaded,
              total: selectedFile.size,
              bytesPerSecond,
              secondsRemaining:
                bytesPerSecond > 0
                  ? (selectedFile.size - loaded) / bytesPerSecond
                  : null,
            });
          };
          request.onload = () =>
            request.status >= 200 && request.status < 300
              ? resolve()
              : reject(new Error("MinIO rejected the archive upload."));
          request.onabort = () =>
            reject(new DOMException("Upload cancelled.", "AbortError"));
          request.onerror = () =>
            reject(
              new Error("Could not upload the archive to object storage."),
            );
          request.send(chunk);
        });
        uploadedBytes += chunk.size;
      }
      setUploadProgress(100);
      setUploadStats({
        loaded: selectedFile.size,
        total: selectedFile.size,
        bytesPerSecond: 0,
        secondsRemaining: 0,
      });
      setIsUploading(false);
      preparingArchive = true;
      appendPreparationLog(
        "Upload finished. Completing multipart upload in object storage.",
      );
      await renewUploadSession().catch(() => {});
      await apiFetch(
        `/api/v1/confluence-imports/archives/${target.archive_id}/complete-upload`,
        { method: "POST" },
      );
      appendPreparationLog("Multipart upload completed. Scanning archive.");
      await clearStoredUpload();
      setStoredConfluenceUpload(null);
      await renewUploadSession().catch(() => {});
      const archive = await apiFetch<ConfluenceArchive>(
        `/api/v1/confluence-imports/archives/${target.archive_id}/scan`,
        { method: "POST" },
      );
      appendPreparationLog("Archive scan completed. Spaces are ready.");
      setConfluenceArchive(archive);
      setSpaceFilter("");
      setSelectedSpaces([]);
      setImportAllSpaces(false);
      setIsSpaceModalOpen(true);
      toast.success("Archive scanned. Choose the Spaces to import.");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        if (uploadPauseReason.current === "session-expired") {
          setConfluenceUploadError(SESSION_EXPIRED_UPLOAD_MESSAGE);
          toast.error("Upload paused because your session expired.");
        } else if (uploadPauseReason.current === "cancel") {
          setConfluenceUploadError(null);
        } else {
          toast.info(
            "Upload paused. You can resume it when you return to this page.",
          );
        }
      } else if (err instanceof ApiError && err.status === 401) {
        setConfluenceUploadError(SESSION_EXPIRED_UPLOAD_MESSAGE);
        toast.error("Upload paused because your session expired.");
      } else {
        if (preparingArchive) {
          appendPreparationLog(
            err instanceof ApiError
              ? `Preparation failed: ${err.message}`
              : "Preparation failed.",
          );
        }
        setConfluenceUploadError(
          errorMessage(err, "Could not upload or scan the Confluence archive."),
        );
      }
    } finally {
      stopSessionRenewal?.();
      confluenceUploadRequest.current = null;
      confluenceHashAbort.current = null;
      setHashStats(null);
      setIsUploading(false);
      setConfluencePending(false);
    }
  }

  function cancelConfluenceUpload(reason: "pause" | "cancel" = "pause") {
    uploadPauseReason.current = reason;
    confluenceHashAbort.current?.abort();
    confluenceUploadRequest.current?.abort();
  }

  async function abandonConfluenceUpload() {
    const archiveId = storedConfluenceUpload?.archiveId;
    setCancelUploadPending(true);
    cancelConfluenceUpload("cancel");
    rememberCancelledUpload(archiveId);
    uploadRestoreRun.current += 1;
    setConfirmCancelUpload(false);
    storedConfluenceUploadRef.current = null;
    setStoredConfluenceUpload(null);
    setConfluenceFile(null);
    if (confluenceFileInput.current) {
      confluenceFileInput.current.value = "";
    }
    setConfluenceArchive(null);
    setUploadProgress(null);
    setUploadStats(null);
    setHashStats(null);
    setPreparationLogs([]);
    setConfluenceUploadError(null);
    void clearStoredUpload();
    try {
      if (archiveId) {
        await apiFetch(
          `/api/v1/confluence-imports/archives/${archiveId}/upload`,
          {
            method: "DELETE",
          },
        );
      }
      toast.success("Confluence archive upload cancelled.");
    } catch (cancelError) {
      toast.error(
        errorMessage(cancelError, "Could not cancel the archive upload."),
      );
    } finally {
      setCancelUploadPending(false);
    }
  }

  async function discardConfluenceArchive() {
    if (!confluenceArchive) return;
    setDiscardingArchivePending(true);
    try {
      setIsSpaceModalOpen(false);
      setConfluenceArchive(null);
      setConfluenceFile(null);
      if (confluenceFileInput.current) {
        confluenceFileInput.current.value = "";
      }
      storedConfluenceUploadRef.current = null;
      setStoredConfluenceUpload(null);
      setUploadProgress(null);
      setUploadStats(null);
      setHashStats(null);
      setPreparationLogs([]);
      setConfluenceUploadError(null);
      void clearStoredUpload();
      toast.success("Archive selection cleared.");
    } finally {
      setDiscardingArchivePending(false);
      setConfirmDiscardArchive(false);
    }
  }

  async function startConfluenceImport(overwriteExisting = false) {
    if (!confluenceArchive) return;
    setConfluencePending(true);
    try {
      const job = await apiFetch<ConfluenceImportJob>(
        `/api/v1/confluence-imports/archives/${confluenceArchive.id}/jobs`,
        {
          method: "POST",
          body: {
            import_all: importAllSpaces,
            space_keys: selectedSpaces,
            overwrite_existing: overwriteExisting,
          },
        },
      );
      setConfluenceJob(job);
      setConfluenceLogs([]);
      setConfirmOverwriteSpaces(false);
      toast.success("Confluence import queued.");
    } catch (err) {
      toast.error(errorMessage(err, "Could not queue the import."));
    } finally {
      setConfluencePending(false);
    }
  }

  function requestConfluenceImport() {
    if (conflictingSelectedSpaces.length > 0) {
      setConfirmOverwriteSpaces(true);
      return;
    }
    void startConfluenceImport();
  }

  async function cancelConfluenceJob() {
    if (!confluenceJob) return;
    setConfluenceCancelPending(true);
    try {
      const cancelled = await apiFetch<ConfluenceImportJob>(
        `/api/v1/confluence-imports/jobs/${confluenceJob.id}/cancel`,
        { method: "POST" },
      );
      setConfluenceJob(cancelled);
      toast.success(
        cancelled.status === "cancelled"
          ? "Import cancelled."
          : "Cancellation requested.",
      );
    } catch (cancelError) {
      toast.error(errorMessage(cancelError, "Could not cancel the import."));
    } finally {
      setConfluenceCancelPending(false);
    }
  }

  function handleConfluenceFileChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const nextFile = event.target.files?.[0] ?? null;
    if (
      nextFile &&
      siteSettings?.effective?.max_backup_import_size_bytes &&
      nextFile.size > siteSettings.effective.max_backup_import_size_bytes
    ) {
      toast.error(
        `File is ${formatBytes(nextFile.size)}, over the ${siteSettings.effective.max_backup_import_size_mb} MB import limit.`,
        {
          description:
            'A system administrator can raise this under Admin → Object storage → Quotas → "Max Confluence / Backup Archive (MB)".',
        },
      );
      event.target.value = "";
      setConfluenceFile(null);
      return;
    }
    const matchesInterruptedUpload = fileMatchesStoredUpload(
      nextFile,
      storedConfluenceUpload,
    );
    if (storedConfluenceUpload && nextFile && !matchesInterruptedUpload) {
      setConfluenceFile(null);
      setConfluenceUploadError(null);
      event.target.value = "";
      toast.error(
        `Select ${storedConfluenceUpload.fileName} to resume the paused upload.`,
      );
      return;
    }
    if (nextFile && matchesInterruptedUpload && storedConfluenceUpload) {
      const nextStored = {
        ...storedConfluenceUpload,
        file: nextFile,
        fileLastModified: nextFile.lastModified,
      };
      setConfluenceFile(null);
      storedConfluenceUploadRef.current = nextStored;
      setStoredConfluenceUpload(nextStored);
      setConfluenceArchive(null);
      setConfluenceUploadError(null);
      setPreparationLogs([]);
      setUploadProgress((current) => current ?? 0);
      void saveStoredUpload(nextStored);
      void uploadConfluence(true, nextStored);
      return;
    }
    if (storedConfluenceUpload) {
      const replacedArchiveId = storedConfluenceUpload.archiveId;
      uploadRestoreRun.current += 1;
      storedConfluenceUploadRef.current = null;
      setStoredConfluenceUpload(null);
      void clearStoredUpload();
      if (storedConfluenceUpload.sha256 === null) {
        rememberCancelledUpload(replacedArchiveId);
        void apiFetch(
          `/api/v1/confluence-imports/archives/${replacedArchiveId}/upload`,
          { method: "DELETE" },
        ).catch(() => {});
      }
    }
    setConfluenceFile(nextFile);
    setStoredConfluenceUpload(null);
    void clearStoredUpload();
    setConfluenceArchive(null);
    setConfluenceJob(null);
    setConfluenceUploadError(null);
    setPreparationLogs([]);
    setUploadProgress(null);
    setUploadStats(null);
    setHashStats(null);
    setIsUploading(false);
    if (nextFile) {
      void rejectWrongArchiveFormat(nextFile, "confluence", (message) => {
        toast.error(message);
        setConfluenceFile(null);
        if (confluenceFileInput.current) {
          confluenceFileInput.current.value = "";
        }
      });
    }
  }

  function resetAfterImportSuccess() {
    setConfluenceJob(null);
    setConfluenceArchive(null);
    setConfluenceFile(null);
    if (confluenceFileInput.current) {
      confluenceFileInput.current.value = "";
    }
    setUploadProgress(null);
    setUploadStats(null);
    setHashStats(null);
    setPreparationLogs([]);
    setConfluenceLogs([]);
    setImportSuccessCounts(null);
    setIsImportSuccessModalOpen(false);
  }

  return {
    confluenceFileInput,
    confluenceUploadRequest,
    confluenceHashAbort,
    uploadPauseReason,
    uploadRestoreRun,
    uploadActiveRef,
    logsListRef,
    confluenceFile,
    storedConfluenceUpload,
    confluenceArchive,
    setConfluenceArchive,
    confluenceJob,
    confluenceCancelPending,
    confluenceLogsExpanded,
    setConfluenceLogsExpanded,
    preparationLogs,
    preparationLogsExpanded,
    setPreparationLogsExpanded,
    selectedSpaces,
    setSelectedSpaces,
    importAllSpaces,
    setImportAllSpaces,
    spaceFilter,
    setSpaceFilter,
    uploadProgress,
    uploadStats,
    hashStats,
    isUploading,
    confluencePending,
    confirmDiscardArchive,
    setConfirmDiscardArchive,
    discardingArchivePending,
    confirmCancelUpload,
    setConfirmCancelUpload,
    confirmOverwriteSpaces,
    setConfirmOverwriteSpaces,
    cancelUploadPending,
    confluenceUploadError,
    isSpaceModalOpen,
    setIsSpaceModalOpen,
    isImportSuccessModalOpen,
    setIsImportSuccessModalOpen,
    importSuccessCounts,
    conflictingSelectedSpaces,
    overwriteSpaceSummary,
    confluenceArchiveName,
    confluenceArchiveSize,
    storedUploadNeedsFile,
    canResumeStoredUpload,
    isHashingArchive,
    isFinalizingArchive,
    importInProgress,
    confluenceFlowActive,
    jobSpacesTotal,
    jobSpacesCompleted,
    jobAttachmentsTotal,
    jobAttachmentsProcessed,
    displayedDownloadPercent,
    jobProgressPercent,
    jobTitle,
    jobPagesSummary,
    confluenceActivityLogs,
    restoreActiveConfluenceJob,
    restoreStoredConfluenceUpload,
    uploadConfluence,
    cancelConfluenceUpload,
    abandonConfluenceUpload,
    discardConfluenceArchive,
    startConfluenceImport,
    requestConfluenceImport,
    cancelConfluenceJob,
    handleConfluenceFileChange,
    resetAfterImportSuccess,
  };
}
