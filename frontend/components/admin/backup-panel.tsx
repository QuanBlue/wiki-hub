"use client";

import {
  AlertTriangle,
  ChevronDown,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
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
  SiteSettings,
} from "@/types/api";

type UploadStats = {
  loaded: number;
  total: number;
  bytesPerSecond: number;
  secondsRemaining: number | null;
};

type HashStats = {
  loaded: number;
  total: number;
  bytesPerSecond: number;
  secondsRemaining: number | null;
};

type StoredConfluenceUpload = {
  archiveId: string;
  file?: File;
  fileName: string;
  fileSize: number;
  fileLastModified: number | null;
  sha256: string | null;
  partSize: number;
};

const CONFLUENCE_UPLOAD_METADATA_KEY = "wikihub-confluence-upload-current";
const CONFLUENCE_CANCELLED_UPLOADS_KEY = "wikihub-confluence-cancelled-uploads";
const SESSION_EXPIRED_UPLOAD_MESSAGE =
  "Your session expired while uploading. Sign in again, then return here and resume the upload; completed parts are still kept.";

type StoredConfluenceUploadRecord = Partial<StoredConfluenceUpload> & {
  archiveId: string;
  partSize: number;
};

function normalizeStoredUpload(
  upload: StoredConfluenceUploadRecord | null | undefined,
): StoredConfluenceUpload | null {
  if (!upload) return null;
  const file =
    typeof File !== "undefined" && upload.file instanceof File
      ? upload.file
      : undefined;
  const fileName = upload.fileName ?? file?.name;
  const fileSize = upload.fileSize ?? file?.size;
  const fileLastModified =
    upload.fileLastModified !== undefined
      ? upload.fileLastModified
      : file?.lastModified;
  if (
    !upload.archiveId ||
    !upload.partSize ||
    !fileName ||
    fileSize === undefined ||
    fileLastModified === undefined
  ) {
    return null;
  }
  return {
    archiveId: upload.archiveId,
    file,
    fileName,
    fileSize,
    fileLastModified,
    sha256: upload.sha256 ?? null,
    partSize: upload.partSize,
  };
}

function storedUploadMetadata(upload: StoredConfluenceUpload) {
  return {
    archiveId: upload.archiveId,
    fileName: upload.fileName,
    fileSize: upload.fileSize,
    fileLastModified: upload.fileLastModified,
    sha256: upload.sha256,
    partSize: upload.partSize,
  };
}

function readStoredUploadMetadata(): StoredConfluenceUpload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CONFLUENCE_UPLOAD_METADATA_KEY);
    if (!raw) return null;
    return normalizeStoredUpload(
      JSON.parse(raw) as StoredConfluenceUploadRecord,
    );
  } catch {
    return null;
  }
}

function saveStoredUploadMetadata(upload: StoredConfluenceUpload): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CONFLUENCE_UPLOAD_METADATA_KEY,
      JSON.stringify(storedUploadMetadata(upload)),
    );
  } catch {
    // Metadata is only a resumability hint. If browser storage is unavailable,
    // the server-side active upload endpoint can still recover the archive.
  }
}

function clearStoredUploadMetadata(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CONFLUENCE_UPLOAD_METADATA_KEY);
  } catch {
    // Ignore storage failures; clearing in-memory state still keeps the UI safe.
  }
}

function readCancelledUploadIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(CONFLUENCE_CANCELLED_UPLOADS_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(ids) ? ids.filter(Boolean).map(String) : []);
  } catch {
    return new Set();
  }
}

function rememberCancelledUpload(archiveId: string | null | undefined): void {
  if (!archiveId || typeof window === "undefined") return;
  try {
    const ids = [archiveId, ...readCancelledUploadIds()].slice(0, 20);
    window.localStorage.setItem(
      CONFLUENCE_CANCELLED_UPLOADS_KEY,
      JSON.stringify([...new Set(ids)]),
    );
  } catch {
    // The server-side delete remains the source of truth. This local marker only
    // prevents a just-cancelled upload from flashing back into the UI.
  }
}

function forgetCancelledUpload(archiveId: string | null | undefined): void {
  if (!archiveId || typeof window === "undefined") return;
  try {
    const ids = [...readCancelledUploadIds()].filter((id) => id !== archiveId);
    if (ids.length) {
      window.localStorage.setItem(
        CONFLUENCE_CANCELLED_UPLOADS_KEY,
        JSON.stringify(ids),
      );
    } else {
      window.localStorage.removeItem(CONFLUENCE_CANCELLED_UPLOADS_KEY);
    }
  } catch {
    // Ignore storage failures; starting a new upload still creates a fresh
    // archive id, so it will not be confused with the cancelled one.
  }
}

