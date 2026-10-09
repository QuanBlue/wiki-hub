import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EditUserDialog } from "@/components/admin/edit-user-dialog";
import { MailSummaryProvider } from "@/components/layout/mail-summary-provider";
import { ApiError, api } from "@/lib/api-client";
import type { GlobalPermission, MailSummary, User } from "@/types/api";

const { refresh, toastSuccess, toastError } = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mocked = vi.mocked(api);

const MAILBOX: MailSummary = {
  has_mailbox: true,
  has_inbox: true,
  mailbox_id: "mb",
  mailbox_email: "ops@example.test",
  health_status: "ok",
  health_error: null,
  unread_count: 0,
  can_send_account_mail: true,
};
const NO_MAILBOX: MailSummary = { ...MAILBOX, has_mailbox: false, can_send_account_mail: false };

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "u1",
    username: "alice",
    email: "alice@example.test",
    full_name: "Alice",
    avatar_url: null,
    bio: "",
    pronouns: "",
    profile_url: "",
    social_links: [],
    company: "",
    is_active: true,
    is_superuser: false,
    is_effective_admin: false,
    is_protected: false,
    last_login_at: null,
    created_at: "2026-01-01T00:00:00Z",
    groups: [],
    group_memberships: [],
    global_permissions: [],
    global_permission_overrides: [],
    global_permissions_from_groups: [],
    ...overrides,
  } as User;
}

function renderDialog(
  user: User,
  {
    fresh = user,
    summary = MAILBOX,
    isSelf = false,
    viewerIsSystemAdmin = true,
  }: {
    fresh?: User | Error;
    summary?: MailSummary;
    isSelf?: boolean;
    viewerIsSystemAdmin?: boolean;
  } = {},
) {
  mocked.get.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/v1/users/")) {
      if (fresh instanceof Error) throw fresh;
      return fresh;
    }
    return summary;
  });
  const onOpenChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MailSummaryProvider initial={summary} poll={false}>
        <EditUserDialog
          user={user}
          isSelf={isSelf}
          viewerIsSystemAdmin={viewerIsSystemAdmin}
          open
          onOpenChange={onOpenChange}
        />
      </MailSummaryProvider>
    </QueryClientProvider>,
  );
  return { onOpenChange, actor: userEvent.setup() };
}

async function choose(actor: ReturnType<typeof userEvent.setup>, trigger: string, option: string) {
  await actor.click(screen.getByRole("button", { name: trigger }));
  await actor.click(screen.getByRole("menuitemradio", { name: option }));
}

const save = () => screen.getByRole("button", { name: "Save changes" });

beforeEach(() => {
  vi.clearAllMocks();
  mocked.patch.mockResolvedValue({});
  mocked.post.mockResolvedValue({ email_sent: true, email_error: null });
  mocked.delete.mockResolvedValue(undefined);
});

