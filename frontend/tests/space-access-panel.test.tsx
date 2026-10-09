import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SpaceAccessPanel } from "@/components/admin/space-access-panel";
import { MailSummaryProvider } from "@/components/layout/mail-summary-provider";
import { ApiError, api } from "@/lib/api-client";
import type { Group, MailSummary, Space, SpacePermissionAssignment, User } from "@/types/api";

const { refresh, push, toastSuccess, toastError } = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }) }));
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

const SPACE = { id: "s1", key: "ENG", name: "Engineering", visibility: "open" } as Space;
const GROUPS = [
  { id: "g1", name: "Docs" },
  { id: "g2", name: "Ops" },
] as Group[];
const USERS = [
  { id: "u1", username: "ann", full_name: "Ann Lee", email: "ann@example.test" },
  { id: "u2", username: "bob", full_name: "", email: "bob@example.test" },
] as User[];

function grant(
  principal_type: "user" | "group",
  principal_id: string,
  permission: SpacePermissionAssignment["permissions"][number],
): SpacePermissionAssignment {
  return {
    space_id: "s1",
    principal_id,
    principal_type,
    principal_name: principal_id,
    permissions: [permission],
  };
}

const ASSIGNMENTS = [
  grant("group", "g1", "view"),
  grant("group", "g1", "add"),
  grant("user", "u1", "view"),
];

function renderPanel({
  users = USERS,
  groups = GROUPS,
  summary = MAILBOX,
  assignments = ASSIGNMENTS,
}: {
  users?: User[];
  groups?: Group[];
  summary?: MailSummary;
  assignments?: SpacePermissionAssignment[];
} = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MailSummaryProvider initial={summary} poll={false}>
        <SpaceAccessPanel
          space={SPACE}
          groups={groups}
          users={users}
          initialAssignments={assignments}
        />
      </MailSummaryProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

function section(title: string) {
  return screen.getByRole("heading", { name: title }).closest(".rounded-xl") as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.get.mockImplementation(async (path: string) =>
    path.includes("/effective/")
      ? { space_id: "s1", permissions: ["view", "export"], visibility: "open" }
      : MAILBOX,
  );
  mocked.patch.mockResolvedValue({});
  mocked.put.mockResolvedValue(undefined);
  mocked.delete.mockResolvedValue(undefined);
  mocked.post.mockResolvedValue({ email_sent: true, email_error: null });
});

