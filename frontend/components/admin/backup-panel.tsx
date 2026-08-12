"use client";

import {
  AlertTriangle,
  Download,
  FileArchive,
  Info,
  Loader2,
  Pause,
  Play,
  Search,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiFetch } from "@/lib/api-client";
import { PUBLIC_API_BASE_URL } from "@/lib/env";
import { cn } from "@/lib/utils";
import type {
  ConfluenceArchive,
  ConfluenceImportJob,
  ConfluenceImportLog,
  ConfluenceUploadProgress,
  ConfluenceUploadTarget,
  ImportReport,
} from "@/types/api";

type UploadStats = {
  loaded: number;
  total: number;
  bytesPerSecond: number;
  secondsRemaining: number | null;
};

type StoredConfluenceUpload = {
  archiveId: string;
  file: File;
  partSize: number;
};

const CONFLUENCE_UPLOAD_DATABASE = "wikihub-confluence-upload";
const CONFLUENCE_UPLOAD_STORE = "pending";
const CONFLUENCE_UPLOAD_KEY = "current";

function uploadStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CONFLUENCE_UPLOAD_DATABASE, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(CONFLUENCE_UPLOAD_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readStoredUpload(): Promise<StoredConfluenceUpload | null> {
  const database = await uploadStore();
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(CONFLUENCE_UPLOAD_STORE)
      .objectStore(CONFLUENCE_UPLOAD_STORE)
      .get(CONFLUENCE_UPLOAD_KEY);
    request.onsuccess = () =>
      resolve((request.result as StoredConfluenceUpload | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function saveStoredUpload(upload: StoredConfluenceUpload): Promise<void> {
  const database = await uploadStore();
  await new Promise<void>((resolve, reject) => {
    const request = database
      .transaction(CONFLUENCE_UPLOAD_STORE, "readwrite")
      .objectStore(CONFLUENCE_UPLOAD_STORE)
      .put(upload, CONFLUENCE_UPLOAD_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function clearStoredUpload(): Promise<void> {
  const database = await uploadStore();
  await new Promise<void>((resolve, reject) => {
    const request = database
      .transaction(CONFLUENCE_UPLOAD_STORE, "readwrite")
      .objectStore(CONFLUENCE_UPLOAD_STORE)
      .delete(CONFLUENCE_UPLOAD_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)) - 1,
    units.length - 1,
  );
  return `${(bytes / 1024 ** (index + 1)).toFixed(index > 1 ? 2 : 1)} ${units[index]}`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "Calculating…";
  if (seconds < 60) return `${Math.ceil(seconds)} sec remaining`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.ceil(seconds % 60);
  return `${minutes} min ${remainingSeconds} sec remaining`;
}

function CountList({
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

export function BackupPanel() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const confluenceUploadRequest = useRef<XMLHttpRequest | null>(null);
  const uploadActiveRef = useRef(false);
  const allowConfirmedLeaveRef = useRef(false);

  const [includeCredentials, setIncludeCredentials] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [confluenceFile, setConfluenceFile] = useState<File | null>(null);
  const [storedConfluenceUpload, setStoredConfluenceUpload] =
    useState<StoredConfluenceUpload | null>(null);
  const [confluenceArchive, setConfluenceArchive] =
    useState<ConfluenceArchive | null>(null);
  const [confluenceJob, setConfluenceJob] =
    useState<ConfluenceImportJob | null>(null);
  const [confluenceCancelPending, setConfluenceCancelPending] = useState(false);
  const [confluenceLogs, setConfluenceLogs] = useState<ConfluenceImportLog[]>(
    [],
  );
  const [selectedSpaces, setSelectedSpaces] = useState<string[]>([]);
  const [importAllSpaces, setImportAllSpaces] = useState(true);
  const [spaceFilter, setSpaceFilter] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadStats, setUploadStats] = useState<UploadStats | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [confluencePending, setConfluencePending] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [pending, setPending] = useState<"preview" | "apply" | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [confirmCancelUpload, setConfirmCancelUpload] = useState(false);
  const [confirmOverwriteSpaces, setConfirmOverwriteSpaces] = useState(false);
  const [cancelUploadPending, setCancelUploadPending] = useState(false);
  const [leaveTarget, setLeaveTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const normalizedSpaceFilter = spaceFilter.trim().toLocaleLowerCase();
  const filteredConfluenceSpaces =
    confluenceArchive?.spaces.filter(
      (space) =>
        !normalizedSpaceFilter ||
        space.name.toLocaleLowerCase().includes(normalizedSpaceFilter) ||
        space.key.toLocaleLowerCase().includes(normalizedSpaceFilter),
    ) ?? [];
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
  const isFinalizingArchive =
    confluencePending &&
    !isUploading &&
    !confluenceArchive &&
    uploadProgress === 100;
  const importInProgress = Boolean(
    confluenceJob &&
    !["completed", "failed", "cancelled"].includes(confluenceJob.status),
  );
  const jobSpacesTotal = confluenceJob?.counters.spaces_total ?? 0;
  const jobSpacesCompleted = confluenceJob?.counters.spaces_completed ?? 0;
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
  const jobProgressPercent = !confluenceJob
    ? 0
    : confluenceJob.status === "completed"
      ? 100
      : confluenceJob.status === "queued"
        ? 0
        : confluenceJob.phase === "downloading"
          ? jobDownloadPercent * 0.15
          : confluenceJob.phase === "scanning"
            ? 15
            : 15 + jobSpacePercent * 0.85;
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
                ? "Importing spaces"
                : "Import queued";
  const jobPagesSummary = confluenceJob?.counters.pages_total
    ? `${confluenceJob.counters.pages_processed ?? 0}/${confluenceJob.counters.pages_total} pages`
    : `${confluenceJob?.counters.pages_processed ?? 0} pages`;

  // A real link, not a fetch: the browser handles the Content-Disposition
  // attachment itself, the session cookie rides along, and right-click
  // "save as" works. Fetching the JSON into memory only to re-wrap it in a
  // blob URL would buy nothing.
  const exportHref = `${PUBLIC_API_BASE_URL}/api/v1/backup/export${
    includeCredentials ? "?include_credentials=true" : ""
  }`;

  useEffect(() => {
    uploadActiveRef.current = isUploading;
  }, [isUploading]);

  // Next.js navigation does not trigger the browser's unload prompt. Catch
  // normal in-app link clicks before the router handles them, then pause the
  // current multipart request only after the user confirms.
  useEffect(() => {
    const confirmNavigation = (event: MouseEvent) => {
      if (
        !uploadActiveRef.current ||
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
      setLeaveTarget(target.href);
    };
    const confirmUnload = (event: BeforeUnloadEvent) => {
      if (!uploadActiveRef.current || allowConfirmedLeaveRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("click", confirmNavigation, true);
    window.addEventListener("beforeunload", confirmUnload);
    return () => {
      document.removeEventListener("click", confirmNavigation, true);
      window.removeEventListener("beforeunload", confirmUnload);
    };
  }, []);

  async function downloadBackup() {
    if (isDownloading) return;

    setIsDownloading(true);
    try {
      const response = await fetch(exportHref, { credentials: "include" });
      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}.`);
      }

      const blob = await response.blob();
      const filename =
        response.headers
          .get("Content-Disposition")
          ?.match(/filename="?([^";]+)"?/i)?.[1] ?? "wikihub-backup.json";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      toast.error(
        downloadError instanceof Error
          ? downloadError.message
          : "Could not download the backup.",
      );
    } finally {
      setIsDownloading(false);
    }
  }

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
        setConfluenceJob(job);
        setConfluenceLogs(logs.items);
      } catch {
        /* next poll reports a recoverable API failure */
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [confluenceJob]);

  // Import work is server-side once queued. Restore the most recent active job
  // whenever this panel mounts so navigation and refresh never hide progress.
  useEffect(() => {
    void apiFetch<ConfluenceImportJob[]>("/api/v1/confluence-imports/jobs")
      .then((jobs) => {
        const activeJob = jobs.find(
          (job) => !["completed", "failed", "cancelled"].includes(job.status),
        );
        if (activeJob) setConfluenceJob(activeJob);
      })
      .catch(() => {
        // The panel remains usable if the historical-job lookup is unavailable.
      });
  }, []);

  // Keep the selected archive in IndexedDB. Unlike an in-memory File state,
  // this survives route changes and a browser refresh, allowing the multipart
  // session in MinIO to continue from its confirmed parts.
  useEffect(() => {
    let active = true;
    void readStoredUpload()
      .then(async (stored) => {
        if (!active || !stored) return;
        const progress = await apiFetch<ConfluenceUploadProgress>(
          `/api/v1/confluence-imports/archives/${stored.archiveId}/upload`,
        );
        if (!active) return;
        if (progress.status === "uploaded") {
          const archive = await apiFetch<ConfluenceArchive>(
            `/api/v1/confluence-imports/archives/${stored.archiveId}/scan`,
            { method: "POST" },
          );
          if (!active) return;
          await clearStoredUpload();
          setConfluenceArchive(archive);
          setSelectedSpaces(archive.spaces.map((space) => space.key));
          setImportAllSpaces(true);
          return;
        }
        if (progress.status !== "uploading") {
          await clearStoredUpload();
          return;
        }
        const uploadedBytes = progress.uploaded_parts.reduce(
          (total, part) =>
            total +
            Math.min(
              stored.partSize,
              stored.file.size - (part - 1) * stored.partSize,
            ),
          0,
        );
        setStoredConfluenceUpload(stored);
        setUploadProgress(Math.round((uploadedBytes / stored.file.size) * 100));
        setUploadStats({
          loaded: uploadedBytes,
          total: stored.file.size,
          bytesPerSecond: 0,
          secondsRemaining: null,
        });
      })
      .catch((restoreError) => {
        // A deleted/expired server upload cannot be resumed. Drop the local
        // file reference so the user can start a clean upload instead of being
        // left with a permanent 0% paused state.
        if (restoreError instanceof ApiError && restoreError.status === 404) {
          void clearStoredUpload();
        }
        if (
          active &&
          restoreError instanceof ApiError &&
          restoreError.status === 404
        ) {
          setStoredConfluenceUpload(null);
          setUploadProgress(null);
          setUploadStats(null);
        }
      });
    return () => {
      active = false;
      confluenceUploadRequest.current?.abort();
    };
  }, []);

  async function uploadConfluence(resume = false) {
    const saved = resume ? storedConfluenceUpload : null;
    const selectedFile = saved?.file ?? confluenceFile;
    if (!selectedFile) return;
    setConfluencePending(true);
    setError(null);
    setUploadProgress(0);
    setUploadStats({
      loaded: 0,
      total: selectedFile.size,
      bytesPerSecond: 0,
      secondsRemaining: null,
    });
    try {
      const target = saved
        ? {
            archive_id: saved.archiveId,
            part_size_bytes: saved.partSize,
            uploaded_parts: (
              await apiFetch<ConfluenceUploadProgress>(
                `/api/v1/confluence-imports/archives/${saved.archiveId}/upload`,
              )
            ).uploaded_parts,
          }
        : await apiFetch<ConfluenceUploadTarget>(
            "/api/v1/confluence-imports/uploads",
            {
              method: "POST",
              body: {
                filename: selectedFile.name,
                size_bytes: selectedFile.size,
              },
            },
          );
      if (!saved) {
        const nextStored = {
          archiveId: target.archive_id,
          file: selectedFile,
          partSize: target.part_size_bytes,
        };
        await saveStoredUpload(nextStored);
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
      await apiFetch(
        `/api/v1/confluence-imports/archives/${target.archive_id}/complete-upload`,
        { method: "POST" },
      );
      await clearStoredUpload();
      setStoredConfluenceUpload(null);
      const archive = await apiFetch<ConfluenceArchive>(
        `/api/v1/confluence-imports/archives/${target.archive_id}/scan`,
        { method: "POST" },
      );
      setConfluenceArchive(archive);
      setSpaceFilter("");
      setSelectedSpaces(archive.spaces.map((space) => space.key));
      setImportAllSpaces(true);
      toast.success("Archive scanned. Choose the Spaces to import.");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        toast.info(
          "Upload paused. You can resume it when you return to this page.",
        );
      } else {
        setError(
          err instanceof ApiError
            ? err.message
            : "Could not upload or scan the Confluence archive.",
        );
      }
    } finally {
      confluenceUploadRequest.current = null;
      setIsUploading(false);
      setConfluencePending(false);
    }
  }

  function cancelConfluenceUpload() {
    confluenceUploadRequest.current?.abort();
  }

  async function abandonConfluenceUpload() {
    const archiveId = storedConfluenceUpload?.archiveId;
    setCancelUploadPending(true);
    cancelConfluenceUpload();
    // Make cancellation feel immediate. The server cleanup continues below;
    // its result cannot be allowed to leave the confirm dialog spinning.
    setConfirmCancelUpload(false);
    setStoredConfluenceUpload(null);
    setConfluenceFile(null);
    setConfluenceArchive(null);
    setUploadProgress(null);
    setUploadStats(null);
    setError(null);
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
      setError(
        cancelError instanceof ApiError
          ? cancelError.message
          : "Could not cancel the archive upload.",
      );
    } finally {
      setCancelUploadPending(false);
    }
  }

  function leaveWhileUploading() {
    if (!leaveTarget) return;
    // The application confirmation has already explained the consequence.
    // Suppress the browser's generic beforeunload prompt for this exact leave.
    allowConfirmedLeaveRef.current = true;
    cancelConfluenceUpload();
    window.location.assign(leaveTarget);
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
      setError(
        err instanceof ApiError ? err.message : "Could not queue the import.",
      );
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

  async function submitImport(dryRun: boolean) {
    if (!file) return;
    setPending(dryRun ? "preview" : "apply");
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("dry_run", String(dryRun));

      const result = await apiFetch<ImportReport>("/api/v1/backup/import", {
        method: "POST",
        rawBody: form,
      });
      setReport(result);
      if (!dryRun) {
        setConfirmApply(false);
        toast.success("Import applied.");
        router.refresh();
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not read the backup file.",
      );
      setConfirmApply(false);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* -- Export ------------------------------------------------------- */}
      <section className="border-border bg-surface rounded-xl border p-5 shadow-sm">
        <h2 className="text-base font-semibold">Export</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Downloads every account, space, membership and favourite as one JSON
          file. Page content is not included — that domain does not exist yet.
        </p>

        <label className="mt-4 flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={includeCredentials}
            onChange={(e) => setIncludeCredentials(e.target.checked)}
            className="accent-primary mt-0.5 size-4 cursor-pointer"
          />
          <span className="text-sm">
            Include password hashes
            <span className="text-muted-foreground block text-xs">
              Off by default. The file becomes an offline cracking target for
              every weak password in the instance — only enable it for a
              migration, and store the file accordingly. Without it, restored
              accounts need a password set before they can sign in.
            </span>
          </span>
        </label>

        <div className="mt-4">
          <Button
            type="button"
            variant="primary"
            disabled={isDownloading}
            aria-busy={isDownloading}
            onClick={() => void downloadBackup()}
          >
            {isDownloading ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Download />
            )}
            {isDownloading ? "Downloading..." : "Download backup"}
          </Button>
        </div>
      </section>

      {/* -- Confluence import ------------------------------------------ */}
      <section className="border-border bg-surface rounded-xl border p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <FileArchive className="text-primary size-4" />
              Import from Confluence
            </h2>
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
              Choose a Confluence site or space export archive to prepare it for
              import into WikiHub.
            </p>
          </div>
        </div>

        <div className="border-border bg-surface-sunken mt-4 rounded-md border border-dashed p-4">
          <Label>Confluence export archive</Label>
          <input
            id="confluence-backup-file"
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            disabled={confluencePending || Boolean(confluenceArchive)}
            onChange={(event) => {
              const nextFile = event.target.files?.[0] ?? null;
              const matchesInterruptedUpload =
                Boolean(nextFile) &&
                Boolean(storedConfluenceUpload) &&
                nextFile?.name === storedConfluenceUpload?.file.name &&
                nextFile?.size === storedConfluenceUpload?.file.size &&
                nextFile?.lastModified ===
                  storedConfluenceUpload?.file.lastModified;
              if (matchesInterruptedUpload) {
                setConfluenceFile(null);
                setConfluenceArchive(null);
                setUploadProgress((current) => current ?? 0);
                return;
              }
              if (storedConfluenceUpload) {
                void apiFetch(
                  `/api/v1/confluence-imports/archives/${storedConfluenceUpload.archiveId}/upload`,
                  { method: "DELETE" },
                );
              }
              setConfluenceFile(nextFile);
              setStoredConfluenceUpload(null);
              void clearStoredUpload();
              setConfluenceArchive(null);
              setConfluenceJob(null);
              setUploadProgress(null);
              setUploadStats(null);
              setIsUploading(false);
            }}
            className="sr-only"
          />
          <label
            className={cn(
              "border-border bg-surface hover:border-border-strong focus-within:ring-ring mt-2 flex h-10 w-full max-w-md items-center rounded-md border text-sm transition-[color,background-color,border-color,box-shadow] duration-150 focus-within:ring-2 focus-within:ring-offset-2",
              confluencePending || confluenceArchive
                ? "cursor-not-allowed opacity-50"
                : "cursor-pointer",
            )}
            htmlFor="confluence-backup-file"
            aria-disabled={confluencePending || Boolean(confluenceArchive)}
          >
            <span className="border-border bg-surface-sunken shrink-0 border-r px-3 py-2 font-medium">
              Choose file
            </span>
            <span
              className="text-muted-foreground min-w-0 flex-1 truncate px-3"
              title={storedConfluenceUpload?.file.name ?? confluenceFile?.name}
            >
              {storedConfluenceUpload?.file.name ??
                confluenceFile?.name ??
                "No file selected"}
            </span>
          </label>
          <p className="text-muted-foreground mt-2 text-xs">
            Accepted format: <code className="font-mono">.zip</code> archive
            exported by Confluence. It uploads directly to protected object
            storage.
            {confluenceArchive
              ? " Finish or clear this space selection before choosing another archive."
              : null}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {isUploading ? (
              <>
                <Button variant="secondary" onClick={cancelConfluenceUpload}>
                  <Pause /> Pause upload
                </Button>
                <Button
                  variant="danger"
                  disabled={cancelUploadPending}
                  onClick={() => setConfirmCancelUpload(true)}
                >
                  Cancel upload
                </Button>
              </>
            ) : !isFinalizingArchive ? (
              <>
                <Button
                  variant="secondary"
                  disabled={
                    (!confluenceFile && !storedConfluenceUpload) ||
                    confluencePending ||
                    Boolean(confluenceArchive)
                  }
                  onClick={() =>
                    void uploadConfluence(Boolean(storedConfluenceUpload))
                  }
                >
                  {confluencePending && !confluenceArchive ? (
                    <Loader2 className="animate-spin" />
                  ) : storedConfluenceUpload ? (
                    <Play />
                  ) : (
                    <Upload />
                  )}{" "}
                  {storedConfluenceUpload ? "Resume upload" : "Upload and scan"}
                </Button>
                {storedConfluenceUpload && !confluenceArchive ? (
                  <Button
                    variant="danger"
                    disabled={cancelUploadPending}
                    onClick={() => setConfirmCancelUpload(true)}
                  >
                    Cancel upload
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        {isFinalizingArchive ? (
          <div
            className="border-info/25 bg-info-bg mt-3 flex gap-2.5 rounded-md border p-3 text-sm"
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

        {uploadProgress !== null &&
        !confluenceArchive &&
        !isFinalizingArchive ? (
          <div
            className="border-info/25 bg-info-bg mt-3 rounded-md border p-3 text-sm"
            role="status"
          >
            <div className="flex gap-2.5">
              <Info className="text-info mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p>
                  {isUploading ? "Uploading" : "Upload paused"}{" "}
                  <span className="font-medium">
                    {confluenceFile?.name ?? storedConfluenceUpload?.file.name}
                  </span>
                  : {uploadProgress}%
                </p>
                <div
                  aria-label={`Upload ${uploadProgress}% complete`}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={uploadProgress}
                  className="bg-surface mt-2 h-2 overflow-hidden rounded-full"
                  role="progressbar"
                >
                  <div
                    className="bg-info h-full duration-150 motion-safe:transition-[width]"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <div className="text-muted-foreground mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs">
                  <span>
                    {formatBytes(uploadStats?.loaded ?? 0)} /{" "}
                    {formatBytes(
                      uploadStats?.total ??
                        confluenceFile?.size ??
                        storedConfluenceUpload?.file.size ??
                        0,
                    )}
                  </span>
                  {isUploading ? (
                    <>
                      <span>
                        {uploadStats && uploadStats.bytesPerSecond > 0
                          ? `${formatBytes(uploadStats.bytesPerSecond)}/s`
                          : "Calculating speed…"}
                      </span>
                      <span>
                        {formatDuration(uploadStats?.secondsRemaining ?? null)}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {confluenceArchive ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {confluenceArchive.spaces.length} Space(s) found
              </p>
              <label
                className={cn(
                  "flex items-center gap-2 text-sm",
                  importInProgress && "cursor-not-allowed opacity-60",
                )}
              >
                <input
                  type="checkbox"
                  checked={importAllSpaces}
                  disabled={importInProgress}
                  onChange={(event) => {
                    const nextImportAll = event.target.checked;
                    setImportAllSpaces(nextImportAll);
                    setSelectedSpaces(
                      nextImportAll
                        ? confluenceArchive.spaces.map((space) => space.key)
                        : [],
                    );
                  }}
                  className="accent-primary size-4"
                />{" "}
                Import all spaces
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-52 flex-1">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                <Input
                  type="search"
                  value={spaceFilter}
                  disabled={importInProgress}
                  onChange={(event) => setSpaceFilter(event.target.value)}
                  placeholder="Filter by space name or key"
                  aria-label="Filter spaces to import"
                  className="pl-9"
                />
              </div>
              <span
                className="text-muted-foreground text-xs"
                aria-live="polite"
              >
                {filteredConfluenceSpaces.length} of{" "}
                {confluenceArchive.spaces.length} shown
              </span>
            </div>
            <div className="border-border max-h-64 overflow-y-auto rounded-md border">
              {filteredConfluenceSpaces.length ? (
                filteredConfluenceSpaces.map((space) => (
                  <label
                    key={space.key}
                    className={cn(
                      "border-border flex items-center gap-3 border-b px-3 py-2 text-sm last:border-0",
                      importInProgress
                        ? "cursor-not-allowed opacity-60"
                        : "hover:bg-surface-sunken cursor-pointer",
                    )}
                  >
                    <input
                      type="checkbox"
                      disabled={importInProgress}
                      checked={selectedSpaces.includes(space.key)}
                      onChange={(event) => {
                        const nextSelected = event.target.checked
                          ? [...selectedSpaces, space.key]
                          : selectedSpaces.filter((key) => key !== space.key);
                        const availableCount = confluenceArchive.spaces.length;
                        setSelectedSpaces(nextSelected);
                        setImportAllSpaces(
                          nextSelected.length === availableCount,
                        );
                      }}
                      className="accent-primary size-4"
                    />
                    <span className="font-medium">{space.name}</span>
                    <span className="text-muted-foreground">
                      {space.key} · {space.page_count} pages
                    </span>
                    {space.conflict ? (
                      <Badge variant="warning">will replace existing</Badge>
                    ) : null}
                  </label>
                ))
              ) : (
                <p className="text-muted-foreground px-3 py-6 text-center text-sm">
                  No spaces match “{spaceFilter}”.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={
                  importInProgress ||
                  confluencePending ||
                  (!importAllSpaces && selectedSpaces.length === 0)
                }
                onClick={requestConfluenceImport}
              >
                {confluencePending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Upload />
                )}{" "}
                Start import
              </Button>
              <Button
                variant="secondary"
                disabled={importInProgress}
                onClick={() => {
                  const nextSelected = Array.from(
                    new Set([
                      ...selectedSpaces,
                      ...filteredConfluenceSpaces.map((space) => space.key),
                    ]),
                  );
                  const availableCount = confluenceArchive.spaces.length;
                  setSelectedSpaces(nextSelected);
                  setImportAllSpaces(nextSelected.length === availableCount);
                }}
              >
                {normalizedSpaceFilter ? "Select visible" : "Select all"}
              </Button>
              <Button
                variant="ghost"
                disabled={importInProgress}
                onClick={() => {
                  setSelectedSpaces([]);
                  setImportAllSpaces(false);
                }}
              >
                Clear selection
              </Button>
            </div>
          </div>
        ) : null}

        {confluenceJob ? (
          <div className="border-border bg-surface-raised mt-4 rounded-lg border p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="text-base font-semibold">{jobTitle}</p>
              <p className="hidden">
                Import {confluenceJob.status} · {confluenceJob.phase}
              </p>
              <Badge
                variant={
                  confluenceJob.status === "completed"
                    ? "success"
                    : confluenceJob.status === "failed"
                      ? "danger"
                      : "info"
                }
              >
                {confluenceJob.status}
              </Badge>
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              {Math.round(jobProgressPercent)}% complete · {jobSpacesCompleted}/
              {jobSpacesTotal} spaces · {jobPagesSummary}
            </p>
            <p className="hidden">
              {Math.round(jobProgressPercent)}% complete · {jobSpacesCompleted}/
              {jobSpacesTotal} spaces ·{" "}
              {confluenceJob.counters.pages_processed ?? 0}/
              {confluenceJob.counters.pages_total ?? 0} pages
            </p>
            <p className="hidden">
              {confluenceJob.counters.spaces_completed ?? 0}/
              {confluenceJob.counters.spaces_total ?? 0} spaces ·{" "}
              {confluenceJob.counters.pages_processed ?? 0} pages
            </p>
            <div
              className="bg-surface-sunken mt-3 h-2 overflow-hidden rounded-full"
              aria-label={`${Math.round(jobProgressPercent)}% of import complete`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={Math.round(jobProgressPercent)}
              role="progressbar"
            >
              <div
                className="bg-primary h-full transition-[width] duration-300"
                style={{
                  width: `${jobProgressPercent}%`,
                }}
              />
            </div>
            {confluenceJob.phase === "downloading" ? (
              <p className="text-muted-foreground mt-2 text-xs">
                Downloading archive:{" "}
                {formatBytes(confluenceJob.counters.downloaded_bytes ?? 0)} /{" "}
                {formatBytes(confluenceJob.counters.download_total_bytes ?? 0)}{" "}
                ({displayedDownloadPercent}%)
              </p>
            ) : null}
            {!["completed", "failed", "cancelled"].includes(
              confluenceJob.status,
            ) ? (
              <Button
                className="mt-3"
                variant="danger"
                size="sm"
                disabled={confluenceCancelPending}
                onClick={async () => {
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
                    setError(
                      cancelError instanceof ApiError
                        ? cancelError.message
                        : "Could not cancel the import.",
                    );
                  } finally {
                    setConfluenceCancelPending(false);
                  }
                }}
              >
                {confluenceCancelPending ? "Cancelling..." : "Cancel"}
              </Button>
            ) : null}
            {confluenceLogs.length ? (
              <details
                className="border-border bg-surface mt-4 rounded-md border"
                open
              >
                <summary className="hover:bg-surface-hover cursor-pointer px-3 py-2 text-sm font-medium transition-colors duration-150">
                  Import activity ({confluenceLogs.length})
                </summary>
                <ul className="border-border max-h-44 divide-y overflow-y-auto border-t text-xs">
                  {confluenceLogs.map((log) => (
                    <li key={log.id} className="px-3 py-2">
                      <span className="font-medium">{log.level}</span> ·{" "}
                      {log.entity_label ? `${log.entity_label}: ` : ""}
                      {log.message}
                      {log.phase === "downloading" && !log.message.includes("%")
                        ? ` (${displayedDownloadPercent}%)`
                        : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* -- Import ------------------------------------------------------- */}
      <section className="border-border bg-surface rounded-xl border p-5 shadow-sm">
        <h2 className="text-base font-semibold">Restore</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Upload a backup to preview what it would change. Existing usernames
          and space keys are <strong>skipped, never overwritten</strong>, and
          the built-in administrator is always left untouched.
        </p>

        <div className="mt-4 space-y-2">
          <Label htmlFor="backup-file">Backup file</Label>
          <input
            id="backup-file"
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setReport(null);
              setError(null);
            }}
            className="border-border bg-surface file:bg-surface-sunken file:text-foreground hover:border-border-strong block w-full max-w-md cursor-pointer rounded-md border text-sm transition-colors duration-150 file:mr-3 file:cursor-pointer file:border-0 file:px-3 file:py-2 file:text-sm"
          />
        </div>

        {error ? (
          <p
            role="alert"
            className="border-danger/30 bg-danger/10 text-danger mt-3 rounded-md border px-3 py-2 text-sm"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={!file || pending !== null}
            onClick={() => submitImport(true)}
          >
            {pending === "preview" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Upload />
            )}
            Preview changes
          </Button>
          <Button
            variant="primary"
            disabled={!report || report.dry_run === false || pending !== null}
            onClick={() => setConfirmApply(true)}
          >
            Apply import
          </Button>
        </div>
      </section>

      {/* -- Report ------------------------------------------------------- */}
      {report ? (
        <section className="border-border bg-surface rounded-xl border p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">
              {report.dry_run ? "Preview" : "Import result"}
            </h2>
            <Badge variant={report.dry_run ? "info" : "success"}>
              {report.dry_run ? "nothing written" : "applied"}
            </Badge>
            {report.includes_credentials ? (
              <Badge variant="warning">includes credentials</Badge>
            ) : null}
          </div>

          <div className="mt-4 grid gap-5 sm:grid-cols-3">
            <CountList title="Created" counts={report.created} />
            <CountList title="Skipped" counts={report.skipped} />
            <CountList title="Errors" counts={report.errors} />
          </div>

          {report.users_without_password.length > 0 ? (
            <div className="border-warning/30 bg-warning-bg mt-4 flex gap-2.5 rounded-md border p-3">
              <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" />
              <div className="text-sm">
                <p className="font-medium">
                  {report.users_without_password.length} account(s) cannot sign
                  in yet
                </p>
                <p className="text-muted-foreground mt-0.5">
                  The backup carried no password hashes. Set a password for each
                  from the Users tab:{" "}
                  {report.users_without_password.slice(0, 10).join(", ")}
                  {report.users_without_password.length > 10 ? "…" : ""}
                </p>
              </div>
            </div>
          ) : null}

          {report.entries.length > 0 ? (
            <details className="mt-4">
              <summary className="hover:text-foreground text-muted-foreground cursor-pointer text-sm transition-colors duration-150">
                Per-item detail ({report.entries.length}
                {report.entries_truncated ? ", truncated" : ""})
              </summary>
              <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-sm">
                {report.entries.map((entry, index) => (
                  <li key={`${entry.kind}-${entry.label}-${index}`}>
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
        </section>
      ) : null}

      <ConfirmDialog
        open={confirmApply}
        onOpenChange={setConfirmApply}
        title="Apply this import?"
        description="Rows shown as 'created' in the preview will be written. Existing accounts and spaces are left untouched. This cannot be undone automatically — export a backup first if you are unsure."
        confirmLabel="Apply import"
        pending={pending === "apply"}
        onConfirm={() => submitImport(false)}
      />
      <ConfirmDialog
        open={leaveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setLeaveTarget(null);
        }}
        title="Pause this upload and leave?"
        description="The current part will stop. Completed parts and your selected archive stay on this device, so you can resume the upload from this page later."
        confirmLabel="Pause and leave"
        onConfirm={leaveWhileUploading}
      />
      <ConfirmDialog
        open={confirmCancelUpload}
        onOpenChange={setConfirmCancelUpload}
        title="Cancel this upload?"
        description="This discards the uploaded parts and removes the saved archive from this browser. You will need to select the file and start again."
        confirmLabel="Cancel upload"
        destructive
        pending={cancelUploadPending}
        onConfirm={() => void abandonConfluenceUpload()}
      />
      <ConfirmDialog
        open={confirmOverwriteSpaces}
        onOpenChange={setConfirmOverwriteSpaces}
        title="Replace existing spaces?"
        description={`This will permanently replace ${conflictingSelectedSpaces.length} existing ${conflictingSelectedSpaces.length === 1 ? "space" : "spaces"}: ${overwriteSpaceSummary}. Their current pages and memberships will be deleted before the archive version is imported.`}
        confirmLabel="Replace and import"
        destructive
        pending={confluencePending}
        onConfirm={() => void startConfluenceImport(true)}
      />
    </div>
  );
}
