import { webcrypto } from "node:crypto";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { BackupPanel } from "@/components/admin/backup-panel";

import {
  CONFLUENCE_ARCHIVE,
  UPLOAD_TARGET,
  baseRoutes,
  confluenceExportZip,
  confluenceUploadRoutes,
  mockFetch,
  stubUploadXHR,
  wikihubBackupZip,
  type Route,
} from "./backup-panel-harness";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const METADATA_KEY = "wikihub-confluence-upload-current";

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("crypto", {
    subtle: { digest: (algorithm: string, data: BufferSource) => webcrypto.subtle.digest(algorithm, data) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.info).mockClear();
});

/** The Confluence card: the part of the shared section that is not the restore card. */
function confluenceCard() {
  const input = document.getElementById("confluence-backup-file")!;
  const restore = screen.getByTestId("wikihub-restore-card");
  let node: HTMLElement = input;
  while (node.parentElement && !node.parentElement.contains(restore)) node = node.parentElement;
  return within(node);
}

async function openPanel(routes: Route[] = []) {
  mockFetch([...routes, ...baseRoutes()]);
  const user = userEvent.setup({ applyAccept: false });
  render(<BackupPanel />);
  await user.click(screen.getByRole("tab", { name: /import \/ restore/i }));
  await waitFor(() => expect(document.getElementById("confluence-backup-file")).not.toBeNull());
  return user;
}

const chooseConfluenceFile = async (user: ReturnType<typeof userEvent.setup>, file = confluenceExportZip("conf.zip")) => {
  await user.upload(document.getElementById("confluence-backup-file") as HTMLInputElement, file);
  return file;
};

const uploadAndScan = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(confluenceCard().getByRole("button", { name: /^upload and scan$/i }));

describe("Confluence upload", () => {
  it("uploads the archive in parts, scans it and opens the space picker", async () => {
    stubUploadXHR();
    const user = await openPanel(confluenceUploadRoutes());
    await chooseConfluenceFile(user);

    await uploadAndScan(user);

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Archive scanned. Choose the Spaces to import."));
    expect(await screen.findByText("Engineering")).toBeInTheDocument();
    expect(window.localStorage.getItem(METADATA_KEY)).toBeNull();
  });

  it("skips the upload for an archive that is already in storage", async () => {
    stubUploadXHR();
    const user = await openPanel(
      confluenceUploadRoutes({ start: () => ({ body: { ...UPLOAD_TARGET, reused: true, status: "uploaded" } }) }),
    );
    await chooseConfluenceFile(user);

    await uploadAndScan(user);

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Archive already uploaded. Choose the Spaces to import."),
    );
  });

  it("refuses an archive over the instance's size limit before reading it", async () => {
    stubUploadXHR();
    const user = await openPanel([
      {
        method: "GET",
        match: (p) => p === "/api/v1/settings",
        handler: () => ({
          body: { effective: { max_backup_import_size_bytes: 5, max_backup_import_size_mb: 1 } },
        }),
      },
      ...confluenceUploadRoutes(),
    ]);

    await user.upload(
      document.getElementById("confluence-backup-file") as HTMLInputElement,
      confluenceExportZip("conf.zip"),
    );

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(vi.mocked(toast.error).mock.calls[0]![0])).toContain("over the 1 MB import limit");
  });

  it("says why the upload failed when the server refuses to start it", async () => {
    stubUploadXHR();
    const user = await openPanel(
      confluenceUploadRoutes({
        start: () => ({ status: 500, body: { error: { code: "boom", message: "Storage is full." } } }),
      }),
    );
    await chooseConfluenceFile(user);

    await uploadAndScan(user);

    expect(await screen.findByText("Storage is full.")).toBeInTheDocument();
  });

  it("falls back to a general message for a failure that is not the server's", async () => {
    stubUploadXHR({ fail: "error" });
    const user = await openPanel(confluenceUploadRoutes());
    await chooseConfluenceFile(user);

    await uploadAndScan(user);

    expect(await screen.findByText("Could not upload or scan the Confluence archive.")).toBeInTheDocument();
  });

  it("reports a rejected part", async () => {
    stubUploadXHR({ status: 403 });
    const user = await openPanel(confluenceUploadRoutes());
    await chooseConfluenceFile(user);

    await uploadAndScan(user);

    expect(await screen.findByText("Could not upload or scan the Confluence archive.")).toBeInTheDocument();
  });

  it("keeps the log of what went wrong while preparing the archive", async () => {
    stubUploadXHR();
    const user = await openPanel(
      confluenceUploadRoutes({
        scan: () => ({ status: 500, body: { error: { code: "scan", message: "The archive is unreadable." } } }),
      }),
    );
    await chooseConfluenceFile(user);

    await uploadAndScan(user);

    expect(await screen.findByText("The archive is unreadable.")).toBeInTheDocument();
    expect(await screen.findByText(/Preparation failed: The archive is unreadable\./)).toBeInTheDocument();
  });

  it("tells a session that expired apart from other failures", async () => {
    stubUploadXHR();
    const user = await openPanel(
      confluenceUploadRoutes({
        start: () => ({ status: 401, body: { error: { code: "unauthenticated", message: "Expired." } } }),
      }),
    );
    await chooseConfluenceFile(user);

    await uploadAndScan(user);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Upload paused because your session expired."));
    expect(await screen.findByText(/session expired while uploading/i)).toBeInTheDocument();
  });

  it("refuses a WikiHub backup picked in this card", async () => {
    stubUploadXHR();
    const user = await openPanel(confluenceUploadRoutes());

    await chooseConfluenceFile(user, wikihubBackupZip("backup.zip"));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("This is a WikiHub backup")),
    );
  });
});

