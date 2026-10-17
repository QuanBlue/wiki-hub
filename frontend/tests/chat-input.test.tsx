import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatTopBarButton } from "@/components/chat/chat-top-bar-button";
import { ChatWidget } from "@/components/chat/chat-widget";
import type { AnswerResult } from "@/lib/ai-answer";
import { resetAiStatus } from "@/lib/ai-summary";
import { api } from "@/lib/api-client";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
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
const streamChat = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-chat")>()),
  streamChat,
}));

const ANSWER: AnswerResult = {
  found: true,
  answer: "Here it is.",
  reason: "",
  sources: [],
  related: [],
  cached: false,
  basis: "app",
};

async function open() {
  vi.mocked(api.get).mockResolvedValue({ enabled: true, can_configure: false });
  const actor = userEvent.setup();
  render(
    <>
      <ChatTopBarButton />
      <ChatWidget userId="u1" />
    </>,
  );
  await actor.click(
    await screen.findByRole("button", { name: "Chat with AI" }),
  );
  const box = (await screen.findByPlaceholderText(
    "Ask a question…",
  )) as HTMLTextAreaElement;
  return { actor, box };
}

describe("the level of detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAiStatus();
    window.localStorage.clear();
  });

  it("is chosen below the box, starts balanced, and goes with the question", async () => {
    streamChat.mockResolvedValue(ANSWER);
    const { actor, box } = await open();

    const group = screen.getByRole("radiogroup", { name: "Detail" });
    const options = [...group.querySelectorAll('[role="radio"]')];
    expect(options.map((o) => o.textContent)).toEqual([
      "Brief",
      "Balanced",
      "Detailed",
    ]);
    expect(screen.getByRole("radio", { name: "Balanced" })).toBeChecked();

    await actor.click(screen.getByRole("radio", { name: "Detailed" }));
    expect(screen.getByRole("radio", { name: "Detailed" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Balanced" })).not.toBeChecked();

    await actor.type(box, "how does it work{Enter}");
    await waitFor(() => expect(streamChat).toHaveBeenCalledTimes(1));
    expect(streamChat.mock.calls[0][1]).toMatchObject({ detail: "detailed" });
    expect(window.localStorage.getItem("wikihub:chat-detail")).toBe("detailed");
  });

  it("is remembered the next time the chat is opened", async () => {
    window.localStorage.setItem("wikihub:chat-detail", "brief");
    await open();

    expect(screen.getByRole("radio", { name: "Brief" })).toBeChecked();
  });
});

describe("the arrow keys in the box", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAiStatus();
    window.localStorage.clear();
    streamChat.mockResolvedValue(ANSWER);
  });

  it("walk back through the questions asked, and forward again to what was typed", async () => {
    const { actor, box } = await open();
    await actor.type(box, "first question{Enter}");
    await screen.findAllByText("Here it is.");
    await actor.type(box, "second question{Enter}");
    await waitFor(() => expect(streamChat).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getAllByText("Here it is.")).toHaveLength(2),
    );

    await actor.type(box, "half typed");
    await actor.keyboard("{ArrowUp}");
    expect(box).toHaveValue("second question");
    await actor.keyboard("{ArrowUp}");
    expect(box).toHaveValue("first question");
    // The oldest is the end of the way up.
    await actor.keyboard("{ArrowUp}");
    expect(box).toHaveValue("first question");

    await actor.keyboard("{ArrowDown}");
    expect(box).toHaveValue("second question");
    // Past the newest: what was being typed comes back.
    await actor.keyboard("{ArrowDown}");
    expect(box).toHaveValue("half typed");
    // And Down with nothing to come back to does nothing.
    await actor.keyboard("{ArrowDown}");
    expect(box).toHaveValue("half typed");
  });

  it("put the caret at the end, so the old question can be edited and sent", async () => {
    const { actor, box } = await open();
    await actor.type(box, "billing address{Enter}");
    await screen.findByText("Here it is.");

    await actor.keyboard("{ArrowUp}");
    expect(box.selectionStart).toBe("billing address".length);
    await actor.type(box, "?{Enter}");

    await waitFor(() => expect(streamChat).toHaveBeenCalledTimes(2));
    const sent = streamChat.mock.calls[1][0] as { content: string }[];
    expect(sent[sent.length - 1].content).toBe("billing address?");
  });

  it("do nothing with no question asked, or in the middle of a longer one", async () => {
    const { actor, box } = await open();

    await actor.keyboard("{ArrowUp}");
    expect(box).toHaveValue("");

    await actor.type(box, "one");
    await actor.keyboard("{Shift>}{Enter}{/Shift}");
    await actor.type(box, "two");
    // The caret is on the second line: Up moves inside the text, it does not swap it.
    await actor.keyboard("{ArrowUp}");
    expect(box).toHaveValue("one\ntwo");
  });

  it("start again from the newest after typing something else", async () => {
    const { actor, box } = await open();
    await actor.type(box, "alpha{Enter}");
    await screen.findByText("Here it is.");
    await actor.type(box, "beta{Enter}");
    await waitFor(() =>
      expect(screen.getAllByText("Here it is.")).toHaveLength(2),
    );

    await actor.keyboard("{ArrowUp}{ArrowUp}");
    expect(box).toHaveValue("alpha");
    await actor.type(box, "!");
    expect(box).toHaveValue("alpha!");
    await actor.clear(box);
    await actor.keyboard("{ArrowUp}");
    expect(box).toHaveValue("beta");
  });
});

describe("an answer that was cancelled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAiStatus();
    window.localStorage.clear();
  });

  it("stays with a note, and can be asked again from the note", async () => {
    streamChat.mockImplementationOnce(
      (_m: unknown, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () =>
            reject(new DOMException("a", "AbortError")),
          ),
        ),
    );
    streamChat.mockResolvedValueOnce(ANSWER);
    const { actor, box } = await open();
    await actor.type(box, "slow question{Enter}");
    await actor.click(await screen.findByRole("button", { name: "Stop" }));

    expect(screen.getByText("slow question")).toBeInTheDocument();
    expect(screen.getByText("You cancelled this answer.")).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: /Try again/ }));

    expect(await screen.findByText("Here it is.")).toBeInTheDocument();
    expect(screen.queryByText("You cancelled this answer.")).toBeNull();
    expect(streamChat).toHaveBeenCalledTimes(2);
  });
});
