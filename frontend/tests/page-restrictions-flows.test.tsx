import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "sonner";

import { PageRestrictionsDialog } from "@/components/pages/page-restrictions-dialog";
import { Button } from "@/components/ui/button";
import type { WikiPage } from "@/types/api";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

function Host(props: Omit<ComponentProps<typeof PageRestrictionsDialog>, "open" | "onOpenChange">) {
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

type Ctx = { method: string; pathname: string; body: unknown };
type Reply = Response | unknown;
type Route = (ctx: Ctx) => Reply;

let calls: Ctx[] = [];
let routes: Record<string, Route> = {};

function fail(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: { code: "boom", message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ROSTER_USERS = [
  { id: "u1", username: "ann", full_name: "Ann Lee", view: true, edit: true, view_locked: false, edit_locked: false, inherited: true },
  { id: "u2", username: "bob", full_name: "Bob Ng", view: false, edit: false, view_locked: true, edit_locked: true, inherited: true },
];
const ROSTER_GROUPS = [
  { id: "g1", name: "docs", view: true, edit: false, view_locked: false, edit_locked: false, inherited: true },
];

/** Routes are matched on "METHOD suffix"; the first suffix a path ends with wins. */
function install(extra: Record<string, Route> = {}) {
  routes = {
    "GET /restrictions/roster/users": () => ROSTER_USERS,
    "GET /restrictions/roster/groups": () => ROSTER_GROUPS,
    "GET /restrictions/principals/users": () => [
      { id: "u1", username: "ann", full_name: "Ann Lee", has_space_access: true },
    ],
    "GET /restrictions/principals/groups": () => [{ id: "g1", name: "docs", has_space_access: true }],
    "GET /restrictions": () => [],
    ...extra,
  };
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const { pathname } = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      const ctx: Ctx = { method, pathname, body: init?.body ? JSON.parse(init.body as string) : undefined };
      calls.push(ctx);
      const key = Object.keys(routes)
        .sort((x, y) => y.length - x.length)
        .find((k) => {
          const [m, suffix] = k.split(" ");
          return m === method && pathname.endsWith(suffix);
        });
      if (!key) return new Response(null, { status: 204 });
      const reply = routes[key](ctx);
      return reply instanceof Response ? reply : Response.json(reply);
    }),
  );
}

const called = (method: string, suffix: string) =>
  calls.filter((c) => c.method === method && c.pathname.endsWith(suffix));

const TOP = { id: "p1", slug: "team", title: "Team", is_restricted: false } as WikiPage;
const RESTRICTED = { ...TOP, is_restricted: true, own_restricted: true } as WikiPage;
const CHILD_OF_RESTRICTED = {
  id: "p2",
  slug: "child",
  title: "Child",
  parent_id: "par",
  inherit_restrictions: true,
  inherits_view_restriction: true,
  restricted_ancestor_title: "Handbook",
  is_restricted: true,
  own_restricted: false,
} as WikiPage;
const CHILD_OF_OPEN = {
  id: "p3",
  slug: "kid",
  title: "Kid",
  parent_id: "par",
  inherit_restrictions: true,
  is_restricted: false,
} as WikiPage;

async function open(page: WikiPage) {
  const actor = userEvent.setup();
  render(<Host spaceKey="ENG" page={page} members={[]} />);
  await actor.click(screen.getByRole("button", { name: /page access/i }));
  await screen.findByRole("dialog");
  await waitFor(() => expect(screen.queryByText(/loading/i)).not.toBeInTheDocument());
  return actor;
}

