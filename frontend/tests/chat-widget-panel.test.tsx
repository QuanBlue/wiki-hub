import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatTopBarButton } from "@/components/chat/chat-top-bar-button";
import { ChatWidget } from "@/components/chat/chat-widget";
import type { AnswerResult } from "@/lib/ai-answer";
import { ChatStreamError } from "@/lib/ai-chat";
import { resetAiStatus } from "@/lib/ai-summary";
import { api } from "@/lib/api-client";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
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

function Shell() {
  return (
    <>
      <ChatTopBarButton />
      <ChatWidget userId="u1" />
    </>
  );
}

async function openPanel(actor: ReturnType<typeof userEvent.setup>) {
  await actor.click(
    await screen.findByRole("button", { name: "Chat with AI" }),
  );
  return screen.findByPlaceholderText("Ask a question…");
}

const panel = () => document.getElementById("wikihub-chat-panel")!;

beforeEach(() => {
  vi.clearAllMocks();
  resetAiStatus();
  window.localStorage.clear();
  vi.mocked(api.get).mockResolvedValue({ enabled: true, can_configure: false });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the width of the panel", () => {
  it("falls back to the default when the remembered width is unreadable or too small", async () => {
    window.localStorage.setItem("wikihub:chat-width", "12");
    const actor = userEvent.setup();
    const first = render(<Shell />);
    await openPanel(actor);
    expect(panel().style.getPropertyValue("--chat-width")).toBe("416px");
    first.unmount();

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<Shell />);
    await openPanel(actor);
    expect(panel().style.getPropertyValue("--chat-width")).toBe("416px");
  });

  it("keeps working when the chosen width cannot be remembered", async () => {
    const actor = userEvent.setup();
    render(<Shell />);
    await openPanel(actor);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });

    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowLeft" });

    expect(panel().style.getPropertyValue("--chat-width")).toBe("448px");
  });

  it("is dragged by its left edge, narrower and wider, to the whole page, and not below a minimum", async () => {
    const actor = userEvent.setup();
    render(<Shell />);
    await openPanel(actor);
    const edge = screen.getByRole("separator");
    Object.defineProperty(window, "innerWidth", {
      value: 1200,
      configurable: true,
    });

    fireEvent.pointerDown(edge);
    fireEvent(window, new MouseEvent("pointermove", { clientX: 700 }));
    await waitFor(() =>
      expect(panel().style.getPropertyValue("--chat-width")).toBe("500px"),
    );
    fireEvent(window, new MouseEvent("pointermove", { clientX: 1100 }));
    await waitFor(() =>
      expect(panel().style.getPropertyValue("--chat-width")).toBe("320px"),
    );
    fireEvent(window, new MouseEvent("pointermove", { clientX: 5 }));
    await waitFor(() => expect(panel().className).toContain("sm:w-full"));
    expect(document.body.style.cursor).toBe("col-resize");

    fireEvent(window, new MouseEvent("pointerup"));
    await waitFor(() => expect(document.body.style.cursor).toBe(""));
  });

  it("goes back to the default width on a double click, and takes the arrow keys in both directions", async () => {
    const actor = userEvent.setup();
    render(<Shell />);
    await openPanel(actor);
    const edge = screen.getByRole("separator");

    fireEvent.keyDown(edge, { key: "ArrowLeft" });
    fireEvent.keyDown(edge, { key: "ArrowLeft" });
    expect(panel().style.getPropertyValue("--chat-width")).toBe("480px");
    fireEvent.keyDown(edge, { key: "ArrowRight" });
    expect(panel().style.getPropertyValue("--chat-width")).toBe("448px");
    fireEvent.keyDown(edge, { key: "a" }); // not an arrow: left alone
    expect(panel().style.getPropertyValue("--chat-width")).toBe("448px");

    fireEvent.doubleClick(edge);
    expect(panel().style.getPropertyValue("--chat-width")).toBe("416px");

    // Wide enough with the arrows becomes the whole page.
    Object.defineProperty(window, "innerWidth", {
      value: 450,
      configurable: true,
    });
    fireEvent.keyDown(edge, { key: "ArrowLeft" });
    expect(panel().className).toContain("sm:w-full");
    fireEvent.keyDown(edge, { key: "ArrowRight" });
    expect(panel().className).not.toContain("sm:w-full");
  });
});

