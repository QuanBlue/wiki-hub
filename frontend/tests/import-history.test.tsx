import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatDuration,
  ImportHistory,
  normaliseStatus,
  toRuns,
} from "@/components/admin/import-history";
import { api } from "@/lib/api-client";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));

const { toast } = await import("sonner");

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    status: "completed",
    error: null,
    warning_count: 0,
    error_count: 0,
    created_at: "2026-09-24T10:00:00Z",
    updated_at: "2026-09-24T10:05:00Z",
    space_keys: [],
    import_all: true,
    ...overrides,
  };
}

function logLine(id: string, level: string, message: string) {
  return {
    id,
    created_at: "2026-09-24T10:01:00Z",
    level,
    phase: "attachments",
    entity_label: level === "warning" ? "file.pdf" : null,
    message,
  };
}

let confluence: unknown[];
let restores: unknown[];
let logsFor: (query: Record<string, unknown>) => unknown;

beforeEach(() => {
  confluence = [];
  restores = [];
  logsFor = () => ({ items: [], next_offset: null });
  vi.mocked(api.get).mockImplementation(((path: string, options?: { query?: Record<string, unknown> }) => {
    if (path.endsWith("/logs")) return Promise.resolve(logsFor(options?.query ?? {}));
    if (path.startsWith("/api/v1/confluence-imports/jobs")) return Promise.resolve(confluence);
    if (path.startsWith("/api/v1/backup/jobs")) return Promise.resolve(restores);
    return Promise.reject(new Error(`unexpected ${path}`));
  }) as never);
});

describe("helpers", () => {
  it("normalises the two job tables' status vocabularies", () => {
    expect(normaliseStatus("complete")).toBe("completed");
    expect(normaliseStatus("completed")).toBe("completed");
    expect(normaliseStatus("failed")).toBe("failed");
    expect(normaliseStatus("cancelled")).toBe("cancelled");
    expect(normaliseStatus("queued")).toBe("queued");
    expect(normaliseStatus("retrying")).toBe("running");
    expect(normaliseStatus("restoring")).toBe("running");
  });

  it("formats durations compactly", () => {
    expect(formatDuration("2026-01-01T00:00:00Z", "2026-01-01T00:00:45Z")).toBe("45s");
    expect(formatDuration("2026-01-01T00:00:00Z", "2026-01-01T00:12:00Z")).toBe("12m");
    expect(formatDuration("2026-01-01T00:00:00Z", "2026-01-01T03:12:00Z")).toBe("3h 12m");
    expect(formatDuration("2026-01-01T01:00:00Z", "2026-01-01T00:00:00Z")).toBe("0s");
  });

  it("maps scope: import-all and empty selections mean every space", () => {
    const [all, some, restoreAll, restoreSome] = [
      ...toRuns("confluence", [job(), job({ id: "b", import_all: false, space_keys: ["ENG"] })]),
      ...toRuns("restore", [
        job({ id: "c", import_all: undefined }),
        job({ id: "d", import_all: undefined, space_keys: ["OPS", "HR"] }),
      ]),
    ];
    expect(all.spaces).toBeNull();
    expect(some.spaces).toEqual(["ENG"]);
    expect(restoreAll.spaces).toBeNull();
    expect(restoreSome.spaces).toEqual(["OPS", "HR"]);
    expect(some.logsPath).toBe("/api/v1/confluence-imports/jobs/b/logs");
    expect(restoreSome.logsPath).toBe("/api/v1/backup/jobs/d/logs");
  });
});

