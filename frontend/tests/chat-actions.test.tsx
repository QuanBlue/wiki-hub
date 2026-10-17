import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
const executePlan = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-chat")>()),
  streamChat,
  executePlan,
}));

const BASE: AnswerResult = {
  found: true,
  answer: "You can open **2** spaces.",
  reason: "",
  sources: [],
  related: [],
  cached: false,
  basis: "app",
  web_sources: [],
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
}

describe("buttons under an answer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAiStatus();
    window.localStorage.clear();
  });

  it("open the pages the answer is about, and mark the group", async () => {
    streamChat.mockResolvedValue({
      ...BASE,
      actions: [
        {
          id: "my-access",
          href: "/spaces",
          label_en: "Open Spaces",
          label_vi: "Mở Space",
        },
        {
          id: "space:OPS",
          href: "/spaces/OPS",
          label_en: "Operations",
          label_vi: "Operations",
        },
      ],
    } satisfies AnswerResult);
    await ask("which spaces can I open");

    const nav = await screen.findByRole("navigation", { name: "Open" });
    const links = nav.querySelectorAll("a");
    expect([...links].map((a) => a.getAttribute("href"))).toEqual([
      "/spaces",
      "/spaces/OPS",
    ]);
    expect(links[0]).toHaveTextContent("Open Spaces");
  });

  it("are also shown when the wiki has no answer", async () => {
    streamChat.mockResolvedValue({
      found: false,
      answer: "",
      reason: "not_in_pages",
      sources: [],
      related: [],
      cached: false,
      actions: [
        {
          id: "account",
          href: "/account",
          label_en: "Open my account",
          label_vi: "Mở tài khoản",
        },
      ],
    } satisfies AnswerResult);
    await ask("how do I change my password");

    expect(
      await screen.findByRole("link", { name: /Open my account/ }),
    ).toHaveAttribute("href", "/account");
  });

  it("never link outside WikiHub, whatever the server sent", async () => {
    streamChat.mockResolvedValue({
      ...BASE,
      actions: [
        {
          id: "a",
          href: "https://evil.example",
          label_en: "Evil",
          label_vi: "Evil",
        },
        {
          id: "b",
          href: "//evil.example",
          label_en: "Evil two",
          label_vi: "Evil two",
        },
      ],
    } satisfies AnswerResult);
    await ask("anything");

    await screen.findByText(/spaces/);
    expect(screen.queryByRole("navigation", { name: "Open" })).toBeNull();
    expect(screen.queryByRole("link", { name: /Evil/ })).toBeNull();
  });

  it("keep the chat open when one is followed, even though the next page builds it again", async () => {
    window.sessionStorage.clear();
    streamChat.mockResolvedValue({
      ...BASE,
      actions: [
        {
          id: "account",
          href: "/account",
          label_en: "Open my account",
          label_vi: "Mở tài khoản",
        },
      ],
    } satisfies AnswerResult);
    await ask("how do I change my password");
    const link = await screen.findByRole("link", { name: /Open my account/ });
    link.addEventListener("click", (event) => event.preventDefault());
    await userEvent.click(link);

    const panel = () => document.getElementById("wikihub-chat-panel");
    expect(panel()?.hidden).toBe(false);

    // Another page draws its own shell: the panel is made anew and is still open, with the talk.
    cleanup();
    vi.mocked(api.get).mockResolvedValue({
      enabled: true,
      can_configure: false,
    });
    render(<ChatWidget userId="u1" />);
    expect(await screen.findByText(/You can open/)).toBeInTheDocument();
    expect(panel()?.hidden).toBe(false);

    // Closing it is what keeps it closed on the page after.
    await userEvent.click(screen.getByRole("button", { name: "Close chat" }));
    cleanup();
    render(<ChatWidget userId="u1" />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(panel()).toBeNull();
  });
});

const PLAN: AnswerResult = {
  found: true,
  answer: "I will create the space and a page in it.",
  reason: "",
  sources: [],
  related: [],
  cached: false,
  basis: "plan",
  plan: {
    steps: [
      {
        type: "create_space",
        args: { name: "abc", key: "ABC", visibility: "open" },
        label_en: 'Create space "abc" (key ABC)',
        label_vi: 'Tạo space "abc" (mã ABC)',
      },
      {
        type: "create_page",
        args: { space: "$1", title: "Guide", prompt: "about it" },
        label_en: 'Write the page "Guide" in space "abc"',
        label_vi: 'Tạo trang "Guide" trong space "abc"',
      },
    ],
    skipped: [
      {
        label: "Ann",
        reason_en: "no such user",
        reason_vi: "không có người dùng",
      },
    ],
  },
};

describe("a plan the assistant proposes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAiStatus();
    window.localStorage.clear();
  });

  it("changes nothing until it is confirmed, and can be cancelled", async () => {
    streamChat.mockResolvedValue(PLAN);
    await ask("create space abc with a guide page");

    expect(await screen.findByText(/Create space "abc"/)).toBeInTheDocument();
    expect(screen.getByText(/Write the page "Guide"/)).toBeInTheDocument();
    expect(screen.getByText(/Ann: no such user/)).toBeInTheDocument();
    expect(executePlan).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText(/Nothing was changed/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Confirm and run" }),
    ).toBeNull();
    expect(executePlan).not.toHaveBeenCalled();
  });

  it("runs the steps when confirmed, showing each result with a link to it", async () => {
    streamChat.mockResolvedValue(PLAN);
    executePlan.mockImplementation(
      async (
        _steps: unknown,
        { onStep }: { onStep: (r: { ok: boolean; href?: string }) => void },
      ) => {
        onStep({ ok: true, href: "/spaces/ABC" });
        onStep({ ok: true, href: "/spaces/ABC/pages/guide" });
        return true;
      },
    );
    await ask("create space abc with a guide page");

    await userEvent.click(
      await screen.findByRole("button", { name: "Confirm and run" }),
    );

    expect(await screen.findByText("Done")).toBeInTheDocument();
    // The page behind the panel is drawn again, so the new space is in its lists.
    expect(refresh).toHaveBeenCalled();
    expect(executePlan).toHaveBeenCalledTimes(1);
    expect(executePlan.mock.calls[0][0]).toHaveLength(2);
    const links = screen.getAllByRole("link", { name: /Open/ });
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/spaces/ABC",
      "/spaces/ABC/pages/guide",
    ]);
  });

  it("says where it stopped when a step fails", async () => {
    streamChat.mockResolvedValue(PLAN);
    executePlan.mockImplementation(
      async (
        _steps: unknown,
        { onStep }: { onStep: (r: { ok: boolean; error?: string }) => void },
      ) => {
        onStep({ ok: false, error: "A space with key 'ABC' already exists." });
        return false;
      },
    );
    await ask("create space abc");

    await userEvent.click(
      await screen.findByRole("button", { name: "Confirm and run" }),
    );

    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
    expect(screen.getByText("Stopped before the end.")).toBeInTheDocument();
  });

  it("is reported as stopped when the connection fails", async () => {
    streamChat.mockResolvedValue(PLAN);
    executePlan.mockRejectedValue(new Error("down"));
    await ask("create space abc");

    await userEvent.click(
      await screen.findByRole("button", { name: "Confirm and run" }),
    );

    expect(
      await screen.findByText("Stopped before the end."),
    ).toBeInTheDocument();
  });
});
