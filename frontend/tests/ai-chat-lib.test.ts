import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnswerResult } from "@/lib/ai-answer";
import {
  ChatStreamError,
  clearStoredChats,
  executePlan,
  loadChat,
  messagesToSend,
  openChat,
  parseEvents,
  readDetail,
  saveChat,
  saveDetail,
  streamChat,
  toggleChat,
  type ChatEntry,
  type ChatSlots,
} from "@/lib/ai-chat";

const RESULT: AnswerResult = {
  found: true,
  answer: "It is 10.0.0.5 [1].",
  reason: "",
  sources: [],
  related: [],
  cached: false,
};

const event = (name: string, data: object) =>
  `event: ${name}\ndata: ${JSON.stringify({ type: name, ...data })}\n\n`;

/** A response whose body arrives in the given pieces, as a network would cut it. */
function streamed(pieces: string[], init: ResponseInit = { status: 200 }) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const piece of pieces) controller.enqueue(encoder.encode(piece));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" }, ...init },
  );
}

describe("parseEvents", () => {
  it("takes whole events and leaves the one still arriving", () => {
    const { events, rest } = parseEvents(
      event("delta", { text: "Hel" }) + 'event: delta\ndata: {"type":"del',
    );

    expect(events).toEqual([{ type: "delta", text: "Hel" }]);
    expect(rest).toBe('event: delta\ndata: {"type":"del');
  });

  it("skips comments and lines that are not JSON instead of failing the answer", () => {
    const { events } = parseEvents(
      ": keep-alive\n\ndata: not json\n\n" + event("start", { pages: 2 }),
    );

    expect(events).toEqual([{ type: "start", pages: 2 }]);
  });

  it("reads CRLF line ends", () => {
    const { events } = parseEvents(
      event("delta", { text: "x" }).replaceAll("\n", "\r\n"),
    );

    expect(events).toEqual([{ type: "delta", text: "x" }]);
  });
});

