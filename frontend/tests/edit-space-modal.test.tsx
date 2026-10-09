import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EditSpaceModal } from "@/components/admin/edit-space-modal";
import { ApiError, api } from "@/lib/api-client";
import type { Group, Space, SpacePermissionAssignment, User } from "@/types/api";

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

const USERS = [
  { id: "me", username: "me", full_name: "Me Myself", is_superuser: false, is_protected: false },
  { id: "ann", username: "ann", full_name: "Ann Lee", is_superuser: false, is_protected: false },
  { id: "bob", username: "bob", full_name: "", is_superuser: false, is_protected: false },
  { id: "root", username: "admin", full_name: "Root", is_superuser: true, is_protected: true },
  { id: "zed", username: "zed", full_name: "Zed", is_superuser: false, is_protected: false },
] as User[];

const GROUPS = [
  { id: "g1", name: "Docs" },
  { id: "g2", name: "confluence-users" },
  { id: "g3", name: "confluence-administrators" },
  { id: "g4", name: "Ops" },
] as Group[];

function grant(
  type: "user" | "group",
  id: string,
  permission: SpacePermissionAssignment["permissions"][number],
): SpacePermissionAssignment {
  return { space_id: "s1", principal_id: id, principal_type: type, principal_name: id, permissions: [permission] };
}

const ASSIGNMENTS = [
  grant("group", "g1", "view"),
  grant("group", "g1", "add"),
  grant("group", "g3", "admin"),
  grant("user", "ann", "view"),
  grant("user", "root", "view"),
  grant("user", "bob", "view"),
  grant("user", "bob", "add"),
];

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: "s1",
    key: "ENG",
    name: "Engineering",
    status: "active",
    visibility: "restricted",
    max_upload_size_mb: null,
    owners: [
      { user_id: "me", username: "me", full_name: "Me Myself" },
      { user_id: "root", username: "admin", full_name: "Root" },
    ],
    is_owner: true,
    ...overrides,
  } as Space;
}

function serve({
  assignments = ASSIGNMENTS,
  fail = false,
  meta = true,
}: { assignments?: SpacePermissionAssignment[]; fail?: boolean; meta?: boolean } = {}) {
  mocked.get.mockImplementation(async (path: string) => {
    if (fail) throw new Error("offline");
    if (path.endsWith("/permissions")) return assignments;
    if (path.endsWith("/principals/groups")) return GROUPS;
    if (path.endsWith("/principals/users")) return USERS;
    if (path === "/api/v1/meta") {
      if (!meta) throw new Error("no meta");
      return { max_upload_size_bytes: 50 * 1024 * 1024 };
    }
    if (path === "/api/v1/auth/me") return { id: "me" };
    if (path === "/api/v1/spaces") return [makeSpace(), makeSpace({ key: "OPS", name: "Operations" })];
    throw new Error(`unexpected ${path}`);
  });
}

function renderModal(
  space: Space | null = makeSpace(),
  props: { users?: User[]; groups?: Group[]; onSpaceUpdated?: () => void } = {},
) {
  const onOpenChange = vi.fn();
  const view = render(
    <EditSpaceModal space={space} open onOpenChange={onOpenChange} {...props} />,
  );
  return { onOpenChange, view, actor: userEvent.setup() };
}

const save = () => screen.getByRole("button", { name: "Save changes" });

async function settle() {
  await waitFor(() => expect(mocked.get).toHaveBeenCalledWith("/api/v1/spaces/ENG/permissions"));
  await act(async () => {});
}

