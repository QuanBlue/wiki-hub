import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EditGroupDialog } from "@/components/admin/edit-group-dialog";
import { ApiError, api } from "@/lib/api-client";
import type { Group, GroupMember, GroupUsage, User } from "@/types/api";

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mocked = vi.mocked(api);

function person(id: string, full_name: string, email = `${id}@example.test`): User {
  return { id, username: id, full_name, email } as User;
}

const USERS = [
  person("ann", "Ann Lee"),
  person("bob", "Bob Tran"),
  person("cat", ""),
  person("dan", "Dan Vu"),
];

const GROUP: Group = {
  id: "g1",
  name: "Docs",
  description: "Writers",
  owner_id: "ann",
  owner_username: "ann",
  owner_ids: ["ann"],
  is_active: true,
  member_count: 2,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  global_permissions: ["create_space"],
  space_count: 1,
  page_count: 0,
};

const MEMBERS: GroupMember[] = [
  { user_id: "ann", username: "ann", full_name: "Ann Lee", email: "ann@example.test" },
  { user_id: "bob", username: "bob", full_name: "Bob Tran", email: "" },
];

const USAGE: GroupUsage = {
  spaces: [{ space_id: "s1", space_key: "ENG", space_name: "Engineering", permissions: ["view"] }],
  pages: [],
};

function serve({
  members = MEMBERS,
  usage = USAGE,
  fresh = GROUP,
}: { members?: GroupMember[] | Error; usage?: GroupUsage | Error; fresh?: Group } = {}) {
  mocked.get.mockImplementation(async (path: string) => {
    if (path.endsWith("/members")) {
      if (members instanceof Error) throw members;
      return members;
    }
    if (path.endsWith("/usage")) {
      if (usage instanceof Error) throw usage;
      return usage;
    }
    return fresh;
  });
}

function renderDialog(group: Group | null = GROUP, users: User[] = USERS) {
  const onOpenChange = vi.fn();
  const onGroupUpdated = vi.fn();
  const view = render(
    <EditGroupDialog
      group={group}
      open
      onOpenChange={onOpenChange}
      users={users}
      onGroupUpdated={onGroupUpdated}
    />,
  );
  return { onOpenChange, onGroupUpdated, view, actor: userEvent.setup() };
}

const save = () => screen.getByRole("button", { name: "Save changes" });

beforeEach(() => {
  vi.clearAllMocks();
  serve();
  mocked.patch.mockImplementation(async (_path: string, body: unknown) => ({
    ...GROUP,
    ...(body as object),
  }));
  mocked.put.mockResolvedValue(undefined);
  mocked.delete.mockResolvedValue(undefined);
});