describe("streamChat", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("hands over each piece as it arrives and ends with the checked result", async () => {
    const whole =
      event("start", { pages: 1 }) +
      event("delta", { text: "It is " }) +
      event("delta", { text: "10.0.0.5 [1]." }) +
      event("done", { result: RESULT });
    // Cut in the middle of an event, as a network does.
    const cut = Math.floor(whole.length / 2);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(streamed([whole.slice(0, cut), whole.slice(cut)])),
    );
    const pieces: string[] = [];
    const starts: number[] = [];

    const result = await streamChat([{ role: "user", content: "address?" }], {
      onStart: (pages) => starts.push(pages),
      onDelta: (text) => pieces.push(text),
    });

    expect(result).toEqual(RESULT);
    expect(pieces.join("")).toBe("It is 10.0.0.5 [1].");
    expect(starts).toEqual([1]);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toMatch(/\/api\/v1\/ai\/chat$/);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      messages: [{ role: "user", content: "address?" }],
      detail: "normal",
    });
  });

  it("tells when what was shown is to be dropped for a search", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          streamed([
            event("delta", { text: "A guess. " }) +
              event("reset", {}) +
              event("searching", { query: "kubernetes version" }) +
              event("delta", { text: "The latest is 1.34 [w1]." }) +
              event("done", { result: RESULT }),
          ]),
        ),
    );
    const seen: string[] = [];

    await streamChat([{ role: "user", content: "q" }], {
      onDelta: (text) => seen.push(`delta:${text}`),
      onReset: () => seen.push("reset"),
      onSearching: (query) => seen.push(`search:${query}`),
    });

    expect(seen).toEqual([
      "delta:A guess. ",
      "reset",
      "search:kubernetes version",
      "delta:The latest is 1.34 [w1].",
    ]);
  });

  it("sends how much detail the person asked for", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(streamed([event("done", { result: RESULT })])),
    );

    await streamChat([{ role: "user", content: "q" }], { detail: "brief" });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(String((init as RequestInit).body)).detail).toBe("brief");
  });

  it("asks about one attached file only when one is chosen", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamed([event("done", { result: RESULT })])),
    );

    await streamChat([{ role: "user", content: "q" }], { attachmentId: "f-1" });
    await streamChat([{ role: "user", content: "q" }]);

    const bodies = vi
      .mocked(fetch)
      .mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(bodies[0].attachment_id).toBe("f-1");
    expect(bodies[1]).not.toHaveProperty("attachment_id");
  });

  it("remembers the level chosen, and falls back to the usual one", () => {
    window.localStorage.clear();
    expect(readDetail()).toBe("normal");
    saveDetail("detailed");
    expect(readDetail()).toBe("detailed");
    window.localStorage.setItem("wikihub:chat-detail", "nonsense");
    expect(readDetail()).toBe("normal");
    window.localStorage.clear();
  });

  it.each([
    [429, "rate_limited"],
    [503, "unavailable"],
    [500, "error"],
  ])("a %i before the stream is %s", async (status, failure) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status })),
    );

    await expect(
      streamChat([{ role: "user", content: "hello" }]),
    ).rejects.toMatchObject({ failure });
  });

  it("an error event in the stream is a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(streamed([event("error", { code: "timeout" })])),
    );

    await expect(
      streamChat([{ role: "user", content: "hello" }]),
    ).rejects.toMatchObject({ failure: "timeout" });
  });

  it("a stream that ends without a result is a failure, not an empty answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(streamed([event("delta", { text: "half" })])),
    );

    await expect(
      streamChat([{ role: "user", content: "hello" }]),
    ).rejects.toBeInstanceOf(ChatStreamError);
  });

  it("gives up when nothing arrives for too long", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: unknown, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      ),
    );

    await expect(
      streamChat([{ role: "user", content: "hello" }], { idleTimeoutMs: 20 }),
    ).rejects.toMatchObject({ failure: "timeout" });
  });

  it("stopping on purpose rejects with the abort, not as a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: unknown, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      ),
    );
    const controller = new AbortController();

    const pending = streamChat([{ role: "user", content: "hello" }], {
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("messagesToSend", () => {
  const done = (id: string, content: string, found = true): ChatEntry => ({
    id,
    role: "assistant",
    content,
    status: "done",
    found,
  });

  it("sends the questions and the answers that were given", () => {
    const sent = messagesToSend([
      { id: "1", role: "user", content: "what is billing" },
      done("2", "A server [1]."),
      { id: "3", role: "user", content: "and its address?" },
      { id: "4", role: "assistant", content: "", status: "streaming" },
    ]);

    expect(sent.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("leaves out a reply that found nothing or failed, but keeps the question before it", () => {
    const sent = messagesToSend([
      { id: "1", role: "user", content: "first" },
      done("2", "", false),
      { id: "3", role: "user", content: "second" },
      { id: "4", role: "assistant", content: "", status: "error" },
      { id: "5", role: "user", content: "third" },
    ]);

    expect(sent.map((m) => m.content)).toEqual(["first", "second", "third"]);
  });

  it("is cut to the most recent turns and always opens with a question", () => {
    const entries: ChatEntry[] = [];
    for (let i = 0; i < 15; i += 1) {
      entries.push({ id: `u${i}`, role: "user", content: `q${i}` });
      entries.push(done(`a${i}`, `a${i} [1]`));
    }
    entries.push({ id: "last", role: "user", content: "final" });

    const sent = messagesToSend(entries);

    expect(sent.length).toBeLessThanOrEqual(20);
    expect(sent[0].role).toBe("user");
    expect(sent.at(-1)?.content).toBe("final");
  });

  it("shortens a message that is longer than the server takes", () => {
    const [only] = messagesToSend([
      { id: "1", role: "user", content: "x".repeat(5000) },
    ]);

    expect(only.content).toHaveLength(2000);
  });
});

describe("the conversation kept in the browser", () => {
  afterEach(() => window.localStorage.clear());

  const state = (entries: ChatEntry[], slots: ChatSlots = {}) => ({
    entries,
    slots,
  });
  const answer = (id: string, content = "ok [1]"): ChatEntry => ({
    id,
    role: "assistant",
    content,
    status: "done",
    found: true,
  });

  it("comes back as it was saved", () => {
    const entries: ChatEntry[] = [
      { id: "1", role: "user", content: "hello" },
      answer("2", "hi [1]"),
    ];
    saveChat("u1", state(entries));

    expect(loadChat("u1")).toEqual(state(entries));
  });

  it("is kept apart for each person", () => {
    saveChat("u1", state([{ id: "1", role: "user", content: "mine" }]));

    expect(loadChat("u2")).toEqual(state([]));
  });

  it("does not keep a reply that was still being written, and shows one found so as failed", () => {
    saveChat(
      "u1",
      state([
        { id: "1", role: "user", content: "q" },
        { id: "2", role: "assistant", content: "par", status: "streaming" },
      ]),
    );
    expect(loadChat("u1").entries).toHaveLength(1);

    window.localStorage.setItem(
      "wikihub:chat:v1:u1",
      JSON.stringify({
        entries: [
          { id: "2", role: "assistant", content: "par", status: "streaming" },
        ],
        slots: {},
      }),
    );
    expect(loadChat("u1").entries[0]).toMatchObject({ status: "error" });
  });

  it("ignores what is not a conversation", () => {
    window.localStorage.setItem("wikihub:chat:v1:u1", "{not json");
    expect(loadChat("u1")).toEqual(state([]));
    window.localStorage.setItem(
      "wikihub:chat:v1:u1",
      JSON.stringify([1, "x", {}]),
    );
    expect(loadChat("u1")).toEqual(state([]));
  });

  it("reads the earlier format, a plain list of turns", () => {
    window.localStorage.setItem(
      "wikihub:chat:v1:u1",
      JSON.stringify([{ id: "1", role: "user", content: "old" }]),
    );

    expect(loadChat("u1").entries).toEqual([
      { id: "1", role: "user", content: "old" },
    ]);
  });

  it("keeps only the latest entries and forgets an empty conversation", () => {
    const many: ChatEntry[] = Array.from({ length: 50 }, (_, i) => ({
      id: String(i),
      role: "user",
      content: `q${i}`,
    }));
    saveChat("u1", state(many));
    expect(loadChat("u1").entries).toHaveLength(30);

    saveChat("u1", state([]));
    expect(window.localStorage.getItem("wikihub:chat:v1:u1")).toBeNull();
  });

  it("keeps the earlier versions of an edited question", () => {
    const first: ChatEntry[] = [
      { id: "1", role: "user", content: "adress", slot: "s" },
      answer("2"),
    ];
    const second: ChatEntry[] = [
      { id: "3", role: "user", content: "address", slot: "s" },
      answer("4", "better [1]"),
    ];
    const saved = state(second, {
      s: { variants: [first, second], active: 1 },
    });
    saveChat("u1", saved);

    expect(loadChat("u1")).toEqual(saved);
  });

  it("drops versions of a question that is no longer in the conversation, and unfinished edits", () => {
    const tail = (id: string): ChatEntry[] => [
      { id, role: "user", content: "q", slot: id },
    ];
    saveChat(
      "u1",
      state([{ id: "x", role: "user", content: "other" }], {
        gone: { variants: [tail("a"), tail("b")], active: 0 },
      }),
    );
    expect(loadChat("u1").slots).toEqual({});

    saveChat(
      "u1",
      state(tail("s"), {
        s: { variants: [tail("s"), []], active: 1, pending: 0 },
      }),
    );
    expect(loadChat("u1").slots).toEqual({});
  });

  it("ignores versions that make no sense", () => {
    window.localStorage.setItem(
      "wikihub:chat:v1:u1",
      JSON.stringify({
        entries: [{ id: "1", role: "user", content: "q", slot: "s" }],
        slots: {
          s: { variants: "no", active: 0 },
          t: { variants: [[], []], active: 9 },
          u: null,
        },
      }),
    );

    expect(loadChat("u1").slots).toEqual({});
  });
});

describe("streamChat when the connection misbehaves", () => {
  beforeEach(() => vi.restoreAllMocks());

  /** A body that delivers one piece and then breaks, as a dropped connection does. */
  const breaking = (error: unknown, first = event("start", { pages: 1 })) =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(first));
        },
        pull() {
          throw error;
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );

  it("a request that cannot be made at all is a plain failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await expect(
      streamChat([{ role: "user", content: "hello" }]),
    ).rejects.toMatchObject({ failure: "error" });
  });

  it("a response without a body is a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    );

    await expect(
      streamChat([{ role: "user", content: "hello" }]),
    ).rejects.toMatchObject({ failure: "error" });
  });

  it("a stream that breaks half way is a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(breaking(new Error("reset"))),
    );

    await expect(
      streamChat([{ role: "user", content: "hello" }]),
    ).rejects.toMatchObject({ failure: "error" });
  });

  it("a stream that goes quiet half way is given up on as too slow", async () => {
    // The start arrives, then nothing - until the idle timer aborts the request.
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: unknown, init?: RequestInit) => {
        const encoder = new TextEncoder();
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  encoder.encode(event("start", { pages: 1 })),
                );
                init?.signal?.addEventListener("abort", () =>
                  controller.error(new DOMException("aborted", "AbortError")),
                );
              },
            }),
            { status: 200 },
          ),
        );
      }),
    );

    await expect(
      streamChat([{ role: "user", content: "hello" }], { idleTimeoutMs: 30 }),
    ).rejects.toMatchObject({ failure: "timeout" });
  });

  it("stopping half way rejects with the abort, not as a failure", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(
                  new TextEncoder().encode(event("start", { pages: 1 })),
                );
                controller.signal.addEventListener("abort", () =>
                  c.error(new DOMException("aborted", "AbortError")),
                );
              },
            }),
            { status: 200 },
          ),
        ),
      ),
    );

    const pending = streamChat([{ role: "user", content: "hello" }], {
      signal: controller.signal,
      onStart: () => controller.abort(),
    });

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("an already stopped request never starts", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: unknown, init?: RequestInit) =>
        init?.signal?.aborted
          ? Promise.reject(new DOMException("aborted", "AbortError"))
          : Promise.resolve(new Response("{}", { status: 200 })),
      ),
    );

    await expect(
      streamChat([{ role: "user", content: "hello" }], {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("tells a search under way, to whoever asked to hear of it", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          streamed([
            event("searching", { query: "nginx tuning" }),
            event("done", { result: RESULT }),
          ]),
        ),
    );
    const heard: string[] = [];

    await streamChat([{ role: "user", content: "hello" }], {
      onSearching: (query) => heard.push(query),
    });

    expect(heard).toEqual(["nginx tuning"]);
  });
});

