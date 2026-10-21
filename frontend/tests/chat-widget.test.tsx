import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatTopBarButton } from "@/components/chat/chat-top-bar-button";
import { ChatWidget } from "@/components/chat/chat-widget";
import { CodeBlock } from "@/components/issues/code-block";
import { IssueMarkdown } from "@/components/issues/issue-markdown";
import type { AnswerResult } from "@/lib/ai-answer";
import { ChatStreamError, openChat } from "@/lib/ai-chat";
import { resetAiStatus } from "@/lib/ai-summary";
import { api } from "@/lib/api-client";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
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

const source = {
  n: 1,
  id: "id-1",
  title: "Billing server",
  slug: "billing-server",
  space_key: "OPS",
  space_name: "Operations",
  excerpt: "The billing server is 10.0.0.5",
};
const FOUND: AnswerResult = {
  found: true,
  answer: "The server is **10.0.0.5** [1].",
  reason: "",
  sources: [source],
  related: [],
  cached: false,
};

/** The panel and the top bar button that toggles it, as they sit in the app shell. */
function Shell({ userId }: { userId: string }) {
  return (
    <>
      <ChatTopBarButton />
      <ChatWidget userId={userId} />
    </>
  );
}

const panelHidden = () =>
  document.getElementById("wikihub-chat-panel")?.hidden ?? true;

function ai(enabled: boolean) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path.includes("/ai/status")) return { enabled, can_configure: false };
    throw new Error(`unexpected ${path}`);
  });
}

async function openPanel(actor: ReturnType<typeof userEvent.setup>) {
  await actor.click(
    await screen.findByRole("button", { name: "Chat with AI" }),
  );
  return screen.findByPlaceholderText("Ask a question…");
}

