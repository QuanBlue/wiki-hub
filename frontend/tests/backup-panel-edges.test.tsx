import { createHash, webcrypto } from "node:crypto";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { BackupPanel } from "@/components/admin/backup-panel";

import {
  CONFLUENCE_ARCHIVE,
  RESTORE_ARCHIVE,
  baseRoutes,
  confluenceExportZip,
  confluenceUploadRoutes,
  mockFetch,
  restoreUploadRoutes,
  stubUploadXHR,
  wikihubBackupZip,
  type Route,
} from "./backup-panel-harness";

const refresh = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const METADATA_KEY = "wikihub-confluence-upload-current";

beforeEach(() => {
  window.localStorage.clear();
  refresh.mockReset();
  vi.stubGlobal("crypto", {
    subtle: { digest: (algorithm: string, data: BufferSource) => webcrypto.subtle.digest(algorithm, data) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(toast).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});

const card = () => within(screen.getByTestId("wikihub-restore-card"));
const restoreInput = () => document.getElementById("backup-file") as HTMLInputElement;
const confluenceInput = () => document.getElementById("confluence-backup-file") as HTMLInputElement;

async function openPanel(routes: Route[] = []) {
  const spy = mockFetch([...routes, ...baseRoutes()]);
  const user = userEvent.setup({ applyAccept: false });
  render(<BackupPanel />);
  return { user, spy };
}

const sha = async (file: File) => createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");

const portableJob = (overrides: Record<string, unknown> = {}) => ({
  id: "job-1",
  kind: "full_export",
  status: "running",
  phase: "exporting",
  counters: {},
  cancel_requested: false,
  output_filename: null,
  download_url: null,
  error: null,
  space_keys: [],
  archive_id: null,
  overwrite_space_keys: [],
  result: null,
  started_at: new Date().toISOString(),
  percent: null,
  eta_seconds: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

describe("listing spaces to export", () => {
  it("asks for the next page of spaces when a page comes back full", async () => {
    const full = Array.from({ length: 200 }, (_, i) => ({ id: `a${i}`, key: `A${i}`, name: `Alpha ${i}`, status: "active" }));
    let call = 0;
    const { user } = await openPanel([
      {
        method: "GET",
        match: (p) => p === "/api/v1/spaces",
        handler: () => ({
          body: call++ === 0 ? full : [{ id: "z", key: "ZED", name: "Zed space", status: "active" }],
        }),
      },
    ]);
    await user.click(screen.getByRole("button", { name: /export wikihub backup/i }));
    await user.click(screen.getByRole("radio", { name: /select spaces/i }));
    await user.click(screen.getByRole("button", { name: /choose spaces/i }));

    expect(await screen.findByText("Alpha 0")).toBeInTheDocument();
    expect(screen.getByText("Zed space")).toBeInTheDocument();
  });
});

describe("a job that stops being tracked", () => {
  it.each(["cancelled", "failed"])("drops the card of a %s job once the server has nothing running", async (status) => {
    let listed = 0;
    await openPanel([
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/jobs",
        handler: () => ({ body: listed++ === 0 ? [portableJob()] : [] }),
      },
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/jobs/job-1",
        handler: () => ({ body: portableJob({ status, error: "Nope." }) }),
      },
    ]);

    await screen.findByText(status === "failed" ? "Export failed" : "Export was cancelled", {}, { timeout: 5000 });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() =>
      expect(screen.queryByText(status === "failed" ? "Export failed" : "Export was cancelled")).toBeNull(),
    );
  });

  it("keeps showing the job when it cannot ask which jobs are running", async () => {
    await openPanel([
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/jobs",
        handler: () => ({ status: 500, body: { error: { code: "x", message: "down" } } }),
      },
    ]);

    expect(screen.getByRole("button", { name: /export wikihub backup/i })).toBeInTheDocument();
  });

  it("copes with not being able to ask about unfinished restore uploads", async () => {
    await openPanel([
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/archives/uploads/active",
        handler: () => ({ status: 500, body: { error: { code: "x", message: "down" } } }),
      },
    ]);

    expect(screen.getByRole("tab", { name: /import \/ restore/i })).toBeInTheDocument();
  });

  it("keeps polling an import when one poll fails", async () => {
    let polls = 0;
    await openPanel([
      {
        method: "GET",
        match: (p) => p === "/api/v1/confluence-imports/jobs",
        handler: () => ({
          body: [
            {
              id: "job-1",
              archive_id: "conf-1",
              import_all: true,
              space_keys: [],
              overwrite_existing: false,
              status: "running",
              phase: "importing",
              counters: {},
              cancel_requested: false,
              error: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        }),
      },
      {
        method: "GET",
        match: (p) => p === "/api/v1/confluence-imports/jobs/job-1",
        handler: () => {
          polls += 1;
          return { status: 500, body: { error: { code: "x", message: "blip" } } };
        },
      },
    ]);

    await waitFor(() => expect(polls).toBeGreaterThan(0), { timeout: 4000 });
    expect(await screen.findByText("Importing spaces and pages")).toBeInTheDocument();
  });
});

describe("remounting with an upload on record", () => {
  const stored = (extra: Record<string, unknown> = {}) =>
    window.localStorage.setItem(
      METADATA_KEY,
      JSON.stringify({
        archiveId: "conf-1",
        fileName: "conf.zip",
        fileSize: 20,
        fileLastModified: 1,
        sha256: "feed",
        partSize: 8,
        ...extra,
      }),
    );

  const uploadRow = (status: string) => ({
    archive_id: "conf-1",
    filename: "conf.zip",
    size_bytes: 20,
    sha256: "feed",
    status,
    part_size_bytes: 8,
    uploaded_parts: [],
  });

  it("forgets a saved upload that was cancelled", async () => {
    stored();
    window.localStorage.setItem("wikihub-confluence-cancelled-uploads", JSON.stringify(["conf-1"]));
    await openPanel();

    await waitFor(() => expect(window.localStorage.getItem(METADATA_KEY)).toBeNull());
  });

  it("falls back to the normal recovery when the scanned archive cannot be fetched", async () => {
    await openPanel([
      {
        method: "GET",
        match: (p) => p === "/api/v1/confluence-imports/uploads/active",
        handler: () => ({ body: [uploadRow("scanned")] }),
      },
      {
        method: "GET",
        match: (p) => p === "/api/v1/confluence-imports/archives/conf-1",
        handler: () => ({ status: 500, body: { error: { code: "x", message: "down" } } }),
      },
      {
        method: "GET",
        match: (p) => p === "/api/v1/confluence-imports/archives/conf-1/upload",
        handler: () => ({ body: uploadRow("scanned") }),
      },
    ]);

    await waitFor(() => expect(window.localStorage.getItem(METADATA_KEY)).toBeNull());
  });

  it("clears a saved upload whose server record is neither uploading nor ready", async () => {
    stored();
    await openPanel([
      {
        method: "GET",
        match: (p) => p === "/api/v1/confluence-imports/uploads/active",
        handler: () => ({ body: [uploadRow("failed")] }),
      },
      {
        method: "GET",
        match: (p) => p === "/api/v1/confluence-imports/archives/conf-1/upload",
        handler: () => ({ body: uploadRow("failed") }),
      },
    ]);

    await waitFor(() => expect(window.localStorage.getItem(METADATA_KEY)).toBeNull());
  });

  it("keeps the picked file when a still-running upload is looked up again", async () => {
    stored({ sha256: null });
    const file = confluenceExportZip("conf.zip");
    stored({ sha256: null, fileName: file.name, fileSize: file.size });
    stubUploadXHR({ hold: true });
    const progress = {
      archive_id: "conf-1",
      filename: file.name,
      size_bytes: file.size,
      sha256: null,
      status: "uploading",
      part_size_bytes: 64,
      uploaded_parts: [],
    };
    const { user } = await openPanel([
      { method: "GET", match: (p) => p === "/api/v1/confluence-imports/uploads/active", handler: () => ({ body: [progress] }) },
      { method: "GET", match: (p) => p === "/api/v1/confluence-imports/archives/conf-1/upload", handler: () => ({ body: progress }) },
      {
        method: "POST",
        match: (p) => p === "/api/v1/confluence-imports/archives/conf-1/upload-parts",
        handler: () => ({ body: { urls: { "1": "http://localhost/p1" } } }),
      },
    ]);
    await screen.findByRole("button", { name: /select file to resume/i });

    await user.upload(confluenceInput(), file);
    await screen.findByRole("button", { name: /pause upload/i });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(screen.getByRole("button", { name: /pause upload/i })).toBeInTheDocument();
  });
});

describe("Confluence upload prechecks", () => {
  it("refuses an archive that is over the limit the server reports when asked", async () => {
    stubUploadXHR();
    let asked = 0;
    const { user } = await openPanel([
      {
        method: "GET",
        match: (p) => p === "/api/v1/settings",
        handler: () =>
          ++asked === 1
            ? { status: 500, body: { error: { code: "x", message: "n/a" } } }
            : { body: { effective: { max_backup_import_size_bytes: 5, max_backup_import_size_mb: 1 } } },
      },
      ...confluenceUploadRoutes(),
    ]);
    await user.upload(confluenceInput(), confluenceExportZip("conf.zip"));

    await user.click(screen.getAllByRole("button", { name: /^upload and scan$/i })[0]!);

    expect(await screen.findByText(/over the 1 MB limit set for Confluence imports/)).toBeInTheDocument();
  });

  it("goes ahead when the limit cannot be looked up", async () => {
    stubUploadXHR();
    const { user } = await openPanel(confluenceUploadRoutes());
    await user.upload(confluenceInput(), confluenceExportZip("conf.zip"));

    await user.click(screen.getAllByRole("button", { name: /^upload and scan$/i })[0]!);

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Archive scanned. Choose the Spaces to import."));
  });

  it("refuses a file over the limit the moment it is chosen, in the restore card too", async () => {
    const { user } = await openPanel([
      {
        method: "GET",
        match: (p) => p === "/api/v1/settings",
        handler: () => ({ body: { effective: { max_backup_import_size_bytes: 5, max_backup_import_size_mb: 1 } } }),
      },
    ]);
    await user.click(screen.getByRole("tab", { name: /import \/ restore/i }));
    await waitFor(() => expect(restoreInput()).not.toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 100));

    await user.upload(restoreInput(), wikihubBackupZip("backup.zip"));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("over the 1 MB import limit"), expect.anything()),
    );
  });
});

