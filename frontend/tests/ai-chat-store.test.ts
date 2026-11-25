import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  chatKey,
  chatStorage,
  keepChatsInMemory,
  saveAttached,
  saveDraft,
  summarizeThread,
  type ChatEntry,
} from "@/lib/ai-chat";
import {
  activeThread,
  chatIndexKey,
  chatThreadKey,
  deleteThread,
  findFolded,
  foldText,
  listThreads,
  loadThread,
  MAX_THREADS,
  migrateLegacyChat,
  pendingTitle,
  saveThread,
  searchThreads,
  setActiveThread,
  subscribeThreads,
  updateThread,
} from "@/lib/ai-chat-store";
import { api } from "@/lib/api-client";

const ask = (content: string, id = content): ChatEntry => ({
  id,
  role: "user",
  content,
});
const reply = (content: string, id = `r-${content}`): ChatEntry => ({
  id,
  role: "assistant",
  content,
  status: "done",
  found: true,
});
const thread = (...entries: ChatEntry[]) => ({ entries, slots: {} });

beforeEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
});
afterEach(() => {
  vi.restoreAllMocks();
  keepChatsInMemory(false);
});

describe("the threads kept in this browser", () => {
  it("a thread joins the list with its first question, named after it", () => {
    saveThread(
      "u1",
      "a",
      thread(ask("How do I install k3s?"), reply("Like so")),
    );

    expect(listThreads("u1")).toEqual([
      expect.objectContaining({
        id: "a",
        title: "How do I install k3s?",
        titleSource: "pending",
      }),
    ]);
    expect(loadThread("u1", "a").entries).toHaveLength(2);
  });

  it("a name from the first question follows an edit of it; a name given stays", () => {
    saveThread("u1", "a", thread(ask("adress", "q")));
    saveThread("u1", "a", thread(ask("address", "q2")));
    expect(listThreads("u1")[0].title).toBe("address");

    updateThread("u1", "a", { title: "Mine", titleSource: "manual" });
    saveThread("u1", "a", thread(ask("other words", "q3")));
    expect(listThreads("u1")[0].title).toBe("Mine");
  });

  it("an empty thread is not kept, and emptying one removes it", () => {
    saveThread("u1", "a", thread());
    expect(listThreads("u1")).toEqual([]);

    saveThread("u1", "a", thread(ask("q")));
    saveThread("u1", "a", thread());
    expect(listThreads("u1")).toEqual([]);
    expect(window.localStorage.getItem(chatThreadKey("u1", "a"))).toBeNull();
  });

  it("lists pinned threads first, then the most recently changed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    saveThread("u1", "old", thread(ask("old")));
    vi.setSystemTime(2000);
    saveThread("u1", "new", thread(ask("new")));
    expect(listThreads("u1").map((meta) => meta.id)).toEqual(["new", "old"]);

    updateThread("u1", "old", { pinned: true });
    expect(listThreads("u1").map((meta) => meta.id)).toEqual(["old", "new"]);

    // Saving what is already kept does not move a thread up.
    vi.setSystemTime(3000);
    saveThread("u1", "old", thread(ask("old")));
    expect(listThreads("u1").find((m) => m.id === "old")?.updatedAt).toBe(1000);
  });

  it("each person has their own threads, which stay when they sign out", () => {
    saveThread("u1", "a", thread(ask("mine")));
    saveThread("u2", "a", thread(ask("theirs")));

    expect(listThreads("u1").map((meta) => meta.title)).toEqual(["mine"]);
    expect(loadThread("u2", "a").entries[0].content).toBe("theirs");
  });

  it("remembers the thread that was open, while it exists", () => {
    saveThread("u1", "a", thread(ask("q")));
    setActiveThread("u1", "a");
    expect(activeThread("u1")).toBe("a");

    deleteThread("u1", "a");
    expect(activeThread("u1")).toBeUndefined();
    expect(listThreads("u1")).toEqual([]);
  });

  it("keeps at most so many threads, dropping the oldest that is not pinned", () => {
    vi.useFakeTimers();
    for (let index = 0; index <= MAX_THREADS; index += 1) {
      vi.setSystemTime(1000 + index);
      saveThread("u1", `t${index}`, thread(ask(`q${index}`)));
      if (index === 0) updateThread("u1", "t0", { pinned: true });
    }

    const ids = listThreads("u1").map((meta) => meta.id);
    expect(ids).toHaveLength(MAX_THREADS);
    expect(ids).toContain("t0");
    expect(ids).not.toContain("t1");
    expect(window.localStorage.getItem(chatThreadKey("u1", "t1"))).toBeNull();
  });

  it("makes room when storage is full: other people's threads go first, then the oldest", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    saveThread("other", "x", thread(ask("theirs")));
    vi.setSystemTime(2000);
    saveThread("u1", "old", thread(ask("old")));
    vi.setSystemTime(3000);

    const setItem = Storage.prototype.setItem;
    let refusals = 2;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === chatThreadKey("u1", "new") && refusals > 0) {
        refusals -= 1;
        throw new DOMException("full", "QuotaExceededError");
      }
      setItem.call(this, key, value);
    });

    saveThread("u1", "new", thread(ask("new")));

    expect(window.localStorage.getItem(chatIndexKey("other"))).toBeNull();
    expect(listThreads("u1").map((meta) => meta.id)).toEqual(["new"]);
  });

  it("gives up quietly when nothing more can go", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });

    expect(() => saveThread("u1", "a", thread(ask("q")))).not.toThrow();
    vi.restoreAllMocks();
    expect(listThreads("u1")).toEqual([]);
  });

  it("ignores what is not a list of threads", () => {
    window.localStorage.setItem(chatIndexKey("u1"), "{broken");
    expect(listThreads("u1")).toEqual([]);
    window.localStorage.setItem(
      chatIndexKey("u1"),
      JSON.stringify({
        threads: [
          { id: "a", title: "A", createdAt: 1, updatedAt: 1, titleSource: "x" },
          { id: 2 },
        ],
      }),
    );
    expect(listThreads("u1")).toEqual([
      expect.objectContaining({ id: "a", titleSource: "pending" }),
    ]);
  });

  it("keeps the gist of a long thread with it", () => {
    const compact = { summary: "We set up k3s.", upTo: "q1", count: 12 };
    saveThread("u1", "a", { ...thread(ask("q1")), compact });

    expect(loadThread("u1", "a").compact).toEqual(compact);
  });
});