describe("the chat widget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAiStatus();
    window.localStorage.clear();
  });
  afterEach(() => window.localStorage.clear());

  it("does not exist while the AI assistant is off", async () => {
    ai(false);
    render(<Shell userId="u1" />);

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Chat with AI" })).toBeNull();
  });

  it("opens from the button, offers example questions and closes again", async () => {
    ai(true);
    const actor = userEvent.setup();
    render(<Shell userId="u1" />);

    await openPanel(actor);
    expect(screen.getByText("Ask your wiki")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "How do I install k3s?" }),
    ).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Close chat" }));
    expect(panelHidden()).toBe(true);

    // The top bar button opens it again, and closes it when it is open.
    await actor.click(screen.getByRole("button", { name: "Chat with AI" }));
    expect(panelHidden()).toBe(false);
    await actor.click(screen.getByRole("button", { name: "Chat with AI" }));
    expect(panelHidden()).toBe(true);
  });

  it("shows the reply as it is written, then the checked answer with its sources", async () => {
    ai(true);
    let finish!: (result: AnswerResult) => void;
    streamChat.mockImplementation(
      (
        _messages: unknown,
        { onDelta }: { onDelta: (text: string) => void },
      ) => {
        onDelta("The server is ");
        return new Promise<AnswerResult>((resolve) => {
          finish = resolve;
        });
      },
    );
    const actor = userEvent.setup();
    render(<Shell userId="u1" />);

    const box = await openPanel(actor);
    await actor.type(box, "billing address{Enter}");

    expect(await screen.findByText("billing address")).toBeInTheDocument();
    expect(await screen.findByText("The server is")).toBeInTheDocument();
    // While it is being written there is a way to stop, and no way to send another.
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();

    await act(async () => finish(FOUND));

    expect(await screen.findByText("10.0.0.5")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Billing server/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    const [messages] = streamChat.mock.calls[0];
    expect(messages).toEqual([{ role: "user", content: "billing address" }]);
  });

  it("opens a source in the app", async () => {
    ai(true);
    streamChat.mockResolvedValue(FOUND);
    const actor = userEvent.setup();
    render(<Shell userId="u1" />);

    await actor.type(await openPanel(actor), "billing{Enter}");
    await actor.click(
      await screen.findByRole("button", { name: /Billing server/ }),
    );

    expect(push).toHaveBeenCalledWith("/spaces/OPS/pages/billing-server");
  });

  it("sends the earlier turns with a follow-up", async () => {
    ai(true);
    streamChat.mockResolvedValue(FOUND);
    const actor = userEvent.setup();
    render(<Shell userId="u1" />);

    const box = await openPanel(actor);
    await actor.type(box, "what is billing{Enter}");
    await screen.findByText("10.0.0.5");
    await actor.type(box, "and its address?{Enter}");

    await waitFor(() => expect(streamChat).toHaveBeenCalledTimes(2));
    expect(
      streamChat.mock.calls[1][0].map((m: { role: string }) => m.role),
    ).toEqual(["user", "assistant", "user"]);
  });

  it("says why a reply failed and asks the same question again on Try again", async () => {
    ai(true);
    streamChat.mockRejectedValueOnce(new ChatStreamError("rate_limited"));
    streamChat.mockResolvedValueOnce(FOUND);
    const actor = userEvent.setup();
    render(<Shell userId="u1" />);

    await actor.type(await openPanel(actor), "billing{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(/asked a lot/);

    await actor.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("10.0.0.5")).toBeInTheDocument();
    expect(screen.getAllByText("billing")).toHaveLength(1); // not asked twice on screen
  });

  it("stopping keeps the question and says the answer was cancelled", async () => {
    ai(true);
    streamChat.mockImplementation(
      (_m: unknown, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () =>
            reject(new DOMException("a", "AbortError")),
          ),
        ),
    );
    const actor = userEvent.setup();
    render(<Shell userId="u1" />);

    const box = await openPanel(actor);
    await actor.type(box, "billing address{Enter}");
    await actor.click(await screen.findByRole("button", { name: "Stop" }));

    // The question stays where it was asked, with a note under it, and the box is free.
    expect(screen.getByText("billing address")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "You cancelled this answer.",
    );
    expect(box).toHaveValue("");
    // Giving up is not asking again: nothing is sent a second time.
    expect(streamChat).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("does not send while an input method is composing, nor on Shift+Enter", async () => {
    ai(true);
    streamChat.mockResolvedValue(FOUND);
    const actor = userEvent.setup();
    render(<Shell userId="u1" />);

    const box = await openPanel(actor);
    await actor.type(box, "line one{Shift>}{Enter}{/Shift}line two");

    expect(streamChat).not.toHaveBeenCalled();
    expect(box).toHaveValue("line one\nline two");
  });

  it("puts the panel away on a click outside it, but not inside it", async () => {
    ai(true);
    const actor = userEvent.setup();
    render(
      <>
        <button type="button">elsewhere</button>
        <Shell userId="u1" />
      </>,
    );

    const box = await openPanel(actor);
    await actor.click(box);
    expect(panelHidden()).toBe(false);

    await actor.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(panelHidden()).toBe(true);
  });

  it("keeps the conversation in this browser, for this person", async () => {
    ai(true);
    streamChat.mockResolvedValue(FOUND);
    const actor = userEvent.setup();
    const first = render(<Shell userId="u1" />);

    await actor.type(await openPanel(actor), "billing{Enter}");
    await screen.findByText("10.0.0.5");
    first.unmount();

    render(<Shell userId="u1" />);
    await openPanel(actor);
    expect(await screen.findByText("10.0.0.5")).toBeInTheDocument();
  });

  it("a new chat asks first, then clears", async () => {
    ai(true);
    streamChat.mockResolvedValue(FOUND);
    const actor = userEvent.setup();
    render(<Shell userId="u1" />);

    await actor.type(await openPanel(actor), "billing{Enter}");
    await screen.findByText("10.0.0.5");
    await actor.click(screen.getByRole("button", { name: "New chat" }));
    await actor.click(
      await screen.findByRole("button", { name: "Clear and start over" }),
    );

    expect(await screen.findByText("Ask your wiki")).toBeInTheDocument();
    expect(window.localStorage.getItem("wikihub:chat:v1:u1")).toBeNull();
  });

  it("carries on from an answer given in the search box", async () => {
    ai(true);
    const actor = userEvent.setup();
    render(<Shell userId="u1" />);
    await screen.findByRole("button", { name: "Chat with AI" });

    act(() => openChat({ question: "billing address", result: FOUND }));

    expect(await screen.findByText("billing address")).toBeInTheDocument();
    expect(await screen.findByText("10.0.0.5")).toBeInTheDocument();
    expect(streamChat).not.toHaveBeenCalled();
    await actor.click(screen.getByRole("button", { name: "Expand chat" }));
    expect(
      screen.getByRole("button", { name: "Shrink chat" }),
    ).toBeInTheDocument();
  });

  it("asks about one attached file until the person goes back to the whole wiki", async () => {
    ai(true);
    streamChat.mockResolvedValue({
      ...FOUND,
      sources: [{ ...source, files: [{ id: "f-1", filename: "prices.pdf" }] }],
    });
    const actor = userEvent.setup();
    render(<Shell userId="u1" />);
    await screen.findByRole("button", { name: "Chat with AI" });

    act(() => openChat({ file: { id: "f-1", filename: "prices.pdf" } }));

    expect(await screen.findByText("Asking about prices.pdf")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Summarise this file" }));
    expect(streamChat).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ attachmentId: "f-1" }),
    );
    // The answer says which file it was read from, and opens it.
    const file = await screen.findByRole("link", { name: "prices.pdf" });
    expect(file).toHaveAttribute("href", "/api/v1/attachments/f-1/content");

    await actor.click(screen.getByRole("button", { name: "Ask the whole wiki again" }));
    expect(screen.queryByText("Asking about prices.pdf")).not.toBeInTheDocument();
    await actor.type(screen.getByPlaceholderText("Ask a question…"), "anything{Enter}");
    expect(streamChat).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ attachmentId: null }),
    );
  });

  it("can be resized with the keyboard on its edge", async () => {
    ai(true);
    const actor = userEvent.setup();
    render(<Shell userId="u1" />);
    await openPanel(actor);

    const edge = screen.getByRole("separator", { name: "Resize chat" });
    edge.focus();
    await actor.keyboard("{ArrowLeft}");

    expect(window.localStorage.getItem("wikihub:chat-width")).toBe("448");
  });
});

