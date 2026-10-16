import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { LogsDialog } from "@/components/admin/monitor/logs-dialog";
import {
  formatUptime,
  MonitorView,
} from "@/components/admin/monitor/monitor-view";
import type { ContainerInfo, MonitorOverview } from "@/lib/admin-monitor";
import { api } from "@/lib/api-client";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

function container(over: Partial<ContainerInfo> = {}): ContainerInfo {
  return {
    id: "abc123abc123",
    name: "wikihub-backend-1",
    image: "wikihub-backend",
    state: "running",
    status: "Up 1 hour (healthy)",
    project: "wikihub",
    service: "backend",
    created: 1,
    uptime_seconds: 3 * 3600 + 120,
    restarts: 0,
    health: "healthy",
    cpu_percent: 3.5,
    memory_bytes: 150 * 1024 * 1024,
    memory_limit: 16 * 1024 ** 3,
    ...over,
  };
}

function overview(
  containers: ContainerInfo[],
  over: Partial<MonitorOverview> = {},
): MonitorOverview {
  return {
    docker_ok: true,
    host: {
      cpus: 12,
      load: [6, 4, 2],
      memory_total: 16 * 1024 ** 3,
      memory_used: 8 * 1024 ** 3,
      memory_available: 8 * 1024 ** 3,
      swap_total: 0,
      swap_used: 0,
      disk_total: 100 * 1024 ** 3,
      disk_used: 40 * 1024 ** 3,
      uptime_seconds: 2 * 86400 + 3 * 3600,
      docker_version: "27.0.1",
      os: "Ubuntu",
      kernel: "6.6",
      containers_total: containers.length,
      containers_running: containers.filter((c) => c.state === "running")
        .length,
      images: 3,
    },
    containers,
    ...over,
  };
}

const FLEET = [
  container(),
  container({
    id: "def456def456",
    name: "wikihub-worker-1",
    image: "wikihub-worker",
    service: "worker",
    cpu_percent: 40,
    memory_bytes: 400 * 1024 * 1024,
    uptime_seconds: 60,
    restarts: 2,
  }),
  container({
    id: "999999999999",
    name: "report-control-plane",
    image: "kindest/node:v1.36.1",
    project: "",
    service: "",
    health: "",
    cpu_percent: 280,
    memory_bytes: 5.8 * 1024 ** 3,
    memory_limit: 16 * 1024 ** 3,
    uptime_seconds: 10 * 3600,
  }),
  container({
    id: "bbbbbbbbbbbb",
    name: "old-job",
    image: "busybox",
    state: "exited",
    project: "",
    uptime_seconds: null,
    cpu_percent: null,
    memory_bytes: null,
    memory_limit: null,
    health: "",
  }),
];

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("formatUptime", () => {
  it("shows the two most useful units", () => {
    expect(formatUptime(null)).toBe("-");
    expect(formatUptime(undefined)).toBe("-");
    expect(formatUptime(42)).toBe("42s");
    expect(formatUptime(125)).toBe("2m");
    expect(formatUptime(3 * 3600 + 5 * 60)).toBe("3h 5m");
    expect(formatUptime(2 * 86400 + 3 * 3600)).toBe("2d 3h");
  });
});

