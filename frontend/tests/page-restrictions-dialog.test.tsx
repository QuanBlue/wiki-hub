import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { PageRestrictionsDialog } from "@/components/pages/page-restrictions-dialog";
import type {
  PageAccessRosterGroup,
  PageAccessRosterUser,
  PageRestrictionGroupOption,
  PageRestrictionUserOption,
  SpaceMember,
  WikiPage,
} from "@/types/api";

/** `PageRestrictionsDialog` is controlled - like `MovePageDialog` - so the
 * caller (in production, a `DropdownMenuItem`) owns both a trigger and the
 * open state. This stands in for that caller. */
function ControlledDialog(
  props: Omit<ComponentProps<typeof PageRestrictionsDialog>, "open" | "onOpenChange">,
) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Page access
      </Button>
      <PageRestrictionsDialog {...props} open={open} onOpenChange={setOpen} />
    </>
  );
}

/**
 * Regression coverage for this dialog's design:
 *
 * 1. An already-added principal's permission could only be changed by
 *    deleting their row and re-adding them - there was no way to flip
 *    "Can view" to "Can edit" (or add the other) in place. Restricted mode
 *    folds View/Edit into two checkboxes on one row per principal, so
 *    toggling either is a single PUT/DELETE against the row already there,
 *    not a delete-then-recreate.
 * 2. Open mode (the page's default) shows every space member/group with
 *    their current access pre-checked - no add/remove step, unchecking a
 *    box blocks just that principal via a separate "/block" endpoint,
 *    independent of the Restricted allow-list.
 * 3. Switching General access between Open and Restricted no longer
 *    discards either mode's own configuration - it comes right back when
 *    switched back - and a separate, confirmed "Reset" wipes only the mode
 *    currently active.
 */

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.info).mockClear();
});

const PAGE = { id: "p1", slug: "team", title: "Team", is_restricted: false } as WikiPage;
const RESTRICTED_PAGE = { ...PAGE, is_restricted: true } as WikiPage;
const MEMBERS: SpaceMember[] = [];
const GROUPS: PageRestrictionGroupOption[] = [{ id: "g1", name: "team_devops", has_space_access: true }];
const USERS: PageRestrictionUserOption[] = [
  { id: "u1", username: "admin", full_name: "WikiHub Administrator", has_space_access: true },
];
const ROSTER_USERS: PageAccessRosterUser[] = [
  { id: "u1", username: "admin", full_name: "WikiHub Administrator", view: true, edit: true, view_locked: false, edit_locked: false },
];
const ROSTER_GROUPS: PageAccessRosterGroup[] = [
  { id: "g1", name: "team_devops", view: true, edit: false, view_locked: false, edit_locked: false },
];

type Row = { page_id: string; principal_id: string; principal_type: "user" | "group"; principal_name: string; permission: "view" | "edit" };