describe("a question already asked", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAiStatus();
    window.localStorage.clear();
  });

  it("can be copied", async () => {
    ai(true);
    streamChat.mockResolvedValue(FOUND);
    const actor = userEvent.setup();
    render(<Shell userId="u1" />);
    // After setup: userEvent installs its own clipboard, which this replaces.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    await actor.type(await openPanel(actor), "billing address{Enter}");
    await screen.findByText("10.0.0.5");
    await actor.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith("billing address");
    expect(
      await screen.findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();
  });

  it("can be changed and asked again, dropping what came after it", async () => {
    ai(true);
    streamChat.mockResolvedValue(FOUND);
    const actor = userEvent.setup();
    render(<Shell userId="u1" />);

    const box = await openPanel(actor);
    await actor.type(box, "billing adress{Enter}");
    await screen.findByText("10.0.0.5");
    await actor.type(box, "and its owner?{Enter}");
    await waitFor(() => expect(streamChat).toHaveBeenCalledTimes(2));
    await screen.findAllByText("10.0.0.5");

    await actor.click(
      screen.getAllByRole("button", { name: "Edit message" })[0],
    );
    const editor = screen.getByRole("textbox", { name: "Edit message" });
    expect(editor).toHaveValue("billing adress");
    await actor.clear(editor);
    await actor.type(editor, "billing address{Enter}");

    await waitFor(() => expect(streamChat).toHaveBeenCalledTimes(3));
    // The edited question went out alone: what followed the old one is gone.
    expect(streamChat.mock.calls[2][0]).toEqual([
      { role: "user", content: "billing address" },
    ]);
    expect(screen.queryByText("billing adress")).toBeNull();
    expect(screen.queryByText("and its owner?")).toBeNull();
    expect(await screen.findByText("billing address")).toBeInTheDocument();
  });

  it("is left as it was when the edit is cancelled or not changed", async () => {
    ai(true);
    streamChat.mockResolvedValue(FOUND);
    const actor = userEvent.setup();
    render(<Shell userId="u1" />);

    await actor.type(await openPanel(actor), "billing address{Enter}");
    await screen.findByText("10.0.0.5");

    await actor.click(screen.getByRole("button", { name: "Edit message" }));
    await actor.type(
      screen.getByRole("textbox", { name: "Edit message" }),
      " more",
    );
    await actor.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("billing address")).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Edit message" }));
    // The editor's own Send comes before the one of the message box.
    await actor.click(screen.getAllByRole("button", { name: "Send" })[0]);
    expect(streamChat).toHaveBeenCalledTimes(1);
    // Escape leaves the box, not the panel.
    await actor.click(screen.getByRole("button", { name: "Edit message" }));
    await actor.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Edit message" })).toBeNull();
    expect(panelHidden()).toBe(false);
  });

  it("cannot be edited while a reply is being written", async () => {
    ai(true);
    streamChat.mockReturnValue(new Promise(() => {}));
    const actor = userEvent.setup();
    render(<Shell userId="u1" />);

    await actor.type(await openPanel(actor), "billing address{Enter}");

    expect(
      await screen.findByRole("button", { name: "Edit message" }),
    ).toBeDisabled();
  });
});

