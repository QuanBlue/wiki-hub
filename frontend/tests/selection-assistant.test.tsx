import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

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
  vi.resetModules();
  vi.mocked(api.get)
    .mockReset()
    .mockResolvedValue({ enabled: true, can_configure: false });
  vi.mocked(api.post).mockReset();
  // jsdom has no layout; give a selection somewhere to be.
  Range.prototype.getClientRects = (() => [
    RECT,
  ]) as unknown as () => DOMRectList;
  Range.prototype.getBoundingClientRect = (() =>
    RECT) as unknown as () => DOMRect;
});

async function mount(enabled = true) {
  const { SelectionAssistant } =
    await import("@/components/pages/selection-assistant");
  const { api: fresh } = await import("@/lib/api-client");
  vi.mocked(fresh.get).mockResolvedValue({ enabled, can_configure: false });
  render(
    <SelectionAssistant spaceKey="ENG" pageSlug="runbook">
      <p data-testid="para">Query it with PromQL and draw dashboards.</p>
    </SelectionAssistant>,
  );
  return vi.mocked(fresh);
}

async function selectParagraph() {
  const node = screen.getByTestId("para");
  await act(async () => {
    window.getSelection()!.selectAllChildren(node);
    document.dispatchEvent(new Event("selectionchange"));
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
}

describe("SelectionAssistant", () => {
  it("shows a small AI button at the end of a selection, and nothing without one", async () => {
    await mount();
    expect(
      screen.queryByRole("button", { name: "Explain or translate with AI" }),
    ).toBeNull();

    await selectParagraph();

    expect(
      await screen.findByRole("button", {
        name: "Explain or translate with AI",
      }),
    ).toBeInTheDocument();
  });

  it("stays out of the way while the assistant is off", async () => {
    const fresh = await mount(false);
    await waitFor(() => expect(fresh.get).toHaveBeenCalled());

    await selectParagraph();

    expect(
      screen.queryByRole("button", { name: "Explain or translate with AI" }),
    ).toBeNull();
  });

  it("explains in Vietnamese as soon as the AI button is clicked", async () => {
    const fresh = await mount();
    fresh.post.mockResolvedValue({
      result: "**PromQL** là ngôn ngữ truy vấn của Prometheus.",
    });
    await selectParagraph();
    expect(fresh.post).not.toHaveBeenCalled();

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Explain or translate with AI",
      }),
    );

    expect(
      await screen.findByText(/là ngôn ngữ truy vấn của Prometheus/),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Query it with PromQL",
    );
    expect(screen.getByRole("button", { name: "Explain" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Language" })).toHaveTextContent(
      "VI",
    );
    expect(fresh.post).toHaveBeenCalledTimes(1);
    expect(fresh.post).toHaveBeenCalledWith(
      "/api/v1/ai/spaces/ENG/pages/runbook/explain",
      {
        text: "Query it with PromQL and draw dashboards.",
        context: "Query it with PromQL and draw dashboards.",
        action: "explain",
        lang: "vi",
      },
    );
  });

  it("translates on request, remembers answers while the card is open, and closes with Escape", async () => {
    const fresh = await mount();
    fresh.post
      .mockResolvedValueOnce({ result: "Giải thích." })
      .mockResolvedValueOnce({ result: "Đã dịch." });
    await selectParagraph();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Explain or translate with AI",
      }),
    );
    await screen.findByText("Giải thích.");

    await userEvent.click(screen.getByRole("button", { name: "Translate" }));
    expect(await screen.findByText("Đã dịch.")).toBeInTheDocument();
    expect(fresh.post).toHaveBeenLastCalledWith(
      "/api/v1/ai/spaces/ENG/pages/runbook/explain",
      expect.objectContaining({ action: "translate", lang: "vi" }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Explain" }));
    expect(await screen.findByText("Giải thích.")).toBeInTheDocument();
    expect(fresh.post).toHaveBeenCalledTimes(2);

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("explains a failure inside the card", async () => {
    const fresh = await mount();
    fresh.post.mockRejectedValue(
      new ApiError(429, "rate_limited", "Too many AI requests."),
    );
    await selectParagraph();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Explain or translate with AI",
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many AI requests.",
    );
  });

  it("answers in another language and redoes the action when it changes", async () => {
    const fresh = await mount();
    fresh.post
      .mockResolvedValueOnce({ result: "Bằng tiếng Việt." })
      .mockResolvedValueOnce({ result: "In English." });
    await selectParagraph();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Explain or translate with AI",
      }),
    );
    await screen.findByText("Bằng tiếng Việt.");

    await userEvent.click(screen.getByRole("button", { name: "Language" }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "English" }),
    );

    expect(await screen.findByText("In English.")).toBeInTheDocument();
    expect(fresh.post).toHaveBeenLastCalledWith(
      "/api/v1/ai/spaces/ENG/pages/runbook/explain",
      expect.objectContaining({ action: "explain", lang: "en" }),
    );
  });
});

describe("SelectionAssistant edge cases", () => {
  async function openCard() {
    const fresh = await mount();
    fresh.post.mockResolvedValue({ result: "Giải thích." });
    await selectParagraph();
    await userEvent.click(
      await screen.findByRole("button", { name: "Explain or translate with AI" }),
    );
    await screen.findByText("Giải thích.");
    return fresh;
  }

  async function clearSelection() {
    await act(async () => {
      window.getSelection()!.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
  }

  it("takes the button away when the selection is cleared", async () => {
    await mount();
    await selectParagraph();
    await screen.findByRole("button", { name: "Explain or translate with AI" });

    await clearSelection();

    expect(screen.queryByRole("button", { name: "Explain or translate with AI" })).toBeNull();
  });

  it("keeps an open card when the selection is cleared by focus moving into it", async () => {
    await openCard();
    screen.getByRole("button", { name: "Translate" }).focus();

    await clearSelection();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes an open card once the selection is gone and focus has left it", async () => {
    await openCard();
    (document.activeElement as HTMLElement | null)?.blur();

    await clearSelection();

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("follows the words when the page scrolls", async () => {
    await mount();
    await selectParagraph();
    const button = await screen.findByRole("button", { name: "Explain or translate with AI" });
    const before = button.style.left;

    Range.prototype.getClientRects = (() => [
      { ...RECT, right: 220, bottom: 60 },
    ]) as unknown as () => DOMRectList;
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
    });

    // The button follows on the next frame, which a loaded machine can delay.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Explain or translate with AI" }).style.left,
      ).not.toBe(before),
    );
  });

  it("stays where it is on scroll when the words have no box to follow", async () => {
    await mount();
    await selectParagraph();
    const button = await screen.findByRole("button", { name: "Explain or translate with AI" });
    const before = button.style.left;

    Range.prototype.getClientRects = (() => []) as unknown as () => DOMRectList;
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(
      screen.getByRole("button", { name: "Explain or translate with AI" }).style.left,
    ).toBe(before);
  });

  it("falls back to a general message for a failure that carries none", async () => {
    const fresh = await mount();
    fresh.post.mockRejectedValue(new Error("offline"));
    await selectParagraph();
    await userEvent.click(
      await screen.findByRole("button", { name: "Explain or translate with AI" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not answer/i);
  });

  it("opens the card above the words when there is no room below", async () => {
    const original = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 200 });
    try {
      await openCard();

      const card = screen.getByRole("dialog");
      expect(card.style.bottom).not.toBe("");
    } finally {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: original });
    }
  });
});