beforeEach(() => {
  vi.clearAllMocks();
  install();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function chooseMode(actor: ReturnType<typeof userEvent.setup>, from: RegExp, to: RegExp) {
  await actor.click(screen.getByRole("button", { name: from }));
  await actor.click(await screen.findByRole("menuitemradio", { name: to }));
}

describe("a page under a Restricted parent", () => {
  it("shows only who the parent lets in, read-only", async () => {
    await open(CHILD_OF_RESTRICTED);
    expect(screen.getByText("Ann Lee")).toBeInTheDocument();
    expect(screen.queryByText("Bob Ng")).not.toBeInTheDocument();
    expect(screen.getAllByRole("checkbox", { name: /can view/i }).every((c) => (c as HTMLInputElement).disabled)).toBe(true);
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
  });

  it("drafts an own list from the parent's, edits it and saves", async () => {
    const actor = await open(CHILD_OF_RESTRICTED);
    await chooseMode(actor, /inherit parent/i, /restricted \(own list\)/i);

    const save = await screen.findByRole("button", { name: /save list/i });
    expect(called("GET", "/child/restrictions")).toHaveLength(1);
    // Unticking View also unticks Edit; ticking Edit ticks View.
    const annView = screen.getByRole("checkbox", { name: /ann lee: can view/i });
    const annEdit = screen.getByRole("checkbox", { name: /ann lee: can edit/i });
    expect(annView).toBeChecked();
    expect(annEdit).toBeChecked();
    await actor.click(annView);
    expect(annEdit).not.toBeChecked();
    await actor.click(annEdit);
    expect(annView).toBeChecked();
    expect(annEdit).toBeChecked();
    await actor.click(annView);
    await actor.click(screen.getByRole("checkbox", { name: /docs: can edit/i }));

    await actor.click(save);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved this page's own access list."));
    expect(called("PATCH", "/restrictions/mode")[0].body).toEqual({ restricted: true });
    // Ann was unticked entirely, so only the group is written - with Edit.
    const puts = calls.filter((c) => c.method === "PUT").map((c) => c.pathname);
    expect(puts).toEqual(["/api/v1/spaces/ENG/pages/child/restrictions/groups/g1/edit"]);
    expect(refresh).toHaveBeenCalled();
  });

  it("writes a View grant for a member whose Edit is off", async () => {
    install({
      "GET /restrictions/roster/users": () => [
        { ...ROSTER_USERS[0], edit: false },
      ],
    });
    const actor = await open(CHILD_OF_RESTRICTED);
    await chooseMode(actor, /inherit parent/i, /restricted \(own list\)/i);
    await actor.click(await screen.findByRole("button", { name: /save list/i }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(calls.filter((c) => c.method === "PUT").map((c) => c.pathname)).toContain(
      "/api/v1/spaces/ENG/pages/child/restrictions/users/u1/view",
    );
  });

  it("cancels the draft without saving anything", async () => {
    const actor = await open(CHILD_OF_RESTRICTED);
    await chooseMode(actor, /inherit parent/i, /restricted \(own list\)/i);
    await actor.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: /save list/i })).not.toBeInTheDocument();
    expect(called("PATCH", "/restrictions/mode")).toHaveLength(0);
  });

  it("shows an empty draft when the parent lets nobody in", async () => {
    install({ "GET /restrictions/roster/users": () => [], "GET /restrictions/roster/groups": () => [] });
    const actor = await open(CHILD_OF_RESTRICTED);
    await chooseMode(actor, /inherit parent/i, /restricted \(own list\)/i);
    expect(await screen.findByText(/lets nobody in besides admins/i)).toBeInTheDocument();
  });

  it("switches straight to Restricted when the page already has its own list", async () => {
    install({ "GET /child/restrictions": () => [{ principal_id: "u1", principal_type: "user", permission: "view" }] });
    const actor = await open(CHILD_OF_RESTRICTED);
    await chooseMode(actor, /inherit parent/i, /restricted \(own list\)/i);
    await waitFor(() => expect(called("PATCH", "/restrictions/mode")).toHaveLength(1));
    expect(screen.queryByRole("button", { name: /save list/i })).not.toBeInTheDocument();
  });

  it("reports when the existing list cannot be read", async () => {
    install({ "GET /child/restrictions": () => fail("Nope") });
    const actor = await open(CHILD_OF_RESTRICTED);
    await chooseMode(actor, /inherit parent/i, /restricted \(own list\)/i);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Nope"));
  });

  it("reports a failed save and keeps the draft", async () => {
    install({ "PATCH /restrictions/mode": () => fail("Cannot save") });
    const actor = await open(CHILD_OF_RESTRICTED);
    await chooseMode(actor, /inherit parent/i, /restricted \(own list\)/i);
    await actor.click(await screen.findByRole("button", { name: /save list/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Cannot save"));
    expect(screen.getByRole("button", { name: /save list/i })).toBeInTheDocument();
  });

  it("drops the draft when Inherit parent is picked again", async () => {
    const actor = await open(CHILD_OF_RESTRICTED);
    await chooseMode(actor, /inherit parent/i, /restricted \(own list\)/i);
    await screen.findByRole("button", { name: /save list/i });
    await chooseMode(actor, /restricted \(own list\)/i, /inherit parent/i);
    expect(screen.queryByRole("button", { name: /save list/i })).not.toBeInTheDocument();
    expect(called("PATCH", "/restrictions/mode")).toHaveLength(0);
  });

  it("returns to the parent's list from an own list", async () => {
    const own = { ...CHILD_OF_RESTRICTED, own_restricted: true } as WikiPage;
    const actor = await open(own);
    await chooseMode(actor, /restricted \(own list\)/i, /inherit parent/i);
    await waitFor(() => expect(called("PATCH", "/restrictions/mode")[0].body).toEqual({ restricted: false }));
  });

  it("ignores picking the mode it is already in", async () => {
    const own = { ...CHILD_OF_RESTRICTED, own_restricted: true } as WikiPage;
    const actor = await open(own);
    await chooseMode(actor, /restricted \(own list\)/i, /restricted \(own list\)/i);
    expect(called("PATCH", "/restrictions/mode")).toHaveLength(0);
  });
});

describe("inheriting permissions", () => {
  it("turns inheritance off at once and says what happened", async () => {
    const actor = await open(CHILD_OF_OPEN);
    await actor.click(screen.getByRole("switch", { name: /inherit permissions/i }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/copied the parent/i)));
    expect(called("PATCH", "/restrictions/inherit")[0].body).toEqual({ inherit: false });
    expect(screen.getByRole("switch", { name: /inherit permissions/i })).toHaveAttribute("aria-checked", "false");
  });

  it("asks before turning inheritance back on", async () => {
    const off = { ...CHILD_OF_OPEN, inherit_restrictions: false } as WikiPage;
    const actor = await open(off);
    await actor.click(screen.getByRole("switch", { name: /inherit permissions/i }));
    const dialog = await screen.findByRole("alertdialog");
    await actor.click(within(dialog).getByRole("button", { name: /inherit again/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/follows its parent/i)));
    expect(called("PATCH", "/restrictions/inherit")[0].body).toEqual({ inherit: true });
  });

  it("reports a failed switch", async () => {
    install({ "PATCH /restrictions/inherit": () => fail("No inherit") });
    const actor = await open(CHILD_OF_OPEN);
    await actor.click(screen.getByRole("switch", { name: /inherit permissions/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("No inherit"));
  });

  it("keeps a restricted page restricted when inheritance is switched off", async () => {
    const actor = await open({ ...CHILD_OF_RESTRICTED } as WikiPage);
    await actor.click(screen.getByRole("switch", { name: /inherit permissions/i }));
    await waitFor(() => expect(called("PATCH", "/restrictions/inherit")).toHaveLength(1));
  });
});

describe("failures and edge paths", () => {
  it("reports when the dialog data cannot be loaded", async () => {
    install({ "GET /restrictions/roster/users": () => fail("Roster down") });
    await open(TOP);
    expect(toast.error).toHaveBeenCalledWith("Roster down");
  });

  it("uses a generic message for a non-API load failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const actor = userEvent.setup();
    render(<Host spaceKey="ENG" page={TOP} members={[]} />);
    await actor.click(screen.getByRole("button", { name: /page access/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it("adds a group from the picker then gives it Edit", async () => {
    const actor = await open(RESTRICTED);
    await actor.click(within(screen.getByRole("columnheader", { name: "Group" }).closest("div.overflow-hidden") as HTMLElement).getByRole("button", { name: /^edit$/i }));
    await actor.click(screen.getByRole("button", { name: /add a group/i }));
    await actor.click(await screen.findByText("docs"));
    await actor.click(screen.getByRole("button", { name: /^add group$/i }));
    expect(await screen.findByRole("checkbox", { name: /docs: can view/i })).toBeChecked();

    await actor.click(screen.getByRole("checkbox", { name: /docs: can edit/i }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /docs: can edit/i })).toBeChecked());
    expect(refresh).toHaveBeenCalled();
  });

  it("removes a principal that only has View", async () => {
    install({
      "GET /restrictions": () => [
        { page_id: "p1", principal_id: "g1", principal_type: "group", principal_name: "docs", permission: "view" },
      ],
    });
    const actor = await open(RESTRICTED);
    await actor.click(within(screen.getByRole("columnheader", { name: "Group" }).closest("div.overflow-hidden") as HTMLElement).getByRole("button", { name: /^edit$/i }));
    await actor.click(await screen.findByRole("button", { name: /remove docs/i }));
    await waitFor(() => expect(called("DELETE", "/groups/g1/view")).toHaveLength(1));
    expect(called("DELETE", "/groups/g1/edit")).toHaveLength(0);
  });

  it("reports a failed grant", async () => {
    install({
      "PUT /groups/g1/view": () => fail("Denied"),
    });
    const actor = await open(RESTRICTED);
    await actor.click(within(screen.getByRole("columnheader", { name: "Group" }).closest("div.overflow-hidden") as HTMLElement).getByRole("button", { name: /^edit$/i }));
    await actor.click(screen.getByRole("button", { name: /add a group/i }));
    await actor.click(await screen.findByText("docs"));
    await actor.click(screen.getByRole("button", { name: /^add group$/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Denied"));
  });

  it("falls back to a generic message when a grant fails without details", async () => {
    install({ "PUT /groups/g1/view": () => new Response("oops", { status: 502 }) });
    const actor = await open(RESTRICTED);
    await actor.click(within(screen.getByRole("columnheader", { name: "Group" }).closest("div.overflow-hidden") as HTMLElement).getByRole("button", { name: /^edit$/i }));
    await actor.click(screen.getByRole("button", { name: /add a group/i }));
    await actor.click(await screen.findByText("docs"));
    await actor.click(screen.getByRole("button", { name: /^add group$/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it("reports a failed block, refreshing when it was a View block", async () => {
    install({ "PUT /users/u1/view/block": () => fail("Cannot block") });
    const actor = await open(TOP);
    await actor.click(
      within(screen.getByRole("columnheader", { name: "User" }).closest("div.overflow-hidden") as HTMLElement).getByRole("button", { name: /^edit$/i }),
    );
    await actor.click(await screen.findByRole("checkbox", { name: /ann lee: can view/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Cannot block"));

    install();
    await actor.click(screen.getByRole("checkbox", { name: /ann lee: can view/i }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("reports a failed mode switch", async () => {
    install({ "PATCH /restrictions/mode": () => fail("Mode failed") });
    const actor = await open(TOP);
    await chooseMode(actor, /^open$/i, /^restricted$/i);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Mode failed"));
  });

  it("reports a failed reset", async () => {
    install({ "POST /restrictions/reset": () => fail("Reset failed") });
    const actor = await open(TOP);
    await actor.click(screen.getByRole("button", { name: /reset to default/i }));
    const dialog = await screen.findByRole("alertdialog");
    await actor.click(within(dialog).getByRole("button", { name: /^reset$/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Reset failed"));
  });
});
