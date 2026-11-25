import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatThreadList } from "@/components/chat/chat-thread-list";
import { ChatWidget } from "@/components/chat/chat-widget";
import { useChatBox } from "@/components/chat/use-chat-box";
import { openChat, type ChatEntry } from "@/lib/ai-chat";
import {
  CHAT_DROPPED_EVENT,
  chatThreadKey,
  listThreads,
  saveThread,
} from "@/lib/ai-chat-store";
import { resetAiStatus } from "@/lib/ai-summary";
import { api } from "@/lib/api-client";
import { downloadMarkdown } from "@/lib/chat-export";

const toast = vi.hoisted(() => ({ warning: vi.fn() }));
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn() },
}));
vi.mock("@/lib/chat-export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat-export")>()),
  downloadMarkdown: vi.fn(),
}));

const talk = (question: string): ChatEntry[] => [
  { id: `q-${question}`, role: "user", content: question },
  {
    id: `a-${question}`,
    role: "assistant",
    content: `about ${question}`,
    status: "done",
    found: true,
  },
];
const keep = (id: string, question: string) =>
  saveThread("u1", id, { entries: talk(question), slots: {} });

/** A screen wide enough for the list beside the conversation, or not. */
function viewport(roomy: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: roomy && query.includes("min-width"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  );
}

async function open({ roomy = true } = {}) {
  viewport(roomy);
  render(<ChatWidget userId="u1" />);
  await waitFor(() => expect(api.get).toHaveBeenCalled());
  await act(async () => openChat());
  const box = await screen.findByPlaceholderText("Ask a question…");
  return { actor: userEvent.setup(), box };
}

const list = () => screen.getByRole("navigation", { name: "Chats" });

beforeEach(() => {
  vi.clearAllMocks();
  resetAiStatus();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.mocked(api.get).mockResolvedValue({ enabled: true });
});
afterEach(() => vi.unstubAllGlobals());

describe("the list beside a wide panel", () => {
  it("folds into a strip that starts a chat, searches and unfolds it", async () => {
    keep("a", "billing");
    const { actor } = await open();

    await actor.click(
      within(list()).getByRole("button", { name: "Hide chats" }),
    );
    expect(screen.queryByRole("searchbox")).toBeNull();

    await actor.click(
      within(list()).getByRole("button", { name: "Search chats" }),
    );
    await waitFor(() => expect(screen.getByRole("searchbox")).toHaveFocus());

    await actor.click(
      within(list()).getByRole("button", { name: "Hide chats" }),
    );
    await actor.click(within(list()).getByRole("button", { name: "New chat" }));
    expect(await screen.findByText("Ask your wiki")).toBeInTheDocument();
    await actor.click(
      within(list()).getByRole("button", { name: "Show chats" }),
    );
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });

  it("is made wider by its edge, within limits, and remembered", async () => {
    keep("a", "billing");
    await open();
    const edge = screen.getByRole("separator", {
      name: "Resize the list of chats",
    });
    expect(list().style.width).toBe("260px");

    fireEvent.keyDown(edge, { key: "ArrowRight" });
    expect(list().style.width).toBe("276px");
    // jsdom has no PointerEvent: a mouse event of that type carries the position.
    fireEvent(
      edge,
      new MouseEvent("pointerdown", { bubbles: true, clientX: 100 }),
    );
    fireEvent(window, new MouseEvent("pointermove", { clientX: 900 }));
    await waitFor(() => expect(list().style.width).toBe("480px"));
    fireEvent(window, new MouseEvent("pointerup"));
    await waitFor(() =>
      expect(window.localStorage.getItem("wikihub:chat-threads-width")).toBe(
        "480",
      ),
    );
    fireEvent.doubleClick(edge);
    expect(list().style.width).toBe("260px");
  });

  it("exports any thread from its menu", async () => {
    keep("a", "billing");
    keep("b", "holidays");
    const { actor } = await open();

    await actor.click(
      screen.getByRole("button", { name: "Options for billing" }),
    );
    await actor.click(
      screen.getByRole("menuitem", { name: "Export to a file" }),
    );

    expect(downloadMarkdown).toHaveBeenCalledWith(
      expect.stringContaining("about billing"),
      expect.stringMatching(/\.md$/),
    );
  });

  it("renames the open thread from its name in the header", async () => {
    keep("a", "billing");
    const { actor } = await open();

    await actor.click(
      screen.getByRole("button", { name: "Rename this chat: billing" }),
    );
    const field = screen.getByRole("textbox", { name: "Chat name" });
    await actor.clear(field);
    await actor.type(field, "Invoices{Enter}");

    expect(listThreads("u1")[0]).toMatchObject({
      title: "Invoices",
      titleSource: "manual",
    });
    expect(
      screen.getByRole("button", { name: "Rename this chat: Invoices" }),
    ).toBeInTheDocument();
  });

  it("keeps the words typed in each thread's box to that thread", async () => {
    keep("a", "billing");
    keep("b", "holidays");
    const { actor, box } = await open();

    await actor.type(box, "for holidays");
    await actor.click(within(list()).getByRole("button", { name: "billing" }));
    expect(box).toHaveValue("");
    await actor.type(box, "for billing");
    await actor.click(within(list()).getByRole("button", { name: "New chat" }));
    expect(box).toHaveValue("");
    await actor.type(box, "not yet asked");
    await actor.click(within(list()).getByRole("button", { name: "holidays" }));
    expect(box).toHaveValue("for holidays");
    await actor.click(within(list()).getByRole("button", { name: "New chat" }));
    expect(box).toHaveValue("not yet asked");
  });

  it("removes the words waiting in a deleted thread", async () => {
    keep("a", "billing");
    const { actor, box } = await open();
    await actor.type(box, "half typed");
    expect(window.localStorage.getItem("wikihub:chat:v2:u1:draft:a")).toBe(
      "half typed",
    );

    await actor.click(
      screen.getByRole("button", { name: "Options for billing" }),
    );
    await actor.click(screen.getByRole("menuitem", { name: "Delete" }));
    await actor.click(
      await screen.findByRole("button", { name: "Delete chat" }),
    );

    expect(window.localStorage.getItem(chatThreadKey("u1", "a"))).toBeNull();
    expect(
      window.localStorage.getItem("wikihub:chat:v2:u1:draft:a"),
    ).toBeNull();
    expect(box).toHaveValue("");
  });

  it("says when old threads were removed for want of room, to their owner only", async () => {
    await open();
    const drop = (userId: string, titles: string[]) =>
      act(
        () =>
          void window.dispatchEvent(
            new CustomEvent(CHAT_DROPPED_EVENT, { detail: { userId, titles } }),
          ),
      );

    drop("someone-else", ["theirs"]);
    expect(toast.warning).not.toHaveBeenCalled();
    drop("u1", ["one", "two", "three", "four"]);

    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining("4"),
      expect.objectContaining({ description: "“one”, “two”, “three”, …" }),
    );
  });
});

