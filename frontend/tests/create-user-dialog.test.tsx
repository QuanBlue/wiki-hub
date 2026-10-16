import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { CreateUserDialog } from "@/components/admin/create-user-dialog";
import { ApiError, api } from "@/lib/api-client";

const m = vi.hoisted(() => ({
  canEmail: false,
  notify: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn() },
}));
vi.mock("@/components/admin/account-email-option", () => ({
  AccountEmailNotice: () => null,
  notifyAccountEmail: (...args: unknown[]) => m.notify(...args),
  useCanEmailAccounts: () => m.canEmail,
}));

const CREATED = { id: "u-9", username: "jdoe", email: "jdoe@example.com" };

beforeEach(() => {
  vi.mocked(api.get).mockReset().mockResolvedValue({ items: [], total: 0 });
  vi.mocked(api.post).mockReset().mockResolvedValue(CREATED);
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  m.notify.mockReset();
  m.refresh.mockReset();
  m.canEmail = false;
});

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  { username = "jdoe", password = "Passw0rd!" } = {},
) {
  await user.type(screen.getByLabelText("First name"), "Jane");
  await user.type(screen.getByLabelText("Last name"), "Doe");
  await user.clear(screen.getByLabelText("Username"));
  await user.type(screen.getByLabelText("Username"), username);
  await user.type(screen.getByLabelText("E-mail"), "jdoe@example.com");
  await user.type(screen.getByLabelText("Password"), password);
}

async function open(viewerIsSystemAdmin = true, props = {}) {
  const user = userEvent.setup();
  render(<CreateUserDialog viewerIsSystemAdmin={viewerIsSystemAdmin} {...props} />);
  await user.click(screen.getByRole("button", { name: "Create user" }));
  await screen.findByRole("dialog");
  return user;
}

const submit = () => screen.getByRole("button", { name: /^Create\s*user$/ });

describe("CreateUserDialog", () => {
  it("checks the username as it is typed, and creates the account once it is free", async () => {
    const user = await open();
    await fill(user);

    expect(await screen.findByText("Username is available.")).toBeInTheDocument();
    await waitFor(() => expect(submit()).toBeEnabled());
    await user.click(submit());

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("User jdoe created."));
    expect(api.post).toHaveBeenCalledWith("/api/v1/users", {
      username: "jdoe",
      email: "jdoe@example.com",
      full_name: "Jane Doe",
      password: "Passw0rd!",
      is_superuser: false,
    });
    expect(m.refresh).toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
  });

  it("refuses a username that is taken (in any case) or that cannot be checked", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ items: [{ username: "JDoe" }], total: 1 });
    const user = await open();
    await fill(user);
    expect(await screen.findByText("This username is already in use.")).toBeInTheDocument();
    expect(submit()).toBeDisabled();

    vi.mocked(api.get).mockRejectedValueOnce(new Error("down"));
    await user.type(screen.getByLabelText("Username"), "2");
    expect(await screen.findByText("Could not check availability. Try again.")).toBeInTheDocument();
  });

  it("explains an invalid username and e-mail while they are typed", async () => {
    const user = await open();
    await user.type(screen.getByLabelText("Username"), "a!");
    await user.type(screen.getByLabelText("E-mail"), "nope");

    expect(screen.getByText(/Use 3–64 letters/)).toBeInTheDocument();
    expect(screen.getByText("Enter a valid e-mail address.")).toBeInTheDocument();
    expect(screen.queryByText("Checking availability…")).toBeNull();
  });

  it("emails the sign-in details when a mailbox can send them, and says if that failed", async () => {
    m.canEmail = true;
    m.notify.mockResolvedValueOnce({ email_sent: true });
    const first = await open();
    await fill(first);
    await screen.findByText("Username is available.");
    await first.click(submit());
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Sign-in details emailed to jdoe@example.com."),
    );
    expect(m.notify).toHaveBeenCalledWith("created", "u-9", "Passw0rd!");
  });

  it("tells the administrator to share the password when the email could not be sent", async () => {
    m.canEmail = true;
    m.notify.mockResolvedValueOnce(null);
    const user = await open();
    await fill(user);
    await screen.findByText("Username is available.");
    await user.click(submit());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Share the password")),
    );
  });

  it("shows the server's reason, and marks the username taken when it lost the race", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(
      new ApiError(409, "username_taken", "Username already exists."),
    );
    const user = await open();
    await fill(user);
    await screen.findByText("Username is available.");
    await user.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent("Username already exists.");
    expect(screen.getByText("This username is already in use.")).toBeInTheDocument();
  });

  it("falls back to a general message for any other failure", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error("down"));
    const user = await open();
    await fill(user);
    await screen.findByText("Username is available.");
    await user.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not create the user.");
  });

  it("offers the Administrator role only to a System Administrator", async () => {
    const user = await open(true);
    await user.click(screen.getByRole("button", { name: "Role" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Administrator" }));

    expect(
      screen.getByText("Administrators can manage every user, space and setting."),
    ).toBeInTheDocument();
  });

  it("explains why a Manage-users grant alone can only create Members", async () => {
    await open(false);

    expect(screen.getByText(/Only a System Administrator can create a new account/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Role" })).toBeDisabled();
  });

  it("forgets what was typed when it is dismissed", async () => {
    const user = await open();
    await user.type(screen.getByLabelText("First name"), "Jane");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getByRole("button", { name: "Create user" }));

    expect(await screen.findByLabelText("First name")).toHaveValue("");
  });

  it("closes from its Cancel button", async () => {
    const user = await open();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("opens prefilled and checks the username straight away when it is controlled", async () => {
    const onOpenChange = vi.fn();
    const onCreated = vi.fn();
    render(
      <CreateUserDialog
        viewerIsSystemAdmin
        open
        onOpenChange={onOpenChange}
        onCreated={onCreated}
        initial={{ firstName: "Jane", lastName: "Doe", username: "jdoe", email: "jdoe@example.com" }}
      />,
    );

    // Only the form's own submit button: there is no trigger beside the dialog.
    expect(screen.getAllByRole("button", { name: /Create\s*user/ })).toHaveLength(1);
    expect(screen.getByLabelText("First name")).toHaveValue("Jane");
    expect(await screen.findByText("Username is available.")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Password"), "Passw0rd!");
    await user.click(submit());

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
