import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WebSearchPanel } from "@/components/admin/web-search-panel";
import { ChatTopBarButton } from "@/components/chat/chat-top-bar-button";
import { ChatWidget } from "@/components/chat/chat-widget";
import { IssueMarkdown } from "@/components/issues/issue-markdown";
import { citeLinks, type AnswerResult } from "@/lib/ai-answer";
import { parseEvents } from "@/lib/ai-chat";
import { resetAiStatus } from "@/lib/ai-summary";
import { api } from "@/lib/api-client";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const streamChat = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-chat")>()),
  streamChat,
}));

const WEB: AnswerResult = {
  found: true,
  answer: "Reload keeps connections open [w1].",
  reason: "",
  sources: [],
  related: [],
  cached: false,
  basis: "web",
  web_sources: [
    {
      n: 1,
      title: "HAProxy docs",
      url: "https://docs.haproxy.org/reload",
      host: "docs.haproxy.org",
      snippet: "Reload is graceful.",
    },
  ],
};

async function ask(question: string) {
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
  await actor.type(
    await screen.findByPlaceholderText("Ask a question…"),
    `${question}{Enter}`,
  );
  return actor;
}

describe("an answer from the internet or from general knowledge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAiStatus();
    window.localStorage.clear();
  });

  it("lists the web pages it used, each opening in a new tab", async () => {
    streamChat.mockResolvedValue(WEB);
    await ask("haproxy reload vs restart");

    const link = await screen.findByRole("link", { name: /HAProxy docs/ });
    expect(link).toHaveAttribute("href", "https://docs.haproxy.org/reload");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText("From the web")).toBeInTheDocument();
  });

  it("a [w1] mark in the text opens that web page, not a wiki page", async () => {
    streamChat.mockResolvedValue(WEB);
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const actor = await ask("haproxy reload vs restart");

    await actor.click(await screen.findByRole("button", { name: "w1" }));

    expect(open).toHaveBeenCalledWith(
      "https://docs.haproxy.org/reload",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("marks the AI's own knowledge as unchecked", async () => {
    streamChat.mockResolvedValue({
      found: true,
      answer: "A load balancer spreads requests.",
      reason: "",
      sources: [],
      related: [],
      cached: false,
      basis: "general",
      web_sources: [],
    } satisfies AnswerResult);
    await ask("what is a load balancer");

    expect(await screen.findByRole("note")).toHaveTextContent(
      "Not checked against your wiki or any web page",
    );
  });

  it("says a web search is under way, with the query that was sent", async () => {
    let finish!: (result: AnswerResult) => void;
    streamChat.mockImplementation(
      (
        _m: unknown,
        { onSearching }: { onSearching: (query: string) => void },
      ) => {
        onSearching("haproxy reload vs restart");
        return new Promise<AnswerResult>((resolve) => {
          finish = resolve;
        });
      },
    );
    await ask("haproxy reload vs restart?");

    expect(
      await screen.findByText(
        "Searching the web for “haproxy reload vs restart”…",
      ),
    ).toBeInTheDocument();
    finish(WEB);
    expect(await screen.findByText("From the web")).toBeInTheDocument();
  });

  it("says so when the web search did not work", async () => {
    streamChat.mockResolvedValue({
      found: false,
      answer: "",
      reason: "web_failed",
      sources: [],
      related: [],
      cached: false,
      basis: "wiki",
      web_sources: [],
    } satisfies AnswerResult);
    await ask("haproxy reload");

    expect(await screen.findByRole("status")).toHaveTextContent(
      /web search found nothing/,
    );
  });
});

describe("marks and events", () => {
  it("a web mark becomes a cite link and a wiki mark still does", () => {
    expect(citeLinks("a [1] b [w2]")).toBe("a [1](cite:1) b [w2](cite:w2)");
  });

  it("a web mark calls back with its number and that it is a web mark", async () => {
    const onCite = vi.fn();
    render(
      <IssueMarkdown
        source={citeLinks("Fine [w2] and [3].")}
        onCite={onCite}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "w2" }));
    await userEvent.click(screen.getByRole("button", { name: "3" }));

    expect(onCite).toHaveBeenNthCalledWith(1, 2, true);
    expect(onCite).toHaveBeenNthCalledWith(2, 3, false);
  });

  it("reads the searching event", () => {
    const { events } = parseEvents(
      'event: searching\ndata: {"type":"searching","query":"nginx tuning"}\n\n',
    );

    expect(events).toEqual([{ type: "searching", query: "nginx tuning" }]);
  });
});

