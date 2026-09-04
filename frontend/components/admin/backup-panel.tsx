"use client";

import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  Download,
  FileArchive,
  Archive,
  ArchiveRestore,
  FolderOpen,
  HardDrive,
  Info,
  ListChecks,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Search,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode, Ref } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, apiFetch } from "@/lib/api-client";
import {
  detectArchiveFormat,
  type ArchiveFormat,
} from "@/lib/archive-format";
import {
  ArchiveHashProgress,
  ArchiveUploadProgress,
  type TransferStats,
  formatBytes,
  formatDuration,
} from "@/components/ui/job-progress";
import { LogDisclosure, formatLogTime } from "@/components/ui/log-disclosure";
import { cn } from "@/lib/utils";
import type {
  BackupArchive,
  BackupArchiveUploadProgress,
  BackupJobLog,
  ConfluenceArchive,
  ConfluenceImportJob,
  ConfluenceImportLog,
  ConfluenceUploadProgress,
  ConfluenceUploadTarget,
  ImportReport,
  SiteSettings,
  Space,
} from "@/types/api";

// Both were the same four fields; they are `TransferStats` now, defined
// beside the panels that render them.
type UploadStats = TransferStats;
type HashStats = TransferStats;

type PortableBackupJob = {
  id: string;
  kind: "full_export" | "confluence_export" | "full_import";
  status: "queued" | "running" | "complete" | "failed" | "cancelled";
  phase: string;
  counters: Record<string, number>;
  cancel_requested: boolean;
  output_filename: string | null;
  download_url: string | null;
  error: string | null;
  space_keys: string[];
  //: Restore jobs only (`kind: "full_import"`).
  archive_id: string | null;
  overwrite_space_keys: string[];
  //: Set once a restore job completes - the report `submitImport` used to
  //: get directly back from its (now retired for large files) blocking
  //: upload request.
  result: ImportReport | null;
  started_at: string | null;
  heartbeat_at: string | null;
  percent: number | null;
  eta_seconds: number | null;
  created_at: string;
  updated_at: string;
};

type AutomatedBackupSettings = {
  enabled: boolean;
  interval_unit: "hours" | "days";
  interval_value: number;
  time_of_day: string;
  timezone: string;
  retention_count: number;
  //: Relative to `base_directory`, e.g. "team-a" for `<base_directory>/team-a`.
  //: `null` writes straight into `base_directory` itself.
  subdirectory: string | null;
  directory_configured: boolean;
  //: The host-mounted volume as the container sees it - fixed at deploy
  //: time (`WIKIHUB_AUTOMATED_BACKUP_DIRECTORY`), shown for context only.
  base_directory: string | null;
  //: `base_directory` narrowed by `subdirectory` - where a backup actually
  //: lands right now. `null` whenever `directory_configured` is false.
  directory: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
};

