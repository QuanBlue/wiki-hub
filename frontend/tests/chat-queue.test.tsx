import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatWidget } from "@/components/chat/chat-widget";
import type { AnswerResult } from "@/lib/ai-answer";
import { CHAT_QUEUE_MAX, ChatStreamError, openChat } from "@/lib/ai-chat";
import { listThreads, loadThread, saveThread } from "@/lib/ai-chat-store";
import { resetAiStatus } from "@/lib/ai-summary";
import { api } from "@/lib/api-client";

const streamChat = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-chat")>()),
  streamChat,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

const answer = (text: string): AnswerResult => ({
  found: true,
  answer: text,
  reason: "",
  sources: [],
  related: [],
  cached: false,
});

/** The replies asked for, each ended by hand. */
let replies: { done: (text: string) => void; fail: () => void }[] = [];
const reply = (at: number, text = `reply ${at}`) =>
  act(async () => replies[at].done(text));
/** The question each call to the model ended with. */
const sent = () =>
  streamChat.mock.calls.map(([messages]) => messages.at(-1).content);
const waiting = () =>
  within(screen.getByRole("list", { name: "Questions waiting to be sent" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent);
const noQueue = () =>
  expect(
    screen.queryByRole("list", { name: "Questions waiting to be sent" }),
  ).toBeNull();

async function open() {
  render(<ChatWidget userId="u1" />);
  await waitFor(() => expect(api.get).toHaveBeenCalled());
  await act(async () => openChat());
  const box = await screen.findByPlaceholderText("Ask a question…");
  return { actor: userEvent.setup(), box };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAiStatus();
  window.localStorage.clear();
  vi.mocked(api.get).mockResolvedValue({ enabled: true });
  vi.mocked(api.post).mockResolvedValue({ title: "" });
  replies = [];
  streamChat.mockImplementation(
    (_messages, { signal }: { signal: AbortSignal }) =>
      new Promise<AnswerResult>((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
        replies.push({
          done: (text) => resolve(answer(text)),
          fail: () => reject(new ChatStreamError("rate_limited")),
        });
      }),
  );
});

describe("questions asked while a reply is being written", () => {
  it("wait their turn and go one by one, each with the replies before it", async () => {
    const { actor, box } = await open();
    await actor.type(box, "first{Enter}");
    await actor.type(box, "second{Enter}");
    await actor.type(box, "third");
    await actor.click(
      screen.getByRole("button", { name: "Send after this reply" }),
    );

    expect(box).toHaveValue("");
    expect(sent()).toEqual(["first"]);
    expect(waiting()).toEqual(["second", "third"]);

    await reply(0);
    expect(sent()).toEqual(["first", "second"]);
    expect(waiting()).toEqual(["third"]);
    expect(streamChat.mock.calls[1][0]).toHaveLength(3);

    await reply(1);
    await reply(2);
    expect(sent()).toEqual(["first", "second", "third"]);
    noQueue();
    expect(screen.getByText("reply 2")).toBeInTheDocument();
  });

  it("share one button with Stop: words in the box turn it into Send", async () => {
    const { actor, box } = await open();
    await actor.type(box, "first{Enter}");
    const named = (name: string) => screen.queryByRole("button", { name });
    expect(named("Stop")).toBeInTheDocument();

    await actor.type(box, "second");
    expect(named("Stop")).toBeNull();
    expect(named("Send after this reply")).toBeEnabled();

    await actor.clear(box);
    expect(named("Send after this reply")).toBeNull();
    expect(named("Stop")).toBeInTheDocument();
  });

  it("can be taken out before their turn", async () => {
    const { actor, box } = await open();
    await actor.type(box, "first{Enter}");
    await actor.type(box, "never mind{Enter}");

    await actor.click(
      screen.getByRole("button", { name: "Remove from the queue: never mind" }),
    );
    noQueue();
    await reply(0);

    expect(sent()).toEqual(["first"]);
  });

  it("are held after a stop, and sent when the person says", async () => {
    const { actor, box } = await open();
    await actor.type(box, "first{Enter}");
    await actor.type(box, "second{Enter}");

    await actor.click(screen.getByRole("button", { name: "Stop" }));
    expect(sent()).toEqual(["first"]);
    expect(screen.getByText("Not sent yet")).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Send now" }));
    expect(sent()).toEqual(["first", "second"]);
    noQueue();
  });

  it("are held after a reply that failed", async () => {
    const { actor, box } = await open();
    await actor.type(box, "first{Enter}");
    await actor.type(box, "second{Enter}");

    await act(async () => replies[0].fail());

    expect(sent()).toEqual(["first"]);
    expect(waiting()).toEqual(["second"]);
    expect(
      screen.getByRole("button", { name: "Send now" }),
    ).toBeInTheDocument();
  });

  it("go on in their own thread while another is shown", async () => {
    const { actor, box } = await open();
    await actor.type(box, "first{Enter}");
    await actor.type(box, "second{Enter}");
    const id = listThreads("u1")[0].id;

    box.focus();
    await actor.keyboard("{Control>}{Shift>}o{/Shift}{/Control}");
    noQueue();
    await reply(0);
    await reply(1);

    expect(sent()).toEqual(["first", "second"]);
    expect(loadThread("u1", id).entries.map((entry) => entry.content)).toEqual([
      "first",
      "reply 0",
      "second",
      "reply 1",
    ]);
  });

  it("stop being taken once so many wait", async () => {
    saveThread("u1", "t", {
      entries: [{ id: "q", role: "user", content: "earlier" }],
      slots: {},
      queue: Array.from({ length: CHAT_QUEUE_MAX }, (_, index) => ({
        id: `w${index}`,
        content: `waiting ${index}`,
      })),
    });
    const { actor, box } = await open();
    // Kept across a reload, and held until asked for.
    expect(waiting()).toHaveLength(CHAT_QUEUE_MAX);
    await actor.click(screen.getByRole("button", { name: "Send now" }));
    await actor.type(box, "one more{Enter}");
    await actor.type(box, " and another{Enter}");

    expect(waiting()).toHaveLength(CHAT_QUEUE_MAX);
    expect(box).toHaveValue(" and another");
    expect(
      screen.getByRole("button", { name: /The queue is full/ }),
    ).toBeDisabled();
  });
});