function mockFetch(
  initialRows: Row[],
  options?: {
    users?: PageRestrictionUserOption[];
    groups?: PageRestrictionGroupOption[];
    rosterUsers?: PageAccessRosterUser[];
    rosterGroups?: PageAccessRosterGroup[];
  },
) {
  const users = options?.users ?? USERS;
  const groups = options?.groups ?? GROUPS;
  let rows = [...initialRows];
  let rosterUsers = options?.rosterUsers ?? ROSTER_USERS;
  let rosterGroups = options?.rosterGroups ?? ROSTER_GROUPS;
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();

    if (method === "GET" && pathname.endsWith("/restrictions")) {
      return Response.json(rows);
    }
    if (method === "GET" && pathname.endsWith("/restrictions/principals/users")) {
      return Response.json(users);
    }
    if (method === "GET" && pathname.endsWith("/restrictions/principals/groups")) {
      return Response.json(groups);
    }
    if (method === "GET" && pathname.endsWith("/restrictions/roster/users")) {
      return Response.json(rosterUsers);
    }
    if (method === "GET" && pathname.endsWith("/restrictions/roster/groups")) {
      return Response.json(rosterGroups);
    }
    if (method === "PATCH" && pathname.endsWith("/restrictions/mode")) {
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && pathname.endsWith("/restrictions/reset")) {
      return new Response(null, { status: 204 });
    }
    const blockMatch = pathname.match(/\/restrictions\/(users|groups)\/([^/]+)\/(view|edit)\/block$/);
    if (blockMatch && (method === "PUT" || method === "DELETE")) {
      const [, kind, id, permission] = blockMatch;
      const blocked = method === "PUT";
      const patch = (row: { view: boolean; edit: boolean }) =>
        permission === "view" && blocked ? { view: false, edit: false } : { [permission]: !blocked };
      if (kind === "users") {
        rosterUsers = rosterUsers.map((row) => (row.id === id ? { ...row, ...patch(row) } : row));
      } else {
        rosterGroups = rosterGroups.map((row) => (row.id === id ? { ...row, ...patch(row) } : row));
      }
      return new Response(null, { status: 204 });
    }
    const match = pathname.match(/\/restrictions\/(users|groups)\/([^/]+)\/(view|edit)$/);
    if (match && (method === "PUT" || method === "DELETE")) {
      const [, kind, id, permission] = match;
      const type = kind === "users" ? "user" : "group";
      if (method === "PUT") {
        rows = [
          ...rows.filter((r) => !(r.principal_id === id && r.principal_type === type && r.permission === permission)),
          { page_id: PAGE.id, principal_id: id, principal_type: type, principal_name: id === "u1" ? "admin" : "team_devops", permission: permission as "view" | "edit" },
        ];
      } else {
        rows = rows.filter((r) => !(r.principal_id === id && r.principal_type === type && r.permission === permission));
      }
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify({ error: { code: "not_found", message: `Unhandled ${method} ${pathname}` } }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

async function openDialog(page: WikiPage = PAGE) {
  const actor = userEvent.setup();
  render(<ControlledDialog spaceKey="ENG" page={page} members={MEMBERS} />);
  await actor.click(screen.getByRole("button", { name: /page access/i }));
  await screen.findByRole("dialog");
  return actor;
}

/** Both tables start read-only, matching `EditSpaceModal` - editing one
 * requires clicking its own "Edit" first. */
async function unlock(actor: ReturnType<typeof userEvent.setup>, section: HTMLElement) {
  await actor.click(within(section).getByRole("button", { name: /^edit$/i }));
}

function groupSection() {
  return screen.getByRole("columnheader", { name: "Group" }).closest("div.overflow-hidden") as HTMLElement;
}

function userSection() {
  return screen.getByRole("columnheader", { name: "User" }).closest("div.overflow-hidden") as HTMLElement;
}

describe("PageRestrictionsDialog - Restricted mode (allow-list)", () => {
  it("shows one row per principal, not one per permission", async () => {
    mockFetch([
      { page_id: "p1", principal_id: "u1", principal_type: "user", principal_name: "admin", permission: "view" },
      { page_id: "p1", principal_id: "u1", principal_type: "user", principal_name: "admin", permission: "edit" },
    ]);
    await openDialog(RESTRICTED_PAGE);

    const rows = await screen.findAllByRole("row");
    const adminRows = rows.filter((row) => within(row).queryByText("admin"));
    expect(adminRows).toHaveLength(1);
    expect(within(adminRows[0]).getByRole("checkbox", { name: /admin: can view/i })).toBeChecked();
    expect(within(adminRows[0]).getByRole("checkbox", { name: /admin: can edit/i })).toBeChecked();
  });

  it("keeps both tables read-only until their own Edit is clicked", async () => {
    mockFetch([
      { page_id: "p1", principal_id: "g1", principal_type: "group", principal_name: "team_devops", permission: "view" },
    ]);
    await openDialog(RESTRICTED_PAGE);

    const checkbox = await screen.findByRole("checkbox", { name: /team_devops: can view/i });
    expect(checkbox).toBeDisabled();
    // No remove button anywhere while every table is locked.
    expect(screen.queryByRole("button", { name: /remove team_devops/i })).not.toBeInTheDocument();
  });

  it("lets an existing principal's permission be toggled in place, not only added or removed", async () => {
    const fetchSpy = mockFetch([
      { page_id: "p1", principal_id: "g1", principal_type: "group", principal_name: "team_devops", permission: "view" },
    ]);
    const actor = await openDialog(RESTRICTED_PAGE);
    await screen.findByRole("checkbox", { name: /team_devops: can view/i });
    await unlock(actor, groupSection());

    const editCheckbox = screen.getByRole("checkbox", { name: /team_devops: can edit/i });
    expect(editCheckbox).not.toBeChecked();
    await actor.click(editCheckbox);

    await waitFor(() => expect(editCheckbox).toBeChecked());
    const putCall = fetchSpy.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
    expect(putCall?.[0]).toContain("/restrictions/groups/g1/edit");

    // The existing "view" grant is untouched by flipping "edit" on.
    expect(screen.getByRole("checkbox", { name: /team_devops: can view/i })).toBeChecked();
  });

  it("removes both permissions at once from the row's trash button", async () => {
    const fetchSpy = mockFetch([
      { page_id: "p1", principal_id: "g1", principal_type: "group", principal_name: "team_devops", permission: "view" },
      { page_id: "p1", principal_id: "g1", principal_type: "group", principal_name: "team_devops", permission: "edit" },
    ]);
    const actor = await openDialog(RESTRICTED_PAGE);
    await screen.findByRole("checkbox", { name: /team_devops: can view/i });
    await unlock(actor, groupSection());

    await actor.click(screen.getByRole("button", { name: /remove team_devops/i }));

    await waitFor(() =>
      expect(within(groupSection()).getByText(/no groups restricted/i)).toBeInTheDocument(),
    );
    const deleteCalls = fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE");
    expect(deleteCalls).toHaveLength(2);
  });

  it("adds a newly picked principal with View checked by default", async () => {
    mockFetch([]);
    const actor = await openDialog(RESTRICTED_PAGE);
    // Wait for the load (rows + eligible principals) to settle before
    // unlocking and opening the picker, or it can race the still-pending
    // fetch and open with nothing in it.
    await within(userSection()).findByText(/no users restricted/i);
    await unlock(actor, userSection());

    await actor.click(screen.getByRole("button", { name: /add a user/i }));
    await actor.click(await screen.findByText("WikiHub Administrator (@admin)"));
    await actor.click(screen.getByRole("button", { name: /^add user$/i }));

    const viewCheckbox = await screen.findByRole("checkbox", { name: /wikihub administrator: can view/i });
    expect(viewCheckbox).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /wikihub administrator: can edit/i })).not.toBeChecked();
  });

  it("shows a principal without space access, but disabled and labelled instead of hidden", async () => {
    mockFetch([], {
      users: [
        ...USERS,
        { id: "u2", username: "outsider", full_name: "Outsider User", has_space_access: false },
      ],
    });
    const actor = await openDialog(RESTRICTED_PAGE);
    await within(userSection()).findByText(/no users restricted/i);
    await unlock(actor, userSection());
    await actor.click(screen.getByRole("button", { name: /add a user/i }));

    const outsiderOption = await screen.findByText("Outsider User (@outsider)");
    expect(within(outsiderOption.closest("button") as HTMLElement).getByText(/not added to space/i)).toBeInTheDocument();
    expect(outsiderOption.closest("button")).toBeDisabled();

    // Still eligible principals are unaffected and remain pickable.
    expect(screen.getByText("WikiHub Administrator (@admin)").closest("button")).not.toBeDisabled();
  });
});

