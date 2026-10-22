import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnswerResult } from "@/lib/ai-answer";
import {
  CHAT_FILE_MAX_BYTES,
  ChatFileError,
  clearStoredChats,
  loadAttached,
  saveAttached,
  saveChat,
  streamChat,
  uploadChatFile,
} from "@/lib/ai-chat";
import { api, ApiError } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

const RESULT: AnswerResult = {
  found: true,
  answer: "Friday [f1].",
  reason: "",
  sources: [],
  related: [],
  cached: false,
};

const done = () =>
  new Response(
    `event: done\ndata: ${JSON.stringify({ type: "done", result: RESULT })}\n\n`,
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a question with files attached", () => {
  it("sends their ids, and none when there are none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => done()),
    );

    await streamChat([{ role: "user", content: "q" }], { fileIds: ["a", "b"] });
    await streamChat([{ role: "user", content: "q" }]);

    const bodies = vi
      .mocked(fetch)
      .mock.calls.map(([, init]) =>
        JSON.parse(String((init as RequestInit).body)),
      );
    expect(bodies[0].file_ids).toEqual(["a", "b"]);
    expect(bodies[1]).not.toHaveProperty("file_ids");
  });

  it.each([
    [{ error: { code: "chat_file_expired" } }, "file_expired"],
    [{ error: { code: "validation_error" } }, "error"],
    ["not json", "error"],
  ])("a 400 with %j is %s", async (body, failure) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(typeof body === "string" ? body : JSON.stringify(body), {
          status: 400,
        }),
      ),
    );

    await expect(
      streamChat([{ role: "user", content: "q" }]),
    ).rejects.toMatchObject({ failure });
  });
});

describe("sending a file to be read", () => {
  beforeEach(() => vi.mocked(api.post).mockReset());

  it("posts it as a form and gives back its id and name", async () => {
    vi.mocked(api.post).mockResolvedValue({
      id: "f-1",
      filename: "notes.txt",
      chars: 5,
    });

    const read = await uploadChatFile(new File(["words"], "notes.txt"));

    expect(read).toEqual({ id: "f-1", filename: "notes.txt" });
    const [path, body, options] = vi.mocked(api.post).mock.calls[0];
    expect(path).toBe("/api/v1/ai/chat/files");
    expect(body).toBeUndefined();
    expect(
      (options as { rawBody: FormData }).rawBody.get("file"),
    ).toBeInstanceOf(File);
  });

  it("refuses a file over the limit before sending it", async () => {
    const big = new File(["x"], "big.pdf");
    Object.defineProperty(big, "size", { value: CHAT_FILE_MAX_BYTES + 1 });

    await expect(uploadChatFile(big)).rejects.toMatchObject({
      code: "too_large",
    });
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each([
    [new ApiError(413, "payload_too_large", "big"), "too_large"],
    [new ApiError(429, "rate_limited", "slow down"), "rate_limited"],
    [new ApiError(503, "service_unavailable", "off"), "unavailable"],
    [new ApiError(400, "chat_file_scanned", "scanned"), "chat_file_scanned"],
    [new TypeError("offline"), "error"],
  ])("a refusal %o is the code %s", async (error, code) => {
    vi.mocked(api.post).mockRejectedValue(error);

    const failure = await uploadChatFile(new File(["w"], "a.txt")).catch(
      (caught: unknown) => caught,
    );

    expect(failure).toBeInstanceOf(ChatFileError);
    expect(failure).toMatchObject({ code });
  });

  it("keeps the server's words for a refusal it explained", () => {
    expect(new ChatFileError("x", "Because.").message).toBe("Because.");
    expect(new ChatFileError("x").message).toBe("x");
  });
});

describe("the files remembered in this browser", () => {
  beforeEach(() => window.localStorage.clear());

  it("are kept per person, at most three, and only well-formed ones", () => {
    saveAttached("u1", [
      { id: "1", filename: "a.txt" },
      { id: "2", filename: "b.txt" },
    ]);
    expect(loadAttached("u1")).toHaveLength(2);
    expect(loadAttached("u2")).toEqual([]);

    window.localStorage.setItem(
      "wikihub:chat:v1:files:u1",
      JSON.stringify([
        { id: "1", filename: "a" },
        { id: 2 },
        null,
        { id: "3", filename: "c" },
        { id: "4", filename: "d" },
        { id: "5", filename: "e" },
      ]),
    );
    expect(loadAttached("u1").map((file) => file.id)).toEqual(["1", "3", "4"]);

    window.localStorage.setItem("wikihub:chat:v1:files:u1", "{}");
    expect(loadAttached("u1")).toEqual([]);
    window.localStorage.setItem("wikihub:chat:v1:files:u1", "{broken");
    expect(loadAttached("u1")).toEqual([]);

    saveAttached("u1", []);
    expect(window.localStorage.getItem("wikihub:chat:v1:files:u1")).toBeNull();
  });

  it("survive the person's own conversation being read, and go when they sign out", () => {
    saveAttached("u1", [{ id: "1", filename: "a.txt" }]);
    saveAttached("u2", [{ id: "2", filename: "b.txt" }]);
    saveChat("u1", {
      entries: [{ id: "q", role: "user", content: "hi" }],
      slots: {},
    });

    clearStoredChats("u1");
    expect(loadAttached("u1")).toHaveLength(1);
    expect(loadAttached("u2")).toEqual([]);

    clearStoredChats();
    expect(loadAttached("u1")).toEqual([]);
  });

  it("are simply not kept when storage refuses", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });

    expect(() =>
      saveAttached("u1", [{ id: "1", filename: "a.txt" }]),
    ).not.toThrow();
  });
});

describe("which files a conversation has", () => {
  it("names the expired file the server refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "chat_file_expired", details: { file_id: "f-9" } },
          }),
          { status: 400 },
        ),
      ),
    );

    await expect(
      streamChat([{ role: "user", content: "q" }]),
    ).rejects.toMatchObject({ failure: "file_expired", fileId: "f-9" });
  });

  it("are the files of its questions, each once, in the order sent", async () => {
    const { conversationFiles } = await import("@/lib/ai-chat");
    expect(
      conversationFiles([
        {
          id: "1",
          role: "user",
          content: "a",
          files: [{ id: "x", filename: "x.txt" }],
        },
        { id: "2", role: "assistant", content: "b", status: "done" },
        { id: "3", role: "user", content: "c" },
        {
          id: "4",
          role: "user",
          content: "d",
          files: [
            { id: "x", filename: "x.txt" },
            { id: "y", filename: "y.txt", expired: true },
          ],
        },
      ]).map((file) => file.id),
    ).toEqual(["x", "y"]);
  });

  it("are listed under their question in the saved conversation", async () => {
    const { chatToMarkdown } = await import("@/lib/chat-export");
    const markdown = chatToMarkdown(
      [
        {
          id: "q",
          role: "user",
          content: "which day?",
          files: [
            { id: "x", filename: "a.xlsx" },
            { id: "y", filename: "b.pdf" },
          ],
        },
      ],
      {
        title: "Chat",
        exportedAt: "Saved",
        question: "Question",
        answer: "Answer",
        sources: "Sources",
        alsoRead: "Also read",
        web: "Web",
        files: "Files",
        notFound: "Not found",
        failed: "Failed",
        stopped: "Stopped",
        basis: (basis) => basis,
      },
    );
    expect(markdown).toContain("which day?\n\n_Files: a.xlsx, b.pdf_");
  });
});
