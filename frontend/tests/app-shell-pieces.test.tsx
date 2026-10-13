import { useQueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppMain } from "@/components/layout/app-main";
import { AppShell } from "@/components/layout/app-shell";
import { SidebarProvider } from "@/components/layout/sidebar-context";
import { TopBar } from "@/components/layout/top-bar";
import { Providers } from "@/components/providers";
import { ApiError } from "@/lib/api-client";
import { setBindings, resetAllShortcuts } from "@/lib/keyboard-shortcuts";
import type { Me } from "@/types/api";

const m = vi.hoisted(() => ({
  getMailSummary: vi.fn(),
  getNotificationSummary: vi.fn(),
  getSidebarPermissions: vi.fn(),
  getSidebarPreferences: vi.fn(),
  listFavoriteSpaces: vi.fn(),
  listOwnPinnedPages: vi.fn(),
  theme: { siteName: "" as string | undefined },
}));

vi.mock("@/lib/admin-mail", () => ({
  getMailSummary: m.getMailSummary,
  NO_MAILBOX: { has_inbox: false, unread_count: 0 },
}));
vi.mock("@/lib/notifications", () => ({ getNotificationSummary: m.getNotificationSummary }));
vi.mock("@/lib/navigation", () => ({ getSidebarPermissions: m.getSidebarPermissions }));
vi.mock("@/lib/sidebar-preferences", () => ({ getSidebarPreferences: m.getSidebarPreferences }));
vi.mock("@/lib/spaces", () => ({ listFavoriteSpaces: m.listFavoriteSpaces }));
vi.mock("@/lib/pages", () => ({ listOwnPinnedPages: m.listOwnPinnedPages }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/theme-color-provider", () => ({
  useThemeSettings: () => (m.theme.siteName === undefined ? undefined : { siteName: m.theme.siteName }),
  ThemeColorProvider: ({ children, ...props }: { children: React.ReactNode } & Record<string, unknown>) => (
    <div data-testid="theme" data-props={JSON.stringify(props)}>
      {children}
    </div>
  ),
}));
vi.mock("@/components/brand/logo", () => ({
  Wordmark: ({ siteName }: { siteName: string }) => <span data-testid="wordmark">{siteName}</span>,
}));
vi.mock("@/components/layout/notification-bell", () => ({ NotificationBell: () => <i>bell</i> }));
vi.mock("@/components/layout/sidebar-toggle", () => ({ SidebarToggle: () => <i>toggle</i> }));
vi.mock("@/components/layout/theme-toggle", () => ({ ThemeToggle: () => <i>theme-toggle</i> }));
vi.mock("@/components/layout/language-toggle", () => ({ LanguageToggle: () => <i>lang</i> }));
vi.mock("@/components/layout/user-menu", () => ({ UserMenu: () => <i>user-menu</i> }));
vi.mock("@/components/layout/search-modal", () => ({
  SearchModal: ({ open }: { open: boolean }) => (open ? <div role="dialog">search</div> : null),
}));
vi.mock("@/components/layout/sidebar", () => ({
  Sidebar: ({ favoriteSpaces, pinnedPages }: { favoriteSpaces: unknown[]; pinnedPages: unknown[] }) => (
    <nav data-testid="sidebar">{favoriteSpaces.length}/{pinnedPages.length}</nav>
  ),
}));
vi.mock("@/components/layout/mailbox-password-banner", () => ({
  MailboxPasswordBanner: () => <div>mailbox-banner</div>,
}));
vi.mock("@/components/layout/notifications-provider", () => ({
  NotificationsProvider: ({ children, initial }: { children: React.ReactNode; initial: unknown }) => (
    <div data-initial={JSON.stringify(initial)}>{children}</div>
  ),
}));
vi.mock("@/components/layout/mail-summary-provider", () => ({
  MailSummaryProvider: ({ children, poll, initial }: { children: React.ReactNode; poll: boolean; initial: unknown }) => (
    <div data-testid="mail" data-poll={String(poll)} data-initial={JSON.stringify(initial)}>
      {children}
    </div>
  ),
}));
vi.mock("@/components/navigation-loading", () => ({ NavigationLoading: () => <i>nav-loading</i> }));
vi.mock("@/components/ui/toaster", () => ({ Toaster: () => <i>toaster</i> }));
vi.mock("@/components/ui/scroll-to-top", () => ({ ScrollToTop: () => <i>scroll-top</i> }));

function user(overrides: Partial<Me> = {}): Me {
  return {
    id: "u1",
    username: "ann",
    full_name: "Ann",
    is_superuser: false,
    global_permissions: [],
    impersonator: null,
    ...overrides,
  } as unknown as Me;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.theme.siteName = "";
  window.localStorage.clear();
  resetAllShortcuts();
});

