import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatTopBarButton } from "@/components/chat/chat-top-bar-button";
import { ChatWidget } from "@/components/chat/chat-widget";
import type { AnswerResult } from "@/lib/ai-answer";
import { resetAiStatus } from "@/lib/ai-summary";
import { api } from "@/lib/api-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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

const BASE: AnswerResult = {
  found: true,
  answer: "Done.",
  reason: "",
  sources: [],
  related: [],
  cached: false,
  basis: "app",
};

const STEP = {
  type: "create_space" as const,
  args: { key: "ABC" },
  label_en: "Create the space ABC",
  label_vi: "Tạo space ABC",
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
  const box = await screen.findByPlaceholderText("Ask a question…");
  return { actor, box };
}

describe("a proposed plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAiStatus();
    window.localStorage.clear();
  });

  it("with nothing it can do lists only what was left out, and no status", async () => {
    streamChat.mockResolvedValue({
      ...BASE,
      basis: "plan",
      answer: "That cannot be done.",
      plan: {
        steps: [],
        skipped: [
          {
            label: "Delete OPS",
            reason_en: "Not allowed",
            reason_vi: "Không được phép",
          },
        ],
      },
    });
    const { actor, box } = await open();

    await actor.type(box, "delete OPS{Enter}");

    expect(await screen.findByText(/Delete OPS/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Confirm and run/ }),
    ).toBeNull();
    expect(screen.queryByText("Create the space ABC")).toBeNull();
  });

  it("with steps and nothing left out shows no list of what was left out", async () => {
    streamChat.mockResolvedValue({
      ...BASE,
      basis: "plan",
      answer: "Here is the plan.",
      plan: { steps: [STEP], skipped: [] },
    });
    const { actor, box } = await open();

    await actor.type(box, "create a space ABC{Enter}");

    expect(await screen.findByText("Create the space ABC")).toBeInTheDocument();
    expect(screen.queryByText(/were left out/i)).toBeNull();
  });
});

describe("buttons under an answer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAiStatus();
    window.localStorage.clear();
  });

  it("an address with no icon of its own gets the arrow", async () => {
    streamChat.mockResolvedValue({
      ...BASE,
      actions: [
        {
          id: "other",
          href: "/somewhere",
          label_en: "Go there",
          label_vi: "Đến đó",
        },
      ],
    });
    const { actor, box } = await open();

    await actor.type(box, "where?{Enter}");

    expect(
      await screen.findByRole("link", { name: /Go there/ }),
    ).toHaveAttribute("href", "/somewhere");
  });
});

describe("an answer stopped part way", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAiStatus();
    window.localStorage.clear();
  });

  it("keeps what was written, and once another question follows it cannot be retried", async () => {
    streamChat.mockImplementationOnce(
      (
        _m: unknown,
        {
          signal,
          onDelta,
        }: { signal: AbortSignal; onDelta: (t: string) => void },
      ) =>
        new Promise((_resolve, reject) => {
          onDelta("The first half of an answer");
          signal.addEventListener("abort", () =>
            reject(new DOMException("a", "AbortError")),
          );
        }),
    );
    streamChat.mockResolvedValueOnce(BASE);
    const { actor, box } = await open();
    await actor.type(box, "slow question{Enter}");
    await screen.findByText("The first half of an answer");
    await actor.click(screen.getByRole("button", { name: "Stop" }));

    expect(screen.getByText("The first half of an answer")).toBeInTheDocument();
    expect(screen.getByText("You cancelled this answer.")).toBeInTheDocument();

    await actor.type(box, "next question{Enter}");

    expect(await screen.findByText("Done.")).toBeInTheDocument();
    // Only the last answer can be asked again.
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
  });
});

describe("a question kept in the browser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAiStatus();
    window.localStorage.clear();
  });

  it("whose earlier versions are gone shows no version switch", async () => {
    window.localStorage.setItem(
      "wikihub:chat:v1:u1",
      JSON.stringify({
        entries: [
          { id: "q", role: "user", content: "edited once", slot: "s1" },
          {
            id: "a",
            role: "assistant",
            content: "Yes.",
            status: "done",
            found: true,
          },
        ],
        slots: {},
      }),
    );
    await open();

    expect(await screen.findByText("edited once")).toBeInTheDocument();
    expect(screen.queryByText(/ \/ /)).toBeNull();
  });
});

describe("remembering the panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAiStatus();
    window.localStorage.clear();
  });

  it("still opens when the browser refuses to store anything", async () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    try {
      const { box } = await open();
      const panel = box.closest("aside");
      expect(panel).not.toBeNull();
      expect(
        within(panel!).getByPlaceholderText("Ask a question…"),
      ).toBeInTheDocument();
    } finally {
      setItem.mockRestore();
    }
  });
});
