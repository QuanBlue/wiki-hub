import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MailSummaryProvider } from "@/components/layout/mail-summary-provider";
import { NotificationBell } from "@/components/layout/notification-bell";
import { NotificationsProvider } from "@/components/layout/notifications-provider";
import { api } from "@/lib/api-client";
import { translate } from "@/lib/i18n/core";
import { describeNotification, notificationMeta } from "@/lib/notification-meta";
import { formatRelative } from "@/lib/relative-time";
import type { AppNotification, MailSummary, NotificationSummary } from "@/types/api";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const t = (key: string, vars?: Record<string, string | number>) => translate("en", key, vars);

function note(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: "n-1",
    kind: "space_member_added",
    params: { space: "Docs", role: "editor" },
    link: "/spaces/docs",
    actor_name: "Ada Admin",
    created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    read_at: null,
    ...overrides,
  };
}

const NONE: NotificationSummary = { unread_count: 0, latest_at: null };

const NO_MAILBOX: MailSummary = {
  has_mailbox: false,
  mailbox_id: null,
  mailbox_email: null,
  health_status: null,
  health_error: null,
  unread_count: 0,
  can_send_account_mail: false,
};

function mount(
  items: AppNotification[],
  { unread = items.filter((n) => !n.read_at).length, mail = NO_MAILBOX } = {},
) {
  const summary: NotificationSummary = {
    unread_count: unread,
    latest_at: items[0]?.created_at ?? null,
  };
  vi.mocked(api.get).mockImplementation(async (path: string) =>
    path.includes("/notifications/summary")
      ? summary
      : { items, total: items.length, limit: 20, offset: 0 },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NotificationsProvider initial={summary}>
        <MailSummaryProvider initial={mail} poll={false}>
          <NotificationBell />
        </MailSummaryProvider>
      </NotificationsProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.patch).mockReset();
});

describe("the bell", () => {
  it("is there for everyone, not only administrators", () => {
    mount([]);

    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
  });

  it("shows the unread count on the badge and in its accessible name", () => {
    mount([note(), note({ id: "n-2" })]);

    const bell = screen.getByRole("button", { name: "Notifications (2 unread)" });
    expect(bell).toHaveTextContent("2");
  });

  it("has no badge once everything is read", () => {
    mount([note({ read_at: new Date().toISOString() })]);

    expect(screen.getByRole("button", { name: "Notifications" })).not.toHaveTextContent(/\d/);
  });

  it("lists what happened in words, newest first, each leading where it belongs", async () => {
    mount([
      note(),
      note({
        id: "n-2",
        kind: "password_reset_by_admin",
        params: {},
        link: null,
        read_at: new Date().toISOString(),
      }),
    ]);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Notifications/ }));

    const added = await screen.findByRole("link", { name: /added you to the space Docs as editor/ });
    expect(added).toHaveAttribute("href", "/spaces/docs");
    // Markers are parsed away, not shown literally - the actor's name and the
    // space's name are emphasised (bold, code) rather than surrounded by them.
    expect(added).toHaveTextContent("Ada Admin added you to the space Docs as editor.");
    expect(added.querySelector("strong")).toHaveTextContent("Ada Admin");
    expect(added.querySelector("code")).toHaveTextContent("Docs");
    expect(added.querySelector("em")).toHaveTextContent("editor");
    expect(added).toHaveTextContent("5 minutes ago");
    // Unread ones say so; read ones do not.
    expect(within(added).getByRole("img", { name: "Unread" })).toBeInTheDocument();
    const reset = screen.getByRole("button", { name: /reset your password/ });
    expect(within(reset).queryByRole("img", { name: "Unread" })).toBeNull();
  });

  it("marks a notification read when it is opened", async () => {
    mount([note()]);
    vi.mocked(api.patch).mockResolvedValue(note({ read_at: new Date().toISOString() }));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Notifications/ }));

    await user.click(await screen.findByRole("link", { name: /added you to the space/ }));

    expect(api.patch).toHaveBeenCalledWith("/api/v1/notifications/n-1", { read: true });
  });

  it("marks everything read in one go, and offers that only while something is unread", async () => {
    mount([note(), note({ id: "n-2" })]);
    // Once the server has been told, it reports nothing unread any more.
    vi.mocked(api.post).mockImplementation(async () => {
      vi.mocked(api.get).mockImplementation(async (path: string) =>
        path.includes("/notifications/summary")
          ? NONE
          : { items: [], total: 0, limit: 20, offset: 0 },
      );
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Notifications/ }));

    await user.click(await screen.findByRole("button", { name: /Mark all as read/ }));

    expect(api.post).toHaveBeenCalledWith("/api/v1/notifications/read-all");
    expect(screen.queryByRole("img", { name: "Unread" })).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Mark all as read/ })).toBeDisabled(),
    );
  });

  it("is calm when there is nothing to show", async () => {
    mount([]);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Notifications" }));

    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
  });

  it("only offers Requests to someone who has a mailbox", async () => {
    const user = userEvent.setup();
    const { unmount } = mount([note()]);
    await user.click(screen.getByRole("button", { name: /Notifications/ }));
    await screen.findByRole("link", { name: /added you/ });
    expect(screen.queryByRole("link", { name: "Open Requests" })).toBeNull();
    unmount();

    mount([note()], {
      mail: { ...NO_MAILBOX, has_mailbox: true, mailbox_id: "mb-1", mailbox_email: "a@b.test" },
    });
    await user.click(screen.getByRole("button", { name: /Notifications/ }));
    expect(await screen.findByRole("link", { name: "Open Requests" })).toHaveAttribute(
      "href",
      "/admin/inbox",
    );
  });

  it("copes with a kind it has never heard of", async () => {
    mount([note({ kind: "something_new", params: {}, link: null })]);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Notifications/ }));

    expect(await screen.findByText("Something changed on your account.")).toBeInTheDocument();
  });

  it("says so if the list cannot be loaded", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.includes("/summary")) return NONE;
      throw new Error("down");
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <NotificationsProvider initial={NONE}>
          <NotificationBell />
        </NotificationsProvider>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Notifications" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Could not load your notifications."),
    );
  });
});

