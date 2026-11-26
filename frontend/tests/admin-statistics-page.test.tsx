import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminStatisticsPage from "@/app/admin/statistics/page";
import type { Me } from "@/types/api";

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  overview: vi.fn(async (range: unknown) => ({ range })),
  ai: vi.fn(async () => ({})),
  pages: vi.fn(async (_range: unknown, sort: string) => ({ sort })),
  spaces: vi.fn(async (_range: unknown, sort: string) => ({ sort })),
  contributors: vi.fn(async () => ({ range_days: 30, items: [] })),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/i18n/server", () => ({
  getServerLocale: async () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("@/lib/admin", () => ({
  getStatsOverview: m.overview,
  getStatsAi: m.ai,
  getStatsTopPages: m.pages,
  getStatsTopSpaces: m.spaces,
  getStatsTopContributors: m.contributors,
}));
vi.mock("@/components/admin/statistics/statistics-view", () => ({
  StatisticsView: ({
    range,
    initialTab,
    pages,
    spaces,
  }: {
    range: string;
    initialTab?: string;
    pages: object;
    spaces: object;
  }) => (
    <div data-testid="view">
      {range}|{initialTab}|{Object.keys(pages).join(",")}|
      {Object.keys(spaces).join(",")}
    </div>
  ),
}));

function user(overrides: Partial<Me>): Me {
  return {
    is_superuser: false,
    global_permissions: [],
    ...overrides,
  } as unknown as Me;
}

async function renderPage(
  params: { range?: string; start?: string; end?: string; tab?: string } = {},
) {
  render(await AdminStatisticsPage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("AdminStatisticsPage", () => {
  it.each([
    ["an ordinary member", user({})],
    [
      "a system administrator without superuser",
      user({ global_permissions: ["system_admin"] }),
    ],
    ["nobody signed in", null],
  ])(
    "explains the permission to %s instead of fetching",
    async (_label, me) => {
      m.getCurrentUser.mockResolvedValue(me);
      await renderPage();
      expect(
        screen.getByText("adminShared.permissionRequiredTitle"),
      ).toBeInTheDocument();
      expect(m.overview).not.toHaveBeenCalled();
    },
  );

  it("loads every ranking and contributors for the requested range", async () => {
    m.getCurrentUser.mockResolvedValue(user({ is_superuser: true }));
    await renderPage({ range: "7d", tab: "content" });
    expect(screen.getByTestId("view")).toHaveTextContent(
      "7d|content|views,stars,saves|views,stars",
    );
    expect(m.overview).toHaveBeenCalledWith("7d");
    expect(m.contributors).toHaveBeenCalledWith("7d");
  });

  it("passes custom start and end dates through when valid", async () => {
    m.getCurrentUser.mockResolvedValue(user({ is_superuser: true }));
    await renderPage({ start: "2026-10-01", end: "2026-10-15" });
    expect(m.overview).toHaveBeenCalledWith({
      start: "2026-10-01",
      end: "2026-10-15",
    });
  });

  it("falls back to 30 days and overview tab for unknown params", async () => {
    m.getCurrentUser.mockResolvedValue(user({ is_superuser: true }));
    await renderPage({ range: "forever", tab: "unknown" });
    expect(screen.getByTestId("view")).toHaveTextContent("30d|overview|");
  });
});