async function openAccess(actor: ReturnType<typeof userEvent.setup>) {
  await actor.click(screen.getByRole("button", { name: /Access & Permissions/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
  serve();
  mocked.patch.mockResolvedValue({});
  mocked.put.mockResolvedValue(undefined);
  mocked.delete.mockResolvedValue(undefined);
  mocked.post.mockResolvedValue(undefined);
});

describe("EditSpaceModal general tab", () => {
  it("renders nothing without a space", () => {
    const { view } = renderModal(null);
    expect(view.container).toBeEmptyDOMElement();
  });

  it("shows the owners, marking yourself and system administrators", async () => {
    renderModal();
    await settle();

    expect(screen.getByText("Space owners (2)")).toBeInTheDocument();
    expect(await screen.findByText("(you)")).toBeInTheDocument();
    expect(screen.getByText("(system admin)")).toBeInTheDocument();
    expect(screen.queryByTitle("Remove owner")).toBeNull();
    expect(screen.getByText(/workspace limit of 50 MB/)).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it("validates a new name: letters first, and not one already taken", async () => {
    const { actor } = renderModal();
    await settle();
    const name = screen.getByLabelText("Space Name");

    await actor.clear(name);
    await actor.type(name, "1st space");
    expect(screen.getByText(/Name must start with a letter/)).toBeInTheDocument();
    expect(save()).toBeDisabled();

    await actor.clear(name);
    await actor.type(name, "operations");
    expect(screen.getByText('A space named "operations" already exists.')).toBeInTheDocument();

    await actor.clear(name);
    await actor.type(name, "Platform");
    expect(screen.queryByText(/already exists/)).toBeNull();
    expect(save()).toBeEnabled();
  });

  it("saves a rename, an upload limit and a new owner, then closes", async () => {
    const onSpaceUpdated = vi.fn();
    const { actor, onOpenChange } = renderModal(makeSpace(), { onSpaceUpdated });
    await settle();

    await actor.clear(screen.getByLabelText("Space Name"));
    await actor.type(screen.getByLabelText("Space Name"), "Platform");
    await actor.type(screen.getByLabelText(/Attachment size limit/), "25");
    expect(screen.getByText("Applies to every upload into this Space.")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: /Add another owner/ }));
    await actor.click(screen.getByRole("button", { name: "Ann Lee (@ann)" }));
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    await actor.click(save());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocked.patch).toHaveBeenCalledWith("/api/v1/spaces/ENG", {
      name: "Platform",
      visibility: "restricted",
      max_upload_size_mb: 25,
    });
    expect(mocked.put).toHaveBeenCalledWith("/api/v1/spaces/ENG/owners", {
      owner_ids: ["me", "root", "ann"],
    });
    expect(onSpaceUpdated).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it("removes an owner who is neither you nor a system administrator", async () => {
    const { actor } = renderModal(
      makeSpace({
        owners: [
          { user_id: "me", username: "me", full_name: "Me Myself" },
          { user_id: "zed", username: "zed", full_name: "Zed" },
        ],
      }),
    );
    await settle();

    await actor.click(await screen.findByTitle("Remove owner"));

    expect(screen.getByText("Space owner (1)")).toBeInTheDocument();
    expect(save()).toBeEnabled();
  });

  it("is read-only for someone who is not an owner, and leaves the upload limit to the workspace", async () => {
    serve({ meta: false });
    // An owner missing from the user list is named from the space's own record.
    renderModal(makeSpace({ is_owner: false, max_upload_size_mb: 10, owners: [{ user_id: "ghost", username: "ghosty", full_name: "" }] }));
    await settle();

    expect(screen.getByText("Only a space Owner can change this list.")).toBeInTheDocument();
    expect(screen.getByText("ghosty")).toBeInTheDocument();
    expect(screen.getByLabelText(/Attachment size limit/)).toHaveValue(10);
  });

  it("explains an inherited limit even before the workspace limit is known", async () => {
    serve({ meta: false });
    const { actor } = renderModal(makeSpace({ max_upload_size_mb: 10 }));
    await settle();

    await actor.clear(screen.getByLabelText(/Attachment size limit/));

    expect(screen.getByText("Leave blank to follow the workspace limit.")).toBeInTheDocument();
    await actor.click(save());
    await waitFor(() =>
      expect(mocked.patch).toHaveBeenCalledWith("/api/v1/spaces/ENG", {
        visibility: "restricted",
        max_upload_size_mb: null,
      }),
    );
  });

  it("hides the owner picker once everyone is an owner", async () => {
    renderModal(makeSpace({ owners: USERS.map((u) => ({ user_id: u.id, username: u.username, full_name: u.full_name })) }));
    await settle();

    expect(screen.queryByRole("button", { name: /Add another owner/ })).toBeNull();
  });
});

describe("EditSpaceModal access tab", () => {
  it("lists real grants, hides the built-in admin group, and marks owners and defaults", async () => {
    const { actor } = renderModal();
    await settle();
    await openAccess(actor);

    expect(screen.getByText("Docs")).toBeInTheDocument();
    expect(screen.queryByText("confluence-administrators")).toBeNull();
    const rootRow = screen.getByText("@admin").closest("tr")!;
    expect(within(rootRow).getByText("Owner")).toBeInTheDocument();
    expect(within(rootRow).getByText("Default")).toBeInTheDocument();
    expect(within(rootRow).getByLabelText("admin: Admin")).toBeChecked();
    expect(within(screen.getByText("@bob").closest("tr")!).getByText("Editor")).toBeInTheDocument();
    expect(within(screen.getByText("@ann").closest("tr")!).getByText("Viewer")).toBeInTheDocument();
  });

  it("sorts both tables by name or role", async () => {
    serve({ assignments: [...ASSIGNMENTS, grant("group", "g4", "view"), grant("group", "g4", "admin")] });
    const { actor } = renderModal(makeSpace(), { users: USERS, groups: GROUPS });
    await settle();
    await openAccess(actor);
    const groupOrder = () => screen.getAllByText(/^(Docs|Ops)$/).map((node) => node.textContent);
    const userOrder = () => screen.getAllByText(/^@/).map((node) => node.textContent);

    expect(groupOrder()).toEqual(["Docs", "Ops"]);
    await actor.click(screen.getByTitle("Sort by group"));
    expect(groupOrder()).toEqual(["Ops", "Docs"]);
    // Role starts with the most powerful first, then flips.
    await actor.click(screen.getAllByTitle("Sort by role")[0]!);
    expect(groupOrder()).toEqual(["Ops", "Docs"]);
    await actor.click(screen.getAllByTitle("Sort by role")[0]!);
    expect(groupOrder()).toEqual(["Docs", "Ops"]);

    // Owners outrank every role (between owners, their own grant decides),
    // then Editor, then Viewer.
    await actor.click(screen.getAllByTitle("Sort by role")[1]!);
    expect(userOrder()).toEqual(["@admin", "@me", "@bob", "@ann"]);
    await actor.click(screen.getAllByTitle("Sort by role")[1]!);
    expect(userOrder()).toEqual(["@ann", "@bob", "@me", "@admin"]);
    await actor.click(screen.getByTitle("Sort by user"));
    expect(userOrder()).toEqual(["@ann", "@bob", "@me", "@admin"]);
    await actor.click(screen.getByTitle("Sort by user"));
    expect(userOrder()).toEqual(["@admin", "@me", "@bob", "@ann"]);
  });

  it("adds a group, which floats to the top, and grants through the matrix rules", async () => {
    const { actor, onOpenChange } = renderModal();
    await settle();
    await openAccess(actor);

    await actor.click(screen.getAllByRole("button", { name: /Edit/ })[0]!);
    await actor.click(screen.getByRole("button", { name: "Add a group..." }));
    expect(screen.getByRole("button", { name: /Docs.*Added/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /confluence-users.*Default/ })).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Ops" }));

    const ops = screen.getByText("Ops").closest("tr")!;
    expect(within(ops).getByLabelText("Ops: View")).toBeChecked();
    // Admin checks every other column; unchecking one then drops Admin too.
    await actor.click(within(ops).getByLabelText("Ops: Admin"));
    expect(within(ops).getByLabelText("Ops: Move")).toBeChecked();
    await actor.click(within(ops).getByLabelText("Ops: Move"));
    expect(within(ops).getByLabelText("Ops: Admin")).not.toBeChecked();
    await actor.click(within(ops).getByLabelText("Ops: Admin"));
    await actor.click(within(ops).getByLabelText("Ops: Admin"));
    expect(within(ops).getByLabelText("Ops: Move")).toBeChecked();

    // Docs loses Add/Edit; the built-in groups are left alone.
    await actor.click(screen.getByLabelText("Docs: Add/Edit"));
    await actor.click(screen.getByRole("button", { name: /Done/ }));
    await actor.click(save());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    for (const permission of ["view", "add", "delete", "delete_own", "restrictions", "move"]) {
      expect(mocked.put).toHaveBeenCalledWith(`/api/v1/spaces/ENG/permissions/groups/g4/${permission}`);
    }
    expect(mocked.delete).toHaveBeenCalledWith("/api/v1/spaces/ENG/permissions/groups/g1/add");
    expect(mocked.patch).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith("Space access & permissions saved.");
  });

  it("removes a group and a user outright, siblings before View", async () => {
    const { actor } = renderModal();
    await settle();
    await openAccess(actor);
    const [groupsEdit, usersEdit] = screen.getAllByRole("button", { name: /Edit/ });

    await actor.click(groupsEdit!);
    await actor.click(screen.getByLabelText("Remove Docs from this space"));
    await actor.click(usersEdit!);
    await actor.click(screen.getByLabelText("Remove bob from this space"));
    expect(screen.queryByLabelText("Remove admin from this space")).toBeNull();
    // The backend refuses to drop View while a sibling remains, so no View
    // removal may even be sent until every sibling removal has finished.
    let finishSiblings: () => void = () => {};
    const siblingsDone = new Promise<void>((resolve) => (finishSiblings = resolve));
    mocked.delete.mockImplementation(async (path: string) => {
      if (!path.endsWith("/view")) await siblingsDone;
      return undefined;
    });
    await actor.click(save());

    await waitFor(() => expect(mocked.delete).toHaveBeenCalledTimes(2));
    const sent = () => mocked.delete.mock.calls.map(([path]) => String(path));
    expect(sent().some((path) => path.endsWith("/view"))).toBe(false);
    finishSiblings();
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledTimes(4));
    expect(sent()).toContain("/api/v1/spaces/ENG/permissions/groups/g1/view");
    expect(sent()).toContain("/api/v1/spaces/ENG/permissions/users/bob/view");
  });

  it("adds a user straight to the top with View", async () => {
    const { actor } = renderModal();
    await settle();
    await openAccess(actor);

    await actor.click(screen.getAllByRole("button", { name: /Edit/ })[1]!);
    await actor.click(screen.getByRole("button", { name: "Add a user..." }));
    expect(screen.getByRole("button", { name: /Ann Lee.*Added/ })).toBeDisabled();
    await actor.click(screen.getByRole("button", { name: "Zed (@zed)" }));
    await actor.click(screen.getByLabelText("zed: Restrictions"));
    await actor.click(screen.getByLabelText("zed: Restrictions"));
    await actor.click(screen.getByLabelText("ann: Delete own"));
    await actor.click(save());

    await waitFor(() =>
      expect(mocked.put).toHaveBeenCalledWith("/api/v1/spaces/ENG/permissions/users/zed/view"),
    );
    expect(mocked.put).toHaveBeenCalledWith("/api/v1/spaces/ENG/permissions/users/ann/delete_own");
  });

  it("offers the protected admin account as Admin in the user picker", async () => {
    serve({ assignments: [] });
    const { actor } = renderModal(makeSpace({ owners: [{ user_id: "me", username: "me", full_name: "Me" }] }));
    await settle();
    await openAccess(actor);

    expect(screen.getByText("No groups added to this space yet.")).toBeInTheDocument();
    await actor.click(screen.getAllByRole("button", { name: /Edit/ })[1]!);
    await actor.click(screen.getByRole("button", { name: "Add a user..." }));
    expect(screen.getByRole("button", { name: /Root \(@admin\).*Admin/ })).toBeInTheDocument();
  });

  it("drops a principal whose only grant was a permission other than View", async () => {
    serve({ assignments: [grant("user", "zed", "restrictions")] });
    const { actor } = renderModal(makeSpace({ owners: [{ user_id: "me", username: "me", full_name: "Me" }] }));
    await settle();
    await openAccess(actor);

    await actor.click(screen.getAllByRole("button", { name: /Edit/ })[1]!);
    await actor.click(screen.getByLabelText("zed: Restrictions"));

    expect(screen.queryByText("@zed")).toBeNull();
  });

  it("drops a group whose only grant was a permission other than View", async () => {
    serve({ assignments: [grant("group", "g4", "restrictions")] });
    const { actor } = renderModal();
    await settle();
    await openAccess(actor);

    await actor.click(screen.getAllByRole("button", { name: /Edit/ })[0]!);
    await actor.click(screen.getByLabelText("Ops: Restrictions"));

    expect(screen.getByText("No groups added to this space yet.")).toBeInTheDocument();
  });

  it("shows everyone's automatic access while the space is Open, and saves the switch", async () => {
    const { actor } = renderModal(makeSpace({ visibility: "open" }));
    await settle();
    await openAccess(actor);

    expect(screen.getByText("Every user can read and edit this Space.")).toBeInTheDocument();
    expect(screen.getByLabelText("All groups: Move")).toBeChecked();
    expect(screen.getByLabelText("All users: View")).toBeDisabled();

    await actor.click(screen.getByRole("button", { name: "Open" }));
    await actor.click(screen.getByRole("menuitemradio", { name: "Restricted" }));
    expect(screen.getByText("Only people granted access below can view or edit this Space.")).toBeInTheDocument();
    await actor.click(save());

    await waitFor(() =>
      expect(mocked.patch).toHaveBeenCalledWith("/api/v1/spaces/ENG", {
        visibility: "restricted",
        max_upload_size_mb: null,
      }),
    );
  });

  it("only lets an owner change the access mode", async () => {
    const { actor } = renderModal(makeSpace({ is_owner: false }));
    await settle();
    await openAccess(actor);

    expect(screen.getByRole("button", { name: "Restricted" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Restricted" })).toHaveAttribute(
      "title",
      "Only this space's Owner can change its access mode.",
    );
  });

  it("reports a failed save and stays open", async () => {
    const { actor, onOpenChange } = renderModal();
    await settle();
    await actor.type(screen.getByLabelText(/Attachment size limit/), "5");

    mocked.patch.mockRejectedValueOnce(new ApiError(400, "bad", "Too large."));
    await actor.click(save());

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Too large."));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("uses the lists it was given, and survives a failed permission load", async () => {
    serve({ fail: true });
    const { actor } = renderModal(makeSpace(), { users: USERS, groups: GROUPS });
    await settle();
    await openAccess(actor);

    expect(screen.getByText("No groups added to this space yet.")).toBeInTheDocument();
    expect(mocked.get).not.toHaveBeenCalledWith("/api/v1/spaces/ENG/permissions/principals/users");
  });
});

describe("EditSpaceModal leaving with unsaved changes", () => {
  async function dirty() {
    const result = renderModal();
    await settle();
    await result.actor.type(screen.getByLabelText(/Attachment size limit/), "5");
    return result;
  }

  it("closes straight away with nothing to lose", async () => {
    const { actor, onOpenChange } = renderModal();
    await settle();

    await actor.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("asks first, then keeps editing", async () => {
    const { actor, onOpenChange } = await dirty();

    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    await actor.click(screen.getByRole("button", { name: "Keep editing" }));

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Attachment size limit/)).toHaveValue(5);
  });

  it("discards on request, from Escape too", async () => {
    const { actor, onOpenChange } = await dirty();

    await actor.keyboard("{Escape}");
    await actor.click(await screen.findByRole("button", { name: "Discard changes" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("saves from the prompt opened by a click outside", async () => {
    const { onOpenChange, actor } = await dirty();

    fireEvent.pointerDown(document.body);
    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    await actor.click(within(prompt).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocked.patch).toHaveBeenCalled();
  });

  it("closes on Escape when nothing changed", async () => {
    const { actor, onOpenChange } = renderModal();
    await settle();

    await actor.keyboard("{Escape}");

    expect(onOpenChange).toHaveBeenCalledWith(false);
    fireEvent.pointerDown(document.body);
  });
});

describe("EditSpaceModal danger zone", () => {
  async function openDanger(space: Space = makeSpace()) {
    const result = renderModal(space, { onSpaceUpdated: vi.fn() });
    await settle();
    await result.actor.click(screen.getByRole("button", { name: /Danger zone/ }));
    return result;
  }

  it("archives after confirming", async () => {
    const { actor, onOpenChange } = await openDanger();

    await actor.click(screen.getByRole("button", { name: "Archive space" }));
    await actor.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Archive space" }),
    );

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocked.post).toHaveBeenCalledWith("/api/v1/spaces/ENG/archive");
    expect(toastSuccess).toHaveBeenCalledWith('Archived space "Engineering".');
  });

  it("restores an archived space straight away", async () => {
    const { actor } = await openDanger(makeSpace({ status: "archived" }));

    await actor.click(screen.getByRole("button", { name: "Restore space" }));

    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith("/api/v1/spaces/ENG/unarchive"));
    expect(toastSuccess).toHaveBeenCalledWith('Restored space "Engineering".');
  });

  it("reports a failed archive or restore", async () => {
    const { actor } = await openDanger(makeSpace({ status: "archived" }));

    mocked.post.mockRejectedValueOnce(new ApiError(409, "x", "Busy."));
    await actor.click(screen.getByRole("button", { name: "Restore space" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Busy."));

    mocked.post.mockRejectedValueOnce(new Error("offline"));
    await actor.click(screen.getByRole("button", { name: "Restore space" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not update this space."));
  });

  it("deletes after confirming, or reports why it could not", async () => {
    const { actor, onOpenChange } = await openDanger();

    mocked.delete.mockRejectedValueOnce(new ApiError(409, "x", "Still has pages."));
    await actor.click(screen.getByRole("button", { name: "Delete space" }));
    await actor.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete space" }),
    );
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Still has pages."));

    mocked.delete.mockRejectedValueOnce(new Error("offline"));
    await actor.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete space" }),
    );
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not delete this space."));

    await actor.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete space" }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastSuccess).toHaveBeenCalledWith('Deleted space "Engineering".');
  });
});

describe("EditSpaceModal edge states", () => {
  it("flags a default group that holds a real grant", async () => {
    serve({ assignments: [grant("group", "g2", "view")] });
    const { actor } = renderModal();
    await settle();
    await openAccess(actor);

    const row = screen.getByText("confluence-users").closest("tr")!;
    expect(within(row).getByText("Default")).toBeInTheDocument();
  });

  it("says so when nobody holds a grant and there are no owners", async () => {
    serve({ assignments: [] });
    const { actor } = renderModal(makeSpace({ owners: [] }));
    await settle();
    await openAccess(actor);

    expect(screen.getByText("No users added to this space yet.")).toBeInTheDocument();
  });

  it("renders nothing while closed", () => {
    const { container } = render(
      <EditSpaceModal space={makeSpace()} open={false} onOpenChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(mocked.get).not.toHaveBeenCalled();
  });
});
