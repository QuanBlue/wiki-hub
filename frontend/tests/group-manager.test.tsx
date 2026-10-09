import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BulkSelectionProvider, SelectionColumn, SelectionHeaderCell, SelectModeButton } from "@/components/admin/bulk-select";
import { CreateGroupDialog } from "@/components/admin/create-group-dialog";
import { GroupManager } from "@/components/admin/group-manager";
import { ApiError, api } from "@/lib/api-client";
import type { Group, User } from "@/types/api";

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
  { id: "ann", username: "ann", full_name: "Ann Lee", email: "ann@example.test" },
  { id: "bob", username: "bob", full_name: "", email: "bob@example.test" },
  { id: "cat", username: "cat", full_name: "Cat Ho", email: "cat@example.test" },
] as User[];

function group(overrides: Partial<Group>): Group {
  return {
    id: "g",
    name: "Group",
    description: "",
    owner_id: "ann",
    owner_username: "ann",
    owner_ids: ["ann"],
    is_active: true,
    member_count: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    global_permissions: [],
    space_count: 0,
    page_count: 0,
    ...overrides,
  };
}

const GROUPS = [
  group({ id: "g1", name: "Docs", description: "Writers", member_count: 2, space_count: 1, page_count: 2, global_permissions: ["create_space", "odd_one" as never] }),
  group({ id: "g2", name: "users", owner_id: "zzz", owner_username: null, global_permissions: ["system_admin"] }),
  group({ id: "g3", name: "Ops", space_count: 2 }),
];

function renderManager(groups: Group[] = GROUPS, users: User[] = USERS) {
  render(<GroupManager initialGroups={groups} users={users} />);
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.get.mockImplementation(async (path: string) => {
    if (path.endsWith("/members")) return [];
    if (path.endsWith("/usage")) {
      return {
        spaces: [{ space_id: "s1", space_key: "ENG", space_name: "Engineering", permissions: ["view"] }],
        pages: [],
      };
    }
    return GROUPS[0];
  });
  mocked.delete.mockResolvedValue(undefined);
  mocked.put.mockResolvedValue(undefined);
});