describe("a narrow panel", () => {
  it("renames the open thread from the menu under its name", async () => {
    keep("a", "billing");
    const { actor } = await open({ roomy: false });

    await actor.click(screen.getByRole("button", { name: "billing" }));
    await actor.click(
      screen.getByRole("menuitem", { name: "Rename this chat" }),
    );
    const field = await screen.findByRole("textbox", { name: "Chat name" });
    await actor.clear(field);
    await actor.type(field, "Invoices{Enter}");

    expect(listThreads("u1")[0].title).toBe("Invoices");
  });

  it("puts the list away with a swipe to the left, not with a scroll", async () => {
    const onClose = vi.fn();
    render(
      <ChatThreadList
        userId="u1"
        threads={[]}
        activeId="a"
        running={[]}
        unread={[]}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onAsk={vi.fn()}
        onRename={vi.fn()}
        onTogglePin={vi.fn()}
        onExport={vi.fn()}
        onDelete={vi.fn()}
        onClose={onClose}
        overlay
      />,
    );
    const nav = screen.getByRole("navigation");
    const swipe = (dx: number, dy: number) => {
      fireEvent.touchStart(nav, { touches: [{ clientX: 200, clientY: 200 }] });
      fireEvent.touchEnd(nav, {
        changedTouches: [{ clientX: 200 + dx, clientY: 200 + dy }],
      });
    };

    swipe(-20, 0);
    swipe(-80, 120);
    swipe(90, 0);
    expect(onClose).not.toHaveBeenCalled();
    swipe(-90, 10);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("separator")).toBeNull();
  });
});

describe("the box of a new chat", () => {
  it("goes with the thread it becomes, leaving the next new chat empty", () => {
    const { result, rerender } = renderHook(
      ({ id }) => useChatBox("u1", id, true),
      { initialProps: { id: "new" } },
    );
    act(() => result.current.setDraft("words"));
    act(() =>
      result.current.started("t", {
        chips: [{ key: "f", id: "f", filename: "a.txt", status: "ready" }],
        scope: { id: "s", filename: "page.pdf" },
      }),
    );
    expect(result.current.draft).toBe("");
    expect(result.current.chips).toEqual([]);

    rerender({ id: "t" });
    expect(result.current.scope?.filename).toBe("page.pdf");
    expect(result.current.chips).toHaveLength(1);
    expect(window.localStorage.getItem("wikihub:chat:v2:u1:files:t")).toContain(
      "a.txt",
    );
  });
});