describe("PageRestrictionsDialog - Open mode (roster + per-principal block)", () => {
  it("pre-checks every space member's current access, instead of starting blank", async () => {
    mockFetch([]);
    await openDialog();

    const row = (await screen.findAllByRole("row")).find((candidate) => within(candidate).queryByText("team_devops"));
    expect(row).toBeDefined();
    expect(within(row as HTMLElement).getByRole("checkbox", { name: /team_devops: can view/i })).toBeChecked();
    expect(within(row as HTMLElement).getByRole("checkbox", { name: /team_devops: can edit/i })).not.toBeChecked();
    // No add/remove affordance at all - the roster already lists everyone eligible.
    expect(screen.queryByRole("button", { name: /add a (user|group)/i })).not.toBeInTheDocument();
  });

  it("keeps the roster read-only until its own Edit is clicked", async () => {
    mockFetch([]);
    await openDialog();

    const checkbox = await screen.findByRole("checkbox", { name: /wikihub administrator: can view/i });
    expect(checkbox).toBeDisabled();
  });

  it("unchecking View blocks just that principal, via a dedicated endpoint", async () => {
    const fetchSpy = mockFetch([]);
    const actor = await openDialog();

    const viewCheckbox = await screen.findByRole("checkbox", { name: /wikihub administrator: can view/i });
    expect(viewCheckbox).toBeChecked();
    await unlock(actor, userSection());
    await actor.click(viewCheckbox);

    await waitFor(() => expect(viewCheckbox).not.toBeChecked());
    const putCall = fetchSpy.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
    expect(putCall?.[0]).toContain("/restrictions/users/u1/view/block");
    // Blocking View also drops Edit, since you can't edit what you can't view.
    expect(screen.getByRole("checkbox", { name: /wikihub administrator: can edit/i })).not.toBeChecked();
  });

  it("re-checking a blocked box clears the block instead of granting a new allow row", async () => {
    const fetchSpy = mockFetch([], {
      rosterGroups: [{ id: "g1", name: "team_devops", view: false, edit: false, view_locked: false, edit_locked: false }],
    });
    const actor = await openDialog();

    const viewCheckbox = await screen.findByRole("checkbox", { name: /team_devops: can view/i });
    expect(viewCheckbox).not.toBeChecked();
    await unlock(actor, groupSection());
    await actor.click(viewCheckbox);

    await waitFor(() => expect(viewCheckbox).toBeChecked());
    const deleteCall = fetchSpy.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "DELETE");
    expect(deleteCall?.[0]).toContain("/restrictions/groups/g1/view/block");
  });

  it("locks Edit for a principal whose space role doesn't include it, even once unlocked", async () => {
    mockFetch([], {
      rosterUsers: [
        { id: "u3", username: "viewer", full_name: "Viewer Only", view: true, edit: false, view_locked: false, edit_locked: true },
      ],
    });
    const actor = await openDialog();

    const editCheckbox = await screen.findByRole("checkbox", { name: /viewer only: can edit/i });
    expect(editCheckbox).toBeDisabled();
    await unlock(actor, userSection());
    expect(editCheckbox).toBeDisabled();
    // View is unaffected - it's only Edit their space role doesn't include.
    expect(screen.getByRole("checkbox", { name: /viewer only: can view/i })).not.toBeDisabled();
  });

  it("locks both View and Edit for a principal holding space Admin, since restrictions never apply to them", async () => {
    mockFetch([], {
      rosterUsers: [
        { id: "u4", username: "spaceadmin", full_name: "Space Admin", view: true, edit: true, view_locked: true, edit_locked: true },
      ],
    });
    const actor = await openDialog();

    const viewCheckbox = await screen.findByRole("checkbox", { name: /space admin: can view/i });
    const editCheckbox = screen.getByRole("checkbox", { name: /space admin: can edit/i });
    expect(viewCheckbox).toBeDisabled();
    expect(editCheckbox).toBeDisabled();
    await unlock(actor, userSection());
    expect(viewCheckbox).toBeDisabled();
    expect(editCheckbox).toBeDisabled();
  });
});

