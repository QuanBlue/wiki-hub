import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useChat } from "@/components/chat/use-chat";
import {
  executePlan,
  loadChat,
  saveDetail,
  type ChatEntry,
} from "@/lib/ai-chat";
import { chatToMarkdown, downloadMarkdown } from "@/lib/chat-export";

const LABELS = {
  title: "Chat",
  exportedAt: "Saved",
  question: "Question",
  answer: "Answer",
  sources: "Sources",
  alsoRead: "Also read",
  web: "Web",
  files: "Files",
  notFound: "No answer was found",
  failed: "The answer failed",
  stopped: "Stopped",
  basis: (basis: string) => basis,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("the saved conversation", () => {
  it("says when an answer failed, was stopped with nothing written, or was not found", () => {
    const entries: ChatEntry[] = [
      { id: "q1", role: "user", content: "one" },
      { id: "a1", role: "assistant", content: "", status: "error" },
      { id: "q2", role: "user", content: "two" },
      { id: "a2", role: "assistant", content: " ", status: "cancelled" },
      { id: "q3", role: "user", content: "three" },
      {
        id: "a3",
        role: "assistant",
        content: "",
        status: "done",
        found: false,
        reason: "no_match",
      },
      { id: "q4", role: "user", content: "four" },
      {
        id: "a4",
        role: "assistant",
        content: "",
        status: "done",
        found: false,
      },
    ];

    const markdown = chatToMarkdown(entries, LABELS);

    expect(markdown).toContain("_The answer failed_");
    expect(markdown).toContain("_Stopped_");
    expect(markdown).toContain("_No answer was found (no_match)_");
    expect(markdown).toContain("_No answer was found_");
  });

  it("is handed to the browser as a file to download", () => {
    const createObjectURL = vi.fn(() => "blob:chat");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    downloadMarkdown("# Chat", "chat.md");

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:chat");
    expect(document.querySelector("a[download]")).toBeNull();
  });
});

describe("what the browser keeps", () => {
  it("does not fail when the level of detail cannot be stored", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(() => saveDetail("brief")).not.toThrow();
  });

  it("brings back a plan that was running as one that failed", () => {
    window.localStorage.setItem(
      "wikihub:chat:v1:u1",
      JSON.stringify({
        entries: [
          { id: "q", role: "user", content: "do it" },
          {
            id: "a",
            role: "assistant",
            content: "",
            status: "done",
            plan: { steps: [], skipped: [], status: "running", results: [] },
          },
        ],
        slots: {},
      }),
    );

    const [, answer] = loadChat("u1").entries;
    expect(answer.role === "assistant" && answer.plan?.status).toBe("failed");
  });
});

describe("running a plan", () => {
  it("fails when the stream breaks while being read", async () => {
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("connection reset"));
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(broken, { status: 200 })),
    );

    await expect(
      executePlan(
        [
          {
            type: "create_space",
            args: {},
            label_en: "Create",
            label_vi: "Tạo",
          },
        ],
        { lang: "en" },
      ),
    ).rejects.toMatchObject({ failure: "error" });
  });
});

describe("cancelling a plan", () => {
  it("leaves a plan that is no longer waiting as it is", async () => {
    window.localStorage.setItem(
      "wikihub:chat:v1:u1",
      JSON.stringify({
        entries: [
          { id: "q", role: "user", content: "do it" },
          {
            id: "a",
            role: "assistant",
            content: "",
            status: "done",
            plan: { steps: [], skipped: [], status: "done", results: [] },
          },
        ],
        slots: {},
      }),
    );
    const hook = renderHook(() => useChat("u1"));
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));

    act(() => hook.result.current.cancelPlan("a"));

    const answer = hook.result.current.entries[1];
    expect(answer.role === "assistant" && answer.plan?.status).toBe("done");
  });
});
