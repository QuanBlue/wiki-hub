import type { ConfluenceUploadProgress } from "@/types/api";
import {
  CONFLUENCE_CANCELLED_UPLOADS_KEY,
  CONFLUENCE_UPLOAD_METADATA_KEY,
  type StoredConfluenceUpload,
  type StoredConfluenceUploadRecord,
} from "./types";

export function normalizeStoredUpload(
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

export function readStoredUploadMetadata(): StoredConfluenceUpload | null {
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

export function saveStoredUploadMetadata(upload: StoredConfluenceUpload): void {
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

export function clearStoredUploadMetadata(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CONFLUENCE_UPLOAD_METADATA_KEY);
  } catch {
    // Ignore storage failures; clearing in-memory state still keeps the UI safe.
  }
}

export function readCancelledUploadIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(CONFLUENCE_CANCELLED_UPLOADS_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(ids) ? ids.filter(Boolean).map(String) : []);
  } catch {
    return new Set();
  }
}

export function rememberCancelledUpload(archiveId: string | null | undefined): void {
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

export function forgetCancelledUpload(archiveId: string | null | undefined): void {
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

export function fileMatchesStoredUpload(
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

export function serverUploadToStoredUpload(
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

export async function readStoredUpload(): Promise<StoredConfluenceUpload | null> {
  return readStoredUploadMetadata();
}

export async function saveStoredUpload(upload: StoredConfluenceUpload): Promise<void> {
  saveStoredUploadMetadata(upload);
  // Never persist the File object itself. Large Confluence archives can be tens
  // of GB; cloning that blob into IndexedDB can freeze the tab before upload
  // starts. The browser only keeps file read permission for the current page
  // lifetime, so after navigation the user must reselect the same archive.
}

export async function clearStoredUpload(): Promise<void> {
  clearStoredUploadMetadata();
  // Current resumability uses lightweight metadata plus the server-side active
  // upload record. Legacy IndexedDB file caches are intentionally ignored.
}