describe("the conversation of the first version", () => {
  it("becomes the person's first thread, its files the ones in the box", () => {
    window.localStorage.setItem(
      "wikihub:chat:v1:u1",
      JSON.stringify({ entries: [ask("old question")], slots: {} }),
    );
    window.localStorage.setItem(
      "wikihub:chat:v1:files:u1",
      JSON.stringify([{ id: "f", filename: "a.txt" }]),
    );

    const id = migrateLegacyChat("u1");

    expect(id).toBeTruthy();
    expect(listThreads("u1")[0]).toMatchObject({ id, title: "old question" });
    expect(window.localStorage.getItem("wikihub:chat:v1:u1")).toBeNull();
    expect(window.localStorage.getItem("wikihub:chat:v1:files:u1")).toBeNull();
    expect(window.localStorage.getItem(chatKey("u1", "files", id!))).toContain(
      "a.txt",
    );
    expect(migrateLegacyChat("u1")).toBeUndefined();
  });

  it("is dropped when it cannot be read", () => {
    window.localStorage.setItem("wikihub:chat:v1:u1", "{broken");
    expect(migrateLegacyChat("u1")).toBeUndefined();
    expect(window.localStorage.getItem("wikihub:chat:v1:u1")).toBeNull();
  });
});

describe("chats while viewing as someone else", () => {
  it("live only in the page: nothing is read from or written to the browser", () => {
    saveThread("viewed", "kept", thread(ask("their real chat")));
    keepChatsInMemory(true);

    expect(listThreads("viewed")).toEqual([]);
    saveThread("viewed", "a", thread(ask("asked while viewing")));
    expect(listThreads("viewed").map((m) => m.id)).toEqual(["a"]);

    keepChatsInMemory(false);
    expect(listThreads("viewed").map((m) => m.id)).toEqual(["kept"]);
  });
});