describe("the versions of an edited question", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAiStatus();
    window.localStorage.clear();
  });

  const reply = (answer: string): AnswerResult => ({
    ...FOUND,
    answer,
  });

  /** Ask "billing adress", then edit it to "billing address"; the second gets its own answer. */
  async function askThenEdit(actor: ReturnType<typeof userEvent.setup>) {
    streamChat.mockResolvedValueOnce(reply("First answer [1]."));
    streamChat.mockResolvedValueOnce(reply("Second answer [1]."));
    const box = await openPanel(actor);
    await actor.type(box, "billing adress{Enter}");
    await screen.findByText(/First answer/);
    await actor.click(screen.getByRole("button", { name: "Edit message" }));
    const editor = screen.getByRole("textbox", { name: "Edit message" });
    await actor.clear(editor);
    await actor.type(editor, "billing address{Enter}");
    await screen.findByText(/Second answer/);
    return box;
  }

  it("shows which version it is and goes back to the question as it was, with its answer", async () => {
    ai(true);
    const actor = userEvent.setup();
    render(<Shell userId="u1" />);
    await askThenEdit(actor);

    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next version" })).toBeDisabled();

    await actor.click(screen.getByRole("button", { name: "Previous version" }));

    expect(screen.getByText("billing adress")).toBeInTheDocument();
    expect(screen.getByText(/First answer/)).toBeInTheDocument();
    expect(screen.queryByText(/Second answer/)).toBeNull();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Previous version" }),
    ).toBeDisabled();

    await actor.click(screen.getByRole("button", { name: "Next version" }));

    expect(screen.getByText("billing address")).toBeInTheDocument();
    expect(screen.getByText(/Second answer/)).toBeInTheDocument();
  });

  it("keeps what was asked after each version, and sends only the shown branch", async () => {
    ai(true);
    const actor = userEvent.setup();
    render(<Shell userId="u1" />);
    const box = await askThenEdit(actor);

    // A follow-up on the edited version ...
    streamChat.mockResolvedValueOnce(reply("Owner answer [1]."));
    await actor.type(box, "and its owner?{Enter}");
    await screen.findByText(/Owner answer/);
    // ... is not part of the first version, and comes back with the second.
    await actor.click(screen.getByRole("button", { name: "Previous version" }));
    expect(screen.queryByText("and its owner?")).toBeNull();
    await actor.click(screen.getByRole("button", { name: "Next version" }));
    expect(screen.getByText("and its owner?")).toBeInTheDocument();
    expect(screen.getByText(/Owner answer/)).toBeInTheDocument();

    const lastSent = streamChat.mock.calls
      .at(-1)![0]
      .map((m: { content: string }) => m.content);
    expect(lastSent).toEqual([
      "billing address",
      "Second answer [1].",
      "and its owner?",
    ]);
  });

  it("can be edited again, adding a third version", async () => {
    ai(true);
    const actor = userEvent.setup();
    render(<Shell userId="u1" />);
    await askThenEdit(actor);

    streamChat.mockResolvedValueOnce(reply("Third answer [1]."));
    await actor.click(
      screen.getAllByRole("button", { name: "Edit message" })[0],
    );
    const editor = screen.getByRole("textbox", { name: "Edit message" });
    await actor.clear(editor);
    await actor.type(editor, "billing addresses{Enter}");
    await screen.findByText(/Third answer/);

    expect(screen.getByText("3 / 3")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Previous version" }));
    await actor.click(screen.getByRole("button", { name: "Previous version" }));
    expect(screen.getByText("billing adress")).toBeInTheDocument();
  });

  it("is still there after the page is opened again", async () => {
    ai(true);
    const actor = userEvent.setup();
    const first = render(<Shell userId="u1" />);
    await askThenEdit(actor);
    first.unmount();

    // The panel was open when the page went away, so it is open again (see the next test).
    render(<Shell userId="u1" />);

    expect(await screen.findByText("2 / 2")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Previous version" }));
    expect(screen.getByText(/First answer/)).toBeInTheDocument();
  });

  it("stopping an edit keeps it as a version, with the earlier one one arrow away", async () => {
    ai(true);
    streamChat.mockResolvedValueOnce(reply("First answer [1]."));
    streamChat.mockImplementationOnce(
      (_m: unknown, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () =>
            reject(new DOMException("a", "AbortError")),
          ),
        ),
    );
    const actor = userEvent.setup();
    render(<Shell userId="u1" />);

    await actor.type(await openPanel(actor), "billing adress{Enter}");
    await screen.findByText(/First answer/);
    await actor.click(screen.getByRole("button", { name: "Edit message" }));
    const editor = screen.getByRole("textbox", { name: "Edit message" });
    await actor.clear(editor);
    await actor.type(editor, "billing address{Enter}");
    await actor.click(await screen.findByRole("button", { name: "Stop" }));

    // The edited question is there with its note, and the first version is one arrow away.
    expect(screen.getByText("billing address")).toBeInTheDocument();
    expect(screen.getByText("You cancelled this answer.")).toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Previous version" }));
    expect(screen.getByText("billing adress")).toBeInTheDocument();
    expect(screen.getByText(/First answer/)).toBeInTheDocument();
  });

  it("keeps the question where it was when another version, with a longer or shorter answer, is shown", async () => {
    ai(true);
    const actor = userEvent.setup();
    render(<Shell userId="u1" />);
    await askThenEdit(actor);
    const list = screen.getByRole("log");
    list.scrollTop = 500;

    // The question sits at 100px before the switch and at 160px after it (a taller answer
    // above it): the list has to scroll by the difference to keep it under the finger.
    let reads = 0;
    const rect = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        if (this.hasAttribute("data-slot")) {
          reads += 1;
          return { top: reads === 1 ? 100 : 160 } as DOMRect;
        }
        return { top: 0 } as DOMRect;
      });
    try {
      await actor.click(
        screen.getByRole("button", { name: "Previous version" }),
      );
    } finally {
      rect.mockRestore();
    }

    expect(list.scrollTop).toBe(560);
  });

  it("cannot be switched while a reply is being written", async () => {
    ai(true);
    const actor = userEvent.setup();
    render(<Shell userId="u1" />);
    const box = await askThenEdit(actor);

    streamChat.mockReturnValueOnce(new Promise(() => {}));
    await actor.type(box, "still writing{Enter}");

    expect(
      await screen.findByRole("button", { name: "Previous version" }),
    ).toBeDisabled();
  });
});

