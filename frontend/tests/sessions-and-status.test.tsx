import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionsPanel } from "@/components/account/sessions-panel";
import { SystemStatus } from "@/components/system-status";
import { ApiError, api } from "@/lib/api-client";
import type { AccountSession, InstanceInfo, ReadinessResponse } from "@/types/api";

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mocked = vi.mocked(api);

function session(overrides: Partial<AccountSession>): AccountSession {
  return {
    id: "s1",
    user_agent: "Mozilla/5.0 (X11; Linux)",
    ip_address: "10.0.0.1",
    last_seen_at: "2026-03-05T12:00:00Z",
    is_current: false,
    is_admin_session: false,
    ...overrides,
  } as AccountSession;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.post.mockResolvedValue(undefined);
});

describe("SessionsPanel", () => {
  it("describes each device, the current session and admin use", async () => {
    mocked.get.mockResolvedValue([
      session({ id: "a", is_current: true }),
      session({ id: "b", user_agent: "Mozilla (iPhone)", ip_address: null }),
      session({ id: "c", user_agent: null, is_admin_session: true }),
    ]);
    render(<SessionsPanel />);

    expect(await screen.findByText("Current session")).toBeInTheDocument();
    expect(screen.getByText("Mobile browser")).toBeInTheDocument();
    expect(screen.getAllByText("Desktop browser").length).toBeGreaterThan(0);
    expect(screen.getByText("Web browser")).toBeInTheDocument();
    expect(screen.getByText("IP address unavailable")).toBeInTheDocument();
    expect(screen.getAllByText(/Admin/).length).toBeGreaterThan(0);
  });

  it("shows an empty state, with sign-out-others disabled", async () => {
    mocked.get.mockResolvedValue([]);
    render(<SessionsPanel />);
    await screen.findByText("No active web sessions.");
    expect(screen.getByRole("button", { name: /sign out/i })).toBeDisabled();
  });

  it("shows a load failure", async () => {
    mocked.get.mockRejectedValue(new ApiError(500, "x", "Server down"));
    render(<SessionsPanel />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("signs out other sessions after confirmation and reloads", async () => {
    mocked.get.mockResolvedValue([session({ id: "a", is_current: true }), session({ id: "b" })]);
    const actor = userEvent.setup();
    render(<SessionsPanel />);
    await screen.findByText("Current session");

    await actor.click(screen.getByRole("button", { name: /sign out/i }));
    const dialog = await screen.findByRole("alertdialog");
    await actor.click(within(dialog).getAllByRole("button").at(-1)!);

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(mocked.post).toHaveBeenCalledWith("/api/v1/auth/sessions/revoke-others");
    expect(mocked.get).toHaveBeenCalledTimes(2);
  });

  it("reports a failed sign-out", async () => {
    mocked.get.mockResolvedValue([session({ id: "a", is_current: true }), session({ id: "b" })]);
    mocked.post.mockRejectedValueOnce(new Error("nope"));
    const actor = userEvent.setup();
    render(<SessionsPanel />);
    await screen.findByText("Current session");
    await actor.click(screen.getByRole("button", { name: /sign out/i }));
    const dialog = await screen.findByRole("alertdialog");
    await actor.click(within(dialog).getAllByRole("button").at(-1)!);
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});

describe("SystemStatus", () => {
  const instance = {
    version: "1.2.3",
    environment: "production",
    max_upload_size_bytes: 50 * 1024 * 1024,
    features: { imports: ["docx", "md"], exports: ["pdf"] },
  } as unknown as InstanceInfo;

  it("reports an unreachable API", () => {
    render(<SystemStatus instance={null} readiness={null} />);
    expect(screen.getByText("API unreachable")).toBeInTheDocument();
  });

  it("shows dependencies and instance details", () => {
    render(
      <SystemStatus
        instance={instance}
        readiness={{ checks: { database: "ok", redis: "down", cache: "ok" } } as unknown as ReadinessResponse}
      />,
    );
    expect(screen.getByText("PostgreSQL")).toBeInTheDocument();
    expect(screen.getByText("Redis")).toBeInTheDocument();
    expect(screen.getByText("cache")).toBeInTheDocument();
    expect(screen.getByText("1.2.3")).toBeInTheDocument();
    expect(screen.getByText("50 MB")).toBeInTheDocument();
    expect(screen.getByText("docx, md")).toBeInTheDocument();
  });

  it("formats large limits in gigabytes", () => {
    render(
      <SystemStatus
        instance={{ ...instance, max_upload_size_bytes: 2 * 1024 * 1024 * 1024 } as InstanceInfo}
        readiness={null}
      />,
    );
    expect(screen.getByText("2.0 GB")).toBeInTheDocument();
    expect(screen.getByText(/degraded state without details/)).toBeInTheDocument();
  });

  it("shows dependencies even without instance details", () => {
    render(
      <SystemStatus
        instance={null}
        readiness={{ checks: { database: "ok" } } as unknown as ReadinessResponse}
      />,
    );
    expect(screen.getByText("PostgreSQL")).toBeInTheDocument();
    expect(screen.queryByText("Instance")).not.toBeInTheDocument();
  });
});
