import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminStatisticsPage from "@/app/admin/statistics/page";
import type { Me } from "@/types/api";

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  overview: vi.fn(async (range: string) => ({ range })),
  ai: vi.fn(async () => ({})),
  pages: vi.fn(async (_range: string, sort: string) => ({ sort })),
  spaces: vi.fn(async (_range: string, sort: string) => ({ sort })),
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
}));
vi.mock("@/components/admin/statistics/statistics-view", () => ({
  StatisticsView: ({ range, pages, spaces }: { range: string; pages: object; spaces: object }) => (
    <div data-testid="view">
      {range}|{Object.keys(pages).join(",")}|{Object.keys(spaces).join(",")}
    </div>
  ),
}));

function user(overrides: Partial<Me>): Me {
  return { is_superuser: false, global_permissions: [], ...overrides } as unknown as Me;
}

async function renderPage(range?: string) {
  render(await AdminStatisticsPage({ searchParams: Promise.resolve({ range }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("AdminStatisticsPage", () => {
  it.each([
    ["an ordinary member", user({})],
    ["a system administrator without superuser", user({ global_permissions: ["system_admin"] })],
    ["nobody signed in", null],
  ])("explains the permission to %s instead of fetching", async (_label, me) => {
    m.getCurrentUser.mockResolvedValue(me);
    await renderPage();
    expect(screen.getByText("adminShared.permissionRequiredTitle")).toBeInTheDocument();
    expect(m.overview).not.toHaveBeenCalled();
  });

  it("loads every ranking for the requested range", async () => {
    m.getCurrentUser.mockResolvedValue(user({ is_superuser: true }));
    await renderPage("7d");
    expect(screen.getByTestId("view")).toHaveTextContent("7d|views,stars,saves|views,stars");
    expect(m.overview).toHaveBeenCalledWith("7d");
  });

  it("falls back to 30 days for an unknown range", async () => {
    m.getCurrentUser.mockResolvedValue(user({ is_superuser: true }));
    await renderPage("forever");
    expect(screen.getByTestId("view")).toHaveTextContent("30d|");
  });
});