function fileMatchesStoredUpload(
  file: File | null,
  upload: StoredConfluenceUpload | null,
) {
  return Boolean(
    file &&
    upload &&
    file.name === upload.fileName &&
    file.size === upload.fileSize &&
    (upload.fileLastModified === null ||
      file.lastModified === upload.fileLastModified),
  );
}

function serverUploadToStoredUpload(
  upload: ConfluenceUploadProgress,
): StoredConfluenceUpload {
  return {
    archiveId: upload.archive_id,
    fileName: upload.filename,
    fileSize: upload.size_bytes,
    fileLastModified: null,
    sha256: upload.sha256,
    partSize: upload.part_size_bytes,
  };
}

async function readStoredUpload(): Promise<StoredConfluenceUpload | null> {
  return readStoredUploadMetadata();
}

async function saveStoredUpload(upload: StoredConfluenceUpload): Promise<void> {
  saveStoredUploadMetadata(upload);
  // Never persist the File object itself. Large Confluence archives can be tens
  // of GB; cloning that blob into IndexedDB can freeze the tab before upload
  // starts. The browser only keeps file read permission for the current page
  // lifetime, so after navigation the user must reselect the same archive.
}

async function clearStoredUpload(): Promise<void> {
  clearStoredUploadMetadata();
  // Current resumability uses lightweight metadata plus the server-side active
  // upload record. Legacy IndexedDB file caches are intentionally ignored.
}

const SHA256_INITIAL_STATE = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
];

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

class IncrementalSha256 {
  private state = [...SHA256_INITIAL_STATE];
  private buffer = new Uint8Array(64);
  private bufferLength = 0;
  private bytesHashed = 0;
  private finished = false;
  private readonly words = new Uint32Array(64);

  update(data: Uint8Array): void {
    if (this.finished) throw new Error("SHA-256 digest is already finalized.");
    let position = 0;
    this.bytesHashed += data.length;
    while (position < data.length) {
      const take = Math.min(64 - this.bufferLength, data.length - position);
      this.buffer.set(
        data.subarray(position, position + take),
        this.bufferLength,
      );
      this.bufferLength += take;
      position += take;
      if (this.bufferLength === 64) {
        this.hashBlock(this.buffer);
        this.bufferLength = 0;
      }
    }
  }

  digest(): string {
    if (this.finished) throw new Error("SHA-256 digest is already finalized.");
    this.finished = true;
    const bitLengthHigh = Math.floor((this.bytesHashed * 8) / 0x100000000);
    const bitLengthLow = (this.bytesHashed * 8) >>> 0;
    this.buffer[this.bufferLength++] = 0x80;
    if (this.bufferLength > 56) {
      this.buffer.fill(0, this.bufferLength, 64);
      this.hashBlock(this.buffer);
      this.bufferLength = 0;
    }
    this.buffer.fill(0, this.bufferLength, 56);
    this.buffer[56] = bitLengthHigh >>> 24;
    this.buffer[57] = bitLengthHigh >>> 16;
    this.buffer[58] = bitLengthHigh >>> 8;
    this.buffer[59] = bitLengthHigh;
    this.buffer[60] = bitLengthLow >>> 24;
    this.buffer[61] = bitLengthLow >>> 16;
    this.buffer[62] = bitLengthLow >>> 8;
    this.buffer[63] = bitLengthLow;
    this.hashBlock(this.buffer);
    return this.state
      .map((word) => word.toString(16).padStart(8, "0"))
      .join("");
  }

