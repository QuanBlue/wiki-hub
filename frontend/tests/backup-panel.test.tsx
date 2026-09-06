import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toast } from "sonner";

import { BackupPanel } from "@/components/admin/backup-panel";

// Rejections that undo the user's selection are reported as toasts, not as a
// box pinned under an input that is empty again. No <Toaster/> is mounted in
// these tests, so assert on the call rather than on rendered text.
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  // The sonner mock is module-level, so its calls would leak between tests.
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});

type RouteHandler = (
  init?: RequestInit,
) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>;

function mockFetch(routes: Array<{ method: string; match: (pathname: string) => boolean; handler: RouteHandler }>) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const route = routes.find((r) => r.method === method && r.match(pathname));
    if (!route) {
      return new Response(
        JSON.stringify({ error: { code: "not_found", message: `Unhandled ${method} ${pathname}` } }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    }
    const { status = 200, body } = await route.handler(init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

const SPACES = [
  { id: "s1", key: "ENG", name: "Engineering", status: "active" },
  { id: "s2", key: "SALES", name: "Sales", status: "active" },
];

/** The baseline set of routes every render of BackupPanel hits on mount. */
function baseRoutes(): Array<{ method: string; match: (pathname: string) => boolean; handler: RouteHandler }> {
  return [
    {
      method: "GET",
      match: (p) => p === "/api/v1/confluence-imports/jobs",
      handler: () => ({ body: [] }),
    },
    {
      method: "GET",
      match: (p) => p === "/api/v1/confluence-imports/uploads/active",
      handler: () => ({ body: [] }),
    },
    {
      method: "GET",
      match: (p) => p === "/api/v1/settings",
      handler: () => ({ status: 500, body: { error: { code: "unavailable", message: "n/a" } } }),
    },
    {
      method: "GET",
      match: (p) => p === "/api/v1/spaces",
      handler: () => ({ body: SPACES }),
    },
    {
      method: "POST",
      match: (p) => p === "/api/v1/backup/inspect-zip",
      handler: () => ({ body: SPACES }),
    },
    {
      method: "GET",
      match: (p) => p === "/api/v1/backup/jobs",
      handler: () => ({ body: [] }),
    },
    {
      method: "GET",
      match: (p) => p === "/api/v1/backup/archives/uploads/active",
      handler: () => ({ body: [] }),
    },
    {
      method: "GET",
      match: (p) => p.startsWith("/api/v1/backup/jobs/"),
      handler: () => ({
        body: {
          id: "job-1",
          kind: "full_export",
          status: "queued",
          phase: "queued",
          counters: {},
          cancel_requested: false,
          output_filename: null,
          download_url: null,
          error: null,
          space_keys: [],
          started_at: null,
          percent: null,
          eta_seconds: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      }),
    },
  ];
}

/** A `.zip` restore uploads via `XMLHttpRequest` (for `upload.onprogress`,
 * which `fetch` does not offer) rather than `fetch` - `mockFetch`'s
 * `vi.stubGlobal("fetch", ...)` never sees those requests, so they need
 * their own stand-in that resolves immediately without touching the network. */
class FakeUploadXHR {
  method = "";
  url = "";
  status = 200;
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader() {
    /* no-op */
  }
  send() {
    queueMicrotask(() => {
      this.upload.onprogress?.({
        lengthComputable: true,
        loaded: 1,
        total: 1,
      } as ProgressEvent);
      this.onload?.();
    });
  }
}

/** Like `FakeUploadXHR` but the request stays in flight until `abort()` is
 * called, so a test can actually reach the *paused* state rather than racing
 * an upload that completes instantly. */
class PausableUploadXHR {
  static last: PausableUploadXHR | null = null;
  status = 0;
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open() {
    /* no-op */
  }
  setRequestHeader() {
    /* no-op */
  }
  send() {
    PausableUploadXHR.last = this;
    queueMicrotask(() => {
      this.upload.onprogress?.({
        lengthComputable: true,
        loaded: 1,
        total: 2,
      } as ProgressEvent);
    });
    // Deliberately never fires onload - the upload hangs until aborted.
  }
  abort() {
    this.onabort?.();
  }
}

function stubPausableUploadXHR() {
  PausableUploadXHR.last = null;
  vi.stubGlobal(
    "XMLHttpRequest",
    PausableUploadXHR as unknown as typeof XMLHttpRequest,
  );
}

function stubUploadXHR() {
  vi.stubGlobal(
    "XMLHttpRequest",
    FakeUploadXHR as unknown as typeof XMLHttpRequest,
  );
}

/** The "Restore WikiHub Backup" card, scoped - it sits next to the
 * Confluence import card in the same always-mounted section, and both cards
 * use identical wording ("Upload and scan", "Cancel upload") for their own
 * upload steps. Restore-only button queries go through this. */

/** A minimal but genuine ZIP, so `detectArchiveFormat` walks a real central
 * directory rather than a stubbed-out blob. Stored (uncompressed) entries keep
 * this short; nothing here is ever decompressed. */
function makeZip(entries: Record<string, string>, filename: string): File {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((sum, c) => sum + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return new File(
    [new Blob([...locals, ...centrals, eocd] as BlobPart[])],
    filename,
    { type: "application/zip" },
  );
}

function wikihubBackupZip(filename: string): File {
  return makeZip(
    { "manifest.json": "{}", "data/workspace.json": "{}" },
    filename,
  );
}

function confluenceExportZip(filename: string): File {
  return makeZip(
    { "entities.xml": "<root/>", "exportDescriptor.properties": "b=1" },
    filename,
  );
}

function importSection() {
  return within(screen.getByTestId("wikihub-restore-card"));
}

/** Routes for a `.zip` restore's "Upload and scan" step - start, one part
 * (the test files here are a handful of bytes, well under one 8MB part),
 * complete, and scan (populating the archive's space list, the way the
 * picker now reads it - no more `/inspect-zip`). The eventual `full_import`
 * job itself is a separate route each test adds on top, since that's what
 * varies per test. */
function archiveUploadRoutes(
  archiveId = "archive-1",
  spaces: {
    key: string;
    name: string;
    page_count?: number;
    conflict?: boolean;
  }[] = [
    { key: "ENG", name: "Engineering" },
    { key: "SALES", name: "Sales" },
  ],
) {
  return [
    {
      method: "POST",
      match: (p: string) => p === "/api/v1/backup/archives/uploads",
      handler: () => ({
        body: {
          archive_id: archiveId,
          object_key: `backups/imports/${archiveId}/f.zip`,
          max_size_bytes: 999_999_999,
          part_size_bytes: 8 * 1024 * 1024,
          uploaded_parts: [],
          status: "uploading",
          sha256: null,
          reused: false,
        },
      }),
    },
    {
      method: "POST",
      match: (p: string) => p === `/api/v1/backup/archives/${archiveId}/upload-parts`,
      handler: () => ({
        body: {
          urls: {
            "1": "http://localhost/api/v1/storage/object?key=x&upload_id=y&part_number=1",
          },
        },
      }),
    },
    {
      method: "POST",
      match: (p: string) => p === `/api/v1/backup/archives/${archiveId}/complete-upload`,
      handler: () => ({
        body: {
          id: archiveId,
          filename: "f.zip",
          size_bytes: 9,
          sha256: null,
          status: "uploaded",
          error: null,
          spaces: [],
        },
      }),
    },
    {
      method: "POST",
      match: (p: string) => p === `/api/v1/backup/archives/${archiveId}/scan`,
      handler: () => ({
        body: {
          id: archiveId,
          filename: "f.zip",
          size_bytes: 9,
          sha256: null,
          status: "scanned",
          error: null,
          spaces,
        },
      }),
    },
  ];
}

describe("BackupPanel native export scope", () => {
  it("exports every space by default", async () => {
    const jobsPosted: unknown[] = [];
    mockFetch([
      ...baseRoutes(),
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/jobs",
        handler: (init) => {
          const payload = JSON.parse(String(init?.body));
          jobsPosted.push(payload);
          return {
            body: {
              id: "job-1",
              kind: "full_export",
              status: "queued",
              phase: "queued",
              output_filename: null,
              download_url: null,
              error: null,
              space_keys: payload.space_keys,
            },
          };
        },
      },
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);

    await actor.click(
      screen.getByRole("button", { name: /export wikihub backup/i }),
    );
    await actor.click(
      screen.getByRole("button", { name: /create backup zip/i }),
    );

    await waitFor(() => expect(jobsPosted).toHaveLength(1));
    expect(jobsPosted[0]).toMatchObject({ kind: "full_export", space_keys: [] });
  });

  it("disables the export button until spaces are chosen, and lazily loads the space picker", async () => {
    mockFetch(baseRoutes());
    const actor = userEvent.setup();
    render(<BackupPanel />);

    await actor.click(
      screen.getByRole("button", { name: /export wikihub backup/i }),
    );
    await actor.click(screen.getByRole("radio", { name: /select spaces/i }));

    expect(
      screen.getByRole("button", { name: /create backup zip/i }),
    ).toBeDisabled();

    await actor.click(screen.getByRole("button", { name: /choose spaces/i }));

    expect(await screen.findByText("Engineering")).toBeInTheDocument();
    expect(screen.getByText("Sales")).toBeInTheDocument();
  });

  it("sends only the selected spaces once chosen", async () => {
    const jobsPosted: unknown[] = [];
    mockFetch([
      ...baseRoutes(),
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/jobs",
        handler: (init) => {
          const payload = JSON.parse(String(init?.body));
          jobsPosted.push(payload);
          return {
            body: {
              id: "job-1",
              kind: "full_export",
              status: "queued",
              phase: "queued",
              output_filename: null,
              download_url: null,
              error: null,
              space_keys: payload.space_keys,
            },
          };
        },
      },
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);

    await actor.click(
      screen.getByRole("button", { name: /export wikihub backup/i }),
    );
    await actor.click(screen.getByRole("radio", { name: /select spaces/i }));
    await actor.click(screen.getByRole("button", { name: /choose spaces/i }));
    await actor.click(await screen.findByRole("checkbox", { name: /Engineering/ }));
    await actor.click(screen.getByRole("button", { name: /^done$/i }));

    const exportButton = screen.getByRole("button", {
      name: /create backup zip/i,
    });
    expect(exportButton).not.toBeDisabled();
    await actor.click(exportButton);

    await waitFor(() => expect(jobsPosted).toHaveLength(1));
    expect(jobsPosted[0]).toMatchObject({
      kind: "full_export",
      space_keys: ["ENG"],
    });
  });

  it("disables the trigger and shows progress while the job is queued", async () => {
    mockFetch([
      ...baseRoutes(),
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/jobs",
        handler: () => ({
          body: {
            id: "job-1",
            kind: "full_export",
            status: "queued",
            phase: "queued",
            output_filename: null,
            download_url: null,
            error: null,
            space_keys: [],
          },
        }),
      },
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);

    await actor.click(
      screen.getByRole("button", { name: /export wikihub backup/i }),
    );
    await actor.click(
      screen.getByRole("button", { name: /create backup zip/i }),
    );

    // The POST response alone already carries status "queued", so this
    // needs no interval tick - it's the same render pass as the other tests.
    const trigger = await screen.findByRole("button", {
      name: /exporting…/i,
    });
    expect(trigger).toBeDisabled();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("auto-downloads and re-enables the trigger once the job completes", async () => {
    // The specific GET route must be listed before the wildcard one from
    // baseRoutes() (which always answers "queued") since mockFetch's
    // routing takes the first match in array order.
    mockFetch([
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/jobs/job-1",
        handler: () => ({
          body: {
            id: "job-1",
            kind: "full_export",
            status: "complete",
            phase: "complete",
            output_filename: "backup.zip",
            download_url: "/api/v1/backup/jobs/job-1/download",
            error: null,
            space_keys: [],
          },
        }),
      },
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/jobs",
        handler: () => ({
          body: {
            id: "job-1",
            kind: "full_export",
            status: "queued",
            phase: "queued",
            output_filename: null,
            download_url: null,
            error: null,
            space_keys: [],
          },
        }),
      },
      ...baseRoutes(),
    ]);

    // Real timers: the component's 1500ms poll interval is part of the
    // behavior under test, and this suite has no fake-timer convention.
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const actor = userEvent.setup();
    render(<BackupPanel />);

    await actor.click(
      screen.getByRole("button", { name: /export wikihub backup/i }),
    );
    await actor.click(
      screen.getByRole("button", { name: /create backup zip/i }),
    );
    await screen.findByRole("button", { name: /exporting…/i });

    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: /^export wikihub backup$/i }),
        ).not.toBeDisabled(),
      { timeout: 4000 },
    );
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  }, 8000);
});

describe("BackupPanel native restore", () => {
  it("jumps to the Import / Restore tab on mount when a restore job is already running server-side", async () => {
    // Regression test: after a full remount (e.g. navigating away and back),
    // the panel always used to default to the "Export / Backup" tab even
    // when a `full_import` job was actively running - hiding its progress
    // card and Cancel button until the user happened to click the other tab.
    mockFetch([
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/jobs",
        handler: () => ({
          body: [
            {
              id: "job-restore-1",
              kind: "full_import",
              status: "running",
              phase: "restoring",
              counters: {},
              cancel_requested: false,
              output_filename: null,
              download_url: null,
              error: null,
              space_keys: [],
              archive_id: "archive-1",
              overwrite_space_keys: [],
              result: null,
              started_at: new Date().toISOString(),
              percent: 42,
              eta_seconds: 120,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        }),
      },
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/jobs/job-restore-1",
        handler: () => ({
          body: {
            id: "job-restore-1",
            kind: "full_import",
            status: "running",
            phase: "restoring",
            counters: {},
            cancel_requested: false,
            output_filename: null,
            download_url: null,
            error: null,
            space_keys: [],
            archive_id: "archive-1",
            overwrite_space_keys: [],
            result: null,
            started_at: new Date().toISOString(),
            percent: 42,
            eta_seconds: 120,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        }),
      },
      ...baseRoutes(),
    ]);

    render(<BackupPanel />);

    expect(
      await screen.findByRole("button", { name: /cancel restore/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/restoring backup/i)).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /import \/ restore/i }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("tab", { name: /export \/ backup/i }),
    ).toHaveAttribute("aria-selected", "false");
  });

  it("locks its own card while its own restore job is running", async () => {
    // The Confluence card has always locked against itself via
    // `importInProgress`; this one only ever locked against the *other* flow.
    // Mid-restore its file input stayed live - the reported screenshot shows
    // "Choose File" clickable under a job at 32% - so a second archive could
    // be selected and uploaded on top of the job still writing spaces.
    const runningJob = {
      id: "job-restore-1",
      kind: "full_import",
      status: "running",
      phase: "restoring",
      counters: {},
      cancel_requested: false,
      output_filename: null,
      download_url: null,
      error: null,
      space_keys: [],
      archive_id: "archive-1",
      overwrite_space_keys: [],
      result: null,
      started_at: new Date().toISOString(),
      percent: 32,
      eta_seconds: 377,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockFetch([
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/jobs",
        handler: () => ({ body: [runningJob] }),
      },
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/jobs/job-restore-1",
        handler: () => ({ body: runningJob }),
      },
      ...baseRoutes(),
    ]);

    render(<BackupPanel />);

    // The panel auto-switches to this tab for a running restore.
    const input = (await waitFor(
      () => document.getElementById("backup-file") as HTMLInputElement,
      { timeout: 4000 },
    )) as HTMLInputElement;
    await waitFor(() => expect(input).toBeDisabled(), { timeout: 4000 });
    expect(
      screen.getByText(/a restore is running\. wait for it to finish/i),
    ).toBeInTheDocument();
    // Cancel is the one control that must stay live - the lock has to be
    // releasable from the side holding it.
    expect(
      screen.getByRole("button", { name: /cancel restore/i }),
    ).toBeEnabled();
  });

  it("lands in the space picker straight after the scan, and restores from there", async () => {
    stubUploadXHR();
    const jobsPosted: unknown[] = [];
    mockFetch([
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/archives/archive-1/jobs",
        handler: (init) => {
          const payload = JSON.parse(String(init?.body));
          jobsPosted.push(payload);
          return {
            body: {
              id: "job-1",
              kind: "full_import",
              status: "queued",
              phase: "queued",
              output_filename: null,
              download_url: null,
              error: null,
              space_keys: payload.space_keys,
            },
          };
        },
      },
      // The specific GET route must be listed before the wildcard one from
      // baseRoutes() (which always answers "queued") since mockFetch's
      // routing takes the first match in array order.
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/jobs/job-1",
        handler: () => ({
          body: {
            id: "job-1",
            kind: "full_import",
            status: "complete",
            phase: "complete",
            output_filename: null,
            download_url: null,
            error: null,
            space_keys: [],
            result: {
              dry_run: false,
              includes_credentials: false,
              created: { space: 1 },
              skipped: {},
              errors: {},
              users_without_password: [],
              entries: [],
              entries_truncated: false,
              conflicting_space_keys: [],
            },
          },
        }),
      },
      ...archiveUploadRoutes(),
      ...baseRoutes(),
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);

    await actor.click(screen.getByRole("tab", { name: /import \/ restore/i }));

    // No label is wired to the file input, so it's queried by id.
    const fileInput = document.getElementById(
      "backup-file",
    ) as HTMLInputElement;
    const file = new File(["zip-bytes"], "wikihub-full-backup.zip", {
      type: "application/zip",
    });
    await actor.upload(fileInput, file);

    expect(
      screen.queryByRole("button", { name: /preview changes/i }),
    ).not.toBeInTheDocument();

    // The archive uploads and is scanned first, and the scan opens the picker
    // itself - the scan exists to answer "which spaces?", so making the user
    // click once more before being allowed to answer earns nothing.
    await actor.click(
      importSection().getByRole("button", { name: /^upload and scan$/i }),
    );
    const selectAll = await screen.findByRole(
      "button",
      { name: /^select all$/i },
      { timeout: 4000 },
    );
    await actor.click(selectAll);
    await actor.click(screen.getByRole("button", { name: /^start restore$/i }));

    // No confirm dialog in front of it: job creation fires immediately, and
    // progress shows up inline like the export job card.
    expect(
      screen.queryByRole("button", { name: /restore now/i }),
    ).not.toBeInTheDocument();

    await waitFor(() => expect(jobsPosted).toHaveLength(1));
    expect(jobsPosted[0]).toMatchObject({
      space_keys: [],
      overwrite_space_keys: [],
    });

    // The outcome is announced once, as a toast. It used to also sit on the
    // card as a green banner carrying a "Done" button that threw the archive
    // away - the one thing someone is least likely to want right after a
    // restore, since restoring more spaces from the same file needs it.
    await waitFor(
      () =>
        expect(toast.success).toHaveBeenCalledWith(
          expect.stringMatching(/restore is complete/i),
        ),
      { timeout: 4000 },
    );

    // A restore with nothing left to decide ends in a success modal - not
    // the "Replace existing spaces?" prompt, which is only for unresolved
    // conflicts.
    expect(
      await screen.findByRole(
        "heading",
        { name: /restore completed successfully/i },
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /replace existing spaces/i }),
    ).not.toBeInTheDocument();

    // The archive is still staged, so the offer is to restore more spaces
    // from it - not to go and find another file. A restore covers part of a
    // backup by design; sending the user back to "choose a file" would mean
    // re-uploading multiple GB to reach a picker one click away.
    await actor.click(
      screen.getByRole("button", { name: /^yes, choose more spaces$/i }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: /restore completed successfully/i }),
      ).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByRole("button", { name: /^select all$/i }),
    ).toBeInTheDocument();
    // The finished job's card goes with it - what is on screen now is a new
    // decision, not the last one's result.
    expect(
      screen.queryByRole("button", { name: /^cancel restore$/i }),
    ).not.toBeInTheDocument();
  });

  it("brings back a scanned archive after navigating away and returning", async () => {
    // A remount used to wipe the restore card entirely: the scanned archive
    // lived only in component state, so leaving the page and coming back
    // meant re-uploading a multi-GB file just to pick spaces again.
    mockFetch([
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/archives/uploads/active",
        handler: () => ({
          body: [
            {
              archive_id: "archive-1",
              filename: "f.zip",
              size_bytes: 9,
              sha256: "a".repeat(64),
              status: "scanned",
              part_size_bytes: 8 * 1024 * 1024,
              uploaded_parts: [1],
            },
          ],
        }),
      },
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/archives/archive-1",
        handler: () => ({
          body: {
            id: "archive-1",
            filename: "f.zip",
            size_bytes: 9,
            sha256: "a".repeat(64),
            status: "scanned",
            error: null,
            spaces: [{ key: "ENG", name: "Engineering" }],
          },
        }),
      },
      ...baseRoutes(),
    ]);

    render(<BackupPanel />);

    // Straight back to "which spaces?", on the right tab, with no file and no
    // upload needed.
    expect(
      await screen.findByRole(
        "button",
        { name: /select spaces & restore/i },
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /import \/ restore/i }),
    ).toHaveAttribute("aria-selected", "true");
    // Disabled, not enabled: the bar above owns the decision now, and this
    // button would queue every space in the archive without asking. See
    // "steps aside for the ready-to-restore bar" below.
    expect(
      importSection().getByRole("button", { name: /^restore backup$/i }),
    ).toBeDisabled();
  });

  it("steps aside for the ready-to-restore bar, and comes back when it is cancelled", async () => {
    // Reported: with the "ready to restore" bar up, "Restore backup" sat
    // right above it still live - and one stray click there queues an
    // unscoped restore of all 43 spaces, which is precisely the choice the
    // bar exists to put in front of the operator first.
    let deletedArchive: string | null = null;
    mockFetch([
      {
        method: "DELETE",
        match: (p) => p === "/api/v1/backup/archives/archive-1/upload",
        handler: () => {
          deletedArchive = "archive-1";
          return { body: {} };
        },
      },
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/archives/uploads/active",
        handler: () => ({
          body: deletedArchive
            ? []
            : [
                {
                  archive_id: "archive-1",
                  filename: "f.zip",
                  size_bytes: 8,
                  sha256: "a".repeat(64),
                  status: "scanned",
                  part_size_bytes: 8 * 1024 * 1024,
                  uploaded_parts: [1],
                },
              ],
        }),
      },
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/archives/archive-1",
        handler: () => ({
          body: {
            id: "archive-1",
            filename: "f.zip",
            size_bytes: 8,
            sha256: "a".repeat(64),
            status: "scanned",
            error: null,
            spaces: [
              { key: "ENG", name: "Engineering", page_count: 2, conflict: false },
            ],
          },
        }),
      },
      ...archiveUploadRoutes(),
      ...baseRoutes(),
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);

    await screen.findByRole(
      "button",
      { name: /select spaces & restore/i },
      { timeout: 4000 },
    );
    const restoreButton = importSection().getByRole("button", {
      name: /^restore backup$/i,
    });
    expect(restoreButton).toBeDisabled();

    // Cancel restore, through its confirmation, gives the card back.
    await actor.click(screen.getByRole("button", { name: /^cancel restore$/i }));
    await actor.click(
      await screen.findByRole("button", { name: /^cancel restore$/i }),
    );
    await waitFor(() => expect(deletedArchive).toBe("archive-1"));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /select spaces & restore/i }),
      ).not.toBeInTheDocument(),
    );

    // Back to normal: no archive holding it down, so a freshly chosen file is
    // all it takes to make the button live again.
    const input = document.getElementById("backup-file") as HTMLInputElement;
    await waitFor(() => expect(input).toBeEnabled());
    await actor.upload(
      input,
      new File(["{}"], "restore.json", { type: "application/json" }),
    );
    await waitFor(() =>
      expect(
        importSection().getByRole("button", { name: /^restore backup$/i }),
      ).toBeEnabled(),
    );
  });


  it("re-reads the archive when reopening the picker, so restored spaces show as taken", async () => {
    // `conflict` is a fact about the workspace, not the archive, and it was
    // computed when the archive was scanned. The restore that just finished
    // created spaces - so reusing the scanned flags would offer the very keys
    // it had just filled as though they were still free, and the next restore
    // would silently skip them.
    stubUploadXHR();
    let archiveReads = 0;
    mockFetch([
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/archives/archive-1/jobs",
        handler: () => ({
          body: {
            id: "job-1", kind: "full_import", status: "queued", phase: "queued",
            output_filename: null, download_url: null, error: null, space_keys: [],
          },
        }),
      },
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/jobs/job-1",
        handler: () => ({
          body: {
            id: "job-1", kind: "full_import", status: "complete", phase: "complete",
            output_filename: null, download_url: null, error: null, space_keys: [],
            result: {
              dry_run: false, includes_credentials: false, created: { space: 1 },
              skipped: {}, errors: {}, users_without_password: [],
              entries: [], entries_truncated: false, conflicting_space_keys: [],
            },
          },
        }),
      },
      {
        // Re-read after the restore: ENG exists now, SALES still does not.
        method: "GET",
        match: (p) => p === "/api/v1/backup/archives/archive-1",
        handler: () => {
          archiveReads += 1;
          return {
            body: {
              id: "archive-1", filename: "f.zip", size_bytes: 9,
              sha256: null, status: "scanned", error: null,
              spaces: [
                { key: "ENG", name: "Engineering", page_count: 3, conflict: true },
                { key: "SALES", name: "Sales", page_count: 1, conflict: false },
              ],
            },
          };
        },
      },
      ...archiveUploadRoutes(),
      ...baseRoutes(),
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);
    await actor.click(screen.getByRole("tab", { name: /import \/ restore/i }));

    const fileInput = document.getElementById("backup-file") as HTMLInputElement;
    await actor.upload(
      fileInput,
      new File(["zip-bytes"], "backup.zip", { type: "application/zip" }),
    );
    await actor.click(
      importSection().getByRole("button", { name: /^upload and scan$/i }),
    );
    // Straight out of the scan the picker knows of no conflicts.
    await screen.findByRole("button", { name: /^select all$/i }, { timeout: 4000 });
    expect(screen.queryByText(/^Existed$/)).not.toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: /^select all$/i }));
    await actor.click(screen.getByRole("button", { name: /^start restore$/i }));

    await actor.click(
      await screen.findByRole(
        "button",
        { name: /^yes, choose more spaces$/i },
        { timeout: 4000 },
      ),
    );

    // Reopened on the same archive - no re-upload - with fresh flags.
    await waitFor(() => expect(archiveReads).toBeGreaterThan(0));
    expect(
      await screen.findByRole("button", { name: /^select all$/i }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/^Existed$/)).toBeInTheDocument();
  });

  it("tells the server when a scanned archive is discarded, so it stays gone", async () => {
    // Reported: pressing "Cancel restore" and reloading brought the same card
    // straight back, with the file input disabled against it - so no new
    // backup could be chosen, and pressing Cancel again was equally useless.
    // Clearing local state alone left the row "scanned" server-side, and the
    // next mount rediscovered it.
    let deletedArchive: string | null = null;
    mockFetch([
      {
        method: "DELETE",
        match: (p) => p === "/api/v1/backup/archives/archive-1/upload",
        handler: () => {
          deletedArchive = "archive-1";
          return { body: {} };
        },
      },
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/archives/uploads/active",
        handler: () => ({
          body: deletedArchive
            ? []
            : [
                {
                  archive_id: "archive-1",
                  filename: "f.zip",
                  size_bytes: 8,
                  sha256: "a".repeat(64),
                  status: "scanned",
                  part_size_bytes: 8 * 1024 * 1024,
                  uploaded_parts: [1],
                },
              ],
        }),
      },
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/archives/archive-1",
        handler: () => ({
          body: {
            id: "archive-1",
            filename: "f.zip",
            size_bytes: 8,
            sha256: "a".repeat(64),
            status: "scanned",
            error: null,
            spaces: [
              { key: "ENG", name: "Engineering", page_count: 2, conflict: false },
            ],
          },
        }),
      },
      ...archiveUploadRoutes(),
      ...baseRoutes(),
    ]);

    const actor = userEvent.setup();
    const view = render(<BackupPanel />);

    // Rediscovered from the server on mount.
    await screen.findByRole(
      "button",
      { name: /select spaces & restore/i },
      { timeout: 4000 },
    );
    await actor.click(screen.getByRole("button", { name: /^cancel restore$/i }));
    await actor.click(
      await screen.findByRole("button", { name: /^cancel restore$/i }),
    );
    await waitFor(() => expect(deletedArchive).toBe("archive-1"));

    // Remount: the card must not come back, and the input must be usable.
    view.unmount();
    render(<BackupPanel />);
    await actor.click(screen.getByRole("tab", { name: /import \/ restore/i }));
    await waitFor(() =>
      expect(
        document.getElementById("backup-file") as HTMLInputElement,
      ).toBeEnabled(),
    );
    expect(
      screen.queryByRole("button", { name: /select spaces & restore/i }),
    ).not.toBeInTheDocument();
  });

  it("offers to resume an unfinished upload found on the server after a remount", async () => {
    let deleted = false;
    mockFetch([
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/archives/uploads/active",
        handler: () => ({
          body: [
            {
              archive_id: "archive-1",
              filename: "big-backup.zip",
              size_bytes: 4 * 8 * 1024 * 1024,
              sha256: "a".repeat(64),
              status: "uploading",
              part_size_bytes: 8 * 1024 * 1024,
              uploaded_parts: [1, 2],
            },
          ],
        }),
      },
      {
        method: "DELETE",
        match: (p) => p === "/api/v1/backup/archives/archive-1/upload",
        handler: () => {
          deleted = true;
          return { body: {} };
        },
      },
      ...baseRoutes(),
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);

    // The browser cannot reopen the File by itself, so the card asks for it
    // back - presented the way the Confluence card presents its own
    // interrupted upload: the shared paused-progress strip plus a "select the
    // file again" hint under the input, rather than the bespoke in-card
    // banner this used to get, which made the same situation look like a
    // different feature depending on which half of the panel you were in.
    expect(
      await screen.findByRole(
        "progressbar",
        { name: /upload 50% complete/i },
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Uploaded:$/)).toBeInTheDocument();
    expect(
      screen.getByText(/again so WikiHub can read the remaining parts/i),
    ).toBeInTheDocument();
    expect(
      importSection().getByRole("button", { name: /^select file to resume$/i }),
    ).toBeEnabled();
    expect(screen.queryByText(/unfinished upload of/i)).not.toBeInTheDocument();

    // Discarding it does not need the file either - and it is now reached by
    // the same "Cancel upload" the Confluence card offers, not a "Discard it"
    // link only this card had.
    await actor.click(
      importSection().getByRole("button", { name: /^cancel upload$/i }),
    );
    await waitFor(() => expect(deleted).toBe(true));
    expect(
      screen.queryByRole("progressbar", { name: /upload 50% complete/i }),
    ).not.toBeInTheDocument();
  });


  /** The rediscovered-upload routes, with the file it is waiting for. */
  function interruptedUploadRoutes(onDelete: () => void) {
    return [
      {
        method: "GET",
        match: (p: string) => p === "/api/v1/backup/archives/uploads/active",
        handler: () => ({
          body: [
            {
              archive_id: "archive-1",
              filename: "big-backup.zip",
              size_bytes: 4 * 8 * 1024 * 1024,
              sha256: "a".repeat(64),
              status: "uploading",
              part_size_bytes: 8 * 1024 * 1024,
              uploaded_parts: [1, 2],
            },
          ],
        }),
      },
      {
        method: "DELETE",
        match: (p: string) => p === "/api/v1/backup/archives/archive-1/upload",
        handler: () => {
          onDelete();
          return { body: {} };
        },
      },
    ];
  }

  /** A `File` that claims a size without allocating it. */
  function fileOfSize(name: string, size: number) {
    const file = new File(["zip-bytes"], name, { type: "application/zip" });
    Object.defineProperty(file, "size", { value: size });
    return file;
  }

  it("resumes straight away when the file handed back is the one being uploaded", async () => {
    // Choosing the file *is* the answer - it says "carry on with this one".
    // Making the user then press a button whose only job is to repeat that is
    // a second click for nothing.
    stubUploadXHR();
    mockFetch([
      ...interruptedUploadRoutes(() => {}),
      ...archiveUploadRoutes(),
      ...baseRoutes(),
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);
    await screen.findByRole(
      "button",
      { name: /^select file to resume$/i },
      { timeout: 4000 },
    );

    const fileInput = document.getElementById(
      "backup-file",
    ) as HTMLInputElement;
    await actor.upload(
      fileInput,
      fileOfSize("big-backup.zip", 4 * 8 * 1024 * 1024),
    );

    // It went to work on its own, and did not stop to ask.
    expect(
      await screen.findByText(/calculating archive fingerprint/i, {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /that is a different file/i }),
    ).not.toBeInTheDocument();
  });

  it("asks before pouring a different file into a half-finished upload", async () => {
    // The staged parts belong to the other file. Continuing would assemble an
    // archive out of two different backups, and silently discarding them
    // would throw away an upload the user may have spent an hour on - so
    // neither is chosen for them.
    stubUploadXHR();
    let deleted = false;
    mockFetch([
      ...interruptedUploadRoutes(() => {
        deleted = true;
      }),
      ...archiveUploadRoutes(),
      ...baseRoutes(),
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);
    await screen.findByRole(
      "button",
      { name: /^select file to resume$/i },
      { timeout: 4000 },
    );

    const fileInput = document.getElementById(
      "backup-file",
    ) as HTMLInputElement;
    await actor.upload(fileInput, fileOfSize("other-backup.zip", 1234));

    const modal = (
      await screen.findByRole("heading", { name: /that is a different file/i })
    ).closest("[role=dialog]") as HTMLElement;
    // The two names differ deep inside a long string, so both are shown in
    // full and set against each other - that is the whole decision. Putting
    // them inside the buttons instead is what wrapped those into an
    // unreadable stack.
    expect(within(modal).getByText("big-backup.zip")).toBeInTheDocument();
    expect(within(modal).getByText("other-backup.zip")).toBeInTheDocument();
    // And what each side is worth, so the cost is visible without doing sums.
    expect(within(modal).getByText(/already in storage/i)).toBeInTheDocument();
    expect(within(modal).getByText(/nothing uploaded yet/i)).toBeInTheDocument();
    expect(deleted).toBe(false);

    // Taking the destructive one drops the staged parts before starting over,
    // so the abandoned upload is not still offered on the next visit.
    await actor.click(
      within(modal).getByRole("button", { name: /^discard and upload this$/i }),
    );
    await waitFor(() => expect(deleted).toBe(true));
    expect(
      await screen.findByText(/calculating archive fingerprint/i, {}, { timeout: 4000 }),
    ).toBeInTheDocument();
  });

  it("locks the Confluence card while a WikiHub restore upload is under way, and frees it on cancel", async () => {
    // Both paths write the same spaces and pages, so only one may be engaged.
    // Before this, the panel happily ran a Confluence upload and a WikiHub
    // restore at once and left the user to guess which status panel was which.
    stubUploadXHR();
    let releaseParts: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseParts = resolve;
    });
    mockFetch([
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/archives/archive-1/upload-parts",
        handler: async () => {
          await gate;
          return {
            body: {
              urls: {
                "1": "http://localhost/api/v1/storage/object?key=x&upload_id=y&part_number=1",
              },
            },
          };
        },
      },
      {
        method: "DELETE",
        match: (p) => p === "/api/v1/backup/archives/archive-1/upload",
        handler: () => ({ body: {} }),
      },
      ...archiveUploadRoutes(),
      ...baseRoutes(),
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);
    await actor.click(screen.getByRole("tab", { name: /import \/ restore/i }));

    const confluenceInput = document.getElementById(
      "confluence-backup-file",
    ) as HTMLInputElement;
    expect(confluenceInput).toBeEnabled();

    // Start a restore upload.
    const fileInput = document.getElementById(
      "backup-file",
    ) as HTMLInputElement;
    await actor.upload(
      fileInput,
      new File(["zip-bytes"], "f.zip", { type: "application/zip" }),
    );
    await actor.click(
      importSection().getByRole("button", { name: /^upload and scan$/i }),
    );

    // The other path is now locked - the file input too, not just the button,
    // so nobody picks an archive they will not be allowed to apply.
    await waitFor(() => expect(confluenceInput).toBeDisabled());
    expect(
      screen.getByText(/a wikihub restore is in progress/i),
    ).toBeInTheDocument();

    // The lock must always be releasable from the side holding it.
    const cancel = importSection().getByRole("button", {
      name: /^cancel upload$/i,
    });
    expect(cancel).toBeEnabled();
    expect(
      importSection().getByRole("button", { name: /^pause upload$/i }),
    ).toBeEnabled();

    await actor.click(cancel);
    await actor.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: /^cancel upload$/i,
      }),
    );
    releaseParts?.();

    await waitFor(() => expect(confluenceInput).toBeEnabled());
    expect(
      screen.queryByText(/a wikihub restore is in progress/i),
    ).not.toBeInTheDocument();
  });

  it("locks the restore card while a Confluence archive is waiting to be imported", async () => {
    // A scanned-but-not-yet-applied Confluence archive is a real commitment,
    // not just an upload - it must lock the restore path the same way.
    mockFetch([
      {
        method: "GET",
        match: (p) => p === "/api/v1/confluence-imports/uploads/active",
        handler: () => ({
          body: [
            {
              archive_id: "conf-1",
              filename: "confluence.zip",
              size_bytes: 10,
              sha256: null,
              status: "scanned",
              part_size_bytes: 8 * 1024 * 1024,
              uploaded_parts: [1],
            },
          ],
        }),
      },
      {
        method: "GET",
        match: (p) => p === "/api/v1/confluence-imports/archives/conf-1",
        handler: () => ({
          body: {
            id: "conf-1",
            filename: "confluence.zip",
            size_bytes: 10,
            sha256: null,
            status: "scanned",
            error: null,
            spaces: [
              {
                key: "ENG",
                name: "Engineering",
                page_count: 3,
                attachment_count: 0,
                conflict: false,
              },
            ],
          },
        }),
      },
      ...baseRoutes(),
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);
    await actor.click(screen.getByRole("tab", { name: /import \/ restore/i }));

    const fileInput = document.getElementById(
      "backup-file",
    ) as HTMLInputElement;
    await waitFor(() => expect(fileInput).toBeDisabled(), { timeout: 4000 });
    expect(
      screen.getByText(/a confluence import is in progress/i),
    ).toBeInTheDocument();
    // Clearing the Confluence side stays available so the lock can be released.
    expect(
      screen.getByRole("button", { name: /^cancel import$/i }),
    ).toBeEnabled();
  });

  it("keeps the Confluence card locked while a restore upload is only paused", async () => {
    // A paused upload still holds real uploaded parts in object storage and
    // the user is plainly mid-flow, so the other path must stay locked. This
    // was the gap: pausing dropped every "busy" flag and quietly unlocked the
    // other card.
    stubUploadXHR();
    let releaseParts: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseParts = resolve;
    });
    mockFetch([
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/archives/archive-1/upload-parts",
        handler: async () => {
          await gate;
          return {
            body: {
              urls: {
                "1": "http://localhost/api/v1/storage/object?key=x&upload_id=y&part_number=1",
              },
            },
          };
        },
      },
      {
        method: "DELETE",
        match: (p) => p === "/api/v1/backup/archives/archive-1/upload",
        handler: () => ({ body: {} }),
      },
      ...archiveUploadRoutes(),
      ...baseRoutes(),
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);
    await actor.click(screen.getByRole("tab", { name: /import \/ restore/i }));

    const confluenceInput = document.getElementById(
      "confluence-backup-file",
    ) as HTMLInputElement;
    const fileInput = document.getElementById(
      "backup-file",
    ) as HTMLInputElement;
    await actor.upload(
      fileInput,
      new File(["zip-bytes"], "f.zip", { type: "application/zip" }),
    );
    await actor.click(
      importSection().getByRole("button", { name: /^upload and scan$/i }),
    );
    await waitFor(() => expect(confluenceInput).toBeDisabled());

    // Pause - and the lock must hold.
    await actor.click(
      await importSection().findByRole("button", { name: /^pause upload$/i }),
    );
    expect(
      await importSection().findByRole("button", { name: /^resume upload$/i }),
    ).toBeInTheDocument();
    expect(confluenceInput).toBeDisabled();
    expect(
      screen.getByText(/a wikihub restore is in progress/i),
    ).toBeInTheDocument();

    // Cancel must be reachable while paused, or the lock has no escape hatch.
    const cancel = importSection().getByRole("button", {
      name: /^cancel upload$/i,
    });
    expect(cancel).toBeEnabled();
    await actor.click(cancel);
    await actor.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: /^cancel upload$/i,
      }),
    );
    releaseParts?.();

    await waitFor(() => expect(confluenceInput).toBeEnabled());
  });

  it("locks the restore card while a Confluence upload is paused", async () => {
    // The reported screenshot: Confluence paused at 3% with 800 MB already
    // staged, yet every restore control stayed live. A paused upload holds
    // real parts in object storage, so it must keep the other path locked.
    stubPausableUploadXHR();
    mockFetch([
      {
        method: "POST",
        match: (p) => p === "/api/v1/auth/renew",
        handler: () => ({ body: {} }),
      },
      {
        method: "POST",
        match: (p) => p === "/api/v1/confluence-imports/uploads",
        handler: () => ({
          body: {
            archive_id: "conf-1",
            object_key: "imports/confluence/conf-1/c.zip",
            max_size_bytes: 999_999_999_999,
            part_size_bytes: 8 * 1024 * 1024,
            uploaded_parts: [],
            status: "uploading",
            sha256: null,
            reused: false,
          },
        }),
      },
      {
        method: "POST",
        match: (p) =>
          p === "/api/v1/confluence-imports/archives/conf-1/upload-parts",
        handler: () => ({
          body: {
            urls: {
              "1": "http://localhost/api/v1/storage/object?key=x&upload_id=y&part_number=1",
            },
          },
        }),
      },
      ...baseRoutes(),
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);
    await actor.click(screen.getByRole("tab", { name: /import \/ restore/i }));

    const restoreInput = document.getElementById(
      "backup-file",
    ) as HTMLInputElement;
    expect(restoreInput).toBeEnabled();

    const confluenceInput = document.getElementById(
      "confluence-backup-file",
    ) as HTMLInputElement;
    await actor.upload(
      confluenceInput,
      new File(["confluence-bytes"], "c.zip", { type: "application/zip" }),
    );
    await actor.click(
      screen.getByRole("button", { name: /^upload and scan$/i }),
    );

    // Uploading: the restore card locks.
    await waitFor(() => expect(restoreInput).toBeDisabled(), { timeout: 4000 });

    // Pause it - this is the state that used to silently unlock the other card.
    await actor.click(
      await screen.findByRole("button", { name: /^pause upload$/i }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /^pause upload$/i }),
      ).not.toBeInTheDocument(),
    );

    expect(restoreInput).toBeDisabled();
    expect(
      screen.getByText(/a confluence import is in progress/i),
    ).toBeInTheDocument();
    // The holding card keeps a way out, so the lock is never a dead end.
    expect(
      screen.getByRole("button", { name: /^cancel upload$/i }),
    ).toBeEnabled();
  });

  it("shows the same upload panel for a restore as for a Confluence import", async () => {
    // The two flows run the identical fingerprint-then-chunked-upload
    // sequence, so their progress panels must read identically. They had
    // drifted: Confluence showed an info strip with labelled
    // Uploaded/Speed/Estimate columns, the restore a raised card with a status
    // badge and the same numbers run together on one line.
    stubPausableUploadXHR();
    mockFetch([
      {
        method: "POST",
        match: (p) =>
          p === "/api/v1/backup/archives/archive-1/upload-parts",
        handler: () => ({
          body: {
            urls: {
              "1": "http://localhost/api/v1/storage/object?key=x&upload_id=y&part_number=1",
            },
          },
        }),
      },
      ...archiveUploadRoutes(),
      ...baseRoutes(),
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);
    await actor.click(screen.getByRole("tab", { name: /import \/ restore/i }));
    await actor.upload(
      document.getElementById("backup-file") as HTMLInputElement,
      new File(["zip-bytes"], "f.zip", { type: "application/zip" }),
    );
    await actor.click(
      importSection().getByRole("button", { name: /^upload and scan$/i }),
    );

    // Confluence's wording and labelled columns, not the old bespoke card.
    const panel = await screen.findByRole(
      "progressbar",
      { name: /upload \d+% complete/i },
      { timeout: 4000 },
    );
    expect(panel).toBeInTheDocument();
    expect(screen.getByText(/^Uploaded:$/)).toBeInTheDocument();
    expect(screen.getByText(/^Speed:$/)).toBeInTheDocument();
    expect(screen.getByText(/^Estimate:$/)).toBeInTheDocument();
    // The old card's status badge is gone.
    expect(screen.queryByText(/^running$/)).not.toBeInTheDocument();
  });

  it("asks to pause before navigating away from a restore upload", async () => {
    // Next.js client navigation fires no unload event, so an in-flight
    // multipart upload used to be abandoned mid-part the instant a sidebar
    // link was clicked - silently, and only on this card: the Confluence
    // upload had had this prompt all along.
    stubPausableUploadXHR();
    mockFetch([
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/archives/archive-1/upload-parts",
        handler: () => ({
          body: {
            urls: {
              "1": "http://localhost/api/v1/storage/object?key=x&upload_id=y&part_number=1",
            },
          },
        }),
      },
      ...archiveUploadRoutes(),
      ...baseRoutes(),
    ]);

    const assign = vi.fn();
    const realLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...realLocation, href: realLocation.href, assign },
    });
    // The guard only intercepts real in-app links, so give it one.
    const link = document.createElement("a");
    link.href = "/spaces";
    link.textContent = "Spaces";
    document.body.appendChild(link);

    try {
      const actor = userEvent.setup();
      render(<BackupPanel />);
      await actor.click(screen.getByRole("tab", { name: /import \/ restore/i }));
      await actor.upload(
        document.getElementById("backup-file") as HTMLInputElement,
        new File(["zip-bytes"], "f.zip", { type: "application/zip" }),
      );
      await actor.click(
        importSection().getByRole("button", { name: /^upload and scan$/i }),
      );
      await screen.findByRole(
        "button",
        { name: /^pause upload$/i },
        { timeout: 4000 },
      );

      await actor.click(link);
      expect(
        await screen.findByText(/pause this upload and leave\?/i),
      ).toBeInTheDocument();
      // The restore card cannot stash the File the way Confluence does, so it
      // must not promise the archive is still here on return.
      expect(
        screen.getByText(/select the same file on this page later/i),
      ).toBeInTheDocument();
      // Until confirmed, nothing has moved and nothing has been aborted.
      expect(assign).not.toHaveBeenCalled();

      await actor.click(screen.getByRole("button", { name: /pause and leave/i }));
      await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
      expect(String(assign.mock.calls[0][0])).toContain("/spaces");
    } finally {
      link.remove();
      Object.defineProperty(window, "location", {
        configurable: true,
        value: realLocation,
      });
    }
  });

  it("asks to pause even before the first part of a restore goes out", async () => {
    // The guard must hold for the whole "Upload and scan" call, not just the
    // phases that have a visible progress bar. `POST .../uploads` sits between
    // fingerprinting and the first part, and on a large archive - where the
    // server has to look up a resumable multipart upload - it is not quick.
    // Deriving the guard from the phase flags left that window unguarded, so a
    // link clicked there abandoned the upload silently.
    stubPausableUploadXHR();
    let startRequested = false;
    mockFetch([
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/archives/uploads",
        handler: async () => {
          startRequested = true;
          // Never resolves: the upload stays parked in that window.
          await new Promise(() => {});
          return { body: {} };
        },
      },
      ...archiveUploadRoutes(),
      ...baseRoutes(),
    ]);

    const assign = vi.fn();
    const realLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...realLocation, href: realLocation.href, assign },
    });
    const link = document.createElement("a");
    link.href = "/spaces";
    link.textContent = "Spaces";
    document.body.appendChild(link);

    try {
      const actor = userEvent.setup();
      render(<BackupPanel />);
      await actor.click(screen.getByRole("tab", { name: /import \/ restore/i }));
      await actor.upload(
        document.getElementById("backup-file") as HTMLInputElement,
        new File(["zip-bytes"], "f.zip", { type: "application/zip" }),
      );
      await actor.click(
        importSection().getByRole("button", { name: /^upload and scan$/i }),
      );
      // Fingerprinting is done and the start request is parked: the exact
      // window that used to be unguarded.
      await waitFor(() => expect(startRequested).toBe(true), { timeout: 4000 });

      await actor.click(link);
      expect(
        await screen.findByText(/pause this upload and leave\?/i),
      ).toBeInTheDocument();
    } finally {
      link.remove();
      Object.defineProperty(window, "location", {
        configurable: true,
        value: realLocation,
      });
    }
  });

  it("refuses a Confluence export picked in the restore card, before uploading", async () => {
    // The two cards look alike and both take a `.zip`. Until this check the
    // only thing that noticed was the server's scan - which runs after the
    // whole archive is uploaded, so on a multi-GB export the mistake cost an
    // hour before it was reported.
    stubUploadXHR();
    let uploadStarted = false;
    mockFetch([
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/archives/uploads",
        handler: () => {
          uploadStarted = true;
          return { body: {} };
        },
      },
      ...baseRoutes(),
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);
    await actor.click(screen.getByRole("tab", { name: /import \/ restore/i }));

    const input = document.getElementById("backup-file") as HTMLInputElement;
    await actor.upload(input, confluenceExportZip("Confluence-site-export.zip"));

    await waitFor(
      () =>
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
          expect.stringMatching(/this is a confluence export/i),
        ),
      { timeout: 4000 },
    );
    // The selection is dropped too, so "Restore backup" cannot act on it.
    await waitFor(() => expect(input.files?.length ?? 0).toBe(0));
    expect(uploadStarted).toBe(false);
  });

  it("accepts a real WikiHub backup in the restore card", async () => {
    // The guard must not fire on the archive the card is for - a check that
    // rejects everything would "pass" the test above and break the feature.
    stubUploadXHR();
    mockFetch([...archiveUploadRoutes(), ...baseRoutes()]);

    const actor = userEvent.setup();
    render(<BackupPanel />);
    await actor.click(screen.getByRole("tab", { name: /import \/ restore/i }));

    const input = document.getElementById("backup-file") as HTMLInputElement;
    await actor.upload(input, wikihubBackupZip("wikihub-full-backup.zip"));

    await waitFor(() => expect(input.files?.length ?? 0).toBe(1));
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
    expect(
      importSection().getByRole("button", { name: /^upload and scan$/i }),
    ).toBeEnabled();
  });

  it("refuses a WikiHub backup picked in the Confluence card", async () => {
    stubUploadXHR();
    mockFetch([...baseRoutes()]);

    const actor = userEvent.setup();
    render(<BackupPanel />);
    await actor.click(screen.getByRole("tab", { name: /import \/ restore/i }));

    const input = document.getElementById(
      "confluence-backup-file",
    ) as HTMLInputElement;
    await actor.upload(input, wikihubBackupZip("wikihub-full-backup.zip"));

    await waitFor(
      () =>
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
          expect.stringMatching(/this is a wikihub backup/i),
        ),
      { timeout: 4000 },
    );
    await waitFor(() => expect(input.files?.length ?? 0).toBe(0));
  });

  it("offers one way out - upload another file - when the scan rejects the archive", async () => {
    // The reported screenshot: 24.81 GB uploaded to 100%, the scan refused the
    // archive, and the card answered with "Resume upload" plus "Nothing already
    // uploaded was lost - press Resume upload to carry on from here". Re-sending
    // those bytes cannot change the server's verdict on what is in them, and
    // Cancel beside it made the only useful action a two-step.
    stubUploadXHR();
    let deletedArchive: string | null = null;
    mockFetch([
      {
        method: "DELETE",
        match: (p) => p === "/api/v1/backup/archives/archive-1/upload",
        handler: () => {
          deletedArchive = "archive-1";
          return { body: {} };
        },
      },
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/archives/archive-1/scan",
        handler: () => ({
          status: 400,
          body: {
            error: {
              code: "wrong_archive_format",
              message:
                "This looks like a Confluence export, not a WikiHub backup.",
            },
          },
        }),
      },
      ...archiveUploadRoutes(),
      ...baseRoutes(),
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);
    await actor.click(screen.getByRole("tab", { name: /import \/ restore/i }));
    await actor.upload(
      document.getElementById("backup-file") as HTMLInputElement,
      wikihubBackupZip("looks-fine-locally.zip"),
    );
    await actor.click(
      importSection().getByRole("button", { name: /^upload and scan$/i }),
    );

    expect(
      await screen.findByRole("alert", {}, { timeout: 4000 }),
    ).toHaveTextContent(/confluence export/i);

    const card = importSection();
    const again = card.getByRole("button", { name: /upload another file/i });
    expect(again).toBeEnabled();
    // Neither dead end survives: one is impossible, the other is now implied.
    expect(
      card.queryByRole("button", { name: /resume upload/i }),
    ).not.toBeInTheDocument();
    expect(
      card.queryByRole("button", { name: /^cancel upload$/i }),
    ).not.toBeInTheDocument();
    // And the "nothing was lost, carry on" panel is gone with it.
    expect(screen.queryByText(/carry on from here/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("progressbar", { name: /upload \d+% complete/i }),
    ).not.toBeInTheDocument();

    // The one button also drops the staged parts, so a refused 24 GB archive
    // does not quietly keep occupying object storage.
    await actor.click(again);
    await waitFor(() => expect(deletedArchive).toBe("archive-1"));
    // Releasing them frees the Confluence card too, which previously needed a
    // separate press of Cancel.
    await waitFor(() =>
      expect(
        document.getElementById("confluence-backup-file") as HTMLInputElement,
      ).toBeEnabled(),
    );
  });

  it("still offers a resume when the upload broke rather than the archive", async () => {
    // The distinction this rests on: a 5xx is not a verdict on the file, so
    // the resume path must survive. Collapsing both into "pick another file"
    // would make every hiccup cost a full re-upload.
    stubUploadXHR();
    mockFetch([
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/archives/archive-1/scan",
        handler: () => ({
          status: 503,
          body: { error: { code: "unavailable", message: "Scan unavailable." } },
        }),
      },
      ...archiveUploadRoutes(),
      ...baseRoutes(),
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);
    await actor.click(screen.getByRole("tab", { name: /import \/ restore/i }));
    await actor.upload(
      document.getElementById("backup-file") as HTMLInputElement,
      wikihubBackupZip("f.zip"),
    );
    await actor.click(
      importSection().getByRole("button", { name: /^upload and scan$/i }),
    );

    expect(
      await screen.findByRole("alert", {}, { timeout: 4000 }),
    ).toHaveTextContent(/scan unavailable/i);
    const card = importSection();
    expect(card.getByRole("button", { name: /resume upload/i })).toBeEnabled();
    expect(
      card.queryByRole("button", { name: /choose a different file/i }),
    ).not.toBeInTheDocument();
  });

  it("resumes an interrupted upload instead of re-sending parts already in storage", async () => {
    // The point of fingerprint-matching a partial upload: a multi-GB archive
    // whose upload was interrupted continues from where it stopped. The
    // server reports the parts it already holds; none of them may be re-PUT.
    stubUploadXHR();
    const partSize = 8 * 1024 * 1024;
    const partsRequested: number[][] = [];
    mockFetch([
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/archives/uploads",
        handler: () => ({
          body: {
            archive_id: "archive-1",
            object_key: "backups/imports/archive-1/f.zip",
            max_size_bytes: 999_999_999,
            part_size_bytes: partSize,
            // Parts 1 and 2 survived the earlier attempt.
            uploaded_parts: [1, 2],
            status: "uploading",
            sha256: "a".repeat(64),
            reused: false,
          },
        }),
      },
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/archives/archive-1/upload-parts",
        handler: (init) => {
          partsRequested.push(JSON.parse(String(init?.body)).part_numbers);
          return {
            body: {
              urls: {
                "3": "http://localhost/api/v1/storage/object?key=x&upload_id=y&part_number=3",
              },
            },
          };
        },
      },
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/archives/archive-1/complete-upload",
        handler: () => ({ body: { id: "archive-1", status: "uploaded" } }),
      },
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/archives/archive-1/scan",
        handler: () => ({
          body: {
            id: "archive-1",
            filename: "f.zip",
            size_bytes: partSize * 3,
            sha256: "a".repeat(64),
            status: "scanned",
            error: null,
            spaces: [{ key: "ENG", name: "Engineering" }],
          },
        }),
      },
      ...baseRoutes(),
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);
    await actor.click(screen.getByRole("tab", { name: /import \/ restore/i }));

    const fileInput = document.getElementById(
      "backup-file",
    ) as HTMLInputElement;
    // Three parts' worth of bytes, two of which the server already has.
    await actor.upload(
      fileInput,
      new File([new Uint8Array(partSize * 2 + 10)], "f.zip", {
        type: "application/zip",
      }),
    );
    await actor.click(
      importSection().getByRole("button", { name: /^upload and scan$/i }),
    );

    // The scan opens the picker itself.
    await screen.findByRole(
      "button",
      { name: /^start restore$/i },
      { timeout: 4000 },
    );
    // Only the missing part was ever asked for.
    expect(partsRequested).toEqual([[3]]);
  });

  it("keeps the uploaded parts when an upload is paused, and discards them on cancel", async () => {
    stubUploadXHR();
    let releaseParts: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseParts = resolve;
    });
    let deleteCalled = false;
    mockFetch([
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/archives/archive-1/upload-parts",
        handler: async () => {
          await gate;
          return {
            body: {
              urls: {
                "1": "http://localhost/api/v1/storage/object?key=x&upload_id=y&part_number=1",
              },
            },
          };
        },
      },
      {
        method: "DELETE",
        match: (p) => p === "/api/v1/backup/archives/archive-1/upload",
        handler: () => {
          deleteCalled = true;
          return { body: {} };
        },
      },
      ...archiveUploadRoutes(),
      ...baseRoutes(),
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);
    await actor.click(screen.getByRole("tab", { name: /import \/ restore/i }));
    const fileInput = document.getElementById(
      "backup-file",
    ) as HTMLInputElement;
    await actor.upload(
      fileInput,
      new File(["zip-bytes"], "f.zip", { type: "application/zip" }),
    );
    await actor.click(
      importSection().getByRole("button", { name: /^upload and scan$/i }),
    );

    // Pause is non-destructive: no DELETE, the file stays selected, and the
    // button turns into "Resume upload" so the parts already sent are reused.
    await actor.click(
      await importSection().findByRole("button", { name: /^pause upload$/i }),
    );
    expect(deleteCalled).toBe(false);
    expect(fileInput.value).not.toBe("");
    expect(
      await importSection().findByRole("button", { name: /^resume upload$/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/upload paused/i)).toBeInTheDocument();
    releaseParts?.();
  });

  it("requires confirmation before cancelling an in-progress archive upload", async () => {
    stubUploadXHR();
    let releaseUploadParts: (() => void) | undefined;
    const uploadPartsGate = new Promise<void>((resolve) => {
      releaseUploadParts = resolve;
    });
    let deleteCalled = false;
    mockFetch([
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/archives/uploads",
        handler: () => ({
          body: {
            archive_id: "archive-1",
            object_key: "backups/imports/archive-1/f.zip",
            max_size_bytes: 999_999_999,
            part_size_bytes: 8 * 1024 * 1024,
            uploaded_parts: [],
            status: "uploading",
            sha256: null,
            reused: false,
          },
        }),
      },
      {
        // Held open until released below, so the "Cancel upload" button
        // stays visible (mid-upload) long enough to click it.
        method: "POST",
        match: (p) => p === "/api/v1/backup/archives/archive-1/upload-parts",
        handler: async () => {
          await uploadPartsGate;
          return {
            body: {
              urls: {
                "1": "http://localhost/api/v1/storage/object?key=x&upload_id=y&part_number=1",
              },
            },
          };
        },
      },
      {
        method: "DELETE",
        match: (p) => p === "/api/v1/backup/archives/archive-1/upload",
        handler: () => {
          deleteCalled = true;
          return { body: {} };
        },
      },
      ...baseRoutes(),
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);

    await actor.click(screen.getByRole("tab", { name: /import \/ restore/i }));
    const fileInput = document.getElementById(
      "backup-file",
    ) as HTMLInputElement;
    await actor.upload(
      fileInput,
      new File(["zip-bytes"], "backup.zip", { type: "application/zip" }),
    );
    await actor.click(
      importSection().getByRole("button", { name: /^upload and scan$/i }),
    );

    const cancelButton = await importSection().findByRole("button", {
      name: /^cancel upload$/i,
    });
    await actor.click(cancelButton);

    // A misclick must not lose progress: a confirm dialog gates it, and
    // dismissing that dialog leaves the upload running untouched.
    await screen.findByRole("heading", { name: /cancel this upload\?/i });
    await actor.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(
      screen.queryByRole("heading", { name: /cancel this upload\?/i }),
    ).not.toBeInTheDocument();
    expect(deleteCalled).toBe(false);
    expect(
      importSection().getByRole("button", { name: /^cancel upload$/i }),
    ).toBeInTheDocument();

    // Confirming it actually cancels: the archive is deleted server-side and
    // the file selection is cleared.
    await actor.click(cancelButton);
    await screen.findByRole("heading", { name: /cancel this upload\?/i });
    const dialog = within(screen.getByRole("alertdialog"));
    await actor.click(dialog.getByRole("button", { name: /^cancel upload$/i }));
    releaseUploadParts?.();

    await waitFor(() => expect(deleteCalled).toBe(true));
    expect(fileInput.value).toBe("");
    expect(
      screen.queryByRole("heading", { name: /cancel this upload\?/i }),
    ).not.toBeInTheDocument();
  });

  it("recognizes an already-uploaded archive by its fingerprint instead of re-uploading it", async () => {
    // The server reports `reused: true` when a byte-identical archive is
    // already in storage (`BackupArchiveService.find_reusable_archive`,
    // matched by the sha256 "Upload and scan" now sends). No upload-part PUT
    // should ever fire in that case - only start, then straight to scan.
    stubUploadXHR();
    let uploadPartsCalled = false;
    mockFetch([
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/archives/uploads",
        handler: () => ({
          body: {
            archive_id: "archive-1",
            object_key: "backups/imports/archive-1/f.zip",
            max_size_bytes: 999_999_999,
            part_size_bytes: 8 * 1024 * 1024,
            uploaded_parts: [],
            status: "uploaded",
            sha256: "a".repeat(64),
            reused: true,
          },
        }),
      },
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/archives/archive-1/upload-parts",
        handler: () => {
          uploadPartsCalled = true;
          return { body: { urls: {} } };
        },
      },
      ...archiveUploadRoutes(),
      ...baseRoutes(),
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);

    await actor.click(screen.getByRole("tab", { name: /import \/ restore/i }));
    const fileInput = document.getElementById(
      "backup-file",
    ) as HTMLInputElement;
    await actor.upload(
      fileInput,
      new File(["zip-bytes"], "backup.zip", { type: "application/zip" }),
    );
    await actor.click(
      importSection().getByRole("button", { name: /^upload and scan$/i }),
    );

    expect(
      await screen.findByText(/2 spaces found\. choose which spaces/i),
    ).toBeInTheDocument();
    expect(uploadPartsCalled).toBe(false);
  });

  it("shows a scope picker only for .zip uploads, sourced from the archive's own scan", async () => {
    stubUploadXHR();
    mockFetch([...archiveUploadRoutes(), ...baseRoutes()]);
    const actor = userEvent.setup();
    render(<BackupPanel />);

    await actor.click(screen.getByRole("tab", { name: /import \/ restore/i }));
    const fileInput = document.getElementById(
      "backup-file",
    ) as HTMLInputElement;

    // A .json restore has no scope picker (and no "Upload and scan" step)
    // at all.
    await actor.upload(
      fileInput,
      new File(["{}"], "backup.json", { type: "application/json" }),
    );
    expect(
      screen.queryByRole("button", { name: /select spaces & restore/i }),
    ).not.toBeInTheDocument();
    expect(
      importSection().queryByRole("button", { name: /upload and scan/i }),
    ).not.toBeInTheDocument();

    await actor.upload(
      fileInput,
      new File(["zip-bytes"], "backup.zip", { type: "application/zip" }),
    );
    // Before the archive is uploaded and scanned there is no "ready to
    // restore" bar yet - just the "Upload and scan" action.
    expect(
      screen.queryByRole("button", { name: /select spaces & restore/i }),
    ).not.toBeInTheDocument();
    await actor.click(
      importSection().getByRole("button", { name: /^upload and scan$/i }),
    );
    // The picker opens on its own; its rows are instant, already in memory
    // from the scan rather than a second read of the file.
    await screen.findByRole("button", { name: /^start restore$/i }, { timeout: 4000 });
    expect(await screen.findByText("Engineering")).toBeInTheDocument();
    expect(screen.getByText("Sales")).toBeInTheDocument();
  });

  it("restores only the selected spaces once chosen", async () => {
    stubUploadXHR();
    const jobsPosted: unknown[] = [];
    mockFetch([
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/archives/archive-1/jobs",
        handler: (init) => {
          const payload = JSON.parse(String(init?.body));
          jobsPosted.push(payload);
          return {
            body: {
              id: "job-1",
              kind: "full_import",
              status: "queued",
              phase: "queued",
              output_filename: null,
              download_url: null,
              error: null,
              space_keys: payload.space_keys,
            },
          };
        },
      },
      ...archiveUploadRoutes(),
      ...baseRoutes(),
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);

    await actor.click(screen.getByRole("tab", { name: /import \/ restore/i }));
    const fileInput = document.getElementById(
      "backup-file",
    ) as HTMLInputElement;
    await actor.upload(
      fileInput,
      new File(["zip-bytes"], "backup.zip", { type: "application/zip" }),
    );
    await actor.click(
      importSection().getByRole("button", { name: /^upload and scan$/i }),
    );

    await actor.click(
      await screen.findByRole(
        "checkbox",
        { name: /Engineering/ },
        { timeout: 4000 },
      ),
    );

    // The picker starts the restore itself, the way the Confluence one starts
    // the import - it used to only close, leaving a second button to find.
    const start = screen.getByRole("button", { name: /^start restore$/i });
    expect(start).not.toBeDisabled();
    await actor.click(start);

    await waitFor(() => expect(jobsPosted).toHaveLength(1));
    expect(jobsPosted[0]).toMatchObject({ space_keys: ["ENG"] });
  });

  it("narrates the upload half in the same card, which no job row ever records", async () => {
    // Fingerprinting, the resume decision, the parts and the scan all happen
    // in this browser before a restore job exists. Without these lines the
    // card is a bare progress bar for the entire multi-GB upload, while the
    // Confluence card beside it explains itself the whole way.
    stubUploadXHR();
    mockFetch([...archiveUploadRoutes(), ...baseRoutes()]);

    const actor = userEvent.setup();
    render(<BackupPanel />);
    await actor.click(screen.getByRole("tab", { name: /import \/ restore/i }));

    const fileInput = document.getElementById(
      "backup-file",
    ) as HTMLInputElement;
    await actor.upload(
      fileInput,
      new File(["zip-bytes"], "wikihub-full-backup.zip", {
        type: "application/zip",
      }),
    );
    await actor.click(
      importSection().getByRole("button", { name: /^upload and scan$/i }),
    );

    // The picker opening is the end of the preparation story.
    await screen.findByRole("button", { name: /^select all$/i }, { timeout: 4000 });

    const list = (await screen.findByText(/restore logs/i)).closest(
      "details",
    ) as HTMLElement;
    // Read as DOM rather than by role: the space picker is open on top by
    // now, and Radix marks everything behind it `aria-hidden`.
    const lines = Array.from(list.querySelectorAll("li"));
    // Oldest first, newest last - the order the work actually happened in.
    expect(lines.map((line) => line.textContent?.toLowerCase() ?? "")).toEqual([
      expect.stringContaining("selected wikihub-full-backup.zip"),
      expect.stringContaining("calculating archive fingerprint"),
      expect.stringContaining("archive fingerprint ready"),
      expect.stringContaining("uploading 1 part"),
      expect.stringContaining("upload finished"),
      expect.stringContaining("multipart upload completed"),
      expect.stringContaining("scanning the archive"),
      expect.stringContaining("2 spaces ready to restore"),
    ]);
  });

  it("keeps the worker's account in the same card, and picks it back up after a remount", async () => {
    // `phase` and `counters` are overwritten on every checkpoint, so a
    // percentage cannot distinguish steady work from a wedged worker. These
    // lines come from the server, which is what makes them survive a refresh
    // - the point at which a purely local log would be gone.
    mockFetch([
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/jobs",
        handler: () => ({
          body: [{
            id: "job-9",
            kind: "full_import",
            status: "running",
            phase: "restoring",
            output_filename: null,
            download_url: null,
            error: null,
            space_keys: [],
            counters: { items_processed: 5, items_total: 10 },
          }],
        }),
      },
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/jobs/job-9/logs",
        handler: () => ({
          body: {
            items: [
              {
                id: "log-2",
                created_at: "2026-08-26T12:00:01Z",
                level: "warning",
                phase: "restoring",
                entity_type: null,
                entity_label: null,
                message: "Replacing 1 existing space: ENG.",
              },
              {
                id: "log-1",
                created_at: "2026-08-26T12:00:00Z",
                level: "info",
                phase: "restoring",
                entity_type: "archive",
                entity_label: "backup.zip",
                message: "Archive verified: 2 spaces, 40 pages.",
              },
            ],
            next_offset: null,
          },
        }),
      },
      ...baseRoutes(),
    ]);

    render(<BackupPanel />);

    // One card, whoever wrote the lines - literally: while the restore is
    // still running, its log lives inside the same `role="status"` job card
    // as the progress bar, the same layout Confluence import already uses
    // for its own "Import activity", not a second box underneath it.
    const panel = (
      await screen.findByText(/restore logs/i, {}, { timeout: 4000 })
    ).closest("details") as HTMLElement;
    expect(screen.queryByText(/restore activity/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/preparation logs/i)).not.toBeInTheDocument();
    expect(panel.closest('[role="status"]')).not.toBeNull();

    const lines = within(panel).getAllByRole("listitem");
    // Oldest first: the endpoint sorts newest-first so paging returns the
    // interesting end of a long run, but a log only reads as a story forwards.
    expect(lines[0]).toHaveTextContent(/archive verified/i);
    expect(lines[1]).toHaveTextContent(/replacing 1 existing space/i);
    // The entity is named separately from the prose, so it can be read at a
    // glance rather than parsed out of the sentence.
    expect(lines[0]).toHaveTextContent(/backup\.zip:/);
    // Every line names its level - same convention Confluence import's own
    // activity log already used, now the one shared row format for both.
    expect(lines[0]).toHaveTextContent(/info/i);
    expect(lines[1]).toHaveTextContent(/warning/i);
  });

  it("asks before restoring when the scan already flags a conflict, same as Confluence import", async () => {
    // The archive's own scan already knows which spaces exist (`conflict`
    // per space, the "Existed" badge in the picker) - so a restore that
    // includes one should ask before it runs, not skip it silently and only
    // offer to fix that up afterwards. Only one job should ever be posted:
    // the confirmed one, straight away with `overwrite_space_keys` set.
    stubUploadXHR();
    const jobsPosted: { space_keys: string[]; overwrite_space_keys: string[] }[] =
      [];
    mockFetch([
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/archives/archive-1/jobs",
        handler: (init) => {
          const payload = JSON.parse(String(init?.body));
          jobsPosted.push(payload);
          return {
            body: {
              id: "job-1", kind: "full_import", status: "queued", phase: "queued",
              output_filename: null, download_url: null, error: null,
              space_keys: payload.space_keys,
            },
          };
        },
      },
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/jobs/job-1",
        handler: () => ({
          body: {
            id: "job-1", kind: "full_import", status: "complete", phase: "complete",
            output_filename: null, download_url: null, error: null, space_keys: [],
            result: {
              dry_run: false, includes_credentials: false, created: { space: 1 },
              skipped: {}, errors: {}, users_without_password: [],
              entries: [], entries_truncated: false, conflicting_space_keys: [],
            },
          },
        }),
      },
      ...archiveUploadRoutes("archive-1", [
        { key: "ENG", name: "Engineering", page_count: 2, conflict: true },
        { key: "SALES", name: "Sales", page_count: 1, conflict: false },
      ]),
      ...baseRoutes(),
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);

    await actor.click(screen.getByRole("tab", { name: /import \/ restore/i }));
    const fileInput = document.getElementById(
      "backup-file",
    ) as HTMLInputElement;
    await actor.upload(
      fileInput,
      new File(["zip-bytes"], "backup.zip", { type: "application/zip" }),
    );
    await actor.click(
      importSection().getByRole("button", { name: /^upload and scan$/i }),
    );
    await actor.click(
      await screen.findByRole(
        "button",
        { name: /^select all$/i },
        { timeout: 4000 },
      ),
    );
    await actor.click(screen.getByRole("button", { name: /^start restore$/i }));

    // Before any job is posted - the scan already knew. The picker is still
    // open behind it (same as Confluence's own pre-flight prompt), so "ENG"
    // is scoped to the confirm dialog rather than matched anywhere on screen.
    const confirmDialog = await screen.findByRole("alertdialog", {
      name: /replace existing spaces/i,
    });
    expect(within(confirmDialog).getByText(/ENG/)).toBeInTheDocument();
    expect(jobsPosted).toHaveLength(0);

    await actor.click(
      within(confirmDialog).getByRole("button", { name: /^replace and restore$/i }),
    );

    await waitFor(() => expect(jobsPosted).toHaveLength(1));
    expect(jobsPosted[0].overwrite_space_keys).toEqual(["ENG"]);
    // The picker closes along with the confirm dialog - it must not be left
    // stranded open behind the job card that replaces it.
    expect(
      screen.queryByRole("heading", { name: /select spaces to restore/i }),
    ).not.toBeInTheDocument();

    expect(
      await screen.findByRole(
        "heading",
        { name: /restore completed successfully/i },
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
  });

  it(
    "offers to overwrite spaces the restore reports as already existing",
    async () => {
    stubUploadXHR();
    const jobsPosted: { space_keys: string[]; overwrite_space_keys: string[] }[] =
      [];
    mockFetch([
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/archives/archive-1/jobs",
        handler: (init) => {
          const payload = JSON.parse(String(init?.body));
          jobsPosted.push(payload);
          const overwriting = payload.overwrite_space_keys.length > 0;
          return {
            body: {
              id: overwriting ? "job-2" : "job-1",
              kind: "full_import",
              status: "queued",
              phase: "queued",
              output_filename: null,
              download_url: null,
              error: null,
              space_keys: payload.space_keys,
            },
          };
        },
      },
      // Two different jobs get created (initial attempt, then the retry with
      // overwrite_space_keys set) - each polled to completion at its own id.
      // Listed before baseRoutes()'s wildcard GET, same reasoning as above.
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/jobs/job-1",
        handler: () => ({
          body: {
            id: "job-1",
            kind: "full_import",
            status: "complete",
            phase: "complete",
            output_filename: null,
            download_url: null,
            error: null,
            space_keys: [],
            result: {
              dry_run: false,
              includes_credentials: false,
              created: {},
              skipped: { space: 1 },
              errors: {},
              users_without_password: [],
              entries: [],
              entries_truncated: false,
              conflicting_space_keys: ["ENG"],
            },
          },
        }),
      },
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/jobs/job-2",
        handler: () => ({
          body: {
            id: "job-2",
            kind: "full_import",
            status: "complete",
            phase: "complete",
            output_filename: null,
            download_url: null,
            error: null,
            space_keys: [],
            result: {
              dry_run: false,
              includes_credentials: false,
              created: { space: 1 },
              skipped: {},
              errors: {},
              users_without_password: [],
              entries: [],
              entries_truncated: false,
              conflicting_space_keys: [],
            },
          },
        }),
      },
      ...archiveUploadRoutes(),
      ...baseRoutes(),
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);

    await actor.click(screen.getByRole("tab", { name: /import \/ restore/i }));
    const fileInput = document.getElementById(
      "backup-file",
    ) as HTMLInputElement;
    await actor.upload(
      fileInput,
      new File(["zip-bytes"], "backup.zip", { type: "application/zip" }),
    );
    await actor.click(
      importSection().getByRole("button", { name: /^upload and scan$/i }),
    );
    // The scan opens the picker; restore everything from there.
    await actor.click(
      await screen.findByRole(
        "button",
        { name: /^select all$/i },
        { timeout: 4000 },
      ),
    );
    await actor.click(screen.getByRole("button", { name: /^start restore$/i }));

    // The conflict only surfaces once the job (polled every 1500ms) reports
    // "complete" - a real interval, not a mocked one, per this suite's
    // existing convention (see the export-completion test above).
    //
    // Every finished restore lands in the same place: the completion dialog.
    // The destructive "Replace existing spaces?" prompt used to open by
    // itself the instant the job finished, which asks the most dangerous
    // question available at the moment attention is lowest. It is an offer
    // inside the completion dialog now, and has to be taken deliberately.
    expect(
      await screen.findByRole(
        "heading",
        { name: /restore completed successfully/i },
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /replace existing spaces/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/ENG/)).toBeInTheDocument();

    await actor.click(
      screen.getByRole("button", { name: /replace them with the archive/i }),
    );
    expect(
      await screen.findByRole("heading", {
        name: /replace existing spaces/i,
      }),
    ).toBeInTheDocument();

    await actor.click(
      screen.getByRole("button", { name: /^replace and restore$/i }),
    );

    // The retry reuses the archive already uploaded for the first attempt -
    // no second upload, straight to a new job.
    await waitFor(() => expect(jobsPosted).toHaveLength(2));
    expect(jobsPosted[0].overwrite_space_keys).toEqual([]);
    expect(jobsPosted[1].overwrite_space_keys).toEqual(["ENG"]);

    await waitFor(
      () =>
        expect(
          screen.queryByRole("heading", { name: /replace existing spaces/i }),
        ).not.toBeInTheDocument(),
      { timeout: 4000 },
    );

    // The retry's own completion (job-2, `conflicting_space_keys: []`) lands
    // in the same completion dialog - but it must not still be showing the
    // *first* job's now-stale conflict. Left unfixed, "Replace them" stays
    // on screen forever even though there is nothing left to replace.
    expect(
      await screen.findByRole(
        "heading",
        { name: /restore completed successfully/i },
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /replace them with the archive/i,
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/ENG/)).not.toBeInTheDocument();
    },
    // Two full jobs, each polled on the real 1500ms interval (not a mocked
    // one, per this suite's convention), plus several `findByRole` waits in
    // between - comfortably over vitest's 5000ms default once the page has
    // much else mounted, so this one test gets a longer allowance rather
    // than the whole suite trading real timers for fake ones.
    15000,
  );
});

