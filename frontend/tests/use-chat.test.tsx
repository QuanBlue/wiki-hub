import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useChat } from "@/components/chat/use-chat";
import type { AnswerResult } from "@/lib/ai-answer";
import { ChatStreamError } from "@/lib/ai-chat";

const streamChat = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-chat")>()),
  streamChat,
}));

const answer = (text: string): AnswerResult => ({
  found: true,
  answer: text,
  reason: "",
  sources: [],
  related: [],
  cached: false,
});

/** A reply that never comes until it is stopped. */
const hangs = () =>
  new Promise((_resolve, reject) => {
    const [, { signal }] = streamChat.mock.calls.at(-1)!;
    signal.addEventListener("abort", () =>
      reject(new DOMException("aborted", "AbortError")),
    );
  });

async function ready() {
  const hook = renderHook(() => useChat("u1"));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  return hook;
}

describe("useChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("asks nothing of an empty question, nor while another is being answered", async () => {
    streamChat.mockImplementation(() => hangs());
    const { result } = await ready();

    await act(async () => void result.current.send("   "));
    expect(streamChat).not.toHaveBeenCalled();

    await act(async () => void result.current.send("first"));
    await act(async () => void result.current.send("second"));

    expect(streamChat).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(true);
  });

  it("stopping with nothing under way, or with a finished reply, changes nothing", async () => {
    streamChat.mockResolvedValue(answer("done [1]"));
    const { result } = await ready();

    expect(result.current.stop()).toBe("");

    await act(async () => void result.current.send("question"));
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.stop()).toBe("");
    expect(result.current.entries).toHaveLength(2);
  });

  it("retry does nothing unless the last reply failed", async () => {
    streamChat.mockResolvedValue(answer("fine [1]"));
    const { result } = await ready();

    act(() => result.current.retry());
    expect(streamChat).not.toHaveBeenCalled();

    await act(async () => void result.current.send("question"));
    await waitFor(() => expect(result.current.busy).toBe(false));
    act(() => result.current.retry());
    expect(streamChat).toHaveBeenCalledTimes(1);
  });

  it("retry asks the failed question again, keeping its place among edited versions", async () => {
    streamChat.mockResolvedValueOnce(answer("first [1]"));
    streamChat.mockResolvedValueOnce(answer("second [1]"));
    streamChat.mockRejectedValueOnce(new ChatStreamError("unavailable"));
    streamChat.mockResolvedValueOnce(answer("third [1]"));
    const { result } = await ready();

    await act(async () => void result.current.send("original"));
    await waitFor(() => expect(result.current.busy).toBe(false));
    await act(async () =>
      result.current.edit(result.current.entries[0].id, "changed"),
    );
    await waitFor(() => expect(result.current.busy).toBe(false));
    await act(async () =>
      result.current.edit(result.current.entries[0].id, "changed again"),
    );
    await waitFor(() => expect(result.current.busy).toBe(false));
    const failed = result.current.entries[1];
    expect(failed).toMatchObject({ status: "error", failure: "unavailable" });

    await act(async () => result.current.retry());
    await waitFor(() => expect(result.current.busy).toBe(false));

    expect(result.current.entries[1]).toMatchObject({ status: "done" });
    expect(Object.keys(result.current.slots)).toHaveLength(1);
  });

  it("an edit of something that is not a question, or of nothing, is ignored", async () => {
    streamChat.mockResolvedValue(answer("fine [1]"));
    const { result } = await ready();
    await act(async () => void result.current.send("question"));
    await waitFor(() => expect(result.current.busy).toBe(false));
    const reply = result.current.entries[1];

    act(() => result.current.edit("missing", "new words"));
    act(() => result.current.edit(reply.id, "new words"));
    act(() => result.current.edit(result.current.entries[0].id, "   "));

    expect(streamChat).toHaveBeenCalledTimes(1);
    expect(result.current.entries).toHaveLength(2);
  });

  it("will not switch versions of a question that has none, or past the ends, or while busy", async () => {
    streamChat.mockResolvedValueOnce(answer("first [1]"));
    streamChat.mockResolvedValueOnce(answer("second [1]"));
    const { result } = await ready();
    await act(async () => void result.current.send("original"));
    await waitFor(() => expect(result.current.busy).toBe(false));
    const before = result.current.entries;

    act(() => result.current.switchVersion("nothing", 1));
    expect(result.current.entries).toBe(before);

    await act(async () =>
      result.current.edit(result.current.entries[0].id, "changed"),
    );
    await waitFor(() => expect(result.current.busy).toBe(false));
    const slot = Object.keys(result.current.slots)[0];
    const shown = result.current.entries;

    act(() => result.current.switchVersion(slot, 1)); // already the last version
    expect(result.current.entries).toBe(shown);

    streamChat.mockImplementationOnce(() => hangs());
    await act(async () => void result.current.send("next"));
    act(() => result.current.switchVersion(slot, -1)); // busy
    expect(result.current.entries.map((e) => e.id)).toContain(shown[0].id);
    act(() => void result.current.stop());
  });

  it("stopping an edit brings back the version it replaced and forgets there were two", async () => {
    streamChat.mockResolvedValueOnce(answer("first [1]"));
    const { result } = await ready();
    await act(async () => void result.current.send("original"));
    await waitFor(() => expect(result.current.busy).toBe(false));

    streamChat.mockImplementationOnce(() => hangs());
    await act(async () =>
      result.current.edit(result.current.entries[0].id, "changed"),
    );
    let asked = "";
    act(() => {
      asked = result.current.stop();
    });

    expect(asked).toBe("changed");
    expect(result.current.entries.map((e) => e.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(result.current.entries[0]).toMatchObject({ content: "original" });
    expect(result.current.slots).toEqual({});
  });

  it("stopping an edit of an already edited question keeps the versions it had", async () => {
    streamChat.mockResolvedValueOnce(answer("first [1]"));
    streamChat.mockResolvedValueOnce(answer("second [1]"));
    const { result } = await ready();
    await act(async () => void result.current.send("original"));
    await waitFor(() => expect(result.current.busy).toBe(false));
    await act(async () =>
      result.current.edit(result.current.entries[0].id, "changed"),
    );
    await waitFor(() => expect(result.current.busy).toBe(false));

    streamChat.mockImplementationOnce(() => hangs());
    await act(async () =>
      result.current.edit(result.current.entries[0].id, "changed again"),
    );
    act(() => void result.current.stop());

    const [slot] = Object.values(result.current.slots);
    expect(slot.variants).toHaveLength(2);
    expect(result.current.entries[0]).toMatchObject({ content: "changed" });
  });

  it("carries on from a question answered elsewhere, but not while a reply is being written", async () => {
    streamChat.mockImplementationOnce(() => hangs());
    const { result } = await ready();
    await act(async () => void result.current.send("busy question"));

    act(() =>
      result.current.adopt("search question", answer("from search [1]")),
    );
    expect(result.current.entries).toHaveLength(2);

    act(() => void result.current.stop());
    act(() =>
      result.current.adopt("search question", answer("from search [1]")),
    );
    expect(result.current.entries.map((e) => e.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(result.current.entries[0]).toMatchObject({
      content: "search question",
    });
  });

  it("shows the search under way while the reply has no words yet", async () => {
    let finish!: (result: AnswerResult) => void;
    streamChat.mockImplementationOnce(
      (_m: unknown, { onSearching }: { onSearching: (q: string) => void }) => {
        onSearching("nginx tuning");
        return new Promise<AnswerResult>((resolve) => {
          finish = resolve;
        });
      },
    );
    const { result } = await ready();

    await act(async () => void result.current.send("nginx?"));

    expect(result.current.entries[1]).toMatchObject({
      searching: "nginx tuning",
    });
    await act(async () => finish(answer("tuned [1]")));
    expect(result.current.entries[1]).toMatchObject({ status: "done" });
  });

  it("starting again drops the conversation and any reply under way", async () => {
    streamChat.mockImplementationOnce(() => hangs());
    const { result } = await ready();
    await act(async () => void result.current.send("question"));

    act(() => result.current.clear());

    expect(result.current.entries).toEqual([]);
    expect(result.current.busy).toBe(false);
  });
});