  private hashBlock(block: Uint8Array): void {
    for (let index = 0; index < 16; index += 1) {
      const offset = index * 4;
      this.words[index] =
        ((block[offset] << 24) |
          (block[offset + 1] << 16) |
          (block[offset + 2] << 8) |
          block[offset + 3]) >>>
        0;
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 =
        rotateRight(this.words[index - 15], 7) ^
        rotateRight(this.words[index - 15], 18) ^
        (this.words[index - 15] >>> 3);
      const s1 =
        rotateRight(this.words[index - 2], 17) ^
        rotateRight(this.words[index - 2], 19) ^
        (this.words[index - 2] >>> 10);
      this.words[index] =
        (this.words[index - 16] + s0 + this.words[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = this.state;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 =
        (h + s1 + choice + SHA256_K[index] + this.words[index]) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    this.state[0] = (this.state[0] + a) >>> 0;
    this.state[1] = (this.state[1] + b) >>> 0;
    this.state[2] = (this.state[2] + c) >>> 0;
    this.state[3] = (this.state[3] + d) >>> 0;
    this.state[4] = (this.state[4] + e) >>> 0;
    this.state[5] = (this.state[5] + f) >>> 0;
    this.state[6] = (this.state[6] + g) >>> 0;
    this.state[7] = (this.state[7] + h) >>> 0;
  }
}

async function sha256File(
  file: File,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (typeof window !== "undefined" && window.crypto?.subtle) {
    try {
      const SAFE_MAX_SIZE = 1.5 * 1024 * 1024 * 1024; // 1.5 GB
      if (file.size <= SAFE_MAX_SIZE) {
        const arrayBuffer = await file.arrayBuffer();
        if (signal?.aborted) {
          throw new DOMException("Fingerprint cancelled.", "AbortError");
        }
        const hashBuffer = await window.crypto.subtle.digest("SHA-256", arrayBuffer);
        if (signal?.aborted) {
          throw new DOMException("Fingerprint cancelled.", "AbortError");
        }
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        onProgress(file.size);
        return hashHex;
      }
    } catch (error) {
      console.warn("Native SHA-256 calculation failed, falling back to incremental JS implementation:", error);
    }
  }

  const hasher = new IncrementalSha256();
  const chunkSize = 8 * 1024 * 1024;
  let offset = 0;
  while (offset < file.size) {
    if (signal?.aborted) {
      throw new DOMException("Fingerprint cancelled.", "AbortError");
    }
    const chunk = file.slice(offset, offset + chunkSize);
    hasher.update(new Uint8Array(await chunk.arrayBuffer()));
    offset += chunk.size;
    onProgress(Math.min(offset, file.size));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  if (signal?.aborted) {
    throw new DOMException("Fingerprint cancelled.", "AbortError");
  }
  return hasher.digest();
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
  const confluenceFileInput = useRef<HTMLInputElement>(null);
  const confluenceUploadRequest = useRef<XMLHttpRequest | null>(null);
  const confluenceHashAbort = useRef<AbortController | null>(null);
  const uploadPauseReason = useRef<
    "pause" | "cancel" | "session-expired" | null
  >(null);
  const uploadRestoreRun = useRef(0);
  const storedConfluenceUploadRef = useRef<StoredConfluenceUpload | null>(null);
  const uploadActiveRef = useRef(false);
  const allowConfirmedLeaveRef = useRef(false);
  const logsListRef = useRef<HTMLUListElement>(null);

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
  const [report, setReport] = useState<ImportReport | null>(null);
  const [pending, setPending] = useState<"preview" | "apply" | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [confirmDiscardArchive, setConfirmDiscardArchive] = useState(false);
  const [discardingArchivePending, setDiscardingArchivePending] = useState(false);
  const [confirmCancelUpload, setConfirmCancelUpload] = useState(false);
  const [confirmOverwriteSpaces, setConfirmOverwriteSpaces] = useState(false);
  const [cancelUploadPending, setCancelUploadPending] = useState(false);
  const [leaveTarget, setLeaveTarget] = useState<string | null>(null);
  const [confluenceUploadError, setConfluenceUploadError] = useState<
    string | null
  >(null);
  const [confluenceUploadNotice, setConfluenceUploadNotice] = useState<
    string | null
  >(null);
  const [siteSettings, setSiteSettings] = useState<SiteSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [isSpaceModalOpen, setIsSpaceModalOpen] = useState(false);
  const [isImportSuccessModalOpen, setIsImportSuccessModalOpen] = useState(false);

  // Modal is opened explicitly by the user clicking "Select spaces & import".
  // Closing happens when a job starts or the archive is discarded.
  useEffect(() => {
    if (confluenceJob || !confluenceArchive) {
      setIsSpaceModalOpen(false);
    }
  }, [confluenceArchive, confluenceJob]);

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
  const confluenceArchiveName =
    storedConfluenceUpload?.fileName ?? confluenceFile?.name ?? null;

  const displayConfluenceLogs = useMemo(() => {
    const result: ConfluenceImportLog[] = [];
    let foundDownloadLog = false;
    for (const log of confluenceLogs) {
      if (log.message.startsWith("Downloading archive to worker scratch space:")) {
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
  const hashProgress = hashStats
    ? Math.round((hashStats.loaded / Math.max(1, hashStats.total)) * 100)
    : null;
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
    : confluenceJob.status === "completed" || confluenceJob.status === "cancelled"
      ? 100
      : confluenceJob.status === "queued"
        ? 0
        : confluenceJob.phase === "downloading"
          ? jobDownloadPercent
          : confluenceJob.phase === "scanning"
            ? 100
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
                ? "Importing spaces"
                : "Import queued";
  const jobPagesSummary = confluenceJob?.counters.pages_total
    ? `${confluenceJob.counters.pages_processed ?? 0}/${confluenceJob.counters.pages_total} pages`
    : `${confluenceJob?.counters.pages_processed ?? 0} pages`;

  async function renewUploadSession() {
    await apiFetch<void>("/api/v1/auth/renew", { method: "POST" });
  }

  const appendPreparationLog = useCallback((message: string) => {
    const time = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date());
    setPreparationLogs((current) => [...current, `${time} - ${message}`]);
  }, []);

  // A real link, not a fetch: the browser handles the Content-Disposition
  // attachment itself, the session cookie rides along, and right-click
  // "save as" works. Fetching the JSON into memory only to re-wrap it in a
  // blob URL would buy nothing.
  const exportHref = `${PUBLIC_API_BASE_URL}/api/v1/backup/export${
    includeCredentials ? "?include_credentials=true" : ""
  }`;

  useEffect(() => {
    uploadActiveRef.current = confluencePending;
  }, [confluencePending]);

  useEffect(() => {
    storedConfluenceUploadRef.current = storedConfluenceUpload;
  }, [storedConfluenceUpload]);

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
        let finalLogs = logs.items;
        if (job.status === "completed" && confluenceJob.status !== "completed") {
          toast.success("Confluence import completed successfully!");
          const successLog: ConfluenceImportLog = {
            id: "local-success-log",
            level: "INFO",
            phase: "completed",
            entity_type: null,
            entity_label: null,
            message: "Import completed successfully!",
            created_at: new Date().toISOString(),
          };
          finalLogs = [...finalLogs, successLog];
          setIsImportSuccessModalOpen(true);
        }
        setConfluenceJob(job);
        setConfluenceLogs(finalLogs);
      } catch {
        /* next poll reports a recoverable API failure */
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [confluenceJob]);

  const restoreActiveConfluenceJob = useCallback(async () => {
    try {
      const jobs = await apiFetch<ConfluenceImportJob[]>("/api/v1/confluence-imports/jobs");
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
    void restoreActiveConfluenceJob();
  }, [restoreActiveConfluenceJob]);

  // Load site settings on mount
  useEffect(() => {
    void apiFetch<SiteSettings>("/api/v1/settings")
      .then((settings) => setSiteSettings(settings))
      .catch(() => {
        // Fallback is handled gracefully by not blocking uploads
      });
  }, []);

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

      // ── Cross-tab sync: if a scanned archive is waiting for space selection,
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
          restoreError instanceof ApiError
            ? restoreError.message
            : "Could not refresh the saved upload progress. You can still try Resume upload.",
        );
      }
    }
  }, [appendPreparationLog]);

  // Keep only lightweight upload metadata in localStorage. Never cache the File
  // itself: large Confluence archives can freeze the tab while the browser tries
  // to clone them into storage. Restore on focus/pageshow too because settings
  // tabs and browser bfcache may not remount this component when users return.
  useEffect(() => {
    const restore = () => {
      void restoreStoredConfluenceUpload();
      void restoreActiveConfluenceJob();
    };
    const initialRestore = window.setTimeout(restore, 0);
    const restoreWhenVisible = () => {
      if (document.visibilityState === "visible") restore();
    };
    const restoreFromStorage = (event: StorageEvent) => {
      if (event.key === CONFLUENCE_UPLOAD_METADATA_KEY) restore();
    };
    window.addEventListener("focus", restore);
    window.addEventListener("pageshow", restore);
    window.addEventListener("storage", restoreFromStorage);
    document.addEventListener("visibilitychange", restoreWhenVisible);
    return () => {
      uploadRestoreRun.current += 1;
      uploadPauseReason.current = "pause";
      confluenceUploadRequest.current?.abort();
      confluenceHashAbort.current?.abort();
      window.clearTimeout(initialRestore);
      window.removeEventListener("focus", restore);
      window.removeEventListener("pageshow", restore);
      window.removeEventListener("storage", restoreFromStorage);
      document.removeEventListener("visibilitychange", restoreWhenVisible);
    };
  }, [restoreStoredConfluenceUpload, restoreActiveConfluenceJob]);

  async function uploadConfluence(resume = false) {
    const saved = resume ? storedConfluenceUpload : null;
    const selectedFile = saved?.file ?? confluenceFile;
    if (!selectedFile) {
      if (saved) {
        setConfluenceUploadError(
          "Select the same archive file again to resume this interrupted upload.",
        );
      }
      return;
    }
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
          `Archive exceeds the configured ${settings.effective.max_backup_import_size_mb} MB limit.`,
        );
        return;
      }
    }