describe("GroupManager directory", () => {
  it("summarises the groups and describes each row", () => {
    renderManager();

    expect(screen.getByRole("button", { name: /Group directory \(3\)/ })).toBeInTheDocument();
    expect(screen.getByText("Writers")).toBeInTheDocument();
    expect(screen.getAllByText("No description")).toHaveLength(2);
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("2 members")).toBeInTheDocument();
    expect(screen.getAllByText("1 member")).toHaveLength(2);
    expect(screen.getByText("odd_one")).toBeInTheDocument();
    expect(screen.getByText("System admin")).toBeInTheDocument();
    expect(screen.getAllByText("No global access")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "1 space, 2 pages" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2 spaces" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete users" })).toBeDisabled();
  });

  it("searches by name, description or owner, and clears the search", async () => {
    const actor = renderManager();

    await actor.type(screen.getByLabelText("Search groups"), "writers");
    expect(screen.queryByText("Ops")).toBeNull();
    await actor.click(screen.getByRole("button", { name: "Search" }));
    await actor.click(screen.getByLabelText("Clear group search"));
    expect(screen.getByText("Ops")).toBeInTheDocument();

    await actor.type(screen.getByLabelText("Search groups"), "nothing-like-this");
    expect(screen.getByText("No groups found")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByText("Ops")).toBeInTheDocument();
  });

  it("pages through a long list", async () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      group({ id: `m${index}`, name: `Team ${String(index).padStart(2, "0")}` }),
    );
    const actor = renderManager(many);

    expect(screen.getByText("Showing 1–10 of 12")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await actor.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Showing 11–12 of 12")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Previous page" }));
    await actor.click(screen.getByRole("button", { name: "Rows per page" }));
    await actor.click(screen.getByRole("menuitemradio", { name: "25" }));
    expect(screen.getByText("Showing 1–12 of 12")).toBeInTheDocument();
  });

  it("deletes a group after confirming", async () => {
    const actor = renderManager();

    await actor.click(screen.getByRole("button", { name: "Delete Ops" }));
    expect(screen.getByText(/This removes the group "Ops"/)).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Delete group" }));

    await waitFor(() => expect(screen.queryByText("Ops")).toBeNull());
    expect(mocked.delete).toHaveBeenCalledWith("/api/v1/groups/g3");
    expect(toastSuccess).toHaveBeenCalledWith("Group deleted.");
  });

  it("keeps a group the server refuses to delete", async () => {
    const actor = renderManager();

    mocked.delete.mockRejectedValueOnce(new ApiError(409, "group_in_use", "Still in use."));
    await actor.click(screen.getByRole("button", { name: "Delete Ops" }));
    await actor.click(screen.getByRole("button", { name: "Delete group" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Still in use."));

    mocked.delete.mockRejectedValueOnce(new Error("offline"));
    await actor.click(screen.getByRole("button", { name: "Delete Ops" }));
    await actor.click(screen.getByRole("button", { name: "Delete group" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not delete group."));
    expect(screen.getByText("Ops")).toBeInTheDocument();
  });

  it("backs out of a delete", async () => {
    const actor = renderManager();

    await actor.click(screen.getByRole("button", { name: "Delete Ops" }));
    await actor.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mocked.delete).not.toHaveBeenCalled();
  });

  it("opens a group's access grants and keeps the row's count in step", async () => {
    const actor = renderManager();

    await actor.click(screen.getByRole("button", { name: "2 spaces" }));
    const dialog = await screen.findByRole("dialog", { name: /"Ops" — Access grants/ });
    await actor.click(await within(dialog).findByRole("button", { name: 'Remove from "Engineering"' }));
    await actor.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(screen.getAllByText("Not used").length).toBeGreaterThan(0));
    await actor.click(within(dialog).getByText("Close", { selector: "button" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("opens the edit dialog and reflects a saved change in the row", async () => {
    const actor = renderManager();

    await actor.click(screen.getByRole("button", { name: "Edit Ops" }));
    const dialog = await screen.findByRole("dialog", { name: 'Edit group "Ops"' });
    await actor.type(within(dialog).getByLabelText("Description"), "Runs things");
    mocked.patch.mockResolvedValueOnce(group({ id: "g3", name: "Ops", description: "Runs things" }));
    mocked.get.mockResolvedValueOnce([]).mockResolvedValueOnce(group({ id: "g3", name: "Ops" }));
    await actor.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.getByText("Runs things")).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("deletes several groups at once, skipping default groups", async () => {
    const actor = renderManager();
    mocked.delete.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ApiError(409, "x", "In use."));

    await actor.click(screen.getByRole("button", { name: "Select" }));
    await actor.click(screen.getByLabelText("Select all rows on this page"));
    expect(screen.getByText("2 groups selected")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Delete selected" }));
    expect(screen.getByText(/a group still granting one will fail to delete/)).toBeInTheDocument();
    await actor.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete selected" }),
    );

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Deleted 1 group."));
    expect(toastError).toHaveBeenCalledWith("Could not delete 1 group: In use.");
    expect(refresh).toHaveBeenCalled();
  });

  it("toggles row selection, clears it, and cancels select mode", async () => {
    const actor = renderManager();

    await actor.click(screen.getByRole("button", { name: "Select" }));
    const rows = screen.getAllByLabelText("Select row");
    expect(rows[1]).toBeDisabled();
    await actor.click(rows[0]!);
    expect(screen.getByText("1 group selected")).toBeInTheDocument();
    await actor.click(rows[0]!);
    await actor.click(screen.getByLabelText("Select all rows on this page"));
    await actor.click(screen.getByLabelText("Select all rows on this page"));
    await actor.click(rows[2]!);
    await actor.click(screen.getByRole("button", { name: "Clear" }));
    await actor.click(rows[2]!);
    await actor.click(screen.getByRole("button", { name: "Delete selected" }));
    await actor.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    mocked.delete.mockRejectedValueOnce(new Error("offline"));
    await actor.click(screen.getByRole("button", { name: "Delete selected" }));
    await actor.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete selected" }),
    );
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Could not delete 1 group: Unknown error"),
    );

    await actor.click(screen.getByRole("button", { name: "Select" }));
    await actor.click(screen.getByRole("button", { name: /^Cancel/ }));
    expect(screen.queryByLabelText("Select row")).toBeNull();
  });

  it("offers to create the first group when there are none", () => {
    renderManager([]);

    expect(screen.getByText("No groups yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Create group" })).toHaveLength(2);
  });
});

describe("GroupManager global access tab", () => {
  it("lists only groups granting a global permission", async () => {
    const actor = renderManager();

    await actor.click(screen.getByRole("button", { name: /Global access \(2\)/ }));

    expect(screen.getByText(/^2 groups currently grant at least/)).toBeInTheDocument();
    expect(screen.queryByText("Ops")).toBeNull();
    expect(screen.getByText("@ann")).toBeInTheDocument();
    expect(screen.getByText("Create spaces")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete users" })).toBeDisabled();

    await actor.click(screen.getByRole("button", { name: "Delete Docs" }));
    expect(screen.getByRole("alertdialog", { name: "Delete group?" })).toBeInTheDocument();
    await actor.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));

    await actor.click(screen.getByRole("button", { name: "Edit Docs" }));
    expect(await screen.findByRole("dialog", { name: 'Edit group "Docs"' })).toBeInTheDocument();
  });

  it("says so when no group grants anything workspace-wide", async () => {
    const actor = renderManager([group({ id: "g9", name: "Plain", member_count: 1 })]);

    await actor.click(screen.getByRole("button", { name: /Global access \(0\)/ }));

    expect(screen.getByText("No groups grant global access")).toBeInTheDocument();
    expect(screen.getByText(/^0 groups currently grant at least/)).toBeInTheDocument();
  });

  it("uses the singular for one group", async () => {
    const actor = renderManager([group({ id: "g9", name: "One", global_permissions: ["manage_issues"] })]);
    await actor.click(screen.getByRole("button", { name: /Global access \(1\)/ }));
    expect(screen.getByText(/^1 group currently grants at least/)).toBeInTheDocument();
  });
});

describe("CreateGroupDialog", () => {
  function renderCreate(users: User[] = USERS) {
    const onCreated = vi.fn();
    render(<CreateGroupDialog users={users} onCreated={onCreated} />);
    return { onCreated, actor: userEvent.setup() };
  }

  it("creates a group with an owner and extra members", async () => {
    mocked.post.mockResolvedValue(group({ id: "new", name: "Writers", member_count: 1 }));
    const { onCreated, actor } = renderCreate();

    await actor.click(screen.getByRole("button", { name: "Create group" }));
    await actor.type(screen.getByLabelText("Group name"), " Writers ");
    await actor.type(screen.getByLabelText(/Description/), "People who write");
    expect(screen.getByLabelText("Add Ann Lee")).toBeDisabled();
    await actor.click(screen.getByLabelText("Add bob"));
    await actor.click(screen.getByLabelText("Add Cat Ho"));
    await actor.click(screen.getByLabelText("Add Cat Ho"));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    await actor.click(within(dialog).getByRole("button", { name: "Create group" }));

    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ member_count: 2 })),
    );
    expect(mocked.post).toHaveBeenCalledWith("/api/v1/groups", {
      name: "Writers",
      description: "People who write",
      owner_id: "ann",
    });
    expect(mocked.put).toHaveBeenCalledWith("/api/v1/groups/new/members", { user_id: "bob" });
    expect(toastSuccess).toHaveBeenCalledWith('Group "Writers" created.');
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("changes the owner, who becomes a member too, and filters people", async () => {
    mocked.post.mockResolvedValue(group({ id: "new", name: "X" }));
    const { actor } = renderCreate();
    await actor.click(screen.getByRole("button", { name: "Create group" }));

    await actor.click(screen.getByRole("button", { name: "Group owner" }));
    await actor.click(screen.getByRole("menuitemradio", { name: "bob (@bob)" }));
    expect(screen.getByRole("button", { name: "Group owner" })).toHaveTextContent("bob");
    await actor.click(screen.getByRole("button", { name: "Group owner" }));
    await actor.click(screen.getByRole("menuitemradio", { name: "Ann Lee (@ann)" }));

    await actor.type(screen.getByLabelText("Filter users"), "cat@");
    expect(screen.queryByLabelText("Add bob")).toBeNull();
    await actor.clear(screen.getByLabelText("Filter users"));
    await actor.type(screen.getByLabelText("Filter users"), "nobody");
    expect(screen.getByText("No users match this filter.")).toBeInTheDocument();
  });

  it("keeps the new group when adding members partly fails, and says so", async () => {
    mocked.post.mockResolvedValue(group({ id: "new", name: "X", member_count: 1 }));
    const { onCreated, actor } = renderCreate();
    await actor.click(screen.getByRole("button", { name: "Create group" }));
    await actor.type(screen.getByLabelText("Group name"), "X");
    await actor.click(screen.getByLabelText("Add bob"));

    mocked.put.mockRejectedValueOnce(new ApiError(400, "bad", "Inactive user."));
    await actor.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create group" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Group created, but some members could not be added: Inactive user.",
    );
    expect(onCreated).toHaveBeenCalledTimes(1);

    mocked.put.mockRejectedValueOnce(new Error("offline"));
    await actor.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create group" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Group created, but some members could not be added.",
      ),
    );
  });

  it("reports a group the server refuses to create", async () => {
    const { actor } = renderCreate();
    await actor.click(screen.getByRole("button", { name: "Create group" }));
    await actor.type(screen.getByLabelText("Group name"), "Docs");

    mocked.post.mockRejectedValueOnce(new ApiError(409, "conflict", "Name taken."));
    await actor.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create group" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Name taken.");

    mocked.post.mockRejectedValueOnce(new Error("offline"));
    await actor.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create group" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Could not create group."),
    );
  });

  it("cannot submit without a name, and resets when cancelled", async () => {
    const { actor } = renderCreate();
    await actor.click(screen.getByRole("button", { name: "Create group" }));

    within(screen.getByRole("dialog")).getByRole("button", { name: "Create group" }).closest("form")!.requestSubmit();
    expect(mocked.post).not.toHaveBeenCalled();

    await actor.type(screen.getByLabelText("Group name"), "Draft");
    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await actor.click(screen.getByRole("button", { name: "Create group" }));
    expect(screen.getByLabelText("Group name")).toHaveValue("");
  });

  it("asks for a user first when there are none", async () => {
    const { actor } = renderCreate([]);
    await actor.click(screen.getByRole("button", { name: "Create group" }));

    expect(screen.getByText("Create a user before creating a group.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Group owner" })).toHaveTextContent("Choose an owner");
  });
});