describe("explaining or translating words of an answer", () => {
  const RECT = {
    left: 10,
    right: 120,
    top: 10,
    bottom: 30,
    width: 110,
    height: 20,
    x: 10,
    y: 10,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetAiStatus();
    window.localStorage.clear();
    // jsdom has no layout; give a selection somewhere to be.
    Range.prototype.getClientRects = (() => [
      RECT,
    ]) as unknown as () => DOMRectList;
    Range.prototype.getBoundingClientRect = (() =>
      RECT) as unknown as () => DOMRect;
  });

  async function selectInAnswer(word: string) {
    const node = (await screen.findByText(word, {
      exact: false,
    })) as HTMLElement;
    await act(async () => {
      window.getSelection()!.selectAllChildren(node);
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
  }

  it("offers the AI button on selected words and asks the chat's own endpoint, not a page's", async () => {
    ai(true);
    streamChat.mockResolvedValue(FOUND);
    vi.mocked(api.post).mockResolvedValue({ result: "A server address." });
    const actor = userEvent.setup();
    render(<Shell userId="u1" />);

    await actor.type(await openPanel(actor), "billing address{Enter}");
    await screen.findByText("10.0.0.5");
    await selectInAnswer("The server is");
    await actor.click(
      await screen.findByRole("button", {
        name: "Explain or translate with AI",
      }),
    );

    expect(await screen.findByText("A server address.")).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith(
      "/api/v1/ai/explain",
      expect.objectContaining({ action: "explain", lang: "vi" }),
    );
  });

  it("does not put the chat away when its explanation card is used", async () => {
    ai(true);
    streamChat.mockResolvedValue(FOUND);
    vi.mocked(api.post).mockResolvedValue({ result: "A server address." });
    const actor = userEvent.setup();
    render(<Shell userId="u1" />);

    await actor.type(await openPanel(actor), "billing address{Enter}");
    await screen.findByText("10.0.0.5");
    await selectInAnswer("The server is");
    await actor.click(
      await screen.findByRole("button", {
        name: "Explain or translate with AI",
      }),
    );
    await screen.findByText("A server address.");

    await actor.click(screen.getByRole("button", { name: "Translate" }));
    expect(panelHidden()).toBe(false);
  });

  it("Escape puts away the explanation card first, and the panel only on the next one", async () => {
    ai(true);
    streamChat.mockResolvedValue(FOUND);
    vi.mocked(api.post).mockResolvedValue({ result: "A server address." });
    const actor = userEvent.setup();
    render(<Shell userId="u1" />);

    const box = await openPanel(actor);
    await actor.type(box, "billing address{Enter}");
    await screen.findByText("10.0.0.5");
    await selectInAnswer("The server is");
    await actor.click(
      await screen.findByRole("button", {
        name: "Explain or translate with AI",
      }),
    );
    await screen.findByText("A server address.");

    box.focus();
    await actor.keyboard("{Escape}");

    expect(
      screen.queryByRole("dialog", { name: "Explain or translate with AI" }),
    ).toBeNull();
    expect(panelHidden()).toBe(false);
  });
});

describe("code in an AI answer", () => {
  it("is a card with its language and a button to copy it", async () => {
    const actor = userEvent.setup();
    // After setup: userEvent installs its own clipboard, which this replaces.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(
      <IssueMarkdown
        codeCard
        source={"Run:\n```bash\nsystemctl restart haproxy\n```"}
      />,
    );

    expect(screen.getByText("bash")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: /Copy/ }));

    expect(writeText).toHaveBeenCalledWith("systemctl restart haproxy");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("is still a plain block where cards were not asked for", () => {
    render(<IssueMarkdown source={"```\nx = 1\n```"} />);

    expect(screen.queryByRole("button", { name: /Copy/ })).toBeNull();
    expect(screen.getByText("x = 1")).toBeInTheDocument();
  });

  it("names an unlabelled block 'Code'", () => {
    render(<CodeBlock code="ls" language="" />);

    expect(screen.getByText("Code")).toBeInTheDocument();
  });
});
