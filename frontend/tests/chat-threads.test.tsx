import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ChatThreadList,
  groupThreads,
} from "@/components/chat/chat-thread-list";
import { useChat } from "@/components/chat/use-chat";
import { useChatThreads } from "@/components/chat/use-chat-threads";
import type { AnswerResult } from "@/lib/ai-answer";
import { messagesToCompact, type ChatEntry } from "@/lib/ai-chat";
import {
  listThreads,
  loadThread,
  saveThread,
  updateThread,
  type ThreadMeta,
} from "@/lib/ai-chat-store";

const streamChat = vi.hoisted(() => vi.fn());
const summarizeThread = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-chat")>()),
  streamChat,
  summarizeThread,
}));

const answer = (text: string): AnswerResult => ({
  found: true,
  answer: text,
  reason: "",
  sources: [],
  related: [],
  cached: false,
});

/** ``pairs`` questions, each with its answer: ids q0, a0, q1, a1, … */
const talk = (pairs: number): ChatEntry[] =>
  Array.from({ length: pairs }, (_, i): ChatEntry[] => [
    { id: `q${i}`, role: "user", content: `question ${i}` },
    {
      id: `a${i}`,
      role: "assistant",
      content: `answer ${i}`,
      status: "done",
      found: true,
    },
  ]).flat();

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("what of a long thread is summarised", () => {
  it("nothing while the model still reads it all", () => {
    expect(messagesToCompact(talk(5))).toBeNull();
  });

  it("all but the latest few, once there is more than the model reads", () => {
    const due = messagesToCompact(talk(6))!;

    expect(due.count).toBe(8);
    expect(due.upTo).toBe("a3");
    expect(due.messages[0]).toEqual({ role: "user", content: "question 0" });
    // What was covered is not summarised again.
    expect(messagesToCompact(talk(6), due.upTo)).toBeNull();
    expect(messagesToCompact(talk(10), due.upTo)!.messages[0].content).toBe(
      "question 4",
    );
  });

  it("is kept with the thread and sent with the next question", async () => {
    saveThread("u1", "t", { entries: talk(5), slots: {} });
    streamChat.mockResolvedValue(answer("sixth"));
    summarizeThread.mockResolvedValue("We talked.");
    const { result } = renderHook(() => useChat("u1", "normal", null, "t"));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => void (await result.current.send("one more")));

    await waitFor(() =>
      expect(result.current.compact?.summary).toBe("We talked."),
    );
    expect(summarizeThread).toHaveBeenCalledWith("", expect.any(Array));
    expect(loadThread("u1", "t").compact?.count).toBe(8);

    await act(async () => void (await result.current.send("and then?")));
    expect(streamChat.mock.calls[1][1].summary).toBe("We talked.");
  });

  it("no longer holds once the thread is edited back past it", async () => {
    saveThread("u1", "t", {
      entries: talk(6),
      slots: {},
      compact: { summary: "Old.", upTo: "a3", count: 8 },
    });
    streamChat.mockResolvedValue(answer("again"));
    const { result } = renderHook(() => useChat("u1", "normal", null, "t"));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.compact?.summary).toBe("Old.");

    await act(async () => result.current.edit("q1", "changed"));

    expect(streamChat.mock.calls[0][1].summary).toBeUndefined();
    expect(result.current.compact).toBeUndefined();
  });

  it("a summary that cannot be written leaves the thread as it was", async () => {
    saveThread("u1", "t", { entries: talk(5), slots: {} });
    streamChat.mockResolvedValue(answer("sixth"));
    summarizeThread.mockRejectedValue(new Error("busy"));
    const { result } = renderHook(() => useChat("u1", "normal", null, "t"));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => void (await result.current.send("one more")));

    expect(result.current.compact).toBeUndefined();
    expect(result.current.entries).toHaveLength(12);
  });
});

describe("editing the first question of a thread", () => {
  it("keeps the thread, its pin and the name the person gave it", async () => {
    saveThread("u1", "t", { entries: talk(1), slots: {} });
    updateThread("u1", "t", {
      title: "Mine",
      titleSource: "manual",
      pinned: true,
    });
    streamChat.mockResolvedValue(answer("new"));
    const { result } = renderHook(() => useChat("u1", "normal", null, "t"));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => result.current.edit("q0", "changed"));

    expect(listThreads("u1")[0]).toMatchObject({ title: "Mine", pinned: true });
  });
});

