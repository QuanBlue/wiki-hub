import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SearchModal } from "@/components/layout/search-modal";
import type { AnswerResult } from "@/lib/ai-answer";
import { resetAiStatus } from "@/lib/ai-summary";
import { api, ApiError } from "@/lib/api-client";
import type { SearchResults } from "@/types/api";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@/components/layout/navigation-progress", () => ({
  useNavigate: () => navigate,
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

const mocked = vi.mocked(api);

const RESULTS: SearchResults = {
  query: "billing",
  spaces: [],
  pages: [
    {
      id: "p1",
      title: "Billing server",
      slug: "billing-server",
      space_key: "OPS",
      space_name: "Operations",
      snippet: "The billing server is 10.0.0.5",
      updated_at: null,
    },
  ],
};

function source(n: number, title: string) {
  return {
    n,
    id: `id-${n}`,
    title,
    slug: title.toLowerCase().replaceAll(" ", "-"),
    space_key: "OPS",
    space_name: "Operations",
    excerpt: `Excerpt of ${title}`,
  };
}

const FOUND: AnswerResult = {
  found: true,
  answer: "The server is **10.0.0.5** [1] and it restarts nightly [2].",
  reason: "",
  sources: [source(1, "Billing server"), source(2, "Nightly jobs")],
  related: [source(3, "Holiday policy")],
  cached: false,
};

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <span data-testid="state">{open ? "open" : "closed"}</span>
      <SearchModal open={open} onOpenChange={setOpen} />
    </>
  );
}

/** Answer each path: the AI status, a search, and the answer itself. */
function serve(
  options: { ai?: boolean; answer?: () => Promise<AnswerResult> } = {},
) {
  mocked.get.mockImplementation(async (path: string) => {
    if (path === "/api/v1/ai/status")
      return { enabled: options.ai ?? true, can_configure: false };
    return RESULTS;
  });
  mocked.post.mockImplementation(async (path: string) => {
    if (path === "/api/v1/ai/answer")
      return (options.answer ?? (async () => FOUND))();
    throw new Error(`unexpected POST ${path}`);
  });
}

async function typeQuestion(text = "billing server address") {
  const actor = userEvent.setup();
  render(<Harness />);
  await actor.type(screen.getByPlaceholderText("Search WikiHub..."), text);
  return actor;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAiStatus();
  Element.prototype.scrollIntoView = vi.fn();
});

