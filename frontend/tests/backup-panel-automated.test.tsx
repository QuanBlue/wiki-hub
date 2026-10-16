import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { BackupPanel } from "@/components/admin/backup-panel";

import { baseRoutes, mockFetch, type Route } from "./backup-panel-harness";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const settings = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
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
});

const job = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  kind: "full_export",
  status: "complete",
  output_filename: `${id}.zip`,
  download_url: `/api/v1/backup/automatic/jobs/${id}/download`,
  started_at: "2026-09-06T08:00:00Z",
  updated_at: "2026-09-06T08:02:00Z",
  created_at: "2026-09-06T08:00:00Z",
  percent: null,
  eta_seconds: null,
  ...overrides,
});

const settingsRoute = (body: Record<string, unknown> | (() => { status?: number; body: unknown })): Route => ({
  method: "GET",
  match: (p) => p === "/api/v1/backup/automatic",
  handler: typeof body === "function" ? body : () => ({ body: settings(body) }),
});

const jobsRoute = (items: unknown[], total = items.length): Route => ({
  method: "GET",
  match: (p) => p === "/api/v1/backup/automatic/jobs",
  handler: () => ({ body: { items, total } }),
});

function section() {
  return within(document.getElementById("automatic-backups-section") as HTMLElement);
}

async function openPanel(routes: Route[]) {
  mockFetch([...routes, ...baseRoutes()]);
  const user = userEvent.setup();
  render(<BackupPanel />);
  return user;
}

describe("automatic backups loading", () => {
  it("explains settings that cannot be loaded", async () => {
    await openPanel([
      settingsRoute(() => ({
        status: 500,
        body: { error: { code: "x", message: "Settings are unavailable." } },
      })),
      jobsRoute([]),
    ]);

    expect(await section().findByText(/Settings are unavailable\./)).toBeInTheDocument();
  });

  it.each([
    [{ status: 500, body: { error: { code: "x", message: "History table is missing." } } }, /history could not load: History table is missing\./],
    // A reply the card cannot read at all, rather than one the server refused.
    [{ status: 200, body: null }, /Schedule loaded, but backup history could not load\./],
  ])("keeps the schedule when only the history cannot be loaded", async (response, message) => {
    await openPanel([
      settingsRoute({}),
      { method: "GET", match: (p) => p === "/api/v1/backup/automatic/jobs", handler: () => response },
    ]);

    expect(await section().findByText(message)).toBeInTheDocument();
    expect(section().getByLabelText(/keep backups/i)).toBeInTheDocument();
  });
});

