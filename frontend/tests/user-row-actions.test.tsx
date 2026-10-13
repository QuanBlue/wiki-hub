import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PermissionOverridesSummary,
  PermissionOverridesTable,
} from "@/components/admin/permission-overrides-table";
import { UserRowActions } from "@/components/admin/user-row-actions";
import { ApiError, api } from "@/lib/api-client";
import type { User } from "@/types/api";

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
vi.mock("@/components/admin/edit-user-dialog", () => ({
  EditUserDialog: ({ open, user }: { open: boolean; user: User }) =>
    open ? <div role="dialog" aria-label="edit user">{user.username}</div> : null,
}));

const mocked = vi.mocked(api);

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "u1",
    username: "ann",
    full_name: "Ann Lee",
    email: "ann@example.com",
    is_superuser: false,
    is_protected: false,
    global_permission_overrides: [],
    ...overrides,
  } as unknown as User;
}

function renderActions(user: User, props: Partial<React.ComponentProps<typeof UserRowActions>> = {}) {
  return render(
    <UserRowActions
      user={user}
      isSelf={false}
      viewerIsProtected={false}
      viewerIsSystemAdmin
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.delete.mockResolvedValue(undefined);
});

describe("UserRowActions", () => {
  it("shows nothing actionable for the protected account", () => {
    renderActions(makeUser({ is_protected: true }));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("opens the edit dialog", async () => {
    renderActions(makeUser());
    await userEvent.click(screen.getByRole("button", { name: "Edit ann" }));
    expect(screen.getByRole("dialog", { name: "edit user" })).toHaveTextContent("ann");
  });

  it("deletes after confirmation", async () => {
    const actor = userEvent.setup();
    renderActions(makeUser());
    await actor.click(screen.getByRole("button", { name: "Delete ann" }));
    const dialog = await screen.findByRole("alertdialog");
    await actor.click(within(dialog).getByRole("button", { name: "Delete user" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(mocked.delete).toHaveBeenCalledWith("/api/v1/users/u1");
    expect(toastSuccess).toHaveBeenCalledWith("ann deleted.");
  });

  it("reports delete failures", async () => {
    const actor = userEvent.setup();
    renderActions(makeUser());
    mocked.delete.mockRejectedValueOnce(new ApiError(409, "busy", "Owns spaces."));
    await actor.click(screen.getByRole("button", { name: "Delete ann" }));
    await actor.click(await screen.findByRole("button", { name: "Delete user" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Owns spaces."));

    mocked.delete.mockRejectedValueOnce(new Error("network"));
    await actor.click(screen.getByRole("button", { name: "Delete user" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not delete the user."));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("will not let you delete yourself", () => {
    renderActions(makeUser(), { isSelf: true });
    const del = screen.getByRole("button", { name: "Delete ann" });
    expect(del).toBeDisabled();
    expect(del).toHaveAttribute("title", "You cannot delete your own account");
    expect(screen.getByRole("button", { name: "Edit ann" })).toBeEnabled();
  });

  it("blocks editing another administrator unless the viewer is the protected one", () => {
    const admin = makeUser({ is_superuser: true });
    const first = renderActions(admin);
    expect(screen.getByRole("button", { name: "Edit ann" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete ann" })).toHaveAttribute(
      "title",
      expect.stringContaining("built-in super administrator"),
    );
    first.unmount();

    renderActions(admin, { viewerIsProtected: true });
    expect(screen.getByRole("button", { name: "Edit ann" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Delete ann" })).toBeEnabled();
  });
});

describe("PermissionOverridesTable", () => {
  it("explains when nobody has an override", () => {
    render(
      <PermissionOverridesTable
        users={[]}
        meId="u1"
        viewerIsProtected={false}
        viewerIsSystemAdmin
      />,
    );
    expect(screen.getByText("No permission overrides")).toBeInTheDocument();
  });

  it("lists accounts with their overrides", () => {
    const users = [
      makeUser({
        id: "u1",
        global_permission_overrides: [
          { permission: "create_space", enabled: true },
          { permission: "manage_users", enabled: false },
        ],
      } as Partial<User>),
      makeUser({
        id: "u2",
        username: "root",
        full_name: "",
        email: "root@example.com",
        is_protected: true,
        global_permission_overrides: [{ permission: "system_admin", enabled: true }],
      } as Partial<User>),
      makeUser({ id: "u3", username: "solo name", full_name: "", email: "s@example.com" }),
    ];
    render(
      <PermissionOverridesTable
        users={users}
        meId="u1"
        viewerIsProtected={false}
        viewerIsSystemAdmin
      />,
    );

    expect(screen.getByText("you")).toBeInTheDocument();
    expect(screen.getByText("protected")).toBeInTheDocument();
    expect(screen.getByText("Create spaces: Enabled")).toBeInTheDocument();
    expect(screen.getByText("Manage users: Disabled")).toBeInTheDocument();
    expect(screen.getByText("System administrator: Enabled")).toBeInTheDocument();
    expect(screen.getByText("AL")).toBeInTheDocument();
    expect(screen.getByText("SN")).toBeInTheDocument();
    expect(screen.getByText("@root")).toBeInTheDocument();
  });

  it("falls back to a placeholder avatar for a nameless account", () => {
    render(
      <PermissionOverridesTable
        users={[makeUser({ username: " ", full_name: "" })]}
        meId={undefined}
        viewerIsProtected={false}
        viewerIsSystemAdmin
      />,
    );
    expect(screen.getByText("?")).toBeInTheDocument();
  });
});

describe("PermissionOverridesSummary", () => {
  it("pluralises the count", () => {
    const one = render(<PermissionOverridesSummary count={1} />);
    expect(screen.getByText(/1 account has/)).toBeInTheDocument();
    one.unmount();
    render(<PermissionOverridesSummary count={3} />);
    expect(screen.getByText(/3 accounts have/)).toBeInTheDocument();
  });
});