describe("SpaceAccessPanel general access", () => {
  it("switches the space between Open and Restricted", async () => {
    const actor = renderPanel();

    await actor.click(screen.getByRole("button", { name: "Space visibility" }));
    await actor.click(screen.getByRole("menuitemradio", { name: "Restricted" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Space visibility updated."));
    expect(mocked.patch).toHaveBeenCalledWith("/api/v1/spaces/ENG", { visibility: "restricted" });
    expect(screen.getByRole("button", { name: "Space visibility" })).toHaveTextContent(
      "Restricted",
    );
  });

  it("keeps the old visibility when the change is refused", async () => {
    const actor = renderPanel();

    mocked.patch.mockRejectedValueOnce(new ApiError(403, "forbidden", "Not yours."));
    await actor.click(screen.getByRole("button", { name: "Space visibility" }));
    await actor.click(screen.getByRole("menuitemradio", { name: "Restricted" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Not yours."));

    mocked.patch.mockRejectedValueOnce(new Error("offline"));
    await actor.click(screen.getByRole("button", { name: "Space visibility" }));
    await actor.click(screen.getByRole("menuitemradio", { name: "Restricted" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Could not update visibility."),
    );
    expect(screen.getByRole("button", { name: "Space visibility" })).toHaveTextContent("Open");
  });
});

describe("SpaceAccessPanel effective permissions", () => {
  it("shows what the first user can do, and another user on request", async () => {
    const actor = renderPanel();

    expect(await screen.findByText("view")).toBeInTheDocument();
    expect(screen.getByText("export")).toBeInTheDocument();
    expect(mocked.get).toHaveBeenCalledWith("/api/v1/spaces/ENG/permissions/effective/u1");

    mocked.get.mockResolvedValueOnce({ space_id: "s1", permissions: [], visibility: "open" });
    await actor.click(screen.getByRole("button", { name: "Inspect effective permissions for user" }));
    await actor.click(screen.getByRole("menuitemradio", { name: "bob (@bob)" }));

    expect(await screen.findByText("No effective permissions.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inspect effective permissions for user" })).toHaveTextContent("bob");
  });

  it("reports a failed lookup", async () => {
    mocked.get.mockRejectedValueOnce(new ApiError(404, "nope", "No such user."));
    const actor = renderPanel();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("No such user."));

    mocked.get.mockRejectedValueOnce(new Error("offline"));
    await actor.click(screen.getByRole("button", { name: "Inspect effective permissions for user" }));
    await actor.click(screen.getByRole("menuitemradio", { name: "bob (@bob)" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Could not load effective permissions."),
    );
  });

  it("asks nothing when the space has no users to inspect", () => {
    renderPanel({ users: [] });

    expect(screen.getByRole("button", { name: "Inspect effective permissions for user" })).toHaveTextContent("Choose a user");
    expect(mocked.get).not.toHaveBeenCalledWith(expect.stringContaining("/effective/"));
  });
});

describe("SpaceAccessPanel group permissions", () => {
  it("is read-only until Edit, with View always locked", () => {
    renderPanel();

    expect(screen.getByLabelText("Docs: Add/Edit")).toBeChecked();
    expect(screen.getByLabelText("Docs: Add/Edit")).toBeDisabled();
    expect(screen.queryByLabelText("Remove Docs from this space")).toBeNull();
  });

  it("adds a group, grants and revokes permissions, and saves", async () => {
    const actor = renderPanel();
    const groups = section("Groups");
    await actor.click(within(groups).getByRole("button", { name: /Edit/ }));

    expect(screen.getByLabelText("Docs: View")).toBeDisabled();
    await actor.click(screen.getByRole("button", { name: "Add a group" }));
    await actor.click(screen.getByRole("button", { name: "Ops" }));
    await actor.click(screen.getByRole("button", { name: /Add group/ }));
    expect(screen.getByLabelText("Ops: View")).toBeChecked();
    await actor.click(screen.getByLabelText("Ops: Move"));
    await actor.click(screen.getByLabelText("Docs: Add/Edit"));
    await actor.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Group permissions updated."));
    expect(mocked.delete).toHaveBeenCalledWith("/api/v1/spaces/ENG/permissions/groups/g1/add");
    expect(mocked.put).toHaveBeenCalledWith("/api/v1/spaces/ENG/permissions/groups/g2/move");
    expect(mocked.put).toHaveBeenCalledWith("/api/v1/spaces/ENG/permissions/groups/g2/view");
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByLabelText("Ops: Move")).toBeChecked();
    expect(screen.getByLabelText("Ops: Move")).toBeDisabled();
  });

  it("removes a group outright, siblings before View", async () => {
    const actor = renderPanel();
    await actor.click(within(section("Groups")).getByRole("button", { name: /Edit/ }));

    await actor.click(screen.getByLabelText("Remove Docs from this space"));
    await actor.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocked.delete).toHaveBeenCalledTimes(2));
    expect(mocked.delete.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/spaces/ENG/permissions/groups/g1/add",
      "/api/v1/spaces/ENG/permissions/groups/g1/view",
    ]);
  });

  it("reports a failed save and stays in edit mode", async () => {
    const actor = renderPanel();
    await actor.click(within(section("Groups")).getByRole("button", { name: /Edit/ }));
    await actor.click(screen.getByLabelText("Docs: Delete"));

    mocked.put.mockRejectedValueOnce(new ApiError(400, "bad", "Refused."));
    await actor.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Refused."));

    mocked.put.mockRejectedValueOnce(new Error("offline"));
    await actor.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Could not save group permissions."),
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("leaves edit mode straight away when nothing changed", async () => {
    const actor = renderPanel();
    await actor.click(within(section("Groups")).getByRole("button", { name: /Edit/ }));

    await actor.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(within(section("Groups")).getByRole("button", { name: /Edit/ })).toBeInTheDocument();
  });

  it("asks before dropping changes: keep editing, discard, or save", async () => {
    const actor = renderPanel();
    await actor.click(within(section("Groups")).getByRole("button", { name: /Edit/ }));
    await actor.click(screen.getByLabelText("Docs: Delete"));

    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    await actor.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByLabelText("Docs: Delete")).toBeChecked();

    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    await actor.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByLabelText("Docs: Delete")).not.toBeChecked();

    await actor.click(within(section("Groups")).getByRole("button", { name: /Edit/ }));
    await actor.click(screen.getByLabelText("Docs: Delete"));
    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    await actor.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Save" }),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Group permissions updated."));
  });
});

describe("SpaceAccessPanel user permissions", () => {
  async function editUsers(options?: Parameters<typeof renderPanel>[0]) {
    const actor = renderPanel(options);
    await actor.click(within(section("Individual users")).getByRole("button", { name: /Edit/ }));
    return actor;
  }

  it("adds a user, emails them, and saves", async () => {
    const actor = await editUsers();

    await actor.click(screen.getByRole("button", { name: "Add a user" }));
    await actor.click(screen.getByRole("button", { name: "bob (@bob)" }));
    await actor.click(screen.getByRole("button", { name: /Add user/ }));
    await actor.click(screen.getByLabelText("ann: Admin"));
    await actor.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("User permissions updated."));
    expect(mocked.put).toHaveBeenCalledWith("/api/v1/spaces/ENG/permissions/users/u1/admin");
    expect(mocked.put).toHaveBeenCalledWith("/api/v1/spaces/ENG/permissions/users/u2/view");
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        'Told bob@example.test they now have access to "Engineering".',
      ),
    );
    // A new permission on someone who already had View is not news to email.
    expect(mocked.post).toHaveBeenCalledTimes(1);
  });

  it("removes a user, emails them, and reports an email that failed", async () => {
    const actor = await editUsers();
    mocked.post.mockResolvedValueOnce({ email_sent: true, email_error: null });

    await actor.click(screen.getByLabelText("Remove ann from this space"));
    await actor.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        'Told ann@example.test their access to "Engineering" was removed.',
      ),
    );

    mocked.post.mockResolvedValueOnce({ email_sent: false, email_error: "down" });
    await actor.click(within(section("Individual users")).getByRole("button", { name: /Edit/ }));
    await actor.click(screen.getByLabelText("bob: Move"));
    await actor.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Could not email bob@example.test about this change."),
    );
  });

  it("emails nobody without a mailbox, and says so", async () => {
    const actor = await editUsers({ summary: { ...MAILBOX, can_send_account_mail: false } });

    expect(screen.getByText(/tell anyone added or removed here yourself/)).toBeInTheDocument();
    await actor.click(screen.getByLabelText("Remove ann from this space"));
    await actor.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("User permissions updated."));
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it("reports a failed save", async () => {
    const actor = await editUsers();
    await actor.click(screen.getByLabelText("ann: Delete"));

    mocked.put.mockRejectedValueOnce(new ApiError(400, "bad", "Refused."));
    await actor.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Refused."));

    mocked.put.mockRejectedValueOnce(new Error("offline"));
    await actor.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Could not save user permissions."),
    );
  });

  it("asks before dropping changes, and leaves straight away without any", async () => {
    const actor = await editUsers();
    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    expect(within(section("Individual users")).getByRole("button", { name: /Edit/ })).toBeInTheDocument();

    await actor.click(within(section("Individual users")).getByRole("button", { name: /Edit/ }));
    await actor.click(screen.getByLabelText("ann: Delete"));
    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    await actor.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    await actor.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByLabelText("ann: Delete")).not.toBeChecked();

    await actor.click(within(section("Individual users")).getByRole("button", { name: /Edit/ }));
    await actor.click(screen.getByLabelText("ann: Delete"));
    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    await actor.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("User permissions updated."));
  });
});

