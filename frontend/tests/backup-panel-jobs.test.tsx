import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { BackupPanel, backupFeatures } from "@/components/admin/backup-panel";

import { baseRoutes, mockFetch, type Route } from "./backup-panel-harness";

const refresh = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => {
  window.localStorage.clear();
  refresh.mockReset();
  vi.mocked(toast).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});

afterEach(() => {
  backupFeatures.confluenceExport = false;
  vi.unstubAllGlobals();
});

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

function jobRoutes(job: Record<string, unknown>, next?: Record<string, unknown>, logs: unknown[] = []): Route[] {
  return [
    { method: "GET", match: (p) => p === "/api/v1/backup/jobs", handler: () => ({ body: [job] }) },
    { method: "GET", match: (p) => p === `/api/v1/backup/jobs/${job.id}`, handler: () => ({ body: next ?? job }) },
    {
      method: "GET",
      match: (p) => p === `/api/v1/backup/jobs/${job.id}/logs`,
      handler: () => ({ body: { items: logs } }),
    },
  ];
}

async function openPanel(routes: Route[] = []) {
  mockFetch([...routes, ...baseRoutes()]);
  const user = userEvent.setup();
  render(<BackupPanel />);
  return user;
}

describe("export job card", () => {
  it.each([
    [{ percent: null }, "Exporting backup…", /Running in the background/],
    [{ percent: 40, eta_seconds: 90 }, "Exporting backup…", /40% complete/],
    [{ cancel_requested: true }, "Cancelling export…", /stops at its next checkpoint/],
    [{ status: "failed", error: "Disk full." }, "Export failed", /Disk full\./],
    [{ status: "failed", error: null }, "Export failed", /could not be completed/],
    [{ status: "cancelled" }, "Export was cancelled", /No file was produced/],
  ])("narrates %j", async (overrides, title, subtitle) => {
    // Finished jobs are not restored on load; they are reached by polling a running one.
    const terminal = "status" in overrides && overrides.status !== "running";
    await openPanel(terminal ? jobRoutes(portableJob(), portableJob(overrides)) : jobRoutes(portableJob(overrides)));

    expect(await screen.findByText(title, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(subtitle)).toBeInTheDocument();
  });

  it("offers a finished export for download", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await openPanel(
      jobRoutes(
        portableJob(),
        portableJob({
          status: "complete",
          output_filename: "backup.zip",
          download_url: "/api/v1/backup/jobs/job-1/download",
          percent: 100,
        }),
      ),
    );

    expect(await screen.findByText("Export is ready", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download backup\.zip/ })).toHaveAttribute(
      "href",
      "/api/v1/backup/jobs/job-1/download",
    );
  });

  it.each([
    ["failed", { error: "Out of memory." }, "Out of memory."],
    ["failed", { error: null }, "Backup export failed."],
    ["cancelled", {}, "Export was cancelled."],
  ])("reports an export that polling finds %s", async (status, extra, message) => {
    await openPanel(jobRoutes(portableJob(), portableJob({ status, ...extra })));

    await waitFor(
      () => expect(status === "failed" ? toast.error : toast).toHaveBeenCalledWith(message),
      { timeout: 5000 },
    );
  });

  it("downloads an export that polling finds ready, only once", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await openPanel(
      jobRoutes(
        portableJob(),
        portableJob({ status: "complete", output_filename: "b.zip", download_url: "/d/b.zip" }),
      ),
    );

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Backup export is ready to download."), {
      timeout: 5000,
    });
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("keeps polling when one request fails", async () => {
    let calls = 0;
    await openPanel([
      { method: "GET", match: (p) => p === "/api/v1/backup/jobs", handler: () => ({ body: [portableJob()] }) },
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/jobs/job-1",
        handler: () => {
          calls += 1;
          return calls === 1
            ? { status: 500, body: { error: { code: "x", message: "blip" } } }
            : { body: portableJob({ status: "cancelled" }) };
        },
      },
    ]);

    await waitFor(() => expect(toast).toHaveBeenCalledWith("Export was cancelled."), { timeout: 6000 });
  });

  it("cancels a running export after asking", async () => {
    const user = await openPanel([
      ...jobRoutes(portableJob()),
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/jobs/job-1/cancel",
        handler: () => ({ body: portableJob({ status: "cancelled" }) }),
      },
    ]);

    await user.click(await screen.findByRole("button", { name: "Cancel export" }));
    await user.click(await within(await screen.findByRole("alertdialog")).findByRole("button", { name: /cancel export/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Export cancelled."));
  });

  it("says a cancellation was only requested, and reports one that failed", async () => {
    let attempts = 0;
    const user = await openPanel([
      ...jobRoutes(portableJob()),
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/jobs/job-1/cancel",
        handler: () =>
          attempts++ === 0
            ? { body: portableJob({ cancel_requested: true }) }
            : attempts === 2
              ? { status: 500, body: { error: { code: "x", message: "Worker unreachable." } } }
              : { status: 500, body: "not json" },
      },
    ]);

    await user.click(await screen.findByRole("button", { name: "Cancel export" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /cancel export/i }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Cancellation requested."));
    expect(screen.getByRole("button", { name: "Cancelling…" })).toBeDisabled();
  });

  it("reports a cancellation the server refuses", async () => {
    const user = await openPanel([
      ...jobRoutes(portableJob()),
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/jobs/job-1/cancel",
        handler: () => ({ status: 500, body: { error: { code: "x", message: "Worker unreachable." } } }),
      },
    ]);

    await user.click(await screen.findByRole("button", { name: "Cancel export" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /cancel export/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Worker unreachable."));
  });
});

describe("restore job card", () => {
  const restoreJob = (overrides: Record<string, unknown> = {}) =>
    portableJob({ kind: "full_import", phase: "restoring", archive_id: "archive-1", ...overrides });

  it("shows the archive being downloaded to the worker", async () => {
    await openPanel(
      jobRoutes(
        restoreJob({ phase: "downloading", counters: { items_processed: 1024, items_total: 4096 } }),
        undefined,
        [
          {
            id: "l1",
            created_at: "2026-10-14T08:00:00Z",
            level: "warning",
            phase: "restoring",
            entity_type: null,
            entity_label: "ENG",
            message: "Skipped a page.",
          },
          {
            id: "l2",
            created_at: "2026-10-14T08:00:01Z",
            level: "error",
            phase: "restoring",
            entity_type: null,
            entity_label: null,
            message: "Failed a page.",
          },
        ],
      ),
    );

    expect(await screen.findByText(/Downloading archive: 1\.0 KB \/ 4\.0 KB/)).toBeInTheDocument();
    expect(await screen.findByText(/ENG: Skipped a page\./)).toBeInTheDocument();
    expect(screen.getByText(/Failed a page\./)).toBeInTheDocument();
  });

  it("explains a restore that polling reports as cancelled or failed", async () => {
    await openPanel(jobRoutes(restoreJob(), restoreJob({ status: "failed", error: null })));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Restore failed."), { timeout: 5000 });
  });

  it("explains a restore that polling reports as cancelled", async () => {
    await openPanel(jobRoutes(restoreJob(), restoreJob({ status: "cancelled" })));

    await waitFor(() => expect(toast).toHaveBeenCalledWith("Restore was cancelled."), { timeout: 5000 });
  });

  it("tells which spaces were left alone when a restore finishes", async () => {
    await openPanel(
      jobRoutes(
        restoreJob(),
        restoreJob({
          status: "complete",
          result: { conflicting_space_keys: ["ENG", "OPS"], created: { space: 1 }, skipped: {} },
        }),
      ),
    );

    await waitFor(
      () =>
        expect(toast.success).toHaveBeenCalledWith(
          "Restore is complete. 2 spaces that already existed were skipped.",
        ),
      { timeout: 5000 },
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("says so when nothing was skipped", async () => {
    await openPanel(jobRoutes(restoreJob(), restoreJob({ status: "complete", result: null })));

    await waitFor(
      () => expect(toast.success).toHaveBeenCalledWith("Restore is complete. The backup was applied."),
      { timeout: 5000 },
    );
  });

  it("uses the singular for a single skipped space", async () => {
    await openPanel(
      jobRoutes(
        restoreJob(),
        restoreJob({ status: "complete", result: { conflicting_space_keys: ["ENG"], created: {}, skipped: {} } }),
      ),
    );

    await waitFor(
      () =>
        expect(toast.success).toHaveBeenCalledWith(
          "Restore is complete. 1 space that already existed was skipped.",
        ),
      { timeout: 5000 },
    );
  });
});

describe("starting an export", () => {
  async function exportTab() {
    const user = await openPanel();
    await user.click(screen.getByRole("button", { name: /export wikihub backup/i }));
    return user;
  }

  it("reports an export that could not be queued", async () => {
    const user = await openPanel([
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/jobs",
        handler: () => ({ status: 500, body: { error: { code: "x", message: "Queue is down." } } }),
      },
    ]);
    await user.click(screen.getByRole("button", { name: /export wikihub backup/i }));
    await user.click(screen.getByRole("button", { name: /create backup zip/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Queue is down."));
  });

  it("reports spaces that could not be listed", async () => {
    const user = await openPanel([
      {
        method: "GET",
        match: (p) => p === "/api/v1/spaces",
        handler: () => ({ status: 500, body: { error: { code: "x", message: "Spaces unavailable." } } }),
      },
    ]);
    await user.click(screen.getByRole("button", { name: /export wikihub backup/i }));
    await user.click(screen.getByRole("radio", { name: /select spaces/i }));
    await user.click(screen.getByRole("button", { name: /choose spaces/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it("pages through every space when there are many", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      id: `s${i}`,
      key: `K${i}`,
      name: `Space ${i}`,
      status: "active",
    }));
    const user = await openPanel([
      {
        method: "GET",
        match: (p) => p === "/api/v1/spaces",
        handler: (init) => {
          void init;
          return { body: many };
        },
      },
    ]);
    await user.click(screen.getByRole("button", { name: /export wikihub backup/i }));
    await user.click(screen.getByRole("radio", { name: /select spaces/i }));
    await user.click(screen.getByRole("button", { name: /choose spaces/i }));

    expect(await screen.findByText("Space 0")).toBeInTheDocument();
  });

  it("starts a Confluence export when that is switched on, and refuses it when it is not", async () => {
    backupFeatures.confluenceExport = true;
    const posted: unknown[] = [];
    const user = await openPanel([
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/jobs",
        handler: (init) => {
          posted.push(JSON.parse(String(init?.body)));
          return { body: portableJob({ kind: "confluence_export", status: "queued", phase: "queued" }) };
        },
      },
    ]);

    await user.click(screen.getByRole("button", { name: "Confluence Data Center target version" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Data Center 9.x" }));
    await user.click(screen.getByRole("button", { name: "Export DC XML" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ kind: "confluence_export", space_keys: [] });
    void exportTab;
  });
});
