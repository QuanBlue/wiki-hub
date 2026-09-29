import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { InboxList } from "@/components/admin/inbox-list";
import { MailSummaryProvider } from "@/components/layout/mail-summary-provider";
import { NotificationBell } from "@/components/layout/notification-bell";
import { NotificationsProvider } from "@/components/layout/notifications-provider";
import { api } from "@/lib/api-client";
import type { AppNotification, MailSummary, NotificationSummary } from "@/types/api";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  }),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn(), push }),
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const T0 = "2026-09-28T08:00:00Z";
const T1 = "2026-09-28T08:05:00Z";

function note(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: "n-1",
    kind: "space_member_added",
    params: { space: "Docs", role: "editor" },
    link: "/spaces/docs",
    actor_name: "Ada Admin",
    created_at: T1,
    read_at: null,
    ...overrides,
  };
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** The toast message is rich text (see lib/rich-text.tsx) once it has
 * emphasis markers, not a plain string - render it to check what it says and
 * that the emphasis really is there. */
function markup(node: ReactNode): string {
  return renderToStaticMarkup(<>{node}</>);
}
function textOf(node: ReactNode): string {
  return markup(node).replace(/<[^>]+>/g, "");
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(api.get).mockReset();
  vi.mocked(toast).mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.info).mockReset();
  vi.mocked(toast.warning).mockReset();
  push.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("noticing something new without a reload", () => {
  function serve(summary: () => NotificationSummary, items: () => AppNotification[]) {
    vi.mocked(api.get).mockImplementation(async (path: string) =>
      path.includes("/notifications/summary")
        ? summary()
        : { items: items(), total: items().length, limit: 5, offset: 0 },
    );
  }

  it("picks it up on the next poll: the badge changes and a toast says what happened", async () => {
    let now: NotificationSummary = { unread_count: 0, latest_at: T0 };
    let items: AppNotification[] = [];
    serve(
      () => now,
      () => items,
    );
    render(
      <QueryClientProvider client={client()}>
        <NotificationsProvider initial={now}>
          <NotificationBell />
        </NotificationsProvider>
      </QueryClientProvider>,
    );

    now = { unread_count: 1, latest_at: T1 };
    items = [note()];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_500);
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Notifications (1 unread)" })).toBeInTheDocument(),
    );
    // Good news is announced as a success, in words, with a way to go there.
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    const [message, options] = vi.mocked(toast.success).mock.calls[0]!;
    expect(textOf(message as ReactNode)).toBe("Ada Admin added you to the space Docs as editor.");
    // The actor and the space's name are emphasised, not just quoted.
    expect(markup(message as ReactNode)).toContain("<strong>Ada Admin</strong>");
    expect(markup(message as ReactNode)).toContain("<code>Docs</code>");
    expect(options?.action).toMatchObject({ label: "Open" });
    (options!.action as unknown as { onClick: () => void }).onClick();
    expect(push).toHaveBeenCalledWith("/spaces/docs");
  });

  it("colours the toast by what happened", async () => {
    let now: NotificationSummary = { unread_count: 0, latest_at: T0 };
    let items: AppNotification[] = [];
    serve(
      () => now,
      () => items,
    );
    render(
      <QueryClientProvider client={client()}>
        <NotificationsProvider initial={now}>
          <NotificationBell />
        </NotificationsProvider>
      </QueryClientProvider>,
    );

    now = { unread_count: 1, latest_at: T1 };
    items = [note({ kind: "space_member_removed", params: { space: "Docs" }, link: null })];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_500);
    });

    await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
    // Nothing to open, so no button.
    expect(vi.mocked(toast.warning).mock.calls[0]?.[1]?.action).toBeUndefined();
  });

  it("does not announce what was already there when the page loaded", async () => {
    const now: NotificationSummary = { unread_count: 2, latest_at: T1 };
    serve(
      () => now,
      () => [note()],
    );
    render(
      <QueryClientProvider client={client()}>
        <NotificationsProvider initial={now}>
          <NotificationBell />
        </NotificationsProvider>
      </QueryClientProvider>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(35_000);
    });

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("announces each new notification once, not on every poll", async () => {
    let now: NotificationSummary = { unread_count: 0, latest_at: T0 };
    let items: AppNotification[] = [];
    serve(
      () => now,
      () => items,
    );
    render(
      <QueryClientProvider client={client()}>
        <NotificationsProvider initial={now}>
          <NotificationBell />
        </NotificationsProvider>
      </QueryClientProvider>,
    );
    now = { unread_count: 1, latest_at: T1 };
    items = [note()];

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50_000);
    });

    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("caps a burst at three toasts, oldest first", async () => {
    let now: NotificationSummary = { unread_count: 0, latest_at: T0 };
    let items: AppNotification[] = [];
    serve(
      () => now,
      () => items,
    );
    render(
      <QueryClientProvider client={client()}>
        <NotificationsProvider initial={now}>
          <NotificationBell />
        </NotificationsProvider>
      </QueryClientProvider>,
    );
    now = { unread_count: 5, latest_at: "2026-09-28T08:09:00Z" };
    items = [4, 3, 2, 1, 0].map((minute) =>
      note({
        id: `n-${minute}`,
        kind: "group_member_added",
        params: { group: `G${minute}` },
        link: null,
        created_at: `2026-09-28T08:0${5 + minute}:00Z`,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_500);
    });

    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(3));
    const groups = vi.mocked(toast.success).mock.calls.map((call) =>
      textOf(call[0] as ReactNode),
    );
    // The newest three, shown in the order they happened.
    expect(groups[0]).toContain("G2");
    expect(groups[2]).toContain("G4");
  });
});

describe("the Inbox follows new requests", () => {
  it("re-reads its list and tab numbers when a request arrives", async () => {
    let mail: MailSummary = {
      has_mailbox: true,
      mailbox_id: "mb-1",
      mailbox_email: "ops@example.test",
      health_status: "ok",
      health_error: null,
      unread_count: 0,
      latest_request_at: T0,
      can_send_account_mail: true,
    };
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.endsWith("/summary")) return mail;
      if (path.includes("/inbox/counts")) return { all: 0, unread: 0, open: 0, resolved: 0 };
      return { items: [], total: 0, limit: 10, offset: 0 };
    });
    render(
      <QueryClientProvider client={client()}>
        <MailSummaryProvider initial={mail} poll>
          <InboxList />
        </MailSummaryProvider>
      </QueryClientProvider>,
    );
    await screen.findByText("No requests here.");
    const listReads = () =>
      vi.mocked(api.get).mock.calls.filter(([path]) => String(path).includes("/inbox?")).length;
    const before = listReads();

    mail = { ...mail, unread_count: 1, latest_request_at: T1 };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_500);
    });

    await waitFor(() => expect(listReads()).toBeGreaterThan(before));
    expect(
      vi.mocked(api.get).mock.calls.some(([path]) => String(path).includes("/inbox/counts")),
    ).toBe(true);
  });
});