describe("TopBar", () => {
  it("uses the prop name, then the theme's, then the default", () => {
    const first = render(<TopBar siteName="Acme" user={user()} />);
    expect(screen.getByTestId("wordmark")).toHaveTextContent("Acme");
    first.unmount();

    m.theme.siteName = "Themed";
    const second = render(<TopBar siteName="Acme" user={user()} />);
    expect(screen.getByTestId("wordmark")).toHaveTextContent("Themed");
    second.unmount();

    m.theme.siteName = undefined;
    render(<TopBar user={user()} />);
    expect(screen.getByTestId("wordmark")).toHaveTextContent("WikiHub");
  });

  it("shows the search shortcut hint and opens the search dialog", async () => {
    render(<TopBar user={user()} />);
    expect(document.querySelector("kbd")).not.toBeNull();
    expect(screen.getByRole("link", { name: /help/i })).toHaveAttribute("href", "/help");
    await userEvent.click(screen.getByRole("button", { name: /search/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("drops the hint when the shortcut is unbound", () => {
    setBindings("search.open", []);
    render(<TopBar user={user()} />);
    expect(document.querySelector("kbd")).toBeNull();
  });
});

describe("AppMain", () => {
  function renderMain(props: Partial<React.ComponentProps<typeof AppMain>>, collapsed = false) {
    return render(
      <SidebarProvider initialCollapsed={collapsed} initialSidebarWidth={300}>
        <AppMain {...props}>
          <p>content</p>
        </AppMain>
      </SidebarProvider>,
    );
  }

  it("pads for the sidebar, or the collapsed rail", () => {
    const first = renderMain({});
    expect(document.querySelector("main")).toHaveClass("md:pl-(--app-sidebar-width)");
    first.unmount();
    window.localStorage.setItem("wikihub:sidebar-collapsed", "true");
    renderMain({}, true);
    expect(document.querySelector("main")).toHaveClass("md:pl-14");
  });

  it("supports a banner, full width, extra classes and no sidebar offset", () => {
    renderMain({
      banner: <div>top banner</div>,
      hasBanner: true,
      fullWidth: true,
      contentClassName: "extra",
      disableSidebarOffset: true,
    });
    expect(screen.getByText("top banner")).toBeInTheDocument();
    const wrapper = screen.getByText("content").parentElement!;
    expect(wrapper).toHaveClass("pb-24", "extra", "w-full");
    expect(wrapper).not.toHaveClass("max-w-content");
    expect(document.querySelector("main")).not.toHaveClass("md:pl-14");
  });
});

describe("AppShell", () => {
  beforeEach(() => {
    m.getSidebarPermissions.mockResolvedValue({});
    m.getSidebarPreferences.mockResolvedValue({ collapsed: false, appWidth: 256 });
    m.listFavoriteSpaces.mockResolvedValue([{}, {}]);
    m.listOwnPinnedPages.mockResolvedValue([{}]);
    m.getMailSummary.mockResolvedValue({ has_inbox: true, unread_count: 3 });
    m.getNotificationSummary.mockResolvedValue({ unread: 1 });
  });

  async function renderShell(me: Me, props: Partial<React.ComponentProps<typeof AppShell>> = {}) {
    render(
      await AppShell({
        siteName: "Acme",
        user: me,
        children: <p>page body</p>,
        ...props,
      }),
    );
  }

  it("renders the chrome around a member's page, without polling mail", async () => {
    await renderShell(user());
    expect(screen.getByText("page body")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar")).toHaveTextContent("2/1");
    expect(screen.getByTestId("mail")).toHaveAttribute("data-poll", "false");
    expect(m.getMailSummary).not.toHaveBeenCalled();
    expect(screen.getByText("mailbox-banner")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("loads the mailbox summary for administrators", async () => {
    await renderShell(user({ is_superuser: true }));
    expect(screen.getByTestId("mail")).toHaveAttribute("data-poll", "true");
    expect(m.getMailSummary).toHaveBeenCalled();
    m.getMailSummary.mockClear();
    document.body.innerHTML = "";
    await renderShell(user({ global_permissions: ["system_admin"] } as Partial<Me>));
    expect(m.getMailSummary).toHaveBeenCalled();
  });

  it("hides the sidebar and skips its data when asked", async () => {
    await renderShell(user(), { hideSidebar: true });
    expect(screen.queryByTestId("sidebar")).not.toBeInTheDocument();
    expect(m.listFavoriteSpaces).not.toHaveBeenCalled();
    expect(m.listOwnPinnedPages).not.toHaveBeenCalled();
  });

  it("keeps working when pinned pages are not available yet", async () => {
    m.listOwnPinnedPages.mockRejectedValue(new Error("no table"));
    await renderShell(user());
    expect(screen.getByTestId("sidebar")).toHaveTextContent("2/0");
  });

  it("shows the impersonation banner", async () => {
    const real = { username: "root" } as unknown as Me["impersonator"];
    await renderShell(user({ impersonator: real } as Partial<Me>));
    expect(screen.getByRole("status")).toHaveTextContent("root");
  });
});

describe("Providers", () => {
  function Retry() {
    const client = useQueryClient();
    const retry = client.getDefaultOptions().queries!.retry as (n: number, e: unknown) => boolean;
    return (
      <ul>
        <li data-testid="plain">{String(retry(0, new Error("x")))}</li>
        <li data-testid="exhausted">{String(retry(2, new Error("x")))}</li>
        <li data-testid="api-fatal">{String(retry(0, new ApiError(403, "forbidden", "no")))}</li>
        <li data-testid="api-retry">{String(retry(0, new ApiError(503, "down", "later")))}</li>
      </ul>
    );
  }

  it("wires the providers and a sensible retry policy", () => {
    render(
      <Providers initialSiteName="Acme" initialThemeColor="rose" initialLocale="vi">
        <Retry />
      </Providers>,
    );
    expect(screen.getByText("toaster")).toBeInTheDocument();
    expect(screen.getByText("scroll-top")).toBeInTheDocument();
    expect(screen.getByText("nav-loading")).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId("theme").dataset.props!)).toMatchObject({
      initialSiteName: "Acme",
      initialThemeColor: "rose",
    });
    expect(screen.getByTestId("plain")).toHaveTextContent("true");
    expect(screen.getByTestId("exhausted")).toHaveTextContent("false");
    expect(screen.getByTestId("api-fatal")).toHaveTextContent("false");
    expect(screen.getByTestId("api-retry")).toHaveTextContent("true");
  });
});