describe("SpaceAccessPanel leaving with unsaved changes", () => {
  function link(href: string, attributes: Record<string, string> = {}) {
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.textContent = "elsewhere";
    for (const [name, value] of Object.entries(attributes)) anchor.setAttribute(name, value);
    document.body.appendChild(anchor);
    return anchor;
  }

  async function dirty() {
    const actor = renderPanel();
    await actor.click(within(section("Groups")).getByRole("button", { name: /Edit/ }));
    await actor.click(screen.getByLabelText("Docs: Delete"));
    await actor.click(within(section("Individual users")).getByRole("button", { name: /Edit/ }));
    await actor.click(screen.getByLabelText("ann: Delete"));
    return actor;
  }

  it("warns on a tab close", async () => {
    await dirty();
    const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("lets ordinary clicks and links it should not catch through", async () => {
    await dirty();

    fireEvent.click(document.body);
    fireEvent.click(link("/other"), { ctrlKey: true });
    fireEvent.click(link("/other"), { button: 1 });
    fireEvent.click(link("/other", { target: "_blank" }));
    fireEvent.click(link("/other", { download: "" }));
    fireEvent.click(link(window.location.href));
    // A click something else already handled (window capture runs first).
    window.addEventListener("click", (event) => event.preventDefault(), { capture: true, once: true });
    fireEvent.click(link("/other"));

    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("stays, or leaves without saving", async () => {
    const actor = await dirty();

    fireEvent.click(link("/other?x=1#top"));
    await actor.click(await screen.findByRole("button", { name: "Stay" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    fireEvent.click(link("/other?x=1#top", { target: "_self" }));
    await actor.click(await screen.findByRole("button", { name: "Leave without saving" }));

    expect(push).toHaveBeenCalledWith("/other?x=1#top");
    expect(mocked.put).not.toHaveBeenCalled();
  });

  it("saves both sections and then leaves", async () => {
    const actor = await dirty();

    fireEvent.click(link("/next"));
    await actor.click(await screen.findByRole("button", { name: "Save and leave" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/next"));
    expect(mocked.put).toHaveBeenCalledWith("/api/v1/spaces/ENG/permissions/groups/g1/delete");
    expect(mocked.put).toHaveBeenCalledWith("/api/v1/spaces/ENG/permissions/users/u1/delete");
  });

  it("stays put when saving before leaving fails", async () => {
    const actor = await dirty();
    mocked.put.mockRejectedValueOnce(new ApiError(400, "bad", "Refused."));

    fireEvent.click(link("/next"));
    await actor.click(await screen.findByRole("button", { name: "Save and leave" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Refused."));

    mocked.put.mockRejectedValueOnce(new Error("offline"));
    await actor.click(screen.getByRole("button", { name: "Save and leave" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not save changes."));
    expect(push).not.toHaveBeenCalled();
  });

  it("leaves for another site with a full navigation", async () => {
    const actor = await dirty();
    const assign = vi.fn();
    const original = window.location;
    vi.stubGlobal("location", { ...original, href: original.href, origin: original.origin, assign });
    try {
      fireEvent.click(link("https://elsewhere.example/page"));
      await actor.click(await screen.findByRole("button", { name: "Leave without saving" }));
      expect(assign).toHaveBeenCalledWith("https://elsewhere.example/page");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
