import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssuesList } from "@/components/admin/issues-list";
import { ReportIssueDialog } from "@/components/issues/report-issue-dialog";
import { toast } from "sonner";

import { api } from "@/lib/api-client";
import type { Issue, IssueCounts, Page } from "@/types/api";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

beforeEach(() => {
  // jsdom has no blob URLs; the dialog previews picked images with them.
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.patch).mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    title: "Page will not save",
    description: "I click save and nothing happens.",
    status: "open",
    page_url: "/spaces/ENG",
    labels: [],
    reporter: { id: "u1", username: "alice", full_name: "Alice Nguyen" },
    assignee: null,
    attachments: [],
    notes: [],
    created_at: "2026-10-02T08:00:00Z",
    updated_at: "2026-10-02T08:00:00Z",
    resolved_at: null,
    can_claim: true,
    can_set_status: false,
    ...overrides,
  };
}

function listing(items: Issue[]): Page<Issue> {
  return { items, total: items.length, limit: 20, offset: 0 };
}

const COUNTS: IssueCounts = { open: 1, in_progress: 0, done: 0 };
const PEOPLE = [
  { id: "u1", username: "alice", full_name: "Alice Nguyen" },
  { id: "u2", username: "bob", full_name: "Bob Tran" },
];

function mockApi(items: Issue[]) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path.startsWith("/api/v1/issues/counts")) return COUNTS;
    if (path.startsWith("/api/v1/issues/people")) return PEOPLE;
    if (path.startsWith("/api/v1/issues/assignees")) return PEOPLE;
    return listing(items);
  });
}

describe("ReportIssueDialog", () => {
  it("cannot be sent without a title", () => {
    render(<ReportIssueDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: /^Create/u })).toBeDisabled();
  });

  it("creates the issue, then uploads a pasted screenshot to it", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    vi.mocked(api.post).mockResolvedValueOnce(issue({ id: "new-issue" }));
    vi.mocked(api.post).mockResolvedValueOnce({});
    render(<ReportIssueDialog open onOpenChange={onOpenChange} />);

    await user.type(screen.getByLabelText(/^Add a title/u), "Cannot save");
    await user.type(
      screen.getByLabelText("Add a description"),
      "Nothing happens.",
    );
    await user.click(screen.getByRole("button", { name: /^Labels/u }));
    await user.click(
      within(
        await screen.findByRole("listbox", { name: "Apply labels" }),
      ).getByRole("option", { name: /^bug/u }),
    );
    await user.keyboard("{Escape}");
    const shot = new File(["png-bytes"], "shot.png", { type: "image/png" });
    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      shot,
    );
    await user.click(screen.getByRole("button", { name: /^Create/u }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.post).toHaveBeenNthCalledWith(
      1,
      "/api/v1/issues",
      expect.objectContaining({
        title: "Cannot save",
        description: "Nothing happens.",
        labels: ["bug"],
      }),
    );
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      "/api/v1/issues/new-issue/attachments",
      undefined,
      expect.objectContaining({ rawBody: expect.any(FormData) }),
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it("closes straight away when nothing has been typed", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<ReportIssueDialog open onOpenChange={onOpenChange} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks before throwing away what was typed, and Keep editing stays put", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<ReportIssueDialog open onOpenChange={onOpenChange} />);

    await user.type(screen.getByLabelText(/^Add a title/u), "Half written");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    const prompt = await screen.findByRole("alertdialog");
    expect(within(prompt).getByText("Discard this issue?")).toBeInTheDocument();
    await user.click(
      within(prompt).getByRole("button", { name: "Keep editing" }),
    );

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Add a title/u)).toHaveValue("Half written");
  });

  it("Discard closes and forgets; Save draft closes and brings it back next time", async () => {
    const user = userEvent.setup();
    window.localStorage.removeItem("wikihub:issue-draft");
    const onOpenChange = vi.fn();
    const { unmount } = render(
      <ReportIssueDialog open onOpenChange={onOpenChange} />,
    );

    await user.type(screen.getByLabelText(/^Add a title/u), "Keep me");
    await user.type(screen.getByLabelText("Add a description"), "some detail");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Save draft",
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(window.localStorage.getItem("wikihub:issue-draft")).toContain(
      "Keep me",
    );
    unmount();

    // Reopened: the draft is back.
    const second = vi.fn();
    render(<ReportIssueDialog open onOpenChange={second} />);
    expect(await screen.findByDisplayValue("Keep me")).toBeInTheDocument();
    expect(screen.getByDisplayValue("some detail")).toBeInTheDocument();

    // Untouched, the saved draft is not "unsaved work": closing keeps it quietly.
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(second).toHaveBeenCalledWith(false);
    expect(window.localStorage.getItem("wikihub:issue-draft")).toContain(
      "Keep me",
    );

    // Edited since, closing asks again, and Discard forgets it for good.
    second.mockClear();
    await user.type(screen.getByLabelText(/^Add a title/u), " more");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Discard",
      }),
    );
    expect(second).toHaveBeenCalledWith(false);
    expect(window.localStorage.getItem("wikihub:issue-draft")).toBeNull();
  });

  it("clears a saved draft once the issue is sent", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "wikihub:issue-draft",
      JSON.stringify({ title: "Old draft", description: "" }),
    );
    vi.mocked(api.post).mockResolvedValue(issue({ id: "sent" }));
    render(<ReportIssueDialog open onOpenChange={vi.fn()} />);

    expect(await screen.findByDisplayValue("Old draft")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Create/u }));

    await waitFor(() =>
      expect(window.localStorage.getItem("wikihub:issue-draft")).toBeNull(),
    );
  });

  it("rejects a file that is not a supported image", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<ReportIssueDialog open onOpenChange={vi.fn()} />);

    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }),
    );

    expect(toast.error).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Remove image" })).toBeNull();
  });
});