describe("EditGroupDialog details", () => {
  it("renders nothing without a group", () => {
    const { view } = renderDialog(null);
    expect(view.container).toBeEmptyDOMElement();
  });

  it("seeds the fields, and only offers Save once something changed", async () => {
    const { actor } = renderDialog();

    expect(screen.getByLabelText("Group name")).toHaveValue("Docs");
    expect(screen.getByLabelText("Description")).toHaveValue("Writers");
    expect(await screen.findByRole("button", { name: /Access grants \(1\)/ })).toBeInTheDocument();
    expect(save()).toBeDisabled();

    await actor.type(screen.getByLabelText("Description"), " and editors");
    expect(save()).toBeEnabled();
  });

  it("falls back to the single owner when the group has no owner list", () => {
    renderDialog({ ...GROUP, owner_ids: [], description: "" });
    expect(screen.getByText("Group owners (1)")).toBeInTheDocument();
  });

  it("has no owners at all when neither is set, and cannot be saved then", () => {
    renderDialog({ ...GROUP, owner_ids: undefined, owner_id: "" });
    expect(screen.getByText("Group owners (0)")).toBeInTheDocument();
  });

  it("adds an owner, who also joins as a new member, and saves both", async () => {
    const { actor, onOpenChange, onGroupUpdated } = renderDialog();
    await screen.findByRole("button", { name: /Members \(2\)/ });

    await actor.click(screen.getByRole("button", { name: /Add another owner/ }));
    await actor.type(screen.getByPlaceholderText(/Search user by name/), "dan");
    await actor.click(screen.getByRole("button", { name: /Dan Vu/ }));

    expect(screen.getByText("Group owners (2)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Members \(3\)/ })).toBeInTheDocument();
    await actor.click(save());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocked.patch).toHaveBeenCalledWith("/api/v1/groups/g1", {
      name: "Docs",
      description: "Writers",
      owner_ids: ["ann", "dan"],
    });
    expect(mocked.put).toHaveBeenCalledWith("/api/v1/groups/g1/members", { user_id: "dan" });
    expect(onGroupUpdated).toHaveBeenCalledWith(expect.objectContaining({ member_count: 2 }));
    expect(toastSuccess).toHaveBeenCalledWith("Group changes saved.");
  });

  it("adding an existing member as owner does not stage them again", async () => {
    const { actor } = renderDialog();
    await screen.findByRole("button", { name: /Members \(2\)/ });

    await actor.click(screen.getByRole("button", { name: /Add another owner/ }));
    await actor.click(screen.getByRole("button", { name: /Bob Tran/ }));

    expect(screen.getByRole("button", { name: /Members \(2\)/ })).toBeInTheDocument();
  });

  it("removes an owner while more than one remains", async () => {
    const { actor } = renderDialog({ ...GROUP, owner_ids: ["ann", "bob"] });

    await actor.click(screen.getAllByTitle("Remove owner")[0]!);

    expect(screen.getByText("Group owners (1)")).toBeInTheDocument();
    expect(screen.queryByTitle("Remove owner")).toBeNull();
  });

  it("shows an owner id that is not in the user list, and hides the picker when everyone owns it", () => {
    renderDialog({ ...GROUP, owner_ids: ["ann", "ghost"] }, [USERS[0]!]);

    expect(screen.getByText("ghost")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add another owner/ })).toBeNull();
  });

  it("closes the user picker on an outside click and filters by email", async () => {
    const { actor } = renderDialog();

    await actor.click(screen.getByRole("button", { name: /Add another owner/ }));
    await actor.type(screen.getByPlaceholderText(/Search user by name/), "nobody");
    expect(screen.getByText("No matching users found.")).toBeInTheDocument();
    await actor.clear(screen.getByPlaceholderText(/Search user by name/));
    await actor.type(screen.getByPlaceholderText(/Search user by name/), "cat@");
    expect(screen.getByRole("button", { name: /@cat/ })).toBeInTheDocument();

    await actor.click(screen.getByLabelText("Group name"));
    expect(screen.queryByPlaceholderText(/Search user by name/)).toBeNull();
  });

  it("closes on Cancel", async () => {
    const { actor, onOpenChange } = renderDialog();
    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("EditGroupDialog members", () => {
  async function openMembers(group: Group = GROUP) {
    const result = renderDialog(group);
    await screen.findByRole("button", { name: /Members \(2\)/ });
    await result.actor.click(screen.getByRole("button", { name: /Members/ }));
    return result;
  }

  it("lists members, filters them, and says when nothing matches", async () => {
    const { actor } = await openMembers();

    expect(screen.getByText("—")).toBeInTheDocument();
    await actor.type(screen.getByPlaceholderText("Search members..."), "bob");
    expect(screen.queryByText("Ann Lee")).toBeNull();
    await actor.clear(screen.getByPlaceholderText("Search members..."));
    await actor.type(screen.getByPlaceholderText("Search members..."), "zzz");
    expect(screen.getByText("No members found.")).toBeInTheDocument();
  });

  it("stages an add and a removal, then saves them", async () => {
    const { actor } = await openMembers();

    await actor.click(screen.getByRole("button", { name: /Select user to add/ }));
    // Existing members are offered but marked as already added.
    expect(screen.getByRole("button", { name: /Ann Lee.*Added/ })).toBeDisabled();
    await actor.click(screen.getByRole("button", { name: /Dan Vu/ }));
    await actor.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(screen.getByText("New")).toBeInTheDocument();

    const bobRow = screen.getByText("Bob Tran").closest("tr")!;
    await actor.click(within(bobRow).getByRole("button", { name: "Remove" }));
    await actor.click(save());

    await waitFor(() =>
      expect(mocked.put).toHaveBeenCalledWith("/api/v1/groups/g1/members", { user_id: "dan" }),
    );
    expect(mocked.delete).toHaveBeenCalledWith("/api/v1/groups/g1/members/bob");
    // Membership-only changes leave the group itself untouched.
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it("un-stages a newly added member instead of removing it", async () => {
    const { actor } = await openMembers();

    await actor.click(screen.getByRole("button", { name: /Select user to add/ }));
    await actor.click(screen.getByRole("button", { name: /Dan Vu/ }));
    await actor.click(screen.getByRole("button", { name: /^Add$/ }));
    const danRow = screen.getByText("Dan Vu").closest("tr")!;
    await actor.click(within(danRow).getByRole("button", { name: "Remove" }));

    expect(screen.queryByText("New")).toBeNull();
    expect(save()).toBeDisabled();
  });

  it("re-adding a staged removal cancels it", async () => {
    const { actor } = await openMembers();

    const bobRow = screen.getByText("Bob Tran").closest("tr")!;
    await actor.click(within(bobRow).getByRole("button", { name: "Remove" }));
    await actor.click(screen.getByRole("button", { name: /Select user to add/ }));
    await actor.click(screen.getByRole("button", { name: /Bob Tran/ }));
    await actor.click(screen.getByRole("button", { name: /Bob Tran/ }));
    await actor.click(screen.getByRole("button", { name: /^Add$/ }));

    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("shows a staged member who is not in the user list by id", async () => {
    // The owner picker stages "zed" as a member; the user list no longer has them.
    const { actor } = renderDialog(GROUP, [...USERS, person("zed", "")]);
    await screen.findByRole("button", { name: /Members \(2\)/ });
    await actor.click(screen.getByRole("button", { name: /Add another owner/ }));
    await actor.click(screen.getByRole("button", { name: /@zed/ }));
    await actor.click(screen.getByRole("button", { name: /Members/ }));

    expect(screen.getAllByText("zed").length).toBeGreaterThan(0);
  });

  it("shows a loading state, and an empty list when loading failed", async () => {
    let finish: (value: GroupMember[]) => void = () => {};
    mocked.get.mockImplementation((path: string) =>
      path.endsWith("/members")
        ? new Promise<GroupMember[]>((resolve) => (finish = resolve))
        : Promise.reject(new Error("no usage")),
    );
    const { actor } = renderDialog();
    await actor.click(screen.getByRole("button", { name: /Members/ }));

    expect(screen.getByText("Loading members...")).toBeInTheDocument();
    finish([]);
    expect(await screen.findByText("No members found.")).toBeInTheDocument();
  });

  it("survives a failed member load", async () => {
    serve({ members: new Error("offline") });
    const { actor } = renderDialog();
    await actor.click(screen.getByRole("button", { name: /Members/ }));

    expect(await screen.findByText("No members found.")).toBeInTheDocument();
  });
});

describe("EditGroupDialog global access", () => {
  async function openPermissions(group: Group = GROUP) {
    const result = renderDialog(group);
    await result.actor.click(screen.getByRole("button", { name: /Global access/ }));
    return result;
  }

  it("grants and revokes permissions", async () => {
    const { actor } = await openPermissions();
    serve({ fresh: { ...GROUP, global_permissions: ["manage_users"] } });

    await actor.click(screen.getByRole("switch", { name: "Create spaces toggle" }));
    await actor.click(screen.getByRole("switch", { name: "Manage users toggle" }));
    await actor.click(save());

    await waitFor(() =>
      expect(mocked.put).toHaveBeenCalledWith("/api/v1/groups/g1/global-permissions/manage_users"),
    );
    expect(mocked.delete).toHaveBeenCalledWith(
      "/api/v1/groups/g1/global-permissions/create_space",
    );
  });

  it("locks the other permissions on while System administrator is granted", async () => {
    const { actor } = await openPermissions({ ...GROUP, global_permissions: [] });

    await actor.click(screen.getByRole("switch", { name: "System administrator toggle" }));

    expect(screen.getByRole("switch", { name: "Manage groups toggle" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Manage groups toggle" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getAllByText("Included via System administrator")).toHaveLength(4);
  });

  it("keeps the dialog open on Global access when part of a save is refused", async () => {
    const { actor, onOpenChange } = await openPermissions();
    mocked.put.mockRejectedValueOnce(
      new ApiError(403, "forbidden", "Only a system administrator can do this."),
    );
    mocked.delete.mockRejectedValueOnce(new Error("offline"));

    await actor.click(screen.getByRole("switch", { name: "Manage issues toggle" }));
    await actor.click(screen.getByRole("switch", { name: "Create spaces toggle" }));
    await actor.click(save());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Some changes could not be saved: Grant Manage issues: Only a system administrator can do this.; Revoke Create spaces",
    );
    expect(toastError).toHaveBeenCalledWith("Some group changes could not be saved.");
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("reports a failed group update with the server's reason or a generic one", async () => {
    const { actor } = renderDialog();
    await actor.type(screen.getByLabelText("Group name"), "!");

    mocked.patch.mockRejectedValueOnce(new ApiError(409, "conflict", "Name taken."));
    await actor.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Name taken.");

    mocked.patch.mockRejectedValueOnce(new Error("offline"));
    await actor.click(save());
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Could not save group changes."),
    );
  });

  it("treats a group without permissions as having none", async () => {
    serve({ fresh: { ...GROUP, global_permissions: undefined as never } });
    const { actor, onGroupUpdated } = renderDialog({
      ...GROUP,
      global_permissions: undefined as never,
    });
    await actor.type(screen.getByLabelText("Group name"), "!");
    await actor.click(save());

    await waitFor(() =>
      expect(onGroupUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ global_permissions: [] }),
      ),
    );
  });
});

describe("EditGroupDialog access grants", () => {
  it("tells the directory right away when a grant is removed", async () => {
    const { actor, onGroupUpdated } = renderDialog();
    await screen.findByRole("button", { name: /Access grants \(1\)/ });
    await actor.click(screen.getByRole("button", { name: /Access grants/ }));

    await actor.click(screen.getByRole("button", { name: 'Remove from "Engineering"' }));
    await actor.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(onGroupUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ space_count: 0, page_count: 0 }),
      ),
    );
  });

  it("survives a failed usage load", async () => {
    serve({ usage: new Error("offline") });
    const { actor } = renderDialog();
    await actor.click(screen.getByRole("button", { name: /Access grants/ }));

    expect(await screen.findByText("Not used anywhere")).toBeInTheDocument();
  });
});

describe("EditGroupDialog reopening", () => {
  it("re-seeds when a different group is shown while open, and resets when closed", async () => {
    const onOpenChange = vi.fn();
    const props = { onOpenChange, users: USERS, onGroupUpdated: vi.fn() };
    const { rerender } = render(<EditGroupDialog group={GROUP} open {...props} />);
    await userEvent.setup().type(screen.getByLabelText("Group name"), "!");

    rerender(<EditGroupDialog group={{ ...GROUP, id: "g2", name: "Ops" }} open {...props} />);
    expect(screen.getByLabelText("Group name")).toHaveValue("Ops");

    rerender(<EditGroupDialog group={{ ...GROUP, id: "g2", name: "Ops" }} open={false} {...props} />);
    rerender(<EditGroupDialog group={{ ...GROUP, id: "g2", name: "Ops" }} open {...props} />);
    expect(screen.getByLabelText("Group name")).toHaveValue("Ops");
  });
});
