import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RequestActions } from "@/components/admin/request-actions";
import { api } from "@/lib/api-client";
import { generatePassword } from "@/lib/password";
import type {
  AutoActionResult,
  InboxItem,
  RequestActionPreview,
} from "@/types/api";
import { toast } from "sonner";

/** A toast's message is rich text (see lib/rich-text.tsx) once it has
 * emphasis markers, not a plain string - render it to check what it says. */
function textOf(node: ReactNode): string {
  return renderToStaticMarkup(<>{node}</>).replace(/<[^>]+>/g, "");
}

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: "req-1",
    kind: "account",
    requester_name: "Alice Nguyen",
    requester_email: "alice@example.org",
    requester_username: null,
    message: "",
    created_at: "2026-09-28T08:00:00Z",
    read_at: "2026-09-28T08:01:00Z",
    resolved_at: null,
    delivery_status: "sent",
    delivery_error: null,
    mailbox_email: "ops@example.test",
    ...overrides,
  };
}

const ACCOUNT_OK: RequestActionPreview = {
  kind: "account",
  suggested_username: "alice",
  email_in_use: false,
  matched_account: null,
  email_matches: false,
  auto_action: "create_account",
  auto_allowed: true,
  auto_blocked: null,
};

const MATCHED = {
  id: "u-9",
  username: "bob",
  full_name: "Bob Tran",
  email: "bob@example.org",
  is_active: true,
};

const RESET_OK: RequestActionPreview = {
  kind: "password_reset",
  suggested_username: null,
  email_in_use: false,
  matched_account: MATCHED,
  email_matches: true,
  auto_action: "reset_password",
  auto_allowed: true,
  auto_blocked: null,
};

function servePreview(preview: RequestActionPreview) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path.includes("/actions")) return preview;
    // The Create user form's username availability check.
    return { items: [], total: 0, limit: 10, offset: 0 };
  });
}