describe("a storage that refuses", () => {
  const refuse = (method: "getItem" | "removeItem" | "setItem") =>
    vi.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw new Error("blocked");
    });

  it("never breaks the chat, whatever it refuses", () => {
    saveThread("u1", "a", thread(ask("q")));

    refuse("getItem");
    expect(listThreads("u1")).toEqual([]);
    expect(() => saveThread("u1", "a", thread(ask("more")))).not.toThrow();
    vi.restoreAllMocks();

    refuse("removeItem");
    expect(() => deleteThread("u1", "a")).not.toThrow();
    expect(() => saveDraft("u1", "", "a")).not.toThrow();
    expect(() => saveAttached("u1", [], "a")).not.toThrow();
    vi.restoreAllMocks();

    refuse("setItem");
    expect(() => saveDraft("u1", "words", "a")).not.toThrow();
    expect(() =>
      saveAttached("u1", [{ id: "f", filename: "a.txt" }], "a"),
    ).not.toThrow();
  });

  it("can be walked through while it is only in the page", () => {
    keepChatsInMemory(true);
    saveDraft("u1", "words", "a");

    expect(chatStorage()?.length).toBe(1);
  });

  it("asks the server for the gist of older messages", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ summary: "gist" });
    const messages = [{ role: "user" as const, content: "q" }];

    await expect(summarizeThread("before", messages)).resolves.toBe("gist");
    expect(post).toHaveBeenCalledWith("/api/v1/ai/chat/compact", {
      summary: "before",
      messages,
    });
  });
});

describe("hearing about changes", () => {
  it("tells of changes to this person's threads, in this tab and from others", () => {
    const heard = vi.fn();
    const stop = subscribeThreads("u1", heard);

    saveThread("u1", "a", thread(ask("q")));
    saveThread("u2", "a", thread(ask("q")));
    window.dispatchEvent(
      new StorageEvent("storage", { key: chatThreadKey("u1", "a") }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: chatThreadKey("u2", "a") }),
    );
    stop();
    saveThread("u1", "b", thread(ask("q")));

    expect(heard).toHaveBeenCalledWith(chatIndexKey("u1"));
    expect(heard).toHaveBeenCalledWith(chatThreadKey("u1", "a"));
    expect(heard).not.toHaveBeenCalledWith(chatThreadKey("u2", "a"));
    const calls = heard.mock.calls.length;
    saveThread("u1", "c", thread(ask("q")));
    expect(heard).toHaveBeenCalledTimes(calls);
  });
});

describe("names and searching", () => {
  it("a long first question is cut at a word", () => {
    const long = "word ".repeat(30);
    const title = pendingTitle(long);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(61);
    expect(pendingTitle("  short\n question ")).toBe("short question");
  });

  it("compares words without case or Vietnamese marks", () => {
    expect(foldText("Cài Đặt K3S")).toBe("cai dat k3s");
    expect(findFolded("Hướng dẫn cài đặt", "cai dat")).toEqual([10, 17]);
    expect(findFolded("abc", "x")).toBeNull();
  });

  it("finds threads by name first, then by what was said, with the words around it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    saveThread(
      "u1",
      "said",
      thread(
        ask("Staging?"),
        reply(
          "The staging server is at 10.0.0.5 and runs nginx for every site.",
        ),
      ),
    );
    vi.setSystemTime(2000);
    saveThread("u1", "named", thread(ask("Nginx tuning")));
    saveThread("u1", "other", thread(ask("Holidays")));

    const found = searchThreads("u1", "NGINX");

    expect(found.map((match) => match.meta.id)).toEqual(["named", "said"]);
    expect(found[0].entryId).toBeUndefined();
    expect(found[1]).toMatchObject({
      entryId:
        "r-The staging server is at 10.0.0.5 and runs nginx for every site.",
    });
    const [start, end] = found[1].at!;
    expect(found[1].snippet!.slice(start, end)).toBe("nginx");
    expect(searchThreads("u1", "   ")).toEqual([]);
  });

  it("finds Vietnamese words typed without marks, and marks them in a long text", () => {
    saveThread(
      "u1",
      "vi",
      thread(
        ask("Câu hỏi"),
        reply(
          `${"Mở đầu dài dòng. ".repeat(5)}Hướng dẫn cài đặt máy chủ.${" Kết thúc.".repeat(20)}`,
        ),
      ),
    );

    const [match] = searchThreads("u1", "cai dat");

    expect(match.snippet!.startsWith("…")).toBe(true);
    expect(match.snippet!.endsWith("…")).toBe(true);
    expect(match.snippet!.slice(...match.at!)).toBe("cài đặt");
  });
});
