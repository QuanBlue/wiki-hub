import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { PageComments } from "@/components/comments/page-comments";
import { api } from "@/lib/api-client";
import type { CommentLikeStatus, Page, PageComment } from "@/types/api";

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

const BASE = "/api/v1/spaces/ENG/pages/runbook/comments";
const me = { id: "u1", username: "alice", full_name: "Alice Nguyen", avatar_url: null };

function comment(overrides: Partial<PageComment> = {}): PageComment {
  return {
    id: "c1",
    parent_id: null,
    body: "First comment",
    author: { id: "u2", username: "bob", full_name: "Bob Tran", avatar_url: null },
    created_at: "2026-10-07T08:00:00Z",
    edited_at: null,
    like_count: 0,
    liked_by_me: false,
    mentions: [],
    can_edit: false,
    can_delete: false,
    ...overrides,
  };
}

function listing(items: PageComment[]): Page<PageComment> {
  return { items, total: items.length, limit: items.length, offset: 0 };
}

function load(items: PageComment[]) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === BASE) return listing(items);
    return [];
  });
}

/** Edit and Delete live in the comment's "..." menu. */
async function openMenu(item: HTMLElement) {
  await userEvent.click(within(item).getByRole("button", { name: "More actions" }));
}

function renderComments() {
  return render(<PageComments spaceKey="ENG" pageSlug="runbook" currentUser={me} />);
}

beforeEach(() => {
  for (const method of ["get", "post", "patch", "put", "delete"] as const) {
    vi.mocked(api[method]).mockReset();
  }
  vi.mocked(toast.error).mockReset();
});