describe("IssuesList", () => {
  it("lets a triager take an unclaimed issue", async () => {
    const user = userEvent.setup();
    mockApi([issue()]);
    vi.mocked(api.post).mockResolvedValue(
      issue({
        status: "in_progress",
        assignee: { id: "u2", username: "bob", full_name: "Bob" },
        can_claim: false,
        can_set_status: true,
      }),
    );
    render(<IssuesList />);

    await user.click(
      await screen.findByRole("button", { name: /Page will not save/u }),
    );
    const dialog = await screen.findByRole("dialog");
    // Not the assignee, so no way to close it yet.
    expect(
      within(dialog).queryByRole("button", { name: "Mark done" }),
    ).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Take it" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/v1/issues/issue-1/claim"),
    );
    expect(
      await within(dialog).findByRole("button", { name: "Mark done" }),
    ).toBeInTheDocument();
  });

  it("offers Mark done only when the server says the status can be changed", async () => {
    const user = userEvent.setup();
    mockApi([
      issue({
        status: "in_progress",
        assignee: { id: "u2", username: "bob", full_name: "Bob" },
        can_claim: false,
        can_set_status: false,
      }),
    ]);
    render(<IssuesList />);

    await user.click(
      await screen.findByRole("button", { name: /Page will not save/u }),
    );
    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).queryByRole("button", { name: "Mark done" }),
    ).toBeNull();
    expect(
      within(dialog).queryByRole("button", { name: "Take it" }),
    ).toBeNull();
    expect(
      within(dialog).getByText(/Only the person who took this issue/u),
    ).toBeInTheDocument();
  });

  it("marks an issue done through the status endpoint", async () => {
    const user = userEvent.setup();
    mockApi([
      issue({
        status: "in_progress",
        assignee: { id: "u2", username: "bob", full_name: "Bob" },
        can_claim: false,
        can_set_status: true,
      }),
    ]);
    vi.mocked(api.patch).mockResolvedValue(
      issue({ status: "done", can_claim: false, can_set_status: true }),
    );
    render(<IssuesList />);

    await user.click(
      await screen.findByRole("button", { name: /Page will not save/u }),
    );
    const dialog = await screen.findByRole("dialog");
    // The closing note is not there until "Mark done" is pressed.
    expect(within(dialog).queryByLabelText("Closing note")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Mark done" }));
    await user.click(
      within(dialog).getByRole("button", { name: "Confirm and close" }),
    );

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/api/v1/issues/issue-1/status", {
        status: "done",
        note: null,
      }),
    );
  });

  it("starts on the Open tab with an empty search box, and shows the counts", async () => {
    mockApi([issue()]);
    render(<IssuesList />);

    await screen.findByRole("button", { name: /Page will not save/u });
    expect(
      screen.getByRole("searchbox", { name: "Search issues" }),
    ).toHaveValue("");
    expect(screen.getByRole("button", { name: /^Open/u })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/v1\/issues\?.*state=open/u),
    );
    // Counts are asked for without the tab, so the numbers do not shift when one is picked.
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      expect.not.stringMatching(/counts\?.*state=/u),
    );
  });

  it("searches on Enter, sending only the words", async () => {
    const user = userEvent.setup();
    mockApi([issue()]);
    render(<IssuesList />);
    await screen.findByRole("button", { name: /Page will not save/u });

    await user.type(
      screen.getByRole("searchbox", { name: "Search issues" }),
      "save{Enter}",
    );

    await waitFor(() => {
      const urls = vi.mocked(api.get).mock.calls.map(([path]) => String(path));
      expect(
        urls.some(
          (url) => url.includes("q=save") && url.includes("state=open"),
        ),
      ).toBe(true);
    });
  });

  it("marks the part of the title and description that matched", async () => {
    const user = userEvent.setup();
    mockApi([
      issue({
        title: "Page will not save",
        description: "I click the save button and nothing happens at all.",
      }),
    ]);
    render(<IssuesList />);
    await screen.findByRole("button", { name: /Page will not save/u });

    await user.type(
      screen.getByRole("searchbox", { name: "Search issues" }),
      "SAVE{Enter}",
    );

    await waitFor(() => {
      const marked = Array.from(document.querySelectorAll("mark")).map(
        (m) => m.textContent,
      );
      // Once in the title, once in the description excerpt - in the case it was written.
      expect(marked).toEqual(["save", "save"]);
    });
  });

  it("does not treat special characters in the search as a pattern", async () => {
    const user = userEvent.setup();
    mockApi([issue({ title: "Cost is 5.00 (approx)" })]);
    render(<IssuesList />);
    await screen.findByRole("button", { name: /Cost is/u });

    await user.type(
      screen.getByRole("searchbox", { name: "Search issues" }),
      "5.00 (approx{Enter}",
    );

    await waitFor(() => {
      expect(
        Array.from(document.querySelectorAll("mark")).map((m) => m.textContent),
      ).toEqual(["5.00", "(approx"]);
    });
  });

  it("switches to Closed with the tab and says so when nothing matches", async () => {
    const user = userEvent.setup();
    mockApi([]);
    render(<IssuesList />);

    expect(
      await screen.findByText("No results matched your search"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Closed/u }));

    expect(screen.getByRole("button", { name: /^Closed/u })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() => {
      const urls = vi.mocked(api.get).mock.calls.map(([path]) => String(path));
      expect(urls.some((url) => url.includes("state=closed"))).toBe(true);
    });
  });

  it("switches between Issues, Assigned to me and Created by me, keeping the tab", async () => {
    const user = userEvent.setup();
    mockApi([issue()]);
    render(<IssuesList />);
    await screen.findByRole("button", { name: /Page will not save/u });

    const nav = within(screen.getByRole("navigation", { name: "Issue views" }));
    expect(nav.getByRole("button", { name: "Issues" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await user.click(nav.getByRole("button", { name: "Assigned to me" }));
    expect(nav.getByRole("button", { name: "Assigned to me" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await waitFor(() => {
      const urls = vi.mocked(api.get).mock.calls.map(([path]) => String(path));
      expect(
        urls.some(
          (url) => url.includes("assignee=%40me") && url.includes("state=open"),
        ),
      ).toBe(true);
    });

    // The card's heading and description follow the view.
    expect(
      screen.getByRole("heading", { name: "Assigned to me" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Issues you have taken on/u)).toBeInTheDocument();

    await user.click(nav.getByRole("button", { name: "Created by me" }));
    expect(
      screen.getByRole("heading", { name: "Created by me" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Issues you have reported yourself."),
    ).toBeInTheDocument();
    await waitFor(() => {
      const urls = vi.mocked(api.get).mock.calls.map(([path]) => String(path));
      expect(
        urls.some(
          (url) => url.includes("author=%40me") && !url.includes("assignee"),
        ),
      ).toBe(true);
    });
  });

  it("opens the report dialog from New issue", async () => {
    const user = userEvent.setup();
    mockApi([]);
    render(<IssuesList />);

    await user.click(await screen.findByRole("button", { name: /New issue/u }));

    expect(
      await screen.findByRole("dialog", { name: "Create new issue" }),
    ).toBeInTheDocument();
  });

  it("filters by author from a searchable list of people", async () => {
    const user = userEvent.setup();
    mockApi([issue()]);
    render(<IssuesList />);
    await screen.findByRole("button", { name: /Page will not save/u });

    await user.click(screen.getByRole("button", { name: /^Author/u }));
    await user.type(
      await screen.findByRole("combobox", { name: "Filter by author" }),
      "bo",
    );
    expect(screen.queryByRole("option", { name: /alice/u })).toBeNull();
    // The username leads, the full name follows it.
    await user.click(screen.getByRole("option", { name: /bob.*Bob Tran/u }));

    await waitFor(() => {
      const urls = vi.mocked(api.get).mock.calls.map(([path]) => String(path));
      expect(urls.some((url) => url.includes("author=bob"))).toBe(true);
    });
  });

  it("filters by several labels at once, and by no label", async () => {
    const user = userEvent.setup();
    mockApi([issue({ labels: ["bug"] })]);
    render(<IssuesList />);
    await screen.findByRole("button", { name: /Page will not save/u });
    // The row carries its label.
    expect(screen.getAllByText("bug").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /^Labels/u }));
    const list = await screen.findByRole("listbox", { name: "Filter by label" });
    await user.click(within(list).getByRole("option", { name: /^bug/u }));
    await user.click(within(list).getByRole("option", { name: /^question/u }));

    await waitFor(() => {
      const urls = vi.mocked(api.get).mock.calls.map(([path]) => String(path));
      expect(
        urls.some(
          (url) => url.includes("label=bug") && url.includes("label=question"),
        ),
      ).toBe(true);
    });

    await user.click(within(list).getByRole("option", { name: /^No labels/u }));
    await waitFor(() => {
      const urls = vi.mocked(api.get).mock.calls.map(([path]) => String(path));
      const last = urls.filter((url) => url.includes("state=open")).at(-1)!;
      expect(last).toContain("label=none");
      expect(last).not.toContain("label=bug");
    });
  });

  it("picking the person already chosen clears the filter, and Enter picks the highlighted row", async () => {
    const user = userEvent.setup();
    mockApi([issue()]);
    render(<IssuesList />);
    await screen.findByRole("button", { name: /Page will not save/u });

    await user.click(screen.getByRole("button", { name: /^Assignee/u }));
    // Rows: Assigned to me, Assigned to nobody, alice, bob. Arrow twice, then Enter -> alice.
    const box = await screen.findByRole("combobox", {
      name: "Filter by assignee",
    });
    await user.type(box, "{ArrowDown}{ArrowDown}{Enter}");
    await waitFor(() => {
      const urls = vi.mocked(api.get).mock.calls.map(([path]) => String(path));
      expect(urls.some((url) => url.includes("assignee=alice"))).toBe(true);
    });

    await user.click(screen.getByRole("button", { name: /^Assignee/u }));
    await user.click(await screen.findByRole("option", { name: /alice/u }));
    await waitFor(() => {
      const calls = vi.mocked(api.get).mock.calls.map(([path]) => String(path));
      expect(calls[calls.length - 1]).not.toContain("assignee=");
    });
  });

  it("ticks issues, marks them all completed in one request, and says what was skipped", async () => {
    const user = userEvent.setup();
    const first = issue({ id: "i1", title: "First problem" });
    const second = issue({ id: "i2", title: "Second problem" });
    mockApi([first, second]);
    vi.mocked(api.post).mockResolvedValue({
      updated: 1,
      failed: [{ id: "i2", reason: "permission_denied" }],
      emailed: 1,
    });
    render(<IssuesList />);
    await screen.findByRole("button", { name: /First problem/u });

    await user.click(
      screen.getByRole("checkbox", { name: "Select all issues on this page" }),
    );
    expect(screen.getByText("2 of 2 selected")).toBeInTheDocument();
    // The state tabs give way to the bulk actions.
    expect(screen.queryByRole("button", { name: /^Open/u })).toBeNull();

    await user.click(screen.getByRole("button", { name: /^Mark as/u }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Completed" }),
    );

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/v1/issues/bulk", {
        ids: ["i1", "i2"],
        action: "status",
        status: "done",
      }),
    );
    expect(toast.warning).toHaveBeenCalledWith(
      "1 updated, 1 skipped - you cannot change those.",
    );
    // The ticks are cleared afterwards.
    await waitFor(() => expect(screen.queryByText(/selected/u)).toBeNull());
  });

  it("assigns the ticked issues to someone, or to nobody", async () => {
    const user = userEvent.setup();
    mockApi([issue({ id: "i1", title: "First problem" })]);
    vi.mocked(api.post).mockResolvedValue({
      updated: 1,
      failed: [],
      emailed: 0,
    });
    render(<IssuesList />);
    await screen.findByRole("button", { name: /First problem/u });

    await user.click(
      screen.getByRole("checkbox", { name: "Select First problem" }),
    );
    await user.click(screen.getByRole("button", { name: "Assign" }));
    await user.click(
      await screen.findByRole("option", { name: /bob.*Bob Tran/u }),
    );
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/v1/issues/bulk", {
        ids: ["i1"],
        action: "assign",
        assignee_id: "u2",
      }),
    );

    await user.click(
      screen.getByRole("checkbox", { name: "Select First problem" }),
    );
    await user.click(screen.getByRole("button", { name: "Assign" }));
    await user.click(await screen.findByRole("option", { name: /Nobody/u }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/v1/issues/bulk", {
        ids: ["i1"],
        action: "unassign",
      }),
    );
  });

  it("shows notes, adds one, and sends the closing note when marking done", async () => {
    const user = userEvent.setup();
    const handling = issue({
      status: "in_progress",
      assignee: { id: "u2", username: "bob", full_name: "Bob" },
      can_claim: false,
      can_set_status: true,
      notes: [
        {
          id: "n1",
          author: { id: "u2", username: "bob", full_name: "Bob" },
          body: "Reproduced on staging.",
          public: false,
          created_at: "2026-10-02T09:00:00Z",
        },
        {
          id: "n2",
          author: null,
          body: "Fixed in 1.2.",
          public: true,
          created_at: "2026-10-02T10:00:00Z",
        },
      ],
    });
    mockApi([handling]);
    vi.mocked(api.post).mockResolvedValue(handling);
    vi.mocked(api.patch).mockResolvedValue({
      ...handling,
      status: "done",
      email: "sent",
    });
    render(<IssuesList />);

    await user.click(
      await screen.findByRole("button", { name: /Page will not save/u }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Reproduced on staging."),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Shared with reporter"),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Start work" }),
    ).toBeNull();

    await user.type(
      within(dialog).getByLabelText("Add a note"),
      "Checking the logs",
    );
    await user.click(within(dialog).getByRole("button", { name: "Add note" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/v1/issues/issue-1/notes", {
        body: "Checking the logs",
      }),
    );

    await user.click(within(dialog).getByRole("button", { name: "Mark done" }));
    await user.type(
      within(dialog).getByLabelText("Closing note"),
      "All good now",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Confirm and close" }),
    );
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/api/v1/issues/issue-1/status", {
        status: "done",
        note: "All good now",
      }),
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Issue closed. The reporter was told by notification and email.",
    );
  });

  it("explains what Take it does", async () => {
    const user = userEvent.setup();
    mockApi([issue()]);
    render(<IssuesList />);

    await user.click(
      await screen.findByRole("button", { name: /Page will not save/u }),
    );
    const dialog = await screen.findByRole("dialog");

    await user.hover(within(dialog).getByRole("button", { name: /Take it/u }));

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      /Puts your name on this issue/u,
    );
  });
});