describe("asking the AI from the search box", () => {
  it("offers an Ask AI row once there is a question, and only when the assistant is on", async () => {
    serve({ ai: true });
    await typeQuestion();

    expect(
      await screen.findByRole("button", {
        name: /Ask AI: billing server address/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("to ask AI")).toBeInTheDocument();
  });

  it("shows no Ask AI row when the assistant is not set up", async () => {
    serve({ ai: false });
    await typeQuestion();

    await screen.findByText("Pages (1)");
    expect(screen.queryByRole("button", { name: /Ask AI/ })).toBeNull();
    expect(screen.queryByText("to ask AI")).toBeNull();
  });

  it("shows no Ask AI row for a single character", async () => {
    serve();
    await typeQuestion("b");

    await waitFor(() =>
      expect(mocked.get).toHaveBeenCalledWith("/api/v1/ai/status"),
    );
    expect(screen.queryByRole("button", { name: /Ask AI/ })).toBeNull();
  });

  it("sends the question in the body, shows the answer with its sources, and a mark opens its page", async () => {
    serve();
    const actor = await typeQuestion();

    await actor.click(
      await screen.findByRole("button", {
        name: /Ask AI: billing server address/,
      }),
    );

    expect(await screen.findByText("AI answer")).toBeInTheDocument();
    expect(mocked.post).toHaveBeenCalledWith("/api/v1/ai/answer", {
      query: "billing server address",
    });
    expect(screen.getByText("10.0.0.5").tagName).toBe("STRONG");
    const sources = within(screen.getByRole("region", { name: "Sources" }));
    expect(sources.getByText("Billing server")).toBeInTheDocument();
    // One short row per source; what was read from the page is its tooltip.
    expect(sources.getByText("Nightly jobs").closest("button")).toHaveAttribute(
      "title",
      "Excerpt of Nightly jobs",
    );
    expect(sources.queryByText("Excerpt of Nightly jobs")).toBeNull();
    // Pages that were only read are folded away, so they cannot be taken for sources.
    const alsoRead = screen.getByRole("button", { name: /Also read \(1\)/ });
    expect(alsoRead).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Holiday policy")).toBeNull();
    await actor.click(alsoRead);
    expect(alsoRead).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Holiday policy")).toBeInTheDocument();
    expect(screen.getByText(/AI can make mistakes/)).toBeInTheDocument();

    // The [2] mark in the answer opens the second source.
    const marks = screen.getAllByRole("button", { name: /^[12]$/ });
    await actor.click(marks[1]!);
    expect(navigate).toHaveBeenCalledWith("/spaces/OPS/pages/nightly-jobs");
    expect(screen.getByTestId("state")).toHaveTextContent("closed");
  });

  it("asks with Ctrl+Enter, while plain Enter still opens the highlighted result", async () => {
    serve();
    const actor = await typeQuestion();
    await screen.findByText("Pages (1)");

    await actor.keyboard("{Control>}{Enter}{/Control}");
    expect(await screen.findByText("AI answer")).toBeInTheDocument();
    expect(mocked.post).toHaveBeenCalledTimes(1);

    // Back to the results, where Enter opens the first page as before.
    await actor.keyboard("{Escape}");
    expect(await screen.findByText("Pages (1)")).toBeInTheDocument();
    await actor.keyboard("{Enter}");
    expect(navigate).toHaveBeenCalledWith("/spaces/OPS/pages/billing-server");
  });

  it("goes back to the results with the button or Escape, and Escape then closes the search", async () => {
    serve();
    const actor = await typeQuestion();
    await actor.click(await screen.findByRole("button", { name: /Ask AI/ }));
    await screen.findByText("AI answer");

    await actor.click(screen.getByRole("button", { name: "Results" }));
    expect(await screen.findByText("Pages (1)")).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: /Ask AI/ }));
    await screen.findByText("AI answer");
    await actor.keyboard("{Escape}");
    expect(await screen.findByText("Pages (1)")).toBeInTheDocument();
    expect(screen.getByTestId("state")).toHaveTextContent("open");
    await actor.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("closed"),
    );
  });

  it("shows a progress state, and says when it is slow", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let finish: (value: AnswerResult) => void = () => {};
      serve({
        answer: () =>
          new Promise<AnswerResult>((resolve) => (finish = resolve)),
      });
      const actor = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<Harness />);
      await actor.type(
        screen.getByPlaceholderText("Search WikiHub..."),
        "billing server address",
      );
      await actor.click(await screen.findByRole("button", { name: /Ask AI/ }));

      expect(
        await screen.findByText("Reading your pages…"),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Still working/)).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6500);
      });
      expect(screen.getByText(/Still working/)).toBeInTheDocument();

      await act(async () => finish(FOUND));
      expect(await screen.findByText("AI answer")).toBeInTheDocument();
      expect(screen.queryByText("Reading your pages…")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says plainly when the wiki has no answer, and offers the pages that may help", async () => {
    serve({
      answer: async () => ({
        found: false,
        answer: "",
        reason: "not_in_pages",
        sources: [],
        related: [source(1, "Billing runbook")],
        cached: false,
      }),
    });
    const actor = await typeQuestion();

    await actor.click(await screen.findByRole("button", { name: /Ask AI/ }));

    expect(
      await screen.findByText(
        "The pages found do not contain an answer to this.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("AI answer")).toBeNull();
    await actor.click(
      within(
        screen.getByRole("region", { name: "These pages may help" }),
      ).getByText("Billing runbook"),
    );
    expect(navigate).toHaveBeenCalledWith("/spaces/OPS/pages/billing-runbook");
  });

  it.each([
    ["no_match", "No page in the wiki mentions this."],
    [
      "ungrounded",
      "An answer could not be backed by your pages, so none is shown.",
    ],
  ])("explains a %s result in words", async (reason, words) => {
    serve({
      answer: async () => ({
        found: false,
        answer: "",
        reason,
        sources: [],
        related: [],
        cached: false,
      }),
    });
    const actor = await typeQuestion();

    await actor.click(await screen.findByRole("button", { name: /Ask AI/ }));

    expect(await screen.findByText(words)).toBeInTheDocument();
  });

  it.each([
    [
      429,
      "You have asked a lot in a short time. Please wait a moment and try again.",
    ],
    [503, "The AI assistant is not available right now."],
    [500, "The answer could not be written. Please try again."],
  ])("reports a %s failure and can try again", async (status, words) => {
    let calls = 0;
    serve({
      answer: async () => {
        calls += 1;
        if (calls === 1) throw new ApiError(status, "x", "failed");
        return FOUND;
      },
    });
    const actor = await typeQuestion();

    await actor.click(await screen.findByRole("button", { name: /Ask AI/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(words);

    await actor.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("AI answer")).toBeInTheDocument();
  });

  it("drops an answer that arrives after the question was changed", async () => {
    let finish: (value: AnswerResult) => void = () => {};
    serve({
      answer: () => new Promise<AnswerResult>((resolve) => (finish = resolve)),
    });
    const actor = await typeQuestion();
    await actor.click(await screen.findByRole("button", { name: /Ask AI/ }));
    await screen.findByText("Reading your pages…");

    // Editing the question leaves the answer view; the late answer must not bring it back.
    await actor.type(screen.getByPlaceholderText("Search WikiHub..."), " now");
    await act(async () => finish(FOUND));

    expect(screen.queryByText("AI answer")).toBeNull();
    expect(await screen.findByText("Pages (1)")).toBeInTheDocument();
  });

  it("forgets the answer when the search is closed", async () => {
    serve();
    const actor = await typeQuestion();
    await actor.click(await screen.findByRole("button", { name: /Ask AI/ }));
    await screen.findByText("AI answer");

    await actor.keyboard("{Escape}{Escape}");
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("closed"),
    );

    expect(screen.queryByText("AI answer")).toBeNull();
  });

  it("never spins forever: a question that gets no reply is given up on, with a way to try again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let calls = 0;
      serve({
        answer: () => {
          calls += 1;
          // The first try never comes back; the second answers.
          return calls === 1
            ? new Promise<AnswerResult>(() => {})
            : Promise.resolve(FOUND);
        },
      });
      const actor = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<Harness />);
      await actor.type(
        screen.getByPlaceholderText("Search WikiHub..."),
        "billing server address",
      );
      await actor.click(await screen.findByRole("button", { name: /Ask AI/ }));
      expect(
        await screen.findByText("Reading your pages…"),
      ).toBeInTheDocument();

      // After twenty seconds the panel spells out the way out.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(21_000);
      });
      expect(
        screen.getByText(/The AI service is slow right now/),
      ).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The AI is taking too long. Please try again in a moment.",
      );
      expect(screen.queryByText("Reading your pages…")).toBeNull();

      await actor.click(screen.getByRole("button", { name: "Try again" }));
      expect(await screen.findByText("AI answer")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps account names with underscores as written, not as italics", async () => {
    serve({
      answer: async () => ({
        ...FOUND,
        answer: "Account nutifood_vts/[hidden] and NUTIFOOD_VTS/[hidden] [1]",
      }),
    });
    const actor = await typeQuestion();

    await actor.click(await screen.findByRole("button", { name: /Ask AI/ }));

    expect(
      await screen.findByText(
        /nutifood_vts\/\[hidden\] and NUTIFOOD_VTS\/\[hidden\]/,
      ),
    ).toBeInTheDocument();
    expect(document.querySelector("em")).toBeNull();
  });

  it("lists no Also read section when every page read was cited", async () => {
    serve({ answer: async () => ({ ...FOUND, related: [] }) });
    const actor = await typeQuestion();

    await actor.click(await screen.findByRole("button", { name: /Ask AI/ }));

    await screen.findByText("AI answer");
    expect(screen.queryByText(/Also read/)).toBeNull();
  });

  it("carries the answer on in the chat, and closes the search box", async () => {
    serve();
    const heard: Array<{ question?: string; found?: boolean }> = [];
    const listener = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      heard.push({ question: detail.question, found: detail.result?.found });
    };
    window.addEventListener("wikihub:chat-open", listener);
    try {
      const actor = await typeQuestion();
      await actor.click(await screen.findByRole("button", { name: /Ask AI/ }));
      await screen.findByText("AI answer");

      await actor.click(
        screen.getByRole("button", { name: "Continue in chat" }),
      );

      expect(heard).toEqual([
        { question: "billing server address", found: true },
      ]);
      expect(screen.getByTestId("state")).toHaveTextContent("closed");
    } finally {
      window.removeEventListener("wikihub:chat-open", listener);
    }
  });
});
