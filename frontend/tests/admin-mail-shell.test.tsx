import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MailboxPasswordBanner } from "@/components/layout/mailbox-password-banner";
import { MailSummaryProvider } from "@/components/layout/mail-summary-provider";
import { formatBadgeCount } from "@/components/layout/notification-bell";
import { Sidebar } from "@/components/layout/sidebar";
import { SidebarProvider } from "@/components/layout/sidebar-context";
import { api } from "@/lib/api-client";
import type { InboxItem, MailSummary, Me, SidebarPermissions } from "@/types/api";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const NONE: MailSummary = {
  has_mailbox: false,
  mailbox_id: null,
  mailbox_email: null,
  health_status: null,
  health_error: null,
  unread_count: 0,
  can_send_account_mail: false,
};

const WORKING: MailSummary = {
  has_mailbox: true,
  mailbox_id: "mb-1",
  mailbox_email: "ops@example.test",
  health_status: "ok",
  health_error: null,
  unread_count: 3,
  can_send_account_mail: true,
};

function withSummary(summary: MailSummary, ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MailSummaryProvider initial={summary} poll={false}>
        {ui}
      </MailSummaryProvider>
    </QueryClientProvider>,
  );
}

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: "req-1",
    kind: "password_reset",
    requester_name: "Alice",
    requester_email: "alice@example.org",
    requester_username: null,
    message: "I forgot my password",
    created_at: "2026-09-28T08:00:00Z",
    read_at: null,
    resolved_at: null,
    delivery_status: "sent",
    delivery_error: null,
    mailbox_email: "ops@example.test",
    ...overrides,
  };
}

describe("formatBadgeCount", () => {
  it("caps a large count", () => {
    expect(formatBadgeCount(7)).toBe("7");
    expect(formatBadgeCount(99)).toBe("99");
    expect(formatBadgeCount(100)).toBe("99+");
  });
});

describe("MailboxPasswordBanner", () => {
  it("stays out of the way while the mailbox works", () => {
    withSummary(WORKING, <MailboxPasswordBanner />);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("is not shown to an account without a mailbox", () => {
    withSummary({ ...NONE, health_status: "auth_failed" }, <MailboxPasswordBanner />);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each(["unreachable", "error", "unknown"] as const)(
    "does not nag about the password when the state is %s",
    (health) => {
      // Not a password problem, so telling them to change it would be wrong.
      withSummary({ ...WORKING, health_status: health }, <MailboxPasswordBanner />);

      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("demands a new password when the mail server rejects the current one", () => {
    withSummary(
      { ...WORKING, health_status: "auth_failed", health_error: "535 expired" },
      <MailboxPasswordBanner />,
    );

    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("Your mailbox needs a new password");
    expect(banner).toHaveTextContent("ops@example.test");
    expect(screen.getByRole("link", { name: "Update password" })).toHaveAttribute(
      "href",
      "/admin/mail?update=mb-1",
    );
  });
});

function makeAdmin(): Me {
  return {
    id: "user-1",
    username: "admin",
    full_name: "Administrator",
    email: "admin@example.com",
    avatar_url: null,
    is_active: true,
    is_superuser: true,
    global_permissions: ["system_admin"],
    impersonator: null,
  } as unknown as Me;
}

const PERMISSIONS: SidebarPermissions = {
  home: ["admin", "member"],
  spaces: ["admin", "member"],
  favorites: ["admin", "member"],
  pinned: ["admin", "member"],
  settings: ["admin"],
  backups: ["admin"],
};

function renderSidebar(summary: MailSummary) {
  return withSummary(
    summary,
    <SidebarProvider initialCollapsed={false} initialSidebarWidth={240}>
      <Sidebar
        user={makeAdmin()}
        permissions={PERMISSIONS}
        favoriteSpaces={[]}
        pinnedPages={[]}
      />
    </SidebarProvider>,
  );
}

describe("Sidebar mail entries", () => {
  it("hides Requests from an administrator whose account has no mailbox", () => {
    renderSidebar(NONE);

    expect(screen.queryByRole("link", { name: /^Requests/ })).toBeNull();
    // Managing mailboxes is for any system administrator, mailbox or not.
    expect(screen.getByRole("link", { name: "Mailboxes" })).toHaveAttribute(
      "href",
      "/admin/mail",
    );
  });

  it("puts Requests with Home and Spaces, not among the administration settings", () => {
    renderSidebar(WORKING);

    const inbox = screen.getByRole("link", { name: "Requests (3)" });
    const home = screen.getByRole("link", { name: "Home" });
    const adminUsers = screen.getByRole("link", { name: "Users" });
    // Same list as Home, and above the Administration section entirely.
    expect(inbox.closest("ul")).toBe(home.closest("ul"));
    expect(inbox.closest("ul")).not.toBe(adminUsers.closest("ul"));
    expect(
      inbox.compareDocumentPosition(adminUsers) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("lists the administration pages in two groups, people and content first", () => {
    renderSidebar(NONE);

    const admin = screen.getByRole("link", { name: "Users" }).closest("ul") as HTMLElement;
    const names = within(admin)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(names).toEqual(["Users", "Groups", "Spaces", "Issues", "Settings", "Mailboxes", "Storage", "Backup"]);
    // One rule, between the groups: above Settings and nowhere else.
    const ruled = [...admin.querySelectorAll("li")].filter((li) =>
      li.className.includes("border-t"),
    );
    expect(ruled.map((li) => li.textContent)).toEqual(["Settings"]);
  });

  it("shows Requests, with the unread count, to the owner of a mailbox", () => {
    renderSidebar(WORKING);

    const inbox = screen.getByRole("link", { name: "Requests (3)" });
    expect(inbox).toHaveAttribute("href", "/admin/inbox");
    expect(inbox).toHaveTextContent("3");
  });

  it("shows no count when nothing is unread", () => {
    renderSidebar({ ...WORKING, unread_count: 0 });

    const inbox = screen.getByRole("link", { name: "Requests" });
    expect(inbox).not.toHaveTextContent(/\d/);
  });

  it("does not re-fetch just because it rendered (polling is the provider's job)", async () => {
    renderSidebar(WORKING);
    fireEvent.focus(window);

    await waitFor(() => expect(api.get).not.toHaveBeenCalled());
  });
});