describe("MonitorView", () => {
  it("shows the server's load, memory, disk and uptime", async () => {
    vi.mocked(api.get).mockResolvedValue(overview(FLEET));
    render(<MonitorView initial={overview(FLEET)} />);

    expect(screen.getByText("6.00 / 12 cores")).toBeInTheDocument(); // load against the cores
    // One bar per card (memory also has its swap bar), with the share at its right end.
    expect(
      screen.getByText("Load average: 5 min 4.00 · 15 min 2.00"),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("progressbar")).toHaveLength(3); // load, memory, disk
    expect(screen.getAllByText("50%").length).toBeGreaterThanOrEqual(2); // load and memory
    expect(screen.getByText("40%")).toBeInTheDocument(); // disk
    expect(screen.getByText("8.00 GB / 16.00 GB")).toBeInTheDocument();
    expect(
      screen.getByText(/free on the disk holding WikiHub/),
    ).toBeInTheDocument();
    expect(screen.getByText("2d 3h")).toBeInTheDocument();
    expect(screen.getByText(/3 of 4 containers running/)).toBeInTheDocument();
    expect(screen.getByText(/Docker 27\.0\.1 · Ubuntu/)).toBeInTheDocument();
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/api/v1/admin/monitor"),
    );
  });

  it("lists every container it is given with its id, uptime, CPU and memory, with no WikiHub/other split", () => {
    vi.mocked(api.get).mockResolvedValue(overview(FLEET));
    render(<MonitorView initial={overview(FLEET)} />);

    const backend = screen.getByText("wikihub-backend-1").closest("tr")!;
    expect(within(backend).getByText("abc123abc123")).toBeInTheDocument();
    expect(within(backend).getByText("3h 2m")).toBeInTheDocument();
    expect(within(backend).getByText("3.5%")).toBeInTheDocument();
    expect(within(backend).getByText("150.0 MB")).toBeInTheDocument();
    expect(within(backend).getByText("Healthy")).toBeInTheDocument();

    const other = screen.getByText("report-control-plane").closest("tr")!;
    expect(within(other).queryByText("not WikiHub")).toBeNull();
    expect(within(other).getByText("280.0%")).toBeInTheDocument();
    expect(within(other).getByText("Running")).toBeInTheDocument(); // no health check

    const stopped = screen.getByText("old-job").closest("tr")!;
    expect(within(stopped).getByText("exited")).toBeInTheDocument();
    expect(within(stopped).getAllByText("-").length).toBeGreaterThanOrEqual(3);

    expect(
      within(screen.getByText("wikihub-worker-1").closest("tr")!).getByText(
        "2 restarts",
      ),
    ).toBeInTheDocument();
  });

  it("sorts from the column headers: a first click on a number starts with the biggest, a second reverses", async () => {
    vi.mocked(api.get).mockResolvedValue(overview(FLEET));
    render(<MonitorView initial={overview(FLEET)} />);
    const names = () =>
      screen
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.querySelector("span.font-medium")?.textContent);
    const header = (name: string) =>
      screen.getByRole("button", { name }).closest("th")!;

    expect(names()).toEqual([
      "old-job",
      "report-control-plane",
      "wikihub-backend-1",
      "wikihub-worker-1",
    ]);
    expect(header("Container")).toHaveAttribute("aria-sort", "ascending");

    await userEvent.click(screen.getByRole("button", { name: "CPU" }));
    expect(header("CPU")).toHaveAttribute("aria-sort", "descending");
    expect(names()[0]).toBe("report-control-plane");
    expect(names()[1]).toBe("wikihub-worker-1");
    expect(names().at(-1)).toBe("old-job"); // not running: no CPU, last

    await userEvent.click(screen.getByRole("button", { name: "CPU" }));
    expect(header("CPU")).toHaveAttribute("aria-sort", "ascending");
    expect(names()[0]).toBe("old-job");

    await userEvent.click(screen.getByRole("button", { name: "Uptime" }));
    expect(names()[0]).toBe("report-control-plane");

    await userEvent.click(screen.getByRole("button", { name: "Container" }));
    expect(names()[0]).toBe("old-job");
    await userEvent.click(screen.getByRole("button", { name: "Container" }));
    expect(names()[0]).toBe("wikihub-worker-1");
  });

  it("has no filter or sort buttons outside the table header", () => {
    vi.mocked(api.get).mockResolvedValue(overview(FLEET));
    render(<MonitorView initial={overview(FLEET)} />);

    expect(screen.queryByLabelText("Only WikiHub")).toBeNull();
    expect(screen.queryByRole("group", { name: "Sort by" })).toBeNull();
  });

  it("explains when Docker could not be read", () => {
    const down = overview([], { docker_ok: false });
    vi.mocked(api.get).mockResolvedValue(down);
    render(<MonitorView initial={down} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      /Docker could not be read/,
    );
    expect(screen.getByText("No containers.")).toBeInTheDocument();
  });

  it("shows an error, but keeps the last numbers, when a refresh fails", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("boom"));
    render(<MonitorView initial={overview(FLEET)} />);

    expect(
      await screen.findByText("Could not read the server state."),
    ).toBeInTheDocument();
    expect(screen.getByText("wikihub-backend-1")).toBeInTheDocument();
  });

  it("starts empty with a message when the monitor cannot be reached at first", async () => {
    vi.mocked(api.get).mockResolvedValue(overview(FLEET));
    render(<MonitorView initial={null} />);

    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(await screen.findByText("wikihub-backend-1")).toBeInTheDocument();
  });

  it("refreshes on a timer, and not while the tab is hidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.get).mockResolvedValue(overview(FLEET));
    render(<MonitorView initial={overview(FLEET)} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThanOrEqual(2);

    const before = vi.mocked(api.get).mock.calls.length;
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11000);
    });
    expect(vi.mocked(api.get).mock.calls.length).toBe(before);
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });

  it("opens the logs of the container whose button was pressed", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.includes("/logs")) return { lines: ["2026-10-15T04:54Z hello"] };
      return overview(FLEET);
    });
    render(<MonitorView initial={overview(FLEET)} />);

    await userEvent.click(
      screen.getByRole("button", { name: "View logs of wikihub-worker-1" }),
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(
      await screen.findByText("2026-10-15T04:54Z hello"),
    ).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(
      "/api/v1/admin/monitor/containers/wikihub-worker-1/logs?tail=200",
    );
  });
});