describe("ImportHistory", () => {
  it("lists both kinds newest first, with status and problem counts", async () => {
    confluence = [
      job({ id: "old", status: "failed", warning_count: 3, error_count: 1, error: "worker timed out" }),
    ];
    restores = [
      job({ id: "new", status: "complete", created_at: "2026-09-25T10:00:00Z", updated_at: "2026-09-25T13:12:00Z", import_all: undefined }),
    ];

    render(<ImportHistory />);

    const rows = await screen.findAllByRole("button", { expanded: false });
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("WikiHub restore")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Completed")).toBeInTheDocument();
    expect(within(rows[0]).getByText("No warnings")).toBeInTheDocument();
    expect(within(rows[0]).getByText(/Took 3h 12m/)).toBeInTheDocument();
    expect(within(rows[1]).getByText("Confluence import")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Failed")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Warnings: 3")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Errors: 1")).toBeInTheDocument();
  });

  it("shows an empty state and an error state with retry", async () => {
    render(<ImportHistory />);
    expect(await screen.findByText("No imports or restores have been run yet.")).toBeInTheDocument();

    vi.mocked(api.get).mockRejectedValue(new Error("down"));
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(await screen.findByText("Could not load the import history.")).toBeInTheDocument();

    vi.mocked(api.get).mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No imports or restores have been run yet.")).toBeInTheDocument();
  });

  it("still shows one source when the other fails", async () => {
    confluence = [job()];
    vi.mocked(api.get).mockImplementation(((path: string) =>
      path.startsWith("/api/v1/backup/jobs")
        ? Promise.reject(new Error("nope"))
        : Promise.resolve(confluence)) as never);

    render(<ImportHistory />);

    expect(await screen.findByText("Confluence import")).toBeInTheDocument();
  });

  it("marks a run that is still going as in progress", async () => {
    confluence = [job({ status: "running" })];
    render(<ImportHistory />);
    expect(await screen.findByText(/In progress/)).toBeInTheDocument();
  });

  it("loads further pages of runs without duplicating earlier ones", async () => {
    const page = Array.from({ length: 20 }, (_, index) =>
      job({ id: `c${index}`, created_at: `2026-09-24T10:${String(index).padStart(2, "0")}:00Z` }),
    );
    confluence = page;
    render(<ImportHistory />);
    const more = await screen.findByRole("button", { name: "Load more runs" });

    confluence = [page[19], job({ id: "older", created_at: "2026-09-01T00:00:00Z" })];
    fireEvent.click(more);

    await waitFor(() => expect(screen.getAllByText("Confluence import")).toHaveLength(21));
    expect(screen.queryByRole("button", { name: "Load more runs" })).not.toBeInTheDocument();
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      "/api/v1/confluence-imports/jobs",
      { query: { limit: 20, offset: 20 } },
    );
  });

  it("reports a failed load-more with a toast and keeps the list", async () => {
    confluence = Array.from({ length: 20 }, (_, index) => job({ id: `c${index}` }));
    render(<ImportHistory />);
    const more = await screen.findByRole("button", { name: "Load more runs" });

    vi.mocked(api.get).mockRejectedValue(new Error("down"));
    fireEvent.click(more);

    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Could not load the import history."),
    );
    expect(screen.getAllByText("Confluence import")).toHaveLength(20);
  });

  describe("run log", () => {
    beforeEach(() => {
      confluence = [job({ id: "run-1", status: "failed", error: "boom", warning_count: 1, error_count: 1 })];
    });

    async function openLog() {
      render(<ImportHistory />);
      fireEvent.click(await screen.findByRole("button", { expanded: false }));
    }

    it("shows the stored error and log lines oldest first, and can download them", async () => {
      logsFor = () => ({
        items: [logLine("1", "warning", "file missing"), logLine("2", "error", "it failed")],
        next_offset: null,
      });

      await openLog();

      expect(screen.getByText("Error: boom")).toBeInTheDocument();
      expect(await screen.findByText(/file missing/)).toBeInTheDocument();
      expect(screen.getByText(/file\.pdf: file missing/)).toBeInTheDocument();
      expect(vi.mocked(api.get)).toHaveBeenCalledWith(
        "/api/v1/confluence-imports/jobs/run-1/logs",
        { query: { offset: 0, limit: 100, order: "asc", level: undefined } },
      );
      const download = screen.getByRole("link", { name: /Download \.txt/ });
      expect(download).toHaveAttribute(
        "href",
        "/api/v1/confluence-imports/jobs/run-1/logs/download",
      );
    });

    it("refetches with the chosen level and explains an empty result", async () => {
      logsFor = (query) =>
        query.level === "error"
          ? { items: [], next_offset: null }
          : { items: [logLine("1", "warning", "file missing")], next_offset: null };
      await openLog();
      await screen.findByText(/file missing/);

      fireEvent.click(screen.getByRole("button", { name: "Errors" }));

      expect(await screen.findByText("No log lines match this filter.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Errors" })).toHaveAttribute("aria-pressed", "true");
      expect(vi.mocked(api.get)).toHaveBeenCalledWith(
        "/api/v1/confluence-imports/jobs/run-1/logs",
        { query: { offset: 0, limit: 100, order: "asc", level: "error" } },
      );
    });

    it("pages through a long log", async () => {
      logsFor = (query) =>
        query.offset === 0
          ? { items: [logLine("1", "info", "first page")], next_offset: 100 }
          : { items: [logLine("2", "info", "second page")], next_offset: null };
      await openLog();
      await screen.findByText(/first page/);

      fireEvent.click(screen.getByRole("button", { name: "Load more lines" }));

      expect(await screen.findByText(/second page/)).toBeInTheDocument();
      expect(screen.getByText(/first page/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Load more lines" })).not.toBeInTheDocument();
    });

    it("says so when the log cannot be loaded", async () => {
      vi.mocked(api.get).mockImplementation(((path: string) =>
        path.endsWith("/logs")
          ? Promise.reject(new Error("no"))
          : Promise.resolve(path.startsWith("/api/v1/backup") ? [] : confluence)) as never);

      await openLog();

      expect(await screen.findByText("Could not load the log.")).toBeInTheDocument();
    });

    it("reports a failed load-more of the log with a toast", async () => {
      let calls = 0;
      vi.mocked(api.get).mockImplementation(((path: string) => {
        if (!path.endsWith("/logs")) {
          return Promise.resolve(path.startsWith("/api/v1/backup") ? [] : confluence);
        }
        calls += 1;
        return calls === 1
          ? Promise.resolve({ items: [logLine("1", "info", "first page")], next_offset: 100 })
          : Promise.reject(new Error("no"));
      }) as never);
      await openLog();
      await screen.findByText(/first page/);

      fireEvent.click(screen.getByRole("button", { name: "Load more lines" }));

      await waitFor(() =>
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Could not load the log."),
      );
    });

    it("copies the loaded lines, and says when it cannot", async () => {
      logsFor = () => ({ items: [logLine("1", "warning", "file missing")], next_offset: null });
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      await openLog();
      await screen.findByText(/file missing/);

      fireEvent.click(screen.getByRole("button", { name: /Copy/ }));

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Log copied to clipboard."));
      expect(writeText).toHaveBeenCalledWith(
        "2026-09-24T10:01:00Z WARNING attachments file.pdf: file missing",
      );

      writeText.mockRejectedValueOnce(new Error("denied"));
      fireEvent.click(screen.getByRole("button", { name: /Copy/ }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not copy the log."));
    });

    it("collapses the run again", async () => {
      logsFor = () => ({ items: [logLine("1", "info", "hello")], next_offset: null });
      await openLog();
      await screen.findByText(/hello/);

      fireEvent.click(screen.getByRole("button", { expanded: true }));

      expect(screen.queryByText(/hello/)).not.toBeInTheDocument();
    });
  });
});
