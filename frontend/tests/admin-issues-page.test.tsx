import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminIssuesPage from "@/app/admin/issues/page";
import type { Me } from "@/types/api";

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/i18n/server", () => ({
  getServerLocale: async () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("@/components/admin/issues-list", () => ({
  IssuesList: ({ openId }: { openId?: string }) => <div data-testid="list">{openId ?? "none"}</div>,
}));

function user(overrides: Partial<Me>): Me {
  return { is_superuser: false, global_permissions: [], ...overrides } as unknown as Me;
}

async function renderPage(params: Record<string, string | string[] | undefined> = {}) {
  render(await AdminIssuesPage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminIssuesPage", () => {
  it("sends anonymous visitors to sign in", async () => {
    m.getCurrentUser.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow("redirect:/login");
  });

  it("sends people without the permission back to administration", async () => {
    m.getCurrentUser.mockResolvedValue(user({ global_permissions: ["manage_users"] } as Partial<Me>));
    await expect(renderPage()).rejects.toThrow("redirect:/admin");
  });

  it.each([
    ["a superuser", { is_superuser: true }],
    ["a system administrator", { global_permissions: ["system_admin"] }],
    ["an issues manager", { global_permissions: ["manage_issues"] }],
  ])("admits %s", async (_label, overrides) => {
    m.getCurrentUser.mockResolvedValue(user(overrides as Partial<Me>));
    await renderPage();
    expect(screen.getByText("adminIssues.pageTitle")).toBeInTheDocument();
    expect(screen.getByTestId("list")).toHaveTextContent("none");
  });

  it("opens the requested issue, ignoring repeated parameters", async () => {
    m.getCurrentUser.mockResolvedValue(user({ is_superuser: true }));
    await renderPage({ issue: "abc" });
    expect(screen.getByTestId("list")).toHaveTextContent("abc");

    document.body.innerHTML = "";
    await renderPage({ issue: ["a", "b"] });
    expect(screen.getByTestId("list")).toHaveTextContent("none");
  });
});