describe("replies that did not come as a plain answer", () => {
  it("says how long a reply is taking, then that it is slow", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    streamChat.mockReturnValue(new Promise(() => {}));
    const actor = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Shell />);

    await actor.type(await openPanel(actor), "billing{Enter}");
    expect(await screen.findByText("Reading your pages…")).toBeInTheDocument();
    await act(async () => void (await vi.advanceTimersByTimeAsync(7_000)));
    expect(screen.getByText(/Still working/)).toBeInTheDocument();
    await act(async () => void (await vi.advanceTimersByTimeAsync(15_000)));
    expect(
      screen.getByText(/The AI service is slow right now/),
    ).toBeInTheDocument();
  });

  it("offers Try again only on the last reply, not on one the conversation has moved past", async () => {
    streamChat.mockRejectedValueOnce(new ChatStreamError("timeout"));
    streamChat.mockResolvedValueOnce(FOUND);
    const actor = userEvent.setup();
    render(<Shell />);

    const box = await openPanel(actor);
    await actor.type(box, "first{Enter}");
    expect(
      await screen.findByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    await actor.type(box, "second{Enter}");
    await screen.findByText("10.0.0.5");

    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByText(/taking too long/)).toBeInTheDocument();
  });

  it("lists the pages that may help when nothing answers", async () => {
    streamChat.mockResolvedValue({
      found: false,
      answer: "",
      reason: "no_match",
      sources: [],
      related: [source],
      cached: false,
    } satisfies AnswerResult);
    const actor = userEvent.setup();
    render(<Shell />);

    await actor.type(await openPanel(actor), "billing{Enter}");
    await actor.click(
      await screen.findByRole("button", { name: /Billing server/ }),
    );

    expect(
      screen.getByText("No page in the wiki mentions this."),
    ).toBeInTheDocument();
    expect(push).toHaveBeenCalledWith("/spaces/OPS/pages/billing-server");
  });

  it("an unknown reason for no answer still gets the general sentence", async () => {
    streamChat.mockResolvedValue({
      found: false,
      answer: "",
      reason: "something_new",
      sources: [],
      related: [],
      cached: false,
    } satisfies AnswerResult);
    const actor = userEvent.setup();
    render(<Shell />);

    await actor.type(await openPanel(actor), "billing{Enter}");

    expect(
      await screen.findByText(
        "The pages found do not contain an answer to this.",
      ),
    ).toBeInTheDocument();
  });

  it("a [1] mark opens the wiki page; a mark to nothing does nothing", async () => {
    streamChat.mockResolvedValue({
      ...FOUND,
      answer: "Here [1] and there [2].",
      web_sources: [],
    });
    const actor = userEvent.setup();
    render(<Shell />);

    await actor.type(await openPanel(actor), "billing{Enter}");
    await actor.click(await screen.findByRole("button", { name: "1" }));
    expect(push).toHaveBeenCalledWith("/spaces/OPS/pages/billing-server");
    push.mockClear();
    await actor.click(screen.getByRole("button", { name: "2" }));
    expect(push).not.toHaveBeenCalled();
  });

  it("a mark to a web page that is not listed does nothing", async () => {
    streamChat.mockResolvedValue({
      ...FOUND,
      answer: "Open it [w3].",
      sources: [],
      basis: "web",
      web_sources: [],
    });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const actor = userEvent.setup();
    render(<Shell />);

    await actor.type(await openPanel(actor), "billing{Enter}");
    await actor.click(await screen.findByRole("button", { name: "w3" }));

    expect(open).not.toHaveBeenCalled();
  });
});

describe("copying a question", () => {
  it("does not claim to have copied when the browser refuses", async () => {
    streamChat.mockResolvedValue(FOUND);
    const actor = userEvent.setup();
    render(<Shell />);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });

    await actor.type(await openPanel(actor), "billing{Enter}");
    await screen.findByText("10.0.0.5");
    await actor.click(screen.getByRole("button", { name: "Copy" }));

    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });
});

describe("following the conversation", () => {
  it("shows a button to jump to the latest message once scrolled up, and jumps", async () => {
    streamChat.mockResolvedValue(FOUND);
    const actor = userEvent.setup();
    render(<Shell />);
    await actor.type(await openPanel(actor), "billing{Enter}");
    await screen.findByText("10.0.0.5");
    const log = screen.getByRole("log");
    const scrollTo = vi.fn();
    log.scrollTo = scrollTo as unknown as typeof log.scrollTo;
    Object.defineProperty(log, "scrollHeight", {
      value: 2000,
      configurable: true,
    });
    Object.defineProperty(log, "clientHeight", {
      value: 400,
      configurable: true,
    });

    log.scrollTop = 100;
    fireEvent.scroll(log);
    await actor.click(
      await screen.findByRole("button", {
        name: "Scroll to the latest message",
      }),
    );

    expect(scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: "smooth" });
    expect(
      screen.queryByRole("button", { name: "Scroll to the latest message" }),
    ).toBeNull();

    log.scrollTop = 1600;
    fireEvent.scroll(log);
    expect(
      screen.queryByRole("button", { name: "Scroll to the latest message" }),
    ).toBeNull();
  });

  it("sends with the Send button as well as with Enter", async () => {
    streamChat.mockResolvedValue(FOUND);
    const actor = userEvent.setup();
    render(<Shell />);

    await actor.type(await openPanel(actor), "billing address");
    await actor.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("10.0.0.5")).toBeInTheDocument();
    expect(streamChat).toHaveBeenCalledTimes(1);
  });
});

describe("Escape", () => {
  it("puts the panel away while the focus is in it, and leaves it alone elsewhere", async () => {
    const actor = userEvent.setup();
    render(
      <>
        <button type="button">elsewhere</button>
        <Shell />
      </>,
    );
    const box = await openPanel(actor);

    screen.getByRole("button", { name: "elsewhere" }).focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(panel().hidden).toBe(false);

    box.focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(panel().hidden).toBe(true);
  });
});