describe("resuming with a changed fingerprint", () => {
  it("refuses a file whose fingerprint differs from what the server learned after the page loaded", async () => {
    stubUploadXHR();
    const file = confluenceExportZip("conf.zip");
    window.localStorage.setItem(
      METADATA_KEY,
      JSON.stringify({
        archiveId: "conf-1",
        fileName: file.name,
        fileSize: file.size,
        fileLastModified: file.lastModified,
        sha256: null,
        partSize: 64,
      }),
    );
    let looks = 0;
    const { user } = await openPanel([
      {
        method: "GET",
        match: (p) => p === "/api/v1/confluence-imports/archives/conf-1/upload",
        handler: () => ({
          body: {
            archive_id: "conf-1",
            filename: file.name,
            size_bytes: file.size,
            sha256: ++looks > 1 ? "f".repeat(64) : null,
            status: "uploading",
            part_size_bytes: 64,
            uploaded_parts: [],
          },
        }),
      },
    ]);
    await screen.findByRole("button", { name: /select file to resume/i });
    expect(await sha(file)).not.toBe("f".repeat(64));

    await user.upload(confluenceInput(), file);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(`Select ${file.name} to resume the paused upload.`),
    );
  });
});

describe("after an import finishes", () => {
  it("offers to import another archive, and starts over when accepted", async () => {
    const running = {
      id: "job-1",
      archive_id: "conf-1",
      import_all: true,
      space_keys: [],
      overwrite_existing: false,
      status: "running",
      phase: "importing",
      counters: {},
      cancel_requested: false,
      error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { user } = await openPanel([
      { method: "GET", match: (p) => p === "/api/v1/confluence-imports/jobs", handler: () => ({ body: [running] }) },
      {
        method: "GET",
        match: (p) => p === "/api/v1/confluence-imports/jobs/job-1",
        handler: () => ({
          body: { ...running, status: "completed", phase: "completed", counters: { spaces_completed: 1, pages_processed: 2 } },
        }),
      },
      {
        method: "GET",
        match: (p) => p === "/api/v1/confluence-imports/jobs/job-1/logs",
        handler: () => ({ body: { items: [] } }),
      },
    ]);

    await user.click(await screen.findByRole("button", { name: "Yes, import another" }, { timeout: 5000 }));

    await waitFor(() => expect(screen.queryByText("Import complete")).toBeNull());
  });
});

describe("restore leftovers", () => {
  const unfinished: Route = {
    method: "GET",
    match: (p) => p === "/api/v1/backup/archives/uploads/active",
    handler: () => ({
      body: [
        {
          archive_id: "archive-1",
          filename: "big-backup.zip",
          size_bytes: 400,
          sha256: "a".repeat(64),
          status: "uploading",
          part_size_bytes: 64,
          uploaded_parts: [1, 2],
        },
      ],
    }),
  };

  it("discards an unfinished upload even when the server will not delete it", async () => {
    const { user } = await openPanel([
      unfinished,
      {
        method: "DELETE",
        match: (p) => p === "/api/v1/backup/archives/archive-1/upload",
        handler: () => ({ status: 500, body: { error: { code: "x", message: "down" } } }),
      },
    ]);
    await user.click(await card().findByRole("button", { name: /^cancel upload$/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Unfinished upload discarded."));
  });

  it("closes the different-file prompt without choosing", async () => {
    const { user } = await openPanel([unfinished]);
    await card().findByRole("button", { name: /^select file to resume$/i });
    await user.upload(restoreInput(), wikihubBackupZip("other.zip"));
    await screen.findByRole("heading", { name: /that is a different file/i });

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("heading", { name: /that is a different file/i })).toBeNull());
  });

  it("goes on after discarding the other upload even when that fails", async () => {
    stubUploadXHR();
    const { user } = await openPanel([
      unfinished,
      {
        method: "DELETE",
        match: (p) => p === "/api/v1/backup/archives/archive-1/upload",
        handler: () => ({ status: 500, body: { error: { code: "x", message: "down" } } }),
      },
      ...restoreUploadRoutes(),
    ]);
    await card().findByRole("button", { name: /^select file to resume$/i });
    await user.upload(restoreInput(), wikihubBackupZip("other.zip"));
    await user.click(await screen.findByRole("button", { name: /^discard and upload this$/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Unfinished upload discarded."));
  });

  it("starts the card over when a finished restore has no archive left to pick spaces from", async () => {
    const running = portableJob({ kind: "full_import", phase: "restoring", archive_id: "archive-1" });
    const { user } = await openPanel([
      { method: "GET", match: (p) => p === "/api/v1/backup/jobs", handler: () => ({ body: [running] }) },
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/jobs/job-1",
        handler: () => ({
          body: { ...running, status: "complete", result: { conflicting_space_keys: [], created: { space: 1 }, skipped: {} } },
        }),
      },
      { method: "GET", match: (p) => p === "/api/v1/backup/jobs/job-1/logs", handler: () => ({ body: { items: [] } }) },
    ]);

    await user.click(await screen.findByRole("button", { name: "Yes, restore another" }, { timeout: 5000 }));

    await waitFor(() => expect(screen.queryByText("Restore Completed Successfully")).toBeNull());
  });
});

describe("JSON restore report", () => {
  it("lists what was written, skipped and failed, and who still needs a password", async () => {
    const { user } = await openPanel([
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/import",
        handler: () => ({
          body: {
            dry_run: false,
            includes_credentials: true,
            created: { page: 2 },
            skipped: { user: 1 },
            errors: { comment: 1 },
            users_without_password: Array.from({ length: 12 }, (_, i) => `person${i}`),
            entries_truncated: true,
            entries: [
              { kind: "page", label: "Home", outcome: "created", reason: null },
              { kind: "user", label: "ada", outcome: "skipped", reason: "already_exists" },
              { kind: "comment", label: "c1", outcome: "error", reason: null },
            ],
          },
        }),
      },
    ]);
    await user.click(screen.getByRole("tab", { name: /import \/ restore/i }));
    await user.upload(
      restoreInput(),
      new File(['{"wikihub_backup":{}}'], "backup.json", { type: "application/json" }),
    );
    await user.click(card().getByRole("button", { name: /restore backup/i }));

    expect(await screen.findByText("includes credentials")).toBeInTheDocument();
    expect(screen.getByText(/12 account\(s\) cannot sign in yet/)).toBeInTheDocument();
    expect(screen.getByText(/Per-item detail \(3, truncated\)/)).toBeInTheDocument();
    expect(screen.getByText(/already exists/)).toBeInTheDocument();
    void CONFLUENCE_ARCHIVE;
    void RESTORE_ARCHIVE;
    void fireEvent;
  });
});

describe("last corners", () => {
  it("treats a running Confluence export as an export in progress", async () => {
    await openPanel([
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/jobs",
        handler: () => ({ body: [portableJob({ kind: "confluence_export", status: "running", phase: "exporting" })] }),
      },
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/jobs/job-1",
        handler: () => ({ body: portableJob({ kind: "confluence_export", status: "running", phase: "exporting" }) }),
      },
    ]);

    expect(await screen.findByRole("button", { name: "Cancel export" })).toBeInTheDocument();
  });

  it("copes with an empty Confluence archive", async () => {
    stubUploadXHR();
    const { user } = await openPanel(confluenceUploadRoutes());
    await user.upload(confluenceInput(), new File([], "empty.zip", { type: "application/zip" }));

    await user.click(screen.getAllByRole("button", { name: /^upload and scan$/i })[0]!);

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("cancels a restore upload even when the server cannot delete what was staged", async () => {
    stubUploadXHR({ hold: true });
    const { user } = await openPanel([
      {
        method: "DELETE",
        match: (p) => p === "/api/v1/backup/archives/archive-1/upload",
        handler: () => ({ status: 500, body: { error: { code: "x", message: "down" } } }),
      },
      ...restoreUploadRoutes(),
    ]);
    await user.click(screen.getByRole("tab", { name: /import \/ restore/i }));
    await user.upload(restoreInput(), wikihubBackupZip("backup.zip"));
    await user.click(card().getByRole("button", { name: /^upload and scan$/i }));
    await user.click(await card().findByRole("button", { name: /^cancel upload$/i }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /^cancel upload$/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Backup archive upload cancelled."));
  });

  it("asks before leaving a restore upload, and stays when that is refused", async () => {
    stubUploadXHR({ hold: true });
    const { user } = await openPanel(restoreUploadRoutes());
    await user.click(screen.getByRole("tab", { name: /import \/ restore/i }));
    await user.upload(restoreInput(), wikihubBackupZip("backup.zip"));
    await user.click(card().getByRole("button", { name: /^upload and scan$/i }));
    await card().findByRole("button", { name: /pause upload/i });

    const link = document.createElement("a");
    link.href = "/elsewhere";
    document.body.appendChild(link);
    fireEvent.click(link, { button: 0 });
    link.remove();
    expect(await screen.findByText("Pause this upload and leave?")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByText("Pause this upload and leave?")).toBeNull());
  });
});