describe("LogsDialog", () => {
  const LINES = [
    "2026-10-15T04:50Z [info] started",
    "2026-10-15T04:51Z [warning] slow request",
    "2026-10-15T04:52Z [error] Traceback (most recent call last)",
    "2026-10-15T04:53Z [info] search_index_pass pages=9",
  ];

  it("shows the lines coloured by severity, newest last, with a count", async () => {
    vi.mocked(api.get).mockResolvedValue({ lines: LINES });
    render(<LogsDialog container={container()} onClose={vi.fn()} />);

    const error = await screen.findByText(/Traceback/);
    expect(error.className).toContain("text-danger");
    expect(screen.getByText(/slow request/).className).toContain(
      "text-warning",
    );
    expect(screen.getByText(/started/).className).toContain("text-foreground");
    expect(
      screen.getByText("Showing 4 of 4 lines · credentials hidden"),
    ).toBeInTheDocument();
  });

  it("filters lines and says when none match", async () => {
    vi.mocked(api.get).mockResolvedValue({ lines: LINES });
    render(<LogsDialog container={container()} onClose={vi.fn()} />);
    await screen.findByText(/Traceback/);

    await userEvent.type(screen.getByLabelText("Filter lines"), "search_index");
    expect(screen.getByText(/search_index_pass/)).toBeInTheDocument();
    expect(screen.queryByText(/Traceback/)).toBeNull();
    expect(
      screen.getByText("Showing 1 of 4 lines · credentials hidden"),
    ).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Filter lines"));
    await userEvent.type(screen.getByLabelText("Filter lines"), "zzz");
    expect(screen.getByText("No line matches the filter.")).toBeInTheDocument();
  });

  it("loads the length chosen", async () => {
    vi.mocked(api.get).mockResolvedValue({ lines: LINES });
    render(<LogsDialog container={container()} onClose={vi.fn()} />);
    await screen.findByText(/Traceback/);

    await userEvent.click(screen.getByRole("button", { name: "500" }));

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        "/api/v1/admin/monitor/containers/wikihub-backend-1/logs?tail=500",
      ),
    );
  });

  it("says so when a container has written nothing, and when the logs cannot be read", async () => {
    vi.mocked(api.get).mockResolvedValue({ lines: [] });
    const { unmount } = render(
      <LogsDialog container={container()} onClose={vi.fn()} />,
    );
    expect(
      await screen.findByText("This container has written nothing yet."),
    ).toBeInTheDocument();
    unmount();

    vi.mocked(api.get).mockRejectedValue(new Error("down"));
    render(<LogsDialog container={container()} onClose={vi.fn()} />);
    expect(
      await screen.findByText("Could not read the logs."),
    ).toBeInTheDocument();
  });

  it("copies the lines that are shown", async () => {
    vi.mocked(api.get).mockResolvedValue({ lines: LINES });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<LogsDialog container={container()} onClose={vi.fn()} />);
    await screen.findByText(/Traceback/);

    await userEvent.type(screen.getByLabelText("Filter lines"), "error");
    await userEvent.click(
      screen.getByRole("button", { name: "Copy shown lines" }),
    );

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINES[2]));
    expect(toast.success).toHaveBeenCalledWith("Copied.");
  });

  it("follows the container, refreshing every few seconds, until switched off", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.get).mockResolvedValue({ lines: LINES });
    render(<LogsDialog container={container()} onClose={vi.fn()} />);
    await screen.findByText(/Traceback/);
    const base = vi.mocked(api.get).mock.calls.length;

    await userEvent.click(screen.getByLabelText("Follow"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4200);
    });
    expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(base);

    await userEvent.click(screen.getByLabelText("Follow"));
    const stopped = vi.mocked(api.get).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(vi.mocked(api.get).mock.calls.length).toBe(stopped);
  });

  it("closes, and asks for nothing while no container is chosen", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <LogsDialog container={null} onClose={onClose} />,
    );
    expect(api.get).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();

    vi.mocked(api.get).mockResolvedValue({ lines: LINES });
    rerender(<LogsDialog container={container()} onClose={onClose} />);
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