describe("the person's threads", () => {
  it("a name from the assistant never replaces one the person gave", async () => {
    saveThread("u1", "t", { entries: talk(1), slots: {} });
    const { result } = renderHook(() => useChatThreads("u1"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.activeId).toBe("t");

    act(() => result.current.nameByAssistant("t", "From AI"));
    expect(result.current.active).toMatchObject({
      title: "From AI",
      titleSource: "ai",
    });
    act(() => result.current.rename("t", "  Mine  "));
    act(() => result.current.nameByAssistant("t", "AI again"));
    expect(result.current.active?.title).toBe("Mine");
    act(() => result.current.togglePin("t"));
    expect(result.current.active?.pinned).toBe(true);
  });

  it("a new chat is opened again after a reload, once it has a question", async () => {
    saveThread("u1", "pinned", { entries: talk(1), slots: {} });
    updateThread("u1", "pinned", { pinned: true });
    const first = renderHook(() => useChatThreads("u1"));
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    let id = "";
    act(() => void (id = first.result.current.startNew()));
    act(() => saveThread("u1", id, { entries: talk(1), slots: {} }));
    first.unmount();

    const again = renderHook(() => useChatThreads("u1"));
    await waitFor(() => expect(again.result.current.ready).toBe(true));
    expect(again.result.current.activeId).toBe(id);
  });

  it("removing the open thread opens the next one", async () => {
    saveThread("u1", "a", { entries: talk(1), slots: {} });
    saveThread("u1", "b", { entries: talk(1), slots: {} });
    const { result } = renderHook(() => useChatThreads("u1"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    const open = result.current.activeId;

    act(() => result.current.remove(open));

    expect(result.current.threads).toHaveLength(1);
    expect(result.current.activeId).toBe(result.current.threads[0].id);
  });
});

describe("the list of threads", () => {
  const meta = (id: string, updatedAt: number, pinned = false): ThreadMeta => ({
    id,
    title: `Chat ${id}`,
    titleSource: "pending",
    createdAt: updatedAt,
    updatedAt,
    pinned,
  });

  it("groups threads by when they were last used, pinned first", () => {
    const now = new Date(2026, 10, 25, 12).getTime();
    const day = 24 * 60 * 60 * 1000;
    const groups = groupThreads(
      [
        meta("p", now - 30 * day, true),
        meta("t", now),
        meta("y", now - day),
        meta("w", now - 5 * day),
        meta("o", now - 30 * day),
      ],
      now,
    );

    expect(groups.map((g) => g.group)).toEqual([
      "pinned",
      "today",
      "yesterday",
      "week",
      "older",
    ]);
  });

  function list(
    extra: Partial<React.ComponentProps<typeof ChatThreadList>> = {},
  ) {
    saveThread("u1", "a", { entries: talk(1), slots: {} });
    const props = {
      userId: "u1",
      threads: listThreads("u1"),
      activeId: "a",
      running: [],
      unread: [],
      onSelect: vi.fn(),
      onNew: vi.fn(),
      onAsk: vi.fn(),
      onRename: vi.fn(),
      onTogglePin: vi.fn(),
      onExport: vi.fn(),
      onDelete: vi.fn(),
      ...extra,
    };
    render(<ChatThreadList {...props} />);
    return { props, actor: userEvent.setup() };
  }

  it("searches what was said, and opens the thread at that turn", async () => {
    const { props, actor } = list();

    await actor.type(screen.getByRole("searchbox"), "ANSWER 0");
    await actor.click(await screen.findByText("answer 0"));

    expect(props.onSelect).toHaveBeenCalledWith("a", "a0");
  });

  it("offers to ask the assistant when nothing matches", async () => {
    const { props, actor } = list();

    await actor.type(screen.getByRole("searchbox"), "kubernetes");
    await actor.click(
      await screen.findByRole("button", { name: "Ask the assistant" }),
    );

    expect(props.onAsk).toHaveBeenCalledWith("kubernetes");
  });

  it("renames in place with F2, and keeps the name on Escape", async () => {
    const { props, actor } = list();
    const item = screen.getByRole("button", { name: "question 0" });

    item.focus();
    await actor.keyboard("{F2}");
    await actor.clear(screen.getByRole("textbox", { name: "Chat name" }));
    await actor.keyboard("New name{Enter}");
    expect(props.onRename).toHaveBeenCalledWith("a", "New name");

    screen.getByRole("button", { name: "question 0" }).focus();
    await actor.keyboard("{F2}typed{Escape}");
    expect(props.onRename).toHaveBeenCalledTimes(1);
  });

  it("deletes only after the person confirms", async () => {
    const { props, actor } = list();

    await actor.click(
      screen.getByRole("button", { name: "Options for question 0" }),
    );
    await actor.click(screen.getByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(props.onDelete).not.toHaveBeenCalled();
    await actor.click(
      within(dialog).getByRole("button", { name: "Delete chat" }),
    );

    expect(props.onDelete).toHaveBeenCalledWith("a");
  });

  it("marks a thread being answered, and one with an unread answer", () => {
    list({ unread: ["a"] });
    expect(screen.getByRole("img", { name: "New answer" })).toBeInTheDocument();
  });
});
