import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BackupPanel } from "@/components/admin/backup-panel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => vi.unstubAllGlobals());

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
  spaces: { key: string; name: string }[] = [
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

  it("restores directly from a single upload, with no preview or confirm modal", async () => {
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

    // The archive uploads and is scanned first - "Restore backup" only
    // becomes available once that's done, so a huge file is never read a
    // second time just to preview its spaces.
    await actor.click(
      importSection().getByRole("button", { name: /^upload and scan$/i }),
    );
    expect(
      await screen.findByText(/2 spaces found in f\.zip/i),
    ).toBeInTheDocument();

    const importButton = screen.getByRole("button", {
      name: /^restore backup$/i,
    });
    expect(importButton).not.toBeDisabled();
    await actor.click(importButton);

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

    expect(
      await screen.findByText(/restore is complete/i, {}, { timeout: 4000 }),
    ).toBeInTheDocument();

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

    // "Yes, restore another" clears the finished job and the file selection,
    // so the card is ready for the next archive.
    await actor.click(
      screen.getByRole("button", { name: /^yes, restore another$/i }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: /restore completed successfully/i }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(/restore is complete/i)).not.toBeInTheDocument();
    expect(fileInput.value).toBe("");
    // Back to the same state as a fresh mount: no file, so nothing to do yet.
    expect(
      importSection().getByRole("button", { name: /^restore backup$/i }),
    ).toBeDisabled();
    expect(
      screen.queryByText(/spaces found in f\.zip/i),
    ).not.toBeInTheDocument();
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
      await screen.findByText(/2 spaces found in f\.zip/i),
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
      screen.queryByRole("radio", { name: /select spaces/i }),
    ).not.toBeInTheDocument();
    expect(
      importSection().queryByRole("button", { name: /upload and scan/i }),
    ).not.toBeInTheDocument();

    await actor.upload(
      fileInput,
      new File(["zip-bytes"], "backup.zip", { type: "application/zip" }),
    );
    // Before the archive is uploaded and scanned, there's no scope picker
    // yet - just the "Upload and scan" action.
    expect(
      screen.queryByRole("radio", { name: /select spaces/i }),
    ).not.toBeInTheDocument();
    await actor.click(
      importSection().getByRole("button", { name: /^upload and scan$/i }),
    );
    await actor.click(await screen.findByRole("radio", { name: /select spaces/i }));

    expect(
      screen.getByRole("button", { name: /^restore backup$/i }),
    ).toBeDisabled();

    await actor.click(screen.getByRole("button", { name: /choose spaces/i }));

    // Instant - already in memory from the scan, no second read of the file.
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

    await actor.click(await screen.findByRole("radio", { name: /select spaces/i }));
    await actor.click(screen.getByRole("button", { name: /choose spaces/i }));
    await actor.click(await screen.findByRole("checkbox", { name: /Engineering/ }));
    await actor.click(screen.getByRole("button", { name: /^done$/i }));

    const importButton = screen.getByRole("button", {
      name: /^restore backup$/i,
    });
    expect(importButton).not.toBeDisabled();
    await actor.click(importButton);

    await waitFor(() => expect(jobsPosted).toHaveLength(1));
    expect(jobsPosted[0]).toMatchObject({ space_keys: ["ENG"] });
  });

  it("offers to overwrite spaces the restore reports as already existing", async () => {
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
    await screen.findByText(/spaces found in f\.zip/i);
    await actor.click(
      screen.getByRole("button", { name: /^restore backup$/i }),
    );

    // The conflict only surfaces once the job (polled every 1500ms) reports
    // "complete" - a real interval, not a mocked one, per this suite's
    // existing convention (see the export-completion test above).
    expect(
      await screen.findByRole(
        "heading",
        { name: /replace existing spaces/i },
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/ENG/)).toBeInTheDocument();

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
  });
});