describe("what the browser kept, when it is odd", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("entries that are not a list are ignored", () => {
    window.localStorage.setItem(
      "wikihub:chat:v1:u1",
      JSON.stringify({ entries: "nope", slots: {} }),
    );

    expect(loadChat("u1")).toEqual({ entries: [], slots: {} });
  });

  it("a conversation that cannot be saved is just not kept", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });

    expect(() =>
      saveChat("u1", {
        entries: [{ id: "1", role: "user", content: "q" }],
        slots: {},
      }),
    ).not.toThrow();
  });
});

describe("asking the chat panel to open", () => {
  it("openChat and toggleChat tell the panel, with what to carry on from", () => {
    const heard: Array<[string, unknown]> = [];
    const open = (event: Event) =>
      heard.push(["open", (event as CustomEvent).detail]);
    const toggle = () => heard.push(["toggle", undefined]);
    window.addEventListener("wikihub:chat-open", open);
    window.addEventListener("wikihub:chat-toggle", toggle);

    openChat({ question: "q", result: RESULT });
    openChat();
    toggleChat();

    window.removeEventListener("wikihub:chat-open", open);
    window.removeEventListener("wikihub:chat-toggle", toggle);
    expect(heard).toEqual([
      ["open", { question: "q", result: RESULT }],
      ["open", {}],
      ["toggle", undefined],
    ]);
  });
});