//: Returned by `POST /api/v1/backup/archives/uploads` - the target for a
//: `.zip` restore's chunked upload, ahead of being scanned (`BackupArchive`,
//: `@/types/api`) and then applied as a `full_import` job. Mirrors
//: `ConfluenceUploadTarget` (`@/types/api`).
type BackupArchiveUploadTarget = {
  archive_id: string;
  object_key: string;
  max_size_bytes: number;
  part_size_bytes: number;
  uploaded_parts: number[];
  status: string;
  sha256: string | null;
  reused: boolean;
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
    file.size === upload.fileSize,
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
  const SAMPLE_CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB per sample slice
  const FAST_HASH_THRESHOLD = 8 * 1024 * 1024; // 8 MB threshold

  if (typeof window !== "undefined" && window.crypto?.subtle) {
    try {
      if (file.size <= FAST_HASH_THRESHOLD) {
        const arrayBuffer = await file.arrayBuffer();
        if (signal?.aborted) {
          throw new DOMException("Fingerprint cancelled.", "AbortError");
        }
        const hashBuffer = await window.crypto.subtle.digest(
          "SHA-256",
          arrayBuffer,
        );
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

      // Fast multi-sample fingerprinting for large files (> 8 MB):
      // Read head (2MB) + middle (2MB) + tail (2MB) + metadata (size, lastModified, filename)
      const head = await file.slice(0, SAMPLE_CHUNK_SIZE).arrayBuffer();
      const midOffset = Math.floor((file.size - SAMPLE_CHUNK_SIZE) / 2);
      const mid = await file
        .slice(midOffset, midOffset + SAMPLE_CHUNK_SIZE)
        .arrayBuffer();
      const tail = await file
        .slice(file.size - SAMPLE_CHUNK_SIZE)
        .arrayBuffer();

      const metaString = `size:${file.size};name:${file.name};`;
      const metaBytes = new TextEncoder().encode(metaString);

      const combined = new Uint8Array(
        head.byteLength +
          mid.byteLength +
          tail.byteLength +
          metaBytes.byteLength,
      );
      combined.set(new Uint8Array(head), 0);
      combined.set(new Uint8Array(mid), head.byteLength);
      combined.set(new Uint8Array(tail), head.byteLength + mid.byteLength);
      combined.set(
        metaBytes,
        head.byteLength + mid.byteLength + tail.byteLength,
      );

      if (signal?.aborted) {
        throw new DOMException("Fingerprint cancelled.", "AbortError");
      }

      const hashBuffer = await window.crypto.subtle.digest(
        "SHA-256",
        combined,
      );
      if (signal?.aborted) {
        throw new DOMException("Fingerprint cancelled.", "AbortError");
      }
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      onProgress(file.size);
      return hashHex;
    } catch (error) {
      console.warn(
        "Native fast SHA-256 calculation failed, falling back to incremental JS implementation:",
        error,
      );
    }
  }

  // Fallback for environments without window.crypto.subtle (also fast-sampled)
  const hasher = new IncrementalSha256();

  if (file.size <= FAST_HASH_THRESHOLD) {
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

  const head = await file.slice(0, SAMPLE_CHUNK_SIZE).arrayBuffer();
  const midOffset = Math.floor((file.size - SAMPLE_CHUNK_SIZE) / 2);
  const mid = await file
    .slice(midOffset, midOffset + SAMPLE_CHUNK_SIZE)
    .arrayBuffer();
  const tail = await file.slice(file.size - SAMPLE_CHUNK_SIZE).arrayBuffer();
  const metaString = `size:${file.size};modified:${file.lastModified};name:${file.name};`;
  const metaBytes = new TextEncoder().encode(metaString);

  hasher.update(new Uint8Array(head));
  hasher.update(new Uint8Array(mid));
  hasher.update(new Uint8Array(tail));
  hasher.update(metaBytes);

  onProgress(file.size);
  if (signal?.aborted) {
    throw new DOMException("Fingerprint cancelled.", "AbortError");
  }
  return hasher.digest();
}

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
/** One line in the restore card's log, whatever wrote it.
 *
 * The browser's own account of the upload and the worker's account of the
 * restore are the same story to whoever is watching, so they are normalised
 * to one shape here and shown as one list. */
type RestoreLogEntry = {
  id: string;
  time: string;
  level: "info" | "warning" | "error";
  /** What the line is about, when it is about one thing in particular. */
  label?: string | null;
  message: string;
};

/** One line in any job's activity log - WikiHub export, WikiHub restore or
 * Confluence import all narrate themselves this same way server-side
 * (`BackupJobLog`/`ConfluenceImportLog` are "the same shape on purpose"), so
 * this is the one client-side shape `renderJobActivityCard`/
 * `renderJobLogRows` read, rather than each import type keeping its own. A
 * `RestoreLogEntry` already satisfies this structurally. */
type JobLogEntry = {
  id: string;
  time: string;
  level: string;
  label?: string | null;
  message: string;
};

function ImportCompletedDialog({
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
  // The restore card's own upload. Tracked separately from
  // `uploadActiveRef` because leaving pauses a different request, but it
  // gets the same prompt: both are a multi-GB chunked upload that a
  // navigation would otherwise abandon mid-part with no warning.
  const restoreUploadActiveRef = useRef(false);
  const exportActiveRef = useRef(false);
  //: Tracks the archive id while an "Upload and scan" run is in flight, i.e.
  //: before it lands in `backupArchive` state below - the only thing a
  //: cancel needs to clean up server-side (`DELETE .../upload`) if the user
  //: backs out mid-upload/scan. `backupArchive.id` is what everything else
  //: (job creation, a "replace existing spaces?" retry) uses once set.
  const restoreArchiveIdRef = useRef<string | null>(null);
  const restoreHashAbort = useRef<AbortController | null>(null);
  const uploadBackupRun = useRef(0);
  const allowConfirmedLeaveRef = useRef(false);
  const logsListRef = useRef<HTMLUListElement>(null);
  const restoreLogsListRef = useRef<HTMLUListElement>(null);

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
  const [confluenceLogsExpanded, setConfluenceLogsExpanded] = useState(true);
  const [confluenceLogs, setConfluenceLogs] = useState<ConfluenceImportLog[]>(
    [],
  );
  const [preparationLogs, setPreparationLogs] = useState<string[]>([]);
  const [preparationLogsExpanded, setPreparationLogsExpanded] = useState(true);
  //: The restore card's own narration. Two sources, kept apart because they
  //: have different lifetimes: `restorePreparationLogs` is written in this
  //: browser while the file is fingerprinted, uploaded and scanned - work no
  //: server ever sees - and `restoreJobLogs` is read back from the worker
  //: once the restore itself is queued, so it survives a refresh. They are
  //: shown as one list (`restoreLogEntries`): a restore is one continuous
  //: piece of work to the person watching it, and splitting the account of
  //: it across two cards only asks them to interleave it themselves.
  const [restorePreparationLogs, setRestorePreparationLogs] = useState<
    RestoreLogEntry[]
  >([]);
  const [restoreJobLogs, setRestoreJobLogs] = useState<BackupJobLog[]>([]);
  const [restoreLogsExpanded, setRestoreLogsExpanded] = useState(true);
  const [selectedSpaces, setSelectedSpaces] = useState<string[]>([]);
  const [importAllSpaces, setImportAllSpaces] = useState(false);
  const [spaceFilter, setSpaceFilter] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadStats, setUploadStats] = useState<UploadStats | null>(null);
  const [hashStats, setHashStats] = useState<HashStats | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [confluencePending, setConfluencePending] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [pending, setPending] = useState<"apply" | null>(null);
  //: Progress for a `.zip` restore's chunked archive upload - the phase
  //: before a `full_import` job even exists to poll. Separate from
  //: `uploadProgress`/`uploadStats` (Confluence-only) since both flows can in
  //: principle be mid-upload in the same tab.
  const [restoreUploadProgress, setRestoreUploadProgress] = useState<
    number | null
  >(null);
  const [restoreUploadStats, setRestoreUploadStats] =
    useState<UploadStats | null>(null);
  const restoreUploadRequest = useRef<XMLHttpRequest | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [confluenceExportProfile, setConfluenceExportProfile] = useState("");
  const [portableBackupJob, setPortableBackupJob] =
    useState<PortableBackupJob | null>(null);
  // Which of the two tabs is showing. Declared up here (not just above the
  // JSX that reads it) because `restorePortableBackupJob` below needs to
  // switch to it when it reattaches a running job after a full remount -
  // otherwise a restore left running in another tab/reload comes back on
  // the default "Export / Backup" tab, hiding its own progress card and
  // Cancel button (`renderPortableJobCard` only renders while its section
  // is active) until the user happens to click "Import / Restore" themselves.
  const [activeSection, setActiveSection] = useState<"export" | "import">(
    "export",
  );
  // Guards the auto-download below against firing twice for the same job
  // (e.g. a duplicate poll tick) - a ref rather than state since it must not
  // itself trigger a re-render.
  const autoDownloadedJobIdRef = useRef<string | null>(null);
  //: Same guard for a restore job's completion handling, so a late poll tick
  //: cannot re-open a modal the user has already dismissed.
  const settledRestoreJobIdRef = useRef<string | null>(null);

  // Native-export space scope - distinct from the Confluence import picker's
  // selectedSpaces/importAllSpaces/spaceFilter above, which is a separate flow.
  const [exportSpaceScope, setExportSpaceScope] = useState<"all" | "selected">(
    "all",
  );
  const [exportSelectedSpaceKeys, setExportSelectedSpaceKeys] = useState<
    string[]
  >([]);
  const [exportSpaceFilter, setExportSpaceFilter] = useState("");
  const [isExportSpacePickerOpen, setIsExportSpacePickerOpen] =
    useState(false);
  const [isExportOptionsOpen, setIsExportOptionsOpen] = useState(false);
  const [availableSpaces, setAvailableSpaces] = useState<Space[] | null>(null);
  const [isLoadingAvailableSpaces, setIsLoadingAvailableSpaces] =
    useState(false);

  // Native-restore space scope. Sourced from `backupArchive.spaces` (the
  // *archive's* space list, populated by "Upload and scan" below) rather
  // than availableSpaces above (this instance's own spaces) - the common
  // case is restoring into an empty instance, where availableSpaces would
  // just be empty.
  const [importSelectedSpaceKeys, setImportSelectedSpaceKeys] = useState<
    string[]
  >([]);
  const [importSpaceFilter, setImportSpaceFilter] = useState("");
  const [isImportSpacePickerOpen, setIsImportSpacePickerOpen] =
    useState(false);
  //: Set once "Upload and scan" finishes - mirrors `confluenceArchive`.
  //: Its `.spaces` is what the picker dialog reads, already in memory (no
  //: loading state, unlike the old `/inspect-zip`-backed flow this replaced).
  const [backupArchive, setBackupArchive] = useState<BackupArchive | null>(
    null,
  );
  const [isHashingBackupArchive, setIsHashingBackupArchive] = useState(false);
  const [backupHashStats, setBackupHashStats] = useState<HashStats | null>(
    null,
  );
  const [isUploadingBackupArchive, setIsUploadingBackupArchive] =
    useState(false);
  const [isScanningBackupArchive, setIsScanningBackupArchive] =
    useState(false);
  //: Bytes already in object storage from an earlier, interrupted attempt at
  //: this same archive, which this run skipped. Non-zero means the upload
  //: resumed rather than restarted - worth saying out loud, since otherwise a
  //: bar starting at 60% just looks like a glitch.
  const [restoreResumedBytes, setRestoreResumedBytes] = useState(0);
  //: Set when the server refused the archive itself, rather than the upload
  //: being interrupted. The distinction decides what the card may offer next:
  //: re-sending bytes cannot turn a Confluence export into a WikiHub backup,
  //: so "Resume upload" - and the "nothing was lost, carry on" note beside it
  //: - is worse than useless here. It sat under a completed 24 GB upload
  //: inviting the user to continue with a file that will never be accepted.
  const [restoreArchiveRejected, setRestoreArchiveRejected] = useState(false);
  //: An upload this user left unfinished server-side, rediscovered on mount.
  //: The browser cannot re-open the original `File` on its own (only a user
  //: gesture can), so the card asks for it back and then resumes from
  //: `uploaded_parts` - the same "select the file again" step the Confluence
  //: card uses. `null` once there is nothing pending.
  //: A file chosen to resume an upload that turns out not to be that file.
  //: Held rather than acted on: both ways out cost something real - one asks
  //: for the right file back, the other throws away parts already uploaded -
  //: so it is the user's call, not a guess.
  const [mismatchedResumeFile, setMismatchedResumeFile] = useState<File | null>(
    null,
  );
  const [pendingRestoreUpload, setPendingRestoreUpload] =
    useState<BackupArchiveUploadProgress | null>(null);
  const [confirmDiscardBackupArchive, setConfirmDiscardBackupArchive] =
    useState(false);
  //: Confirm-before-cancel for "Upload and scan" - separate from
  //: Confluence's own `confirmCancelUpload`/`cancelUploadPending` (a
  //: different flow, worded differently) even though both guard the same
  //: kind of action.
  const [confirmCancelBackupUpload, setConfirmCancelBackupUpload] =
    useState(false);
  const [cancelBackupUploadPending, setCancelBackupUploadPending] =
    useState(false);

  // Set once a restore attempt reports spaces it skipped because they
  // already exist (BackupService._apply's "key_exists" skip) - offers a
  // one-click follow-up restore that replaces just those spaces' pages,
  // via the same overwrite_space_keys the Confluence card already uses.
  const [conflictingImportSpaceKeys, setConflictingImportSpaceKeys] = useState<
    string[]
  >([]);
  const [confirmOverwriteImportSpaces, setConfirmOverwriteImportSpaces] =
    useState(false);

  const [confirmDiscardArchive, setConfirmDiscardArchive] = useState(false);
  const [discardingArchivePending, setDiscardingArchivePending] =
    useState(false);
  const [confirmCancelUpload, setConfirmCancelUpload] = useState(false);
  const [confirmOverwriteSpaces, setConfirmOverwriteSpaces] = useState(false);
  const [cancelUploadPending, setCancelUploadPending] = useState(false);
  const [leaveTarget, setLeaveTarget] = useState<string | null>(null);
  // Cancel / leave-while-running guard for the portable backup export job
  // (Full WikiHub ZIP / Confluence DC XML) - separate from the Confluence
  // upload guard above since the two flows have different wording and don't
  // share a job.
  const [confirmCancelExport, setConfirmCancelExport] = useState(false);
  const [cancelExportPending, setCancelExportPending] = useState(false);
  const [exportLeaveTarget, setExportLeaveTarget] = useState<string | null>(
    null,
  );
  const [confluenceUploadError, setConfluenceUploadError] = useState<
    string | null
  >(null);
  const [confluenceUploadNotice, setConfluenceUploadNotice] = useState<
    string | null
  >(null);
  const [siteSettings, setSiteSettings] = useState<SiteSettings | null>(null);
  const [automatedSettings, setAutomatedSettings] = useState<AutomatedBackupSettings | null>(null);
  const [automatedJobs, setAutomatedJobs] = useState<PortableBackupJob[]>([]);
  const [automatedPending, setAutomatedPending] = useState(false);
  const [automatedError, setAutomatedError] = useState<string | null>(null);
  //: Shown right beside the subdirectory field, in addition to the toast
  //: `saveAutomatedBackups` already raises for every other save failure -
  //: a bad filesystem path is worth pointing at directly, not just naming
  //: in a message that has scrolled away by the time it is read twice.
  const [automatedSubdirectoryError, setAutomatedSubdirectoryError] =
    useState<string | null>(null);
  const [deleteAutomatedJobId, setDeleteAutomatedJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [isSpaceModalOpen, setIsSpaceModalOpen] = useState(false);
  const [isImportSuccessModalOpen, setIsImportSuccessModalOpen] =
    useState(false);
  //: Shown once a `full_import` job finishes with nothing left to decide -
  //: the restore counterpart of `isImportSuccessModalOpen` above. A restore
  //: that still reports conflicting spaces gets the "replace?" prompt
  //: instead; the two are mutually exclusive by construction below.
  const [isRestoreSuccessModalOpen, setIsRestoreSuccessModalOpen] =
    useState(false);
  const [restoreSuccessReport, setRestoreSuccessReport] =
    useState<ImportReport | null>(null);
  //: Snapshot of the Confluence job's counters, taken when it completes - the
  //: restore counterpart is `restoreSuccessReport` above. Held separately from
  //: `confluenceJob` because "Yes, import another" clears the job, and the
  //: dialog must not blank out mid-dismissal.
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
  // WikiHub restore's counterpart of the two blocks above: the archive is
  // already scanned (`.conflict` per space) by the time the picker's "Start
  // restore" button is reachable, so a conflict among the chosen spaces can
  // be known - and confirmed - before the restore ever runs, the same "ask
  // first" shape Confluence import already uses. Mirrors `submitImport`'s own
  // "selection covering everything is sent as no selection at all" rule so
  // this agrees with what the request will actually cover.
  const selectedRestoreKeys =
    importSelectedSpaceKeys.length > 0 &&
    importSelectedSpaceKeys.length < (backupArchive?.spaces.length ?? 0)
      ? importSelectedSpaceKeys
      : (backupArchive?.spaces.map((space) => space.key) ?? []);
  const conflictingRestoreSpaces =
    backupArchive?.spaces.filter(
      (space) => space.conflict && selectedRestoreKeys.includes(space.key),
    ) ?? [];
  // `conflictingImportSpaceKeys` is also the one place a restore that ran
  // *without* the pre-flight check (a space someone else created between
  // scan and restore, say) can still report a leftover conflict, so the
  // confirm dialog below reads from this rather than straight from
  // `conflictingRestoreSpaces` - one description that is right regardless of
  // which of the two ever opens it.
  const overwriteImportSpaceKeysSummary = [
    ...conflictingImportSpaceKeys.slice(0, 8),
    ...(conflictingImportSpaceKeys.length > 8
      ? [`and ${conflictingImportSpaceKeys.length - 8} more`]
      : []),
  ].join(", ");
  const confluenceArchiveName =
    storedConfluenceUpload?.fileName ?? confluenceFile?.name ?? null;

  // A queued/running job is still in flight server-side, distinct from
  // `isDownloading` which only covers the initial POST that creates it.
  const isFullExportRunning =
    portableBackupJob?.kind === "full_export" &&
    (portableBackupJob.status === "queued" ||
      portableBackupJob.status === "running");
  const isConfluenceExportRunning =
    portableBackupJob?.kind === "confluence_export" &&
    (portableBackupJob.status === "queued" ||
      portableBackupJob.status === "running");
  const isRestoreJobRunning =
    portableBackupJob?.kind === "full_import" &&
    (portableBackupJob.status === "queued" ||
      portableBackupJob.status === "running");
  const isPortableJobRunning =
    isFullExportRunning || isConfluenceExportRunning || isRestoreJobRunning;
  //: Whether `renderPortableJobCard("restore")` is (about to be) on screen -
  //: same condition as its own early return. The restore log lives inside
  //: that card whenever it is up; `renderRestoreLogPanel`'s standalone call
  //: site below only needs to cover the rest (no job yet, or "complete").
  const restoreJobCardVisible =
    portableBackupJob?.kind === "full_import" &&
    portableBackupJob.status !== "complete";

  const normalizedExportSpaceFilter = exportSpaceFilter.trim().toLocaleLowerCase();
  const filteredAvailableSpaces = (availableSpaces ?? []).filter(
    (space) =>
      !normalizedExportSpaceFilter ||
      space.name.toLocaleLowerCase().includes(normalizedExportSpaceFilter) ||
      space.key.toLocaleLowerCase().includes(normalizedExportSpaceFilter),
  );

  const normalizedImportSpaceFilter = importSpaceFilter.trim().toLocaleLowerCase();
  const filteredArchiveSpaces = (backupArchive?.spaces ?? []).filter(
    (space) =>
      !normalizedImportSpaceFilter ||
      space.name.toLocaleLowerCase().includes(normalizedImportSpaceFilter) ||
      space.key.toLocaleLowerCase().includes(normalizedImportSpaceFilter),
  );

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

  //: Catch "I used the wrong card" at selection time rather than an hour into
  //: a multi-GB upload. The two cards sit side by side and both take a `.zip`,
  //: and until now the only thing that noticed was the server's scan - which
  //: runs after the whole archive has been sent. Reading the ZIP index locally
  //: costs a few MB whatever the archive weighs (lib/archive-format.ts).
  //:
  //: The server still enforces this independently; an archive the browser
  //: cannot classify is allowed through rather than blocked on a guess.
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

  // The restore counterpart of `storedUploadNeedsFile` above: parts are
  // already staged in object storage, but only a user gesture can hand the
  // `File` back, so the card has to ask for it before it can resume. It is
  // deliberately shaped like the Confluence case - a hint under the file
  // input, a "Select file to resume" button and the shared paused-upload
  // strip - rather than the separate in-card banner it used to get, which
  // made the same situation look like a different feature on each side.
  const restoreUploadNeedsFile = Boolean(
    pendingRestoreUpload && !backupArchive && !file,
  );
  //: Parts are already staged somewhere - rediscovered on the server from an
  //: earlier visit, or paused mid-flight in this tab. Deliberately *not*
  //: derived from `restoreUploadNeedsFile`: handing the file back satisfies
  //: that flag, which used to collapse the whole resume context the instant
  //: the picker closed. The card fell back to a plain "Upload and scan" with
  //: no way to cancel, offering to re-send from zero the multi-GB archive it
  //: was in the middle of resuming.
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
  // Capped at 99: the final part is what completes an upload, and a
  // rediscovered one is unfinished by definition, so 100% would be a lie.
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
  // Hoisted out of the restore card's render so the navigation guard below
  // can see it too - leaving mid-upload has to prompt, not silently abort.
  const isPreparingArchive =
    isHashingBackupArchive ||
    isUploadingBackupArchive ||
    isScanningBackupArchive;
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

  // The two import paths write the same spaces and pages, so only one may be
  // in flight at a time - the server refuses the overlapping *job* outright
  // (app/services/import_concurrency.py), and these lock the UI well before
  // the user gets that far, so nobody spends an hour uploading something they
  // will not be allowed to apply.
  //
  // A *paused* or half-finished upload counts as in flight. It holds real
  // uploaded parts in object storage and the user is plainly mid-flow, so
  // leaving the other card live invites exactly the mess this prevents. That
  // it can block the other path is fine precisely because releasing it is one
  // click: the holding card always keeps its Cancel/Discard control enabled,
  // and the locked card names which path holds it.
  const confluenceFlowActive = Boolean(
    confluencePending ||
      isUploading ||
      confluenceArchive ||
      importInProgress ||
      // Paused, or waiting for the file to be handed back so it can resume.
      storedConfluenceUpload,
  );
  const restoreFlowActive = Boolean(
    isHashingBackupArchive ||
      isUploadingBackupArchive ||
      isScanningBackupArchive ||
      backupArchive ||
      isRestoreJobRunning ||
      pending === "apply" ||
      // Keep the other path disabled while the completion decision is still
      // in front of the user, even if the staged archive has not been
      // rehydrated yet (for example immediately after a refresh).
      isRestoreSuccessModalOpen ||
      // Paused mid-upload in this tab, or rediscovered unfinished on the
      // server - both mean parts are already staged.
      restoreUploadProgress !== null ||
      pendingRestoreUpload,
  );
  // Each side gates only the other, never itself. If both somehow hold state
  // at once - only reachable from before this rule existed - neither locks,
  // which fails open rather than stranding the user with two dead cards. The
  // server-side guard still refuses the dangerous part in that case.
  const confluenceLockedByRestore = restoreFlowActive && !confluenceFlowActive;
  const restoreLockedByConfluence = confluenceFlowActive && !restoreFlowActive;
  //: Everything that must stop the restore card accepting a new file. The
  //: cross-flow lock is only half of it: a card also has to lock against
  //: *itself* while its own job runs, which the Confluence card did via
  //: `importInProgress` and this one did not. Mid-restore its file input
  //: stayed live, so a second archive could be chosen and uploaded on top of
  //: the job that was still writing spaces.
  const restoreInputsLocked =
    restoreLockedByConfluence || isRestoreJobRunning || pending === "apply";
  //: True exactly while the full-width "WikiHub backup ready to restore" bar
  //: is on screen - the same condition it renders under. Once the archive is
  //: scanned that bar owns the restore decision ("Select spaces & restore" /
  //: "Cancel restore"), so the card's own "Restore backup" button steps aside
  //: rather than offering a second, unscoped way to trigger the same thing.
  const restoreDecisionOwnedByReadyBar =
    backupArchive !== null && !isRestoreJobRunning && pending !== "apply";
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
                  : "Import running";
  const jobPagesSummary = confluenceJob?.counters.pages_total
    ? `${confluenceJob.counters.pages_processed ?? 0}/${confluenceJob.counters.pages_total} pages`
    : `${confluenceJob?.counters.pages_processed ?? 0} pages`;
  //: `displayConfluenceLogs` reshaped into the same `JobLogEntry` shape the
  //: WikiHub restore card's logs already use, so the two feed the exact same
  //: `renderJobActivityCard`/`renderJobLogRows` - there is only one log list
  //: implementation, not one per import type that can silently drift apart.
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

  /** Pull a restore job's narration from the server, newest first.
   *
   * Reversed into chronological order here: the endpoint sorts newest-first
   * so paging returns the interesting end of a long run, but a log read
   * top-to-bottom is the only way the story makes sense. */
  const loadRestoreJobLogs = useCallback(async (jobId: string) => {
    try {
      const page = await apiFetch<{ items: BackupJobLog[] }>(
        `/api/v1/backup/jobs/${jobId}/logs`,
      );
      setRestoreJobLogs([...page.items].reverse());
    } catch {
      // Narration is not the work. A restore that is running fine must not
      // look broken because its log request failed.
    }
  }, []);

  //: Everything that has happened to this restore, oldest first, so the
  //: newest line is always the last one - which is where the list is
  //: scrolled to and where a reader's eye already is. Preparation always
  //: precedes the job (the archive has to be uploaded before it can be
  //: applied), so concatenating in that order is already chronological.
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

  useEffect(() => {
    uploadActiveRef.current = confluencePending;
  }, [confluencePending]);

  useEffect(() => {
    exportActiveRef.current = isPortableJobRunning;
  }, [isPortableJobRunning]);

  useEffect(() => {
    storedConfluenceUploadRef.current = storedConfluenceUpload;
  }, [storedConfluenceUpload]);

  // Next.js navigation does not trigger the browser's unload prompt. Catch
  // normal in-app link clicks before the router handles them, then pause the
  // current multipart request only after the user confirms.
  useEffect(() => {
    const confirmNavigation = (event: MouseEvent) => {
      if (
        (!uploadActiveRef.current &&
          !restoreUploadActiveRef.current &&
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
      // An upload guard takes priority if somehow both are active at once -
      // it needs to pause an in-flight XHR, which the export guard does not.
      if (uploadActiveRef.current || restoreUploadActiveRef.current) {
        setLeaveTarget(target.href);
      } else {
        // Unlike `leaveTarget` (which does a full `window.location.assign`
        // reload to cleanly reset an in-flight upload), this path uses the
        // Next.js router for a normal client-side transition, which wants a
        // relative href rather than an absolute one.
        setExportLeaveTarget(target.pathname + target.search);
      }
    };
    const confirmUnload = (event: BeforeUnloadEvent) => {
      if (
        (!uploadActiveRef.current &&
          !restoreUploadActiveRef.current &&
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
  }, []);

  // frontend/lib/spaces.ts's listAllSpaces imports next/headers and can't run
  // in this client component, so this mirrors its pagination loop locally.
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

  // Fetch the live space list lazily, only the first time the export space
  // picker is opened - most admins never touch this, so there's no reason to
  // fetch it on every panel mount.
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

  // The archive's space list is no longer read lazily on picker-open: it
  // comes from `backupArchive.spaces`, already populated by "Upload and
  // scan" (`uploadAndScanBackupArchive`) before the picker is even openable.

  /** Save a completed export to disk without waiting for the user to click
   * the "Download" link - same technique as a normal `<a download>` click,
   * just fired programmatically. */
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
    setIsDownloading(true);
    try {
      // apiFetch JSON.stringifies `body` itself - passing an already-stringified
      // string here double-encodes it into a JSON string literal, which the
      // backend then rejects (a dict/object is required, not a string).
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
        downloadError instanceof Error
          ? downloadError.message
          : "Could not download the backup.",
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
        cancelError instanceof ApiError
          ? cancelError.message
          : `Could not cancel the ${portableBackupJob.kind === "full_import" ? "restore" : "export"}.`,
      );
    } finally {
      setCancelExportPending(false);
      setConfirmCancelExport(false);
    }
  }

  useEffect(() => {
    if (!portableBackupJob || ["complete", "failed", "cancelled"].includes(portableBackupJob.status)) {
      return;
    }
    const timer = window.setInterval(async () => {
      try {
        const job = await apiFetch<PortableBackupJob>(
          `/api/v1/backup/jobs/${portableBackupJob.id}`,
        );
        setPortableBackupJob(job);
        const isRestore = job.kind === "full_import";
        // Only a restore is narrated; an export's card is a progress bar and
        // a download link, and would gain nothing from an empty log panel.
        if (isRestore) await loadRestoreJobLogs(job.id);
        if (job.status === "complete") {
          if (isRestore) {
            // Handle a finished restore exactly once. Without this guard a
            // second poll tick landing before the effect tears the interval
            // down re-opens whichever modal the user just dismissed.
            if (settledRestoreJobIdRef.current === job.id) return;
            settledRestoreJobIdRef.current = job.id;
            const conflicts = job.result?.conflicting_space_keys ?? [];
            router.refresh();
            // A finished restore always ends in the same place: the
            // completion dialog. Spaces that already existed were left
            // untouched and replacing them is a real follow-up decision, but
            // it is the user's to open - throwing a destructive "Replace
            // existing spaces?" prompt at them the instant a restore lands
            // asks the wrong question at the wrong moment. It becomes an
            // offer inside the completion dialog instead. Spaces this job was
            // asked to overwrite are not reported here - the server drops
            // them once handled, so accepting the offer ends the exchange
            // rather than asking again.
            setConflictingImportSpaceKeys(conflicts);
            setRestoreSuccessReport(job.result ?? null);
            setIsRestoreSuccessModalOpen(true);
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
            job.error ?? (isRestore ? "Restore failed." : "Backup export failed."),
          );
        }
        if (job.status === "cancelled") {
          toast(isRestore ? "Restore was cancelled." : "Export was cancelled.");
        }
      } catch {
        // Keep polling on a transient request failure; the job itself is durable.
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [portableBackupJob, router, loadRestoreJobLogs]);

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
          // Only the counters that name something created; the rest are
          // progress bookkeeping and read as noise in a summary.
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

  // Same idea for the portable backup export job (Full WikiHub ZIP / Confluence
  // DC XML) - it's just as durable server-side, but until now the panel had no
  // way to rediscover it after a reload or on another tab.
  const restorePortableBackupJob = useCallback(async () => {
    try {
      const jobs = await apiFetch<PortableBackupJob[]>("/api/v1/backup/jobs");
      const activeJob = jobs.find(
        (job) => job.status === "queued" || job.status === "running",
      );
      setPortableBackupJob((current) => {
        if (!activeJob) {
          // No active job server-side. A just-completed export's card stays
          // (its download link has to remain reachable after a refocus/
          // reload), but a cancelled or failed job has nothing further to
          // offer once its one-time toast already fired - left alone it
          // would sit there through every later refresh, tab switch or new
          // upload, which is exactly the stale "Restore was cancelled" card
          // this guards against. Confluence's own equivalent
          // (`restoreActiveConfluenceJob`) never keeps a finished job at
          // all; this keeps only the one case that still has a job to do.
          if (current?.status === "cancelled" || current?.status === "failed") {
            return null;
          }
          return current;
        }
        // Same job already tracked in this tab - keep the existing object
        // identity so the 1500ms poller's effect doesn't needlessly restart.
        if (current?.id === activeJob.id) return current;
        // Newly (re)discovered - e.g. after a full remount, where this is
        // the only signal that a job is even running. Jump to the tab that
        // owns it so its progress/Cancel card is immediately visible instead
        // of silently running behind whichever tab happens to be default.
        setActiveSection(activeJob.kind === "full_import" ? "import" : "export");
        return activeJob;
      });
      if (activeJob?.kind === "full_import") {
        await loadRestoreJobLogs(activeJob.id);
      }
    } catch {
      // Ignore active job fetch errors on restore
    }
  }, [loadRestoreJobLogs]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore persisted server state on mount
    void restorePortableBackupJob();
  }, [restorePortableBackupJob]);

  // The restore card's own pre-job state - an upload still in flight, or an
  // archive already uploaded and scanned and waiting for a space selection.
  // Both live only in this component's state while the user is on the page,
  // so navigating away used to throw them away and force a fresh multi-GB
  // upload. The server knows about both, so rediscover them here rather than
  // mirroring anything into localStorage.
  const restoreActiveBackupArchive = useCallback(async () => {
    try {
      const active = await apiFetch<BackupArchiveUploadProgress[]>(
        "/api/v1/backup/archives/uploads/active",
      );
      const pending = active[0];
      if (!pending) return;
      if (pending.status === "scanned") {
        // Fully uploaded and scanned: everything the picker needs is
        // server-side, so the card comes back complete with no file and no
        // re-upload - straight to "which spaces?".
        const archive = await apiFetch<BackupArchive>(
          `/api/v1/backup/archives/${pending.archive_id}`,
        );
        setBackupArchive((current) => current ?? archive);
        setActiveSection("import");
        return;
      }
      // Still uploading. The parts are safe in object storage, but only the
      // user can hand the File back, so surface it as a resumable upload.
      setPendingRestoreUpload((current) => current ?? pending);
      setActiveSection("import");
    } catch {
      // A missing/failed lookup just means nothing to restore; the card
      // stays in its empty state.
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore persisted server state on mount
    void restoreActiveBackupArchive();
  }, [restoreActiveBackupArchive]);

  // Load site settings on mount
  useEffect(() => {
    void apiFetch<SiteSettings>("/api/v1/settings")
      .then((settings) => setSiteSettings(settings))
      .catch(() => {
        // Fallback is handled gracefully by not blocking uploads
      });
  }, []);

  const refreshAutomatedBackups = useCallback(async () => {
    try {
      // The schedule is still usable if a legacy/partially-migrated database
      // cannot list historical job rows yet. A single failed request must not
      // make the whole card look as though it is loading forever.
      const config = await apiFetch<AutomatedBackupSettings>(
        "/api/v1/backup/automatic",
      );
      setAutomatedSettings(config);
      setAutomatedError(null);
      try {
        setAutomatedJobs(
          await apiFetch<PortableBackupJob[]>("/api/v1/backup/automatic/jobs"),
        );
      } catch (error) {
        setAutomatedJobs([]);
        setAutomatedError(
          error instanceof ApiError
            ? `Schedule loaded, but backup history could not load: ${error.message}`
            : "Schedule loaded, but backup history could not load.",
        );
      }
    } catch (error) {
      setAutomatedSettings(null);
      setAutomatedError(
        error instanceof ApiError
          ? error.message
          : "Could not load automatic backup settings.",
      );
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load persisted server state on mount
    void refreshAutomatedBackups();
  }, [refreshAutomatedBackups]);

  async function saveAutomatedBackups() {
    if (!automatedSettings) return;
    setAutomatedPending(true);
    setAutomatedSubdirectoryError(null);
    try {
      const saved = await apiFetch<AutomatedBackupSettings>("/api/v1/backup/automatic", {
        method: "PATCH",
        body: {
          enabled: automatedSettings.enabled,
          interval_unit: automatedSettings.interval_unit,
          interval_value: automatedSettings.interval_value,
          time_of_day: automatedSettings.time_of_day,
          timezone: automatedSettings.timezone,
          retention_count: automatedSettings.retention_count,
          subdirectory: automatedSettings.subdirectory,
        },
      });
      setAutomatedSettings(saved);
      toast.success("Automatic backup settings saved.");
    } catch (error) {
      if (error instanceof ApiError && error.code === "backup_subdirectory_invalid") {
        setAutomatedSubdirectoryError(error.message);
      } else {
        toast.error(error instanceof ApiError ? error.message : "Could not save automatic backups.");
      }
    } finally { setAutomatedPending(false); }
  }

  async function runAutomatedBackupNow() {
    setAutomatedPending(true);
    try {
      await apiFetch("/api/v1/backup/automatic/run", { method: "POST" });
      toast.success("Automatic backup queued.");
      await refreshAutomatedBackups();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not queue automatic backup.");
    } finally { setAutomatedPending(false); }
  }

  async function deleteAutomatedBackup() {
    if (!deleteAutomatedJobId) return;
    setAutomatedPending(true);
    try {
      await apiFetch(`/api/v1/backup/automatic/jobs/${deleteAutomatedJobId}`, { method: "DELETE" });
      toast.success("Automatic backup deleted.");
      await refreshAutomatedBackups();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not delete automatic backup.");
    } finally { setAutomatedPending(false); setDeleteAutomatedJobId(null); }
  }

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
      void restorePortableBackupJob();
      void restoreActiveBackupArchive();
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
  }, [
    restoreStoredConfluenceUpload,
    restoreActiveConfluenceJob,
    restorePortableBackupJob,
    restoreActiveBackupArchive,
  ]);

  async function uploadConfluence(
    resume = false,
    overrideStored?: StoredConfluenceUpload,
  ) {
    const saved = overrideStored ?? (resume ? storedConfluenceUpload : null);
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
    let visibilityRenewalHandler: (() => void) | null = null;
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
    // A miss on the interval below (a backgrounded tab is throttled by the
    // browser, or the machine slept through it) leaves the *old* cookie's
    // fixed max-age ticking down uninterrupted, and it lapses for real once
    // that deadline passes - no amount of catching up afterwards restores a
    // cookie the browser already discarded. Renewing again the moment the
    // tab is looked at closes that gap for anything short of a miss that
    // long, which covers the ordinary case (tab left in the background)
    // rather than the extreme one (laptop asleep for the whole session TTL).
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
      sessionRenewalTimer = window.setInterval(runRenewal, 5 * 60 * 1000);
      visibilityRenewalHandler = () => {
        if (document.visibilityState === "visible") runRenewal();
      };
      document.addEventListener("visibilitychange", visibilityRenewalHandler);
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
          err instanceof ApiError
            ? err.message
            : "Could not upload or scan the Confluence archive.",
        );
      }
    } finally {
      if (sessionRenewalTimer !== null) {
        window.clearInterval(sessionRenewalTimer);
      }
      if (visibilityRenewalHandler !== null) {
        document.removeEventListener("visibilitychange", visibilityRenewalHandler);
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
    if (confluenceFileInput.current) {
      confluenceFileInput.current.value = "";
    }
    setConfluenceArchive(null);
    setUploadProgress(null);
    setUploadStats(null);
    setHashStats(null);
    setPreparationLogs([]);
    setConfluenceUploadError(null);
    setConfluenceUploadNotice(null);
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
    // Whichever card was uploading gets paused, not cancelled: its parts stay
    // in object storage either way, and the page reload below is what makes
    // the pause stick. They are checked independently rather than as an
    // if/else so a state neither card expects still leaves nothing running.
    if (uploadActiveRef.current) cancelConfluenceUpload("pause");
    if (restoreUploadActiveRef.current) pauseBackupArchiveUpload();
    window.location.assign(leaveTarget);
  }

  /** Discard a scanned archive from the server and reset the import UI so the
   * user can upload a different file. Safe to call both from the inline banner
   * and from inside the space-selection modal. */
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
      setConfluenceUploadNotice(null);
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
      toast.error(
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

  /** Upload a `.zip` restore archive to object storage in small, bounded
   * parts (never one giant multipart POST), then scan it so its space list
   * is ready for the picker - mirrors `uploadConfluence`'s
   * fingerprint-then-chunked-PUT-then-scan shape, including the same
   * sha256-dedup (a byte-identical archive already in storage is reused
   * instead of re-uploaded). Populates `backupArchive` on success; never
   * touches `pending`, which is reserved for the final "create the restore
   * job" step in `submitImport` below. Deliberately still lacks Confluence's
   * localStorage-backed resume across a reload - a restore upload
   * interrupted by closing the tab has to restart, a known, separate gap. */
  async function uploadAndScanBackupArchive(targetFile: File): Promise<void> {
    const run = uploadBackupRun.current + 1;
    uploadBackupRun.current = run;
    const stillCurrent = () => uploadBackupRun.current === run;
    // Held for the whole operation, not derived from the phase flags below.
    // Those go false between phases - notably across the `POST .../uploads`
    // that sits between fingerprinting and the first part - and the leave
    // guard read on exactly those gaps: click a link in one and the upload
    // was abandoned with no prompt at all. Confluence never had the bug
    // because it raises one `confluencePending` for the whole call; this is
    // the same idea, kept in a ref since only the guard reads it.
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
    // A previous restore's card (e.g. "Restore was cancelled") otherwise
    // keeps showing right through this new upload, since nothing else ever
    // clears a finished job once `portableBackupJob` holds it - starting a
    // fresh restore is a clean slate, so that stale card goes with it.
    setPortableBackupJob(null);
    let reachedScan = false;
    try {
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
        await apiFetch(
          `/api/v1/backup/archives/${target.archive_id}/complete-upload`,
          { method: "POST" },
        );
        appendRestorePreparationLog("Multipart upload completed.");
      }
      if (!stillCurrent()) return;

      // Always scan, even for a reused archive: cheap/idempotent once
      // already `"scanned"` (`BackupArchiveService.scan` short-circuits),
      // and this is the one call that actually populates `.spaces`.
      reachedScan = true;
      appendRestorePreparationLog(
        "Scanning the archive for its space list. This can take a few minutes.",
      );
      setIsScanningBackupArchive(true);
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
      // Straight into the picker, the way the Confluence scan does it: the
      // scan exists to answer "which spaces?", so landing on a bar that asks
      // the user to click once more before being allowed to answer is a step
      // that earns nothing. The bar stays for coming back to the decision.
      setIsImportSpacePickerOpen(true);
      toast.success("Archive scanned. Choose which spaces to restore.");
    } catch (err) {
      if (!stillCurrent()) return;
      if (err instanceof DOMException && err.name === "AbortError") {
        // `cancelBackupArchiveUpload` already reset the UI and shown its own
        // toast - nothing further to report here.
        return;
      }
      // A 4xx from the scan is a verdict on the file, not on the transfer:
      // the bytes all arrived and the server looked inside and said no. A 5xx
      // or a dropped connection is not - that is worth another attempt, which
      // re-uses the archive already in storage.
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
        err instanceof ApiError
          ? err.message
          : "Could not upload or scan the backup archive.",
      );
    } finally {
      if (stillCurrent()) {
        restoreUploadActiveRef.current = false;
        setIsHashingBackupArchive(false);
        setBackupHashStats(null);
        setIsUploadingBackupArchive(false);
        setIsScanningBackupArchive(false);
      }
    }
  }

  /** Leave a rejected archive behind and pick a different file.
   *
   * The single way forward once the server has refused what was uploaded, so
   * it does both halves of the job: the staged parts are dropped - a rejected
   * 24 GB archive is worth nothing and must not be left occupying object
   * storage - and the picker opens. Cancel used to sit beside this as the only
   * thing that freed those bytes, which made the useful button a two-step and
   * left the other one looking like the destructive choice.
   *
   * Everything the picker needs happens synchronously: `click()` only opens a
   * file dialog while the browser still considers the click a user gesture,
   * and awaiting the delete first would spend it. The delete is best-effort
   * afterwards; an orphaned "uploading" row is never offered for restore. */
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

  /** Decide what a freshly selected restore file means.
   *
   * With an unfinished upload waiting for its file back, choosing the file is
   * the whole answer - it says "carry on with this" - so the upload resumes
   * on the spot rather than asking for a second click on a button whose only
   * job would be to repeat what was just said.
   *
   * A file that is not the one being resumed cannot be waved through: the
   * parts in storage belong to the other file, and continuing would build an
   * archive out of two different backups. Name and size are compared rather
   * than fingerprints - it is instant, and it is enough to *ask*. The server
   * still matches on the sampled fingerprint before reusing a single byte, so
   * a same-name, same-size impostor starts a fresh upload rather than
   * corrupting the staged one.
   */
  async function handleRestoreFileSelected(selectedFile: File) {
    let wrongFormat = false;
    await rejectWrongArchiveFormat(selectedFile, "wikihub", (message) => {
      wrongFormat = true;
      toast.error(message);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
    });
    if (wrongFormat) return;

    const pending = pendingRestoreUpload;
    if (!pending) return;
    if (
      selectedFile.name === pending.filename &&
      selectedFile.size === pending.size_bytes
    ) {
      void uploadAndScanBackupArchive(selectedFile);
      return;
    }
    setMismatchedResumeFile(selectedFile);
  }

  /** Give up on the staged parts and upload the file just chosen instead. */
  async function uploadMismatchedFileInstead() {
    const next = mismatchedResumeFile;
    setMismatchedResumeFile(null);
    if (!next) return;
    // Delete first: leaving the old parts behind would keep the other file
    // offered for resume on the next visit, on top of this upload.
    await discardPendingRestoreUpload();
    void uploadAndScanBackupArchive(next);
  }

  /** Ask for the file the staged parts actually belong to. */
  function reselectFileForResume() {
    setMismatchedResumeFile(null);
    setFile(null);
    if (fileInput.current) {
      fileInput.current.value = "";
      fileInput.current.click();
    }
  }

  /** Answer "restore more" by reopening the picker on the archive already
   * staged, rather than sending the user back to choose a file.
   *
   * A restore usually covers part of a backup - that is the whole reason the
   * picker exists - so the likely next step is the spaces that were skipped,
   * not a different backup. Discarding the archive here meant re-uploading
   * multiple GB to reach a picker that was one click away.
   *
   * The archive is re-read rather than reused from state: its `conflict`
   * flags were computed when it was scanned, and the restore that just
   * finished created spaces. Without this the picker would offer the keys it
   * had just filled as though they were still free.
   */
  async function restoreMoreFromSameArchive() {
    const archive = backupArchive;
    setPortableBackupJob(null);
    settledRestoreJobIdRef.current = null;
    setRestoreJobLogs([]);
    setReport(null);
    setIsRestoreSuccessModalOpen(false);
    if (!archive) {
      // Nothing staged - a `.json` restore, or the archive was discarded.
      // Back to a clean "choose a file" card, as before.
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
      // Keep the picker open on what is already known: the flags may be a
      // scan out of date, but the server rejects a conflicting restore
      // anyway, and closing the picker under the user would be worse.
    }
  }

  /** Throw away an unfinished upload rediscovered from a previous visit,
   * without needing the original file back. */
  async function discardPendingRestoreUpload() {
    const pending = pendingRestoreUpload;
    setPendingRestoreUpload(null);
    if (!pending) return;
    try {
      await apiFetch(
        `/api/v1/backup/archives/${pending.archive_id}/upload`,
        { method: "DELETE" },
      );
    } catch {
      // Best-effort: an orphaned "uploading" row is harmless and is never
      // offered for restore.
    }
    toast.success("Unfinished upload discarded.");
  }

  /** Stop uploading but keep everything already sent.
   *
   * The archive row and its uploaded parts stay untouched in object storage,
   * so pressing "Upload and scan" again on the same file resumes from where
   * this left off - the server finds the partial upload by its fingerprint
   * (`find_resumable_archive`). The selected file is deliberately kept for
   * exactly that reason; `cancelBackupArchiveUpload` below is the
   * destructive counterpart that throws the parts away. */
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

  /** Aborts an in-flight "Upload and scan" (fingerprinting, uploading, or
   * between-request) and best-effort deletes the archive it had started,
   * discarding every part uploaded so far - the destructive counterpart to
   * `pauseBackupArchiveUpload`. Confirmed by a dialog first
   * (`confirmCancelBackupUpload`) since a misclick here throws away real
   * upload progress on a possibly multi-GB file - same guard Confluence's
   * own cancel-upload button has. */
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
        // Best-effort cleanup only - an orphaned "uploading" archive is
        // harmless and never offered back to the picker.
      }
    }
    setCancelBackupUploadPending(false);
    toast.success("Backup archive upload cancelled.");
  }

  /** Return the restore card to a clean "choose a file" state. Doesn't
   * delete anything server-side: the archive stays available for
   * sha256-dedup if the same file is selected again. */
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

  /** Discard a scanned archive so a different file can be picked - mirrors
   * `discardConfluenceArchive`. */
  async function discardBackupArchive() {
    // Tell the server, not just this tab. Clearing only local state left the
    // archive "scanned" server-side, so the next page load rediscovered it
    // (`restoreActiveBackupArchive`) and put the card straight back - with the
    // file input disabled against it, which made a new upload impossible and
    // pressing Cancel again equally useless.
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
        err instanceof ApiError
          ? err.message
          : "Could not discard the uploaded archive.",
      );
    }
  }

  async function submitImport(overwriteSpaceKeys: string[] = []) {
    if (backupArchive) {
      // A `.zip` restore: the archive is already uploaded and scanned (via
      // "Upload and scan" / `uploadAndScanBackupArchive`) by the time this
      // is reachable, so this only queues the `full_import` job and lets the
      // shared job-progress card (`renderPortableJobCard`) take over.
      setPending("apply");
      setError(null);
      try {
        const job = await apiFetch<PortableBackupJob>(
          `/api/v1/backup/archives/${backupArchive.id}/jobs`,
          {
            method: "POST",
            body: {
              space_keys:
                // An empty list means "everything" to the server, so a
                // selection covering the whole archive is sent as one.
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
          err instanceof ApiError
            ? err.message
            : "Could not restore the backup file.",
        );
      } finally {
        setPending(null);
      }
      return;
    }

    if (!file) return;
    // A JSON backup is small (capped server-side at 64MB) - stays a plain
    // synchronous request/response, unlike the `.zip` path above.
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
        err instanceof ApiError
          ? err.message
          : "Could not read the backup file.",
      );
    } finally {
      setPending(null);
    }
  }

  /** Gate for the space picker's "Start restore" button - same shape as
   * `requestConfluenceImport`: ask about anything the archive's own scan
   * already flagged as an existing space before the restore ever runs,
   * rather than skipping it silently and only offering to fix that up
   * afterwards. */
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

  /** The export-job status card (percent, ETA, cancel), reused verbatim for
   * restore jobs rather than cloned - `forKind` only steers which
   * `portableBackupJob.kind` this particular placement owns and the label
   * strings, so both placements stay the exact same UI as new fields/states
   * are added to the shared card in the future. */
  /** WikiHub restore: one account of the whole thing.
   *
   * Two sources, one panel: this browser narrates the upload half
   * (fingerprint, resume decision, parts, scan) because no job row exists yet
   * to record it, and the worker narrates the restore itself. Oldest first,
   * newest last, scrolled to the bottom - a log that grows upward makes you
   * re-find your place on every new line.
   *
   * Rendered two different ways depending on whether a restore is actively
   * running - see the two call sites - but this is the one definition of
   * what it looks like, so they cannot drift apart. */
  /** The rows inside any job's activity log - one implementation for the
   * WikiHub export card, the WikiHub restore card, the Confluence import
   * card and the restore's own pre-job panel below, so all four read
   * identically instead of drifting the way the restore and Confluence
   * cards previously had. */
  function renderJobLogRows(entries: JobLogEntry[]) {
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

  /** WikiHub restore: the browser's own narration of the upload half
   * (fingerprint, resume decision, parts, scan) before a job row exists to
   * record it. Once a job exists, its log lives inside that job's own
   * `renderJobActivityCard` instead (see `renderPortableJobCard`) - this
   * standalone panel is only for the stretch before that. */
  function renderRestoreLogPanel() {
    if (!restoreLogEntries.length) return null;
    return (
      <LogDisclosure
        title="Restore logs"
        count={restoreLogEntries.length}
        expanded={restoreLogsExpanded}
        onExpandedChange={setRestoreLogsExpanded}
        listRef={restoreLogsListRef}
      >
        {renderJobLogRows(restoreLogEntries)}
      </LogDisclosure>
    );
  }

  /** The one job-progress card layout: title, status badge, subtitle,
   * progress bar, an optional detail line, cancel/trailing actions and its
   * activity log. Fed by WikiHub export/restore jobs and the Confluence
   * import job alike (see the call sites) so the three cannot visually
   * drift apart the way restore and Confluence previously had. */
  function renderJobActivityCard({
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

  function renderPortableJobCard(forKind: "export" | "restore") {
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
        ? `${noun} is ${isRestore ? "complete" : "ready"}`
        : status === "failed"
          ? `${noun} failed`
          : status === "cancelled"
            ? `${noun} was cancelled`
            : portableBackupJob.cancel_requested
              ? `Cancelling ${noun.toLowerCase()}…`
              : `${isRestore ? "Restoring" : "Exporting"} backup…`;

    const subtitle =
      status === "complete"
        ? isRestore
          ? "The backup was applied. This page refreshes automatically."
          : "It should download automatically — if not, click the button."
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

    return renderJobActivityCard({
      title,
      badgeLabel,
      badgeVariant,
      subtitle,
      extraLine,
      percent,
      cancel: isPortableJobRunning
        ? {
            label: portableBackupJob.cancel_requested
              ? "Cancelling…"
              : `Cancel ${noun.toLowerCase()}`,
            onClick: () => setConfirmCancelExport(true),
            disabled:
              cancelExportPending || portableBackupJob.cancel_requested,
          }
        : null,
      trailing:
        portableBackupJob.download_url && portableBackupJob.output_filename ? (
          <Button asChild variant="secondary" size="sm">
            <a
              href={portableBackupJob.download_url}
              download={portableBackupJob.output_filename}
            >
              <Download /> Download {portableBackupJob.output_filename}
            </a>
          </Button>
        ) : null,
      logs: isRestore ? restoreLogEntries : [],
      logsTitle: isRestore ? "Restore logs" : "Export logs",
      logsExpanded: restoreLogsExpanded,
      onLogsExpandedChange: setRestoreLogsExpanded,
      logsListRef: restoreLogsListRef,
    });
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

      {/* -- Export ------------------------------------------------------- */}
      <section
        id="backup-export-section"
        role="tabpanel"
        className={cn(
          "border-border bg-surface overflow-hidden rounded-xl border p-5 shadow-sm",
          activeSection !== "export" && "hidden",
        )}
      >
        <div className="mb-5">
          <h2 className="flex items-center gap-2.5 text-base font-semibold">
            <span className="bg-primary-subtle text-primary flex size-8 items-center justify-center rounded-md">
              <Archive className="size-4" />
            </span>
            Export & Backup workspace data
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Two separate export formats are available. They serve different
            purposes and are{" "}
            <strong className="text-foreground font-medium">
              not interchangeable
            </strong>
            .
          </p>
        </div>

        {/* 2 Export Option Cards — distinct colour accents to prevent confusion */}
        <div className="grid grid-cols-1 gap-0 md:grid-cols-[1fr_auto_1fr]">

          {/* Card 1: WikiHub Native Backup */}
          <div className="border-border bg-surface-raised flex flex-col overflow-hidden rounded-xl border shadow-sm">
            <div className="flex flex-1 flex-col p-4">
              {/* Header */}
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="bg-primary-subtle text-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
                    <HardDrive className="size-4" />
                  </span>
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      Export WikiHub Backup
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

              {/* Purpose */}
              <p className="text-muted-foreground text-xs leading-relaxed">
                A complete{" "}
                <code className="text-foreground bg-surface-sunken rounded px-1 py-0.5 font-mono text-[11px]">
                  .zip
                </code>{" "}
                of all spaces, pages, revisions and attachments. Use this to{" "}
                <span className="text-foreground font-medium">
                  restore WikiHub itself
                </span>{" "}
                — on a new server, after data loss, or before a major upgrade.
              </p>

              <div className="mt-auto pt-4">
                <Button
                  type="button"
                  variant="primary"
                  className="w-full"
                  disabled={isDownloading || isPortableJobRunning}
                  aria-busy={isFullExportRunning}
                  onClick={() => setIsExportOptionsOpen(true)}
                >
                  {isFullExportRunning ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Download />
                  )}
                  {isFullExportRunning ? "Exporting…" : "Export WikiHub Backup"}
                </Button>
              </div>
            </div>
          </div>

          {/* "or" divider between the two cards */}
          <div className="flex items-center justify-center py-4 md:flex-col md:px-4 md:py-0">
            <div className="bg-border h-px w-full md:h-full md:w-px" />
            <span className="bg-surface border-border text-muted-foreground mx-3 shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium md:mx-0 md:my-3">
              or
            </span>
            <div className="bg-border h-px w-full md:h-full md:w-px" />
          </div>

          {/* Card 2: Confluence DC Export */}
          <div className="border-border bg-surface-raised flex flex-col overflow-hidden rounded-xl border shadow-sm">
            <div className="flex flex-1 flex-col p-4">
              {/* Header */}
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg"
                    style={{
                      backgroundColor: "hsl(38 92% 50% / 0.12)",
                      color: "hsl(38 92% 50%)",
                    }}
                  >
                    <ArrowUpFromLine className="size-4" />
                  </span>
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      Export Confluence Backup
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

              {/* Purpose */}
              <p className="text-muted-foreground text-xs leading-relaxed">
                An XML archive compatible with Atlassian Confluence Data Center
                restore tools. Use this to{" "}
                <span className="text-foreground font-medium">
                  hand content off to a Confluence instance
                </span>{" "}
                — it cannot be used to restore WikiHub.
              </p>

              <div className="mt-auto space-y-2 pt-4">
                <Select
                  value={confluenceExportProfile}
                  onValueChange={(val) => setConfluenceExportProfile(val)}
                >
                  <SelectTrigger
                    aria-label="Confluence Data Center target version"
                    className="h-9 w-full text-xs"
                  >
                    <SelectValue placeholder="Choose target version" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dc-8">Data Center 8.x</SelectItem>
                    <SelectItem value="dc-9">Data Center 9.x</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="primary"
                  className="w-full"
                  disabled={
                    isDownloading ||
                    isPortableJobRunning ||
                    !confluenceExportProfile
                  }
                  aria-busy={isDownloading || isConfluenceExportRunning}
                  onClick={() => void createPortableExport("confluence_export")}
                >
                  {isDownloading || isConfluenceExportRunning ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <ArrowUpFromLine />
                  )}
                  {isConfluenceExportRunning ? "Exporting…" : "Export DC XML"}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {renderPortableJobCard("export")}
      </section>

      {/* -- Automatic backups ---------------------------------------------
          Below the manual export cards, not above them: a manual export is
          what someone opens this tab to *do*, and the recurring schedule is
          a one-time setup step most visits never touch. Leading with it put
          the thing people came for beneath a wall of schedule fields. */}
      <section
        id="automatic-backups-section"
        role="region"
        aria-labelledby="automatic-backups-title"
        className={cn(
          "border-border bg-surface rounded-xl border p-4 shadow-sm",
          activeSection !== "export" && "hidden",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <span className="bg-primary-subtle text-primary flex size-7 shrink-0 items-center justify-center rounded-lg">
              <RotateCcw className="size-3.5" />
            </span>
            <div>
              <h2 id="automatic-backups-title" className="text-sm font-semibold">
                Automatic backups
              </h2>
              <p className="text-muted-foreground text-xs">
                A full recovery package - including password hashes - is
                written on a recurring schedule, with no confirmation step
                the way a manual export has.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* A real switch rather than a field buried in the grid below -
                whether the schedule is even on is the first thing worth
                seeing, not something read off row four of a form. */}
            <label
              className={cn(
                "border-border bg-surface has-disabled:opacity-60 flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium",
                "has-disabled:cursor-not-allowed",
              )}
            >
              <input
                type="checkbox"
                checked={automatedSettings?.enabled ?? false}
                disabled={
                  !automatedSettings || !automatedSettings.directory_configured
                }
                onChange={(event) =>
                  automatedSettings &&
                  setAutomatedSettings({
                    ...automatedSettings,
                    enabled: event.target.checked,
                  })
                }
                className="peer sr-only"
              />
              <span
                aria-hidden
                className="bg-border-strong peer-checked:bg-success relative h-4 w-7 shrink-0 rounded-full transition-colors duration-150"
              >
                <span className="bg-surface absolute top-0.5 left-0.5 size-3 rounded-full shadow-sm transition-transform duration-150 peer-checked:translate-x-3" />
              </span>
              {automatedSettings?.enabled ? "Enabled" : "Disabled"}
            </label>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={automatedPending || !automatedSettings?.directory_configured}
              onClick={() => void runAutomatedBackupNow()}
            >
              <Play /> Run now
            </Button>
          </div>
        </div>
        {automatedSettings ? (
          <div className="mt-3.5 space-y-3.5">
            {/* Storage: the mounted volume is fixed at deploy time and shown
                for context only; the subfolder under it is the one thing an
                admin can actually choose here, and it is checked against the
                real filesystem the moment "Save schedule" is pressed - a
                path that turns out wrong fails right in front of whoever
                typed it, not hours later as an unwatched scheduled run. */}
            <div className="space-y-1.5">
              <p className="text-muted-foreground text-[10px] font-semibold tracking-[0.08em] uppercase">
                Storage location
              </p>
              <div
                className={cn(
                  "flex items-start gap-2 rounded-lg border p-2.5 text-xs",
                  automatedSettings.directory_configured
                    ? "border-success/30 bg-success-bg"
                    : "border-danger/30 bg-danger/10",
                )}
              >
                <FolderOpen
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    automatedSettings.directory_configured
                      ? "text-success"
                      : "text-danger",
                  )}
                />
                <div className="min-w-0">
                  <p className="font-medium break-all">
                    {automatedSettings.directory_configured
                      ? automatedSettings.directory
                      : "No backup directory is available"}
                  </p>
                  <p className="text-muted-foreground mt-0.5">
                    {automatedSettings.base_directory ? (
                      <>
                        Mounted volume:{" "}
                        <code className="text-foreground bg-surface-sunken rounded px-1 py-0.5 font-mono">
                          {automatedSettings.base_directory}
                        </code>
                      </>
                    ) : (
                      "The host backup volume is not mounted. Set WIKIHUB_AUTOMATED_BACKUP_DIRECTORY and mount a volume there."
                    )}
                  </p>
                </div>
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="automated-backup-subdirectory"
                  className="text-muted-foreground text-xs font-medium"
                >
                  Subfolder (optional)
                </label>
                <Input
                  id="automated-backup-subdirectory"
                  value={automatedSettings.subdirectory ?? ""}
                  disabled={!automatedSettings.base_directory}
                  onChange={(event) => {
                    setAutomatedSubdirectoryError(null);
                    setAutomatedSettings({
                      ...automatedSettings,
                      subdirectory: event.target.value || null,
                    });
                  }}
                  placeholder="e.g. team-a - leave blank to use the mounted volume's root"
                  aria-invalid={automatedSubdirectoryError ? true : undefined}
                  aria-describedby="automated-backup-subdirectory-hint"
                />
                <p
                  id="automated-backup-subdirectory-hint"
                  className="text-muted-foreground text-[11px]"
                >
                  Relative to the mounted volume above. Create the folder
                  there first - this is not offered to create it for you.
                </p>
                {automatedSubdirectoryError ? (
                  <p className="text-danger text-xs">
                    {automatedSubdirectoryError}
                  </p>
                ) : null}
              </div>
            </div>

            {/* Schedule - Enabled moved up to the header, so this is exactly
                the five fields it takes to describe "how often, starting
                when, in what timezone, keeping how many" - no more orphan
                sixth field wrapping onto a row by itself. */}
            <div className="space-y-1.5">
              <p className="text-muted-foreground text-[10px] font-semibold tracking-[0.08em] uppercase">
                Schedule
              </p>
              <div className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
                <div className="space-y-1">
                  <label
                    htmlFor="automated-backup-interval"
                    className="text-muted-foreground text-xs font-medium"
                  >
                    Every
                  </label>
                  <Input
                    id="automated-backup-interval"
                    type="number"
                    min="1"
                    max="720"
                    value={automatedSettings.interval_value}
                    onChange={(event) =>
                      setAutomatedSettings({
                        ...automatedSettings,
                        interval_value: Number(event.target.value) || 1,
                      })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <span
                    id="automated-backup-unit-label"
                    className="text-muted-foreground text-xs font-medium"
                  >
                    Unit
                  </span>
                  <Select
                    value={automatedSettings.interval_unit}
                    onValueChange={(value) =>
                      setAutomatedSettings({
                        ...automatedSettings,
                        interval_unit: value as "hours" | "days",
                      })
                    }
                  >
                    <SelectTrigger aria-labelledby="automated-backup-unit-label">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hours">Hours</SelectItem>
                      <SelectItem value="days">Days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor="automated-backup-time"
                    className="text-muted-foreground text-xs font-medium"
                  >
                    Start time
                  </label>
                  <Input
                    id="automated-backup-time"
                    type="time"
                    value={automatedSettings.time_of_day}
                    onChange={(event) =>
                      setAutomatedSettings({
                        ...automatedSettings,
                        time_of_day: event.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor="automated-backup-timezone"
                    className="text-muted-foreground text-xs font-medium"
                  >
                    Timezone
                  </label>
                  <Input
                    id="automated-backup-timezone"
                    value={automatedSettings.timezone}
                    onChange={(event) =>
                      setAutomatedSettings({
                        ...automatedSettings,
                        timezone: event.target.value,
                      })
                    }
                    placeholder="Asia/Ho_Chi_Minh"
                  />
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor="automated-backup-retention"
                    className="text-muted-foreground text-xs font-medium"
                  >
                    Keep successful backups
                  </label>
                  <Input
                    id="automated-backup-retention"
                    type="number"
                    min="1"
                    max="1000"
                    value={automatedSettings.retention_count}
                    onChange={(event) =>
                      setAutomatedSettings({
                        ...automatedSettings,
                        retention_count: Number(event.target.value) || 1,
                      })
                    }
                  />
                </div>
              </div>
            </div>

            <div className="border-border flex flex-wrap items-end justify-between gap-3 border-t pt-3">
              <div className="flex flex-wrap gap-4 text-xs">
                <div>
                  <p className="text-muted-foreground">Last run</p>
                  <p className="text-foreground mt-0.5 flex items-center gap-1.5 font-medium">
                    {automatedSettings.last_run_at
                      ? new Date(automatedSettings.last_run_at).toLocaleString()
                      : "Never"}
                    {automatedSettings.last_status ? (
                      <Badge
                        variant={
                          automatedSettings.last_status === "complete"
                            ? "success"
                            : automatedSettings.last_status === "failed"
                              ? "danger"
                              : "info"
                        }
                      >
                        {automatedSettings.last_status}
                      </Badge>
                    ) : null}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Next run</p>
                  <p className="text-foreground mt-0.5 font-medium">
                    {automatedSettings.next_run_at
                      ? new Date(automatedSettings.next_run_at).toLocaleString()
                      : "Calculated after saving"}
                  </p>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="primary"
                disabled={automatedPending}
                aria-busy={automatedPending}
                onClick={() => void saveAutomatedBackups()}
              >
                {automatedPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Save schedule
              </Button>
            </div>
            {automatedSettings.last_error ? (
              <p className="text-danger text-xs">
                Last error: {automatedSettings.last_error}
              </p>
            ) : null}
            {automatedError ? (
              <p className="text-warning text-xs">{automatedError}</p>
            ) : null}

            {/* Recent backups */}
            <div className="space-y-1.5">
              <p className="text-muted-foreground text-[10px] font-semibold tracking-[0.08em] uppercase">
                History
              </p>
              <div className="border-border overflow-hidden rounded-lg border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface-sunken text-muted-foreground">
                    <tr>
                      <th className="p-1.5 font-medium">Backup</th>
                      <th className="p-1.5 font-medium">Status</th>
                      <th className="p-1.5 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {automatedJobs.length ? (
                      automatedJobs.slice(0, 5).map((job) => (
                        <tr key={job.id} className="border-border border-t">
                          <td className="p-1.5">
                            {job.output_filename ??
                              new Date(job.created_at).toLocaleString()}
                          </td>
                          <td className="p-1.5">
                            <Badge
                              variant={
                                job.status === "complete"
                                  ? "success"
                                  : job.status === "failed"
                                    ? "danger"
                                    : "info"
                              }
                            >
                              {job.status}
                            </Badge>
                          </td>
                          <td className="p-1.5">
                            <div className="flex items-center gap-3">
                              {job.download_url ? (
                                <a
                                  className="text-primary hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  href={job.download_url}
                                >
                                  Download
                                </a>
                              ) : null}
                              <button
                                type="button"
                                className="text-danger hover:text-danger/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                onClick={() => setDeleteAutomatedJobId(job.id)}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={3}
                          className="text-muted-foreground p-2 text-center"
                        >
                          No scheduled backups have run yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-3.5 flex flex-wrap items-center gap-3 text-sm" role="status">
            <p className="text-muted-foreground">
              {automatedError ?? "Loading automatic backup settings…"}
            </p>
            {automatedError ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void refreshAutomatedBackups()}
              >
                <RotateCcw /> Retry
              </Button>
            ) : null}
          </div>
        )}
      </section>

      {/* -- Confluence import + WikiHub restore (unified) ----------------- */}
      <section
        id="backup-import-section"
        role="tabpanel"
        className={cn(
          "border-border bg-surface overflow-hidden rounded-xl border p-5 shadow-sm",
          activeSection !== "import" && "hidden",
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

              {(() => {
                // A scanned archive is a `.zip` by definition, and it can
                // outlive the `File` that produced it - rediscovered from the
                // server after a remount there is no `File` at all, only the
                // archive. Gating the scope picker on `file` alone hid the
                // whole restore step in exactly that case.
                // A rediscovered unfinished upload counts too: there is no
                // `File` behind it, but it is still a `.zip` mid-flight, and
                // the upload controls - not "Restore backup" - are what it
                // needs next.
                const isZipSelected =
                  file?.name.toLocaleLowerCase().endsWith(".zip") ||
                  Boolean(backupArchive) ||
                  restoreUploadResumable;
                return (
                  <div className="mt-auto space-y-3 pt-4">
                    <div>
                      <input
                        id="backup-file"
                        ref={fileInput}
                        type="file"
                        accept="application/json,.json,application/zip,.zip"
                        disabled={
                          isPreparingArchive ||
                          Boolean(backupArchive) ||
                          restoreInputsLocked
                        }
                        onChange={(e) => {
                          const selectedFile = e.target.files?.[0] ?? null;
                          if (
                            selectedFile &&
                            siteSettings?.effective
                              ?.max_backup_import_size_bytes &&
                            selectedFile.size >
                              siteSettings.effective
                                .max_backup_import_size_bytes
                          ) {
                            setFile(null);
                            setReport(null);
                            toast.error(
                              `Backup exceeds the configured ${siteSettings.effective.max_backup_import_size_mb} MB limit.`,
                            );
                            e.target.value = "";
                            return;
                          }
                          setFile(selectedFile);
                          setReport(null);
                          setError(null);
                          // A new file invalidates any archive/space
                          // list/selection read from the previous one.
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
                        }}
                        className={cn(
                          "border-border bg-surface file:bg-surface-sunken file:text-foreground hover:border-border-strong block w-full rounded-md border text-sm transition-colors duration-150 file:mr-3 file:border-0 file:px-3 file:py-2 file:text-sm",
                          isPreparingArchive ||
                            backupArchive ||
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
                      ) : isRestoreJobRunning || pending === "apply" ? (
                        <p className="text-muted-foreground mt-1.5 text-xs">
                          A restore is running. Wait for it to finish, or
                          cancel it below, before choosing another backup.
                        </p>
                      ) : restoreUploadNeedsFile ? (
                        <p className="text-muted-foreground mt-1.5 text-xs">
                          Select {pendingRestoreUpload?.filename} again so
                          WikiHub can read the remaining parts.
                        </p>
                      ) : restoreUploadResumable && pendingRestoreUpload ? (
                        <p className="text-muted-foreground mt-1.5 text-xs">
                          {formatBytes(pendingRestoreUploadedBytes)} of{" "}
                          {pendingRestoreUpload.filename} is already in
                          storage. Resume upload sends only what is missing.
                        </p>
                      ) : backupArchive ? (
                        <p className="text-muted-foreground mt-1.5 text-xs">
                          Use a different file below to replace this
                          selection.
                        </p>
                      ) : null}
                    </div>

                    {/* No in-card space picker: once the archive is scanned,
                        the full-width "ready to restore" bar below owns that
                        decision, the way the Confluence flow has always done
                        it. Two controls for one choice is what made the two
                        halves of this panel feel like different products. */}

                    {error ? (
                      <p
                        role="alert"
                        className="border-danger/30 bg-danger/10 text-danger rounded-md border px-3 py-2 text-sm"
                      >
                        {error}
                      </p>
                    ) : null}

                    {isZipSelected && !backupArchive ? (
                      isScanningBackupArchive ? null : isPreparingArchive ? (
                        <div className="flex gap-2">
                          {isUploadingBackupArchive ? (
                            <Button
                              variant="secondary"
                              className="flex-1"
                              onClick={pauseBackupArchiveUpload}
                            >
                              <Pause /> Pause upload
                            </Button>
                          ) : null}
                          <Button
                            variant="danger"
                            className="flex-1"
                            onClick={() => setConfirmCancelBackupUpload(true)}
                          >
                            Cancel upload
                          </Button>
                        </div>
                      ) : (
                        // A refused archive is a dead end, not a pause: the
                        // only way forward is a different file, so that is what
                        // the button says and does. Offering "Resume upload"
                        // here invited the user to re-send 24 GB that the
                        // server had already looked at and rejected.
                        restoreArchiveRejected ? (
                        <Button
                          variant="primary"
                          className="w-full"
                          disabled={restoreInputsLocked}
                          onClick={uploadAnotherAfterRejection}
                        >
                          <Upload /> Upload another file
                        </Button>
                        ) : (
                        // Paused mid-upload, Cancel has to sit next to Resume:
                        // a paused upload holds the Confluence card locked, so
                        // without it here the only way out would be a reload.
                        <div className="flex gap-2">
                          <Button
                            variant="primary"
                            className="flex-1"
                            disabled={
                              (!file && !restoreUploadNeedsFile) ||
                              restoreInputsLocked
                            }
                            onClick={() => {
                              // Without the original file there is nothing to
                              // send yet, so the button's whole job is to open
                              // the picker - same two-step the Confluence card
                              // uses when its stored upload lost its File.
                              if (restoreUploadNeedsFile) {
                                fileInput.current?.click();
                                return;
                              }
                              if (file) void uploadAndScanBackupArchive(file);
                            }}
                          >
                            {restoreUploadResumable ? <Play /> : <Upload />}
                            {restoreUploadNeedsFile
                              ? "Select file to resume"
                              : restoreUploadResumable
                                ? "Resume upload"
                                : "Upload and scan"}
                          </Button>
                          {/* Cancel belongs beside Resume for as long as
                              parts are staged - including after the file has
                              been handed back, which is when it used to
                              vanish. A staged upload holds the Confluence
                              card locked, so with no Cancel here the only way
                              out was a reload. */}
                          {restoreUploadResumable ? (
                            <Button
                              variant="danger"
                              className="flex-1"
                              disabled={restoreInputsLocked}
                              onClick={() => {
                                // Something is in flight in this tab: stop it
                                // first, behind the confirm that guards
                                // throwing away real progress. Otherwise the
                                // only thing to discard is what the server is
                                // holding.
                                if (restoreUploadProgress != null) {
                                  setConfirmCancelBackupUpload(true);
                                  return;
                                }
                                void discardPendingRestoreUpload();
                              }}
                            >
                              Cancel upload
                            </Button>
                          ) : null}
                        </div>
                        )
                      )
                    ) : (
                      <Button
                        variant="primary"
                        className="w-full"
                        disabled={
                          (!file && !backupArchive) ||
                          pending !== null ||
                          restoreInputsLocked ||
                          // A scanned archive hands the decision to the
                          // "ready to restore" bar below, so this button must
                          // not stay live beside it: `submitImport()` with no
                          // space selection queues every space in the archive
                          // - the unscoped restore that bar exists to make
                          // the operator choose against, one stray click
                          // away. "Cancel restore" clears the archive and
                          // this comes back for the next file.
                          restoreDecisionOwnedByReadyBar
                        }
                        aria-busy={pending === "apply"}
                        onClick={() => void submitImport()}
                      >
                        {pending === "apply" ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <Upload />
                        )}
                        Restore backup
                      </Button>
                    )}
                  </div>
                );
              })()}
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

              <div className="mt-auto space-y-3 pt-4">
                <div>
                  <input
                    id="confluence-backup-file"
                    ref={confluenceFileInput}
                    type="file"
                    accept=".zip,application/zip,application/x-zip-compressed"
                    disabled={
                      confluencePending ||
                      Boolean(confluenceArchive) ||
                      importInProgress ||
                      confluenceLockedByRestore
                    }
                    onChange={(event) => {
                      const nextFile = event.target.files?.[0] ?? null;
                      if (
                        nextFile &&
                        siteSettings?.effective?.max_backup_import_size_bytes
                      ) {
                        if (
                          nextFile.size >
                          siteSettings.effective.max_backup_import_size_bytes
                        ) {
                          toast.error(
                            `Archive exceeds the configured ${siteSettings.effective.max_backup_import_size_mb} MB limit.`,
                          );
                          event.target.value = "";
                          setConfluenceFile(null);
                          return;
                        }
                      }
                      const matchesInterruptedUpload = fileMatchesStoredUpload(
                        nextFile,
                        storedConfluenceUpload,
                      );
                      if (
                        storedConfluenceUpload &&
                        nextFile &&
                        !matchesInterruptedUpload
                      ) {
                        // Keep the paused upload and its Cancel/Resume escape
                        // hatch intact. A different file must not replace or
                        // delete already-uploaded parts just because it was
                        // selected from the picker.
                        setConfluenceFile(null);
                        setConfluenceUploadError(null);
                        event.target.value = "";
                        toast.error(
                          `Select ${storedConfluenceUpload.fileName} to resume the paused upload.`,
                        );
                        return;
                      }
                      if (matchesInterruptedUpload && storedConfluenceUpload) {
                        const nextStored = {
                          ...storedConfluenceUpload,
                          file: nextFile ?? undefined,
                          fileLastModified:
                            nextFile?.lastModified ??
                            storedConfluenceUpload.fileLastModified,
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
                      setConfluenceUploadNotice(null);
                      setPreparationLogs([]);
                      setUploadProgress(null);
                      setUploadStats(null);
                      setHashStats(null);
                      setIsUploading(false);
                      if (nextFile) {
                        void rejectWrongArchiveFormat(
                          nextFile,
                          "confluence",
                          (message) => {
                            toast.error(message);
                            setConfluenceFile(null);
                            if (confluenceFileInput.current) {
                              confluenceFileInput.current.value = "";
                            }
                          },
                        );
                      }
                    }}
                    className={cn(
                      "border-border bg-surface file:bg-surface-sunken file:text-foreground hover:border-border-strong block w-full rounded-md border text-sm transition-colors duration-150 file:mr-3 file:border-0 file:px-3 file:py-2 file:text-sm",
                      confluencePending ||
                        confluenceArchive ||
                        importInProgress ||
                        confluenceLockedByRestore
                        ? "cursor-not-allowed opacity-50 file:cursor-not-allowed"
                        : "cursor-pointer file:cursor-pointer",
                    )}
                  />
                  {(storedUploadNeedsFile ||
                    confluenceArchive ||
                    confluenceLockedByRestore) && (
                    <p className="text-muted-foreground mt-1.5 text-xs">
                      {confluenceLockedByRestore
                        ? "A WikiHub restore is in progress. Finish or cancel it to import a Confluence archive instead — both write the same spaces, so only one can run."
                        : storedUploadNeedsFile
                          ? `Select ${storedConfluenceUpload?.fileName} again so WikiHub can read the remaining parts.`
                          : "Finish or clear this space selection before choosing another archive."}
                    </p>
                  )}
                </div>

                {confluenceUploadError ? (
                  <p
                    role="alert"
                    className="border-danger/30 bg-danger/10 text-danger rounded-md border px-3 py-2 text-sm"
                  >
                    {confluenceUploadError}
                  </p>
                ) : null}

                {confluenceUploadNotice ? (
                  <p
                    role="status"
                    className="border-success/30 bg-success-bg text-success rounded-md border px-3 py-2 text-sm"
                  >
                    {confluenceUploadNotice}
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {isUploading || isHashingArchive ? (
                    <>
                      {isUploading ? (
                        <Button
                          variant="secondary"
                          className="flex-1"
                          onClick={() => cancelConfluenceUpload("pause")}
                        >
                          <Pause /> Pause upload
                        </Button>
                      ) : null}
                      <Button
                        variant="danger"
                        className="flex-1"
                        disabled={cancelUploadPending}
                        onClick={() => setConfirmCancelUpload(true)}
                      >
                        Cancel upload
                      </Button>
                    </>
                  ) : !isFinalizingArchive ? (
                    <>
                      <Button
                        variant="primary"
                        className="flex-1"
                        disabled={
                          (!confluenceFile &&
                            !canResumeStoredUpload &&
                            !storedUploadNeedsFile) ||
                          confluencePending ||
                          Boolean(confluenceArchive) ||
                          importInProgress ||
                          confluenceLockedByRestore
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
                          className="flex-1"
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
            </div>
          </div>
        </div>

        {/* ── Full-width status panels below the grid ── */}

        {/* Confluence: fingerprint progress */}
        {isHashingArchive && hashStats ? (
          <ArchiveHashProgress
            filename={confluenceArchiveName}
            stats={hashStats}
          />
        ) : null}

        {/* Confluence: finalizing */}
        {isFinalizingArchive ? (
          <div
            className="border-info/25 bg-info-bg mt-4 flex gap-2.5 rounded-md border p-3 text-sm"
            role="status"
          >
            <Loader2 className="text-info mt-0.5 size-4 shrink-0 animate-spin" />
            <div>
              <p className="font-medium">Upload complete. Preparing your archive…</p>
              <p className="text-muted-foreground mt-1 text-xs">
                Verifying the upload and scanning spaces can take a few minutes
                for large archives. Keep this page open while WikiHub prepares
                the import list.
              </p>
            </div>
          </div>
        ) : null}

        {/* Confluence: upload progress */}
        {uploadProgress !== null &&
        !confluenceArchive &&
        !isFinalizingArchive &&
        !isHashingArchive ? (
          <ArchiveUploadProgress
            filename={confluenceArchiveName}
            percent={uploadProgress}
            stats={uploadStats}
            uploading={isUploading}
            totalFallback={confluenceArchiveSize}
          />
        ) : null}

        {/* Confluence: preparation logs */}
        {preparationLogs.length > 0 && !confluenceArchive ? (
          <details
            className="border-border bg-surface mt-4 rounded-md border"
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

        {/* Confluence: archive ready */}
        {confluenceArchive && !importInProgress ? (
          <div className="border-border bg-surface-sunken mt-4 flex items-center justify-between gap-3 rounded-md border p-4 text-sm">
            <div>
              <p className="font-semibold">Confluence archive ready for import</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {confluenceArchive.spaces.length} spaces found. Choose which
                spaces to import.
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

        {/* Confluence: job progress - same `renderJobActivityCard` the
            WikiHub export/restore cards use below, so the two import flows
            read identically instead of each keeping their own card. */}
        {confluenceJob
          ? renderJobActivityCard({
              title: jobTitle,
              badgeLabel: confluenceJob.status,
              badgeVariant:
                confluenceJob.status === "completed"
                  ? "success"
                  : confluenceJob.status === "failed"
                    ? "danger"
                    : "info",
              subtitle: (
                <>
                  {Math.round(jobProgressPercent)}% complete ·{" "}
                  {jobSpacesCompleted}/{jobSpacesTotal} spaces ·{" "}
                  {jobPagesSummary}
                  {jobAttachmentsTotal > 0
                    ? ` · ${jobAttachmentsProcessed}/${jobAttachmentsTotal} attachments`
                    : ""}
                </>
              ),
              extraLine:
                confluenceJob.phase === "downloading" ? (
                  <>
                    Downloading archive:{" "}
                    {formatBytes(confluenceJob.counters.downloaded_bytes ?? 0)}{" "}
                    /{" "}
                    {formatBytes(
                      confluenceJob.counters.download_total_bytes ?? 0,
                    )}{" "}
                    ({displayedDownloadPercent}%)
                  </>
                ) : null,
              percent: jobProgressPercent,
              cancel: !["completed", "failed", "cancelled"].includes(
                confluenceJob.status,
              )
                ? {
                    label: confluenceCancelPending ? "Cancelling..." : "Cancel",
                    disabled: confluenceCancelPending,
                    onClick: async () => {
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
                        // setError would land in the Restore WikiHub Backup
                        // card's own error slot, nowhere near this button - a
                        // failure here needs to surface right where it happened.
                        toast.error(
                          cancelError instanceof ApiError
                            ? cancelError.message
                            : "Could not cancel the import.",
                        );
                      } finally {
                        setConfluenceCancelPending(false);
                      }
                    },
                  }
                : null,
              logs: confluenceActivityLogs,
              logsTitle: "Import activity",
              logsExpanded: confluenceLogsExpanded,
              onLogsExpandedChange: setConfluenceLogsExpanded,
              logsListRef,
            })
          : null}

        {/* WikiHub restore, .zip: "Upload and scan" fingerprint progress. */}
        {activeSection === "import" &&
        isHashingBackupArchive &&
        backupHashStats ? (
          <ArchiveHashProgress
            filename={file?.name ?? null}
            stats={backupHashStats}
          />
        ) : null}

        {/* WikiHub restore, .zip: chunked-archive-upload progress, before a
            `full_import` job even exists to poll. Same panel the Confluence
            upload uses, so the two flows read identically. */}
        {activeSection === "import" &&
        !restoreArchiveRejected &&
        (restoreUploadProgress != null || restoreUploadNeedsFile) ? (
          <ArchiveUploadProgress
            filename={file?.name ?? pendingRestoreUpload?.filename ?? null}
            percent={restoreUploadProgress ?? pendingRestorePercent}
            // A rediscovered upload has no live stats - only what the server
            // says is already stored - so synthesise the one row the paused
            // panel actually shows ("Uploaded: x / y"); speed and estimate
            // are hidden while paused anyway.
            stats={
              restoreUploadStats ??
              (pendingRestoreUpload
                ? {
                    loaded: pendingRestoreUploadedBytes,
                    total: pendingRestoreUpload.size_bytes,
                    bytesPerSecond: 0,
                    secondsRemaining: null,
                  }
                : null)
            }
            uploading={isUploadingBackupArchive}
            totalFallback={file?.size ?? 0}
            note={
              restoreResumedBytes > 0
                ? `Resumed an earlier upload of this file — ${formatBytes(restoreResumedBytes)} was already in storage and is not being sent again.`
                : restoreUploadNeedsFile
                  ? "Nothing already uploaded was lost. Select the same file again to carry on from here."
                  : !isUploadingBackupArchive
                    ? "Nothing already uploaded was lost. Press Resume upload to carry on from here."
                    : undefined
            }
          />
        ) : null}

        {/* WikiHub restore, .zip: scanning the just-uploaded archive for its
            space list - same shape as Confluence's "Preparing your
            archive…" card. */}
        {activeSection === "import" && isScanningBackupArchive ? (
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

        {/* WikiHub restore, .zip: archive ready. The counterpart of the
            Confluence "archive ready for import" bar, and for the same reason:
            once the scan is in, the decision left is which spaces - which is a
            decision worth its own row rather than a control tucked inside the
            card. */}
        {activeSection === "import" &&
        backupArchive &&
        !isRestoreJobRunning &&
        pending !== "apply" ? (
          <div className="border-border bg-surface-sunken mt-4 flex items-center justify-between gap-3 rounded-md border p-4 text-sm">
            <div>
              <p className="font-semibold">WikiHub backup ready to restore</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {backupArchive.spaces.length} spaces found. Choose which spaces
                to restore.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="danger"
                size="sm"
                disabled={restoreInputsLocked}
                onClick={() => setConfirmDiscardBackupArchive(true)}
              >
                Cancel restore
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={restoreInputsLocked}
                onClick={() => setIsImportSpacePickerOpen(true)}
              >
                Select spaces &amp; restore
              </Button>
            </div>
          </div>
        ) : null}

        {/* WikiHub restore, .json: small enough to stay a single blocking
            request - no per-byte progress to show, just an indeterminate
            sweep, same as before. */}
        {pending === "apply" &&
        activeSection === "import" &&
        !file?.name.toLocaleLowerCase().endsWith(".zip") ? (
          <div className="border-border bg-surface-raised mt-4 rounded-lg border p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-base font-semibold">Restoring WikiHub backup…</p>
              <Badge variant="info">running</Badge>
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              Uploading and applying {file?.name ?? "the archive"}. Keep this
              tab open.
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

        {/* WikiHub restore, .zip: the durable `full_import` job's own
            progress - percent/ETA/cancel, same shared card the export jobs
            and the Confluence import use (`renderPortableJobCard`). Its log
            is embedded inside it (queued/running/failed/cancelled alike),
            same as Confluence's card - only "complete" hides the card
            entirely (see the early return inside it). */}
        {activeSection === "import" ? renderPortableJobCard("restore") : null}

        {/* Whenever the card above is not showing (no job yet - only this
            browser's own upload/scan narration exists - or the restore just
            completed and the card hid itself for the completion dialog
            instead), the log needs its own box; the rest of the time it
            already lives inside that card, and repeating it here would be a
            second, redundant copy of the same list. */}
        {activeSection === "import" && !restoreJobCardVisible
          ? renderRestoreLogPanel()
          : null}

        {/* WikiHub restore: report */}
        {report && activeSection === "import" ? (
          <div className="border-border bg-surface-raised mt-4 rounded-lg border p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold">
                {report.dry_run ? "Preview" : "Import result"}
              </h3>
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
              // Same box chrome as the Confluence "Import activity" log
              // below (bordered panel, padded summary header, divided
              // scrollable list) - these previously looked like two
              // unrelated widgets on the same page.
              <details
                className="border-border bg-surface mt-4 rounded-md border"
                open
              >
                <summary className="hover:bg-surface-hover cursor-pointer px-3 py-2 text-sm font-medium transition-colors duration-150">
                  Per-item detail ({report.entries.length}
                  {report.entries_truncated ? ", truncated" : ""})
                </summary>
                <ul className="border-border max-h-44 divide-y overflow-y-auto border-t text-xs">
                  {report.entries.map((entry, index) => (
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

      <Dialog open={isExportOptionsOpen} onOpenChange={setIsExportOptionsOpen}>
        <DialogContent
          title="Export WikiHub Backup"
          description="A complete .zip of spaces, pages, revisions and attachments — used to restore WikiHub itself."
          className="max-w-lg"
        >
          <div className="space-y-3">
            {/* Scope — every space by default, or a hand-picked subset */}
            <div className="border-border bg-surface-sunken rounded-lg border p-3 text-xs">
              <div className="flex min-h-8 flex-wrap items-center gap-2">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="export-space-scope"
                    checked={exportSpaceScope === "all"}
                    onChange={() => setExportSpaceScope("all")}
                    className="accent-primary size-3.5 cursor-pointer"
                  />
                  <span className="font-medium text-foreground">
                    All spaces
                  </span>
                </label>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="export-space-scope"
                    checked={exportSpaceScope === "selected"}
                    onChange={() => setExportSpaceScope("selected")}
                    className="accent-primary size-3.5 cursor-pointer"
                  />
                  <span className="font-medium text-foreground">
                    Select spaces…
                  </span>
                </label>
                {exportSpaceScope === "selected" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="ml-auto h-7 text-xs"
                    onClick={() => setIsExportSpacePickerOpen(true)}
                  >
                    <ListChecks className="size-3.5" />
                    {exportSelectedSpaceKeys.length > 0
                      ? `${exportSelectedSpaceKeys.length} selected`
                      : "Choose spaces"}
                  </Button>
                ) : null}
              </div>
              <p className="text-muted-foreground mt-1.5 min-h-9 leading-normal">
                {exportSpaceScope === "all"
                  ? "Every space, page, user, group and permission in this workspace."
                  : "Only the selected spaces' pages and permissions. Users and groups are always included in full."}
              </p>
            </div>

            {/* Password hashes option — only relevant to WikiHub restore */}
            <label className="border-border bg-surface-sunken flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-xs transition-colors duration-150 hover:bg-surface-hover">
              <input
                type="checkbox"
                checked={includeCredentials}
                onChange={(e) => setIncludeCredentials(e.target.checked)}
                className="accent-primary mt-0.5 size-3.5 shrink-0 cursor-pointer rounded"
              />
              <span>
                <span className="font-medium text-foreground">
                  Include password hashes
                </span>
                <span className="text-muted-foreground mt-0.5 block leading-normal">
                  Off by default. Enables offline cracking of weak passwords
                  — only enable for a migration and store the file securely.
                  Without it, restored accounts need a password set before
                  signing in.
                </span>
              </span>
            </label>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setIsExportOptionsOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={
                isDownloading ||
                isPortableJobRunning ||
                (exportSpaceScope === "selected" &&
                  exportSelectedSpaceKeys.length === 0)
              }
              aria-busy={isDownloading}
              onClick={() => void createPortableExport("full_export")}
            >
              {isDownloading ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Download />
              )}
              {isDownloading ? "Queueing export…" : "Create backup ZIP"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isExportSpacePickerOpen}
        onOpenChange={setIsExportSpacePickerOpen}
      >
        <DialogContent title="Select Spaces to Export" className="max-w-2xl">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {exportSelectedSpaceKeys.length}/{(availableSpaces ?? []).length}{" "}
                Space(s) selected
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-52 flex-1">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                <Input
                  type="search"
                  value={exportSpaceFilter}
                  onChange={(event) => setExportSpaceFilter(event.target.value)}
                  placeholder="Filter by space name or key"
                  aria-label="Filter spaces to export"
                  className="pl-9"
                />
              </div>
              <span className="text-muted-foreground text-xs" aria-live="polite">
                {filteredAvailableSpaces.length} of {(availableSpaces ?? []).length}{" "}
                shown
              </span>
            </div>
            <div className="border-border max-h-64 overflow-y-auto rounded-md border">
              {isLoadingAvailableSpaces ? (
                <div className="text-muted-foreground flex items-center justify-center gap-2 px-3 py-8 text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  Loading spaces…
                </div>
              ) : filteredAvailableSpaces.length ? (
                filteredAvailableSpaces.map((space) => (
                  <label
                    key={space.key}
                    className="border-border hover:bg-surface-sunken flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-0"
                  >
                    <input
                      type="checkbox"
                      checked={exportSelectedSpaceKeys.includes(space.key)}
                      onChange={(event) => {
                        setExportSelectedSpaceKeys(
                          event.target.checked
                            ? [...exportSelectedSpaceKeys, space.key]
                            : exportSelectedSpaceKeys.filter(
                                (key) => key !== space.key,
                              ),
                        );
                      }}
                      className="accent-primary size-4"
                    />
                    <span className="font-medium">{space.name}</span>
                    <span className="text-muted-foreground">
                      {space.key} · {space.status}
                    </span>
                  </label>
                ))
              ) : (
                <p className="text-muted-foreground px-3 py-6 text-center text-sm">
                  No spaces match “{exportSpaceFilter}”.
                </p>
              )}
            </div>
            <DialogFooter className="justify-between sm:justify-between">
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setExportSelectedSpaceKeys(
                      Array.from(
                        new Set([
                          ...exportSelectedSpaceKeys,
                          ...filteredAvailableSpaces.map((space) => space.key),
                        ]),
                      ),
                    );
                  }}
                >
                  {normalizedExportSpaceFilter ? "Select visible" : "Select all"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setExportSelectedSpaceKeys([])}
                >
                  Clear selection
                </Button>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setIsExportSpacePickerOpen(false)}
              >
                Done
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isImportSpacePickerOpen}
        onOpenChange={setIsImportSpacePickerOpen}
      >
        <DialogContent title="Select Spaces to Restore" className="max-w-2xl">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {importSelectedSpaceKeys.length}/
                {(backupArchive?.spaces ?? []).length} Space(s) selected
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-52 flex-1">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                <Input
                  type="search"
                  value={importSpaceFilter}
                  onChange={(event) => setImportSpaceFilter(event.target.value)}
                  placeholder="Filter by space name or key"
                  aria-label="Filter spaces to restore"
                  className="pl-9"
                />
              </div>
              <span className="text-muted-foreground text-xs" aria-live="polite">
                {filteredArchiveSpaces.length} of{" "}
                {(backupArchive?.spaces ?? []).length} shown
              </span>
            </div>
            <div className="border-border max-h-64 overflow-y-auto rounded-md border">
              {filteredArchiveSpaces.length ? (
                filteredArchiveSpaces.map((space) => (
                  <label
                    key={space.key}
                    className="border-border hover:bg-surface-sunken flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-0"
                  >
                    <input
                      type="checkbox"
                      checked={importSelectedSpaceKeys.includes(space.key)}
                      onChange={(event) => {
                        setImportSelectedSpaceKeys(
                          event.target.checked
                            ? [...importSelectedSpaceKeys, space.key]
                            : importSelectedSpaceKeys.filter(
                                (key) => key !== space.key,
                              ),
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
                  {backupArchive?.spaces.length
                    ? `No spaces match "${importSpaceFilter}".`
                    : "This archive has no spaces."}
                </p>
              )}
            </div>
            <DialogFooter className="justify-between sm:justify-between">
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setImportSelectedSpaceKeys(
                      Array.from(
                        new Set([
                          ...importSelectedSpaceKeys,
                          ...filteredArchiveSpaces.map((space) => space.key),
                        ]),
                      ),
                    );
                  }}
                >
                  {normalizedImportSpaceFilter ? "Select visible" : "Select all"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setImportSelectedSpaceKeys([])}
                >
                  Clear selection
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsImportSpacePickerOpen(false)}
                >
                  Close
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={
                    restoreInputsLocked ||
                    pending !== null ||
                    importSelectedSpaceKeys.length === 0
                  }
                  aria-busy={pending === "apply"}
                  onClick={requestImportRestore}
                >
                  {pending === "apply" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Upload />
                  )}
                  Start restore
                </Button>
              </div>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isSpaceModalOpen} onOpenChange={setIsSpaceModalOpen}>
        <DialogContent title="Select Spaces to Import" className="max-w-2xl">
          {confluenceArchive ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {selectedSpaces.length}/{confluenceArchive.spaces.length}{" "}
                  Space(s) selected
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
                          const availableCount =
                            confluenceArchive.spaces.length;
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
                      setImportAllSpaces(
                        nextSelected.length === availableCount,
                      );
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
                      <Loader2 className="size-4 animate-spin" />
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

      <ImportCompletedDialog
        open={isImportSuccessModalOpen}
        onOpenChange={setIsImportSuccessModalOpen}
        title="Import Completed Successfully"
        description="All selected spaces from your Confluence backup have been successfully imported."
        summaryLabel="What was imported"
        counts={importSuccessCounts}
        emptyLabel="Nothing new - every record in the archive already existed."
        question="Do you want to import another Confluence archive, or close and continue?"
        confirmLabel="Yes, import another"
        onConfirm={() => {
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
        }}
      />

      {/* Neither way out is free - one asks for a file back, the other
          throws away parts already uploaded - so the two files are set side
          by side with what each is worth, and neither button is dressed as
          "the safe one".

          The names carry the whole difference here (they differ by a date
          deep inside a 39-character string), so they get their own lines in
          a comparison block instead of being buried mid-sentence and
          repeated again inside the buttons - which is what made the buttons
          wrap into a stacked, unreadable pair. */}
      <Dialog
        open={mismatchedResumeFile !== null}
        onOpenChange={(open) => {
          if (!open) setMismatchedResumeFile(null);
        }}
      >
        <DialogContent
          title="That is a different file"
          description="The parts already uploaded only fit the file they came from, so resuming needs that one back."
        >
          <div className="border-border bg-surface-sunken divide-border divide-y rounded-md border">
            <div className="flex gap-2.5 p-3">
              <ArrowUpFromLine className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                  Being uploaded
                </p>
                <p className="text-foreground mt-0.5 text-xs break-all">
                  {pendingRestoreUpload?.filename}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {formatBytes(pendingRestoreUploadedBytes)} of{" "}
                  {formatBytes(pendingRestoreUpload?.size_bytes ?? 0)} already
                  in storage
                </p>
              </div>
            </div>
            <div className="flex gap-2.5 p-3">
              <FileArchive className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                  You chose
                </p>
                <p className="text-foreground mt-0.5 text-xs break-all">
                  {mismatchedResumeFile?.name}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {formatBytes(mismatchedResumeFile?.size ?? 0)} · nothing
                  uploaded yet
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="danger"
              onClick={() => void uploadMismatchedFileInstead()}
            >
              Discard and upload this
            </Button>
            <Button variant="primary" onClick={reselectFileForResume}>
              Choose the original
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImportCompletedDialog
        open={isRestoreSuccessModalOpen}
        onOpenChange={setIsRestoreSuccessModalOpen}
        title="Restore Completed Successfully"
        description="The WikiHub backup has been restored into this instance."
        summaryLabel="What was restored"
        counts={restoreSuccessReport?.created ?? null}
        emptyLabel="Nothing new - every record in the backup already existed."
        notice={
          conflictingImportSpaceKeys.length > 0 ? (
            <div className="border-warning/30 bg-warning-bg rounded-md border p-3 text-xs">
              <div className="flex gap-2.5">
                <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" />
                <div className="min-w-0">
                  <p className="text-foreground font-medium">
                    {conflictingImportSpaceKeys.length}{" "}
                    {conflictingImportSpaceKeys.length === 1
                      ? "space already existed and was"
                      : "spaces already existed and were"}{" "}
                    left untouched
                  </p>
                  {/* The full list ran to 42 keys in one unbroken paragraph.
                      Enough to recognise which spaces are meant, with the
                      count carrying the rest. */}
                  <p className="text-muted-foreground mt-1 break-words">
                    {conflictingImportSpaceKeys.slice(0, 8).join(", ")}
                    {conflictingImportSpaceKeys.length > 8
                      ? ` and ${conflictingImportSpaceKeys.length - 8} more`
                      : ""}
                  </p>
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="mt-2.5"
                onClick={() => {
                  setIsRestoreSuccessModalOpen(false);
                  setConfirmOverwriteImportSpaces(true);
                }}
              >
                Replace them with the archive&apos;s version
              </Button>
            </div>
          ) : null
        }
        question={
          backupArchive
            ? "Do you want to restore more spaces from this backup, or close and continue?"
            : "Do you want to restore another backup, or close and continue?"
        }
        confirmLabel={
          backupArchive ? "Yes, choose more spaces" : "Yes, restore another"
        }
        onConfirm={() => void restoreMoreFromSameArchive()}
      />

      <ConfirmDialog
        open={leaveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setLeaveTarget(null);
        }}
        title="Pause this upload and leave?"
        description={
          // The Confluence card stashes the File itself, so it can offer to
          // pick straight up again. The restore card cannot - the browser
          // only hands a File over on a user gesture - so it promises the
          // uploaded parts and asks for the file back, which is exactly what
          // it does on return.
          confluencePending
            ? "The current part will stop. Completed parts and your selected archive stay on this device, so you can resume the upload from this page later."
            : "The current part will stop. Everything uploaded so far stays in storage, so you can select the same file on this page later and carry on from where it stopped."
        }
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
        open={confirmOverwriteImportSpaces}
        onOpenChange={setConfirmOverwriteImportSpaces}
        title="Replace existing spaces?"
        description={`This will permanently replace ${conflictingImportSpaceKeys.length} existing ${conflictingImportSpaceKeys.length === 1 ? "space" : "spaces"}: ${overwriteImportSpaceKeysSummary}. Their current pages and attachments will be deleted before the archive version is restored. Space membership and permissions are kept either way.`}
        confirmLabel="Replace and restore"
        destructive
        pending={pending === "apply"}
        onConfirm={() => {
          // A no-op when this was reached from the post-restore notice - the
          // picker is already closed by then. Reached from the pre-flight
          // gate (`requestImportRestore`), the picker is still open behind
          // this dialog and has to be dismissed before the job card takes
          // its place.
          setIsImportSpacePickerOpen(false);
          void submitImport(conflictingImportSpaceKeys);
        }}
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
      <ConfirmDialog
        open={confirmDiscardBackupArchive}
        onOpenChange={setConfirmDiscardBackupArchive}
        title="Cancel this restore?"
        description="This clears the space selection and stops offering the backup for restore. The uploaded file itself stays in object storage, so choosing it again picks up without re-uploading - delete it under Administration > Object storage once you no longer need it."
        confirmLabel="Cancel restore"
        destructive
        onConfirm={discardBackupArchive}
      />
      <ConfirmDialog
        open={confirmCancelBackupUpload}
        onOpenChange={setConfirmCancelBackupUpload}
        title="Cancel this upload?"
        description="This discards the uploaded parts and the selected file. You will need to select the file and start again."
        confirmLabel="Cancel upload"
        destructive
        pending={cancelBackupUploadPending}
        onConfirm={() => void cancelBackupArchiveUpload()}
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
      <ConfirmDialog
        open={deleteAutomatedJobId !== null}
        onOpenChange={(open) => { if (!open) setDeleteAutomatedJobId(null); }}
        title="Delete automatic backup?"
        description="This permanently removes the backup ZIP from the configured server partition."
        confirmLabel="Delete backup"
        destructive
        pending={automatedPending}
        onConfirm={() => void deleteAutomatedBackup()}
      />
      </div>
    </div>
  );
}
