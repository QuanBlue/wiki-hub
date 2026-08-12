"use client";

import {
  AlertTriangle,
  Download,
  FileArchive,
  Info,
  Loader2,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { ApiError, apiFetch } from "@/lib/api-client";
import { PUBLIC_API_BASE_URL } from "@/lib/env";
import type { ConfluenceArchive, ConfluenceImportJob, ConfluenceImportLog, ConfluenceUploadTarget, ImportReport } from "@/types/api";

type UploadStats = {
  loaded: number;
  total: number;
  bytesPerSecond: number;
  secondsRemaining: number | null;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1);
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

  const [includeCredentials, setIncludeCredentials] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [confluenceFile, setConfluenceFile] = useState<File | null>(null);
  const [confluenceArchive, setConfluenceArchive] = useState<ConfluenceArchive | null>(null);
  const [confluenceJob, setConfluenceJob] = useState<ConfluenceImportJob | null>(null);
  const [confluenceLogs, setConfluenceLogs] = useState<ConfluenceImportLog[]>([]);
  const [selectedSpaces, setSelectedSpaces] = useState<string[]>([]);
  const [importAllSpaces, setImportAllSpaces] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadStats, setUploadStats] = useState<UploadStats | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [confluencePending, setConfluencePending] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [pending, setPending] = useState<"preview" | "apply" | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A real link, not a fetch: the browser handles the Content-Disposition
  // attachment itself, the session cookie rides along, and right-click
  // "save as" works. Fetching the JSON into memory only to re-wrap it in a
  // blob URL would buy nothing.
  const exportHref = `${PUBLIC_API_BASE_URL}/api/v1/backup/export${
    includeCredentials ? "?include_credentials=true" : ""
  }`;

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
    if (!confluenceJob || ["completed", "failed", "cancelled"].includes(confluenceJob.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const [job, logs] = await Promise.all([
          apiFetch<ConfluenceImportJob>(`/api/v1/confluence-imports/jobs/${confluenceJob.id}`),
          apiFetch<{ items: ConfluenceImportLog[] }>(`/api/v1/confluence-imports/jobs/${confluenceJob.id}/logs`),
        ]);
        setConfluenceJob(job); setConfluenceLogs(logs.items);
      } catch { /* next poll reports a recoverable API failure */ }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [confluenceJob]);

  async function uploadConfluence() {
    if (!confluenceFile) return;
    setConfluencePending(true); setError(null); setUploadProgress(0);
    setUploadStats({ loaded: 0, total: confluenceFile.size, bytesPerSecond: 0, secondsRemaining: null });
    try {
      const target = await apiFetch<ConfluenceUploadTarget>("/api/v1/confluence-imports/uploads", { method: "POST", body: { filename: confluenceFile.name, size_bytes: confluenceFile.size } });
      setIsUploading(true);
      await new Promise<void>((resolve, reject) => {
        const request = new XMLHttpRequest();
        confluenceUploadRequest.current = request;
        const startedAt = performance.now();
        request.open("PUT", target.upload_url);
        request.setRequestHeader("Content-Type", "application/zip");
        request.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.001);
          const bytesPerSecond = event.loaded / elapsedSeconds;
          setUploadProgress(Math.round((event.loaded / event.total) * 100));
          setUploadStats({
            loaded: event.loaded,
            total: event.total,
            bytesPerSecond,
            secondsRemaining: bytesPerSecond > 0 ? (event.total - event.loaded) / bytesPerSecond : null,
          });
        };
        request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error("MinIO rejected the archive upload."));
        request.onabort = () => reject(new DOMException("Upload cancelled.", "AbortError"));
        request.onerror = () => reject(new Error("Could not upload the archive to object storage."));
        request.send(confluenceFile);
      });
      setIsUploading(false);
      const archive = await apiFetch<ConfluenceArchive>(`/api/v1/confluence-imports/archives/${target.archive_id}/scan`, { method: "POST" });
      setConfluenceArchive(archive); setSelectedSpaces(archive.spaces.filter((space) => !space.conflict).map((space) => space.key));
      toast.success("Archive scanned. Choose the Spaces to import.");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        toast.info("Confluence archive upload cancelled.");
      } else {
        setError(err instanceof ApiError ? err.message : "Could not upload or scan the Confluence archive.");
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

  async function startConfluenceImport() {
    if (!confluenceArchive) return;
    setConfluencePending(true);
    try {
      const job = await apiFetch<ConfluenceImportJob>(`/api/v1/confluence-imports/archives/${confluenceArchive.id}/jobs`, { method: "POST", body: { import_all: importAllSpaces, space_keys: selectedSpaces } });
      setConfluenceJob(job); setConfluenceLogs([]); toast.success("Confluence import queued.");
    } catch (err) { setError(err instanceof ApiError ? err.message : "Could not queue the import."); }
    finally { setConfluencePending(false); }
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
            {isDownloading ? <Loader2 className="animate-spin" /> : <Download />}
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
          <Badge variant="success">available</Badge>
        </div>

        <div className="border-border bg-surface-sunken mt-4 rounded-md border border-dashed p-4">
          <Label>Confluence export archive</Label>
          <input
            id="confluence-backup-file"
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            onChange={(event) => {
              setConfluenceFile(event.target.files?.[0] ?? null);
              setConfluenceArchive(null);
              setConfluenceJob(null);
              setUploadProgress(null);
              setUploadStats(null);
              setIsUploading(false);
            }}
            className="sr-only"
          />
          <label
            className="border-border bg-surface hover:border-border-strong focus-within:ring-ring mt-2 flex h-10 w-full max-w-md cursor-pointer items-center rounded-md border text-sm transition-[color,background-color,border-color,box-shadow] duration-150 focus-within:ring-2 focus-within:ring-offset-2"
            htmlFor="confluence-backup-file"
          >
            <span className="border-border bg-surface-sunken shrink-0 border-r px-3 py-2 font-medium">
              Choose file
            </span>
            <span className="text-muted-foreground min-w-0 flex-1 truncate px-3" title={confluenceFile?.name}>
              {confluenceFile?.name ?? "No file selected"}
            </span>
          </label>
          <p className="text-muted-foreground mt-2 text-xs">Accepted format: <code className="font-mono">.zip</code> archive exported by Confluence. It uploads directly to protected object storage.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" disabled={!confluenceFile || confluencePending || Boolean(confluenceArchive)} onClick={uploadConfluence}>
              {confluencePending && !confluenceArchive ? <Loader2 className="animate-spin" /> : <Upload />} Upload and scan
            </Button>
            {isUploading ? <Button variant="danger" onClick={cancelConfluenceUpload}>Cancel upload</Button> : null}
          </div>
        </div>

        {uploadProgress !== null && !confluenceArchive ? (
          <div
            className="border-info/25 bg-info-bg mt-3 rounded-md border p-3 text-sm"
            role="status"
          >
            <div className="flex gap-2.5">
              <Info className="text-info mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p>
                  Uploading <span className="font-medium">{confluenceFile?.name}</span>: {uploadProgress}%
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
                    className="bg-info motion-safe:transition-[width] h-full duration-150"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <div className="text-muted-foreground mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs">
                  <span>{formatBytes(uploadStats?.loaded ?? 0)} / {formatBytes(uploadStats?.total ?? confluenceFile?.size ?? 0)}</span>
                  <span>{uploadStats && uploadStats.bytesPerSecond > 0 ? `${formatBytes(uploadStats.bytesPerSecond)}/s` : "Calculating speed…"}</span>
                  <span>{formatDuration(uploadStats?.secondsRemaining ?? null)}</span>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {confluenceArchive ? <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{confluenceArchive.spaces.length} Space(s) found</p><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={importAllSpaces} onChange={(event) => setImportAllSpaces(event.target.checked)} className="accent-primary size-4" /> Import all spaces</label></div>
          <div className="border-border max-h-64 overflow-y-auto rounded-md border">
            {confluenceArchive.spaces.map((space) => <label key={space.key} className="border-border hover:bg-surface-sunken flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-0">
              <input type="checkbox" disabled={importAllSpaces || space.conflict} checked={selectedSpaces.includes(space.key)} onChange={(event) => setSelectedSpaces((current) => event.target.checked ? [...current, space.key] : current.filter((key) => key !== space.key))} className="accent-primary size-4" />
              <span className="font-medium">{space.name}</span><span className="text-muted-foreground">{space.key} · {space.page_count} pages</span>{space.conflict ? <Badge variant="warning">existing key: skipped</Badge> : null}
            </label>)}
          </div>
          <div className="flex flex-wrap gap-2"><Button variant="primary" disabled={confluencePending || (!importAllSpaces && selectedSpaces.length === 0)} onClick={startConfluenceImport}>{confluencePending ? <Loader2 className="animate-spin" /> : <Upload />} Start import</Button><Button variant="secondary" onClick={() => setSelectedSpaces(confluenceArchive.spaces.filter((space) => !space.conflict).map((space) => space.key))}>Select all</Button><Button variant="ghost" onClick={() => setSelectedSpaces([])}>Clear selection</Button></div>
        </div> : null}

        {confluenceJob ? <div className="border-border bg-surface-sunken mt-4 rounded-md border p-4 text-sm"><div className="flex items-center justify-between gap-3"><p className="font-medium">Import {confluenceJob.status} · {confluenceJob.phase}</p><Badge variant={confluenceJob.status === "completed" ? "success" : confluenceJob.status === "failed" ? "danger" : "info"}>{confluenceJob.status}</Badge></div><p className="text-muted-foreground mt-1">{confluenceJob.counters.spaces_completed ?? 0}/{confluenceJob.counters.spaces_total ?? 0} spaces · {confluenceJob.counters.pages_processed ?? 0} pages</p><div className="bg-muted mt-3 h-2 overflow-hidden rounded-full"><div className="bg-primary h-full transition-all" style={{ width: `${Math.min(100, ((confluenceJob.counters.spaces_completed ?? 0) / Math.max(1, confluenceJob.counters.spaces_total ?? 1)) * 100)}%` }} /></div>{!["completed", "failed", "cancelled"].includes(confluenceJob.status) ? <Button className="mt-3" variant="danger" size="sm" onClick={async () => setConfluenceJob(await apiFetch<ConfluenceImportJob>(`/api/v1/confluence-imports/jobs/${confluenceJob.id}/cancel`, { method: "POST" }))}>Cancel</Button> : null}{confluenceLogs.length ? <details className="mt-3"><summary className="cursor-pointer">Import logs ({confluenceLogs.length})</summary><ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs">{confluenceLogs.map((log) => <li key={log.id}><span className="font-medium">{log.level}</span> · {log.entity_label ? `${log.entity_label}: ` : ""}{log.message}</li>)}</ul></details> : null}</div> : null}
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
    </div>
  );
}