describe("PageRestrictionsDialog - switching modes and Reset", () => {
  it("switches Open<->Restricted immediately, with no confirmation, and keeps each mode's own configuration", async () => {
    const fetchSpy = mockFetch([
      { page_id: "p1", principal_id: "g1", principal_type: "group", principal_name: "team_devops", permission: "view" },
    ]);
    const actor = await openDialog(RESTRICTED_PAGE);

    expect(await screen.findByText("Restricted")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /team_devops: can view/i })).toBeChecked();

    await actor.click(screen.getByRole("button", { name: /restricted/i }));
    await actor.click(screen.getByRole("menuitemradio", { name: /^open$/i }));

    // No confirmation step - switching to Open is no longer destructive.
    expect(screen.queryByRole("button", { name: /^make open$/i })).not.toBeInTheDocument();
    const modeCall = await waitFor(() =>
      fetchSpy.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PATCH"),
    );
    expect(modeCall?.[1]).toMatchObject({ body: JSON.stringify({ restricted: false }) });
    await waitFor(() => expect(screen.getByText("Open")).toBeInTheDocument());
    // The roster now renders - team_devops's allow-list row didn't get
    // deleted, it's just not the view currently shown.
    expect(await screen.findByRole("checkbox", { name: /team_devops: can view/i })).toBeChecked();

    await actor.click(screen.getByRole("button", { name: /^open$/i }));
    await actor.click(screen.getByRole("menuitemradio", { name: /^restricted$/i }));
    expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/add a person or group below/i));

    // Back in Restricted, team_devops's row is exactly as it was before -
    // nothing had to be re-added.
    await waitFor(() => expect(screen.getByText("Restricted")).toBeInTheDocument());
    expect(await screen.findByRole("checkbox", { name: /team_devops: can view/i })).toBeChecked();
  });

  it("Reset asks for confirmation, then clears the allow-list while Restricted", async () => {
    const fetchSpy = mockFetch([
      { page_id: "p1", principal_id: "g1", principal_type: "group", principal_name: "team_devops", permission: "view" },
    ]);
    const actor = await openDialog(RESTRICTED_PAGE);
    await screen.findByRole("checkbox", { name: /team_devops: can view/i });

    await actor.click(screen.getByRole("button", { name: /reset to default/i }));
    const confirmDialog = await screen.findByRole("alertdialog");
    expect(within(confirmDialog).getByText(/closed to everyone but space admins/i)).toBeInTheDocument();

    await actor.click(within(confirmDialog).getByRole("button", { name: /^reset$/i }));

    await waitFor(() =>
      expect(fetchSpy.mock.calls.some(([url, init]) => `${url}`.endsWith("/restrictions/reset") && (init as RequestInit | undefined)?.method === "POST")).toBe(true),
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it("Reset asks for confirmation, then clears every block while Open", async () => {
    const fetchSpy = mockFetch([], {
      rosterGroups: [{ id: "g1", name: "team_devops", view: false, edit: false, view_locked: false, edit_locked: false }],
    });
    const actor = await openDialog();
    await screen.findByRole("checkbox", { name: /team_devops: can view/i });

    await actor.click(screen.getByRole("button", { name: /reset to default/i }));
    const confirmDialog = await screen.findByRole("alertdialog");
    expect(within(confirmDialog).getByText(/falls back to the access their space role already gives/i)).toBeInTheDocument();

    await actor.click(within(confirmDialog).getByRole("button", { name: /^reset$/i }));

    await waitFor(() =>
      expect(fetchSpy.mock.calls.some(([url, init]) => `${url}`.endsWith("/restrictions/reset") && (init as RequestInit | undefined)?.method === "POST")).toBe(true),
    );
    expect(toast.success).toHaveBeenCalled();
  });
});