describe("IssuesList more", () => {
  const bob = { id: "u2", username: "bob", full_name: "Bob" };

  it("searches as you type, and clears the search with the X", async () => {
    const user = userEvent.setup();
    mockApi([issue()]);
    render(<IssuesList />);
    await screen.findByRole("button", { name: /Page will not save/u });

    await user.type(screen.getByRole("searchbox"), "save");
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining("q=save")),
    );

    await user.click(screen.getByRole("button", { name: "Clear search" }));
    await waitFor(() => expect(screen.getByRole("searchbox")).toHaveValue(""));
    await waitFor(() =>
      expect(vi.mocked(api.get).mock.calls.at(-1)![0]).not.toContain("q=save"),
    );
  });

  it("reports a list that cannot be loaded", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.startsWith("/api/v1/issues/counts")) return COUNTS;
      if (path.startsWith("/api/v1/issues/people")) return PEOPLE;
      if (path.startsWith("/api/v1/issues/assignees")) return PEOPLE;
      throw new Error("down");
    });
    render(<IssuesList />);

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it("opens the issue a notification linked to, and ignores a link that no longer works", async () => {
    mockApi([]);
    const original = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (path: string) =>
      path === "/api/v1/issues/issue-7"
        ? issue({ id: "issue-7", title: "Linked problem" })
        : original(path),
    );
    const { unmount } = render(<IssuesList openId="issue-7" />);

    expect(await screen.findByRole("dialog", { name: "Linked problem" })).toBeInTheDocument();
    unmount();

    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/api/v1/issues/gone") throw new Error("404");
      return original(path);
    });
    render(<IssuesList openId="gone" />);
    await screen.findByText("No results matched your search");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("reports an action that failed and reads the list again", async () => {
    const user = userEvent.setup();
    mockApi([issue()]);
    vi.mocked(api.post).mockRejectedValue(new Error("someone else took it"));
    render(<IssuesList />);

    await user.click(await screen.findByRole("button", { name: /Page will not save/u }));
    const dialog = await screen.findByRole("dialog");
    const before = vi.mocked(api.get).mock.calls.length;
    await user.click(within(dialog).getByRole("button", { name: "Take it" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(before));
  });

  it("says when the closing email could not be sent", async () => {
    const user = userEvent.setup();
    const handling = issue({
      status: "in_progress",
      assignee: bob,
      can_claim: false,
      can_set_status: true,
    });
    mockApi([handling]);
    vi.mocked(api.patch).mockResolvedValue({ ...handling, status: "done", email: "failed" });
    render(<IssuesList />);

    await user.click(await screen.findByRole("button", { name: /Page will not save/u }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Mark done" }));
    await user.click(within(dialog).getByRole("button", { name: "Confirm and close" }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Issue closed and the reporter was notified, but the email could not be sent.",
      ),
    );
  });

  it("unticks everything when Select all is pressed again", async () => {
    const user = userEvent.setup();
    mockApi([issue({ id: "i1", title: "First problem" }), issue({ id: "i2", title: "Second problem" })]);
    render(<IssuesList />);
    await screen.findByRole("button", { name: /First problem/u });

    const all = screen.getByRole("checkbox", { name: "Select all issues on this page" });
    await user.click(all);
    expect(screen.getByText("2 of 2 selected")).toBeInTheDocument();
    await user.click(all);

    expect(screen.queryByText(/selected/u)).toBeNull();
  });

  it.each([
    ["Open", "open"],
    ["In progress", "in_progress"],
  ])("marks the ticked issues as %s", async (label, status) => {
    const user = userEvent.setup();
    mockApi([issue({ id: "i1", title: "First problem" })]);
    vi.mocked(api.post).mockResolvedValue({ updated: 1, failed: [], emailed: 0 });
    render(<IssuesList />);
    await screen.findByRole("button", { name: /First problem/u });

    await user.click(screen.getByRole("checkbox", { name: "Select First problem" }));
    await user.click(screen.getByRole("button", { name: /^Mark as/u }));
    await user.click(await screen.findByRole("menuitem", { name: label }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/v1/issues/bulk", {
        ids: ["i1"],
        action: "status",
        status,
      }),
    );
  });

  it("reports a bulk change that failed, and keeps the ticks", async () => {
    const user = userEvent.setup();
    mockApi([issue({ id: "i1", title: "First problem" })]);
    vi.mocked(api.post).mockRejectedValue(new Error("down"));
    render(<IssuesList />);
    await screen.findByRole("button", { name: /First problem/u });

    await user.click(screen.getByRole("checkbox", { name: "Select First problem" }));
    await user.click(screen.getByRole("button", { name: /^Mark as/u }));
    await user.click(await screen.findByRole("menuitem", { name: "Completed" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByText("1 of 1 selected")).toBeInTheDocument();
  });

  it("sorts, and changes the page size", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.startsWith("/api/v1/issues/counts")) return COUNTS;
      if (path.startsWith("/api/v1/issues/people")) return PEOPLE;
      if (path.startsWith("/api/v1/issues/assignees")) return PEOPLE;
      return { items: [issue()], total: 60, limit: 20, offset: 0 };
    });
    render(<IssuesList />);
    await screen.findByRole("button", { name: /Page will not save/u });

    await user.click(screen.getByRole("button", { name: /Newest/u }));
    await user.click(await screen.findByRole("menuitem", { name: "Oldest" }));
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining("sort=oldest")),
    );
    expect(screen.getByRole("button", { name: /Oldest/u })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rows per page" }));
    const options = await screen.findAllByRole("menuitemradio");
    await user.click(options[options.length - 1]!);
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining("limit=100")),
    );
  });

  it("refreshes the list after the report dialog is closed", async () => {
    const user = userEvent.setup();
    mockApi([issue()]);
    render(<IssuesList />);
    await screen.findByRole("button", { name: /Page will not save/u });

    await user.click(screen.getByRole("button", { name: "New issue" }));
    await screen.findByRole("dialog", { name: "Create new issue" });
    const before = vi.mocked(api.get).mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(before));
  });

  it("shows a closed issue with screenshots, labels and no description, then closes the details", async () => {
    const user = userEvent.setup();
    mockApi([
      issue({
        status: "done",
        description: "",
        page_url: "",
        labels: ["bug"],
        resolved_at: "2026-10-03T08:00:00Z",
        attachments: [
          { id: "a1", filename: "s.png", content_type: "image/png", size_bytes: 1 },
          { id: "a2", filename: "t.png", content_type: "image/png", size_bytes: 1 },
        ] as never,
      }),
    ]);
    render(<IssuesList />);

    const row = (await screen.findByRole("button", { name: /Page will not save/u })).closest("li")!;
    expect(within(row).getByTitle("2 screenshots")).toBeInTheDocument();
    expect(row.textContent).toMatch(/Closed/u);
    await user.click(within(row).getByRole("button", { name: /Page will not save/u }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("No description was given.")).toBeInTheDocument();
    expect(dialog.textContent).toMatch(/Closed/u);
    expect(within(dialog).queryByText("Opened from")).toBeNull();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("IssuesList last gaps", () => {
  it("reopens a closed issue", async () => {
    const user = userEvent.setup();
    const taken = issue({
      status: "done",
      assignee: { id: "u2", username: "bob", full_name: "Bob" },
      can_claim: false,
      can_set_status: true,
    });
    mockApi([taken]);
    vi.mocked(api.patch).mockResolvedValue({ ...taken, status: "in_progress" });
    render(<IssuesList />);

    await user.click(await screen.findByRole("button", { name: /Page will not save/u }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Reopen/u }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/api/v1/issues/issue-1/status", {
        status: "in_progress",
      }),
    );
  });

  it("picking the author already chosen clears the filter", async () => {
    const user = userEvent.setup();
    mockApi([issue()]);
    render(<IssuesList />);
    await screen.findByRole("button", { name: /Page will not save/u });

    await user.click(screen.getByRole("button", { name: /^Author/u }));
    await user.click(await screen.findByRole("option", { name: /alice/u }));
    await waitFor(() =>
      expect(vi.mocked(api.get).mock.calls.at(-1)![0]).toContain("author=alice"),
    );

    await user.click(screen.getByRole("button", { name: /^Author/u }));
    await user.click(await screen.findByRole("option", { name: /alice/u }));
    await waitFor(() =>
      expect(vi.mocked(api.get).mock.calls.at(-1)![0]).not.toContain("author="),
    );
  });

  it("lists a person once when their full name is just their username", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.startsWith("/api/v1/issues/counts")) return COUNTS;
      if (path.startsWith("/api/v1/issues/people"))
        return [{ id: "u9", username: "carol", full_name: "carol" }];
      if (path.startsWith("/api/v1/issues/assignees")) return [];
      return listing([issue()]);
    });
    render(<IssuesList />);
    await screen.findByRole("button", { name: /Page will not save/u });

    await user.click(screen.getByRole("button", { name: /^Author/u }));

    const option = await screen.findByRole("option", { name: /carol/u });
    expect(option.textContent).toBe("carol");
  });
});
