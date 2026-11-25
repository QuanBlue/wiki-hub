import { ApiError } from "@/lib/api-client";
import type { TransferStats } from "@/components/ui/job-progress";
import type { ImportReport } from "@/types/api";

// Both were the same four fields; they are `TransferStats` now, defined
// beside the panels that render them.
export type UploadStats = TransferStats;
export type HashStats = TransferStats;

/** The Confluence Data Center export only partly works, so it is switched off for now
 * (the card reads "Incoming"). Flip this to bring it back. */
export const backupFeatures = { confluenceExport: false };

export type PortableBackupJob = {
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
  //: True for a scheduled/automated run - its progress belongs on the
  //: "Automatic backups" card's own history table, not the manual Export &
  //: Backup Workspace Data card above (see `restorePortableBackupJob`).
  automated: boolean;
  created_at: string;
  updated_at: string;
};

export type AutomatedBackupSettings = {
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
export type BackupArchiveUploadTarget = {
  archive_id: string;
  object_key: string;
  max_size_bytes: number;
  part_size_bytes: number;
  uploaded_parts: number[];
  status: string;
  sha256: string | null;
  reused: boolean;
};

export type StoredConfluenceUpload = {
  archiveId: string;
  file?: File;
  fileName: string;
  fileSize: number;
  fileLastModified: number | null;
  sha256: string | null;
  partSize: number;
};

export type StoredConfluenceUploadRecord = Partial<StoredConfluenceUpload> & {
  archiveId: string;
  partSize: number;
};

/** One line in the restore card's log, whatever wrote it.
 *
 * The browser's own account of the upload and the worker's account of the
 * restore are the same story to whoever is watching, so they are normalised
 * to one shape here and shown as one list. */
export type RestoreLogEntry = {
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
 * this is the one client-side shape `JobActivityCard`/
 * `renderJobLogRows` read, rather than each import type keeping its own. A
 * `RestoreLogEntry` already satisfies this structurally. */
export type JobLogEntry = {
  id: string;
  time: string;
  level: string;
  label?: string | null;
  message: string;
};

//: Rows-per-page choices for the automated-backup history table, styled to
//: match the "Rows per page" control on the admin People directory - the
//: first entry is the initial page size, matching the server's own default
//: `limit` for `GET /backup/automatic/jobs`.
export const AUTOMATED_JOBS_PAGE_SIZES = [10, 25, 50] as const;

//: The four states an automated-backup run's own status ever reports (never
//: "cancelled" - nothing here offers cancelling one mid-run).
export type AutomatedBackupStatus = "queued" | "running" | "complete" | "failed";

export type AutomatedJobsSortKey = "backup" | "status" | "completed_at" | "duration";
export type AutomatedJobsSort = {
  key: AutomatedJobsSortKey;
  direction: "asc" | "desc";
} | null;

export const CONFLUENCE_UPLOAD_METADATA_KEY = "wikihub-confluence-upload-current";
export const CONFLUENCE_CANCELLED_UPLOADS_KEY = "wikihub-confluence-cancelled-uploads";
export const SESSION_EXPIRED_UPLOAD_MESSAGE =
  "Your session expired while uploading. Sign in again, then return here and resume the upload; completed parts are still kept.";

/** The server's own message when there is one, otherwise `fallback`. */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}