function result(overrides: Partial<AutoActionResult> = {}): AutoActionResult {
  return {
    item: item({ resolved_at: "2026-09-28T09:00:00Z" }),
    username: "alice",
    emailed_to: "alice@example.org",
    email_sent: true,
    email_error: null,
    password: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.patch).mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("RequestActions - account requests", () => {
  it("offers to create the account automatically or by hand, saying what each does", async () => {
    servePreview(ACCOUNT_OK);
    render(<RequestActions item={item()} onChanged={vi.fn()} />);

    const auto = await screen.findByRole("button", { name: "Create account automatically" });
    await waitFor(() => expect(auto).toBeEnabled());
    expect(
      screen.getByText(/Creates the account “alice” as a Member .* emails the sign-in details to alice@example.org/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account manually" })).toBeEnabled();
    expect(screen.getByText(/You choose the password and pass it on yourself/)).toBeInTheDocument();
  });

  it("asks first, then creates the account and emails the person", async () => {
    servePreview(ACCOUNT_OK);
    vi.mocked(api.post).mockResolvedValue(result());
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<RequestActions item={item()} onChanged={onChanged} />);

    const auto = await screen.findByRole("button", { name: "Create account automatically" });
    await waitFor(() => expect(auto).toBeEnabled());
    await user.click(auto);

    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("“alice” will be created for Alice Nguyen");
    expect(api.post).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole("button", { name: "Create and email" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/api/v1/admin-mail/inbox/req-1/create-account",
        { login_url: `${window.location.origin}/login` },
      ),
    );
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ resolved_at: expect.any(String) }));
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(textOf(vi.mocked(toast.success).mock.calls[0]![0] as ReactNode)).toBe(
      "Account alice created. The sign-in details were emailed to alice@example.org.",
    );
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Account alice created");
    // Collapsed by default - the email already told the person.
    expect(within(status).queryByRole("button", { name: /^Copy /i })).toBeNull();
    await user.click(within(status).getByRole("button", { name: "Show details" }));
    // Copy buttons for the username and the address it was emailed to.
    expect(within(status).getAllByRole("button", { name: /^Copy /i })).toHaveLength(2);
  });

  it("hands the password over once when the email could not be sent", async () => {
    servePreview(ACCOUNT_OK);
    vi.mocked(api.post).mockResolvedValue(
      result({
        email_sent: false,
        email_error: "(534, '5.7.9 Application-specific password required')",
        password: "Zx7kQm2Rt9WpAb4c",
      }),
    );
    const user = userEvent.setup();
    render(<RequestActions item={item()} onChanged={vi.fn()} />);
    const auto = await screen.findByRole("button", { name: "Create account automatically" });
    await waitFor(() => expect(auto).toBeEnabled());
    await user.click(auto);
    await user.click(await screen.findByRole("button", { name: "Create and email" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("was created, but the email could not be sent");
    expect(status).toHaveTextContent("Gmail needs an app password");
    // The password is never shown by default, even when the email failed.
    expect(status).not.toHaveTextContent("Zx7kQm2Rt9WpAb4c");
    await user.click(within(status).getByRole("button", { name: "Show details" }));
    expect(status).toHaveTextContent("Zx7kQm2Rt9WpAb4c");
    // A copy button each for the username, the address, and the password.
    expect(within(status).getAllByRole("button", { name: /^Copy /i })).toHaveLength(3);
    // No success message for something that did not reach the person.
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("turns into a password reset when the address already has an account", async () => {
    servePreview({
      ...RESET_OK,
      kind: "account",
      email_in_use: true,
    });
    vi.mocked(api.post).mockResolvedValue(result({ username: "bob", emailed_to: "bob@example.org" }));
    const user = userEvent.setup();
    render(
      <RequestActions
        item={item({ kind: "account", requester_email: "bob@example.org" })}
        onChanged={vi.fn()}
      />,
    );

    // Both buttons now talk about the password, and the person is told why.
    const auto = await screen.findByRole("button", { name: "Reset password automatically" });
    await waitFor(() => expect(auto).toBeEnabled());
    expect(screen.getByText(/An account \(“bob”\) already uses this email/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create account automatically" })).toBeNull();
    expect(screen.getByRole("button", { name: "Set password manually" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Create account manually" })).toBeNull();

    await user.click(auto);
    await user.click(await screen.findByRole("button", { name: "Reset and email" }));

    // The reset route is used, not the create one.
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/api/v1/admin-mail/inbox/req-1/reset-password",
        expect.anything(),
      ),
    );
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Password for bob reset");
    await user.click(within(status).getByRole("button", { name: "Show details" }));
    expect(within(status).getAllByRole("button", { name: /^Copy /i })).toHaveLength(2);
  });

  it("says why the automatic reset is unavailable for an existing account, and keeps the manual one", async () => {
    servePreview({
      ...RESET_OK,
      kind: "account",
      email_in_use: true,
      auto_allowed: false,
      auto_blocked: "account_inactive",
    });
    render(<RequestActions item={item()} onChanged={vi.fn()} />);

    expect(await screen.findByText(/The account “bob” is disabled/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset password automatically" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Set password manually" })).toBeEnabled();
  });

  it("opens the Create user form with the requester's details filled in, and resolves the request once created", async () => {
    servePreview(ACCOUNT_OK);
    vi.mocked(api.post).mockResolvedValue({ id: "u-new", username: "alice" });
    vi.mocked(api.patch).mockResolvedValue(item({ resolved_at: "2026-09-28T09:00:00Z" }));
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<RequestActions item={item()} onChanged={onChanged} />);

    const manual = await screen.findByRole("button", { name: "Create account manually" });
    await waitFor(() => expect(manual).toBeEnabled());
    await user.click(manual);

    const dialog = await screen.findByRole("dialog", { name: "Create a user" });
    expect(within(dialog).getByLabelText("First name")).toHaveValue("Alice");
    expect(within(dialog).getByLabelText("Last name")).toHaveValue("Nguyen");
    expect(within(dialog).getByLabelText("Username")).toHaveValue("alice");
    expect(within(dialog).getByLabelText("E-mail")).toHaveValue("alice@example.org");

    await user.type(within(dialog).getByLabelText("Password"), "Passw0rd-Strong");
    const create = within(dialog).getByRole("button", { name: /Create\s*user/ });
    await waitFor(() => expect(create).toBeEnabled());
    await user.click(create);

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/api/v1/admin-mail/inbox/req-1", { resolved: true }),
    );
    expect(onChanged).toHaveBeenCalled();
  });
});

describe("RequestActions - password resets", () => {
  it("resets the password of the matched account and emails the address on it", async () => {
    servePreview(RESET_OK);
    vi.mocked(api.post).mockResolvedValue(
      result({ username: "bob", emailed_to: "bob@example.org" }),
    );
    const user = userEvent.setup();
    render(
      <RequestActions
        item={item({ kind: "password_reset", requester_email: "bob@example.org" })}
        onChanged={vi.fn()}
      />,
    );

    const auto = await screen.findByRole("button", { name: "Reset password automatically" });
    await waitFor(() => expect(auto).toBeEnabled());
    expect(
      screen.getByText(/Generates a new password for “bob” and emails it to bob@example.org, the address on the account/),
    ).toBeInTheDocument();
    await user.click(auto);
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("The current password stops working immediately");
    await user.click(within(confirm).getByRole("button", { name: "Reset and email" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/api/v1/admin-mail/inbox/req-1/reset-password",
        expect.objectContaining({ login_url: expect.stringContaining("/login") }),
      ),
    );
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Password for bob reset");
    await user.click(within(status).getByRole("button", { name: "Show details" }));
    expect(within(status).getAllByRole("button", { name: /^Copy /i })).toHaveLength(2);
  });

  it("never offers to mail a password to an address that is not the account's", async () => {
    servePreview({
      ...RESET_OK,
      email_matches: false,
      auto_allowed: false,
      auto_blocked: "email_mismatch",
    });
    render(
      <RequestActions
        item={item({ kind: "password_reset", requester_email: "attacker@example.org" })}
        onChanged={vi.fn()}
      />,
    );

    const warning = await screen.findByText(/is not the one on the account “bob”/);
    expect(warning).toHaveTextContent("attacker@example.org");
    expect(warning).toHaveTextContent("bob@example.org");
    expect(screen.getByRole("button", { name: "Reset password automatically" })).toBeDisabled();
    // A person who has checked who they are talking to can still do it by hand.
    expect(screen.getByRole("button", { name: "Set password manually" })).toBeEnabled();
  });

  it("sets a chosen password by hand, then resolves the request", async () => {
    servePreview({ ...RESET_OK, email_matches: false, auto_allowed: false, auto_blocked: "email_mismatch" });
    vi.mocked(api.post).mockResolvedValue({});
    vi.mocked(api.patch).mockResolvedValue(item({ kind: "password_reset", resolved_at: "2026-09-28T09:00:00Z" }));
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(
      <RequestActions item={item({ kind: "password_reset" })} onChanged={onChanged} />,
    );

    const manual = await screen.findByRole("button", { name: "Set password manually" });
    await waitFor(() => expect(manual).toBeEnabled());
    await user.click(manual);
    const dialog = await screen.findByRole("dialog", { name: "Set a password for bob" });
    expect(dialog).toHaveTextContent("WikiHub does not email this one");
    const save = within(dialog).getByRole("button", { name: "Set password" });
    expect(save).toBeDisabled();

    await user.type(within(dialog).getByLabelText("New password"), "Chosen-pass-1");
    await user.click(save);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/v1/users/u-9/password-reset", {
        new_password: "Chosen-pass-1",
      }),
    );
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/api/v1/admin-mail/inbox/req-1", { resolved: true }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("can generate a password to set", async () => {
    servePreview(RESET_OK);
    const user = userEvent.setup();
    render(<RequestActions item={item({ kind: "password_reset" })} onChanged={vi.fn()} />);
    const manual = await screen.findByRole("button", { name: "Set password manually" });
    await waitFor(() => expect(manual).toBeEnabled());
    await user.click(manual);
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: /Generate/ }));

    expect((within(dialog).getByLabelText("New password") as HTMLInputElement).value).toHaveLength(16);
    expect(within(dialog).getByRole("button", { name: "Set password" })).toBeEnabled();
  });

  it("offers to create an account instead when none matches the reset", async () => {
    servePreview({
      kind: "password_reset",
      suggested_username: "quannt39",
      email_in_use: false,
      matched_account: null,
      email_matches: false,
      auto_action: "create_account",
      auto_allowed: true,
      auto_blocked: null,
    });
    render(
      <RequestActions
        item={item({ kind: "password_reset", requester_username: "quannt39" })}
        onChanged={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Create account automatically" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Create account manually" })).toBeEnabled();
    expect(
      screen.getByText(/No account named .quannt39. exists yet/),
    ).toBeInTheDocument();
  });
});

describe("RequestActions - other cases", () => {
  it("has nothing to offer for a general request", () => {
    const { container } = render(
      <RequestActions item={item({ kind: "other" })} onChanged={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("does not offer to act twice on a request that is already resolved", () => {
    render(
      <RequestActions
        item={item({ resolved_at: "2026-09-28T09:00:00Z" })}
        onChanged={vi.fn()}
      />,
    );

    expect(screen.getByText("This request has been resolved.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /automatically/ })).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("reports when what can be done could not be looked up", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("boom"));
    render(<RequestActions item={item()} onChanged={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not check what can be done",
    );
  });
});

describe("generatePassword", () => {
  it("always meets the strength rules and avoids look-alike characters", () => {
    for (let index = 0; index < 200; index += 1) {
      const value = generatePassword();
      expect(value).toHaveLength(16);
      expect(value).toMatch(/[a-z]/);
      expect(value).toMatch(/[A-Z]/);
      expect(value).toMatch(/[0-9]/);
      expect(value).not.toMatch(/[0OIl1]/);
    }
  });
});