describe("Confluence import", () => {
  async function scanned(extraRoutes: Route[] = []) {
    stubUploadXHR();
    const user = await openPanel([...extraRoutes, ...confluenceUploadRoutes()]);
    await chooseConfluenceFile(user);
    await uploadAndScan(user);
    await screen.findByText("Engineering");
    return user;
  }

  it("filters the spaces by name or key", async () => {
    const user = await scanned();
    const search = screen.getByRole("searchbox");

    await user.type(search, "ops");

    expect(screen.queryByText("Engineering")).toBeNull();
    expect(screen.getByText("Operations")).toBeInTheDocument();
  });

  it("queues the import for the chosen spaces, asking first when one already exists", async () => {
    const start = vi.fn(() => ({
      body: {
        id: "job-1",
        status: "queued",
        phase: "queued",
        counters: {},
        archive_id: "conf-1",
        space_keys: ["OPS"],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    }));
    const user = await scanned([
      { method: "POST", match: (p) => p === "/api/v1/confluence-imports/archives/conf-1/jobs", handler: start },
    ]);

    await user.click(screen.getByRole("checkbox", { name: /Operations/ }));
    await user.click(screen.getByRole("button", { name: /^start import$/i }));

    expect(await screen.findByText("Replace existing spaces?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Replace and import" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Confluence import queued."));
    expect(start).toHaveBeenCalled();
  });

  it("reports an import that could not be queued", async () => {
    const user = await scanned([
      {
        method: "POST",
        match: (p) => p === "/api/v1/confluence-imports/archives/conf-1/jobs",
        handler: () => ({ status: 409, body: { error: { code: "busy", message: "Another import is running." } } }),
      },
    ]);

    await user.click(screen.getByRole("checkbox", { name: /Engineering/ }));
    await user.click(screen.getByRole("button", { name: /^start import$/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Another import is running."));
  });

  it("clears the selection of a scanned archive", async () => {
    const user = await scanned();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getAllByRole("button", { name: "Cancel import" })[0]!);
    await user.click(await screen.findByRole("button", { name: "Yes, cancel import" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Archive selection cleared."));
  });
});

describe("Confluence upload recovery", () => {
  const uploading = (overrides: Record<string, unknown> = {}) => ({
    archive_id: "conf-1",
    filename: "conf.zip",
    size_bytes: 20 * 1024 * 1024,
    sha256: "feed",
    status: "uploading",
    part_size_bytes: 8 * 1024 * 1024,
    uploaded_parts: [1],
    ...overrides,
  });

  const recoverRoutes = (progress: Record<string, unknown>, extra: Route[] = []): Route[] => [
    {
      method: "GET",
      match: (p) => p === "/api/v1/confluence-imports/uploads/active",
      handler: () => ({ body: [uploading()] }),
    },
    {
      method: "GET",
      match: (p) => p === "/api/v1/confluence-imports/archives/conf-1/upload",
      handler: () => ({ body: progress }),
    },
    ...extra,
  ];

  it("offers to resume an unfinished upload the server still holds", async () => {
    await openPanel(recoverRoutes(uploading()));

    expect(await screen.findByRole("button", { name: /select file to resume/i })).toBeInTheDocument();
    expect(window.localStorage.getItem(METADATA_KEY)).toContain("conf-1");
  });

  it("scans an upload that finished while the page was away", async () => {
    const user = await openPanel(
      recoverRoutes(uploading({ status: "uploaded" }), [
        {
          method: "POST",
          match: (p) => p === "/api/v1/confluence-imports/archives/conf-1/scan",
          handler: () => ({ body: CONFLUENCE_ARCHIVE }),
        },
      ]),
    );

    await user.click(await screen.findByRole("button", { name: /select spaces & import/i }));
    expect(await screen.findByText("Engineering")).toBeInTheDocument();
  });

  it("opens an archive that was already scanned", async () => {
    const user = await openPanel(
      recoverRoutes(uploading({ status: "scanned" }), [
        {
          method: "GET",
          match: (p) => p === "/api/v1/confluence-imports/archives/conf-1",
          handler: () => ({ body: CONFLUENCE_ARCHIVE }),
        },
      ]),
    );

    await user.click(await screen.findByRole("button", { name: /select spaces & import/i }));
    expect(await screen.findByText("Engineering")).toBeInTheDocument();
  });

  it("forgets an upload the server says is neither uploading nor ready", async () => {
    await openPanel(recoverRoutes(uploading({ status: "failed" })));

    await waitFor(() => expect(screen.queryByRole("button", { name: /select file to resume/i })).toBeNull());
    expect(window.localStorage.getItem(METADATA_KEY)).toBeNull();
  });

  it.each([
    [404, "forgets", null],
    [401, "asks to sign in again", /session expired while uploading/i],
    [500, "reports the server's message", /Server broke/],
  ])("handles a %s while checking on the saved upload (%s)", async (status, _what, message) => {
    await openPanel([
      {
        method: "GET",
        match: (p) => p === "/api/v1/confluence-imports/uploads/active",
        handler: () => ({ body: [uploading()] }),
      },
      {
        method: "GET",
        match: (p) => p === "/api/v1/confluence-imports/archives/conf-1/upload",
        handler: () => ({ status, body: { error: { code: "x", message: "Server broke" } } }),
      },
    ]);

    if (message) expect(await screen.findByText(message)).toBeInTheDocument();
    else await waitFor(() => expect(screen.queryByRole("button", { name: /select file to resume/i })).toBeNull());
  });

  it("forgets a saved upload the server no longer knows about", async () => {
    window.localStorage.setItem(
      METADATA_KEY,
      JSON.stringify({
        archiveId: "gone",
        fileName: "conf.zip",
        fileSize: 20,
        fileLastModified: 1,
        sha256: "feed",
        partSize: 8,
      }),
    );
    await openPanel([
      {
        method: "GET",
        match: (p) => p === "/api/v1/confluence-imports/archives/gone/upload",
        handler: () => ({ status: 404, body: { error: { code: "not_found", message: "gone" } } }),
      },
    ]);

    await waitFor(() => expect(window.localStorage.getItem(METADATA_KEY)).toBeNull());
  });

  it("does not bring back an upload that was cancelled", async () => {
    window.localStorage.setItem("wikihub-confluence-cancelled-uploads", JSON.stringify(["conf-1"]));
    await openPanel(recoverRoutes(uploading()));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.queryByRole("button", { name: /select file to resume/i })).toBeNull();
  });
});

describe("Confluence upload leftovers", () => {
  it("asks for the same file again when a different one is picked during a paused upload", async () => {
    window.localStorage.setItem(
      METADATA_KEY,
      JSON.stringify({
        archiveId: "conf-1",
        fileName: "conf.zip",
        fileSize: 20,
        fileLastModified: 1,
        sha256: "feed",
        partSize: 8,
      }),
    );
    const user = await openPanel([
      {
        method: "GET",
        match: (p) => p === "/api/v1/confluence-imports/archives/conf-1/upload",
        handler: () => ({
          body: {
            archive_id: "conf-1",
            filename: "conf.zip",
            size_bytes: 20,
            sha256: "feed",
            status: "uploading",
            part_size_bytes: 8,
            uploaded_parts: [],
          },
        }),
      },
    ]);
    await screen.findByRole("button", { name: /select file to resume/i });

    await fireEvent.change(document.getElementById("confluence-backup-file")!, {
      target: { files: [confluenceExportZip("other.zip")] },
    });

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Select conf.zip to resume the paused upload."),
    );
    void user;
  });
});

const confluenceJob = (overrides: Record<string, unknown> = {}) => ({
  id: "job-1",
  archive_id: "conf-1",
  import_all: true,
  space_keys: [],
  overwrite_existing: false,
  status: "running",
  phase: "importing",
  counters: {
    spaces_total: 4,
    spaces_completed: 2,
    pages_total: 10,
    pages_processed: 5,
    attachments_total: 8,
    attachments_processed: 4,
    download_percent: 40,
    downloaded_bytes: 2048,
    download_total_bytes: 4096,
  },
  cancel_requested: false,
  error: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

describe("Confluence import job", () => {
  const jobRoutes = (job: Record<string, unknown>, next?: Record<string, unknown>, logs: unknown[] = []): Route[] => [
    { method: "GET", match: (p) => p === "/api/v1/confluence-imports/jobs", handler: () => ({ body: [job] }) },
    {
      method: "GET",
      match: (p) => p === "/api/v1/confluence-imports/jobs/job-1",
      handler: () => ({ body: next ?? job }),
    },
    {
      method: "GET",
      match: (p) => p === "/api/v1/confluence-imports/jobs/job-1/logs",
      handler: () => ({ body: { items: logs } }),
    },
  ];

  it.each([
    ["queued", "queued", "Import running", /0% complete/],
    ["running", "downloading", "Downloading archive", /40% complete/],
    ["running", "scanning", "Scanning archive", /10% complete/],
    ["running", "importing", "Importing spaces and pages", /48% complete/],
    ["running", "attachments", "Importing and linking attachments", /92% complete/],
    ["running", "finishing", "Import running", /50% complete/],
  ])("narrates a %s job in the %s phase", async (status, phase, title, progress) => {
    await openPanel(jobRoutes(confluenceJob({ status, phase })));

    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getByText(progress)).toBeInTheDocument();
    if (phase === "downloading") expect(screen.getByText(/Downloading archive: 2\.0 KB/)).toBeInTheDocument();
  });

  it("summarises a job that counts only pages, and one that has no attachments", async () => {
    await openPanel(
      jobRoutes(confluenceJob({ counters: { spaces_total: 1, spaces_completed: 0, pages_processed: 3 } })),
    );

    expect(await screen.findByText(/3 pages/)).toBeInTheDocument();
    expect(screen.queryByText(/attachments$/)).toBeNull();
  });

  it("collapses repeated download lines and shows the download percentage on them", async () => {
    await openPanel(
      jobRoutes(confluenceJob({ phase: "downloading" }), undefined, [
        {
          id: "l1",
          created_at: "2026-10-14T08:00:00Z",
          level: "info",
          phase: "downloading",
          entity_type: null,
          entity_label: null,
          message: "Downloading archive to worker scratch space: 10%",
        },
        {
          id: "l2",
          created_at: "2026-10-14T08:00:01Z",
          level: "info",
          phase: "downloading",
          entity_type: null,
          entity_label: null,
          message: "Downloading archive to worker scratch space: 20%",
        },
        {
          id: "l3",
          created_at: "2026-10-14T08:00:02Z",
          level: "info",
          phase: "downloading",
          entity_type: null,
          entity_label: null,
          message: "Copying",
        },
      ]),
    );

    expect(await screen.findByText(/Copying \(40%\)/)).toBeInTheDocument();
    expect(screen.getAllByText(/Downloading archive to worker scratch space/)).toHaveLength(1);
  });

  it("opens the completed summary when polling reports the import has finished", async () => {
    await openPanel(
      jobRoutes(
        confluenceJob(),
        confluenceJob({ status: "completed", phase: "completed", counters: { spaces_completed: 4, pages_processed: 10, attachments_processed: 8 } }),
      ),
    );

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Confluence import completed successfully!"), {
      timeout: 5000,
    });
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
  });

  it.each([
    ["failed", "Import failed"],
    ["cancelled", "Import cancelled"],
  ])("shows a job that polling reports as %s", async (status, title) => {
    await openPanel(jobRoutes(confluenceJob(), confluenceJob({ status, phase: "importing" })));

    expect(await screen.findByText(title, {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it("cancels a running job", async () => {
    const user = await openPanel([
      ...jobRoutes(confluenceJob()),
      {
        method: "POST",
        match: (p) => p === "/api/v1/confluence-imports/jobs/job-1/cancel",
        handler: () => ({ body: confluenceJob({ status: "cancelled" }) }),
      },
    ]);

    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Import cancelled."));
  });

  it("says a cancellation was only requested when the worker has not stopped yet, and when it fails", async () => {
    let attempt = 0;
    const user = await openPanel([
      ...jobRoutes(confluenceJob()),
      {
        method: "POST",
        match: (p) => p === "/api/v1/confluence-imports/jobs/job-1/cancel",
        handler: () =>
          attempt++ === 0
            ? { body: confluenceJob({ cancel_requested: true }) }
            : { status: 500, body: { error: { code: "x", message: "Worker unreachable." } } },
      },
    ]);

    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Cancellation requested."));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Worker unreachable."));
  });

  it("ignores logs that cannot be loaded for a restored job", async () => {
    await openPanel([
      { method: "GET", match: (p) => p === "/api/v1/confluence-imports/jobs", handler: () => ({ body: [confluenceJob()] }) },
      {
        method: "GET",
        match: (p) => p === "/api/v1/confluence-imports/jobs/job-1/logs",
        handler: () => ({ status: 500, body: { error: { code: "x", message: "no logs" } } }),
      },
    ]);

    expect(await screen.findByText("Importing spaces and pages")).toBeInTheDocument();
  });

  it("does not mind when it cannot tell which jobs are running", async () => {
    await openPanel([
      {
        method: "GET",
        match: (p) => p === "/api/v1/confluence-imports/jobs",
        handler: () => ({ status: 500, body: { error: { code: "x", message: "down" } } }),
      },
    ]);

    expect(document.getElementById("confluence-backup-file")).not.toBeNull();
  });
});

describe("Confluence upload in between steps", () => {
  const held = () => {
    let release: (value: { body: unknown }) => void = () => {};
    const pending = new Promise<{ body: unknown }>((resolve) => (release = resolve));
    return { pending, release };
  };

  it("shows the card working while the server prepares the upload", async () => {
    stubUploadXHR();
    const gate = held();
    const user = await openPanel(confluenceUploadRoutes({ start: () => gate.pending }));
    await chooseConfluenceFile(user);

    await uploadAndScan(user);

    const working = await confluenceCard().findByRole("button", { name: /upload and scan/i });
    expect(working).toBeDisabled();
    gate.release({ body: UPLOAD_TARGET });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Archive scanned. Choose the Spaces to import."));
  });

  it("says the archive is being prepared once every part is up", async () => {
    stubUploadXHR();
    const gate = held();
    const user = await openPanel(confluenceUploadRoutes({ complete: () => gate.pending }));
    await chooseConfluenceFile(user);

    await uploadAndScan(user);

    expect(await screen.findByText("Upload complete. Preparing your archive…")).toBeInTheDocument();
    gate.release({ body: {} });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Archive scanned. Choose the Spaces to import."));
  });

  it("opens the file picker from the resume button, and lets a saved upload go when the choice is cleared", async () => {
    window.localStorage.setItem(
      METADATA_KEY,
      JSON.stringify({
        archiveId: "conf-1",
        fileName: "conf.zip",
        fileSize: 20,
        fileLastModified: 1,
        sha256: null,
        partSize: 8,
      }),
    );
    let deleted = false;
    const user = await openPanel([
      {
        method: "GET",
        match: (p) => p === "/api/v1/confluence-imports/archives/conf-1/upload",
        handler: () => ({
          body: {
            archive_id: "conf-1",
            filename: "conf.zip",
            size_bytes: 20,
            sha256: null,
            status: "uploading",
            part_size_bytes: 8,
            uploaded_parts: [],
          },
        }),
      },
      {
        method: "DELETE",
        match: (p) => p === "/api/v1/confluence-imports/archives/conf-1/upload",
        handler: () => {
          deleted = true;
          return { body: {} };
        },
      },
    ]);
    const resume = await confluenceCard().findByRole("button", { name: /select file to resume/i });
    const click = vi.spyOn(document.getElementById("confluence-backup-file") as HTMLInputElement, "click");

    await user.click(resume);
    expect(click).toHaveBeenCalled();

    fireEvent.change(document.getElementById("confluence-backup-file")!, { target: { files: [] } });

    await waitFor(() => expect(deleted).toBe(true));
    await waitFor(() => expect(window.localStorage.getItem(METADATA_KEY)).toBeNull());
    expect(window.localStorage.getItem("wikihub-confluence-cancelled-uploads")).toContain("conf-1");
  });

  it("does not ask the server to drop an upload it already fingerprinted when the choice is cleared", async () => {
    window.localStorage.setItem(
      METADATA_KEY,
      JSON.stringify({
        archiveId: "conf-1",
        fileName: "conf.zip",
        fileSize: 20,
        fileLastModified: 1,
        sha256: "feed",
        partSize: 8,
      }),
    );
    let deleted = false;
    await openPanel([
      {
        method: "GET",
        match: (p) => p === "/api/v1/confluence-imports/archives/conf-1/upload",
        handler: () => ({
          body: {
            archive_id: "conf-1",
            filename: "conf.zip",
            size_bytes: 20,
            sha256: "feed",
            status: "uploading",
            part_size_bytes: 8,
            uploaded_parts: [],
          },
        }),
      },
      {
        method: "DELETE",
        match: (p) => p === "/api/v1/confluence-imports/archives/conf-1/upload",
        handler: () => {
          deleted = true;
          return { body: {} };
        },
      },
    ]);
    await confluenceCard().findByRole("button", { name: /select file to resume/i });

    fireEvent.change(document.getElementById("confluence-backup-file")!, { target: { files: [] } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(deleted).toBe(false);
  });
});
