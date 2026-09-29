import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  AccountEmailNotice,
  NoMailboxEmailNotice,
  notifyAccountEmail,
  notifyAdminGranted,
  notifySpaceAccess,
} from "@/components/admin/account-email-option";
import { MailSummaryProvider } from "@/components/layout/mail-summary-provider";
import { api } from "@/lib/api-client";
import type { MailSummary } from "@/types/api";

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
  unread_count: 0,
  can_send_account_mail: true,
};

const BROKEN: MailSummary = {
  ...WORKING,
  health_status: "auth_failed",
  health_error: "535 expired",
  can_send_account_mail: false,
};

// "Receive requests" switched off: no Inbox (`has_mailbox` false), but the
// mailbox is still connected and must still be able to send account mail.
const CONNECTED_NO_INBOX: MailSummary = {
  ...WORKING,
  has_mailbox: false,
  mailbox_id: null,
};

// No mailbox of the administrator's own at all, but another administrator's
// connected mailbox is available to relay through (the pool).
const VIA_POOL: MailSummary = {
  ...NONE,
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

describe("AccountEmailNotice", () => {
  it("says nothing when the administrator has no mailbox at all", () => {
    withSummary(NONE, <AccountEmailNotice mode="created" />);

    expect(screen.queryByText(/WikiHub will also email/)).toBeNull();
  });

  it("says nothing when the mailbox exists but cannot currently send", () => {
    withSummary(BROKEN, <AccountEmailNotice mode="created" />);

    expect(screen.queryByText(/WikiHub will also email/)).toBeNull();
  });

  it("names the sign-in details and the mailbox for a new account", () => {
    withSummary(WORKING, <AccountEmailNotice mode="created" />);

    expect(screen.getByText(/the sign-in details/)).toBeInTheDocument();
    expect(screen.getByText(/ops@example.test/)).toBeInTheDocument();
    // Automatic - no checkbox to remember to tick.
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("names the new password for a reset", () => {
    withSummary(WORKING, <AccountEmailNotice mode="reset" />);

    expect(screen.getByText(/the new password/)).toBeInTheDocument();
  });

  it("still offers to send when the mailbox has no Inbox of its own", () => {
    withSummary(CONNECTED_NO_INBOX, <AccountEmailNotice mode="created" />);

    expect(screen.getByText(/the sign-in details/)).toBeInTheDocument();
  });

  it("says so for an administrator grant too", () => {
    withSummary(WORKING, <AccountEmailNotice mode="admin" />);

    expect(screen.getByText(/WikiHub will also let them know by email/)).toBeInTheDocument();
  });

  it("names no specific mailbox when the send would go through the pool", () => {
    withSummary(VIA_POOL, <AccountEmailNotice mode="created" />);

    expect(screen.getByText(/the sign-in details/)).toBeInTheDocument();
    expect(screen.getByText(/relayed through another administrator/)).toBeInTheDocument();
    expect(screen.queryByText(/from your mailbox/)).toBeNull();
  });
});

describe("NoMailboxEmailNotice", () => {
  it("says nothing when the mailbox can actually send", () => {
    withSummary(WORKING, <NoMailboxEmailNotice>tell them yourself.</NoMailboxEmailNotice>);

    expect(screen.queryByText(/No mailbox connected/)).toBeNull();
  });

  it("tells the administrator to do it themselves when there is no mailbox at all", () => {
    withSummary(NONE, <NoMailboxEmailNotice>tell them yourself.</NoMailboxEmailNotice>);

    expect(screen.getByText(/No mailbox connected/)).toBeInTheDocument();
    expect(screen.getByText(/tell them yourself\./)).toBeInTheDocument();
  });

  it("also fires when the mailbox exists but cannot currently send", () => {
    withSummary(BROKEN, <NoMailboxEmailNotice>tell them yourself.</NoMailboxEmailNotice>);

    expect(screen.getByText(/No mailbox connected/)).toBeInTheDocument();
  });

  it("says nothing when the pool covers an account with no mailbox of its own", () => {
    withSummary(VIA_POOL, <NoMailboxEmailNotice>tell them yourself.</NoMailboxEmailNotice>);

    expect(screen.queryByText(/No mailbox connected/)).toBeNull();
  });
});

describe("notifyAccountEmail", () => {
  it("posts to the account-created endpoint with the login URL", async () => {
    vi.mocked(api.post).mockResolvedValue({ email_sent: true, email_error: null });

    const result = await notifyAccountEmail("created", "u-1", "Zx7kQm2Rt9WpAb4c");

    expect(api.post).toHaveBeenCalledWith("/api/v1/admin-mail/notify-account-created", {
      user_id: "u-1",
      password: "Zx7kQm2Rt9WpAb4c",
      login_url: `${window.location.origin}/login`,
    });
    expect(result).toEqual({ email_sent: true, email_error: null });
  });

  it("posts to the password-reset endpoint for a reset", async () => {
    vi.mocked(api.post).mockResolvedValue({ email_sent: false, email_error: "535 expired" });

    await notifyAccountEmail("reset", "u-2", "AnotherPassw0rd");

    expect(api.post).toHaveBeenCalledWith(
      "/api/v1/admin-mail/notify-password-reset",
      expect.objectContaining({ user_id: "u-2", password: "AnotherPassw0rd" }),
    );
  });

  it("returns null instead of throwing when the request itself fails", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("network down"));

    const result = await notifyAccountEmail("created", "u-1", "Zx7kQm2Rt9WpAb4c");

    expect(result).toBeNull();
  });
});

describe("notifyAdminGranted", () => {
  it("posts to the admin-granted endpoint with the login URL", async () => {
    vi.mocked(api.post).mockResolvedValue({ email_sent: true, email_error: null });

    const result = await notifyAdminGranted("u-1");

    expect(api.post).toHaveBeenCalledWith("/api/v1/admin-mail/notify-admin-granted", {
      user_id: "u-1",
      login_url: `${window.location.origin}/login`,
    });
    expect(result).toEqual({ email_sent: true, email_error: null });
  });

  it("returns null instead of throwing when the request itself fails", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("network down"));

    expect(await notifyAdminGranted("u-1")).toBeNull();
  });
});

describe("notifySpaceAccess", () => {
  it("posts to the space-access endpoint with the space key and added flag", async () => {
    vi.mocked(api.post).mockResolvedValue({ email_sent: true, email_error: null });

    const result = await notifySpaceAccess("u-1", "ENG", true);

    expect(api.post).toHaveBeenCalledWith("/api/v1/admin-mail/notify-space-access", {
      user_id: "u-1",
      space_key: "ENG",
      added: true,
      login_url: `${window.location.origin}/login`,
    });
    expect(result).toEqual({ email_sent: true, email_error: null });
  });

  it("posts added: false for a removal", async () => {
    vi.mocked(api.post).mockResolvedValue({ email_sent: true, email_error: null });

    await notifySpaceAccess("u-1", "ENG", false);

    expect(api.post).toHaveBeenCalledWith(
      "/api/v1/admin-mail/notify-space-access",
      expect.objectContaining({ added: false }),
    );
  });

  it("returns null instead of throwing when the request itself fails", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("network down"));

    expect(await notifySpaceAccess("u-1", "ENG", true)).toBeNull();
  });
});