    setConfluencePending(true);
    setConfluenceUploadError(null);
    setConfluenceUploadNotice(null);
    uploadPauseReason.current = null;
    let sessionRenewalTimer: number | null = null;
    let preparingArchive = false;
    if (!saved) {
      setPreparationLogs([]);
      setPreparationLogsExpanded(true);
      setUploadProgress(0);
      setUploadStats({
        loaded: 0,
        total: selectedFile.size,
        bytesPerSecond: 0,
        secondsRemaining: null,
      });
    } else if (uploadProgress === null) {
      setUploadProgress(0);
      setUploadStats({
        loaded: 0,
        total: selectedFile.size,
        bytesPerSecond: 0,
        secondsRemaining: null,
      });
    }
    try {
      await renewUploadSession();
      sessionRenewalTimer = window.setInterval(
        () => {
          void renewUploadSession().catch((renewError) => {
            if (renewError instanceof ApiError && renewError.status === 401) {
              uploadPauseReason.current = "session-expired";
              setConfluenceUploadError(SESSION_EXPIRED_UPLOAD_MESSAGE);
              confluenceUploadRequest.current?.abort();
            }
          });
        },
        5 * 60 * 1000,
      );
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
      let resumeArchive = saved;
      if (resumeArchive?.sha256 && resumeArchive.sha256 !== selectedSha256) {
        rememberCancelledUpload(resumeArchive.archiveId);
        void clearStoredUpload();
        void apiFetch(
          `/api/v1/confluence-imports/archives/${resumeArchive.archiveId}/upload`,
          { method: "DELETE" },
        ).catch(() => {
          // The selected file is different. Do not let the abandoned upload
          // come back into the UI even if server cleanup is delayed.
        });
        resumeArchive = null;
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
        rememberCancelledUpload(resumeArchive.archiveId);
        void clearStoredUpload();
        void apiFetch(
          `/api/v1/confluence-imports/archives/${resumeArchive.archiveId}/upload`,
          { method: "DELETE" },
        ).catch(() => {
          // Best-effort cleanup only; the local cancelled marker is enough to
          // keep this stale upload out of the current workflow.
        });
        resumeArchive = null;
      }
      const target = resumeArchive
        ? {
            archive_id: resumeArchive.archiveId,
            part_size_bytes: resumeArchive.partSize,
            uploaded_parts: resumeProgress?.uploaded_parts ?? [],
            status: "uploading",
            sha256: selectedSha256,
            reused: false,
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
      await apiFetch(
        `/api/v1/confluence-imports/archives/${target.archive_id}/complete-upload`,
        { method: "POST" },
      );
      appendPreparationLog("Multipart upload completed. Scanning archive.");
      await clearStoredUpload();
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
          err instanceof ApiError
            ? err.message
            : "Could not upload or scan the Confluence archive.",
        );
      }
    } finally {
      if (sessionRenewalTimer !== null) {
        window.clearInterval(sessionRenewalTimer);
      }
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
    // Make cancellation feel immediate. The server cleanup continues below;
    // its result cannot be allowed to leave the confirm dialog spinning.
    setConfirmCancelUpload(false);
    storedConfluenceUploadRef.current = null;
    setStoredConfluenceUpload(null);
    setConfluenceFile(null);
    setConfluenceArchive(null);
    setUploadProgress(null);
    setUploadStats(null);
    setHashStats(null);
    setPreparationLogs([]);
    setConfluenceUploadError(null);
    setConfluenceUploadNotice(
      "Upload cancelled. Choose a file to start a new import.",
    );
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
      setConfluenceUploadError(
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
    cancelConfluenceUpload("pause");
    window.location.assign(leaveTarget);
  }

  /** Discard a scanned archive from the server and reset the import UI so the
   * user can upload a different file. Safe to call both from the inline banner
   * and from inside the space-selection modal. */
  async function discardConfluenceArchive() {
    if (!confluenceArchive) return;
    const archiveId = confluenceArchive.id;
    setDiscardingArchivePending(true);
    try {
      setIsSpaceModalOpen(false);
      setConfluenceArchive(null);
      setConfluenceFile(null);
      storedConfluenceUploadRef.current = null;
      setStoredConfluenceUpload(null);
      setUploadProgress(null);
      setUploadStats(null);
      setHashStats(null);
      setPreparationLogs([]);
      setConfluenceUploadError(null);
      setConfluenceUploadNotice(
        "Archive discarded. Choose a file to start a new import.",
      );
      void clearStoredUpload();
      rememberCancelledUpload(archiveId);
      await apiFetch(
        `/api/v1/confluence-imports/archives/${archiveId}/upload`,
        { method: "DELETE" },
      );
      toast.success("Archive discarded.");
    } catch {
      // Best-effort – the cancelled marker prevents it from appearing again.
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
            ref={confluenceFileInput}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            disabled={confluencePending || Boolean(confluenceArchive) || importInProgress}
            onChange={(event) => {
              const nextFile = event.target.files?.[0] ?? null;
              if (nextFile && siteSettings?.effective?.max_backup_import_size_bytes) {
                if (nextFile.size > siteSettings.effective.max_backup_import_size_bytes) {
                  setConfluenceUploadError(
                    `Archive exceeds the configured ${siteSettings.effective.max_backup_import_size_mb} MB limit.`,
                  );
                  event.target.value = ""; // Clear file input
                  setConfluenceFile(null);
                  return;
                }
              }
              const matchesInterruptedUpload = fileMatchesStoredUpload(
                nextFile,
                storedConfluenceUpload,
              );
              if (matchesInterruptedUpload && storedConfluenceUpload) {
                const nextStored = {
                  ...storedConfluenceUpload,
                  file: nextFile ?? undefined,
                };
                setConfluenceFile(null);
                storedConfluenceUploadRef.current = nextStored;
                setStoredConfluenceUpload(nextStored);
                setConfluenceArchive(null);
                setConfluenceUploadError(null);
                setConfluenceUploadNotice(null);
                setPreparationLogs([]);
                setUploadProgress((current) => current ?? 0);
                void saveStoredUpload(nextStored);
                return;
              }
              if (storedConfluenceUpload) {
                const replacedArchiveId = storedConfluenceUpload.archiveId;
                rememberCancelledUpload(replacedArchiveId);
                uploadRestoreRun.current += 1;
                storedConfluenceUploadRef.current = null;
                setStoredConfluenceUpload(null);
                void clearStoredUpload();
                void apiFetch(
                  `/api/v1/confluence-imports/archives/${replacedArchiveId}/upload`,
                  { method: "DELETE" },
                ).catch(() => {
                  // The local cancelled marker keeps this abandoned upload from
                  // returning to the UI even if server cleanup is delayed.
                });
              }
              setConfluenceFile(nextFile);
              setStoredConfluenceUpload(null);
              void clearStoredUpload();
              setConfluenceArchive(null);
              setConfluenceJob(null);
              setConfluenceUploadError(null);
              setConfluenceUploadNotice(null);
              setPreparationLogs([]);
              setUploadProgress(null);
              setUploadStats(null);
              setHashStats(null);
              setIsUploading(false);
            }}
            className="sr-only"
          />
          <label
            className={cn(
              "border-border bg-surface hover:border-border-strong focus-within:ring-ring mt-2 flex h-10 w-full max-w-md items-center rounded-md border text-sm transition-[color,background-color,border-color,box-shadow] duration-150 focus-within:ring-2 focus-within:ring-offset-2",
              confluencePending || confluenceArchive || importInProgress
                ? "cursor-not-allowed opacity-50"
                : "cursor-pointer",
            )}
            htmlFor="confluence-backup-file"
            aria-disabled={confluencePending || Boolean(confluenceArchive) || importInProgress}
          >
            <span className="border-border bg-surface-sunken shrink-0 border-r px-3 py-2 font-medium">
              Choose file
            </span>
            <span
              className="text-muted-foreground min-w-0 flex-1 truncate px-3"
              title={confluenceArchiveName ?? undefined}
            >
              {confluenceArchiveName ?? "No file selected"}
            </span>
          </label>
          <p className="text-muted-foreground mt-2 text-xs">
            Accepted format: <code className="font-mono">.zip</code> archive
            exported by Confluence. It uploads directly to protected object
            storage.
            {storedUploadNeedsFile
              ? ` Select ${storedConfluenceUpload?.fileName} again so WikiHub can read the remaining parts.`
              : null}
            {confluenceArchive
              ? " Finish or clear this space selection before choosing another archive."
              : null}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {isUploading || isHashingArchive ? (
              <>
                {isUploading ? (
                  <Button
                    variant="secondary"
                    onClick={() => cancelConfluenceUpload("pause")}
                  >
                    <Pause /> Pause upload
                  </Button>
                ) : null}
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
                    (!confluenceFile &&
                      !canResumeStoredUpload &&
                      !storedUploadNeedsFile) ||
                    confluencePending ||
                    Boolean(confluenceArchive) ||
                    importInProgress
                  }
                  onClick={() => {
                    if (storedUploadNeedsFile) {
                      confluenceFileInput.current?.click();
                      return;
                    }
                    void uploadConfluence(Boolean(storedConfluenceUpload));
                  }}
                >
                  {isHashingArchive ? (
                    <FileArchive />
                  ) : confluencePending && !confluenceArchive ? (
                    <Loader2 className="animate-spin" />
                  ) : storedConfluenceUpload ? (
                    <Play />
                  ) : (
                    <Upload />
                  )}{" "}
                  {storedUploadNeedsFile
                    ? "Select file to resume"
                    : storedConfluenceUpload
                      ? "Resume upload"
                      : "Upload and scan"}
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

        {isHashingArchive && hashStats ? (
          <div
            className="border-info/25 bg-info-bg mt-3 rounded-md border p-3 text-sm"
            role="status"
          >
            <div className="flex gap-2.5">
              <Info className="text-info mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p>
                  Checking archive fingerprint{" "}
                  <span className="font-medium">{confluenceArchiveName}</span>:{" "}
                  {hashProgress}%
                </p>
                <div
                  aria-label={`Fingerprint ${hashProgress}% complete`}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={hashProgress ?? 0}
                  className="bg-surface mt-2 h-2 overflow-hidden rounded-full"
                  role="progressbar"
                >
                  <div
                    className="bg-info h-full duration-150 motion-safe:transition-[width]"
                    style={{ width: `${hashProgress ?? 0}%` }}
                  />
                </div>
                <p className="text-muted-foreground mt-2 text-xs">
                  Read: {formatBytes(hashStats.loaded)} /{" "}
                  {formatBytes(hashStats.total)}. WikiHub uses this hash to
                  avoid uploading the same archive twice.
                </p>
                <div className="text-muted-foreground mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs">
                  <span>
                    <span className="text-foreground font-medium">Speed:</span>{" "}
                    {hashStats.bytesPerSecond > 0
                      ? `${formatBytes(hashStats.bytesPerSecond)}/s`
                      : "Calculating speed…"}
                  </span>
                  <span>
                    <span className="text-foreground font-medium">
                      Estimate:
                    </span>{" "}
                    {formatDuration(hashStats.secondsRemaining)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : null}

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

        {confluenceUploadNotice ? (
          <p
            role="status"
            className="border-success/30 bg-success-bg text-success mt-3 rounded-md border px-3 py-2 text-sm"
          >
            {confluenceUploadNotice}
          </p>
        ) : null}

        {confluenceUploadError ? (
          <p
            role="alert"
            className="border-danger/30 bg-danger/10 text-danger mt-3 rounded-md border px-3 py-2 text-sm"
          >
            {confluenceUploadError}
          </p>
        ) : null}

        {uploadProgress !== null &&
        !confluenceArchive &&
        !isFinalizingArchive &&
        !isHashingArchive ? (
          <div
            className="border-info/25 bg-info-bg mt-3 rounded-md border p-3 text-sm"
            role="status"
          >
            <div className="flex gap-2.5">
              <Info className="text-info mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p>
                  {isUploading ? "Uploading" : "Upload paused"}{" "}
                  <span className="font-medium">{confluenceArchiveName}</span>:{" "}
                  {uploadProgress}%
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
                    <span className="text-foreground font-medium">
                      Uploaded:
                    </span>{" "}
                    {formatBytes(uploadStats?.loaded ?? 0)} /{" "}
                    {formatBytes(uploadStats?.total ?? confluenceArchiveSize)}
                  </span>
                  {isUploading ? (
                    <>
                      <span>
                        <span className="text-foreground font-medium">
                          Speed:
                        </span>{" "}
                        {uploadStats && uploadStats.bytesPerSecond > 0
                          ? `${formatBytes(uploadStats.bytesPerSecond)}/s`
                          : "Calculating speed…"}
                      </span>
                      <span>
                        <span className="text-foreground font-medium">
                          Estimate:
                        </span>{" "}
                        {formatDuration(uploadStats?.secondsRemaining ?? null)}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {preparationLogs.length > 0 && !confluenceArchive ? (
          <details
            className="border-border bg-surface mt-3 rounded-md border"
            open={preparationLogsExpanded}
            onToggle={(event) =>
              setPreparationLogsExpanded(event.currentTarget.open)
            }
          >
            <summary className="hover:bg-surface-hover focus-visible:ring-ring focus-visible:ring-offset-background flex cursor-pointer list-none items-center justify-between gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-offset-1">
              <span>Preparation logs ({preparationLogs.length})</span>
              <ChevronDown
                className={cn(
                  "text-muted-foreground size-4 transition-transform duration-150",
                  preparationLogsExpanded && "rotate-180",
                )}
              />
            </summary>
            <ul className="border-border max-h-36 divide-y overflow-y-auto border-t text-xs">
              {preparationLogs.map((log, index) => (
                <li key={`${index}-${log}`} className="px-3 py-2">
                  {log}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {confluenceArchive && !importInProgress ? (
          <div className="border-border bg-surface-sunken mt-4 flex items-center justify-between gap-3 rounded-md border p-4 text-sm">
            <div>
              <p className="font-semibold">
                Confluence archive ready for import
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {confluenceArchive.spaces.length} spaces found. Choose which spaces to import.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="danger"
                size="sm"
                disabled={confluencePending}
                onClick={() => setConfirmDiscardArchive(true)}
              >
                Cancel import
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setIsSpaceModalOpen(true);
                  if (confluenceArchive) {
                    apiFetch<ConfluenceArchive>(
                      `/api/v1/confluence-imports/archives/${confluenceArchive.id}`,
                    )
                      .then((archive) => setConfluenceArchive(archive))
                      .catch(() => {});
                  }
                }}
              >
                Select spaces &amp; import
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
            {displayConfluenceLogs.length ? (
              <details
                className="border-border bg-surface mt-4 rounded-md border"
                open
              >
                <summary className="hover:bg-surface-hover cursor-pointer px-3 py-2 text-sm font-medium transition-colors duration-150">
                  Import activity ({displayConfluenceLogs.length})
                </summary>
                <ul
                  ref={logsListRef}
                  className="border-border max-h-44 divide-y overflow-y-auto border-t text-xs"
                >
                  {displayConfluenceLogs.map((log) => (
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

      <Dialog open={isSpaceModalOpen} onOpenChange={setIsSpaceModalOpen}>
        <DialogContent title="Select Spaces to Import" className="max-w-2xl">
          {confluenceArchive ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {selectedSpaces.length}/{confluenceArchive.spaces.length} Space(s) selected
                </p>
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
                        <Badge variant="warning">Existed</Badge>
                      ) : null}
                    </label>
                  ))
                ) : (
                  <p className="text-muted-foreground px-3 py-6 text-center text-sm">
                    No spaces match “{spaceFilter}”.
                  </p>
                )}
              </div>
              <DialogFooter className="justify-between sm:justify-between">
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
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
                    size="sm"
                    disabled={importInProgress}
                    onClick={() => {
                      setSelectedSpaces([]);
                      setImportAllSpaces(false);
                    }}
                  >
                    Clear selection
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={importInProgress}
                    onClick={() => setIsSpaceModalOpen(false)}
                  >
                    Close
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={
                      importInProgress ||
                      confluencePending ||
                      (!importAllSpaces && selectedSpaces.length === 0)
                    }
                    onClick={requestConfluenceImport}
                  >
                    {confluencePending ? (
                      <Loader2 className="animate-spin size-4" />
                    ) : (
                      <Upload className="size-4" />
                    )}{" "}
                    Start import
                  </Button>
                </div>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={isImportSuccessModalOpen}
        onOpenChange={setIsImportSuccessModalOpen}
      >
        <DialogContent
          title="Import Completed Successfully"
          description="All selected spaces from your Confluence backup have been successfully imported."
        >
          <p className="text-sm text-muted-foreground">
            Do you want to import another Confluence archive or continue with a new import?
          </p>
          <DialogFooter>
            <Button
              variant="primary"
              onClick={() => {
                setConfluenceJob(null);
                setUploadProgress(null);
                setUploadStats(null);
                setHashStats(null);
                setPreparationLogs([]);
                setConfluenceLogs([]);
                setIsImportSuccessModalOpen(false);
              }}
            >
              Yes, import another
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setIsImportSuccessModalOpen(false);
              }}
            >
              No, close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
      <ConfirmDialog
        open={confirmDiscardArchive}
        onOpenChange={setConfirmDiscardArchive}
        title="Cancel this import?"
        description="This will permanently delete the uploaded and scanned archive from the server. If you decide to import it later, you will need to re-upload the entire archive file, which will take time."
        confirmLabel="Yes, cancel import"
        destructive
        pending={discardingArchivePending}
        onConfirm={() => void discardConfluenceArchive()}
      />
    </div>
  );
}