describe("how each kind is worded and coloured", () => {
  // `describeNotification` itself returns the raw dictionary string, markers
  // and all - it is whoever displays it (the bell, a toast) that parses them
  // with `richText`, so the expected strings here keep the ** / ` / * marks.
  it.each([
    [
      "space_role_changed",
      { space: "Docs", role: "admin" },
      "**Ada** changed your role in `Docs` to *administrator*.",
    ],
    [
      "space_permission_granted",
      { space: "Docs", permission: "export" },
      "**Ada** gave you *export* access to `Docs`.",
    ],
    ["space_owner_added", { space: "Docs" }, "**Ada** made you an owner of `Docs`."],
    [
      "group_member_removed",
      { group: "Ops" },
      "**Ada** removed you from the group `Ops`.",
    ],
    ["role_changed", { role: "member" }, "**Ada** changed your role to *member*."],
    [
      "admin_request",
      { name: "Quân", type: "account" },
      "New *account request* from `Quân`.",
    ],
  ])("%s", (kind, params, sentence) => {
    expect(
      describeNotification(t, note({ kind, params, actor_name: "Ada" })),
    ).toBe(sentence);
  });

  it("falls back to 'An administrator' when nobody in particular did it", () => {
    expect(
      describeNotification(t, note({ kind: "account_enabled", params: {}, actor_name: null })),
    ).toBe("**An administrator** switched your account back on.");
  });

  it("colours good news, changes and removals differently", () => {
    expect(notificationMeta("space_member_added").tone).toBe("success");
    expect(notificationMeta("role_changed").tone).toBe("info");
    expect(notificationMeta("space_member_removed").tone).toBe("warning");
    expect(notificationMeta("password_reset_by_admin").tone).toBe("warning");
    expect(notificationMeta("who_knows").tone).toBe("info");
  });
});

describe("formatRelative", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");

  it.each([
    ["2026-09-28T11:59:40Z", "now"],
    ["2026-09-28T11:55:00Z", "5 minutes ago"],
    ["2026-09-28T09:00:00Z", "3 hours ago"],
    ["2026-09-27T11:00:00Z", "yesterday"],
    ["2026-09-21T12:00:00Z", "7 days ago"],
  ])("%s reads as %s", (iso, expected) => {
    expect(formatRelative(iso, "en", now)).toBe(expected);
  });
});