describe("clearing the conversations kept in the browser", () => {
  const entries: ChatEntry[] = [{ id: "u", role: "user", content: "secret" }];
  const keys = () =>
    Object.keys(window.localStorage).filter((k) =>
      k.startsWith("wikihub:chat:v1:"),
    );

  beforeEach(() => {
    window.localStorage.clear();
    saveChat("a", { entries, slots: {} });
    saveChat("b", { entries, slots: {} });
    window.localStorage.setItem("wikihub:chat-width", "480");
    window.localStorage.setItem("wikihub:chat-detail", "detailed");
    window.localStorage.setItem("something-else", "x");
  });

  it("removes everyone's conversations and keeps what is not one", () => {
    clearStoredChats();

    expect(keys()).toEqual([]);
    expect(window.localStorage.getItem("wikihub:chat-width")).toBe("480");
    expect(window.localStorage.getItem("wikihub:chat-detail")).toBe("detailed");
    expect(window.localStorage.getItem("something-else")).toBe("x");
    loadChat("a"); // lifts the stop on writing for the tests that follow
  });

  it("can spare one person's, and then writing goes on", () => {
    clearStoredChats("a");

    expect(keys()).toEqual(["wikihub:chat:v1:a"]);
    saveChat("a", { entries, slots: {} });
    expect(keys()).toEqual(["wikihub:chat:v1:a"]);
  });

  it("stops a reply still arriving from bringing the chat back, until one is loaded", () => {
    clearStoredChats();
    saveChat("a", { entries, slots: {} });
    expect(keys()).toEqual([]);

    // The next person's conversation is loaded: writing is allowed again.
    expect(loadChat("c").entries).toEqual([]);
    saveChat("c", { entries, slots: {} });
    expect(keys()).toEqual(["wikihub:chat:v1:c"]);
  });

  it("does not fail where storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "key").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => clearStoredChats()).not.toThrow();
    vi.restoreAllMocks();
    loadChat("a");
  });
});

