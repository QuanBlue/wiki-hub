import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminMonitorPage from "@/app/admin/monitor/page";
import { getMonitorOverview } from "@/lib/admin-monitor";
import type { Me } from "@/types/api";

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  overview: vi.fn(),
  serverGet: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/server-api", () => ({ serverGet: m.serverGet }));
vi.mock("@/lib/i18n/server", () => ({
  getServerLocale: async () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("@/components/admin/monitor/monitor-view", () => ({
  MonitorView: ({ initial }: { initial: { docker_ok: boolean } | null }) => (
    <div data-testid="view">
      {initial ? `docker:${initial.docker_ok}` : "no-data"}
    </div>
  ),
}));

const user = (overrides: Partial<Me>) =>
  ({
    is_superuser: false,
    global_permissions: [],
    ...overrides,
  }) as unknown as Me;

beforeEach(() => vi.clearAllMocks());

describe("AdminMonitorPage", () => {
  it.each([
    ["an ordinary member", user({})],
    [
      "a system administrator who is not a superuser",
      user({ global_permissions: ["system_admin"] }),
    ],
    ["nobody signed in", null],
  ])(
    "explains the permission to %s and asks nothing of the monitor",
    async (_label, me) => {
      m.getCurrentUser.mockResolvedValue(me);

      render(await AdminMonitorPage());

      expect(
        screen.getByText("adminShared.permissionRequiredTitle"),
      ).toBeInTheDocument();
      expect(m.serverGet).not.toHaveBeenCalled();
    },
  );

  it("gives a superuser the page with the first reading of the server", async () => {
    m.getCurrentUser.mockResolvedValue(user({ is_superuser: true }));
    m.serverGet.mockResolvedValue({
      docker_ok: true,
      host: {},
      containers: [],
    });

    render(await AdminMonitorPage());

    expect(screen.getByText("adminMonitor.title")).toBeInTheDocument();
    expect(screen.getByTestId("view")).toHaveTextContent("docker:true");
    expect(m.serverGet).toHaveBeenCalledWith("/api/v1/admin/monitor");
  });

  it("still shows the page when the monitor cannot be reached", async () => {
    m.getCurrentUser.mockResolvedValue(user({ is_superuser: true }));
    m.serverGet.mockRejectedValue(new Error("down"));

    render(await AdminMonitorPage());

    expect(screen.getByTestId("view")).toHaveTextContent("no-data");
  });
});

describe("getMonitorOverview", () => {
  it("is the reading, or nothing when it cannot be had", async () => {
    m.serverGet.mockResolvedValueOnce({
      docker_ok: false,
      host: {},
      containers: [],
    });
    expect(await getMonitorOverview()).toMatchObject({ docker_ok: false });

    m.serverGet.mockRejectedValueOnce(new Error("down"));
    expect(await getMonitorOverview()).toBeNull();
  });
});
