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
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { ApiError, apiFetch } from "@/lib/api-client";
import { PUBLIC_API_BASE_URL } from "@/lib/env";
import type { ImportReport } from "@/types/api";

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

  const [includeCredentials, setIncludeCredentials] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [confluenceFile, setConfluenceFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [pending, setPending] = useState<"preview" | "apply" | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A real link, not a fetch: the browser handles the Content-Disposition
  // attachment itself, the session cookie rides along, and right-click
  // "save as" works. Fetching the JSON into memory only to re-wrap it in a
  // blob URL would buy nothing.
  const exportHref = `${PUBLIC_API_BASE_URL}/api/v1/backup/export${
    includeCredentials ? "?include_credentials=true" : ""
  }`;

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
          <Button asChild variant="primary">
            <a href={exportHref} download>
              <Download />
              Download backup
            </a>
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
          <Badge variant="info">coming soon</Badge>
        </div>

        <div className="border-border bg-surface-sunken mt-4 rounded-md border border-dashed p-4">
          <Label htmlFor="confluence-backup-file">
            Confluence export archive
          </Label>
          <input
            id="confluence-backup-file"
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            onChange={(event) => {
              setConfluenceFile(event.target.files?.[0] ?? null);
            }}
            className="border-border bg-surface file:bg-surface-sunken file:text-foreground hover:border-border-strong mt-2 block w-full max-w-md cursor-pointer rounded-md border text-sm transition-colors duration-150 file:mr-3 file:cursor-pointer file:border-0 file:px-3 file:py-2 file:text-sm"
          />
          <p className="text-muted-foreground mt-2 text-xs">
            Accepted format: <code className="font-mono">.zip</code> archive
            exported by Confluence. The original file is not uploaded until the
            importer is available.
          </p>
        </div>

        {confluenceFile ? (
          <div className="border-info/25 bg-info-bg mt-3 flex gap-2.5 rounded-md border p-3 text-sm">
            <Info className="text-info mt-0.5 size-4 shrink-0" />
            <p>
              <span className="font-medium">{confluenceFile.name}</span> is
              ready to import. Confluence page, attachment, and user migration
              will be enabled with the content-importer release.
            </p>
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
    </div>
  );
}
