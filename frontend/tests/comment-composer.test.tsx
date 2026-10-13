import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommentComposer } from "@/components/comments/comment-composer";
import { api } from "@/lib/api-client";
import type { MentionCandidate } from "@/types/api";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mocked = vi.mocked(api);

const PEOPLE: MentionCandidate[] = [
  { username: "locked", full_name: "Locked Out", avatar_url: null, can_view: false },
  { username: "ann", full_name: "Ann Lee", avatar_url: null, can_view: true },
  { username: "bob", full_name: "Bob Ng", avatar_url: null, can_view: true },
];

function setup(props: Partial<React.ComponentProps<typeof CommentComposer>> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(true);
  const onCancel = vi.fn();
  render(
    <CommentComposer
      mentionsUrl="/mentions"
      placeholder="Write"
      submitLabel="Send"
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onSubmit, onCancel, box: screen.getByLabelText("Write") as HTMLTextAreaElement };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.get.mockResolvedValue(PEOPLE);
});

async function typeMention(actor: ReturnType<typeof userEvent.setup>, box: HTMLElement, text = "hi @a") {
  await actor.type(box, text);
  return screen.findByRole("listbox");
}

describe("CommentComposer", () => {
  it("sends with Enter, keeps the line break for Shift+Enter, and clears on success", async () => {
    const actor = userEvent.setup();
    const { onSubmit, box } = setup();
    await actor.type(box, "hello{Shift>}{Enter}{/Shift}world");
    expect(box).toHaveValue("hello\nworld");
    await actor.keyboard("{Enter}");
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("hello\nworld"));
    await waitFor(() => expect(box).toHaveValue(""));
  });

  it("keeps the text when the comment is refused, and ignores empty sends", async () => {
    const actor = userEvent.setup();
    const { onSubmit, box } = setup();
    await actor.type(box, "   {Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    onSubmit.mockResolvedValueOnce(false);
    await actor.type(box, "keep me{Enter}");
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(box).toHaveValue("   keep me");
  });

  it("sends with the button", async () => {
    const actor = userEvent.setup();
    const { onSubmit, box } = setup();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await actor.type(box, "via button");
    await actor.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("via button"));
  });

  it("does not send while an input method is composing", () => {
    const { onSubmit, box } = setup({ initialValue: "xin chào" });
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("suggests people for an @mention, skipping those who cannot see the page", async () => {
    const actor = userEvent.setup();
    const { box } = setup();
    const list = await typeMention(actor, box);
    expect(list).toBeInTheDocument();
    expect(mocked.get).toHaveBeenCalledWith("/mentions", { query: { q: "a" } });
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-disabled", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
  });

  it("moves with the arrows (skipping locked rows) and picks with Enter or Tab", async () => {
    const actor = userEvent.setup();
    const { box } = setup();
    await typeMention(actor, box);
    await actor.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[2]).toHaveAttribute("aria-selected", "true");
    await actor.keyboard("{ArrowUp}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    await actor.keyboard("{Enter}");
    expect(box).toHaveValue("hi @ann ");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await typeMention(actor, box, "and @b");
    await actor.keyboard("{Tab}");
    expect(box.value).toContain("@ann ");
  });

  it("picks a person by clicking them, but not a locked one", async () => {
    const actor = userEvent.setup();
    const { box } = setup();
    await typeMention(actor, box);
    await actor.click(screen.getAllByRole("option")[0].querySelector("button")!);
    expect(box).toHaveValue("hi @a");
    await actor.click(screen.getAllByRole("option")[2].querySelector("button")!);
    expect(box).toHaveValue("hi @bob ");
  });

  it("says when there is nobody to mention, and lets Enter send when nobody is pickable", async () => {
    mocked.get.mockResolvedValue([PEOPLE[0]]);
    const actor = userEvent.setup();
    const { box, onSubmit } = setup();
    await typeMention(actor, box);
    await actor.keyboard("{Enter}");
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());

    mocked.get.mockResolvedValue([]);
    await typeMention(actor, box, "again @z");
    expect(await screen.findByText("No one to mention")).toBeInTheDocument();
  });

  it("copes with a failed lookup", async () => {
    mocked.get.mockRejectedValue(new Error("down"));
    const actor = userEvent.setup();
    const { box } = setup();
    await actor.type(box, "hi @a");
    expect(await screen.findByText("No one to mention")).toBeInTheDocument();
  });

  it("closes the suggestions on Escape first, then cancels", async () => {
    const actor = userEvent.setup();
    const { box, onCancel } = setup();
    await typeMention(actor, box);
    await actor.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
    await actor.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalled();
  });

  it("ignores Escape when there is nothing to cancel", async () => {
    const actor = userEvent.setup();
    const { box } = setup({ onCancel: undefined });
    await actor.type(box, "x{Escape}");
    expect(box).toHaveValue("x");
  });

  it("opens suggestions upward for a pinned box and reacts to clicks in the text", async () => {
    const actor = userEvent.setup();
    const { box } = setup({ suggestionsAbove: true, autoFocus: true, compact: true, initialValue: "pre @a" });
    expect(box).toHaveFocus();
    await actor.click(box);
    const list = await screen.findByRole("listbox");
    expect(list).toHaveClass("bottom-full");
  });

  it("closes the list when the box loses focus", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const actor = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { box } = setup();
      await typeMention(actor, box);
      fireEvent.blur(box);
      await vi.advanceTimersByTimeAsync(200);
      await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });
});