describe("bulk selection helpers", () => {
  it("refuses to be used outside its provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<SelectModeButton />)).toThrow(/inside BulkSelectionProvider/);
  });

  it("adds a column and a blank header while selecting a page with nothing selectable", async () => {
    render(
      <BulkSelectionProvider>
        <SelectModeButton />
        <table>
          <colgroup>
            <SelectionColumn />
          </colgroup>
          <thead>
            <tr>
              <SelectionHeaderCell />
            </tr>
          </thead>
        </table>
      </BulkSelectionProvider>,
    );

    expect(document.querySelector("col")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Select" }));
    expect(document.querySelector("col")).not.toBeNull();
    expect(screen.getByText("Select", { selector: ".sr-only" })).toBeInTheDocument();
  });
});

describe("GroupManager creating groups", () => {
  it("adds a newly created group to the directory in name order", async () => {
    mocked.post.mockResolvedValue(group({ id: "g4", name: "Alpha" }));
    const actor = renderManager();

    await actor.click(screen.getByRole("button", { name: "Create group" }));
    await actor.type(screen.getByLabelText("Group name"), "Alpha");
    await actor.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create group" }));

    await waitFor(() => expect(screen.getByRole("button", { name: /Group directory \(4\)/ })).toBeInTheDocument());
    const names = screen.getAllByRole("row").slice(1).map((row) => row.querySelector("p")?.textContent);
    expect(names[0]).toBe("Alpha");
  });

  it("creates the first group from the empty state", async () => {
    mocked.post.mockResolvedValue(group({ id: "g4", name: "First" }));
    const actor = renderManager([]);

    await actor.click(screen.getAllByRole("button", { name: "Create group" })[1]!);
    await actor.type(screen.getByLabelText("Group name"), "First");
    await actor.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create group" }));

    expect(await screen.findByText("First")).toBeInTheDocument();
    expect(screen.queryByText("No groups yet")).toBeNull();
  });

  it("names page-only grants on their own", () => {
    renderManager([group({ id: "g5", name: "Pages", page_count: 1 })]);
    expect(screen.getByRole("button", { name: "1 page" })).toBeInTheDocument();
  });

  it("starts the create form afresh after closing it with Escape", async () => {
    const actor = userEvent.setup();
    render(<CreateGroupDialog users={USERS} onCreated={vi.fn()} />);

    await actor.click(screen.getByRole("button", { name: "Create group" }));
    await actor.type(screen.getByLabelText("Group name"), "Draft");
    await actor.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await actor.click(screen.getByRole("button", { name: "Create group" }));

    expect(screen.getByLabelText("Group name")).toHaveValue("");
  });
});