describe("executePlan", () => {
  beforeEach(() => vi.restoreAllMocks());

  const steps = [
    {
      type: "create_space" as const,
      args: { name: "abc", key: "ABC" },
      label_en: "Create",
      label_vi: "Tạo",
    },
    {
      type: "create_page" as const,
      args: { space: "$1", title: "T" },
      label_en: "Page",
      label_vi: "Trang",
    },
  ];

  it("sends only what each step needs and tells each one's end as it comes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        streamed([
          event("step", { index: 1, ok: true, href: "/spaces/ABC" }),
          event("step", { index: 2, ok: true, href: "/spaces/ABC/pages/t" }) +
            event("done", { ok: true }),
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);
    const seen: unknown[] = [];

    const ok = await executePlan(steps, {
      lang: "vi",
      onStep: (step) => seen.push(step),
    });

    expect(ok).toBe(true);
    expect(seen).toEqual([
      { ok: true, href: "/spaces/ABC", error: undefined },
      { ok: true, href: "/spaces/ABC/pages/t", error: undefined },
    ]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.lang).toBe("vi");
    // The labels are for people: the server is sent the type and the checked values only.
    expect(body.steps).toEqual([
      { type: "create_space", args: { name: "abc", key: "ABC" } },
      { type: "create_page", args: { space: "$1", title: "T" } },
    ]);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/v1/ai/chat/execute");
  });

  it("reports a plan that stopped, and a refusal before it started", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          streamed([
            event("step", { index: 1, ok: false, error: "no" }) +
              event("done", { ok: false }),
          ]),
        )
        .mockResolvedValueOnce(new Response("{}", { status: 429 }))
        .mockRejectedValueOnce(new TypeError("offline")),
    );

    expect(await executePlan(steps, { lang: "en" })).toBe(false);
    await expect(executePlan(steps, { lang: "en" })).rejects.toMatchObject({
      failure: "rate_limited",
    });
    await expect(executePlan(steps, { lang: "en" })).rejects.toMatchObject({
      failure: "error",
    });
  });

  it("a stream that ends without its end is a failure, and silence times out", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          streamed([event("step", { index: 1, ok: true, href: "/x" })]),
        )
        .mockImplementationOnce(
          (_url: unknown, init?: RequestInit) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError")),
              );
            }),
        ),
    );

    await expect(executePlan(steps, { lang: "en" })).rejects.toMatchObject({
      failure: "error",
    });
    await expect(
      executePlan(steps, { lang: "en", idleTimeoutMs: 20 }),
    ).rejects.toMatchObject({ failure: "timeout" });
  });
});
