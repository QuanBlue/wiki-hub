import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MailDeliveryLogs } from "@/components/admin/mail-delivery-logs";
import { api } from "@/lib/api-client";
import type { AdminMailbox, AdminMailLog, MailLogCounts, Page } from "@/types/api";

vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(),
  },
}));

const mockedGet = vi.mocked(api.get);

const MAILBOX: AdminMailbox = {
  id: "mb-1",
  user_id: "u-1",
  username: "admin",
  user_full_name: "Admin",
  user_is_active: true,
  email: "ops@company.com",
  display_name: "WikiHub",
  smtp_host: "smtp.company.com",
  smtp_port: 587,
  smtp_security: "starttls",
  smtp_username: "ops@company.com",
  has_password: true,
  is_enabled: true,
  effective_enabled: true,
  health_status: "ok",
  health_checked_at: "2026-11-25T08:00:00Z",
  health_error: null,
  created_at: "2026-11-01T08:00:00Z",
};

const SENT_LOG: AdminMailLog = {
  id: "log-1",
  created_at: "2026-11-25T09:00:00Z",
  mailbox_id: "mb-1",
  from_email: "ops@company.com",
  to_email: "alice@company.com",
  subject: "[WikiHub] Your account has been created",
  kind: "account_created",
  status: "sent",
  error_code: null,
  error: null,
  actor_id: "u-1",
  actor_username: "admin",
};

const FAILED_LOG: AdminMailLog = {
  id: "log-2",
  created_at: "2026-11-25T09:05:00Z",
  mailbox_id: "mb-1",
  from_email: "ops@company.com",
  to_email: "bad@wikihub.local",
  subject: "[WikiHub] Your password has been reset",
  kind: "password_reset",
  status: "failed",
  error_code: "undeliverable",
  error: "Recipient address 'bad@wikihub.local' uses a non-routable or invalid domain.",
  actor_id: "u-1",
  actor_username: "admin",
};

const COUNTS: MailLogCounts = { all: 2, sent: 1, failed: 1 };

describe("MailDeliveryLogs", () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedGet.mockImplementation(async (url: string) => {
      if (url.includes("/logs/counts")) return COUNTS;
      if (url.includes("status=failed")) {
        return { items: [FAILED_LOG], total: 1, limit: 25, offset: 0 } satisfies Page<AdminMailLog>;
      }
      return {
        items: [FAILED_LOG, SENT_LOG],
        total: 2,
        limit: 25,
        offset: 0,
      } satisfies Page<AdminMailLog>;
    });
  });

  it("loads delivery logs, filters by failed status, and opens failure details", async () => {
    const actor = userEvent.setup();
    render(<MailDeliveryLogs mailboxes={[MAILBOX]} />);

    await waitFor(() => {
      expect(screen.getByText("alice@company.com")).toBeInTheDocument();
      expect(screen.getByText("bad@wikihub.local")).toBeInTheDocument();
    });

    await actor.click(screen.getByRole("tab", { name: /Failed/i }));
    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/admin-mail/logs?status=failed"),
      );
      expect(screen.queryByText("alice@company.com")).not.toBeInTheDocument();
    });

    await actor.click(screen.getByRole("button", { name: "Inspect" }));
    await waitFor(() => {
      expect(screen.getByText("Email delivery details")).toBeInTheDocument();
      expect(screen.getByText("undeliverable")).toBeInTheDocument();
    });
  });
});
