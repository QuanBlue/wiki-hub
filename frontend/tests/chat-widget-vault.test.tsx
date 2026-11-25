import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatWidget } from "@/components/chat/chat-widget";
import { openChat } from "@/lib/ai-chat";
import { resetAiStatus } from "@/lib/ai-summary";
import { api } from "@/lib/api-client";

const fetchChatKey = vi.hoisted(() => vi.fn());
vi.mock("@/lib/chat-key", () => ({ fetchChatKey }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  resetAiStatus();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.mocked(api.get).mockResolvedValue({ enabled: true });
});

const box = () => screen.findByPlaceholderText("Ask a question…");

describe("the chat and the key to what is saved", () => {
  it("waits for the key, then takes what it was opened with", async () => {
    let give: (value: unknown) => void = () => {};
    fetchChatKey.mockReturnValue(new Promise((resolve) => (give = resolve)));
    render(<ChatWidget userId="u1" />);
    await waitFor(() => expect(fetchChatKey).toHaveBeenCalled());

    await act(async () =>
      openChat({ file: { id: "f", filename: "plan.pdf" } }),
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    await act(async () => give({ key: new Uint8Array(32), keyId: "k" }));

    expect(
      await screen.findByPlaceholderText(/this file/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/plan\.pdf/)).toBeInTheDocument();
  });

  it(
    "says so and keeps nothing when the key cannot be had",
    { timeout: 10_000 },
    async () => {
      window.localStorage.setItem("wikihub:chat:v2:u1:draft:new", "saved");
      fetchChatKey.mockRejectedValue(new Error("offline"));
      render(<ChatWidget userId="u1" />);
      await waitFor(() => expect(fetchChatKey).toHaveBeenCalledTimes(2), {
        timeout: 4_000,
      });

      await act(async () => openChat());

      expect(await box()).toHaveValue("");
      expect(
        screen.getByText(/Saved chats could not be opened/),
      ).toBeInTheDocument();
      expect(window.localStorage.getItem("wikihub:chat:v2:u1:draft:new")).toBe(
        "saved",
      );
    },
  );

  it("asks for no key while an administrator views as someone else", async () => {
    render(<ChatWidget userId="u1" persist={false} />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());

    await act(async () => openChat());

    expect(await box()).toBeInTheDocument();
    expect(fetchChatKey).not.toHaveBeenCalled();
    expect(screen.queryByText(/Saved chats could not be opened/)).toBeNull();
  });
});
