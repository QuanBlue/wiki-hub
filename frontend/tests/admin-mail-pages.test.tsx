import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ContactAdminForm } from "@/components/auth/contact-admin-form";
import { InboxList } from "@/components/admin/inbox-list";
import { MailboxPanel } from "@/components/admin/mailbox-panel";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api-client";
import type { AdminAccount, AdminMailbox, InboxItem, Page } from "@/types/api";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.patch).mockReset();
  vi.mocked(api.put).mockReset();
  vi.mocked(api.delete).mockReset();
});

describe("ContactAdminForm", () => {
  async function fill(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/^Your name/u), "Alice Nguyen");
    await user.type(screen.getByLabelText(/^Your email/u), "alice@example.org");
    await user.type(screen.getByLabelText(/^Message/u), "Please create an account.");
  }

  it("shows the request type by name, not by its raw value", () => {
    render(<ContactAdminForm />);

    expect(screen.getByRole("button", { name: "What do you need?" })).toHaveTextContent(
      "Create an account for me",
    );
  });

  it("cannot be sent until the name and a valid email are filled in", async () => {
    const user = userEvent.setup();
    render(<ContactAdminForm />);
    const send = screen.getByRole("button", { name: "Send request" });

    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText(/^Your name/u), "Alice");
    await user.type(screen.getByLabelText(/^Your email/u), "not-an-address");
    expect(send).toBeDisabled();

    await user.clear(screen.getByLabelText(/^Your email/u));
    await user.type(screen.getByLabelText(/^Your email/u), "alice@example.org");
    // No message needed.
    expect(send).toBeEnabled();
  });

  it("marks what is required with a red asterisk, and the message as optional", () => {
    render(<ContactAdminForm />);

    for (const name of [/^Your name/u, /^Your email/u]) {
      const input = screen.getByLabelText(name);
      expect(input).toBeRequired();
      const label = document.querySelector(`label[for="${input.id}"]`);
      expect(label?.querySelector("span.text-danger")?.textContent).toBe("*");
    }
    const message = screen.getByLabelText(/^Message/u);
    expect(message).not.toBeRequired();
    expect(message.closest("div")).toHaveTextContent("(optional)");
    expect(message.closest("div")?.querySelector("span.text-danger")).toBeNull();
  });

  it("sends a request with no message", async () => {
    vi.mocked(api.post).mockResolvedValue({ delivery: "sent" });
    const user = userEvent.setup();
    render(<ContactAdminForm />);

    await user.type(screen.getByLabelText(/^Your name/u), "Alice");
    await user.type(screen.getByLabelText(/^Your email/u), "alice@example.org");
    await user.click(screen.getByRole("button", { name: "Send request" }));

    expect(api.post).toHaveBeenCalledWith(
      "/api/v1/contact-admin",
      expect.objectContaining({ message: "" }),
    );
    expect(await screen.findByText("Request sent")).toBeInTheDocument();
  });

  it("sends the request without a username or the honeypot filled in, and confirms quietly when it was emailed", async () => {
    vi.mocked(api.post).mockResolvedValue({ delivery: "sent" });
    const user = userEvent.setup();
    render(<ContactAdminForm />);

    await fill(user);
    await user.click(screen.getByRole("button", { name: "Send request" }));

    expect(api.post).toHaveBeenCalledWith("/api/v1/contact-admin", {
      kind: "account",
      requester_name: "Alice Nguyen",
      requester_email: "alice@example.org",
      requester_username: null,
      message: "Please create an account.",
      website: "",
    });
    expect(await screen.findByText("Request sent")).toBeInTheDocument();
    expect(
      screen.getByText("An administrator will get back to you by email as soon as they can."),
    ).toBeInTheDocument();
    // What was sent is summarised, so they can see it went through as intended.
    const summary = document.querySelector("dl");
    expect(summary).toHaveTextContent("RequestCreate an account for me");
    expect(summary).toHaveTextContent("NameAlice Nguyen");
    expect(summary).toHaveTextContent("Reply toalice@example.org");
    // One mailbox got it, so there is nothing to warn about.
    expect(screen.queryByText("The email couldn't be delivered")).toBeNull();
  });

  it("offers a way back to sign in from the sent screen, and another request", async () => {
    vi.mocked(api.post).mockResolvedValue({ delivery: "sent" });
    const back = vi.fn();
    const user = userEvent.setup();
    render(<ContactAdminForm onBackToSignIn={back} />);

    await fill(user);
    await user.click(screen.getByRole("button", { name: "Send request" }));
    await user.click(await screen.findByRole("button", { name: "Back to sign in" }));

    expect(back).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Send another request" })).toBeInTheDocument();
  });

  it("tells the requester, in a small notice, when no administrator could be emailed", async () => {
    vi.mocked(api.post).mockResolvedValue({ delivery: "failed" });
    const user = userEvent.setup();
    render(<ContactAdminForm />);

    await fill(user);
    await user.click(screen.getByRole("button", { name: "Send request" }));

    expect(await screen.findByText("Request sent")).toBeInTheDocument();
    expect(screen.getByText("The email couldn't be delivered")).toBeInTheDocument();
    expect(screen.getByText(/tell your administrator directly/)).toBeInTheDocument();
  });

  it("explains when no administrator mailbox exists at all", async () => {
    vi.mocked(api.post).mockResolvedValue({ delivery: "no_mailbox" });
    const user = userEvent.setup();
    render(<ContactAdminForm />);

    await fill(user);
    await user.click(screen.getByRole("button", { name: "Send request" }));

    expect(
      await screen.findByText(/no administrator mailbox is set up yet/),
    ).toBeInTheDocument();
  });

  it("says so plainly when the requester is being throttled", async () => {
    vi.mocked(api.post).mockRejectedValue(new ApiError(429, "rate_limited", "Too many"));
    const user = userEvent.setup();
    render(<ContactAdminForm />);

    await fill(user);
    await user.click(screen.getByRole("button", { name: "Send request" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many requests. Please wait a while and try again.",
    );
    // Their words are still there to retry with.
    expect(screen.getByLabelText(/^Message/u)).toHaveValue("Please create an account.");
  });

  it("lets them send another request afterwards", async () => {
    vi.mocked(api.post).mockResolvedValue({ delivery: "sent" });
    const user = userEvent.setup();
    render(<ContactAdminForm />);

    await fill(user);
    await user.click(screen.getByRole("button", { name: "Send request" }));
    await user.click(await screen.findByRole("button", { name: "Send another request" }));

    expect(screen.getByLabelText(/^Your name/u)).toHaveValue("");
  });

  it("asks only for a username and email on a password reset, not a name", async () => {
    vi.mocked(api.post).mockResolvedValue({ delivery: "sent" });
    const user = userEvent.setup();
    render(<ContactAdminForm />);

    await user.click(screen.getByRole("button", { name: "What do you need?" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Reset my password" }));

    expect(screen.queryByLabelText(/^Your name/u)).toBeNull();
    const send = screen.getByRole("button", { name: "Send request" });
    expect(send).toBeDisabled();

    const usernameInput = screen.getByLabelText(/^Username/u);
    expect(usernameInput).toBeRequired();
    await user.type(usernameInput, "alice");
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText(/^Your email/u), "alice@example.org");
    expect(send).toBeEnabled();

    await user.click(send);

    expect(api.post).toHaveBeenCalledWith(
      "/api/v1/contact-admin",
      expect.objectContaining({
        kind: "password_reset",
        requester_name: "alice",
        requester_email: "alice@example.org",
        requester_username: "alice",
      }),
    );
    await screen.findByText("Request sent");
    const summary = document.querySelector("dl");
    expect(summary).toHaveTextContent("Usernamealice");
    expect(
      [...(summary?.querySelectorAll("dt") ?? [])].map((dt) => dt.textContent),
    ).not.toContain("Name");
  });
});

function mailbox(overrides: Partial<AdminMailbox> = {}): AdminMailbox {
  return {
    id: "mb-1",
    user_id: "u-1",
    username: "ada",
    user_full_name: "Ada Admin",
    user_is_active: true,
    email: "ada@example.test",
    display_name: null,
    smtp_host: "smtp.example.test",
    smtp_port: 587,
    smtp_security: "starttls",
    smtp_username: "ada@example.test",
    has_password: true,
    is_enabled: true,
    effective_enabled: true,
    health_status: "ok",
    health_checked_at: "2026-09-28T08:00:00Z",
    health_error: null,
    created_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

const ADMINS = [
  { id: "u-1", username: "ada", full_name: "Ada Admin" },
  { id: "u-2", username: "grace", full_name: "Grace Admin" },
] as unknown as AdminAccount[];

describe("MailboxPanel", () => {
  it("guides the first mailbox when there are none", () => {
    render(<MailboxPanel initialMailboxes={[]} administrators={ADMINS} />);

    expect(screen.getByText("No mailboxes yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add mailbox/ })).toBeInTheDocument();
  });

  it("shows a readable label before any menu has been opened", async () => {
    const user = userEvent.setup();
    render(<MailboxPanel administrators={ADMINS} initialMailboxes={[]} />);

    await user.click(screen.getByRole("button", { name: /Add mailbox/ }));

    // Nothing has been picked yet, and nothing raw ("custom") leaks through.
    expect(screen.getByRole("button", { name: "Provider" })).toHaveTextContent(
      "Other / custom",
    );
    expect(screen.getByRole("button", { name: "Administrator account" })).toHaveTextContent(
      "Choose an account",
    );
  });

  it("labels each mailbox with what is actually wrong with it", () => {
    render(
      <MailboxPanel
        administrators={ADMINS}
        initialMailboxes={[
          mailbox({ id: "a", email: "ok@example.test" }),
          mailbox({
            id: "b",
            email: "expired@example.test",
            health_status: "auth_failed",
            health_error: "535 password expired",
          }),
          mailbox({ id: "c", email: "down@example.test", health_status: "unreachable" }),
          mailbox({ id: "d", email: "off@example.test", is_enabled: false, effective_enabled: false }),
          mailbox({
            id: "e",
            email: "gone@example.test",
            user_is_active: false,
            effective_enabled: false,
          }),
        ]}
      />,
    );

    const row = (email: string) => screen.getByText(email).closest("tr") as HTMLElement;
    expect(within(row("ok@example.test")).getByText("Working")).toBeInTheDocument();
    const expired = within(row("expired@example.test"));
    expect(expired.getByText("Needs new password")).toBeInTheDocument();
    expect(expired.getByText("535 password expired")).toBeInTheDocument();
    expect(within(row("down@example.test")).getByText("Can't connect")).toBeInTheDocument();
    expect(within(row("off@example.test")).getByText("Switched off")).toBeInTheDocument();
    // A disabled account outranks a stale health result.
    expect(within(row("gone@example.test")).getByText("Account disabled")).toBeInTheDocument();
  });

  it("opens the password dialog straight away when arriving from the banner", () => {
    render(
      <MailboxPanel
        administrators={ADMINS}
        initialMailboxes={[mailbox({ health_status: "auth_failed" })]}
        initialUpdateId="mb-1"
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "New password for ada@example.test" }),
    ).toBeInTheDocument();
  });

  it("saves a new password and closes once the server accepts it", async () => {
    vi.mocked(api.put).mockResolvedValue(mailbox({ health_status: "ok" }));
    const user = userEvent.setup();
    render(
      <MailboxPanel
        administrators={ADMINS}
        initialMailboxes={[mailbox({ health_status: "auth_failed" })]}
        initialUpdateId="mb-1"
      />,
    );

    await user.type(screen.getByLabelText("New password"), "fresh-password");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(api.put).toHaveBeenCalledWith("/api/v1/admin-mail/mailboxes/mb-1/password", {
      password: "fresh-password",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Working")).toBeInTheDocument();
  });

  it("keeps the dialog open and explains when the server rejects the password", async () => {
    vi.mocked(api.put).mockRejectedValue(
      new ApiError(400, "mail_auth_failed", "The mail server rejected this password."),
    );
    const user = userEvent.setup();
    render(
      <MailboxPanel
        administrators={ADMINS}
        initialMailboxes={[mailbox({ health_status: "auth_failed" })]}
        initialUpdateId="mb-1"
      />,
    );

    await user.type(screen.getByLabelText("New password"), "still-wrong");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The mail server rejected this password. Check it and try again.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("switches a mailbox off without touching anything else", async () => {
    vi.mocked(api.patch).mockResolvedValue(
      mailbox({ is_enabled: false, effective_enabled: false }),
    );
    const user = userEvent.setup();
    render(<MailboxPanel administrators={ADMINS} initialMailboxes={[mailbox()]} />);

    await user.click(screen.getByRole("button", { name: "Switch off" }));

    expect(api.patch).toHaveBeenCalledWith("/api/v1/admin-mail/mailboxes/mb-1", {
      is_enabled: false,
    });
    expect(await screen.findByText("Switched off")).toBeInTheDocument();
  });

  it("asks before removing a mailbox", async () => {
    vi.mocked(api.delete).mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<MailboxPanel administrators={ADMINS} initialMailboxes={[mailbox()]} />);

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(api.delete).not.toHaveBeenCalled();
    const confirm = screen.getByRole("alertdialog");
    expect(confirm).toHaveTextContent("ada@example.test will stop receiving requests");

    await user.click(within(confirm).getByRole("button", { name: "Remove" }));

    expect(api.delete).toHaveBeenCalledWith("/api/v1/admin-mail/mailboxes/mb-1");
    await waitFor(() => expect(screen.getByText("No mailboxes yet")).toBeInTheDocument());
  });

  it("offers only administrators who do not already have a mailbox", async () => {
    const user = userEvent.setup();
    render(<MailboxPanel administrators={ADMINS} initialMailboxes={[mailbox()]} />);

    await user.click(screen.getByRole("button", { name: /Add mailbox/ }));
    await user.click(screen.getByRole("button", { name: "Administrator account" }));

    // Ada already has one; only Grace can be linked.
    expect(
      await screen.findByRole("menuitemradio", { name: /Grace Admin/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitemradio", { name: /Ada Admin/ })).toBeNull();
  });

  it("points to Users to create another administrator once every account has a mailbox", async () => {
    const user = userEvent.setup();
    render(
      <MailboxPanel administrators={[ADMINS[0]!]} initialMailboxes={[mailbox({ user_id: "u-1" })]} />,
    );

    await user.click(screen.getByRole("button", { name: /Add mailbox/ }));

    expect(
      screen.getByText("Every current administrator account already has a mailbox."),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Create an administrator account/ });
    expect(link).toHaveAttribute("href", "/admin/users");
    // Not repeated again as the reason Save is disabled - the block above
    // already says it, with a way out.
    expect(
      screen.getAllByText("Every current administrator account already has a mailbox."),
    ).toHaveLength(1);
  });

  it("says why Save is still disabled, one field at a time", async () => {
    const user = userEvent.setup();
    render(<MailboxPanel administrators={ADMINS} initialMailboxes={[]} />);
    await user.click(screen.getByRole("button", { name: /Add mailbox/ }));

    expect(
      screen.getByText("Choose which administrator account this mailbox belongs to."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Administrator account" }));
    await user.click(await screen.findByRole("menuitemradio", { name: /Ada Admin/ }));
    expect(screen.getByText("Enter a valid mailbox address.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Mailbox address"), "ops@example.test");
    expect(screen.getByText("Enter a valid SMTP server address.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("SMTP server"), "smtp.example.test");
    expect(screen.getByText("Enter the mailbox's password.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Password"), "a-password");
    expect(screen.queryByText("Enter the mailbox's password.")).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  async function fillNewMailbox(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /Add mailbox/ }));
    await user.click(screen.getByRole("button", { name: "Administrator account" }));
    await user.click(await screen.findByRole("menuitemradio", { name: /Ada Admin/ }));
    await user.type(screen.getByLabelText("Mailbox address"), "ops@example.test");
    await user.type(screen.getByLabelText("SMTP server"), "smtp.example.test");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
  }

  it("does not save when the mail server check fails, and says what the server answered", async () => {
    vi.mocked(api.post).mockRejectedValue(
      new ApiError(400, "mail_auth_failed", "check failed", { reason: "535 bad credentials" }),
    );
    const user = userEvent.setup();
    render(<MailboxPanel administrators={ADMINS} initialMailboxes={[]} />);
    await fillNewMailbox(user);

    await user.click(screen.getByRole("button", { name: "Save" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("did not accept the username or password");
    expect(alert).toHaveTextContent("nothing was saved");
    // The server's own words are kept, folded away under "Technical details".
    expect(within(alert).getByText("Technical details")).toBeInTheDocument();
    expect(alert).toHaveTextContent("535 bad credentials");
    // The dialog stays open with what was typed, and no success is announced.
    expect(screen.getByLabelText("Mailbox address")).toHaveValue("ops@example.test");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("closes and announces the mailbox once the check passes", async () => {
    vi.mocked(api.post).mockResolvedValue(mailbox({ id: "mb-9", user_id: "u-1" }));
    const user = userEvent.setup();
    render(<MailboxPanel administrators={ADMINS} initialMailboxes={[]} />);
    await fillNewMailbox(user);

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Mailbox added."));
    expect(screen.queryByLabelText("Mailbox address")).toBeNull();
  });

  it("fills in the server settings from a provider preset", async () => {
    const user = userEvent.setup();
    render(<MailboxPanel administrators={ADMINS} initialMailboxes={[]} />);

    await user.click(screen.getByRole("button", { name: /Add mailbox/ }));
    await user.click(screen.getByRole("button", { name: "Provider" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Gmail" }));

    expect(screen.getByLabelText("SMTP server")).toHaveValue("smtp.gmail.com");
    expect(screen.getByLabelText("Port")).toHaveValue("587");
    // The pickers show readable labels, not their raw values.
    expect(screen.getByRole("button", { name: "Provider" })).toHaveTextContent("Gmail");
    expect(screen.getByRole("button", { name: "Security" })).toHaveTextContent(
      "STARTTLS (usually port 587)",
    );
  });

  it("offers only Gmail and Outlook as presets, next to a custom option", async () => {
    const user = userEvent.setup();
    render(<MailboxPanel administrators={ADMINS} initialMailboxes={[]} />);

    await user.click(screen.getByRole("button", { name: /Add mailbox/ }));
    await user.click(screen.getByRole("button", { name: "Provider" }));

    const names = (await screen.findAllByRole("menuitemradio")).map(
      (item) => item.textContent,
    );
    expect(names).toEqual(["Gmail", "Outlook / Microsoft 365", "Other / custom"]);
  });

  it("keeps the field guidance behind info buttons, shown on hover", async () => {
    const user = userEvent.setup();
    render(<MailboxPanel administrators={ADMINS} initialMailboxes={[]} />);

    await user.click(screen.getByRole("button", { name: /Add mailbox/ }));

    // Not printed under the inputs...
    expect(screen.queryByText(/The name shown as the sender/)).toBeNull();
    // ...but there is a hint for each field, and hovering one explains Sender name.
    const tips = screen.getAllByRole("button", { name: "More info" });
    expect(tips.length).toBeGreaterThanOrEqual(6);
    await user.hover(tips[2]);
    expect(
      (await screen.findAllByText(/The name shown as the sender/)).length,
    ).toBeGreaterThan(0);
  });

  it("opens with no hint showing, and focus on the first field rather than an info button", async () => {
    const user = userEvent.setup();
    render(<MailboxPanel administrators={ADMINS} initialMailboxes={[]} />);

    await user.click(screen.getByRole("button", { name: /Add mailbox/ }));

    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(screen.queryByText(/Requests appear in this account/)).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Administrator account" }),
    );
  });

  it("shows how to fill in each field as a placeholder", async () => {
    const user = userEvent.setup();
    render(<MailboxPanel administrators={ADMINS} initialMailboxes={[]} />);

    await user.click(screen.getByRole("button", { name: /Add mailbox/ }));

    expect(screen.getByLabelText("Mailbox address")).toHaveAttribute(
      "placeholder",
      "ops@company.com",
    );
    expect(screen.getByLabelText(/Sender name/)).toHaveAttribute(
      "placeholder",
      "WikiHub Support",
    );
    expect(screen.getByLabelText("SMTP server")).toHaveAttribute(
      "placeholder",
      "smtp.company.com",
    );
    expect(screen.getByLabelText("Port")).toHaveAttribute("placeholder", "587");
  });

  describe("ownership", () => {
    it("disables every action on a peer administrator's mailbox", () => {
      render(
        <MailboxPanel
          administrators={ADMINS}
          initialMailboxes={[mailbox({ user_id: "u-1" })]}
          currentUserId="u-2"
          currentUserIsProtected={false}
        />,
      );

      expect(screen.getByRole("button", { name: "Check now" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Update password" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Switch off" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
    });

    it("leaves the account's own mailbox fully usable", () => {
      render(
        <MailboxPanel
          administrators={ADMINS}
          initialMailboxes={[mailbox({ user_id: "u-1" })]}
          currentUserId="u-1"
          currentUserIsProtected={false}
        />,
      );

      expect(screen.getByRole("button", { name: "Edit" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled();
    });

    it("lets the built-in super administrator manage any mailbox", () => {
      render(
        <MailboxPanel
          administrators={ADMINS}
          initialMailboxes={[mailbox({ user_id: "u-1" })]}
          currentUserId="someone-else"
          currentUserIsProtected
        />,
      );

      expect(screen.getByRole("button", { name: "Edit" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled();
    });
  });

  describe("pool", () => {
    it("counts working, active mailboxes as the pool", () => {
      render(
        <MailboxPanel
          administrators={ADMINS}
          initialMailboxes={[
            mailbox({ id: "a", user_id: "u-1", health_status: "ok" }),
            mailbox({ id: "b", user_id: "u-2", health_status: "auth_failed" }),
          ]}
        />,
      );

      expect(screen.getByText(/1 of 2 mailboxes are in the pool/)).toBeInTheDocument();
    });

    it("does not count a healthy mailbox belonging to a disabled account", () => {
      render(
        <MailboxPanel
          administrators={ADMINS}
          initialMailboxes={[
            mailbox({ id: "a", user_id: "u-1", health_status: "ok", user_is_active: false }),
          ]}
        />,
      );

      expect(screen.getByText(/0 of 1 mailboxes are in the pool/)).toBeInTheDocument();
    });
  });
});

function request(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: "req-1",
    kind: "password_reset",
    requester_name: "Alice Nguyen",
    requester_email: "alice@example.org",
    requester_username: "alice",
    message: "I forgot my password",
    created_at: "2026-09-28T08:00:00Z",
    read_at: null,
    resolved_at: null,
    delivery_status: "sent",
    delivery_error: null,
    mailbox_email: "ada@example.test",
    ...overrides,
  };
}

function pageOf(items: InboxItem[]): Page<InboxItem> {
  return { items, total: items.length, limit: 20, offset: 0 };
}

describe("InboxList", () => {
  it("lists requests with their unread and email state", async () => {
    vi.mocked(api.get).mockResolvedValue(
      pageOf([
        request(),
        request({
          id: "req-2",
          requester_name: "Bob Tran",
          read_at: "2026-09-28T09:00:00Z",
          delivery_status: "failed",
          delivery_error: "535 expired",
        }),
      ]),
    );
    render(<InboxList />);

    const alice = (await screen.findByText("Alice Nguyen")).closest("tr") as HTMLElement;
    expect(within(alice).getByRole("img", { name: "Unread" })).toBeInTheDocument();
    expect(within(alice).getByText("Emailed")).toBeInTheDocument();
    const bob = screen.getByText("Bob Tran").closest("tr") as HTMLElement;
    expect(within(bob).queryByRole("img", { name: "Unread" })).toBeNull();
    expect(within(bob).getByText("Not emailed")).toBeInTheDocument();
  });

  it("marks a request read when it is opened, and shows what was sent", async () => {
    vi.mocked(api.get).mockResolvedValue(pageOf([request()]));
    vi.mocked(api.patch).mockResolvedValue(request({ read_at: "2026-09-28T10:00:00Z" }));
    const user = userEvent.setup();
    render(<InboxList />);

    await user.click(await screen.findByRole("button", { name: /View details/ }));

    expect(api.patch).toHaveBeenCalledWith("/api/v1/admin-mail/inbox/req-1", { read: true });
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("I forgot my password");
    expect(dialog).toHaveTextContent("Emailed to ada@example.test.");
    // The claimed address is a reply target, not a verified identity.
    expect(dialog).toHaveTextContent("As typed - not verified.");
    expect(within(dialog).getByRole("link", { name: "alice@example.org" })).toHaveAttribute(
      "href",
      "mailto:alice@example.org",
    );
  });

  it("shows why an email did not go out", async () => {
    vi.mocked(api.get).mockResolvedValue(
      pageOf([
        request({
          read_at: "2026-09-28T09:00:00Z",
          delivery_status: "failed",
          delivery_error: "535 password expired",
        }),
      ]),
    );
    const user = userEvent.setup();
    render(<InboxList />);

    await user.click(await screen.findByRole("button", { name: /View details/ }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Could not email ada@example.test.");
    // Explained first; the server's own words stay available underneath.
    expect(dialog).toHaveTextContent("did not accept the username or password");
    expect(dialog).toHaveTextContent("535 password expired");
  });

  it("resolves a request from its details", async () => {
    vi.mocked(api.get).mockResolvedValue(
      pageOf([request({ read_at: "2026-09-28T09:00:00Z" })]),
    );
    vi.mocked(api.patch).mockResolvedValue(
      request({ read_at: "2026-09-28T09:00:00Z", resolved_at: "2026-09-28T11:00:00Z" }),
    );
    const user = userEvent.setup();
    render(<InboxList />);

    await user.click(await screen.findByRole("button", { name: /View details/ }));
    await user.click(await screen.findByRole("button", { name: "Mark resolved" }));

    expect(api.patch).toHaveBeenCalledWith("/api/v1/admin-mail/inbox/req-1", {
      resolved: true,
    });
    expect(await screen.findByRole("button", { name: "Reopen" })).toBeInTheDocument();
  });

  /** Serves the list and the tab counts, which are two different requests. */
  function serveInbox(page: Page<InboxItem>, counts = { all: 25, unread: 7, open: 20, resolved: 5 }) {
    vi.mocked(api.get).mockImplementation(async (path: string) =>
      path.includes("/inbox/counts") ? counts : page,
    );
  }

  it("re-reads the list for the chosen tab", async () => {
    serveInbox(pageOf([request()]));
    const user = userEvent.setup();
    render(<InboxList />);
    await screen.findByText("Alice Nguyen");

    await user.click(screen.getByRole("button", { name: /^Unread/ }));

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        "/api/v1/admin-mail/inbox?status=unread&limit=10&offset=0",
      ),
    );
  });

  it("shows how many requests each tab holds", async () => {
    serveInbox(pageOf([request()]));
    render(<InboxList />);

    expect(await screen.findByRole("button", { name: "All (25)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unread (7)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open (20)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resolved (5)" })).toBeInTheDocument();
  });

  it("filters by request type, and the tab numbers follow the type", async () => {
    serveInbox(pageOf([request()]));
    const user = userEvent.setup();
    render(<InboxList />);
    await screen.findByText("Alice Nguyen");
    // Reads as "All types" before anything is chosen.
    expect(screen.getByRole("button", { name: "Request type" })).toHaveTextContent("All types");

    await user.click(screen.getByRole("button", { name: "Request type" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Password reset" }));

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        "/api/v1/admin-mail/inbox?status=all&limit=10&offset=0&kind=password_reset",
      ),
    );
    expect(api.get).toHaveBeenCalledWith("/api/v1/admin-mail/inbox/counts?kind=password_reset");
    expect(screen.getByRole("button", { name: "Request type" })).toHaveTextContent(
      "Password reset",
    );
  });

  it("offers each request type, plus all of them", async () => {
    serveInbox(pageOf([request()]));
    const user = userEvent.setup();
    render(<InboxList />);
    await screen.findByText("Alice Nguyen");

    await user.click(screen.getByRole("button", { name: "Request type" }));

    const names = (await screen.findAllByRole("menuitemradio")).map((item) => item.textContent);
    expect(names).toEqual(["All types", "Account request", "Password reset", "Other request"]);
  });

  it("pages like the spaces list: range, rows per page, page number, previous and next", async () => {
    serveInbox({ items: [request()], total: 25, limit: 10, offset: 0 });
    const user = userEvent.setup();
    render(<InboxList />);
    await screen.findByText("Alice Nguyen");

    expect(screen.getByText("Showing 1–10 of 25")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        "/api/v1/admin-mail/inbox?status=all&limit=10&offset=10",
      ),
    );
    expect(await screen.findByText("Page 2 of 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rows per page" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "25" }));
    // A new page size starts again from the first page.
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        "/api/v1/admin-mail/inbox?status=all&limit=25&offset=0",
      ),
    );
  });

  it("marks everything read", async () => {
    vi.mocked(api.get).mockResolvedValue(pageOf([request()]));
    vi.mocked(api.post).mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<InboxList />);
    await screen.findByText("Alice Nguyen");

    await user.click(screen.getByRole("button", { name: /Mark all as read/ }));

    expect(api.post).toHaveBeenCalledWith("/api/v1/admin-mail/inbox/read-all");
    // ...and the list is fetched again to show the new state.
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(1));
  });

  it("opens the request a notification linked to", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) =>
      path.includes("/inbox/req-9")
        ? request({ id: "req-9", requester_name: "Linked Person" })
        : pageOf([]),
    );
    vi.mocked(api.patch).mockResolvedValue(
      request({
        id: "req-9",
        requester_name: "Linked Person",
        read_at: "2026-09-28T10:00:00Z",
      }),
    );
    render(<InboxList openId="req-9" />);

    expect(await screen.findByRole("dialog")).toHaveTextContent("Request from Linked Person");
  });

  it("says when there is nothing to show", async () => {
    vi.mocked(api.get).mockResolvedValue(pageOf([]));
    render(<InboxList />);

    expect(await screen.findByText("No requests here.")).toBeInTheDocument();
  });
});