describe("the web search settings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts off, saves the choice with the key, and never shows the key back", async () => {
    vi.mocked(api.get).mockResolvedValue({
      enabled: false,
      provider: "tavily",
      has_key: false,
      key_preview: "",
    });
    vi.mocked(api.put).mockResolvedValue({
      enabled: true,
      provider: "tavily",
      has_key: true,
      key_preview: "tvly-a****cdef",
    });
    const actor = userEvent.setup();
    render(<WebSearchPanel />);

    await actor.click(
      await screen.findByRole("checkbox", {
        name: /Allow the chat to search the internet/,
      }),
    );
    await actor.type(
      screen.getByLabelText("API key"),
      "tvly-abcdef0123456789abcdef",
    );
    await actor.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/api/v1/ai/web-search", {
        enabled: true,
        provider: "tavily",
        api_key: "tvly-abcdef0123456789abcdef",
      }),
    );
    // After saving the field is empty again and shows only what identifies the key.
    expect(await screen.findByPlaceholderText("tvly-a****cdef")).toHaveValue(
      "",
    );
  });

  it("tests the search with the key being typed", async () => {
    vi.mocked(api.get).mockResolvedValue({
      enabled: false,
      provider: "brave",
      has_key: false,
      key_preview: "",
    });
    vi.mocked(api.post).mockResolvedValue({
      ok: true,
      error: null,
      results: 5,
    });
    const actor = userEvent.setup();
    render(<WebSearchPanel />);

    const test = await screen.findByRole("button", { name: "Test search" });
    expect(test).toBeDisabled(); // nothing to test with yet
    await actor.type(screen.getByLabelText("API key"), "key-123");
    await actor.click(test);

    expect(await screen.findByRole("status")).toHaveTextContent("5 results");
    expect(api.post).toHaveBeenCalledWith("/api/v1/ai/web-search/test", {
      enabled: false,
      provider: "brave",
      api_key: "key-123",
    });
  });

  it("says plainly what leaves the building", async () => {
    vi.mocked(api.get).mockResolvedValue({
      enabled: false,
      provider: "tavily",
      has_key: false,
      key_preview: "",
    });
    render(<WebSearchPanel />);

    expect(await screen.findByText(/never a wiki page/)).toBeInTheDocument();
  });

  it("shows an error when the settings cannot be loaded", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("down"));
    render(<WebSearchPanel />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Could not load/,
    );
  });
});

describe("the web search settings through the AI gateway", () => {
  beforeEach(() => vi.clearAllMocks());

  it("needs no key: the key field is not shown and the search can be tested", async () => {
    vi.mocked(api.get).mockResolvedValue({
      enabled: false,
      provider: "gateway",
      has_key: false,
      key_preview: "",
    });
    vi.mocked(api.post).mockResolvedValue({
      ok: true,
      error: null,
      results: 5,
    });
    const actor = userEvent.setup();
    render(<WebSearchPanel />);

    const test = await screen.findByRole("button", { name: "Test search" });
    expect(screen.queryByLabelText("API key")).toBeNull();
    expect(screen.getByText("AI gateway (no extra key)")).toBeInTheDocument();
    expect(test).toBeEnabled();

    await actor.click(test);

    expect(await screen.findByRole("status")).toHaveTextContent("5 results");
    expect(api.post).toHaveBeenCalledWith("/api/v1/ai/web-search/test", {
      enabled: false,
      provider: "gateway",
    });
  });
});

describe("a question put back to the person", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAiStatus();
    window.localStorage.clear();
  });

  it("is shown as a plain reply, without the note about unchecked knowledge or any sources", async () => {
    streamChat.mockResolvedValue({
      found: true,
      answer: "Which city are you in?",
      reason: "",
      sources: [],
      related: [],
      cached: false,
      basis: "clarify",
      web_sources: [],
    } satisfies AnswerResult);
    await ask("what is the weather today");

    expect(
      await screen.findByText("Which city are you in?"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.queryByText("From the web")).toBeNull();
  });
});