describe("BackupPanel automatic backups", () => {
  function automaticSettingsRoute(overrides: Record<string, unknown> = {}) {
    return {
      method: "GET",
      match: (p: string) => p === "/api/v1/backup/automatic",
      handler: () => ({
        body: {
          enabled: false,
          interval_unit: "days",
          interval_value: 1,
          time_of_day: "02:00",
          timezone: "UTC",
          retention_count: 30,
          subdirectory: null,
          directory_configured: true,
          base_directory: "/backups",
          directory: "/backups",
          last_run_at: null,
          next_run_at: null,
          last_status: null,
          last_error: null,
          ...overrides,
        },
      }),
    };
  }

  function automaticJobsRoute() {
    return {
      method: "GET",
      match: (p: string) => p === "/api/v1/backup/automatic/jobs",
      handler: () => ({ body: [] }),
    };
  }

  /** Scoped to the panel itself - the export cards below it use some of the
   * same words ("Storage", directory paths), and this section is visible
   * alongside them on the default tab. */
  function automaticSection() {
    return within(
      document.getElementById("automatic-backups-section") as HTMLElement,
    );
  }

  it("shows no directory-missing banner when a volume is mounted", async () => {
    mockFetch([automaticSettingsRoute(), automaticJobsRoute(), ...baseRoutes()]);

    render(<BackupPanel />);

    const section = automaticSection();
    await section.findByRole("button", { name: /^edit$/i });
    expect(
      section.queryByText(/no backup directory is available/i),
    ).not.toBeInTheDocument();
  });

  it("shows the danger banner instead when no backup volume is mounted at all", async () => {
    mockFetch([
      automaticSettingsRoute({
        directory_configured: false,
        base_directory: null,
        directory: null,
      }),
      automaticJobsRoute(),
      ...baseRoutes(),
    ]);

    render(<BackupPanel />);

    const section = automaticSection();
    expect(
      await section.findByText(/no backup directory is available/i),
    ).toBeInTheDocument();
  });

  it("keeps the schedule read-only until Edit is pressed", async () => {
    mockFetch([automaticSettingsRoute(), automaticJobsRoute(), ...baseRoutes()]);

    render(<BackupPanel />);

    const section = automaticSection();
    await section.findByRole("button", { name: /^edit$/i });
    expect(section.getByLabelText(/^every$/i)).toBeDisabled();
    expect(section.getByLabelText(/keep successful backups/i)).toBeDisabled();
    expect(
      section.queryByRole("button", { name: /^save schedule$/i }),
    ).not.toBeInTheDocument();
  });

  it("unlocks the fields on Edit, saves the change, and locks again", async () => {
    // A scroll-wheel nudge on a number field or a stray click while skimming
    // the schedule must not silently change a live schedule - editing takes
    // a deliberate Edit click, and Save both persists and re-locks it.
    const patches: Record<string, unknown>[] = [];
    mockFetch([
      automaticSettingsRoute(),
      automaticJobsRoute(),
      {
        method: "PATCH",
        match: (p) => p === "/api/v1/backup/automatic",
        handler: (init) => {
          patches.push(JSON.parse(String(init?.body)));
          return {
            body: {
              enabled: false,
              interval_unit: "days",
              interval_value: 1,
              time_of_day: "02:00",
              timezone: "UTC",
              retention_count: 45,
              subdirectory: null,
              directory_configured: true,
              base_directory: "/backups",
              directory: "/backups",
              last_run_at: null,
              next_run_at: null,
              last_status: null,
              last_error: null,
            },
          };
        },
      },
      ...baseRoutes(),
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);

    const section = automaticSection();
    await actor.click(await section.findByRole("button", { name: /^edit$/i }));

    const retention = section.getByLabelText(/keep successful backups/i);
    expect(retention).toBeEnabled();
    // A plain change event, not clear()-then-type(): real browsers refuse
    // setSelectionRange on type="number" inputs (an InvalidStateError), so
    // userEvent has no reliable way to select and overwrite one's text -
    // and clear()-then-type() has its own problem here regardless, since
    // the field's own onChange falls back to 1 on an empty value (so it can
    // never sit at NaN mid-edit), which clear() alone would trigger.
    fireEvent.change(retention, { target: { value: "45" } });
    await actor.click(
      section.getByRole("button", { name: /^save schedule$/i }),
    );

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].retention_count).toBe(45);
    await section.findByRole("button", { name: /^edit$/i });
    expect(section.getByLabelText(/keep successful backups/i)).toBeDisabled();
  });

  it("picks a timezone from the searchable list and saves it", async () => {
    // 400+ IANA zones is too many for a plain <Select> to browse
    // meaningfully - this is a combobox: a trigger button that opens a
    // search box over the filtered list, not a native <select>.
    const patches: Record<string, unknown>[] = [];
    mockFetch([
      automaticSettingsRoute({ timezone: "UTC" }),
      automaticJobsRoute(),
      {
        method: "PATCH",
        match: (p) => p === "/api/v1/backup/automatic",
        handler: (init) => {
          patches.push(JSON.parse(String(init?.body)));
          return automaticSettingsRoute({ timezone: "Asia/Bangkok" }).handler();
        },
      },
      ...baseRoutes(),
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);

    const section = automaticSection();
    await actor.click(await section.findByRole("button", { name: /^edit$/i }));

    const timezoneTrigger = section.getByLabelText(/^timezone$/i);
    expect(timezoneTrigger).toHaveTextContent("UTC");
    await actor.click(timezoneTrigger);

    const search = await screen.findByRole("searchbox", { name: /search time zones/i });
    await actor.type(search, "bangkok");
    await actor.click(await screen.findByText("Asia/Bangkok"));

    expect(timezoneTrigger).toHaveTextContent("Asia/Bangkok");
    await actor.click(
      section.getByRole("button", { name: /^save schedule$/i }),
    );

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].timezone).toBe("Asia/Bangkok");
  });

  it("keeps a saved legacy timezone alias selectable even though it is not canonical", async () => {
    // Intl.supportedValuesOf("timeZone") returns only canonical zone ids -
    // "Asia/Ho_Chi_Minh" resolves to the same zone as the canonical
    // "Asia/Saigon" but is not itself in that list. A schedule already
    // saved under that name must not appear to have lost its timezone the
    // moment this combobox renders it.
    mockFetch([
      automaticSettingsRoute({ timezone: "Asia/Ho_Chi_Minh" }),
      automaticJobsRoute(),
      ...baseRoutes(),
    ]);

    render(<BackupPanel />);

    const section = automaticSection();
    const timezoneTrigger = await section.findByLabelText(/^timezone$/i);
    expect(timezoneTrigger).toHaveTextContent("Asia/Ho Chi Minh (UTC+7)");
  });

  it("Cancel discards the edit and locks the fields again without saving", async () => {
    const patches: Record<string, unknown>[] = [];
    mockFetch([
      automaticSettingsRoute(),
      automaticJobsRoute(),
      {
        method: "PATCH",
        match: (p) => p === "/api/v1/backup/automatic",
        handler: (init) => {
          patches.push(JSON.parse(String(init?.body)));
          return automaticSettingsRoute().handler();
        },
      },
      ...baseRoutes(),
    ]);

    const actor = userEvent.setup();
    render(<BackupPanel />);

    const section = automaticSection();
    await actor.click(await section.findByRole("button", { name: /^edit$/i }));
    const retention = section.getByLabelText(/keep successful backups/i);
    fireEvent.change(retention, { target: { value: "99" } });
    await actor.click(section.getByRole("button", { name: /^cancel$/i }));

    await section.findByRole("button", { name: /^edit$/i });
    expect(section.getByLabelText(/keep successful backups/i)).toBeDisabled();
    expect(section.getByLabelText(/keep successful backups/i)).toHaveValue(30);
    expect(patches).toHaveLength(0);
  });

  it("shows an empty state instead of a bare table when no scheduled backup has run yet", async () => {
    mockFetch([
      automaticSettingsRoute(),
      automaticJobsRoute(),
      ...baseRoutes(),
    ]);

    render(<BackupPanel />);

    expect(
      await automaticSection().findByText(
        /no scheduled backups have run yet/i,
      ),
    ).toBeInTheDocument();
  });

  it("shows how long a finished backup took in its own history column", async () => {
    mockFetch([
      automaticSettingsRoute(),
      {
        method: "GET",
        match: (p: string) => p === "/api/v1/backup/automatic/jobs",
        handler: () => ({
          body: [
            {
              id: "job-1",
              status: "complete",
              output_filename: "wikihub-auto-backup-20260906.zip",
              download_url: "/api/v1/backup/automatic/jobs/job-1/download",
              // 2 min 5 sec apart.
              started_at: "2026-09-06T08:00:00Z",
              updated_at: "2026-09-06T08:02:05Z",
              created_at: "2026-09-06T08:00:00Z",
            },
          ],
        }),
      },
      ...baseRoutes(),
    ]);

    render(<BackupPanel />);

    const section = automaticSection();
    expect(
      await section.findByText("wikihub-auto-backup-20260906.zip"),
    ).toBeInTheDocument();
    expect(section.getByText("2m 5s")).toBeInTheDocument();
  });

  it(
    "keeps polling while a scheduled run is queued or running, and stops once it settles",
    async () => {
      // A scheduled run starts on its own cron tick, not from anything
      // clicked on this page - without polling, whoever has the tab open
      // would only ever see whatever status happened to be current on the
      // last manual reload, reading as the job being stuck.
      let settingsCalls = 0;
      const spy = mockFetch([
        {
          method: "GET",
          match: (p: string) => p === "/api/v1/backup/automatic",
          handler: () => {
            settingsCalls += 1;
            return automaticSettingsRoute({
              last_status: settingsCalls < 2 ? "running" : "complete",
            }).handler();
          },
        },
        automaticJobsRoute(),
        ...baseRoutes(),
      ]);

      render(<BackupPanel />);

      const section = automaticSection();
      await section.findByText("running");
      const callsWhileRunning = settingsCalls;

      // Real timers, on this suite's own convention - the poll fires every
      // 3s, so it must have ticked at least once inside a generous window.
      await waitFor(() => expect(settingsCalls).toBeGreaterThan(callsWhileRunning), {
        timeout: 6000,
      });
      await section.findByText("complete");

      const callsOnceSettled = settingsCalls;
      await new Promise((resolve) => setTimeout(resolve, 3500));
      expect(settingsCalls).toBe(callsOnceSettled);
      void spy;
    },
    10000,
  );
});
