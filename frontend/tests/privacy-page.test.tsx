import { render, screen, within } from "@testing-library/react";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PrivacyRoute from "@/app/privacy/page";
import { privacyPolicyCopy } from "@/components/legal/privacy-policy-content";
import { notificationMeta } from "@/lib/notification-meta";
import { translate } from "@/lib/i18n/core";
import { middleware } from "@/middleware";

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  serverGet: vi.fn(),
  locale: "en" as "en" | "vi",
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/server-api", () => ({ serverGet: m.serverGet }));
vi.mock("@/lib/i18n/server", async () => {
  const { translate } = await import("@/lib/i18n/core");
  return {
    getServerLocale: async () => ({
      locale: m.locale,
      t: (key: string, vars?: Record<string, string | number>) =>
        translate(m.locale, key, vars),
    }),
  };
});
vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="shell">{children}</div>
  ),
}));
vi.mock("@/components/layout/language-toggle", () => ({
  LanguageToggle: () => <button type="button">language</button>,
}));
vi.mock("@/components/brand/logo", () => ({
  Wordmark: ({ siteName }: { siteName: string }) => <span>{siteName}</span>,
}));

beforeEach(() => {
  m.locale = "en";
  m.getCurrentUser.mockReset().mockResolvedValue(null);
  m.serverGet.mockReset().mockResolvedValue({ site_name: "Acme Docs" });
});

describe("the /privacy route", () => {
  it("is readable before signing in, with a way back to sign in", async () => {
    render(await PrivacyRoute());

    expect(screen.queryByTestId("shell")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Personal data notice" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Back to sign in/ }),
    ).toHaveAttribute("href", "/login");
    expect(
      screen.getByRole("link", { name: "Contact an administrator" }),
    ).toHaveAttribute("href", "/login?view=contact");
    // Account settings only exist for someone signed in.
    expect(
      screen.queryByRole("link", { name: "Open account settings" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText(/Acme Docs/).length).toBeGreaterThan(1);
  });

  it("sits inside the app shell for a signed-in reader", async () => {
    m.getCurrentUser.mockResolvedValue({ id: "u1", username: "alice" });

    render(await PrivacyRoute());

    const shell = screen.getByTestId("shell");
    expect(
      within(shell).getByRole("link", { name: "Open account settings" }),
    ).toHaveAttribute("href", "/account");
    expect(
      within(shell).queryByRole("link", { name: /Back to sign in/ }),
    ).not.toBeInTheDocument();
  });

  it("follows the reader's language and keeps the build-time name when the backend is down", async () => {
    m.locale = "vi";
    m.serverGet.mockRejectedValue(new Error("offline"));

    render(await PrivacyRoute());

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Thông báo xử lý dữ liệu cá nhân",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Quyền của bạn" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Quay lại đăng nhập/ }),
    ).toBeInTheDocument();
  });

  it("is not behind the sign-in redirect", () => {
    const response = middleware(new NextRequest("http://localhost/privacy"));
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("the notice's content", () => {
  it("covers the same sections in both languages", () => {
    const en = privacyPolicyCopy("en", "X").sections.map(
      (section) => section.id,
    );
    const vi = privacyPolicyCopy("vi", "X").sections.map(
      (section) => section.id,
    );

    expect(vi).toEqual(en);
    expect(en).toEqual(
      expect.arrayContaining([
        "controller",
        "data",
        "retention",
        "sharing",
        "impersonation",
        "rights",
      ]),
    );
  });
});

describe("the impersonation notification", () => {
  it("is worded in both languages and drawn as a warning", () => {
    for (const locale of ["en", "vi"] as const) {
      const text = translate(
        locale,
        "notifications.kind.account_impersonated",
        { actor: "Ops" },
      );
      expect(text).toContain("**Ops**");
      expect(text).not.toContain("{");
    }
    expect(notificationMeta("account_impersonated").tone).toBe("warning");
  });
});