describe("PageComments", () => {
  it("shows an empty state, then posts a top-level comment", async () => {
    load([]);
    vi.mocked(api.post).mockResolvedValue(comment({ id: "new", body: "Hello team" }));
    renderComments();

    expect(await screen.findByText(/No comments yet/)).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText("Write a comment…"), "Hello team");
    await userEvent.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(BASE, { body: "Hello team", parent_id: null }),
    );
    expect(await screen.findByText("Hello team")).toBeInTheDocument();
  });

  it("keeps replies collapsed until asked, then shows the tree", async () => {
    load([
      comment({ id: "c1", body: "Root" }),
      comment({ id: "c2", parent_id: "c1", body: "Child" }),
      comment({ id: "c3", parent_id: "c2", body: "Grandchild" }),
    ]);
    renderComments();

    expect(await screen.findByText("Root")).toBeInTheDocument();
    expect(screen.queryByText("Child")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /View 2 replies/ }));
    expect(screen.getByText("Child")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /View 1 reply/ }));
    expect(screen.getByText("Grandchild")).toBeInTheDocument();

    // The outermost fold button comes last in document order.
    await userEvent.click(screen.getAllByRole("button", { name: "Hide replies" }).at(-1)!);
    expect(screen.queryByText("Child")).not.toBeInTheDocument();
  });

  it("replies to a comment and reveals the new reply", async () => {
    load([comment({ id: "c1", body: "Root" })]);
    vi.mocked(api.post).mockResolvedValue(
      comment({ id: "c2", parent_id: "c1", body: "@bob thanks", author: { ...me } }),
    );
    renderComments();

    await screen.findByText("Root");
    await userEvent.click(screen.getByRole("button", { name: "Reply" }));
    const box = screen.getByPlaceholderText("Write a reply…");
    expect(box).toHaveValue("@bob ");
    await userEvent.type(box, "thanks");
    // The composer's own submit button is the second "Reply" on screen.
    const submit = screen.getAllByRole("button", { name: "Reply" }).at(-1)!;
    await userEvent.click(submit);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(BASE, { body: "@bob thanks", parent_id: "c1" }),
    );
    expect(await screen.findByText(/thanks/)).toBeInTheDocument();
  });

  it("likes and unlikes using the server's count", async () => {
    load([comment({ id: "c1" })]);
    vi.mocked(api.put).mockResolvedValue({ liked_by_me: true, like_count: 3 } as CommentLikeStatus);
    vi.mocked(api.delete).mockResolvedValue({
      liked_by_me: false,
      like_count: 2,
    } as CommentLikeStatus);
    renderComments();

    await userEvent.click(await screen.findByRole("button", { name: "Like" }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(`${BASE}/c1/like`));
    expect(await screen.findByRole("button", { name: "Unlike" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("3")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Unlike" }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(`${BASE}/c1/like`));
    expect(await screen.findByText("2")).toBeInTheDocument();
  });

  it("only offers edit and delete where the server allows them", async () => {
    load([
      comment({ id: "c1", body: "Mine", can_edit: true, can_delete: true }),
      comment({ id: "c2", body: "Theirs" }),
    ]);
    renderComments();

    const mine = (await screen.findByText("Mine")).closest("li")!;
    await openMenu(mine);
    expect(await screen.findByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
    // Somebody else's comment has no menu at all.
    const theirs = screen.getByText("Theirs").closest("li")!;
    expect(within(theirs).queryByRole("button", { name: "More actions" })).not.toBeInTheDocument();
  });

  it("confirms before deleting and removes the whole branch", async () => {
    load([
      comment({ id: "c1", body: "Root", can_delete: true }),
      comment({ id: "c2", parent_id: "c1", body: "Child" }),
      comment({ id: "c3", body: "Other" }),
    ]);
    vi.mocked(api.delete).mockResolvedValue(undefined);
    renderComments();

    const root = (await screen.findByText("Root")).closest("li")!;
    await openMenu(root);
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/all of its replies/)).toBeInTheDocument();
    expect(api.delete).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(`${BASE}/c1`));
    await waitFor(() => expect(screen.queryByText("Root")).not.toBeInTheDocument());
    expect(screen.getByText("Other")).toBeInTheDocument();
  });

  it("edits a comment in place", async () => {
    load([comment({ id: "c1", body: "Old text", can_edit: true })]);
    vi.mocked(api.patch).mockResolvedValue(
      comment({ id: "c1", body: "New text", can_edit: true, edited_at: "2026-10-07T09:00:00Z" }),
    );
    renderComments();

    const item = (await screen.findByText("Old text")).closest("li")!;
    await openMenu(item);
    await userEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
    const box = screen.getByDisplayValue("Old text");
    await userEvent.clear(box);
    await userEvent.type(box, "New text");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(`${BASE}/c1`, { body: "New text" }),
    );
    expect(await screen.findByText("New text")).toBeInTheDocument();
    expect(screen.getByText(/edited/)).toBeInTheDocument();
  });

  it("explains a failed post and keeps what was typed", async () => {
    load([]);
    vi.mocked(api.post).mockRejectedValue(new Error("boom"));
    renderComments();

    const box = await screen.findByPlaceholderText("Write a comment…");
    await userEvent.type(box, "Will fail");
    await userEvent.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(box).toHaveValue("Will fail");
  });

  it("highlights a mention that names a known person", async () => {
    load([comment({ id: "c1", body: "cc @carol and @nobody", mentions: ["carol"] })]);
    renderComments();

    const mention = await screen.findByText("@carol");
    expect(mention).toHaveClass("text-primary");
  });

  it("opens and scrolls to a reply linked after the page is already open", async () => {
    const root = "00000000-0000-4000-8000-000000000001";
    const reply = "00000000-0000-4000-8000-000000000002";
    load([
      comment({ id: root, body: "Root" }),
      comment({ id: reply, parent_id: root, body: "Hey @alice", mentions: ["alice"] }),
    ]);
    renderComments();
    await screen.findByText("Root");
    expect(screen.queryByText(/Hey/)).not.toBeInTheDocument();
    const scroll = vi.mocked(window.Element.prototype.scrollIntoView);
    scroll.mockClear();

    // What the notification bell does for a link to the open page.
    window.history.pushState(null, "", `#comment-${reply}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(await screen.findByText(/Hey/)).toBeInTheDocument();
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(scroll.mock.contexts.at(-1)).toHaveAttribute("id", `comment-${reply}`);
    window.history.pushState(null, "", window.location.pathname);
  });

  it("lists people without access to the page as disabled mentions", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === BASE) return listing([]);
      return [
        { username: "carol", full_name: "Carol Le", avatar_url: null, can_view: true },
        { username: "dave", full_name: "Dave Pham", avatar_url: null, can_view: false },
      ];
    });
    renderComments();

    const box = await screen.findByPlaceholderText("Write a comment…");
    await userEvent.type(box, "hi @");
    const dave = (await screen.findByText("Dave Pham")).closest("button")!;
    expect(dave).toHaveAttribute("aria-disabled", "true");
    expect(dave).toHaveTextContent("No access to this page");
    await userEvent.click(dave);
    expect(box).toHaveValue("hi @");

    // The arrow keys skip Dave, so Enter still takes Carol.
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(box).toHaveValue("hi @carol ");
  });

  it("says so when the comments cannot be loaded", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("nope"));
    renderComments();

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the comments.");
  });
});