describe("automatic backups actions", () => {
  it("keeps the form editable and reports why saving failed", async () => {
    const user = await openPanel([
      settingsRoute({}),
      jobsRoute([]),
      {
        method: "PATCH",
        match: (p) => p === "/api/v1/backup/automatic",
        handler: () => ({ status: 400, body: { error: { code: "x", message: "Directory is read-only." } } }),
      },
    ]);
    await section().findByLabelText(/keep backups/i);

    await user.click(section().getByRole("button", { name: /^edit$/i }));
    await user.click(section().getByRole("button", { name: /save schedule/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(section().getByRole("button", { name: /save schedule/i })).toBeInTheDocument();
  });

  it("queues a backup now, and reports one that could not be queued", async () => {
    let attempt = 0;
    const user = await openPanel([
      settingsRoute({}),
      jobsRoute([]),
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/automatic/run",
        handler: () =>
          attempt++ === 0
            ? { body: {} }
            : attempt === 2
              ? { status: 409, body: { error: { code: "x", message: "A backup is already running." } } }
              : { status: 500, body: "plain" },
      },
    ]);
    await section().findByLabelText(/keep backups/i);

    await user.click(section().getByRole("button", { name: /run now/i }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Automatic backup queued."));

    await user.click(section().getByRole("button", { name: /run now/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("A backup is already running."));
  });

  it("reports a bulk delete that failed, and keeps the selection", async () => {
    const user = await openPanel([
      settingsRoute({}),
      jobsRoute([job("job-1"), job("job-2")]),
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/automatic/jobs/bulk-delete",
        handler: () => ({ status: 500, body: { error: { code: "x", message: "Delete failed." } } }),
      },
    ]);
    await section().findByText("job-1.zip");

    await user.click(section().getByRole("checkbox", { name: /select backup job-1\.zip|select job-1/i }));
    expect(section().getByText("1 selected")).toBeInTheDocument();
    await user.click(section().getByRole("button", { name: /delete selected/i }));
    await user.click(await screen.findByRole("button", { name: /^delete backups$/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Delete failed."));
    expect(section().getByText("1 selected")).toBeInTheDocument();

    await user.click(section().getByRole("checkbox", { name: /select backup job-1\.zip|select job-1/i }));
    expect(section().queryByText(/selected$/)).toBeNull();
  });

  it("steps back a page when every backup on a later page is deleted", async () => {
    const pageOne = Array.from({ length: 10 }, (_, i) => job(`first-${i}`));
    const pageTwo = [job("last-1"), job("last-2")];
    const replies = [
      { items: pageOne, total: 12 },
      { items: pageTwo, total: 12 },
      { items: pageOne, total: 10 },
    ];
    let reply = 0;
    const fetchSpy = mockFetch([
      settingsRoute({}),
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/automatic/jobs",
        handler: () => ({ body: replies[Math.min(reply++, replies.length - 1)] }),
      },
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/automatic/jobs/bulk-delete",
        handler: () => ({ body: {} }),
      },
      ...baseRoutes(),
    ]);
    const user = userEvent.setup();
    render(<BackupPanel />);
    await section().findByText("first-0.zip");

    await user.click(section().getByRole("button", { name: /next page/i }));
    await section().findByText("last-1.zip");
    await user.click(section().getByRole("checkbox", { name: /select all backups on this page/i }));
    await user.click(section().getByRole("button", { name: /delete selected/i }));
    await user.click(await screen.findByRole("button", { name: /^delete backups$/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("2 automatic backups deleted."));
    await section().findByText("first-0.zip");
    const urls = fetchSpy.mock.calls.map(([input]) => String(input));
    expect(urls.filter((url) => url.includes("offset=0")).length).toBeGreaterThanOrEqual(2);
  });

  it("reports a scheduled backup that could not be cancelled", async () => {
    const user = await openPanel([
      settingsRoute({}),
      jobsRoute([job("job-run", { status: "running", output_filename: null, download_url: null, percent: 20 })]),
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/jobs/job-run/cancel",
        handler: () => ({ status: 500, body: { error: { code: "x", message: "Worker unreachable." } } }),
      },
    ]);

    await user.click(await section().findByRole("button", { name: /^cancel$/i }));
    await user.click(await screen.findByRole("button", { name: /^cancel backup$/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Worker unreachable."));
  });

  it("falls back to a general message when cancelling fails for no stated reason", async () => {
    const user = await openPanel([
      settingsRoute({}),
      jobsRoute([job("job-run", { status: "running", output_filename: null, download_url: null })]),
      {
        method: "POST",
        match: (p) => p === "/api/v1/backup/jobs/job-run/cancel",
        handler: () => ({ status: 500, body: "plain" }),
      },
    ]);

    await user.click(await section().findByRole("button", { name: /^cancel$/i }));
    await user.click(await screen.findByRole("button", { name: /^cancel backup$/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});

describe("automatic backups schedule form", () => {
  it("shows when the schedule last ran and runs next, and what went wrong", async () => {
    await openPanel([
      settingsRoute({
        last_run_at: "2026-10-13T02:00:00Z",
        next_run_at: "2026-10-14T02:00:00Z",
        last_status: "failed",
        last_error: "Disk was full.",
      }),
      jobsRoute([]),
    ]);

    expect(await section().findByText("Last error: Disk was full.")).toBeInTheDocument();
    expect(section().queryByText("Calculated after saving")).toBeNull();
  });

  it("changes what a schedule runs on, and sends it", async () => {
    const patches: Record<string, unknown>[] = [];
    const user = await openPanel([
      settingsRoute({ enabled: false }),
      jobsRoute([]),
      {
        method: "PATCH",
        match: (p) => p === "/api/v1/backup/automatic",
        handler: (init) => {
          patches.push(JSON.parse(String(init?.body)));
          return { body: settings({ enabled: true, interval_unit: "hours", interval_value: 6 }) };
        },
      },
    ]);
    await section().findByLabelText(/keep backups/i);
    await user.click(section().getByRole("button", { name: /^edit$/i }));

    await user.click(section().getByLabelText("Disabled"));
    fireEvent.change(section().getByLabelText(/^every$/i), { target: { value: "6" } });
    fireEvent.change(section().getByLabelText(/^every$/i), { target: { value: "" } });
    fireEvent.change(section().getByLabelText(/^every$/i), { target: { value: "6" } });
    await user.click(section().getByRole("button", { name: "Interval unit" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Hour" }));
    fireEvent.change(document.getElementById("automated-backup-time") as HTMLInputElement, {
      target: { value: "04:30" },
    });
    await user.click(section().getByRole("button", { name: /save schedule/i }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toMatchObject({
      enabled: true,
      interval_unit: "hours",
      interval_value: 6,
      time_of_day: "04:30",
    });
  });

  it("changes how many backups are listed on a page", async () => {
    const urls: string[] = [];
    const fetchSpy = mockFetch([
      settingsRoute({}),
      {
        method: "GET",
        match: (p) => p === "/api/v1/backup/automatic/jobs",
        handler: () => ({ body: { items: [job("job-1")], total: 30 } }),
      },
      ...baseRoutes(),
    ]);
    const user = userEvent.setup();
    render(<BackupPanel />);
    await section().findByText("job-1.zip");

    await user.click(section().getByRole("button", { name: "Rows per page" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "25" }));

    await waitFor(() => {
      urls.push(...fetchSpy.mock.calls.map(([input]) => String(input)));
      expect(urls.some((url) => url.includes("limit=25"))).toBe(true);
    });
  });
});

describe("automatic backups history order", () => {
  const rows = () => [
    job("alpha", { status: "failed", updated_at: "2026-09-06T08:05:00Z", started_at: "2026-09-06T08:00:00Z" }),
    job("bravo", { status: "complete", updated_at: "2026-09-06T08:02:00Z", started_at: "2026-09-06T08:00:00Z" }),
    job("charlie", {
      status: "running",
      output_filename: null,
      download_url: null,
      updated_at: "2026-09-06T08:06:00Z",
      started_at: null,
    }),
    job("delta", { status: "complete", updated_at: "2026-09-06T08:09:00Z", started_at: "2026-09-06T08:00:00Z" }),
  ];

  const order = () =>
    section()
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.textContent ?? "");

  it.each(["Backup", "Status", "Completed", "Duration"])("sorts by %s, then reverses, then lets go", async (column) => {
    const user = await openPanel([settingsRoute({}), jobsRoute(rows())]);
    await section().findByText("alpha.zip");
    const before = order();

    const header = section().getByRole("button", { name: new RegExp(`^${column}`, "i") });
    await user.click(header);
    const ascending = order();
    await user.click(header);
    const descending = order();
    await user.click(header);

    expect(order()).toEqual(before);
    expect(ascending).not.toEqual(descending);
  });
});