describe("EditUserDialog general tab", () => {
  it("reloads the account and starts with nothing to save", async () => {
    renderDialog(makeUser(), {
      fresh: makeUser({ group_memberships: [{ id: "g1", name: "Docs" }] as User["group_memberships"] }),
    });

    expect(await screen.findByRole("button", { name: /Groups \(1\)/ })).toBeInTheDocument();
    expect(mocked.get).toHaveBeenCalledWith("/api/v1/users/u1");
    expect(save()).toBeDisabled();
  });

  it("stays usable on the row it was given when the reload fails", async () => {
    renderDialog(makeUser(), { fresh: new Error("offline") });

    await waitFor(() => expect(screen.queryByText("Refreshing...")).toBeNull());
    expect(screen.getByRole("button", { name: "Role" })).toHaveTextContent("Member");
  });

  it("promotes to Administrator, forcing every permission on, and tells them", async () => {
    const { onOpenChange, actor } = renderDialog(makeUser());
    await waitFor(() => expect(screen.queryByText("Refreshing...")).toBeNull());

    await choose(actor, "Role", "Administrator");
    expect(screen.getByText(/will also let them know by email/)).toBeInTheDocument();
    await actor.click(save());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocked.patch).toHaveBeenCalledWith("/api/v1/users/u1", {
      is_superuser: true,
      global_permission_overrides: {
        create_space: true,
        manage_users: true,
        manage_groups: true,
        manage_issues: true,
        system_admin: true,
      },
    });
    await waitFor(() =>
      expect(mocked.post).toHaveBeenCalledWith(
        "/api/v1/admin-mail/notify-admin-granted",
        expect.objectContaining({ user_id: "u1" }),
      ),
    );
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/now an administrator/));
    expect(refresh).toHaveBeenCalled();
  });

  it("reports when the new administrator could not be emailed", async () => {
    mocked.post.mockResolvedValue({ email_sent: false, email_error: "down" });
    const { actor } = renderDialog(makeUser());
    await waitFor(() => expect(screen.queryByText("Refreshing...")).toBeNull());

    await choose(actor, "Role", "Administrator");
    await actor.click(save());

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/about the new role/)),
    );
  });

  it("undoes a promotion in the same session exactly, leaving nothing to save", async () => {
    const { actor } = renderDialog(
      makeUser({ global_permission_overrides: [{ permission: "create_space", enabled: false }] }),
    );
    await waitFor(() => expect(screen.queryByText("Refreshing...")).toBeNull());

    await choose(actor, "Role", "Administrator");
    expect(save()).toBeEnabled();
    await choose(actor, "Role", "Member");

    expect(save()).toBeDisabled();
  });

  it("demoting a saved administrator also clears the System administrator override", async () => {
    const admin = makeUser({
      is_superuser: true,
      global_permission_overrides: [{ permission: "system_admin", enabled: true }],
    });
    const { actor } = renderDialog(admin);
    await waitFor(() => expect(screen.queryByText("Refreshing...")).toBeNull());

    await choose(actor, "Role", "Member");
    await actor.click(save());

    await waitFor(() =>
      expect(mocked.patch).toHaveBeenCalledWith("/api/v1/users/u1", {
        is_superuser: false,
        global_permission_overrides: { system_admin: null },
      }),
    );
  });

  it("toggles the account off", async () => {
    const { actor } = renderDialog(makeUser());
    await waitFor(() => expect(screen.queryByText("Refreshing...")).toBeNull());

    await actor.click(screen.getByRole("switch", { name: "Status" }));
    expect(screen.getByRole("switch", { name: "Status" })).toHaveTextContent("Disabled");
    await actor.click(screen.getByRole("switch", { name: "Status" }));
    await actor.click(screen.getByRole("switch", { name: "Status" }));
    await actor.click(save());

    await waitFor(() =>
      expect(mocked.patch).toHaveBeenCalledWith("/api/v1/users/u1", { is_active: false }),
    );
  });

  it("locks Role and Status for your own account and for a non system administrator", async () => {
    renderDialog(makeUser(), { isSelf: true });
    await waitFor(() => expect(screen.queryByText("Refreshing...")).toBeNull());

    expect(screen.getByRole("button", { name: "Role" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Role" })).toHaveAttribute(
      "title",
      "You cannot change your own role.",
    );
    expect(screen.getByRole("switch", { name: "Status" })).toBeDisabled();
  });

  it("says when a group already makes the account an effective admin", async () => {
    renderDialog(
      makeUser({ global_permissions_from_groups: ["system_admin"] as GlobalPermission[] }),
      { viewerIsSystemAdmin: false },
    );

    expect(
      await screen.findByText(/Already an effective admin via a group or override/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Role" })).toHaveAttribute(
      "title",
      "Only a System Administrator can change a user's role.",
    );
  });

  it("asks to tell a new administrator by hand when there is no mailbox", async () => {
    const { actor } = renderDialog(makeUser(), { summary: NO_MAILBOX });
    await waitFor(() => expect(screen.queryByText("Refreshing...")).toBeNull());

    await choose(actor, "Role", "Administrator");

    expect(screen.getByText(/tell alice yourself/)).toBeInTheDocument();
  });
});

describe("EditUserDialog passwords", () => {
  it("checks the rules as you type and refuses a mismatch", async () => {
    const { actor } = renderDialog(makeUser());
    await waitFor(() => expect(screen.queryByText("Refreshing...")).toBeNull());

    await actor.type(screen.getByLabelText("New password"), "short");
    expect(screen.getByText("At least 8 characters")).toHaveClass("text-danger");
    await actor.type(screen.getByLabelText("New password"), "-but-long");
    await actor.type(screen.getByLabelText("Confirm new password"), "different");

    expect(screen.getByText("Passwords match")).toHaveClass("text-danger");
    expect(save()).toBeDisabled();
  });

  it("refuses a submit that skips the button while the rules fail", async () => {
    renderDialog(makeUser());
    await waitFor(() => expect(screen.queryByText("Refreshing...")).toBeNull());
    const actor = userEvent.setup();

    await actor.type(screen.getByLabelText("New password"), "abc");
    save().closest("form")!.requestSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent(/does not meet all requirements/);
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it("generates a strong password, copies it, saves it and emails it", async () => {
    const { actor } = renderDialog(makeUser());
    await waitFor(() => expect(screen.queryByText("Refreshing...")).toBeNull());
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();

    await actor.click(screen.getByRole("button", { name: "Generate password" }));
    const generated = (screen.getByLabelText("New password") as HTMLInputElement).value;

    expect(generated).toHaveLength(20);
    expect(writeText).toHaveBeenCalledWith(generated);
    expect(screen.getByText(/the new password/)).toBeInTheDocument();
    await actor.click(save());

    await waitFor(() =>
      expect(mocked.post).toHaveBeenCalledWith("/api/v1/users/u1/password-reset", {
        new_password: generated,
      }),
    );
    expect(mocked.patch).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("New password emailed to `alice@example.test`."),
    );
  });

  it("still fills the fields when the clipboard refuses, and reports a failed email", async () => {
    const { actor } = renderDialog(makeUser());
    await waitFor(() => expect(screen.queryByText("Refreshing...")).toBeNull());
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    mocked.post.mockImplementation(async (path: string) =>
      path.includes("notify") ? { email_sent: false, email_error: "x" } : {},
    );

    await actor.click(screen.getByRole("button", { name: "Generate password" }));
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/Could not copy/));
    await actor.click(save());

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/Share it another way/)),
    );
  });

  it("asks to share the password by hand without a mailbox", async () => {
    const { actor } = renderDialog(makeUser(), { summary: NO_MAILBOX });
    await waitFor(() => expect(screen.queryByText("Refreshing...")).toBeNull());

    await actor.type(screen.getByLabelText("New password"), "x");

    expect(screen.getByText(/share the new password with alice yourself/)).toBeInTheDocument();
  });
});

