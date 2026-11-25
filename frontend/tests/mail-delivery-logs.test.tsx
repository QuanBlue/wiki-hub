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

const BROADCAST_LOG: AdminMailLog = {
  id: "log-1",
  created_at: "2026-11-25T09:00:00Z",
  mailbox_id: "mb-1",
  from_email: "ops@company.com",
  to_email: "a@company.com, b@company.com, c@company.com",
  subject: "[WikiHub] Account request: qa",
  kind: "contact_request",
  status: "partial",
  error_code: "auth_failed",
  error: "c@company.com: 535 Bad credentials",
  recipients: [
    {
      to_email: "a@company.com",
      from_email: "a@company.com",
      mailbox_id: "mb-1",
      status: "sent",
      error_code: null,
      error: null,
    },
    {
      to_email: "b@company.com",
      from_email: "b@company.com",
      mailbox_id: "mb-2",
      status: "sent",
      error_code: null,
      error: null,
    },
    {
      to_email: "c@company.com",
      from_email: "c@company.com",
      mailbox_id: "mb-3",
      status: "failed",
      error_code: "auth_failed",
      error: "535 Bad credentials",
    },
  ],
  actor_id: null,
  actor_username: null,
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
  recipients: null,
  actor_id: "u-1",
  actor_username: "admin",
};

const COUNTS: MailLogCounts = { all: 2, sent: 0, failed: 2 };

describe("MailDeliveryLogs", () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedGet.mockImplementation(async (url: string) => {
      if (url.includes("/logs/counts")) return COUNTS;
      return {
        items: [FAILED_LOG, BROADCAST_LOG],
        total: 2,
        limit: 25,
        offset: 0,
      } satisfies Page<AdminMailLog>;
    });
  });

  it("renders grouped broadcast recipients, supports column sorting, and opens per-recipient breakdown", async () => {
    const actor = userEvent.setup();
    render(<MailDeliveryLogs mailboxes={[MAILBOX]} />);

    await waitFor(() => {
      expect(screen.getByText(/3 recipients/i)).toBeInTheDocument();
      expect(screen.getByText(/Partial \(2\/3\)/i)).toBeInTheDocument();
    });

    await actor.click(screen.getByRole("button", { name: "Subject" }));
    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledWith(
        expect.stringContaining("sort=subject&order=asc"),
      );
    });

    const inspectButtons = screen.getAllByRole("button", { name: "Inspect" });
    await actor.click(inspectButtons[1]!);
    await waitFor(() => {
      expect(screen.getByText("Recipients breakdown")).toBeInTheDocument();
      expect(screen.getAllByText("c@company.com").length).toBeGreaterThanOrEqual(2);
    });
  });
});
