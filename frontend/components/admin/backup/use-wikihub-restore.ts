"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { formatBytes } from "@/components/ui/job-progress";
import { formatLogTime } from "@/components/ui/log-disclosure";
import { ApiError, apiFetch } from "@/lib/api-client";
import type { ArchiveFormat } from "@/lib/archive-format";
import type {
  BackupArchive,
  BackupArchiveUploadProgress,
  BackupJobLog,
  ImportReport,
  SiteSettings,
} from "@/types/api";
import { sha256File } from "./sha256";
import {
  SESSION_EXPIRED_UPLOAD_MESSAGE,
  errorMessage,
  type BackupArchiveUploadTarget,
  type HashStats,
  type PortableBackupJob,
  type RestoreLogEntry,
  type UploadStats,
} from "./types";

export function useWikihubRestore({
  siteSettings,
  portableBackupJob,
  setPortableBackupJob,
  setActiveSection,
  renewUploadSession,
  startUploadSessionRenewal,
  rejectWrongArchiveFormat,
  settledRestoreJobIdRef,
}: {
  siteSettings: SiteSettings | null;
  portableBackupJob: PortableBackupJob | null;
  setPortableBackupJob: React.Dispatch<
    React.SetStateAction<PortableBackupJob | null>
  >;
  setActiveSection: (section: "export" | "import") => void;
  renewUploadSession: () => Promise<void>;
  startUploadSessionRenewal: (runRenewal: () => void) => () => void;
  rejectWrongArchiveFormat: (
    candidate: File,
    expected: ArchiveFormat,
    reject: (message: string) => void,
  ) => Promise<void>;
  settledRestoreJobIdRef: React.MutableRefObject<string | null>;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const restoreUploadActiveRef = useRef(false);
  const restoreArchiveIdRef = useRef<string | null>(null);
  const restoreHashAbort = useRef<AbortController | null>(null);
  const uploadBackupRun = useRef(0);
  const restoreUploadRequest = useRef<XMLHttpRequest | null>(null);
  const restoreLogsListRef = useRef<HTMLUListElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [restorePreparationLogs, setRestorePreparationLogs] = useState<
    RestoreLogEntry[]
  >([]);
  const [restoreJobLogs, setRestoreJobLogs] = useState<BackupJobLog[]>([]);
  const [restoreLogsExpanded, setRestoreLogsExpanded] = useState(true);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [pending, setPending] = useState<"apply" | null>(null);
  const [restoreUploadProgress, setRestoreUploadProgress] = useState<
    number | null
  >(null);
  const [restoreUploadStats, setRestoreUploadStats] =
    useState<UploadStats | null>(null);
  const [importSelectedSpaceKeys, setImportSelectedSpaceKeys] = useState<
    string[]
  >([]);
  const [importSpaceFilter, setImportSpaceFilter] = useState("");
  const [isImportSpacePickerOpen, setIsImportSpacePickerOpen] = useState(false);
  const [backupArchive, setBackupArchive] = useState<BackupArchive | null>(
    null,
  );
  const [isHashingBackupArchive, setIsHashingBackupArchive] = useState(false);
  const [backupHashStats, setBackupHashStats] = useState<HashStats | null>(
    null,
  );
  const [isUploadingBackupArchive, setIsUploadingBackupArchive] =
    useState(false);
  const [isScanningBackupArchive, setIsScanningBackupArchive] = useState(false);
  const [restoreResumedBytes, setRestoreResumedBytes] = useState(0);
  const [restoreArchiveRejected, setRestoreArchiveRejected] = useState(false);
  const [mismatchedResumeFile, setMismatchedResumeFile] = useState<File | null>(
    null,
  );
  const [pendingRestoreUpload, setPendingRestoreUpload] =
    useState<BackupArchiveUploadProgress | null>(null);
  const [confirmDiscardBackupArchive, setConfirmDiscardBackupArchive] =
    useState(false);
  const [confirmCancelBackupUpload, setConfirmCancelBackupUpload] =
    useState(false);
  const [cancelBackupUploadPending, setCancelBackupUploadPending] =
    useState(false);
  const [conflictingImportSpaceKeys, setConflictingImportSpaceKeys] = useState<
    string[]
  >([]);
  const [confirmOverwriteImportSpaces, setConfirmOverwriteImportSpaces] =
    useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRestoreSuccessModalOpen, setIsRestoreSuccessModalOpen] =
    useState(false);
  const [restoreSuccessReport, setRestoreSuccessReport] =
    useState<ImportReport | null>(null);

  const selectedRestoreKeys =
    importSelectedSpaceKeys.length > 0 &&
    importSelectedSpaceKeys.length < (backupArchive?.spaces.length ?? 0)
      ? importSelectedSpaceKeys
      : (backupArchive?.spaces.map((space) => space.key) ?? []);
  const conflictingRestoreSpaces =
    backupArchive?.spaces.filter(
      (space) => space.conflict && selectedRestoreKeys.includes(space.key),
    ) ?? [];
  const overwriteImportSpaceKeysSummary = [
    ...conflictingImportSpaceKeys.slice(0, 8),
    ...(conflictingImportSpaceKeys.length > 8
      ? [`and ${conflictingImportSpaceKeys.length - 8} more`]
      : []),
  ].join(", ");

  const isRestoreJobRunning =
    portableBackupJob?.kind === "full_import" &&
    (portableBackupJob.status === "queued" ||
      portableBackupJob.status === "running");
  const restoreJobCardVisible =
    portableBackupJob?.kind === "full_import" &&
    portableBackupJob.status !== "complete";

  const restoreUploadNeedsFile = Boolean(
    pendingRestoreUpload && !backupArchive && !file,
  );
  const restoreUploadResumable = Boolean(
    !backupArchive &&
      !restoreArchiveRejected &&
      (pendingRestoreUpload || restoreUploadProgress != null),
  );
  const pendingRestoreUploadedBytes = pendingRestoreUpload
    ? Math.min(
        pendingRestoreUpload.uploaded_parts.length *
          pendingRestoreUpload.part_size_bytes,
        pendingRestoreUpload.size_bytes,
      )
    : 0;
  const pendingRestorePercent =
    pendingRestoreUpload && pendingRestoreUpload.size_bytes > 0
      ? Math.min(
          99,
          Math.round(
            (pendingRestoreUploadedBytes / pendingRestoreUpload.size_bytes) *
              100,
          ),
        )
      : 0;
  const pendingRestoreStats = pendingRestoreUpload && {
    loaded: pendingRestoreUploadedBytes,
    total: pendingRestoreUpload.size_bytes,
    bytesPerSecond: 0,
    secondsRemaining: null,
  };
  const isPreparingArchive =
    isHashingBackupArchive ||
    isUploadingBackupArchive ||
    isScanningBackupArchive;
  const restoreFlowActive = Boolean(
    isHashingBackupArchive ||
      isUploadingBackupArchive ||
      isScanningBackupArchive ||
      backupArchive ||
      isRestoreJobRunning ||
      pending === "apply" ||
      isRestoreSuccessModalOpen ||
      restoreUploadProgress !== null ||
      pendingRestoreUpload,
  );
  const restoreDecisionOwnedByReadyBar =
    backupArchive !== null && !isRestoreJobRunning && pending !== "apply";

  const loadRestoreJobLogs = useCallback(async (jobId: string) => {
    try {
      const page = await apiFetch<{ items: BackupJobLog[] }>(
        `/api/v1/backup/jobs/${jobId}/logs`,
      );
      setRestoreJobLogs([...page.items].reverse());
    } catch {
      // Narration is not the work.
    }
  }, []);

  const restoreLogEntries = useMemo<RestoreLogEntry[]>(
    () => [
      ...restorePreparationLogs,
      ...restoreJobLogs.map((log) => ({
        id: log.id,
        time: formatLogTime(new Date(log.created_at)),
        level: (log.level === "warning" || log.level === "error"
          ? log.level
          : "info") as RestoreLogEntry["level"],
        label: log.entity_label,
        message: log.message,
      })),
    ],
    [restorePreparationLogs, restoreJobLogs],
  );

  useEffect(() => {
    if (restoreLogsListRef.current) {
      restoreLogsListRef.current.scrollTop =
        restoreLogsListRef.current.scrollHeight;
    }
  }, [restoreLogEntries]);

  const appendRestorePreparationLog = useCallback(
    (message: string, level: RestoreLogEntry["level"] = "info") => {
      setRestorePreparationLogs((current) => [
        ...current,
        {
          id: `prep-${current.length}`,
          time: formatLogTime(new Date()),
          level,
          message,
        },
      ]);
    },
    [],
  );

  const restoreActiveBackupArchive = useCallback(async () => {
    try {
      const active = await apiFetch<BackupArchiveUploadProgress[]>(
        "/api/v1/backup/archives/uploads/active",
      );
      const pendingUpload = active[0];
      if (!pendingUpload) return;
      if (pendingUpload.status === "scanned") {
        const archive = await apiFetch<BackupArchive>(
          `/api/v1/backup/archives/${pendingUpload.archive_id}`,
        );
        setBackupArchive((current) => current ?? archive);
        setActiveSection("import");
        return;
      }
      setPendingRestoreUpload((current) => current ?? pendingUpload);
      setActiveSection("import");
    } catch {
      // A missing/failed lookup just means nothing to restore.
    }
  }, [setActiveSection]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore persisted server state on mount
    void restoreActiveBackupArchive();
  }, [restoreActiveBackupArchive]);

  async function uploadAndScanBackupArchive(targetFile: File): Promise<void> {
    const run = uploadBackupRun.current + 1;
    uploadBackupRun.current = run;
    const stillCurrent = () => uploadBackupRun.current === run;
    restoreUploadActiveRef.current = true;
    setError(null);
    setBackupArchive(null);
    setRestoreUploadProgress(null);
    setRestoreUploadStats(null);
    setRestoreResumedBytes(0);
    setRestoreArchiveRejected(false);
    setPendingRestoreUpload(null);
    setRestorePreparationLogs([]);
    setRestoreJobLogs([]);
    setRestoreLogsExpanded(true);
    setPortableBackupJob(null);
    let reachedScan = false;
    let stopSessionRenewal: (() => void) | null = null;
    const runRenewal = () =>
      void renewUploadSession().catch((renewError) => {
        if (renewError instanceof ApiError && renewError.status === 401) {
          setError(SESSION_EXPIRED_UPLOAD_MESSAGE);
          restoreUploadRequest.current?.abort();
        }
      });
    try {
      await renewUploadSession().catch(() => {});
      stopSessionRenewal = startUploadSessionRenewal(runRenewal);
      appendRestorePreparationLog(
        `Selected ${targetFile.name} (${formatBytes(targetFile.size)}).`,
      );
      appendRestorePreparationLog("Calculating archive fingerprint.");
      setIsHashingBackupArchive(true);
      const hashAbortController = new AbortController();
      restoreHashAbort.current = hashAbortController;
      const hashStartedAt = performance.now();
      setBackupHashStats({
        loaded: 0,
        total: targetFile.size,
        bytesPerSecond: 0,
        secondsRemaining: null,
      });
      const sha256 = await sha256File(
        targetFile,
        (loaded) => {
          const elapsedSeconds = Math.max(
            (performance.now() - hashStartedAt) / 1000,
            0.001,
          );
          const bytesPerSecond = loaded / elapsedSeconds;
          setBackupHashStats({
            loaded,
            total: targetFile.size,
            bytesPerSecond,
            secondsRemaining:
              bytesPerSecond > 0
                ? (targetFile.size - loaded) / bytesPerSecond
                : null,
          });
        },
        hashAbortController.signal,
      );
      restoreHashAbort.current = null;
      if (!stillCurrent()) return;
      appendRestorePreparationLog(
        `Archive fingerprint ready: ${sha256.slice(0, 12)}...`,
      );
      setIsHashingBackupArchive(false);
      setBackupHashStats(null);

      const target = await apiFetch<BackupArchiveUploadTarget>(
        "/api/v1/backup/archives/uploads",
        {
          method: "POST",
          body: {
            filename: targetFile.name,
            size_bytes: targetFile.size,
            sha256,
          },
        },
      );
      if (!stillCurrent()) return;
      restoreArchiveIdRef.current = target.archive_id;

      if (target.reused) {
        appendRestorePreparationLog(
          "This archive is already in object storage. Skipping the upload.",
        );
        setRestoreUploadProgress(100);
        setRestoreUploadStats({
          loaded: targetFile.size,
          total: targetFile.size,
          bytesPerSecond: 0,
          secondsRemaining: 0,
        });
      } else {
        setIsUploadingBackupArchive(true);
        const partSize = target.part_size_bytes;
        const totalParts = Math.max(1, Math.ceil(targetFile.size / partSize));
        const uploadedParts = new Set(target.uploaded_parts);
        appendRestorePreparationLog(
          uploadedParts.size > 0
            ? `Resuming upload: ${uploadedParts.size} of ${totalParts} parts are already in storage.`
            : `Uploading ${totalParts} ${totalParts === 1 ? "part" : "parts"} to object storage.`,
        );
        let uploadedBytes = uploadedParts.size * partSize;
        setRestoreResumedBytes(uploadedBytes);
        setRestoreUploadProgress(
          Math.round((uploadedBytes / targetFile.size) * 100),
        );
        setRestoreUploadStats({
          loaded: uploadedBytes,
          total: targetFile.size,
          bytesPerSecond: 0,
          secondsRemaining: null,
        });
        const startedAt = performance.now();
        for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
          if (uploadedParts.has(partNumber)) continue;
          const urls = await apiFetch<{ urls: Record<string, string> }>(
            `/api/v1/backup/archives/${target.archive_id}/upload-parts`,
            { method: "POST", body: { part_numbers: [partNumber] } },
          );
          if (!stillCurrent()) return;
          const chunk = targetFile.slice(
            (partNumber - 1) * partSize,
            Math.min(partNumber * partSize, targetFile.size),
          );
          await new Promise<void>((resolve, reject) => {
            const request = new XMLHttpRequest();
            restoreUploadRequest.current = request;
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
              setRestoreUploadProgress(
                Math.round((loaded / targetFile.size) * 100),
              );
              setRestoreUploadStats({
                loaded,
                total: targetFile.size,
                bytesPerSecond,
                secondsRemaining:
                  bytesPerSecond > 0
                    ? (targetFile.size - loaded) / bytesPerSecond
                    : null,
              });
            };
            request.onload = () =>
              request.status >= 200 && request.status < 300
                ? resolve()
                : reject(
                    new Error("Object storage rejected the archive upload."),
                  );
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
        restoreUploadRequest.current = null;
        if (!stillCurrent()) return;
        setRestoreUploadProgress(100);
        appendRestorePreparationLog(
          "Upload finished. Completing multipart upload in object storage.",
        );
        await renewUploadSession().catch(() => {});
        await apiFetch(
          `/api/v1/backup/archives/${target.archive_id}/complete-upload`,
          { method: "POST" },
        );
        appendRestorePreparationLog("Multipart upload completed.");
      }
      if (!stillCurrent()) return;

      reachedScan = true;
      appendRestorePreparationLog(
        "Scanning the archive for its space list. This can take a few minutes.",
      );
      setIsScanningBackupArchive(true);
      await renewUploadSession().catch(() => {});
      const scanned = await apiFetch<BackupArchive>(
        `/api/v1/backup/archives/${target.archive_id}/scan`,
        { method: "POST" },
      );
      if (!stillCurrent()) return;
      restoreArchiveIdRef.current = null;
      setBackupArchive(scanned);
      setImportSpaceFilter("");
      setImportSelectedSpaceKeys([]);
      setRestoreUploadProgress(null);
      setRestoreUploadStats(null);
      appendRestorePreparationLog(
        `Archive scan completed. ${scanned.spaces.length} ${scanned.spaces.length === 1 ? "space" : "spaces"} ready to restore.`,
      );
      setIsImportSpacePickerOpen(true);
      toast.success("Archive scanned. Choose which spaces to restore.");
    } catch (err) {
      if (!stillCurrent()) return;
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      if (err instanceof ApiError && err.status === 401) {
        setError(SESSION_EXPIRED_UPLOAD_MESSAGE);
        toast.error("Upload paused because your session expired.");
        appendRestorePreparationLog(
          "Upload paused: Your session expired.",
          "error",
        );
        return;
      }
      if (
        reachedScan &&
        err instanceof ApiError &&
        err.status >= 400 &&
        err.status < 500
      ) {
        setRestoreArchiveRejected(true);
      }
      appendRestorePreparationLog(
        err instanceof ApiError
          ? `Failed: ${err.message}`
          : "Failed to upload or scan the archive.",
        "error",
      );
      setError(
        errorMessage(err, "Could not upload or scan the backup archive."),
      );
    } finally {
      stopSessionRenewal?.();
      if (stillCurrent()) {
        restoreUploadActiveRef.current = false;
        setIsHashingBackupArchive(false);
        setBackupHashStats(null);
        setIsUploadingBackupArchive(false);
        setIsScanningBackupArchive(false);
      }
    }
  }

  function uploadAnotherAfterRejection() {
    const archiveId = restoreArchiveIdRef.current;
    restoreArchiveIdRef.current = null;
    uploadBackupRun.current += 1;
    restoreUploadActiveRef.current = false;
    setRestoreArchiveRejected(false);
    setRestoreUploadProgress(null);
    setRestoreUploadStats(null);
    setRestoreResumedBytes(0);
    setFile(null);
    setError(null);
    if (fileInput.current) {
      fileInput.current.value = "";
      fileInput.current.click();
    }
    if (archiveId) {
      void apiFetch(`/api/v1/backup/archives/${archiveId}/upload`, {
        method: "DELETE",
      }).catch(() => {});
    }
  }

  async function handleRestoreFileSelected(selectedFile: File) {
    let wrongFormat = false;
    await rejectWrongArchiveFormat(selectedFile, "wikihub", (message) => {
      wrongFormat = true;
      toast.error(message);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
    });
    if (wrongFormat) return;

    const pendingUpload = pendingRestoreUpload;
    if (!pendingUpload) return;
    if (
      selectedFile.name === pendingUpload.filename &&
      selectedFile.size === pendingUpload.size_bytes
    ) {
      void uploadAndScanBackupArchive(selectedFile);
      return;
    }
    setMismatchedResumeFile(selectedFile);
  }

  function handleRestoreFileInputChange(
    e: React.ChangeEvent<HTMLInputElement>,
  ) {
    const selectedFile = e.target.files?.[0] ?? null;
    if (
      selectedFile &&
      siteSettings?.effective?.max_backup_import_size_bytes &&
      selectedFile.size > siteSettings.effective.max_backup_import_size_bytes
    ) {
      setFile(null);
      setReport(null);
      toast.error(
        `File is ${formatBytes(selectedFile.size)}, over the ${siteSettings.effective.max_backup_import_size_mb} MB import limit.`,
        {
          description:
            'A system administrator can raise this under Admin → Object storage → Quotas → "Max Confluence / Backup Archive (MB)".',
        },
      );
      e.target.value = "";
      return;
    }
    setFile(selectedFile);
    setReport(null);
    setError(null);
    setBackupArchive(null);
    setImportSelectedSpaceKeys([]);
    setConflictingImportSpaceKeys([]);
    setConfirmOverwriteImportSpaces(false);
    restoreArchiveIdRef.current = null;
    setRestoreUploadProgress(null);
    setRestoreUploadStats(null);
    setRestoreResumedBytes(0);
    setRestoreArchiveRejected(false);
    if (selectedFile) {
      void handleRestoreFileSelected(selectedFile);
    }
  }

  async function discardPendingRestoreUpload() {
    const pendingUpload = pendingRestoreUpload;
    setPendingRestoreUpload(null);
    if (!pendingUpload) return;
    try {
      await apiFetch(
        `/api/v1/backup/archives/${pendingUpload.archive_id}/upload`,
        { method: "DELETE" },
      );
    } catch {
      // Best-effort.
    }
    toast.success("Unfinished upload discarded.");
  }

  async function uploadMismatchedFileInstead() {
    const next = mismatchedResumeFile;
    setMismatchedResumeFile(null);
    if (!next) return;
    await discardPendingRestoreUpload();
    void uploadAndScanBackupArchive(next);
  }

  function reselectFileForResume() {
    setMismatchedResumeFile(null);
    setFile(null);
    if (fileInput.current) {
      fileInput.current.value = "";
      fileInput.current.click();
    }
  }

  function resetRestoreSelection() {
    setBackupArchive(null);
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
    setImportSelectedSpaceKeys([]);
    setConflictingImportSpaceKeys([]);
    setConfirmOverwriteImportSpaces(false);
    setRestoreUploadProgress(null);
    setRestoreUploadStats(null);
    setRestoreResumedBytes(0);
    setRestoreArchiveRejected(false);
    setPendingRestoreUpload(null);
    setRestorePreparationLogs([]);
    setRestoreJobLogs([]);
    setPortableBackupJob(null);
    setRestoreSuccessReport(null);
    settledRestoreJobIdRef.current = null;
    setError(null);
  }

  async function restoreMoreFromSameArchive() {
    const archive = backupArchive;
    setPortableBackupJob(null);
    settledRestoreJobIdRef.current = null;
    setRestoreJobLogs([]);
    setReport(null);
    setIsRestoreSuccessModalOpen(false);
    if (!archive) {
      resetRestoreSelection();
      return;
    }
    setImportSpaceFilter("");
    setImportSelectedSpaceKeys([]);
    setConflictingImportSpaceKeys([]);
    setIsImportSpacePickerOpen(true);
    try {
      setBackupArchive(
        await apiFetch<BackupArchive>(`/api/v1/backup/archives/${archive.id}`),
      );
    } catch {
      // Keep the picker open on what is already known.
    }
  }

  function pauseBackupArchiveUpload() {
    uploadBackupRun.current += 1;
    restoreUploadActiveRef.current = false;
    restoreHashAbort.current?.abort();
    restoreUploadRequest.current?.abort();
    setIsHashingBackupArchive(false);
    setIsUploadingBackupArchive(false);
    setIsScanningBackupArchive(false);
    setBackupHashStats(null);
    toast.info("Upload paused. Press Resume upload to carry on.");
  }

  async function cancelBackupArchiveUpload() {
    setCancelBackupUploadPending(true);
    uploadBackupRun.current += 1;
    restoreUploadActiveRef.current = false;
    restoreHashAbort.current?.abort();
    restoreUploadRequest.current?.abort();
    const archiveId = restoreArchiveIdRef.current;
    restoreArchiveIdRef.current = null;
    setIsHashingBackupArchive(false);
    setIsUploadingBackupArchive(false);
    setIsScanningBackupArchive(false);
    setBackupHashStats(null);
    setRestoreUploadProgress(null);
    setRestoreUploadStats(null);
    setRestoreResumedBytes(0);
    setRestoreArchiveRejected(false);
    setPendingRestoreUpload(null);
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
    setConfirmCancelBackupUpload(false);
    if (archiveId) {
      try {
        await apiFetch(`/api/v1/backup/archives/${archiveId}/upload`, {
          method: "DELETE",
        });
      } catch {
        // Best-effort cleanup only.
      }
    }
    setCancelBackupUploadPending(false);
    toast.success("Backup archive upload cancelled.");
  }

  async function discardBackupArchive() {
    const discarded = backupArchive;
    resetRestoreSelection();
    setConfirmDiscardBackupArchive(false);
    if (!discarded) return;
    try {
      await apiFetch(`/api/v1/backup/archives/${discarded.id}/upload`, {
        method: "DELETE",
      });
      toast.success("Archive selection cleared.");
    } catch (err) {
      toast.error(
        errorMessage(err, "Could not discard the uploaded archive."),
      );
    }
  }

  async function submitImport(overwriteSpaceKeys: string[] = []) {
    if (backupArchive) {
      setPending("apply");
      setError(null);
      try {
        const job = await apiFetch<PortableBackupJob>(
          `/api/v1/backup/archives/${backupArchive.id}/jobs`,
          {
            method: "POST",
            body: {
              space_keys:
                importSelectedSpaceKeys.length > 0 &&
                importSelectedSpaceKeys.length <
                  (backupArchive?.spaces.length ?? 0)
                  ? importSelectedSpaceKeys
                  : [],
              overwrite_space_keys: overwriteSpaceKeys,
            },
          },
        );
        setPortableBackupJob(job);
        setRestoreJobLogs([]);
        setConfirmOverwriteImportSpaces(false);
        toast.success("Restore queued. It will continue in the background.");
      } catch (err) {
        toast.error(
          errorMessage(err, "Could not restore the backup file."),
        );
      } finally {
        setPending(null);
      }
      return;
    }

    if (!file) return;
    setPending("apply");
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("dry_run", "false");
      const result = await apiFetch<ImportReport>("/api/v1/backup/import", {
        method: "POST",
        rawBody: form,
      });
      setReport(result);
      toast.success("Import applied.");
      router.refresh();
    } catch (err) {
      toast.error(
        errorMessage(err, "Could not read the backup file."),
      );
    } finally {
      setPending(null);
    }
  }

  function requestImportRestore() {
    if (conflictingRestoreSpaces.length > 0) {
      setConflictingImportSpaceKeys(
        conflictingRestoreSpaces.map((space) => space.key),
      );
      setConfirmOverwriteImportSpaces(true);
      return;
    }
    setIsImportSpacePickerOpen(false);
    void submitImport();
  }

  return {
    fileInput,
    restoreUploadActiveRef,
    uploadBackupRun,
    restoreLogsListRef,
    file,
    restoreLogEntries,
    restoreLogsExpanded,
    setRestoreLogsExpanded,
    report,
    pending,
    restoreUploadProgress,
    restoreUploadStats,
    importSelectedSpaceKeys,
    setImportSelectedSpaceKeys,
    importSpaceFilter,
    setImportSpaceFilter,
    isImportSpacePickerOpen,
    setIsImportSpacePickerOpen,
    backupArchive,
    isHashingBackupArchive,
    backupHashStats,
    isUploadingBackupArchive,
    isScanningBackupArchive,
    restoreResumedBytes,
    restoreArchiveRejected,
    mismatchedResumeFile,
    setMismatchedResumeFile,
    pendingRestoreUpload,
    pendingRestoreUploadedBytes,
    pendingRestorePercent,
    pendingRestoreStats,
    confirmDiscardBackupArchive,
    setConfirmDiscardBackupArchive,
    confirmCancelBackupUpload,
    setConfirmCancelBackupUpload,
    cancelBackupUploadPending,
    conflictingImportSpaceKeys,
    setConflictingImportSpaceKeys,
    overwriteImportSpaceKeysSummary,
    confirmOverwriteImportSpaces,
    setConfirmOverwriteImportSpaces,
    error,
    isRestoreSuccessModalOpen,
    setIsRestoreSuccessModalOpen,
    restoreSuccessReport,
    setRestoreSuccessReport,
    isRestoreJobRunning,
    restoreJobCardVisible,
    restoreUploadNeedsFile,
    restoreUploadResumable,
    isPreparingArchive,
    restoreFlowActive,
    restoreDecisionOwnedByReadyBar,
    loadRestoreJobLogs,
    restoreActiveBackupArchive,
    uploadAndScanBackupArchive,
    uploadAnotherAfterRejection,
    handleRestoreFileInputChange,
    discardPendingRestoreUpload,
    uploadMismatchedFileInstead,
    reselectFileForResume,
    restoreMoreFromSameArchive,
    pauseBackupArchiveUpload,
    cancelBackupArchiveUpload,
    discardBackupArchive,
    submitImport,
    requestImportRestore,
  };
}