describe("EditUserDialog saving", () => {
  it("shows the server's reason, or a generic one, when saving fails", async () => {
    const { actor, onOpenChange } = renderDialog(makeUser());
    await waitFor(() => expect(screen.queryByText("Refreshing...")).toBeNull());
    await actor.click(screen.getByRole("switch", { name: "Status" }));

    mocked.patch.mockRejectedValueOnce(new ApiError(403, "forbidden", "Not allowed."));
    await actor.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Not allowed.");

    mocked.patch.mockRejectedValueOnce(new Error("boom"));
    await actor.click(save());
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Could not save these changes."),
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("closes on Cancel", async () => {
    const { actor, onOpenChange } = renderDialog(makeUser());
    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("EditUserDialog global access tab", () => {
  async function openAccess(user: User, options?: Parameters<typeof renderDialog>[1]) {
    const result = renderDialog(user, options);
    await waitFor(() => expect(screen.queryByText("Refreshing...")).toBeNull());
    await result.actor.click(screen.getByRole("button", { name: /Global access/ }));
    return result;
  }

  it("saves a single override and marks the tab unsaved meanwhile", async () => {
    const { actor } = await openAccess(
      makeUser({ global_permissions_from_groups: ["create_space"] as GlobalPermission[] }),
    );
    expect(screen.getByText("Create spaces", { selector: "span.text-\\[10px\\], .text-\\[10px\\]" }));

    await choose(actor, "Manage users override", "Force enabled");
    expect(screen.getByText("unsaved")).toBeInTheDocument();
    await choose(actor, "Create spaces override", "Force disabled");
    await actor.click(save());

    await waitFor(() =>
      expect(mocked.patch).toHaveBeenCalledWith("/api/v1/users/u1", {
        global_permission_overrides: { manage_users: true, create_space: false },
      }),
    );
  });

  it("clears an override back to the groups' answer", async () => {
    const { actor } = await openAccess(
      makeUser({ global_permission_overrides: [{ permission: "manage_issues", enabled: true }] }),
    );

    await choose(actor, "Manage issues override", "Inherit from groups");
    await actor.click(save());

    await waitFor(() =>
      expect(mocked.patch).toHaveBeenCalledWith("/api/v1/users/u1", {
        global_permission_overrides: { manage_issues: null },
      }),
    );
  });

  it("forcing System administrator on promotes the role; forcing it off demotes it", async () => {
    const { actor } = await openAccess(makeUser());
    expect(screen.getByText("No global permissions currently granted.")).toBeInTheDocument();

    await choose(actor, "System administrator override", "Force enabled");
    expect(screen.getByText("All permissions (Administrator role)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage users override" })).toHaveTextContent(
      "Included in Admin role",
    );

    // Locked while the role grants everything: demote through the General tab.
    await actor.click(screen.getByRole("button", { name: /General/ }));
    await choose(actor, "Role", "Member");
    await actor.click(screen.getByRole("button", { name: /Global access/ }));
    await choose(actor, "System administrator override", "Force disabled");

    expect(screen.getByRole("button", { name: "System administrator override" })).toHaveTextContent(
      "Force disabled",
    );
  });

  it("forcing System administrator off on a saved administrator demotes the role", async () => {
    const { actor } = await openAccess(
      makeUser({
        is_superuser: true,
        global_permission_overrides: [{ permission: "system_admin", enabled: true }],
      }),
    );
    // A Role-granted admin row is locked; the role select is how to undo it.
    expect(screen.getByRole("button", { name: "System administrator override" })).toBeDisabled();
    await actor.click(screen.getByRole("button", { name: /General/ }));
    await choose(actor, "Role", "Member");
    await actor.click(screen.getByRole("button", { name: /Global access/ }));
    await choose(actor, "System administrator override", "Force enabled");
    await actor.click(screen.getByRole("button", { name: /General/ }));

    expect(screen.getByRole("button", { name: "Role" })).toHaveTextContent("Administrator");
  });

  it("shows permissions implied by a group-granted System administrator as included", async () => {
    await openAccess(
      makeUser({ global_permissions_from_groups: ["system_admin"] as GlobalPermission[] }),
    );

    expect(screen.getByRole("button", { name: "Manage groups override" })).toHaveTextContent(
      "Included via System administrator",
    );
    expect(screen.getByRole("button", { name: "Manage groups override" })).toBeDisabled();
  });

  it("is read-only for a viewer who is not a system administrator", async () => {
    await openAccess(makeUser(), { viewerIsSystemAdmin: false });

    expect(screen.getByRole("button", { name: "Create spaces override" })).toHaveAttribute(
      "title",
      "Only a System Administrator can change Global Access overrides.",
    );
  });

  it("is read-only for your own account", async () => {
    await openAccess(makeUser(), { isSelf: true });

    expect(screen.getByRole("button", { name: "Create spaces override" })).toBeDisabled();
  });
});

describe("EditUserDialog groups tab", () => {
  const memberships = [
    { id: "g1", name: "Docs" },
    { id: "g2", name: "Ops" },
    { id: "g3", name: "QA" },
  ] as User["group_memberships"];

  async function openGroups(user: User, options?: Parameters<typeof renderDialog>[1]) {
    const result = renderDialog(user, options);
    await waitFor(() => expect(screen.queryByText("Refreshing...")).toBeNull());
    await result.actor.click(screen.getByRole("button", { name: /^Groups/ }));
    return result;
  }

  it("says so when the account is in no group", async () => {
    await openGroups(makeUser());
    expect(screen.getByText("Not a member of any group")).toBeInTheDocument();
  });

  it("leaves one group after confirming", async () => {
    const { actor } = await openGroups(makeUser({ group_memberships: memberships }));

    await actor.click(screen.getByRole("button", { name: 'Leave "Docs"' }));
    await actor.click(screen.getByRole("button", { name: "Leave group" }));

    await waitFor(() => expect(screen.queryByText("Docs")).toBeNull());
    expect(mocked.delete).toHaveBeenCalledWith("/api/v1/groups/g1/members/u1");
    expect(toastSuccess).toHaveBeenCalledWith('Left "Docs".');
    expect(screen.getByRole("button", { name: /Groups \(2\)/ })).toBeInTheDocument();
  });

  it("reports a failed leave with the server's reason or a generic one", async () => {
    const { actor } = await openGroups(makeUser({ group_memberships: memberships }));

    mocked.delete.mockRejectedValueOnce(new ApiError(409, "conflict", "Last owner."));
    await actor.click(screen.getByRole("button", { name: 'Leave "Docs"' }));
    await actor.click(screen.getByRole("button", { name: "Leave group" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Last owner."));

    mocked.delete.mockRejectedValueOnce(new Error("offline"));
    await actor.click(screen.getByRole("button", { name: "Leave group" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Could not leave "Docs".'));
  });

  it("leaves several groups at once and reports the ones that failed", async () => {
    const { actor } = await openGroups(makeUser({ group_memberships: memberships }));
    mocked.delete
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("nope"));

    await actor.click(screen.getByRole("button", { name: "Select" }));
    await actor.click(screen.getByLabelText("Select Docs"));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Clear" }));
    await actor.click(screen.getByLabelText("Select all groups"));
    expect(screen.getByRole("button", { name: "Cancel (3)" })).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Leave selected" }));
    const confirm = screen.getByRole("alertdialog", { name: "Leave 3 groups?" });
    await actor.click(within(confirm).getByRole("button", { name: "Leave selected" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Left 2 groups."));
    expect(toastError).toHaveBeenCalledWith("Could not leave 1 group.");
    expect(screen.getByText("QA")).toBeInTheDocument();
  });

  it("toggles select mode off and unticks with select-all", async () => {
    const { actor } = await openGroups(makeUser({ group_memberships: memberships }));

    await actor.click(screen.getByRole("button", { name: "Select" }));
    await actor.click(screen.getByLabelText("Select all groups"));
    await actor.click(screen.getByLabelText("Select all groups"));
    expect(screen.getByText("Select all (3)")).toBeInTheDocument();
    await actor.click(screen.getByLabelText("Select Ops"));
    await actor.click(screen.getByLabelText("Select Ops"));
    // The select-mode toggle comes before the dialog's own Cancel.
    await actor.click(screen.getAllByRole("button", { name: "Cancel" })[0]!);

    expect(screen.queryByLabelText("Select all groups")).toBeNull();
  });

  it("cannot leave groups for your own account", async () => {
    await openGroups(makeUser({ group_memberships: memberships }), { isSelf: true });

    expect(screen.getByRole("button", { name: 'Leave "Docs"' })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute(
      "title",
      "You cannot leave your own groups from here.",
    );
  });
});

describe("EditUserDialog small paths", () => {
  it("choosing the role it already has changes nothing", async () => {
    const { actor } = renderDialog(makeUser());
    await waitFor(() => expect(screen.queryByText("Refreshing...")).toBeNull());

    await choose(actor, "Role", "Member");

    expect(save()).toBeDisabled();
  });

  it("backs out of leaving one group, or several", async () => {
    const memberships = [
      { id: "g1", name: "Docs" },
      { id: "g2", name: "Ops" },
    ] as User["group_memberships"];
    const { actor } = renderDialog(makeUser({ group_memberships: memberships }));
    await waitFor(() => expect(screen.queryByText("Refreshing...")).toBeNull());
    await actor.click(screen.getByRole("button", { name: /^Groups/ }));

    await actor.click(screen.getByRole("button", { name: 'Leave "Docs"' }));
    await actor.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    await actor.click(screen.getByRole("button", { name: "Select" }));
    await actor.click(screen.getByLabelText("Select Ops"));
    await actor.click(screen.getByRole("button", { name: "Leave selected" }));
    await actor.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    );

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mocked.delete).not.toHaveBeenCalled();
  });
});
